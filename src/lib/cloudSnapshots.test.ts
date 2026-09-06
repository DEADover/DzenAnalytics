import { describe, it, expect } from "vitest";
import { foreignSnapshots } from "./cloudSnapshots";
import type { CloudSnapshotSummary } from "./cloudSnapshots";

const snap = (id: string, userId: number | null): CloudSnapshotSummary =>
  ({ id, userId }) as CloudSnapshotSummary;

describe("foreignSnapshots", () => {
  it("находит снимки чужого аккаунта", () => {
    const out = foreignSnapshots([snap("a", 1), snap("b", 2), snap("c", 2)], 2);
    expect(out.map((s) => s.id)).toEqual(["a"]);
  });

  it("снимки без привязки к аккаунту не трогает", () => {
    // Так выглядят копии, снятые до появления поля: они вполне могут быть
    // своими. Выбросить чужое — уборка, выбросить неизвестное — потеря
    // страховки.
    const out = foreignSnapshots([snap("legacy", null), snap("mine", 7)], 7);
    expect(out).toEqual([]);
  });

  it("все свои — выбрасывать нечего", () => {
    expect(foreignSnapshots([snap("a", 5), snap("b", 5)], 5)).toEqual([]);
  });

  it("все чужие — выбрасываются все", () => {
    expect(foreignSnapshots([snap("a", 1), snap("b", 1)], 9)).toHaveLength(2);
  });

  it("пустой список не роняет", () => {
    expect(foreignSnapshots([], 1)).toEqual([]);
  });
});
