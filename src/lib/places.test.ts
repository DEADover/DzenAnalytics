import { describe, it, expect } from "vitest";
import { buildPlaceDossier, buildPlaceRows, placesForHalf, priceRisers, type PlaceRow } from "./places";
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

describe("priceRisers: где подорожало", () => {
  it("только рост больше 5 %, порядок по прибавке в рублях", () => {
    const list = priceRisers([
      row({ name: "Кофе", avgCheck: 280, prevAvgCheck: 200, visits: 3 }), // +40 %, +240 ₽
      row({ name: "Продукты", avgCheck: 2200, prevAvgCheck: 2000, visits: 4 }), // +10 %, +800 ₽
      row({ name: "Ровно", avgCheck: 1020, prevAvgCheck: 1000, visits: 9 }), // +2 %
      row({ name: "Дешевле", avgCheck: 900, prevAvgCheck: 1000, visits: 9 }),
      row({ name: "Новое", avgCheck: 900, visits: 9 }),
    ]);
    expect(list.map((r) => r.row.name)).toEqual(["Продукты", "Кофе"]);
    expect(list[1].growth).toBeCloseTo(0.4);
  });
});
