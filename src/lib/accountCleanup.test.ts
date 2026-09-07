import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PushPayload } from "./zenmoney";
import { chunk, MERCHANT_BATCH, runPool, TAG_BATCH } from "./accountCleanup";

describe("chunk", () => {
  it("режет ровно по размеру партии", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("список короче партии — одна партия", () => {
    expect(chunk([1], 25)).toEqual([[1]]);
  });

  it("пустой список — ни одной партии, а не одна пустая", () => {
    // Пустая партия означала бы лишний запрос в облако ни за чем.
    expect(chunk([], 25)).toEqual([]);
  });

  it("длина кратна размеру — без хвоста", () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });

  it("сумма партий равна исходному списку", () => {
    const src = Array.from({ length: 326 }, (_, i) => i);
    const batches = chunk(src, MERCHANT_BATCH);
    expect(batches.flat()).toEqual(src);
    expect(batches.every((b) => b.length <= MERCHANT_BATCH)).toBe(true);
  });

  it("теги режутся мельче контрагентов", () => {
    // Размер партии на скорость почти не влияет (замер: 17,0 против 18,0 с на
    // категорию), а вот параллельность влияет вчетверо — см. шапку модуля.
    // Пятёрка выбрана как у ZenTable: 7 таких партий разом дают 3,7 с/шт.
    expect(TAG_BATCH).toBe(5);
    expect(TAG_BATCH).toBeLessThan(MERCHANT_BATCH);
    expect(chunk(Array.from({ length: 48 }, (_, i) => i), TAG_BATCH).length).toBe(10);
  });
});

describe("runPool", () => {
  it("держит в воздухе не больше предела", async () => {
    let inFlight = 0;
    let peak = 0;
    await runPool(Array.from({ length: 20 }, (_, i) => i), 7, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
    });
    expect(peak).toBe(7);
  });

  it("выполняет каждую задачу ровно один раз", async () => {
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5], 3, async (n) => {
      seen.push(n);
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("предел больше числа задач не создаёт лишних дорожек", async () => {
    let peak = 0;
    let inFlight = 0;
    await runPool([1, 2], 7, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
    });
    expect(peak).toBe(2);
  });

  it("пустой список не зависает", async () => {
    await expect(runPool([], 7, async () => {})).resolves.toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────
// Что происходит, когда запрос падает.
//
// До сих пор эта ветка не была покрыта ничем, а именно она решает, окажется
// ли человек в тупике: одна непроходимая категория не должна утаскивать за
// собой соседние по партии.

vi.mock("./zenmoney", () => ({ pushDiff: vi.fn() }));
vi.mock("./zenmoneyCache", () => ({ loadZenCache: vi.fn() }));
vi.mock("./devLog", () => ({ devLog: vi.fn() }));

const tagOf = (id: string) => ({ id, user: 1, parent: null, title: id });

async function runCleanup(opts: {
  tags: string[];
  /** id, на которых сервер отвечает ошибкой. */
  failing?: string[];
}) {
  const { pushDiff } = await import("./zenmoney");
  const { loadZenCache } = await import("./zenmoneyCache");
  const { cleanupDictionaries } = await import("./accountCleanup");
  const failing = new Set(opts.failing ?? []);
  const sentIds: string[][] = [];
  vi.mocked(loadZenCache).mockResolvedValue({
    serverTimestamp: 1,
    tags: opts.tags.map(tagOf),
    merchants: [],
  } as never);
  vi.mocked(pushDiff).mockImplementation((async (
    _token: string,
    _ts: number,
    payload: PushPayload
  ) => {
    const ids = (payload.deletion ?? []).map((d) => d.id);
    sentIds.push(ids);
    if (ids.some((id) => failing.has(id))) throw new Error("HTTP 500");
    return {} as never;
  }) as never);
  const progress: number[] = [];
  const result = await cleanupDictionaries(
    "токен",
    { tags: true, merchants: false },
    (p) => {
      // Завершающее «done» несёт sent: 0 — это конец работы, а не откат
      // счётчика; в шкалу прогресса оно не входит.
      if (p.phase !== "done") progress.push(p.sent);
    }
  );
  return { result, sentIds, progress };
}

describe("cleanupDictionaries: сбои", () => {
  beforeEach(() => vi.clearAllMocks());

  it("всё прошло — отправлено столько же, отказов нет", async () => {
    const { result } = await runCleanup({ tags: ["a", "b", "c"] });
    expect(result.sentTags).toBe(3);
    expect(result.rejected).toEqual([]);
  });

  it("одна плохая строка не утаскивает партию", async () => {
    // Ради этого и заведён повтор по одной: иначе при следующем запуске те же
    // пятеро снова соберутся вместе, и «нажмите ещё раз» не сбудется никогда.
    const tags = ["a", "b", "c", "d", "e"];
    const { result, sentIds } = await runCleanup({ tags, failing: ["c"] });
    expect(result.sentTags).toBe(4);
    expect(result.rejected.map((r) => r.id)).toEqual(["c"]);
    // Партия целиком, затем каждая строка отдельно.
    expect(sentIds[0]).toHaveLength(5);
    expect(sentIds.slice(1).map((b) => b.length)).toEqual([1, 1, 1, 1, 1]);
  });

  it("падают все — отказы собраны, исключения наружу нет", async () => {
    // Уборка не должна бросать: иначе мастер покажет ошибку вместо списка
    // того, что осталось убрать руками.
    const tags = ["a", "b"];
    const { result } = await runCleanup({ tags, failing: tags });
    expect(result.sentTags).toBe(0);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected.every((r) => r.kind === "tag")).toBe(true);
  });

  it("счётчик отправленного не считает отказы", async () => {
    // `sentTags` — это «ушло без ошибки», а не «удалено». Приписать сюда
    // отказавшие строки значило бы соврать в отчёте.
    const { result } = await runCleanup({ tags: ["a", "b", "c"], failing: ["a"] });
    expect(result.sentTags).toBe(2);
  });

  it("прогресс растёт и не превышает общего числа", async () => {
    const { progress } = await runCleanup({ tags: ["a", "b", "c", "d"] });
    expect(progress.length).toBeGreaterThan(0);
    expect(Math.max(...progress)).toBe(4);
    expect([...progress].sort((x, y) => x - y)).toEqual(progress);
  });

  it("подкатегории уходят раньше родителей", async () => {
    // Родитель, удалённый первым, оставил бы ребёнка без ветки.
    const { pushDiff } = await import("./zenmoney");
    const { loadZenCache } = await import("./zenmoneyCache");
    const { cleanupDictionaries } = await import("./accountCleanup");
    const order: string[] = [];
    vi.mocked(loadZenCache).mockResolvedValue({
      serverTimestamp: 1,
      tags: [
        { id: "родитель", user: 1, parent: null },
        { id: "ребёнок", user: 1, parent: "родитель" },
      ],
      merchants: [],
    } as never);
    vi.mocked(pushDiff).mockImplementation((async (
      _token: string,
      _ts: number,
      payload: PushPayload
    ) => {
      for (const d of payload.deletion ?? []) order.push(d.id);
      return {} as never;
    }) as never);
    await cleanupDictionaries("токен", { tags: true, merchants: false });
    expect(order).toEqual(["ребёнок", "родитель"]);
  });
});
