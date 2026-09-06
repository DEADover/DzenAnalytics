import { describe, it, expect } from "vitest";
import { CLOCK_SKEW_SEC, compareEntities, restorePreflight } from "./restorePreflight";
import type { ZenDiffResponse, ZenMerchant, ZenTag, ZenTransaction } from "./zenmoney";

/**
 * Сущность с тем минимумом полей, который читает сверка: остальные ей не
 * нужны, и заполнять их значило бы делать вид, что они на что-то влияют.
 */
const ent = <T,>(id: string, changed: number, deleted = false): T =>
  ({ id, changed, deleted }) as unknown as T;

const tx = (id: string, changed: number, deleted = false) =>
  ent<ZenTransaction>(id, changed, deleted);
const tag = (id: string, changed: number) => ent<ZenTag>(id, changed);
const merch = (id: string, changed: number) => ent<ZenMerchant>(id, changed);

const snap = (over: Partial<ZenDiffResponse>): ZenDiffResponse =>
  ({ transaction: [], account: [], tag: [], merchant: [], ...over }) as ZenDiffResponse;

const empty = { transactions: [], accounts: [], tags: [], merchants: [] };

describe("compareEntities", () => {
  it("пустой аккаунт — снимок ляжет целиком", () => {
    const d = compareEntities([tx("a", 100), tx("b", 100)], []);
    expect(d).toEqual({
      inAccount: 0,
      inSnapshot: 2,
      tombstoned: 0,
      newerInCloud: 0,
      extra: 0,
    });
  });

  it("удалённое в облаке считается отдельно — оно не вернётся", () => {
    // Тумбстоуны в Дзен-мани липкие: повторная отправка того же id отвергается.
    const d = compareEntities([tx("a", 100)], [tx("a", 200, true)]);
    expect(d.tombstoned).toBe(1);
    // Дату у похороненного не сравниваем — вопрос уже решён.
    expect(d.newerInCloud).toBe(0);
  });

  it("свежая версия в облаке победит снимок", () => {
    // Час разницы — это правка, а не дрейф часов.
    const d = compareEntities([tx("a", 1_000_000)], [tx("a", 1_003_600)]);
    expect(d.newerInCloud).toBe(1);
  });

  it("дрейф в пару секунд правкой не считается", () => {
    // Дзен-мани отдаёт `changed` в часах клиента на момент запроса, поэтому
    // одна и та же нетронутая строка в двух ответах различается на секунды.
    // На живом аккаунте без этого допуска «изменёнными» объявлялись ВСЕ 7660
    // операций через минуту после снимка.
    expect(compareEntities([tx("a", 1_000_000)], [tx("a", 1_000_001)]).newerInCloud).toBe(0);
    expect(compareEntities([tx("a", 1_000_000)], [tx("a", 1_000_000 + CLOCK_SKEW_SEC)]).newerInCloud).toBe(0);
    // А на секунду дальше допуска — уже правка.
    expect(
      compareEntities([tx("a", 1_000_000)], [tx("a", 1_000_001 + CLOCK_SKEW_SEC)]).newerInCloud
    ).toBe(1);
  });

  it("равные даты не считаются проигрышем", () => {
    // Строка не менялась с момента снимка — возвращать нечего, но и терять тоже.
    const d = compareEntities([tx("a", 100)], [tx("a", 100)]);
    expect(d.newerInCloud).toBe(0);
  });

  it("снимок новее облака — тоже не препятствие", () => {
    const d = compareEntities([tx("a", 300)], [tx("a", 100)]);
    expect(d.newerInCloud).toBe(0);
  });

  it("лишнее в облаке — то, чего в снимке нет", () => {
    const d = compareEntities([tx("a", 100)], [tx("a", 100), tx("b", 100)]);
    expect(d.extra).toBe(1);
    expect(d.inAccount).toBe(2);
  });

  it("удалённое в снимке не возвращают и не считают", () => {
    const d = compareEntities([tx("a", 100), tx("b", 100, true)], []);
    expect(d.inSnapshot).toBe(1);
  });

  it("тумбстоун в облаке не идёт в «лишние»", () => {
    // Иначе одна и та же строка попала бы в два разных счётчика.
    const d = compareEntities([], [tx("z", 100, true)]);
    expect(d.extra).toBe(0);
    expect(d.inAccount).toBe(0);
  });
});

describe("restorePreflight", () => {
  it("пустой аккаунт готов принять снимок", () => {
    const p = restorePreflight(snap({ transaction: [tx("a", 100)] }), empty);
    expect(p.ready).toBe(true);
    expect(p.blockers).toEqual([]);
  });

  it("удалённые операции — препятствие с указанием на «Начать всё сначала»", () => {
    const p = restorePreflight(snap({ transaction: [tx("a", 100)] }), {
      ...empty,
      transactions: [tx("a", 200, true)],
    });
    expect(p.ready).toBe(false);
    const b = p.blockers.find((x) => x.kind === "tombstones");
    expect(b?.count).toBe(1);
    expect(b?.fix).toMatch(/Начать всё сначала/);
  });

  it("считает препятствия по каждому виду отдельно", () => {
    const p = restorePreflight(
      snap({ transaction: [tx("a", 100)], tag: [tag("t1", 100)] }),
      {
        transactions: [tx("a", 3600)],
        accounts: [],
        tags: [tag("t1", 100), tag("t2", 100)],
        merchants: [merch("m1", 100)],
      }
    );
    expect(p.blockers.map((b) => b.kind).sort()).toEqual([
      "extraMerchants",
      "extraTags",
      "newerInCloud",
    ]);
  });

  it("склоняет числа по-русски", () => {
    const one = restorePreflight(snap({ transaction: [tx("a", 1)] }), {
      ...empty,
      transactions: [tx("a", 9, true)],
    });
    expect(one.blockers[0].text).toContain("1 операция из снимка удалена");
    expect(one.blockers[0].text).toContain("она не вернётся");

    const few = restorePreflight(
      snap({ transaction: [tx("a", 1), tx("b", 1), tx("c", 1)] }),
      { ...empty, transactions: [tx("a", 9, true), tx("b", 9, true), tx("c", 9, true)] }
    );
    expect(few.blockers[0].text).toContain("3 операции из снимка удалены");
    expect(few.blockers[0].text).toContain("они не вернутся");

    const many = restorePreflight(
      snap({ transaction: Array.from({ length: 11 }, (_, i) => tx(`x${i}`, 1)) }),
      {
        ...empty,
        transactions: Array.from({ length: 11 }, (_, i) => tx(`x${i}`, 9, true)),
      }
    );
    expect(many.blockers[0].text).toContain("11 операций из снимка удалены");
  });

  it("пустой снимок и пустой аккаунт не роняют расчёт", () => {
    const p = restorePreflight(snap({}), empty);
    expect(p.ready).toBe(true);
    expect(p.transactions.inSnapshot).toBe(0);
  });
});
