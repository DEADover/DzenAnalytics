import { describe, it, expect } from "vitest";
import { buildEditPatch, dateTimeToDate, isoToLocalTime, type EditForm } from "./buildEditPatch";
import { tx } from "../test/fixtures";
import type { Transaction } from "../types";

const accountOf = (key: string) => ({ title: key.replace(/^key:/, ""), id: key.startsWith("key:") ? `id-${key.slice(4)}` : undefined });

/** Форма «как открыли» — все поля равны операции. */
function formOf(t: Transaction, over: Partial<EditForm> = {}): EditForm {
  return {
    date: t.date,
    time: isoToLocalTime(t.createdAt),
    category: t.category,
    subcategory: t.subcategory ?? "",
    extras: t.extraCategories ?? [],
    payee: t.brand ?? "",
    comment: t.comment,
    amount: String(t.amount),
    currency: t.currency,
    kind: t.kind,
    isDebt: false,
    debtAccountTitle: null,
    realAcc: "",
    debtOutgoing: false,
    outAcc: t.outcomeAccount,
    inAcc: t.incomeAccount,
    account: t.account,
    isCrossCurrencyTransfer: false,
    inAmountValue: "",
    inAccCurrency: undefined,
    ...over,
  };
}

const expense = () =>
  tx({ kind: "expense", account: "Карта", outcomeAccount: "Карта", incomeAccount: "", createdAt: "2026-01-15T09:30:00.000Z", comment: "кофе" });

describe("buildEditPatch", () => {
  it("ничего не меняли — пустая правка", () => {
    const t = expense();
    expect(buildEditPatch(t, formOf(t), accountOf)).toEqual({});
  });

  it("пробелы вокруг — не изменение", () => {
    const t = expense();
    expect(buildEditPatch(t, formOf(t, { comment: "  кофе  ", category: ` ${t.category} ` }), accountOf)).toEqual({});
  });

  it("сменили получателя — только brand, без типа и счёта", () => {
    const t = expense();
    expect(buildEditPatch(t, formOf(t, { payee: "Кофейня" }), accountOf)).toEqual({ brand: "Кофейня" });
  });

  it("стёрли получателя — brand: null", () => {
    const t = { ...expense(), brand: "Кофейня" };
    expect(buildEditPatch(t, formOf(t, { payee: "" }), accountOf)).toEqual({ brand: null });
  });

  it("сумма с запятой и подкатегория", () => {
    const t = expense();
    expect(buildEditPatch(t, formOf(t, { amount: "150,5", subcategory: "Кафе" }), accountOf)).toEqual({
      amount: 150.5,
      subcategory: "Кафе",
    });
  });

  it("неверная сумма или дата — остаются прежние", () => {
    const t = expense();
    expect(buildEditPatch(t, formOf(t, { amount: "абв", date: "15.01" }), accountOf)).toEqual({});
  });

  it("сменили только дату — время не переписывается", () => {
    const t = expense();
    expect(buildEditPatch(t, formOf(t, { date: "2026-01-16" }), accountOf)).toEqual({ date: "2026-01-16" });
  });

  it("сменили время — createdAt в местном времени на дату операции", () => {
    const t = expense();
    const patch = buildEditPatch(t, formOf(t, { time: "18:05" }), accountOf);
    expect(patch).toEqual({ createdAt: dateTimeToDate(t.date, "18:05").toISOString() });
    expect(isoToLocalTime(patch.createdAt as string)).toBe("18:05");
  });

  it("расход на другой счёт — нога списания с названием, номером и ключом", () => {
    const t = expense();
    expect(buildEditPatch(t, formOf(t, { account: "key:Наличные" }), accountOf)).toEqual({
      outcomeAccount: "Наличные",
      outcomeAccountId: "id-Наличные",
      outcomeAccountKey: "key:Наличные",
      incomeAccount: "",
      incomeAccountId: "",
      incomeAccountKey: "",
      account: "Наличные",
      accountId: "id-Наличные",
      accountKey: "key:Наличные",
    });
  });

  it("доход и возврат на другой счёт — нога зачисления", () => {
    for (const kind of ["income", "refund"] as const) {
      const t = tx({ kind, account: "Карта", outcomeAccount: "", incomeAccount: "Карта" });
      const p = buildEditPatch(t, formOf(t, { account: "key:Вклад" }), accountOf);
      expect(p.incomeAccountKey).toBe("key:Вклад");
      expect(p.outcomeAccount).toBe("");
    }
  });

  it("расход стал доходом — kind, счёт не трогается", () => {
    const t = expense();
    expect(buildEditPatch(t, formOf(t, { kind: "income" }), accountOf)).toEqual({ kind: "income" });
  });

  it("вторые категории — только если список поменялся", () => {
    const t = { ...expense(), extraCategories: ["Отпуск"] };
    expect(buildEditPatch(t, formOf(t, { extras: ["Отпуск"] }), accountOf)).toEqual({});
    expect(buildEditPatch(t, formOf(t, { extras: ["Отпуск", "Дети"] }), accountOf)).toEqual({ extraCategories: ["Отпуск", "Дети"] });
  });

  it("перевод между валютами: сумма зачисления — только при изменении", () => {
    const t = tx({
      kind: "transfer",
      account: "Карта",
      outcomeAccount: "Карта",
      incomeAccount: "Доллары",
      incomeAmount: 10,
      incomeCurrency: "USD",
    });
    const base = { isCrossCurrencyTransfer: true, inAccCurrency: "USD", inAmountValue: "10" };
    expect(buildEditPatch(t, formOf(t, base), accountOf)).toEqual({});
    expect(buildEditPatch(t, formOf(t, { ...base, inAmountValue: "12" }), accountOf)).toEqual({
      incomeAmount: 12,
      incomeCurrency: "USD",
    });
  });

  it("долг: смена направления пересобирает обе ноги вокруг «Долгов»", () => {
    const t = tx({ kind: "transfer", category: "Долг", account: "Карта", outcomeAccount: "Карта", incomeAccount: "Долги" });
    const p = buildEditPatch(
      t,
      formOf(t, { isDebt: true, debtAccountTitle: "Долги", realAcc: "Карта", debtOutgoing: false }),
      accountOf
    );
    expect(p.outcomeAccountKey).toBe("Долги");
    expect(p.incomeAccountKey).toBe("Карта");
  });
});
