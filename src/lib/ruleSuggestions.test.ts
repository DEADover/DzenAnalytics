import { describe, expect, it } from "vitest";
import { appendCorrections, buildRuleSuggestions, correctionsOf, type Correction } from "./ruleSuggestions";
import type { CategoryRuleV2 } from "./ruleEngine";
import type { Transaction } from "../types";

let n = 0;
function tx(p: Partial<Transaction> = {}): Transaction {
  n += 1;
  return {
    id: `t${n}`,
    date: "2026-10-01",
    kind: "expense",
    category: "Товары для дома",
    subcategory: null,
    categoryFull: "Товары для дома",
    payee: "Улыбка Радуги",
    comment: "",
    amount: 100,
    amountBase: 100,
    currency: "RUB",
    account: "Карта",
    ...p,
  } as Transaction;
}

const fix = (p: Partial<Correction>): Correction => ({
  field: "category",
  key: "Улыбка Радуги",
  statement: "",
  to: "Уход за собой",
  txId: `c${(n += 1)}`,
  at: n,
  ...p,
});

describe("correctionsOf", () => {
  it("смена категории — исправление по имени контрагента", () => {
    const t = tx();
    expect(correctionsOf(t, { category: "Уход за собой", categoryFull: "Уход за собой" }, 5)).toEqual([
      { field: "category", key: "Улыбка Радуги", statement: "", to: "Уход за собой", txId: t.id, at: 5 },
    ]);
  });
  it("та же категория, «Без категории» и операция без контрагента — не исправление", () => {
    expect(correctionsOf(tx(), { categoryFull: "Товары для дома" }, 1)).toEqual([]);
    expect(correctionsOf(tx(), { categoryFull: "Без категории" }, 1)).toEqual([]);
    expect(correctionsOf(tx({ payee: "" }), { categoryFull: "Уход за собой" }, 1)).toEqual([]);
  });
  it("смена контрагента — по прежнему имени, а без него — по строке из выписки", () => {
    const named = tx({ payee: "IKI", payeeRaw: "IKI VILNIUS" });
    expect(correctionsOf(named, { brand: "Iki" }, 1)).toEqual([]); // то же имя, другой регистр
    expect(correctionsOf(named, { brand: "Ики" }, 1)[0]).toMatchObject({ field: "payee", key: "IKI", to: "Ики" });
    const nameless = tx({ payee: "", payeeRaw: "UK DOM 12" });
    expect(correctionsOf(nameless, { brand: "Управляющая компания" }, 1)[0]).toMatchObject({
      field: "payee",
      key: "",
      statement: "UK DOM 12",
    });
    expect(correctionsOf(tx({ payee: "", payeeRaw: "" }), { brand: "Кто-то" }, 1)).toEqual([]);
  });
  it("контрагент и категория в одной правке: категория — уже по новому имени", () => {
    const t = tx({ payee: "RADUGA 77" });
    const out = correctionsOf(t, { brand: "Улыбка Радуги", categoryFull: "Уход за собой" }, 1);
    expect(out.map((c) => [c.field, c.key, c.to])).toEqual([
      ["payee", "RADUGA 77", "Улыбка Радуги"],
      ["category", "Улыбка Радуги", "Уход за собой"],
    ]);
  });
  it("перевод не считается", () => {
    expect(correctionsOf(tx({ kind: "transfer" }), { categoryFull: "Уход за собой" }, 1)).toEqual([]);
  });
});

describe("appendCorrections", () => {
  it("у операции и поля остаётся последнее исправление", () => {
    const a = fix({ txId: "x", to: "Уход за собой" });
    const b = fix({ txId: "x", to: "Подарки" });
    expect(appendCorrections([a], [b])).toEqual([b]);
  });
});

describe("buildRuleSuggestions", () => {
  const none = new Set<string>();
  it("три одинаковых исправления дают черновик правила", () => {
    const log = [fix({}), fix({}), fix({})];
    const txs = [tx(), tx({ categoryFull: "Уход за собой" }), tx({ payee: "Другой" })];
    const [s, ...rest] = buildRuleSuggestions(log, [], txs, none);
    expect(rest).toEqual([]);
    expect(s).toMatchObject({ field: "category", matchValue: "Улыбка Радуги", to: "Уход за собой", count: 3, total: 2, inTarget: 1 });
    expect(s.draft).toEqual({
      groups: [{ join: "and", conditions: [{ field: "payee", op: "equals", value: "Улыбка Радуги", caseInsensitive: true }] }],
      actions: [{ kind: "setCategory", value: "Уход за собой" }],
    });
  });
  it("двух раз мало, одна операция дважды — один раз", () => {
    expect(buildRuleSuggestions([fix({}), fix({})], [], [], none)).toEqual([]);
    expect(buildRuleSuggestions([fix({ txId: "a" }), fix({ txId: "a" }), fix({ txId: "b" })], [], [], none)).toEqual([]);
  });
  it("контрагента правят в разные стороны — подсказки нет", () => {
    const log = [fix({}), fix({}), fix({}), fix({ to: "Товары для дома" }), fix({ to: "Товары для дома" })];
    expect(buildRuleSuggestions(log, [], [], none)).toEqual([]);
  });
  it("готовое правило и спрятанная подсказка не предлагаются", () => {
    const log = [fix({}), fix({}), fix({})];
    const rule: CategoryRuleV2 = {
      id: "r",
      enabled: false,
      join: "and",
      groups: [{ join: "and", conditions: [{ field: "payee", op: "equals", value: "улыбка радуги", caseInsensitive: true }] }],
      actions: [{ kind: "setCategory", value: "Уход за собой" }],
      createdAt: "",
    };
    expect(buildRuleSuggestions(log, [rule], [], none)).toEqual([]);
    const id = buildRuleSuggestions(log, [], [], none)[0].id;
    expect(buildRuleSuggestions(log, [], [], new Set([id]))).toEqual([]);
  });
  it("контрагент без имени — правило по строке из выписки", () => {
    const p = { field: "payee" as const, key: "", statement: "UK DOM 12", to: "Управляющая компания" };
    const [s] = buildRuleSuggestions([fix(p), fix(p), fix(p)], [], [], none);
    expect(s).toMatchObject({ field: "payee", matchLabel: "Строка из выписки", matchValue: "UK DOM 12" });
    expect(s.draft.groups[0].conditions[0]).toMatchObject({ field: "statement", op: "equals", value: "UK DOM 12" });
    expect(s.draft.actions).toEqual([{ kind: "setPayee", value: "Управляющая компания" }]);
  });
});
