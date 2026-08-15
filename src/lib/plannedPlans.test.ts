import { describe, it, expect } from "vitest";
import { plannedPlans } from "./plannedPlans";
import { ALL_ACCOUNTS } from "./budgetScope";
import type { PlannedOp } from "./plannedOps";

let seq = 0;
function op(p: Partial<PlannedOp>): PlannedOp {
  return {
    id: `p${++seq}`,
    reminder: "r1",
    repeating: true,
    date: "2026-08-20",
    kind: "expense",
    amountBase: 1000,
    account: "Карта",
    toAccount: null,
    payee: "",
    comment: "",
    category: "Дети",
    forecast: false,
    ...p,
  };
}

describe("plannedPlans", () => {
  it("сводит назначенные операции в план статьи по месяцам", () => {
    const r = plannedPlans(
      [
        op({ amountBase: 12_000, category: "Дети", date: "2026-08-20" }),
        op({ amountBase: 3000, category: "Дети", date: "2026-08-25" }),
        op({ amountBase: 12_000, category: "Дети", date: "2026-09-20" }),
      ],
      ALL_ACCOUNTS
    );
    expect(r.find((x) => x.ym === "2026-08")).toMatchObject({
      kind: "expense",
      category: "Дети",
      subcategory: null,
      amount: 15_000,
    });
    expect(r.find((x) => x.ym === "2026-09")).toMatchObject({ amount: 12_000 });
  });

  it("полное имя разбирается на категорию и подкатегорию", () => {
    const r = plannedPlans([op({ category: "Дети / Садик", amountBase: 12_000 })], ALL_ACCOUNTS);
    expect(r[0]).toMatchObject({ category: "Дети", subcategory: "Садик" });
  });

  it("прогноз Дзена планом не считается — это догадка, а не назначенная дата", () => {
    expect(plannedPlans([op({ forecast: true })], ALL_ACCOUNTS)).toEqual([]);
  });

  it("переводы и операции без категории пропускаются", () => {
    const r = plannedPlans(
      [op({ kind: "transfer", category: "Карта → Вклад" }), op({ category: "" })],
      ALL_ACCOUNTS
    );
    expect(r).toEqual([]);
  });

  it("периметр счетов действует и на планы", () => {
    const ops = [
      op({ account: "Карта", amountBase: 1000 }),
      op({ account: "Чужой", amountBase: 5000 }),
    ];
    const scope = { accounts: new Set(["Карта"]), perimeterTransfers: false };
    const r = plannedPlans(ops, scope);
    expect(r).toHaveLength(1);
    expect(r[0].amount).toBe(1000);
  });

  it("доходы и расходы под одним тегом не смешиваются", () => {
    const r = plannedPlans(
      [
        op({ kind: "expense", category: "Банки", amountBase: 100 }),
        op({ kind: "income", category: "Банки", amountBase: 900 }),
      ],
      ALL_ACCOUNTS
    );
    expect(r).toHaveLength(2);
    expect(r.find((x) => x.kind === "income")?.amount).toBe(900);
  });
});

describe("plannedPlans — «ещё в плане»", () => {
  // Дзен-мани делит остаток на «Ещё в плане» (назначенные операции впереди) и
  // «Ещё можно потратить». Исполненная назначенная операция уже стала тратой —
  // в «ещё впереди» её быть не должно, иначе остаток уедет вдвое.
  const ops = [
    op({ date: "2026-08-03", amountBase: 300 }),
    op({ date: "2026-08-17", amountBase: 9800 }),
    op({ date: "2026-08-23", amountBase: 1690 }),
  ];

  it("впереди — только операции с сегодняшнего дня", () => {
    const r = plannedPlans(ops, ALL_ACCOUNTS, "2026-08-15");
    expect(r[0].amount).toBe(11_790);
    expect(r[0].ahead).toBe(11_490);
    expect(r[0].aheadOps.map((x) => x.date)).toEqual(["2026-08-17", "2026-08-23"]);
  });

  it("операция сегодняшним днём ещё впереди — она могла не исполниться", () => {
    const r = plannedPlans(ops, ALL_ACCOUNTS, "2026-08-17");
    expect(r[0].ahead).toBe(11_490);
  });

  it("без даты впереди считается всё — так нужно будущим месяцам", () => {
    const r = plannedPlans(ops, ALL_ACCOUNTS);
    expect(r[0].ahead).toBe(11_790);
    expect(r[0].aheadOps).toHaveLength(3);
  });
});
