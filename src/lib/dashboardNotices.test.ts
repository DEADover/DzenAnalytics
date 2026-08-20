import { describe, it, expect } from "vitest";
import { buildNotices, type NoticesInput } from "./dashboardNotices";
import type { Insight, MonthSpike, RecurringCandidate } from "./aggregations";

function rec(over: Partial<RecurringCandidate>): RecurringCandidate {
  return {
    payee: "Подписка",
    category: "Развлечения",
    avgAmount: 500,
    currency: "RUB",
    occurrences: 6,
    avgIntervalDays: 30,
    monthsCovered: 6,
    consistency: 0.9,
    lastDate: "2026-07-22",
    nextExpected: "2026-08-22",
    daysSinceLast: 27,
    stale: false,
    totalSpent: 3000,
    txIds: [],
    cadence: "monthly",
    priceTrend: { changePct: 0, priceFlag: "flat" },
    ...over,
  } as RecurringCandidate;
}

function spike(over: Partial<MonthSpike>): MonthSpike {
  return { ym: "2026-08", category: "Кафе", current: 20000, baseline: 8000, delta: 12000, ratio: 2.5, ...over };
}

function input(over: Partial<NoticesInput> = {}): NoticesInput {
  return {
    ym: "2026-08",
    base: "RUB",
    today: "2026-08-19",
    spikes: [],
    recurring: [],
    planByCategory: new Map(),
    factByCategory: new Map(),
    insights: [],
    ...over,
  };
}

describe("buildNotices — порядок наблюдений", () => {
  it("КЛЮЧЕВОЕ: пробитый план идёт выше разогнавшейся статьи", () => {
    // Границу по плану человек ставил сам — это важнее статистики.
    const n = buildNotices(
      input({
        spikes: [spike({ category: "Кафе" })],
        planByCategory: new Map([["Продукты", 40000]]),
        factByCategory: new Map([["Продукты", 47300]]),
      })
    );
    expect(n.map((x) => x.title)).toEqual(["Продукты", "Кафе"]);
    // Разделитель разрядов ставит сам `toLocaleString` — он неразрывный,
    // поэтому сверяем по смыслу, а не по точному коду пробела.
    expect(n[0].body).toMatch(/^План 40.000\s?₽ — превышен на 18%$/);
    expect(n[0].value).toBe(47300);
  });

  it("статья не повторяется дважды: пробитый план съедает её всплеск", () => {
    const n = buildNotices(
      input({
        spikes: [spike({ category: "Продукты" })],
        planByCategory: new Map([["Продукты", 10000]]),
        factByCategory: new Map([["Продукты", 20000]]),
      })
    );
    expect(n).toHaveLength(1);
    expect(n[0].id).toBe("plan-Продукты");
  });

  it("план в пределах нормы наблюдением не становится", () => {
    const n = buildNotices(
      input({
        planByCategory: new Map([["Продукты", 40000]]),
        factByCategory: new Map([["Продукты", 41000]]),
      })
    );
    expect(n).toEqual([]);
  });
});

describe("buildNotices — подписки", () => {
  it("КЛЮЧЕВОЕ: подорожавшая подписка попадает в список", () => {
    // Расчёт priceTrend делался при поиске регулярных, но результат нигде
    // не показывали.
    const n = buildNotices(
      input({ recurring: [rec({ payee: "Стриминг", priceTrend: { changePct: 0.5, priceFlag: "up" } })] })
    );
    expect(n).toHaveLength(1);
    expect(n[0].title).toBe("Стриминг");
    expect(n[0].body).toBe("Подорожало на 50% против обычного платежа");
  });

  it("колебание чека ниже порога подорожанием не считается", () => {
    const n = buildNotices(
      input({ recurring: [rec({ priceTrend: { changePct: 0.04, priceFlag: "up" } })] })
    );
    expect(n).toEqual([]);
  });

  it("подешевевшая и брошенная подписки молчат", () => {
    const n = buildNotices(
      input({
        recurring: [
          rec({ payee: "Дешевле", priceTrend: { changePct: 0.4, priceFlag: "down" } }),
          rec({ payee: "Брошена", stale: true, priceTrend: { changePct: 0.4, priceFlag: "up" } }),
        ],
      })
    );
    expect(n).toEqual([]);
  });

  it("ожидаемый платёж не пришёл — про это говорим", () => {
    const n = buildNotices(input({ recurring: [rec({ payee: "Связь", nextExpected: "2026-08-15" })] }));
    expect(n).toHaveLength(1);
    expect(n[0].body).toBe("Ждали 15.08 — платежа пока нет");
  });

  it("платёж, которого ждут в будущем, наблюдением не становится", () => {
    const n = buildNotices(input({ recurring: [rec({ nextExpected: "2026-08-25" })] }));
    expect(n).toEqual([]);
  });
});

describe("buildNotices — готовые наблюдения", () => {
  const fact: Insight = { kind: "fact", title: "Выходные vs будни", body: "Расходы ровные" };
  const trend: Insight = { kind: "trend", title: "Расходы к прошлому месяцу", body: "ниже на 41%", value: -0.41, positive: true };
  const high: Insight = { kind: "highlight", title: "Самая крупная трата", body: "Аренда, 19 апреля", value: 62000 };

  it("КЛЮЧЕВОЕ: «факты» отбрасываются — это шум, срабатывающий всегда", () => {
    const n = buildNotices(input({ insights: [fact, trend] }));
    expect(n.map((x) => x.title)).toEqual(["Расходы к прошлому месяцу"]);
  });

  it("деньгами показывается только «самая крупная трата»", () => {
    // У остальных правил value — доля или кратность: −0.41 печаталось как «−0 ₽».
    const n = buildNotices(input({ insights: [high, trend] }));
    expect(n.find((x) => x.title === "Самая крупная трата")?.value).toBe(62000);
    expect(n.find((x) => x.title === "Расходы к прошлому месяцу")?.value).toBeUndefined();
  });

  it("наблюдение про статью, о которой уже сказано, не дублируется", () => {
    const dup: Insight = { kind: "trend", title: "Категория падает", body: "«Кафе»: −12 000 к прошлому месяцу" };
    const n = buildNotices(input({ spikes: [spike({ category: "Кафе" })], insights: [dup] }));
    expect(n).toHaveLength(1);
    expect(n[0].id).toBe("spike-Кафе");
  });

  it("тон берётся из знака: хорошее — доходным цветом", () => {
    expect(buildNotices(input({ insights: [trend] }))[0].tone).toBe("income");
    const warn: Insight = { kind: "warning", title: "Расходы к прошлому месяцу", body: "выше на 20%" };
    expect(buildNotices(input({ insights: [warn] }))[0].tone).toBe("warn");
  });
});

describe("buildNotices — предел на источник", () => {
  it("КЛЮЧЕВОЕ: один разговорчивый источник не забивает список", () => {
    // Три подорожавшие подписки подряд вытесняли и крупную трату, и сравнение
    // с прошлым месяцем — список становился длинным, но не разным.
    const n = buildNotices(
      input({
        recurring: [
          rec({ payee: "A", priceTrend: { changePct: 0.5, priceFlag: "up" } }),
          rec({ payee: "B", priceTrend: { changePct: 0.4, priceFlag: "up" } }),
          rec({ payee: "C", priceTrend: { changePct: 0.3, priceFlag: "up" } }),
        ],
        insights: [{ kind: "highlight", title: "Самая крупная трата", body: "Аренда", value: 62000 }],
      })
    );
    expect(n.filter((x) => x.id.startsWith("price-"))).toHaveLength(2);
    expect(n.some((x) => x.title === "Самая крупная трата")).toBe(true);
  });
});

describe("buildNotices — пусто", () => {
  it("нечего показать — пустой список, а не выдуманная строка", () => {
    expect(buildNotices(input())).toEqual([]);
  });

  it("всплески чужого месяца не берутся", () => {
    expect(buildNotices(input({ spikes: [spike({ ym: "2026-07" })] }))).toEqual([]);
  });
});
