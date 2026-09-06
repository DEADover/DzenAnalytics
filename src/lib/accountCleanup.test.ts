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

  it("теги режутся мельче контрагентов", () => {
    // Замерено на живом аккаунте: партия из 25 тегов не завершилась и за пять
    // минут. Удаление тега дорогое — сервер обходит ссылающиеся операции.
    expect(TAG_BATCH).toBeLessThan(MERCHANT_BATCH);
    expect(chunk(Array.from({ length: 48 }, (_, i) => i), TAG_BATCH).length).toBe(10);
  });
});
