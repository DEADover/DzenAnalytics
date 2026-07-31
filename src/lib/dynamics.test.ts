import { describe, it, expect } from "vitest";
import { buildDynamics, bucketKey, weekStart } from "./dynamics";
import type { Transaction } from "../types";

function tx(date: string, amountBase: number, kind: Transaction["kind"] = "expense"): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    date,
    category: "Еда",
    subcategory: null,
    categoryFull: "Еда",
    payee: "P",
    comment: "",
    outcomeAccount: "Карта",
    outcomeAmount: amountBase,
    outcomeCurrency: "RUB",
    incomeAccount: "",
    incomeAmount: 0,
    incomeCurrency: "RUB",
    kind,
    amount: amountBase,
    currency: "RUB",
    account: "Карта",
    amountBase,
    opAmount: null,
    opCurrency: null,
    createdAt: `${date}T00:00:00Z`,
  } as Transaction;
}

describe("Динамика — раскладка по интервалам", () => {
  it("неделя начинается с понедельника", () => {
    expect(weekStart("2026-07-30")).toBe("2026-07-27"); // чт → пн
    expect(weekStart("2026-07-27")).toBe("2026-07-27"); // сам пн
    expect(weekStart("2026-07-26")).toBe("2026-07-20"); // вс → пн прошлой
  });

  it("ключи дня / недели / месяца / года", () => {
    expect(bucketKey("2026-07-30", "day", 1)).toBe("2026-07-30");
    expect(bucketKey("2026-07-30", "week", 1)).toBe("2026-07-27");
    expect(bucketKey("2026-07-30", "month", 1)).toBe("2026-07-01");
    expect(bucketKey("2026-07-30", "year", 1)).toBe("2026");
  });

  it("месяц уважает свой первый день отчётного периода", () => {
    // Период с 11-го: 5 августа ещё относится к периоду, начавшемуся 11 июля.
    expect(bucketKey("2026-08-05", "month", 11)).toBe("2026-07-11");
    expect(bucketKey("2026-08-15", "month", 11)).toBe("2026-08-11");
  });
});

describe("Динамика — ряд значений", () => {
  it("пустые интервалы не пропускаются", () => {
    const r = buildDynamics([tx("2026-07-01", 100), tx("2026-07-04", 50)], "expense", "day");
    expect(r.points.map((p) => p.value)).toEqual([100, 0, 0, 50]);
    expect(r.points.map((p) => p.key)).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
    ]);
  });

  it("среднее считается по всем интервалам, включая пустые", () => {
    const r = buildDynamics([tx("2026-07-01", 100), tx("2026-07-04", 50)], "expense", "day");
    expect(r.total).toBe(150);
    expect(r.average).toBe(150 / 4); // 4 дня, а не 2 с операциями
  });

  it("период задаёт ось целиком, даже если операций в его краях нет", () => {
    const r = buildDynamics(
      [tx("2026-07-15", 100)],
      "expense",
      "day",
      1,
      { from: "2026-07-10", to: "2026-07-20" }
    );
    expect(r.points).toHaveLength(11);
    expect(r.points[0].key).toBe("2026-07-10");
    expect(r.points.at(-1)!.key).toBe("2026-07-20");
    expect(r.average).toBeCloseTo(100 / 11, 9);
  });

  it("расход: возврат уменьшает, доход не попадает", () => {
    const r = buildDynamics(
      [
        tx("2026-07-01", 300, "expense"),
        tx("2026-07-01", 100, "refund"),
        tx("2026-07-01", 5000, "income"),
      ],
      "expense",
      "day"
    );
    expect(r.total).toBe(200);
  });

  it("доход: считаются только поступления", () => {
    const r = buildDynamics(
      [tx("2026-07-01", 300, "expense"), tx("2026-07-01", 5000, "income")],
      "income",
      "day"
    );
    expect(r.total).toBe(5000);
  });

  it("чистый доход = доходы минус расходы", () => {
    const r = buildDynamics(
      [tx("2026-07-01", 5000, "income"), tx("2026-07-02", 2000, "expense")],
      "net",
      "day"
    );
    expect(r.points.map((p) => p.value)).toEqual([5000, -2000]);
    expect(r.total).toBe(3000);
  });

  it("переводы между своими счетами в отчёт не попадают", () => {
    const r = buildDynamics(
      [tx("2026-07-01", 5000, "transfer"), tx("2026-07-01", 100, "expense")],
      "net",
      "day"
    );
    expect(r.total).toBe(-100);
    expect(r.count).toBe(1);
  });

  it("баланс — накопительный итог, «Итого» это значение на конец", () => {
    const r = buildDynamics(
      [
        tx("2026-07-01", 5000, "income"),
        tx("2026-07-02", 2000, "expense"),
        tx("2026-07-03", 500, "expense"),
      ],
      "balance",
      "day"
    );
    expect(r.points.map((p) => p.value)).toEqual([5000, 3000, 2500]);
    expect(r.total).toBe(2500);
  });

  it("баланс тянет линию через пустые дни, а не обрывается", () => {
    const r = buildDynamics(
      [tx("2026-07-01", 1000, "income"), tx("2026-07-04", 400, "expense")],
      "balance",
      "day"
    );
    expect(r.points.map((p) => p.value)).toEqual([1000, 1000, 1000, 600]);
  });

  it("группировка по месяцам и годам", () => {
    const txs = [tx("2026-01-15", 100), tx("2026-01-20", 50), tx("2026-03-01", 30)];
    const byMonth = buildDynamics(txs, "expense", "month");
    expect(byMonth.points.map((p) => [p.key, p.value])).toEqual([
      ["2026-01-01", 150],
      ["2026-02-01", 0],
      ["2026-03-01", 30],
    ]);
    const byYear = buildDynamics(txs, "expense", "year");
    expect(byYear.points).toEqual([
      { key: "2026", label: "2026", fullLabel: "2026", value: 180 },
    ]);
  });

  it("в подписях есть год: на оси коротко, в подсказке полностью", () => {
    const byDay = buildDynamics([tx("2026-02-01", 10)], "expense", "day");
    expect(byDay.points[0].label).toBe("1 фев 26");
    expect(byDay.points[0].fullLabel).toBe("1 февраля 2026");

    const byWeek = buildDynamics([tx("2026-02-04", 10)], "expense", "week");
    expect(byWeek.points[0].label).toBe("2 фев 26");
    expect(byWeek.points[0].fullLabel).toBe("Неделя с 2 февраля 2026");

    const byMonth = buildDynamics([tx("2026-02-04", 10)], "expense", "month");
    expect(byMonth.points[0].fullLabel).toBe("Февраль 2026");
  });

  it("расход ниже нуля объясним: у интервала есть разбивка на траты и возвраты", () => {
    const r = buildDynamics(
      [
        tx("2026-07-03", 200, "expense"),
        tx("2026-07-03", 900, "refund"),
        tx("2026-07-04", 700, "expense"),
      ],
      "expense",
      "day"
    );
    const [minus, plain] = r.points;
    expect(minus.value).toBe(-700);
    expect(minus.gross).toBe(200);
    expect(minus.refunds).toBe(900);
    // Где возвратов не было, разбивку не показываем — лишний шум в подсказке.
    expect(plain.value).toBe(700);
    expect(plain.refunds).toBeUndefined();
  });

  it("пустой набор — пустой ряд, без падения и деления на ноль", () => {
    const r = buildDynamics([], "expense", "day");
    expect(r).toEqual({ points: [], total: 0, average: 0, count: 0, anchored: false });
  });
});

describe("Динамика — баланс это остаток, а не поток с нуля", () => {
  /** Операция с обеими ногами, как её отдаёт маппер Дзен-мани. */
  function op(
    date: string,
    amountBase: number,
    kind: Transaction["kind"],
    outAcc = "",
    inAcc = ""
  ): Transaction {
    const t = tx(date, amountBase, kind);
    return { ...t, outcomeAccount: outAcc, incomeAccount: inAcc, account: outAcc || inAcc };
  }

  const history = [
    op("2026-07-01", 5000, "income", "", "Карта"),
    op("2026-07-02", 2000, "expense", "Карта", ""),
  ];

  it("без реальных остатков кривая идёт от нуля и честно об этом говорит", () => {
    const r = buildDynamics(history, "balance", "day", 1, undefined, {
      all: history,
      accounts: null,
      realBalances: null,
    });
    expect(r.points.map((p) => p.value)).toEqual([5000, 3000]);
    expect(r.anchored).toBe(false);
  });

  it("с реальным остатком кривая поднимается до него — начальный остаток учтён", () => {
    // На счёте лежит 100 000, оборот за историю дал +3 000 → до истории было
    // 97 000, и вся кривая обязана начинаться оттуда, а не с нуля.
    const r = buildDynamics(history, "balance", "day", 1, undefined, {
      all: history,
      accounts: null,
      realBalances: { "Карта": 100000 },
    });
    expect(r.points.map((p) => p.value)).toEqual([102000, 100000]);
    expect(r.total).toBe(100000);
    expect(r.anchored).toBe(true);
  });

  it("остаток не уходит в минус у того, кто копил до начала данных", () => {
    // Ровно жалоба из issue: поток за историю отрицательный, а на счетах плюс.
    const spent = [
      op("2026-07-01", 400000, "expense", "Карта", ""),
      op("2026-07-02", 35349, "expense", "Карта", ""),
    ];
    const r = buildDynamics(spent, "balance", "day", 1, undefined, {
      all: spent,
      accounts: null,
      realBalances: { "Карта": 3644786 },
    });
    expect(r.points.every((p) => p.value > 0)).toBe(true);
    expect(r.total).toBe(3644786);
  });

  it("перевод между своими счетами остаток не меняет, а из выбранных — меняет", () => {
    const moved = [op("2026-07-01", 1000, "transfer", "Карта", "Вклад")];
    const both = buildDynamics(moved, "balance", "day", 1, undefined, {
      all: moved,
      accounts: null,
      realBalances: null,
    });
    expect(both.points.map((p) => p.value)).toEqual([0]);

    const onlyCard = buildDynamics(moved, "balance", "day", 1, undefined, {
      all: moved,
      accounts: new Set(["Карта"]),
      realBalances: null,
    });
    expect(onlyCard.points.map((p) => p.value)).toEqual([-1000]);
  });

  it("остаток на начало периода не обнуляется — история до него учтена", () => {
    const long = [
      op("2026-01-10", 50000, "income", "", "Карта"),
      op("2026-07-15", 2000, "expense", "Карта", ""),
    ];
    const r = buildDynamics(long, "balance", "day", 1, { from: "2026-07-14", to: "2026-07-16" }, {
      all: long,
      accounts: null,
      realBalances: null,
    });
    expect(r.points.map((p) => [p.key, p.value])).toEqual([
      ["2026-07-14", 50000],
      ["2026-07-15", 48000],
      ["2026-07-16", 48000],
    ]);
  });

  it("операция с пустой ногой счёта не выпадает из остатка", () => {
    // Небрежный CSV: у дохода не заполнен incomeAccount, есть только account.
    const sloppy = [{ ...tx("2026-07-01", 700, "income"), incomeAccount: "", account: "Карта" }];
    const r = buildDynamics(sloppy, "balance", "day", 1, undefined, {
      all: sloppy,
      accounts: null,
      realBalances: null,
    });
    expect(r.points.map((p) => p.value)).toEqual([700]);
  });
});
