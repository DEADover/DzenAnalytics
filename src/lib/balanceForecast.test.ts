import { describe, it, expect } from "vitest";
import { balanceForecast, planDelta, type ForecastOp } from "./balanceForecast";

const op = (o: Partial<ForecastOp> & Pick<ForecastOp, "date" | "kind" | "amountBase">): ForecastOp => ({
  toAmountBase: null,
  account: "Т-Банк",
  toAccount: null,
  title: "План",
  ...o,
});

const all = () => true;
const only = (...titles: string[]) => (a: string) => titles.includes(a);

describe("planDelta", () => {
  it("расход и доход — по своему счёту", () => {
    expect(planDelta(op({ date: "2026-10-20", kind: "expense", amountBase: 500 }), all)).toBe(-500);
    expect(planDelta(op({ date: "2026-10-20", kind: "income", amountBase: 900 }), all)).toBe(900);
    expect(planDelta(op({ date: "2026-10-20", kind: "expense", amountBase: 500 }), only("Сбер"))).toBe(0);
  });

  it("перевод — по обеим сторонам, между выбранными ничего не меняет", () => {
    const t = op({ date: "2026-10-20", kind: "transfer", amountBase: 1000, toAccount: "Вклад", toAmountBase: 990 });
    expect(planDelta(t, all)).toBe(-10);
    expect(planDelta(t, only("Т-Банк"))).toBe(-1000);
    expect(planDelta(t, only("Вклад"))).toBe(990);
  });
});

describe("balanceForecast", () => {
  it("ступеньки на днях планов и хвост до конца периода", () => {
    const pts = balanceForecast(
      10_000,
      [
        op({ date: "2026-10-20", kind: "expense", amountBase: 3_000, title: "Фитнес" }),
        op({ date: "2026-10-25", kind: "income", amountBase: 5_000, title: "Аванс" }),
        op({ date: "2026-10-20", kind: "expense", amountBase: 500, title: "Кино" }),
      ],
      all,
      "2026-10-15",
      "2026-10-31"
    );
    expect(pts.map((p) => [p.date, p.forecast])).toEqual([
      ["2026-10-15", 10_000],
      ["2026-10-20", 6_500],
      ["2026-10-25", 11_500],
      ["2026-10-31", 11_500],
    ]);
    expect(pts[1].ops.map((o) => o.title)).toEqual(["Фитнес", "Кино"]);
  });

  it("просроченные и за пределами периода не считаются", () => {
    const pts = balanceForecast(
      1_000,
      [
        op({ date: "2026-10-12", kind: "expense", amountBase: 300 }),
        op({ date: "2026-11-02", kind: "expense", amountBase: 300 }),
      ],
      all,
      "2026-10-15",
      "2026-10-31"
    );
    expect(pts).toEqual([]);
  });

  it("план на сегодня ложится на ближайшую точку", () => {
    const pts = balanceForecast(
      1_000,
      [
        op({ date: "2026-10-15", kind: "expense", amountBase: 100, title: "Сегодня" }),
        op({ date: "2026-10-18", kind: "expense", amountBase: 200, title: "Позже" }),
      ],
      all,
      "2026-10-15",
      "2026-10-31"
    );
    expect(pts.slice(0, 2).map((p) => [p.date, p.forecast])).toEqual([
      ["2026-10-15", 1_000],
      ["2026-10-18", 700],
    ]);
    const alone = balanceForecast(1_000, [op({ date: "2026-10-15", kind: "expense", amountBase: 100 })], all, "2026-10-15", "2026-10-31");
    expect(alone.map((p) => [p.date, p.forecast])).toEqual([
      ["2026-10-15", 1_000],
      ["2026-10-16", 900],
      ["2026-10-31", 900],
    ]);
  });

  it("период уже прошёл — прогноза нет", () => {
    expect(
      balanceForecast(1, [op({ date: "2026-10-20", kind: "expense", amountBase: 1 })], all, "2026-10-15", "2026-10-15")
    ).toEqual([]);
  });
});
