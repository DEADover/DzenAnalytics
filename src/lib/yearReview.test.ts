import { describe, it, expect } from "vitest";
import { buildYearReview, counterpartyOf, yearWindow } from "./yearReview";
import type { Transaction } from "../types";

let seq = 0;
function tx(p: Partial<Transaction>): Transaction {
  return {
    id: `t${++seq}`,
    date: "2026-01-15",
    amount: 100,
    amountBase: 100,
    currency: "RUB",
    kind: "expense",
    category: "Еда",
    subcategory: null,
    payee: "",
    comment: "",
    account: "Карта",
    ...(p as object),
  } as Transaction;
}

describe("yearWindow: отрезок, по которому есть чем мерить", () => {
  it("идущий год обрезается сегодняшним днём", () => {
    // История началась давно, значит слева отрезок упирается в 1 января.
    const w = yearWindow([tx({ date: "2024-06-01" })], 2026, "2026-08-25");
    expect(w.from).toBe("2026-01-01");
    expect(w.to).toBe("2026-08-25");
    expect(w.days).toBe(237);
  });

  it("прошедший год берётся целиком", () => {
    const w = yearWindow([tx({ date: "2024-03-01" })], 2025, "2026-08-25");
    expect(w.from).toBe("2025-01-01");
    expect(w.to).toBe("2025-12-31");
    expect(w.days).toBe(365);
  });

  it("до первой операции в истории учёта не было", () => {
    // Слева отрезок начинается там, где начались данные: январь без операций —
    // это «не вели учёт», а не «не тратили».
    const w = yearWindow([tx({ date: "2026-04-20" })], 2026, "2026-08-25");
    expect(w.from).toBe("2026-04-20");
    expect(w.days).toBe(128);
  });

  it("год целиком в будущем мерить нечем", () => {
    const w = yearWindow([tx({ date: "2026-01-10" })], 2027, "2026-08-25");
    expect(w.days).toBe(0);
  });
});

describe("серия без трат", () => {
  it("не досчитывает год до конца (issue Vitaly: 128 дней в августе)", () => {
    // Всё, что оставалось до Нового года, шло в «серию без трат»: 25 августа
    // это ровно 128 дней. Будущее — не перерыв в тратах.
    const txs = [
      tx({ date: "2026-01-05" }),
      tx({ date: "2026-08-25" }),
    ];
    const r = buildYearReview(txs, 2026, "2026-08-25");
    expect(r.longestStreak.days).toBeLessThan(240);
    // Настоящий перерыв здесь — между 6 января и 24 августа.
    expect(r.longestStreak.from).toBe("2026-01-06");
    expect(r.longestStreak.to).toBe("2026-08-24");
    expect(r.longestStreak.days).toBe(231);
  });

  it("тратили каждый день — серии нет", () => {
    const txs = [
      tx({ date: "2026-08-23" }),
      tx({ date: "2026-08-24" }),
      tx({ date: "2026-08-25" }),
    ];
    const r = buildYearReview(txs, 2026, "2026-08-25");
    expect(r.longestStreak.days).toBe(0);
    expect(r.daysWithExpense).toBe(3);
  });

  it("считает свежий перерыв до сегодняшнего дня", () => {
    // Последняя трата 20-го, сегодня 25-е: пять дней без трат — настоящие.
    const r = buildYearReview([tx({ date: "2026-08-20" })], 2026, "2026-08-25");
    expect(r.longestStreak.days).toBe(5);
    expect(r.longestStreak.from).toBe("2026-08-21");
    expect(r.longestStreak.to).toBe("2026-08-25");
  });

  it("доходы перерыв в тратах не прерывают", () => {
    const txs = [
      tx({ date: "2026-08-20" }),
      tx({ date: "2026-08-23", kind: "income", category: "Зарплата" }),
    ];
    const r = buildYearReview(txs, 2026, "2026-08-25");
    expect(r.longestStreak.days).toBe(5);
  });
});

describe("средний расход за день", () => {
  it("делится на дни отрезка, а не на 365", () => {
    // 237 дней с начала года по 25 августа: 23 700 ₽ — это ровно сотня в день.
    const r = buildYearReview(
      [tx({ date: "2024-01-01", amountBase: 1 }), tx({ date: "2026-03-01", amountBase: 23700 })],
      2026,
      "2026-08-25"
    );
    expect(r.window.days).toBe(237);
    expect(r.avgPerDay).toBeCloseTo(100, 6);
  });
});

describe("контрагенты вместо строк из выписки", () => {
  it("имя берётся из справочника, а не из банковской строки", () => {
    // «DOSTAVKA PYATEROCHKA» и «DOSTAVKA IZ PYATEROCHK» — две строки банка и
    // одна «Пятёрочка».
    const txs = [
      tx({ date: "2026-02-01", amountBase: 300, payee: "DOSTAVKA PYATEROCHKA", brand: "Пятёрочка" }),
      tx({ date: "2026-02-02", amountBase: 200, payee: "DOSTAVKA IZ PYATEROCHK", brand: "Пятёрочка" }),
    ];
    const r = buildYearReview(txs, 2026, "2026-08-25");
    expect(r.topPayees).toHaveLength(1);
    expect(r.topPayees[0]).toMatchObject({ name: "Пятёрочка", amount: 500, count: 2 });
    expect(r.uniqueMerchants).toBe(1);
  });

  it("без контрагента остаётся строка банка", () => {
    const r = buildYearReview(
      [tx({ date: "2026-02-01", amountBase: 100, payee: "KVARTPLATA.ONLINE" })],
      2026,
      "2026-08-25"
    );
    expect(r.topPayees[0].name).toBe("KVARTPLATA.ONLINE");
  });

  it("counterpartyOf: справочник важнее выписки", () => {
    expect(counterpartyOf(tx({ payee: "OZON.RU 1234", brand: "Озон" }))).toBe("Озон");
    expect(counterpartyOf(tx({ payee: "OZON.RU 1234" }))).toBe("OZON.RU 1234");
    expect(counterpartyOf(tx({ payee: "  ", brand: "  " }))).toBe("");
  });
});

describe("итоги года", () => {
  it("возвраты уменьшают расход, а не раздувают доход", () => {
    const txs = [
      tx({ date: "2026-02-01", amountBase: 1000, brand: "Озон" }),
      tx({ date: "2026-02-05", amountBase: 400, kind: "refund", brand: "Озон" }),
    ];
    const r = buildYearReview(txs, 2026, "2026-08-25");
    expect(r.totalExpense).toBe(600);
    expect(r.totalIncome).toBe(0);
    expect(r.topPayees[0].amount).toBe(600);
  });

  it("год без операций отдаёт пустой отчёт с живым отрезком", () => {
    const r = buildYearReview([tx({ date: "2025-05-05" })], 2026, "2026-08-25");
    expect(r.hasData).toBe(false);
    expect(r.longestStreak.days).toBe(0);
    expect(r.prev.available).toBe(true);
  });
});

describe("топы", () => {
  it("статьи дохода в «куда уходили деньги» не попадают", () => {
    // «Зарплата — 0 ₽, 0 %» занимала строку в списке расходов.
    const txs = [
      tx({ date: "2026-02-01", amountBase: 1000, category: "Продукты" }),
      tx({ date: "2026-02-02", amountBase: 90000, kind: "income", category: "Зарплата" }),
    ];
    const r = buildYearReview(txs, 2026, "2026-08-25");
    expect(r.topCategories.map((c) => c.name)).toEqual(["Продукты"]);
  });

  it("день недели подписан для фразы «тратили по …»", () => {
    // 2026-08-22 — суббота.
    const r = buildYearReview([tx({ date: "2026-08-22", amountBase: 500 })], 2026, "2026-08-25");
    expect(r.favoriteWeekday.name).toBe("Сб");
    expect(r.favoriteWeekday.dative).toBe("субботам");
  });
});
