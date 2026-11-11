import { describe, it, expect } from "vitest";
import { memoLast } from "./memoLast";

describe("memoLast", () => {
  it("те же аргументы по ссылке — без пересчёта", () => {
    let calls = 0;
    const f = memoLast((a: number[], b: string) => (calls++, [...a, b.length]));
    const arr = [1, 2];
    const r1 = f(arr, "ab");
    expect(f(arr, "ab")).toBe(r1);
    expect(calls).toBe(1);
  });
  it("другой массив с тем же содержимым — пересчёт", () => {
    let calls = 0;
    const f = memoLast((a: number[]) => (calls++, a.length));
    f([1]);
    f([1]);
    expect(calls).toBe(2);
  });
  it("помнит только последний вызов", () => {
    let calls = 0;
    const f = memoLast((x: string) => (calls++, x));
    f("a");
    f("b");
    f("a");
    expect(calls).toBe(3);
  });
});
