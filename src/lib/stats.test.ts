import { describe, it, expect } from "vitest";
import { median } from "./stats";

describe("median", () => {
  it("нечётная и чётная длина, порядок не важен", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  it("пустой ряд — ноль; исходный массив не меняется", () => {
    expect(median([])).toBe(0);
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});
