import { describe, it, expect } from "vitest";
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
