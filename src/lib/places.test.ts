import { describe, it, expect } from "vitest";
import { buildPlaceDossier, buildPlaceRows, placesForHalf, priceChanges, type PlaceRow } from "./places";
import type { Transaction } from "../types";

let seq = 0;
function tx(p: Partial<Transaction>): Transaction {
  return {
    id: `t${++seq}`,
    date: "2026-09-15",
    amount: 100,
    amountBase: 100,
    currency: "RUB",
    kind: "expense",
    category: "Еда",
    subcategory: null,
    categoryFull: "Еда",
    payee: "",
    comment: "",
    account: "Карта",
    ...(p as object),
  } as Transaction;
}

const SEPT = { from: "2026-09-01", to: "2026-09-30" };

describe("buildPlaceRows: места за период", () => {
  it("одно место по справочнику, возврат гасит сумму, но не визит и не чек", () => {
    const rows = buildPlaceRows(
      [
        tx({ brand: "Ёлочка", payee: "DOSTAVKA YOLOCHKA", amountBase: 1000 }),
        tx({ brand: "Ёлочка", payee: "DOSTAVKA IZ YOLOCHKI", amountBase: 500 }),
        tx({ brand: "Ёлочка", kind: "refund", amountBase: 300 }),
      ],
      SEPT
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Ёлочка", total: 1200, visits: 2, avgCheck: 750 });
  });

  it("операции без контрагента и доходы в список не попадают", () => {
    const rows = buildPlaceRows([tx({ payee: "" }), tx({ payee: "Работа", kind: "income" })], SEPT);
    expect(rows).toEqual([]);
  });

  it("новое место — первая покупка за всю историю в периоде", () => {
    const rows = buildPlaceRows(
      [
        tx({ payee: "Старое", date: "2026-03-01" }),
        tx({ payee: "Старое", date: "2026-09-10" }),
        tx({ payee: "Новое", date: "2026-09-12" }),
      ],
      SEPT
    );
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by["Новое"].isNew).toBe(true);
    expect(by["Старое"].isNew).toBe(false);
    expect(by["Старое"].firstDate).toBe("2026-03-01");
  });

  it("за всю историю новых мест не бывает", () => {
    const rows = buildPlaceRows([tx({ payee: "Кафе" })], { from: null, to: null });
    expect(rows[0].isNew).toBe(false);
  });

  it("чек сравнивается с годом до периода, только когда покупок хватает с обеих сторон", () => {
    const before = [1, 2, 3].map((i) => tx({ payee: "Кафе", date: `2026-0${i + 2}-10`, amountBase: 400 }));
    const now = [1, 2, 3].map((i) => tx({ payee: "Кафе", date: `2026-09-0${i}`, amountBase: 500 }));
    expect(buildPlaceRows([...before, ...now], SEPT)[0].prevAvgCheck).toBe(400);
    expect(buildPlaceRows([...before.slice(0, 2), ...now], SEPT)[0].prevAvgCheck).toBeUndefined();
  });
});

describe("buildPlaceDossier: досье места", () => {
  it("частота, любимый день, статьи и двенадцать месяцев", () => {
    // Каждую субботу августа и сентября.
    const sats = ["2026-08-01", "2026-08-08", "2026-08-15", "2026-08-22", "2026-08-29", "2026-09-05"];
    const d = buildPlaceDossier(
      [
        ...sats.map((date) => tx({ payee: "Рынок", date, amountBase: 1000, categoryFull: "Еда / Продукты" })),
        tx({ payee: "Рынок", date: "2026-09-06", amountBase: 200, categoryFull: "Цветы" }),
        tx({ payee: "Другое", date: "2026-09-06" }),
      ],
      "Рынок",
      "2026-09-30"
    )!;
    expect(d.visits).toBe(7);
    expect(d.total).toBe(6200);
    expect(d.everyDays).toBe(7);
    expect(d.favWeekday).toBe(5);
    expect(d.categories.map((c) => c.name)).toEqual(["Еда / Продукты", "Цветы"]);
    expect(d.months).toHaveLength(12);
    expect(d.months[11]).toMatchObject({ ym: "2026-09", expense: 1200, visits: 2 });
    expect(d.months[0].ym).toBe("2025-10");
    expect(d.biggest).toMatchObject({ date: "2026-08-01", amount: 1000 });
  });

  it("месяцы считаются по своему первому дню", () => {
    const d = buildPlaceDossier([tx({ payee: "Кафе", date: "2026-09-05" })], "Кафе", "2026-09-30", 10)!;
    // 5 сентября при дне 10 — ещё августовский период.
    expect(d.months.find((m) => m.ym === "2026-08")?.expense).toBe(100);
  });

  it("место без покупок — нет досье", () => {
    expect(buildPlaceDossier([tx({ payee: "Кафе", kind: "refund" })], "Кафе", "2026-09-30")).toBeNull();
  });
});

describe("досье: дни недели, год к году, доля в статье, чек по месяцам", () => {
  it("считает всё по истории", () => {
    const d = buildPlaceDossier(
      [
        tx({ payee: "Рынок", date: "2026-09-05", amountBase: 300, categoryFull: "Еда" }), // сб
        tx({ payee: "Рынок", date: "2026-09-12", amountBase: 100, categoryFull: "Еда" }), // сб
        tx({ payee: "Рынок", date: "2025-06-01", amountBase: 200, categoryFull: "Еда" }), // вс, год назад
        tx({ payee: "Магазин", date: "2026-09-10", amountBase: 600, categoryFull: "Еда" }),
      ],
      "Рынок",
      "2026-09-30"
    )!;
    expect(d.weekdays.map((w) => w.visits)).toEqual([0, 0, 0, 0, 0, 2, 1]);
    expect(d.weekdays[5]).toEqual({ expense: 400, visits: 2, avgCheck: 200 });
    expect(d.yearOverYear).toEqual({ last: 400, prev: 200 });
    // Еды всего 1200, из них на рынке 600.
    expect(d.categoryShare).toBe(0.5);
    expect(d.months[11]).toMatchObject({ visits: 2, avgCheck: 200 });
  });
});

const row = (p: Partial<PlaceRow>): PlaceRow =>
  ({ name: "x", total: 0, visits: 1, avgCheck: 0, category: "", firstDate: "", lastDate: "", isNew: false, ...p }) as PlaceRow;

describe("placesForHalf: сколько мест набирают половину трат", () => {
  it("по убыванию суммы", () => {
    expect(placesForHalf([row({ total: 10 }), row({ total: 60 }), row({ total: 30 })])).toBe(1);
    expect(placesForHalf([row({ total: 40 }), row({ total: 35 }), row({ total: 25 })])).toBe(2);
    expect(placesForHalf([])).toBe(0);
  });
});

describe("priceChanges: где подорожало и подешевело", () => {
  const rows = [
    row({ name: "Кофе", avgCheck: 280, prevAvgCheck: 200, visits: 3 }), // +40 %, +240 ₽
    row({ name: "Продукты", avgCheck: 2200, prevAvgCheck: 2000, visits: 4 }), // +10 %, +800 ₽
    row({ name: "Ровно", avgCheck: 1020, prevAvgCheck: 1000, visits: 9 }), // +2 %
    row({ name: "Такси", avgCheck: 400, prevAvgCheck: 500, visits: 10 }), // −20 %, −1000 ₽
    row({ name: "Аптека", avgCheck: 600, prevAvgCheck: 1000, visits: 2 }), // −40 %, −800 ₽
    row({ name: "Новое", avgCheck: 900, visits: 9 }),
  ];
  it("подорожало: рост больше 5 %, порядок по прибавке в рублях", () => {
    const up = priceChanges(rows, "up");
    expect(up.map((r) => r.row.name)).toEqual(["Продукты", "Кофе"]);
    expect(up[1].growth).toBeCloseTo(0.4);
  });
  it("подешевело: падение больше 5 %, порядок по экономии в рублях", () => {
    const down = priceChanges(rows, "down");
    expect(down.map((r) => r.row.name)).toEqual(["Такси", "Аптека"]);
    expect(down[0].growth).toBeCloseTo(-0.2);
  });
});

describe("крайние случаи", () => {
  it("контрагент с одними возвратами или вернувший всё — не в списке и без досье", () => {
    const rows = buildPlaceRows(
      [
        tx({ payee: "Возвраты", kind: "refund" }),
        tx({ payee: "Вернул", amountBase: 500 }),
        tx({ payee: "Вернул", kind: "refund", amountBase: 500 }),
      ],
      SEPT
    );
    expect(rows).toEqual([]);
    expect(buildPlaceDossier([tx({ payee: "Возвраты", kind: "refund" })], "Возвраты", "2026-09-30")).toBeNull();
  });

  it("суммы — в базовой валюте, бренд важнее строки банка", () => {
    const rows = buildPlaceRows(
      [
        tx({ payee: "AMAZON*1", brand: "Amazon", amount: 10, currency: "USD", amountBase: 900 }),
        tx({ payee: "AMAZON*2", brand: "Amazon", amount: 20, currency: "USD", amountBase: 1800 }),
      ],
      SEPT
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Amazon", total: 2700, avgCheck: 1350 });
  });

  it("возврат до первой покупки не делает контрагента «старым»", () => {
    const rows = buildPlaceRows(
      [tx({ payee: "Кафе", kind: "refund", date: "2026-03-01" }), tx({ payee: "Кафе", date: "2026-09-10" })],
      SEPT
    );
    expect(rows[0]).toMatchObject({ isNew: true, firstDate: "2026-09-10" });
  });

  it("год до периода — ровно 365 дней перед его началом", () => {
    const at = (date: string) => tx({ payee: "Кафе", date, amountBase: 100 });
    const now = [1, 2, 3].map((d) => tx({ payee: "Кафе", date: `2026-09-0${d}`, amountBase: 200 }));
    // 2025-09-01 — первый день окна, 2025-08-31 — уже за ним.
    const inside = buildPlaceRows([at("2025-09-01"), at("2026-01-10"), at("2026-08-31"), ...now], SEPT)[0];
    expect(inside.prevAvgCheck).toBe(100);
    const outside = buildPlaceRows([at("2025-08-31"), at("2026-01-10"), at("2026-08-31"), ...now], SEPT)[0];
    expect(outside.prevAvgCheck).toBeUndefined();
  });

  it("несколько операций в один день — одна точка частоты", () => {
    const same = [1, 2, 3, 4, 5].map(() => tx({ payee: "Кафе", date: "2026-09-10" }));
    const d = buildPlaceDossier(same, "Кафе", "2026-09-30")!;
    expect(d.everyDays).toBeNull();
    // Все пять — в четверг: день выделяется.
    expect(d.favWeekday).toBe(3);
    expect(d.favWeekdayShare).toBe(1);
  });

  it("доля в категории учитывает возвраты и чужие операции", () => {
    const d = buildPlaceDossier(
      [
        tx({ payee: "Аптека", amountBase: 1000, categoryFull: "Здоровье" }),
        tx({ payee: "Аптека", kind: "refund", amountBase: 200, categoryFull: "Здоровье" }),
        tx({ payee: "", amountBase: 800, categoryFull: "Здоровье" }),
      ],
      "Аптека",
      "2026-09-30"
    )!;
    expect(d.categoryShare).toBe(0.5);
  });

  it("год к году: границы окон", () => {
    const d = buildPlaceDossier(
      [
        tx({ payee: "Кафе", date: "2025-10-01", amountBase: 10 }), // первый день последних 12 месяцев
        tx({ payee: "Кафе", date: "2025-09-30", amountBase: 20 }), // уже предыдущие
        tx({ payee: "Кафе", date: "2024-10-01", amountBase: 40 }), // первый день предыдущих
        tx({ payee: "Кафе", date: "2024-09-30", amountBase: 80 }), // вне обоих
      ],
      "Кафе",
      "2026-09-30"
    )!;
    expect(d.yearOverYear).toEqual({ last: 10, prev: 60 });
  });

  it("сравнение чека не ломается на нулевом прошлом чеке", () => {
    expect(priceChanges([row({ avgCheck: 100, prevAvgCheck: 0, visits: 3 })], "up")).toEqual([]);
  });

  it("половина трат при равных суммах", () => {
    expect(placesForHalf([row({ total: 1 }), row({ total: 1 }), row({ total: 1 }), row({ total: 1 })])).toBe(2);
  });
});
