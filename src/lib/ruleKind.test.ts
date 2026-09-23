import { describe, it, expect } from "vitest";
import {
  conditionMatches,
  describeRule,
  kindPatch,
  migrateRule,
  previewRules,
  ruleActionsToEdit,
  type CategoryRuleV2,
  type RuleAction,
  type StoredRule,
} from "./ruleEngine";
import { buildRulePlan, type KindChecks } from "./rulePlan";
import { autoApplyPatches } from "./ruleAutoApply";
import { buildRulesFile, parseRulesFile } from "./rulesTransfer";

import type { Transaction } from "../types";

const serializeRules = (rules: CategoryRuleV2[]) =>
  JSON.stringify(buildRulesFile(rules, new Date()));

/** Тип операции в правилах (#98): условие «Тип операции» и смена типа. */

function tx(p: Partial<Transaction>): Transaction {
  return {
    id: "t",
    date: "2026-07-01",
    category: "Еда",
    subcategory: null,
    categoryFull: "Еда",
    categoryFullOriginal: "Еда",
    payee: "",
    comment: "",
    outcomeAccount: "Карта",
    outcomeAmount: 100,
    outcomeCurrency: "RUB",
    incomeAccount: "",
    incomeAmount: 0,
    incomeCurrency: "RUB",
    kind: "expense",
    amount: 100,
    currency: "RUB",
    account: "Карта",
    amountBase: 100,
    opAmount: null,
    opCurrency: null,
    createdAt: "2026-07-01T00:00:00Z",
    ...p,
  } as Transaction;
}

const transfer = (p: Partial<Transaction> = {}) =>
  tx({
    kind: "transfer",
    category: "Перевод",
    categoryFull: "Перевод",
    categoryFullOriginal: "Перевод",
    outcomeAccount: "Карта",
    incomeAccount: "Сейф",
    incomeAmount: 100,
    account: "Карта",
    ...p,
  });

function rule(actions: RuleAction[], extra: Partial<CategoryRuleV2> = {}): CategoryRuleV2 {
  return {
    id: "r",
    enabled: true,
    groups: [
      {
        join: "and",
        conditions: [{ field: "comment", op: "contains", value: "кешбэк", caseInsensitive: true }],
      },
    ],
    join: "and",
    actions,
    createdAt: "",
    ...extra,
  };
}

/** Справочник: «Еда» — расходная, «Зарплата» — доходная, «Долги» — долговой. */
const checks: KindChecks = {
  isDebtAccount: (t) => t === "Долги",
  accountCurrency: (t) => ({ Карта: "RUB", Сейф: "RUB", Доллары: "USD", Долги: "RUB" })[t] ?? null,
  categorySides: (c) =>
    c === "Еда"
      ? { income: false, outcome: true }
      : c === "Зарплата"
        ? { income: true, outcome: false }
        : null,
};

describe("условие «Тип операции»", () => {
  const is = (value: string) =>
    ({ field: "kind", op: "equals", value, caseInsensitive: true }) as const;

  it("сравнивает с типом операции", () => {
    expect(conditionMatches(tx({}), is("expense"))).toBe(true);
    expect(conditionMatches(tx({ kind: "income" }), is("expense"))).toBe(false);
  });

  it("долг — отдельный тип, а не перевод", () => {
    const debt = transfer({ category: "Долг", categoryFull: "Долг", incomeAccount: "Долги" });
    expect(conditionMatches(debt, is("debt"))).toBe(true);
    expect(conditionMatches(debt, is("transfer"))).toBe(false);
    expect(conditionMatches(transfer(), is("transfer"))).toBe(true);
  });

  it("описание правила называет тип словами", () => {
    const r = rule([{ kind: "setKind", value: "income" }], {
      groups: [{ join: "and", conditions: [is("expense")] }],
    });
    expect(describeRule(r)).toBe("Тип операции равно «Расход» → Тип операции = «Доход»");
  });
});

describe("смена типа — правка операции", () => {
  it("расход ↔ доход ↔ возврат — только тип", () => {
    expect(kindPatch(tx({}), "setKind", "income")).toEqual({ kind: "income" });
    expect(kindPatch(tx({ kind: "income" }), "setKind", "refund")).toEqual({ kind: "refund" });
  });

  it("тот же тип — менять нечего", () => {
    expect(kindPatch(tx({}), "setKind", "expense")).toEqual({});
  });

  it("перевод → расход остаётся на счёте списания", () => {
    expect(kindPatch(transfer(), "setKind", "expense")).toEqual({
      kind: "expense",
      account: "Карта",
      outcomeAccount: "Карта",
      incomeAccount: "",
    });
  });

  it("перевод → доход остаётся на счёте зачисления", () => {
    expect(kindPatch(transfer(), "setKind", "income")).toEqual({
      kind: "income",
      account: "Сейф",
      incomeAccount: "Сейф",
      outcomeAccount: "",
    });
  });

  it("у перевода без категории в правиле ставится «Без категории»", () => {
    const patch = ruleActionsToEdit(transfer(), rule([{ kind: "setKind", value: "expense" }]));
    expect(patch.categoryFull).toBe("Без категории");
  });

  it("категория из того же правила важнее «Без категории»", () => {
    const patch = ruleActionsToEdit(
      transfer(),
      rule([
        { kind: "setCategory", value: "Еда" },
        { kind: "setKind", value: "expense" },
      ])
    );
    expect(patch.categoryFull).toBe("Еда");
  });

  it("расход → перевод: деньги уходят на второй счёт", () => {
    expect(kindPatch(tx({}), "setTransfer", "Сейф")).toEqual({
      kind: "transfer",
      outcomeAccount: "Карта",
      incomeAccount: "Сейф",
      account: "Карта",
    });
  });

  it("доход → перевод: деньги приходят со второго счёта", () => {
    expect(kindPatch(tx({ kind: "income" }), "setTransfer", "Сейф")).toEqual({
      kind: "transfer",
      outcomeAccount: "Сейф",
      incomeAccount: "Карта",
      account: "Сейф",
    });
  });

  it("перевод на тот же счёт, готовый перевод и долг не трогаются", () => {
    expect(kindPatch(tx({}), "setTransfer", "Карта")).toEqual({});
    expect(kindPatch(transfer(), "setTransfer", "Доллары")).toEqual({});
    const debt = transfer({ category: "Долг", categoryFull: "Долг" });
    expect(kindPatch(debt, "setKind", "expense")).toEqual({});
  });

  it("тип занимают по первому правилу — второе его не перебивает", () => {
    const first = rule([{ kind: "setKind", value: "income" }], { id: "a" });
    const second = rule([{ kind: "setKind", value: "refund" }], { id: "b" });
    const hits = previewRules([tx({ comment: "кешбэк" })], [first, second]);
    expect(hits).toHaveLength(1);
    expect(hits[0].patch.kind).toBe("income");
  });
});

describe("план: что можно записать", () => {
  const plan = (t: Transaction, actions: RuleAction[], withChecks: KindChecks | null = checks) =>
    buildRulePlan([t], [rule(actions)], new Set(["r"]), {}, new Set(), null, null, withChecks);

  it("расход по доходной категории → доход записывается", () => {
    const p = plan(tx({ comment: "кешбэк" }), [
      { kind: "setCategory", value: "Зарплата" },
      { kind: "setKind", value: "income" },
    ]);
    expect(p.pending).toHaveLength(1);
    expect(p.pending[0].patch).toMatchObject({ kind: "income", categoryFull: "Зарплата" });
    expect(p.pending[0].changes[0]).toMatchObject({ label: "Тип", from: "Расход", to: "Доход" });
  });

  it("доход по расходной категории не пишется — Дзен-мани сделал бы возврат", () => {
    const p = plan(tx({ comment: "кешбэк" }), [{ kind: "setKind", value: "income" }]);
    expect(p.pending).toHaveLength(0);
    expect(p.rows[0].blockedKind).toMatch(/возвратом/);
  });

  it("возврат — только по расходной категории", () => {
    const byIncome = plan(tx({ kind: "income", comment: "кешбэк", category: "Зарплата", categoryFull: "Зарплата", categoryFullOriginal: "Зарплата" }), [
      { kind: "setKind", value: "refund" },
    ]);
    expect(byIncome.rows[0].blockedKind).toMatch(/доходная/);
    const blank = plan(
      tx({ kind: "income", comment: "кешбэк", category: "Без категории", categoryFull: "Без категории", categoryFullOriginal: "Без категории" }),
      [{ kind: "setKind", value: "refund" }]
    );
    expect(blank.rows[0].blockedKind).toMatch(/расходная категория/);
  });

  it("перевод на счёт в другой валюте и на долговой счёт не пишется", () => {
    expect(plan(tx({ comment: "кешбэк" }), [{ kind: "setTransfer", value: "Доллары" }]).rows[0].blockedKind).toMatch(
      /другой валюте/
    );
    expect(plan(tx({ comment: "кешбэк" }), [{ kind: "setTransfer", value: "Долги" }]).rows[0].blockedKind).toMatch(
      /долговой/
    );
  });

  it("перевод в той же валюте записывается со счетами", () => {
    const p = plan(tx({ comment: "кешбэк" }), [{ kind: "setTransfer", value: "Сейф" }]);
    expect(p.pending[0].patch).toEqual({
      kind: "transfer",
      account: "Карта",
      outcomeAccount: "Карта",
      incomeAccount: "Сейф",
    });
    expect(p.pending[0].changes[0].to).toBe("Перевод на «Сейф»");
  });

  it("перевод с суммой в третьей валюте не превращается в расход", () => {
    const t = transfer({ id: "fx", comment: "кешбэк" });
    const withOp: KindChecks = { ...checks, hasOperationAmounts: (id) => id === "fx" };
    const p = plan(t, [{ kind: "setKind", value: "expense" }], withOp);
    expect(p.rows[0].blockedKind).toMatch(/сумма в другой валюте/);
  });

  it("без справочника валюту берём по операциям счёта", () => {
    const usd = tx({ id: "u", account: "Доллары", currency: "USD" });
    const p = buildRulePlan(
      [tx({ comment: "кешбэк" }), usd],
      [rule([{ kind: "setTransfer", value: "Доллары" }])],
      new Set(["r"]),
      {},
      new Set(),
      null
    );
    expect(p.rows[0].blockedKind).toMatch(/другой валюте/);
  });
});

describe("автоприменение и перенос", () => {
  it("тип со счетами — одно целое: правленный руками счёт отменяет всю смену типа", () => {
    const t = tx({ comment: "кешбэк" });
    const r = { ...rule([{ kind: "setTransfer", value: "Сейф" }]), autoApply: true };
    // Правка счёта без отметки «записано правилом» — это правка руками.
    const out = autoApplyPatches([t], [r], { t: { account: "Карта" } }, new Set(), null, null, {}, checks);
    expect(out.t).toBeUndefined();
  });

  it("правило со сменой типа переживает выгрузку в файл", () => {
    const r = rule([{ kind: "setTransfer", value: "Сейф" }], {
      groups: [{ join: "and", conditions: [{ field: "kind", op: "equals", value: "expense", caseInsensitive: true }] }],
    });
    const parsed = parseRulesFile(serializeRules([r]));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const back = migrateRule(parsed.rules[0] as StoredRule);
    expect(back.actions[0]).toMatchObject({ kind: "setTransfer", value: "Сейф" });
    expect(back.groups[0].conditions[0]).toMatchObject({ field: "kind", value: "expense" });
  });

  it("неизвестный тип из файла отбрасывается", () => {
    const r = rule([{ kind: "setKind", value: "debt" }]);
    const parsed = parseRulesFile(serializeRules([r]));
    expect(parsed.ok && parsed.rules.length).toBe(0);
  });
});
