import { describe, expect, it } from "vitest";
import { ruleDraftFromTransaction, type RuleSource } from "./ruleFromTransaction";

/** Операция без счёта, суммы и с типом «Расход» — проверяем по одному полю. */
const src = (p: Partial<RuleSource>): RuleSource => ({
  payee: "",
  brand: "",
  comment: "",
  categoryFull: "",
  account: "",
  kind: "expense",
  amountBase: null,
  ...p,
});
const KIND = { field: "kind", op: "equals", value: "expense", caseInsensitive: true };

describe("ruleDraftFromTransaction", () => {
  it("получатель «равно» + категория этой операции", () => {
    const d = ruleDraftFromTransaction(src({ payee: "Яндекс Go", brand: "", comment: "", categoryFull: "Транспорт / Такси" }));
    expect(d.groups).toEqual([
      { join: "and", conditions: [{ field: "payee", op: "equals", value: "Яндекс Go", caseInsensitive: true }, KIND] },
    ]);
    expect(d.actions).toEqual([{ kind: "setCategory", value: "Транспорт / Такси" }]);
  });

  it("есть комментарий — он второе условие через «И»", () => {
    const d = ruleDraftFromTransaction(src({ payee: "Ресторан", brand: "", comment: " День рождения ", categoryFull: "Кафе" }));
    expect(d.groups).toEqual([
      {
        join: "and",
        conditions: [
          { field: "payee", op: "equals", value: "Ресторан", caseInsensitive: true },
          { field: "comment", op: "contains", value: "День рождения", caseInsensitive: true },
          KIND,
        ],
      },
    ]);
  });

  it("счёт, тип и сумма — тоже условиями через «И»; сумма без знака", () => {
    const d = ruleDraftFromTransaction(
      src({ payee: "Ресторан", account: "Сбер", kind: "debt", amountBase: -9000.004, categoryFull: "Кафе" })
    );
    expect(d.groups[0].conditions.slice(1)).toEqual([
      { field: "account", op: "equals", value: "Сбер", caseInsensitive: true },
      { field: "kind", op: "equals", value: "debt", caseInsensitive: true },
      { field: "amount", op: "equals", value: "9000", caseInsensitive: false },
    ]);
  });

  it("пустой комментарий и нет суммы — таких условий нет", () => {
    const d = ruleDraftFromTransaction(src({ payee: "Ресторан", comment: "  ", amountBase: null }));
    expect(d.groups[0].conditions.map((c) => c.field)).toEqual(["payee", "kind"]);
  });

  it("бренд важнее сырого получателя — его и видит человек", () => {
    const d = ruleDraftFromTransaction(src({ payee: "YANDEX*GO 1234", brand: "Яндекс Go", comment: "", categoryFull: "Такси" }));
    expect(d.groups[0].conditions[0].value).toBe("Яндекс Go");
  });

  it("без получателя — комментарий и тип", () => {
    const d = ruleDraftFromTransaction(src({ payee: "", brand: "", comment: " Кофе у дома ", categoryFull: "Кафе" }));
    expect(d.groups[0].conditions).toEqual([
      { field: "comment", op: "contains", value: "Кофе у дома", caseInsensitive: true },
      KIND,
    ]);
  });

  it("«Без категории», «Перевод», «Долг» — действие пустое, категорию выберет человек", () => {
    for (const categoryFull of ["Без категории", "Перевод", "Долг", ""]) {
      const d = ruleDraftFromTransaction(src({ payee: "Кто-то", brand: "", comment: "", categoryFull }));
      expect(d.actions).toEqual([{ kind: "setCategory", value: "" }]);
    }
  });
});
