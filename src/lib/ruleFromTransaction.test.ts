import { describe, expect, it } from "vitest";
import { ruleDraftFromTransaction } from "./ruleFromTransaction";

describe("ruleDraftFromTransaction", () => {
  it("получатель «равно» + категория этой операции", () => {
    const d = ruleDraftFromTransaction({ payee: "Яндекс Go", brand: "", comment: "до работы", categoryFull: "Транспорт / Такси" });
    expect(d.groups).toEqual([
      { join: "and", conditions: [{ field: "payee", op: "equals", value: "Яндекс Go", caseInsensitive: true }] },
    ]);
    expect(d.actions).toEqual([{ kind: "setCategory", value: "Транспорт / Такси" }]);
  });

  it("бренд важнее сырого получателя — его и видит человек", () => {
    const d = ruleDraftFromTransaction({ payee: "YANDEX*GO 1234", brand: "Яндекс Go", comment: "", categoryFull: "Такси" });
    expect(d.groups[0].conditions[0].value).toBe("Яндекс Go");
  });

  it("без получателя — по комментарию «содержит»", () => {
    const d = ruleDraftFromTransaction({ payee: "", brand: "", comment: " Кофе у дома ", categoryFull: "Кафе" });
    expect(d.groups[0].conditions[0]).toMatchObject({ field: "comment", op: "contains", value: "Кофе у дома" });
  });

  it("«Без категории», «Перевод», «Долг» — действие пустое, категорию выберет человек", () => {
    for (const categoryFull of ["Без категории", "Перевод", "Долг", ""]) {
      const d = ruleDraftFromTransaction({ payee: "Кто-то", brand: "", comment: "", categoryFull });
      expect(d.actions).toEqual([{ kind: "setCategory", value: "" }]);
    }
  });
});
