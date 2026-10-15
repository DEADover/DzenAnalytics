import { describe, it, expect } from "vitest";
import { buildPlaceDossier, buildPlaceRows, findLostPlaces } from "./places";
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

describe("findLostPlaces: куда перестали ходить", () => {
  const regular = ["2026-04-05", "2026-05-05", "2026-06-05", "2026-07-05"].map((date) =>
    tx({ payee: "Бассейн", date, amountBase: 3000 })
  );

  it("регулярное место без покупок в периоде", () => {
    const lost = findLostPlaces(regular, SEPT, "2026-09-30");
    expect(lost).toHaveLength(1);
    expect(lost[0]).toMatchObject({ name: "Бассейн", visitsBefore: 4, lastDate: "2026-07-05" });
  });

  it("покупка в периоде — не пропало", () => {
    expect(findLostPlaces([...regular, tx({ payee: "Бассейн", date: "2026-09-20" })], SEPT, "2026-09-30")).toEqual([]);
  });

  it("пауза короче привычной — рано говорить", () => {
    // Ходили раз в месяц, период только начался: с 5 августа прошло 36 дней.
    const monthly = ["2026-05-05", "2026-06-05", "2026-07-05", "2026-08-05"].map((date) =>
      tx({ payee: "Бассейн", date })
    );
    expect(findLostPlaces(monthly, SEPT, "2026-09-10")).toEqual([]);
  });

  it("три покупки за одну неделю — не привычка", () => {
    const burst = ["2026-06-01", "2026-06-03", "2026-06-05"].map((date) => tx({ payee: "Стройка", date }));
    expect(findLostPlaces(burst, SEPT, "2026-09-30")).toEqual([]);
  });

  it("без начала периода сравнивать не с чем", () => {
    expect(findLostPlaces(regular, { from: null, to: null }, "2026-09-30")).toEqual([]);
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
