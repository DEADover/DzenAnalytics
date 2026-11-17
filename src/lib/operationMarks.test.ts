import { describe, expect, it } from "vitest";
import type { Transaction } from "../types";
import { operationMarkClass, operationTime } from "./operationMarks";

const tx = (over: Partial<Transaction> = {}) =>
  ({ id: "t1", date: "2026-11-17", createdAt: "2026-11-17T08:51:00Z", ...over }) as Transaction;

describe("operationMarkClass — полоска новых и неотправленных", () => {
  it("при точке строка ничем не помечена", () => {
    expect(operationMarkClass("dot", tx({ unseen: true }), true)).toBeUndefined();
  });
  it("неотправленная важнее новой", () => {
    expect(operationMarkClass("strip", tx({ unseen: true }), true)).toBe("row-mark-draft");
    expect(operationMarkClass("strip", tx({ unseen: true }), false)).toBe("row-mark-new");
  });
  it("подсветка — та же полоска плюс заливка строки", () => {
    expect(operationMarkClass("fill", tx({ unseen: true }), false)).toBe("row-mark-new row-mark-fill");
    expect(operationMarkClass("fill", tx(), true)).toBe("row-mark-draft row-mark-fill");
    expect(operationMarkClass("fill", tx(), false)).toBeUndefined();
  });
  it("просмотренная без полоски", () => {
    expect(operationMarkClass("strip", tx(), false)).toBeUndefined();
  });
});

describe("operationTime — время операции", () => {
  it("по местным часам, 24-часовым видом", () => {
    const iso = new Date(2026, 10, 17, 21, 5).toISOString();
    expect(operationTime(tx({ createdAt: iso }))).toBe("21:05");
  });
  it("полночь по Гринвичу в день операции — времени нет", () => {
    expect(operationTime(tx({ createdAt: "2026-11-17T00:00:00Z" }))).toBe("");
    expect(operationTime(tx({ createdAt: "" }))).toBe("");
  });
});
