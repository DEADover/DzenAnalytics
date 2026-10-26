import { describe, it, expect } from "vitest";
import {
  accountGroup,
  buildZenPlanRules,
  openingBalance,
  planResidue,
  monthResidues,
  zenPlanSettings,
  type PlanAccount,
} from "./zenPlanRules";
import { budgetHits, type BudgetScope } from "./budgetScope";
import { tx } from "../test/fixtures";

const acc = (title: string, p: Partial<PlanAccount> = {}): PlanAccount => ({
  title,
  type: "ccard",
  savings: false,
  creditLimit: 0,
  inBalance: true,
  ...p,
});

const ACCOUNTS = [
  acc("Карта"),
  acc("Наличные", { type: "cash" }),
  acc("Вклад", { type: "deposit", savings: true, inBalance: false }),
  acc("Копилка", { type: "checking", savings: true, inBalance: false }),
  acc("Кредитка", { creditLimit: 100_000, inBalance: false }),
  acc("Ипотека", { type: "loan", inBalance: false }),
  acc("Долги", { type: "debt", inBalance: false }),
  acc("Брокер", { type: "checking", inBalance: false }),
];

const CATEGORIES = [
  { key: "Еда", showIncome: false, showOutcome: true },
  { key: "Работа", showIncome: true, showOutcome: false },
  { key: "Работа / Премия", showIncome: true, showOutcome: false },
];

function scopeFor(user: { planBalanceMode?: string; planSettings?: unknown }): BudgetScope {
  return {
    accounts: new Set(),
    perimeterTransfers: false,
    zen: buildZenPlanRules(ACCOUNTS, zenPlanSettings(user), CATEGORIES),
  };
}

const move = (from: string, to: string, amount = 10_000, payee = "") =>
  tx({ kind: "transfer", outcomeAccount: from, incomeAccount: to, account: from, amountBase: amount, payee });

describe("zenPlanSettings", () => {
  it("«Доходы vs Расходы»: группы — из planSettings, лежащих строкой JSON", () => {
    const s = zenPlanSettings({
      planBalanceMode: "excludeOpeningBalance",
      planSettings: '["excludeTransferToOtherAccounts","excludeTransferToSavings"]',
    });
    expect([...s.excluded].sort()).toEqual(["to:other", "to:savings"]);
    expect(s.openingBalance).toBe(false);
    expect(s.refunds).toBe(true);
  });

  it("«Доходы vs Расходы» с входящим балансом", () => {
    const s = zenPlanSettings({
      planBalanceMode: "excludeOpeningBalance",
      planSettings: ["includeOpeningBalance"],
    });
    expect(s.openingBalance).toBe(true);
  });

  it("«Баланс vs Расходы»: всё включено, возвраты не вычитаются", () => {
    const s = zenPlanSettings({
      planBalanceMode: "balance",
      planSettings: ["excludeTransferToSavings"],
    });
    expect(s.excluded.size).toBe(0);
    expect(s.openingBalance).toBe(true);
    expect(s.refunds).toBe(false);
  });
});

describe("accountGroup", () => {
  it("раскладывает счета как приложение", () => {
    expect(accountGroup(acc("x", { type: "deposit" }))).toBe("savings");
    expect(accountGroup(acc("x", { type: "checking", savings: true }))).toBe("savings");
    expect(accountGroup(acc("x", { creditLimit: 5000 }))).toBe("loans");
    expect(accountGroup(acc("x", { type: "loan" }))).toBe("loans");
    expect(accountGroup(acc("x", { type: "debt" }))).toBe("debts");
    expect(accountGroup(acc("x", { type: "checking" }))).toBe("other");
  });
});

describe("budgetHits по правилам «Планов»", () => {
  const balance = scopeFor({ planBalanceMode: "balance" });

  it("перевод на накопительный вне баланса — расход «Накопления» по счёту", () => {
    expect(budgetHits(move("Карта", "Вклад"), balance)).toEqual([
      { kind: "expense", category: "Накопления", subcategory: "Вклад", amount: 10_000, planGroup: true },
    ]);
  });

  it("перевод из накоплений — поступление «Накопления», как в приложении", () => {
    expect(budgetHits(move("Копилка", "Карта"), balance)[0]).toMatchObject({
      kind: "income",
      category: "Накопления",
      subcategory: "Копилка",
    });
  });

  it("платёж по кредитке и кредиту — «Кредиты и кредитки»", () => {
    expect(budgetHits(move("Карта", "Кредитка"), balance)[0].category).toBe("Кредиты и кредитки");
    expect(budgetHits(move("Карта", "Ипотека"), balance)[0].category).toBe("Кредиты и кредитки");
    expect(budgetHits(move("Кредитка", "Карта"), balance)[0]).toMatchObject({
      kind: "income",
      category: "Кредиты и кредитки",
    });
  });

  it("долг — «Долги» по человеку", () => {
    expect(budgetHits(move("Карта", "Долги", 5000, "Ренат"), balance)[0]).toMatchObject({
      kind: "expense",
      category: "Долги",
      subcategory: "Ренат",
    });
  });

  it("между своими счетами в балансе — мимо планов", () => {
    expect(budgetHits(move("Карта", "Наличные"), balance)).toEqual([]);
  });

  it("счёт долгов в балансе — долги внутренние и в планы не идут", () => {
    const scope: BudgetScope = {
      accounts: new Set(),
      perimeterTransfers: false,
      zen: buildZenPlanRules(
        [acc("Карта"), acc("Долги", { type: "debt", inBalance: true })],
        zenPlanSettings({ planBalanceMode: "balance" }),
        CATEGORIES
      ),
    };
    expect(budgetHits(move("Карта", "Долги"), scope)).toEqual([]);
  });

  it("выключенная группа в «Доходы vs Расходы» не считается", () => {
    const scope = scopeFor({
      planBalanceMode: "excludeOpeningBalance",
      planSettings: ["excludeTransferToSavings"],
    });
    expect(budgetHits(move("Карта", "Вклад"), scope)).toEqual([]);
    expect(budgetHits(move("Вклад", "Карта"), scope)).toHaveLength(1);
  });

  it("операция по счёту вне баланса в бюджет не идёт", () => {
    expect(budgetHits(tx({ account: "Брокер", amountBase: 500 }), balance)).toEqual([]);
  });

  it("«Баланс vs Расходы»: возврат — поступление по категории", () => {
    expect(budgetHits(tx({ kind: "refund", category: "Еда", amountBase: 300 }), balance)).toEqual([
      { kind: "income", category: "Еда", subcategory: null, amount: 300 },
    ]);
  });

  it("«Доходы vs Расходы»: возврат вычитается из расхода", () => {
    const scope = scopeFor({ planBalanceMode: "excludeOpeningBalance" });
    expect(budgetHits(tx({ kind: "refund", category: "Еда", amountBase: 300 }), scope)[0]).toMatchObject({
      kind: "expense",
      category: "Еда",
    });
  });

  it("«Доходы vs Расходы»: трата в доходной категории вычитается из дохода", () => {
    const scope = scopeFor({ planBalanceMode: "excludeOpeningBalance" });
    expect(
      budgetHits(tx({ kind: "expense", category: "Работа", subcategory: "Премия", amountBase: 700 }), scope)
    ).toEqual([{ kind: "income", category: "Работа", subcategory: "Премия", amount: -700 }]);
  });

  it("своя настройка «Учитывать переводы» отключает правила приложения", () => {
    const scope = { ...balance, perimeterTransfers: true };
    expect(budgetHits(move("Карта", "Наличные"), scope)).toHaveLength(2);
  });

  it("подпись группы не совпадает с категорией пользователя", () => {
    const rules = buildZenPlanRules(
      ACCOUNTS,
      zenPlanSettings({ planBalanceMode: "balance" }),
      [...CATEGORIES, { key: "Накопления", showIncome: false, showOutcome: true }]
    );
    expect(rules.labels.to.savings).toBe("Накопления (переводы)");
  });
});

describe("openingBalance", () => {
  it("остаток к первому дню — назад от текущего, только счета в балансе", () => {
    const accounts = [
      { id: "a", inBalance: true, balance: 50_000, instrument: 1 },
      { id: "b", inBalance: false, balance: 1_000_000, instrument: 1 },
    ];
    const txs = [
      { date: "2026-10-05", income: 20_000, outcome: 0, incomeAccount: "a", outcomeAccount: "a" },
      { date: "2026-10-07", income: 0, outcome: 3_000, incomeAccount: "a", outcomeAccount: "a" },
      { date: "2026-09-30", income: 0, outcome: 9_999, incomeAccount: "a", outcomeAccount: "a" },
      { date: "2026-10-08", income: 0, outcome: 1, incomeAccount: "a", outcomeAccount: "a", deleted: true },
    ];
    expect(openingBalance(accounts, txs, "2026-10-01", (v) => v)).toBe(50_000 - 20_000 + 3_000);
  });
});

describe("planResidue", () => {
  it("как в приложении: без плана ноль, не меньше назначенного и нуля", () => {
    expect(planResidue(0, 500, 0)).toBe(0);
    expect(planResidue(10_000, 4_000, 0)).toBe(6_000);
    expect(planResidue(10_000, 12_000, 0)).toBe(0);
    expect(planResidue(10_000, 9_000, 3_000)).toBe(3_000);
  });
});

describe("monthResidues", () => {
  const row = (p: Partial<import("./zenPlanRules").ResidueRow>) => ({
    kind: "expense" as const,
    category: "Еда",
    subcategory: null,
    planned: 0,
    fact: 0,
    ahead: 0,
    ...p,
  });

  it("сумма остатков статей, перерасход одной не съедает другую", () => {
    const r = monthResidues([
      row({ category: "Еда", planned: 10_000, fact: 4_000 }),
      row({ category: "Кафе", planned: 5_000, fact: 9_000 }),
      row({ kind: "income", category: "Работа", planned: 100_000, fact: 40_000 }),
    ]);
    expect(r.expense).toBe(6_000);
    expect(r.income).toBe(60_000);
  });

  it("категория с замком: остаток — большее из своего и суммы подкатегорий", () => {
    // Ноябрь 2026: «Интернет-покупки» 2 000 с замком, «Подписки» 26 703.
    const r = monthResidues([
      row({ category: "Интернет", planned: 2_000, locked: true }),
      row({ category: "Интернет", subcategory: "Подписки", planned: 26_703 }),
    ]);
    expect(r.expense).toBe(26_703);
  });
});

describe("выдача кредита с удержанием — в поступлениях то, что пришло", () => {
  it("строка группы берёт сумму зачисления, а не списания с кредитного счёта", () => {
    const t = tx({
      kind: "transfer",
      outcomeAccount: "Ипотека",
      incomeAccount: "Карта",
      account: "Ипотека",
      outcomeAmount: 358_575,
      incomeAmount: 200_000,
      outcomeCurrency: "RUB",
      incomeCurrency: "RUB",
      amount: 358_575,
      amountBase: 358_575,
    });
    const hits = budgetHits(t, scopeFor({ planBalanceMode: "balance" }));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: "income", amount: 200_000, planGroup: true });
  });
});
