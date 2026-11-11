import { describe, expect, it } from "vitest";
import { changedFields, sameEntry, unchangedSince } from "./pushQueue";

describe("очередь правок после отправки", () => {
  it("запись, не менявшаяся с момента снимка, снимается", () => {
    const sent = { a: { comment: "x" }, b: { category: "Еда" } };
    expect(unchangedSince(["a", "b"], sent, sent)).toEqual(["a", "b"]);
  });

  it("запись, которую правили во время отправки, остаётся в очереди", () => {
    const sent = { a: { comment: "x" }, b: { category: "Еда" } };
    const now = { a: { comment: "x", category: "Дом" }, b: { category: "Еда" } };
    expect(unchangedSince(["a", "b"], sent, now)).toEqual(["b"]);
  });

  it("то же поле с новым значением — тоже остаётся", () => {
    expect(unchangedSince(["a"], { a: { comment: "x" } }, { a: { comment: "y" } })).toEqual([]);
  });

  it("очередь перечитали с диска: ссылки другие, содержимое то же — снимается", () => {
    const sent = { a: { comment: "x", tags: ["t"] } };
    const now = JSON.parse(JSON.stringify(sent)) as typeof sent;
    expect(now.a).not.toBe(sent.a);
    expect(unchangedSince(["a"], sent, now)).toEqual(["a"]);
  });

  it("записи в очереди уже нет — снимать её безопасно", () => {
    expect(unchangedSince(["a"], { a: { comment: "x" } }, {})).toEqual(["a"]);
  });

  it("запись появилась после снимка — не снимается", () => {
    expect(unchangedSince(["a"], {}, { a: { comment: "x" } })).toEqual([]);
  });

  it("changedFields — только то, что появилось или изменилось", () => {
    const sent = { createdAt: "2026-10-01T10:00:00", comment: "x" };
    const now = { createdAt: "2026-10-01T10:00:00", comment: "y", category: "Дом" };
    expect(changedFields(sent, now)).toEqual({ comment: "y", category: "Дом" });
    expect(changedFields(sent, sent)).toEqual({});
    expect(changedFields(undefined, { comment: "x" })).toEqual({ comment: "x" });
  });

  it("sameEntry сравнивает по содержимому", () => {
    expect(sameEntry({ a: 1 }, { a: 1 })).toBe(true);
    expect(sameEntry({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameEntry(undefined, undefined)).toBe(true);
    expect(sameEntry(undefined, { a: 1 })).toBe(false);
  });
});
