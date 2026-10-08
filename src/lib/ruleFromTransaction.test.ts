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
const fields = (d: ReturnType<typeof ruleDraftFromTransaction>) => d.groups[0].conditions.map((c) => c.field);

describe("ruleDraftFromTransaction", () => {
  it("все условия через «И» в порядке: тип, счёт, получатель, комментарий, сумма", () => {
    const d = ruleDraftFromTransaction(
      src({ payee: "Ресторан", comment: " День рождения ", account: "Сбер", kind: "debt", amountBase: -9000.004, categoryFull: "Кафе" })
    );
    expect(d.groups).toEqual([
      {
        join: "and",
        conditions: [
          { field: "kind", op: "equals", value: "debt", caseInsensitive: true },
          { field: "account", op: "equals", value: "Сбер", caseInsensitive: true },
          { field: "payee", op: "equals", value: "Ресторан", caseInsensitive: true },
          { field: "comment", op: "contains", value: "День рождения", caseInsensitive: true },
          { field: "amount", op: "equals", value: "9000", caseInsensitive: false },
        ],
      },
    ]);
  });

  it("действие — категория этой операции", () => {
    const d = ruleDraftFromTransaction(src({ payee: "Яндекс Go", categoryFull: "Транспорт / Такси" }));
    expect(d.actions).toEqual([{ kind: "setCategory", value: "Транспорт / Такси" }]);
  });

  it("пустые поля условий не дают", () => {
    const d = ruleDraftFromTransaction(src({ payee: "Ресторан", comment: "  ", amountBase: null }));
    expect(fields(d)).toEqual(["kind", "payee"]);
  });

  it("бренд важнее сырого получателя — его и видит человек", () => {
    const d = ruleDraftFromTransaction(src({ payee: "YANDEX*GO 1234", brand: "Яндекс Go" }));
    expect(d.groups[0].conditions.find((c) => c.field === "payee")?.value).toBe("Яндекс Go");
  });

  it("без получателя — тип и комментарий", () => {
    const d = ruleDraftFromTransaction(src({ comment: " Кофе у дома " }));
    expect(d.groups[0].conditions).toEqual([
      KIND,
      { field: "comment", op: "contains", value: "Кофе у дома", caseInsensitive: true },
    ]);
  });

  it("«Без категории», «Перевод», «Долг» — действие пустое, категорию выберет человек", () => {
    for (const categoryFull of ["Без категории", "Перевод", "Долг", ""]) {
      const d = ruleDraftFromTransaction(src({ payee: "Кто-то", categoryFull }));
      expect(d.actions).toEqual([{ kind: "setCategory", value: "" }]);
    }
  });
});
