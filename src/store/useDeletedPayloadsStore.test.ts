import { describe, expect, it } from "vitest";
import type { ZenTransaction } from "../lib/zenmoney";
import { spentSnapshotIds } from "./useDeletedPayloadsStore";

const cache = (rows: { id: string; deleted?: boolean }[]) => ({
  transactions: rows as unknown as ZenTransaction[],
});

describe("снимки удалённых операций: какие больше не нужны", () => {
  it("операция жива в облаке и не спрятана — снимок не нужен (удалил → отменил)", () => {
    expect(spentSnapshotIds(["a"], cache([{ id: "a" }]), new Set())).toEqual(["a"]);
  });

  it("операция всё ещё спрятана — снимок ждёт возможного возврата", () => {
    expect(spentSnapshotIds(["a"], cache([{ id: "a" }]), new Set(["a"]))).toEqual([]);
  });

  it("операции в облаке уже нет — снимок нужен, по нему её вернут", () => {
    expect(spentSnapshotIds(["a"], cache([]), new Set())).toEqual([]);
    expect(spentSnapshotIds(["a"], cache([{ id: "a", deleted: true }]), new Set())).toEqual([]);
  });

  it("разбирает пачку: уходят только живые и неспрятанные", () => {
    const c = cache([{ id: "live" }, { id: "hidden" }, { id: "tomb", deleted: true }]);
    expect(spentSnapshotIds(["live", "hidden", "tomb", "gone"], c, new Set(["hidden"]))).toEqual(["live"]);
  });
});
