import { describe, it, expect } from "vitest";
import { chunk, MERCHANT_BATCH, TAG_BATCH } from "./accountCleanup";

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

  it("категории уходят по одной", () => {
    // Не ради скорости: замерено, что цена — около 17 с ЗА КАТЕГОРИЮ и от
    // размера партии не зависит (20 шт по одной — 357 с, пятёрками — 84 с на
    // запрос). Выбор в пользу единицы сделан ради прогресса: он двигается раз
    // в 18 секунд, а не раз в полторы минуты, и упавшая строка стоит одного
    // повтора, а не пяти.
    expect(TAG_BATCH).toBe(1);
    expect(TAG_BATCH).toBeLessThan(MERCHANT_BATCH);
    expect(chunk(Array.from({ length: 48 }, (_, i) => i), TAG_BATCH).length).toBe(48);
  });
});
