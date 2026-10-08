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
  currentCategory: "Еда",
  ...p,
});
const KIND = { field: "kind", op: "equals", value: "expense", caseInsensitive: true };
const CAT = { field: "category", op: "equals", value: "Еда", caseInsensitive: true };
const fields = (d: ReturnType<typeof ruleDraftFromTransaction>) => d.groups[0].conditions.map((c) => c.field);

describe("ruleDraftFromTransaction", () => {
  it("все условия через «И» в порядке: тип, счёт, категория, получатель, комментарий, сумма", () => {
    const d = ruleDraftFromTransaction(
      src({ payee: "Ресторан", comment: " День рождения ", account: "Сбер", kind: "debt", amountBase: -9000.004, categoryFull: "Кафе" })
    );
    expect(d.groups).toEqual([
      {
        join: "and",
        conditions: [
          { field: "kind", op: "equals", value: "debt", caseInsensitive: true },
          { field: "account", op: "equals", value: "Сбер", caseInsensitive: true },
          CAT,
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
    expect(fields(d)).toEqual(["kind", "category", "payee"]);
  });

  it("бренд важнее сырого получателя — его и видит человек", () => {
    const d = ruleDraftFromTransaction(src({ payee: "YANDEX*GO 1234", brand: "Яндекс Go" }));
    expect(d.groups[0].conditions.find((c) => c.field === "payee")?.value).toBe("Яндекс Go");
  });

  it("без получателя — тип, категория и комментарий", () => {
    const d = ruleDraftFromTransaction(src({ comment: " Кофе у дома " }));
    expect(d.groups[0].conditions).toEqual([
      KIND,
      CAT,
      { field: "comment", op: "contains", value: "Кофе у дома", caseInsensitive: true },
    ]);
  });

  it("текущая категория — сохранённая, действие — выбранная в карточке", () => {
    const d = ruleDraftFromTransaction(src({ payee: "Кофейня", currentCategory: "Разное", categoryFull: "Еда / Кафе" }));
    expect(d.groups[0].conditions[1]).toEqual({ field: "category", op: "equals", value: "Разное", caseInsensitive: true });
    expect(d.actions[0].value).toBe("Еда / Кафе");
  });

  it("без категории — условие «не заполнено»; перевод и долг — без условия по категории", () => {
    for (const currentCategory of ["", "Без категории"]) {
      const d = ruleDraftFromTransaction(src({ payee: "Кто-то", currentCategory }));
      expect(d.groups[0].conditions[1]).toEqual({ field: "category", op: "empty", value: "", caseInsensitive: true });
    }
    for (const currentCategory of ["Перевод", "Долг"]) {
      const d = ruleDraftFromTransaction(src({ payee: "Кто-то", kind: "transfer", currentCategory }));
      expect(fields(d)).toEqual(["kind", "payee"]);
    }
  });

  it("категорию не меняли — действие пустое: та же категория ничего бы не изменила", () => {
    const d = ruleDraftFromTransaction(src({ payee: "Кофейня", currentCategory: "Еда / Кафе", categoryFull: "Еда / Кафе" }));
    expect(d.actions).toEqual([{ kind: "setCategory", value: "" }]);
  });

  it("«Без категории», «Перевод», «Долг» — действие пустое, категорию выберет человек", () => {
    for (const categoryFull of ["Без категории", "Перевод", "Долг", ""]) {
      const d = ruleDraftFromTransaction(src({ payee: "Кто-то", categoryFull }));
      expect(d.actions).toEqual([{ kind: "setCategory", value: "" }]);
    }
  });
});
