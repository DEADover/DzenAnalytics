import { describe, it, expect } from "vitest";
import { applyEdits } from "./applyEdits";
import type { TransactionEdit } from "../store/useEditsStore";
import { tx, RATES } from "../test/fixtures";

const run = (t: ReturnType<typeof tx>, patch: TransactionEdit) =>
  applyEdits([t], { [t.id]: patch }, RATES)[0];

describe("applyEdits — transfer category normalization", () => {
  it("flipping an expense to transfer relabels the category to «Перевод»", () => {
    const t = tx({ id: "a", kind: "expense", category: "Машина", subcategory: "Бензин", categoryFull: "Машина / Бензин" });
    const out = run(t, { kind: "transfer" });
    expect(out.kind).toBe("transfer");
    expect(out.category).toBe("Перевод");
    expect(out.subcategory).toBeNull();
    expect(out.categoryFull).toBe("Перевод");
  });

  it("keeps «Долг» on a native debt transfer edited without a kind change", () => {
    // Debt rows come from the mapper already as kind=transfer / category=Долг.
    // Editing e.g. the comment must NOT turn «Долг» into «Перевод».
    const t = tx({ id: "b", kind: "transfer", category: "Долг", categoryFull: "Долг" });
    const out = run(t, { comment: "правка" });
    expect(out.category).toBe("Долг");
  });

  it("does not touch the category of a non-transfer edit", () => {
    const t = tx({ id: "c", kind: "expense", category: "Еда" });
    const out = run(t, { comment: "x" });
    expect(out.category).toBe("Еда");
  });
});

describe("applyEdits — основная и вторая категории", () => {
  it("категория, ставшая основной, уходит из вторых", () => {
    const t = tx({ id: "a", category: "Еда", subcategory: null, categoryFull: "Еда", extraCategories: ["Отпуск", "Дети"] });
    const out = run(t, { category: "Отпуск", subcategory: null, categoryFull: "Отпуск" });
    expect(out.categoryFull).toBe("Отпуск");
    expect(out.extraCategories).toEqual(["Дети"]);
  });
});
