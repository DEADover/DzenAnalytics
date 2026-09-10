import { describe, it, expect } from "vitest";
import {
  allowanceRatio,
  dailyAllowance,
  freeBreakdown,
  plannedSums,
  spendableAccounts,
  type PlannedLeg,
  type SpendableAccount,
} from "./freeMoney";

const acc = (p: Partial<SpendableAccount> & { title: string }): SpendableAccount => ({
  balanceBase: 0,
  type: "ccard",
  savings: false,
  archive: false,
  offBalance: false,
  ...p,
});

describe("spendableAccounts", () => {
  it("берёт карты, наличные и обычные счета", () => {
    const list = [
      acc({ title: "Карта", type: "ccard" }),
      acc({ title: "Наличные", type: "cash" }),
      acc({ title: "Счёт", type: "checking" }),
    ];
    expect(spendableAccounts(list).map((a) => a.title)).toEqual([
      "Карта",
      "Наличные",
      "Счёт",
    ]);
  });

  it("не берёт накопительные и вклады", () => {
    // Деньги там есть, но тратить их сегодня не предполагается: со вкладом
    // «свободные» вырастают в разы и перестают отвечать на свой вопрос.
    const list = [
      acc({ title: "Нак. счёт", type: "checking", savings: true }),
      acc({ title: "Вклад", type: "deposit", savings: true }),
    ];
    expect(spendableAccounts(list)).toEqual([]);
  });

  it("не берёт долговые: там задолженность, а не остаток", () => {
    const list = [
      acc({ title: "Кредит", type: "loan" }),
      acc({ title: "Долги", type: "debt" }),
      acc({ title: "Кредитка банка", type: "credit" }),
    ];
    expect(spendableAccounts(list)).toEqual([]);
  });

  it("не берёт архивные и внебалансовые", () => {
    const list = [
      acc({ title: "Старая", archive: true }),
      acc({ title: "Брокерский", offBalance: true }),
    ];
    expect(spendableAccounts(list)).toEqual([]);
  });

  it("минус на кредитной карте остаётся в расчёте", () => {
    // Это настоящие потраченные деньги, которые придётся вернуть.
    const list = [acc({ title: "Кредитка", type: "ccard", balanceBase: -12000 })];
    expect(spendableAccounts(list)[0].balanceBase).toBe(-12000);
  });
});

describe("plannedSums", () => {
  const leg = (p: Partial<PlannedLeg> & { date: string }): PlannedLeg => ({
    kind: "expense",
    amountBase: 1000,
    account: "Карта",
    forecast: false,
    ...p,
  });
  const mine = new Set(["Карта", "Наличные"]);

  it("складывает расходы и доходы до конца периода", () => {
    const out = plannedSums(
      [
        leg({ date: "2026-09-15" }),
        leg({ date: "2026-09-20", kind: "income", amountBase: 90000 }),
      ],
      "2026-09-30",
      "2026-09-10",
      mine
    );
    expect(out).toEqual({ income: 90000, expense: 1000, overdueExpense: 0 });
  });

  it("не берёт прогнозы — это догадка, а не обещание", () => {
    const out = plannedSums(
      [leg({ date: "2026-09-15", forecast: true })],
      "2026-09-30",
      "2026-09-10",
      mine
    );
    expect(out.expense).toBe(0);
  });

  it("берёт просроченное и считает его отдельно", () => {
    // Дата прошла, платёж не проведён — деньги всё ещё нужны.
    const out = plannedSums(
      [leg({ date: "2026-09-05", amountBase: 4000 })],
      "2026-09-30",
      "2026-09-10",
      mine
    );
    expect(out).toEqual({ income: 0, expense: 4000, overdueExpense: 4000 });
  });

  it("не берёт то, что за границей периода", () => {
    const out = plannedSums(
      [leg({ date: "2026-10-01" })],
      "2026-09-30",
      "2026-09-10",
      mine
    );
    expect(out.expense).toBe(0);
  });

  it("не берёт переводы: между своими счетами деньги не тратятся", () => {
    const out = plannedSums(
      [leg({ date: "2026-09-15", kind: "transfer" })],
      "2026-09-30",
      "2026-09-10",
      mine
    );
    expect(out.expense).toBe(0);
  });

  it("не берёт планы на неучитываемых счетах", () => {
    // Остаток вклада в сумму не входит, значит и списание с него ничего в ней
    // не меняет.
    const out = plannedSums(
      [leg({ date: "2026-09-15", account: "Вклад" })],
      "2026-09-30",
      "2026-09-10",
      mine
    );
    expect(out.expense).toBe(0);
  });
});

describe("freeBreakdown", () => {
  const planned = { income: 90000, expense: 30000, overdueExpense: 0 };

  it("остаток на счетах плюс планы минус резерв", () => {
    const out = freeBreakdown({ onAccounts: 50000, planned, reserve: 10000 });
    expect(out.free).toBe(100000);
  });

  it("отрицательный резерв не увеличивает свободные", () => {
    const out = freeBreakdown({ onAccounts: 50000, planned, reserve: -5000 });
    expect(out.reserve).toBe(0);
    expect(out.free).toBe(110000);
  });

  it("свободные бывают отрицательными — это и есть ответ", () => {
    const out = freeBreakdown({
      onAccounts: 1000,
      planned: { income: 0, expense: 30000, overdueExpense: 0 },
      reserve: 0,
    });
    expect(out.free).toBe(-29000);
  });
});

describe("dailyAllowance — ежедневный метод", () => {
  it("делит остаток на оставшиеся дни, сегодня считая оставшимся", () => {
    const a = dailyAllowance({
      method: "daily",
      free: 21000,
      daysTotal: 30,
      dayIndex: 10,
      spent: 999999,
    });
    // 30 − 10 + 1 = 21 день впереди.
    expect(a.perDay).toBe(1000);
    expect(a.today).toBe(1000);
  });

  it("потраченное на ответ не влияет — оно уже в остатке на счетах", () => {
    const base = { method: "daily" as const, free: 21000, daysTotal: 30, dayIndex: 10 };
    expect(dailyAllowance({ ...base, spent: 0 }).today).toBe(
      dailyAllowance({ ...base, spent: 500000 }).today
    );
  });

  it("копить нечего, поэтому переноса нет", () => {
    const a = dailyAllowance({
      method: "daily",
      free: 1000,
      daysTotal: 10,
      dayIndex: 1,
      spent: 0,
    });
    expect(a.carried).toBeNull();
  });

  it("в последний день доступен весь остаток", () => {
    const a = dailyAllowance({
      method: "daily",
      free: 5000,
      daysTotal: 30,
      dayIndex: 30,
      spent: 0,
    });
    expect(a.today).toBe(5000);
  });
});

describe("dailyAllowance — накопительный метод", () => {
  it("лимит считается от бюджета всего периода", () => {
    // Бюджет = свободные сейчас (25 000) + уже потраченное (5 000) = 30 000.
    const a = dailyAllowance({
      method: "cumulative",
      free: 25000,
      daysTotal: 30,
      dayIndex: 10,
      spent: 5000,
    });
    expect(a.perDay).toBe(1000);
    // За десять дней накопилось 10 000, из них потрачено 5 000.
    expect(a.today).toBe(5000);
    expect(a.carried).toBe(4000);
  });

  it("непотраченное переносится: три пустых дня дают четверной лимит", () => {
    const a = dailyAllowance({
      method: "cumulative",
      free: 30000,
      daysTotal: 30,
      dayIndex: 4,
      spent: 0,
    });
    expect(a.perDay).toBe(1000);
    expect(a.today).toBe(4000);
  });

  it("перерасход показан отрицательным, а не нулём", () => {
    // Соврать «ещё немного осталось» здесь хуже, чем сказать про минус.
    const a = dailyAllowance({
      method: "cumulative",
      free: 10000,
      daysTotal: 30,
      dayIndex: 2,
      spent: 20000,
    });
    expect(a.today).toBeLessThan(0);
    expect(a.carried).toBeLessThan(0);
  });

  it("в последний день доступен ровно остаток", () => {
    // Иначе метод обещал бы больше, чем есть на счетах.
    const a = dailyAllowance({
      method: "cumulative",
      free: 7000,
      daysTotal: 30,
      dayIndex: 30,
      spent: 23000,
    });
    expect(a.today).toBeCloseTo(7000, 6);
  });

  it("зарплата среди периода поднимает бюджет, а не растворяется", () => {
    // На начало периода не было ничего, на пятый день пришло 30 000.
    const a = dailyAllowance({
      method: "cumulative",
      free: 30000,
      daysTotal: 30,
      dayIndex: 10,
      spent: 0,
    });
    expect(a.perDay).toBe(1000);
    expect(a.today).toBe(10000);
  });
});

describe("dailyAllowance — границы", () => {
  it("день за пределами периода прижимается к его краям", () => {
    const a = dailyAllowance({
      method: "cumulative",
      free: 3000,
      daysTotal: 30,
      dayIndex: 99,
      spent: 0,
    });
    expect(a.today).toBeCloseTo(3000, 6);
  });

  it("нулевая длина периода не роняет расчёт", () => {
    const a = dailyAllowance({
      method: "daily",
      free: 1000,
      daysTotal: 0,
      dayIndex: 0,
      spent: 0,
    });
    expect(Number.isFinite(a.today)).toBe(true);
    expect(a.today).toBe(1000);
  });
});

describe("allowanceRatio", () => {
  it("половина дневного лимита — половина кольца", () => {
    expect(allowanceRatio({ perDay: 1000, today: 500, carried: null })).toBe(0.5);
  });

  it("накопленный запас не выкручивает кольцо за единицу", () => {
    expect(allowanceRatio({ perDay: 1000, today: 4000, carried: 3000 })).toBe(1);
  });

  it("перерасход — пустое кольцо, а не отрицательная дуга", () => {
    expect(allowanceRatio({ perDay: 1000, today: -2000, carried: -3000 })).toBe(0);
  });

  it("нулевой лимит не даёт делить на ноль", () => {
    expect(allowanceRatio({ perDay: 0, today: 0, carried: null })).toBe(0);
  });
});
