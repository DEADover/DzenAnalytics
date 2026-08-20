import { describe, it, expect } from "vitest";
import {
  groupByCategory,
  computeKPI,
  cumulativeNetAt,
  extractHashtags,
  groupByHashtag,
  detectDuplicates,
  hashtagCategoryTrees,
  detectRecurring,
  stackedBalanceByAccount,
  type StackedBalancePoint,
  buildScenarioForecast,
  netWorthSeries,
  netWorthBasis,
  buildSankey,
  splitByObligation,
  isObligatoryTx,
  fireSeries,
  statsByDayOfWeek,
  statsByHourOfWeek,
  transferTotals,
  stripFromAnalytics,
  scaleKPI,
} from "./aggregations";
import { tx } from "../test/fixtures";
import type { CurrencyRates, Transaction } from "../types";

describe("splitByObligation / isObligatoryTx — default obligatory, sub-aware", () => {
  const txs = [
    tx({ kind: "expense", category: "Аренда", amount: 100, amountBase: 100 }),
    tx({ kind: "expense", category: "Кафе", amount: 40, amountBase: 40 }),
    tx({ kind: "expense", category: "Развлечения", amount: 10, amountBase: 10 }),
    tx({ kind: "income", category: "Зарплата", amount: 500, amountBase: 500 }),
  ];

  it("expense category obligatory unless required === false", () => {
    const meta = {
      Кафе: { required: false },
      Развлечения: { required: false },
      // «Аренда» has no meta row → defaults to obligatory.
    };
    const { obligatory, optional } = splitByObligation(txs, meta);
    expect(obligatory).toBe(100); // Аренда
    expect(optional).toBe(50); // Кафе 40 + Развлечения 10
  });

  it("required null/true both count as obligatory", () => {
    const meta = { Аренда: { required: null }, Кафе: { required: true } };
    const { obligatory } = splitByObligation(txs, meta);
    expect(obligatory).toBe(150); // Аренда 100 + Кафе 40 + Развлечения 10 (default)
  });

  it("empty meta → all expenses obligatory", () => {
    const { obligatory, optional } = splitByObligation(txs, {});
    expect(obligatory).toBe(150);
    expect(optional).toBe(0);
  });

  it("subcategory's own flag overrides the parent (#5)", () => {
    const sub = tx({
      kind: "expense",
      category: "Покупки",
      subcategory: "Одежда",
      categoryFull: "Покупки / Одежда",
      amount: 30,
      amountBase: 30,
    });
    // Parent obligatory, sub explicitly NOT — sub wins.
    expect(
      isObligatoryTx(sub, { Покупки: { required: true }, "Покупки / Одежда": { required: false } })
    ).toBe(false);
    // Parent NOT obligatory, sub explicitly obligatory — sub wins.
    expect(
      isObligatoryTx(sub, { Покупки: { required: false }, "Покупки / Одежда": { required: true } })
    ).toBe(true);
    // Sub has no flag → inherits parent.
    expect(isObligatoryTx(sub, { Покупки: { required: false } })).toBe(false);
  });
});

describe("stackedBalanceByAccount — real-balance anchoring", () => {
  const txs = [
    tx({ kind: "income", amount: 300, incomeAccount: "A", date: "2026-01-01" }),
    tx({ kind: "income", amount: 50, incomeAccount: "B", date: "2026-01-01" }),
    tx({ kind: "expense", amount: 100, outcomeAccount: "A", date: "2026-01-02" }),
  ];

  it("without real balances → cumulative flow from zero", () => {
    const { series } = stackedBalanceByAccount(txs, 8);
    const last = series[series.length - 1];
    expect(last.A).toBe(200); // +300 −100
    expect(last.B).toBe(50);
    expect(last.total).toBe(250);
  });

  it("with real balances → lines end at real balance; stack sums to net worth", () => {
    const { series } = stackedBalanceByAccount(txs, 8, { A: 1000, B: 500 });
    const last = series[series.length - 1];
    expect(last.A).toBe(1000);
    expect(last.B).toBe(500);
    expect(last.total).toBe(1500);
    // Shape preserved: before the −100 expense, A's balance was 100 higher.
    expect(series[0].A).toBe(1100);
  });

  it("счёт не показывается до своей первой операции", () => {
    // Обращение пользователя: счёт открыт в марте 2022, а на графике ровная
    // полка с 2016-го. Линия привязана к сегодняшнему остатку, и до первой
    // операции она показывала «остаток минус весь поток» — деньги, которых на
    // счёте тогда не было.
    const t = [
      tx({ kind: "income", amount: 1000, incomeAccount: "Старый", date: "2016-04-17" }),
      tx({ kind: "income", amount: 572_100, incomeAccount: "Новый", date: "2022-03-11" }),
    ];
    const { series } = stackedBalanceByAccount(t, 8, { Старый: 1000, Новый: 572_100 });
    const first = series[0];
    expect(first.date).toBe("2016-04-17");
    expect(first["Новый"]).toBe(0); // счёта ещё нет
    expect(first["Старый"]).toBe(1000);
    expect(first.total).toBe(1000); // и в сумму он не входит
    const last = series[series.length - 1];
    expect(last["Новый"]).toBe(572_100);
    expect(last.total).toBe(573_100);
  });

  it("отбор одного счёта: до открытия — ноль, а не остаток", () => {
    const t = [
      tx({ kind: "income", amount: 1000, incomeAccount: "Старый", date: "2016-04-17" }),
      tx({ kind: "expense", amount: 100, outcomeAccount: "Старый", date: "2020-01-01" }),
      tx({ kind: "income", amount: 572_100, incomeAccount: "Новый", date: "2022-03-11" }),
    ];
    const { series } = stackedBalanceByAccount(
      t,
      8,
      { Старый: 900, Новый: 572_100 },
      null,
      ["Новый"]
    );
    // Ось осталась полной — дни чужих операций её задают, — но до 2022-03-11
    // выбранный счёт стоит на нуле.
    expect(series[0].date).toBe("2016-04-17");
    expect(series[0]["Новый"]).toBe(0);
    expect(series[0].total).toBe(0);
    const opened = series.find((p) => p.date === "2022-03-11")!;
    expect(opened["Новый"]).toBe(572_100);
  });

  it("операции 1970 года оставляют счёт существующим с начала оси", () => {
    // «Эпоховые» записи Дзен-мани точку на оси не создают, но поток от них
    // ложится в стартовое значение — счёт был и до первой видимой операции.
    const t = [
      tx({ kind: "income", amount: 500, incomeAccount: "Старый", date: "1970-01-01" }),
      tx({ kind: "income", amount: 100, incomeAccount: "Другой", date: "2016-04-17" }),
      tx({ kind: "expense", amount: 50, outcomeAccount: "Старый", date: "2020-01-01" }),
    ];
    const { series } = stackedBalanceByAccount(t, 8);
    expect(series[0].date).toBe("2016-04-17");
    expect(series[0]["Старый"]).toBe(500);
  });

  it("оборот сам по себе слоя не даёт — важен остаток, а не движение", () => {
    const t = [
      // C: миллион пришёл и в тот же день ушёл — на счёте не задерживался.
      tx({ kind: "income", amount: 1_000_000, incomeAccount: "C", date: "2026-01-01" }),
      tx({ kind: "expense", amount: 999_000, outcomeAccount: "C", date: "2026-01-01" }),
      tx({ kind: "income", amount: 100, incomeAccount: "A", date: "2026-01-01" }),
      tx({ kind: "income", amount: 100, incomeAccount: "B", date: "2026-01-01" }),
      // D — второй «лишний» счёт: с одним «Прочих» не бывает, он вышел бы
      // отдельным слоем и правило ранжирования проверить было бы нечем.
      tx({ kind: "income", amount: 100, incomeAccount: "D", date: "2026-01-01" }),
    ];
    const { accounts } = stackedBalanceByAccount(t, 2, {
      A: 900_000,
      B: 800_000,
      C: 1000,
      D: 500,
    });
    expect(accounts).toEqual(expect.arrayContaining(["A", "B", "Прочие"]));
    expect(accounts).not.toContain("C"); // small balance → folded into «Прочие»
  });

  it("КЛЮЧЕВОЕ: счёт, который был крупным РАНЬШЕ, идёт своим слоем", () => {
    // На это и жалуются: слои отбирались по СЕГОДНЯШНЕМУ остатку, поэтому
    // счёт, где год назад лежал миллион, а сегодня пусто, уезжал в «Прочие» —
    // и «Прочие» на графике оказывались выше всех показанных слоёв разом.
    const t = [
      tx({ kind: "income", amount: 5_000_000, incomeAccount: "Вклад", date: "2025-01-01" }),
      tx({ kind: "expense", amount: 5_000_000, outcomeAccount: "Вклад", date: "2025-12-31" }),
      tx({ kind: "income", amount: 10_000, incomeAccount: "Карта", date: "2025-01-01" }),
      tx({ kind: "income", amount: 100, incomeAccount: "Наличные", date: "2025-01-01" }),
      tx({ kind: "income", amount: 90, incomeAccount: "Копилка", date: "2025-01-01" }),
    ];
    const real = { Вклад: 0, Карта: 10_000, Наличные: 100, Копилка: 90 };
    const { accounts, series } = stackedBalanceByAccount(t, 2, real);
    expect(accounts).toContain("Вклад");
    // И главное свойство: в «Прочие» осталась мелочь. Ни в один день этот слой
    // не перерастает самый маленький из показанных.
    const smallest = Math.min(
      ...accounts
        .filter((a) => a !== "Прочие")
        .map((a) => Math.max(...series.map((p) => Math.abs(p[a] as number))))
    );
    const other = Math.max(...series.map((p) => Math.abs((p["Прочие"] as number) ?? 0)));
    expect(other).toBeLessThanOrEqual(smallest);
  });

  it("счёт без операций, но с большими деньгами, тоже получает слой", () => {
    // Вклад, куда положили один раз и забыли: в операциях его нет вовсе, а
    // деньги есть. Раньше он молча уходил в «Прочие» вместе со всем остатком.
    const t = [
      tx({ kind: "income", amount: 10_000, incomeAccount: "Карта", date: "2026-01-01" }),
      tx({ kind: "income", amount: 500, incomeAccount: "Наличные", date: "2026-01-02" }),
      tx({ kind: "income", amount: 300, incomeAccount: "Копилка", date: "2026-01-02" }),
    ];
    const { accounts, series } = stackedBalanceByAccount(t, 2, {
      Карта: 10_000,
      Наличные: 500,
      Копилка: 300,
      Вклад: 3_000_000,
    });
    expect(accounts).toContain("Вклад");
    expect(series[series.length - 1]["Вклад"]).toBe(3_000_000);
  });

  // issue #18 — an unsynced draft is in the walked history but NOT in the API
  // balance. It must stay in the line shape yet be excluded from the anchor.
  const withDraft = [
    tx({ kind: "income", amount: 1_900_000, incomeAccount: "A", date: "2026-01-01" }),
    tx({ id: "draft1", kind: "income", amount: 500, incomeAccount: "A", date: "2026-06-16" }),
  ];

  it("anchors past an unsynced draft so the baseline isn't shifted (issue #18)", () => {
    // API balance = cloud only (1,900,000); projected after push = 1,900,500.
    const { series } = stackedBalanceByAccount(withDraft, 8, { A: 1_900_000 }, new Set(["draft1"]));
    // Line ends at the PROJECTED balance (cloud + draft) — same as after push.
    expect(series[series.length - 1].A).toBe(1_900_500);
    // Opening reconciles to the real cloud baseline (0): day-1 point is just the
    // income, NOT slid down by −500. Before the fix this read 1,899,500.
    expect(series[0].A).toBe(1_900_000);
  });

  it("without the unsynced set the draft counts as cloud flow (anchor contract)", () => {
    // Same data, draft id NOT supplied → treated as synced, reproducing the
    // off-by-draft slide. Guards that the param is what drives the fix.
    const { series } = stackedBalanceByAccount(withDraft, 8, { A: 1_900_000 });
    expect(series[0].A).toBe(1_899_500); // −500 shift
    expect(series[series.length - 1].A).toBe(1_900_000);
  });
});

describe("buildScenarioForecast — robust center + tightened band (issue #28)", () => {
  it("centers on the median month, not the mean (spike-robust)", () => {
    // 5 typical income months (100) + one 700 spike. Mean income = 200, median = 100.
    const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
    const inc = [100, 100, 100, 100, 100, 700];
    const txs = months.map((ym, i) =>
      tx({ kind: "income", amount: inc[i], incomeAccount: "A", date: `${ym}-15` })
    );
    const f = buildScenarioForecast(txs, 1, 6).find((p) => p.isForecast)!;
    expect(f.realistic).toBe(100); // median net — the 700 spike doesn't inflate it
    expect(f.income).toBe(100); // projected income also uses the median
  });

  it("uses the combined std (hypot), not stdI+stdE, so the pessimist isn't over-deep", () => {
    // Income std 50, expense std 25 → old band 75, new band √(50²+25²) ≈ 55.9.
    const months = ["2026-01", "2026-02", "2026-03", "2026-04"];
    const inc = [100, 200, 100, 200];
    const exp = [50, 100, 50, 100];
    const txs = months.flatMap((ym, i) => [
      tx({ kind: "income", amount: inc[i], incomeAccount: "A", date: `${ym}-10` }),
      tx({ kind: "expense", amount: exp[i], outcomeAccount: "A", date: `${ym}-20` }),
    ]);
    const f = buildScenarioForecast(txs, 1, 6).find((p) => p.isForecast)!;
    expect(f.realistic).toBeCloseTo(75); // medI − medE = 150 − 75
    const half = f.optimistic - f.realistic;
    expect(half).toBeCloseTo(Math.hypot(50, 25)); // combined std
    expect(half).toBeLessThan(50 + 25); // strictly tighter than the old stdI+stdE
    expect(f.optimistic - f.realistic).toBeCloseTo(f.realistic - f.pessimistic); // symmetric
  });

  it("applies calendar-month seasonality with enough history (issue #28 pt.2)", () => {
    // 24 months: December expense triples, other months flat; income flat.
    const yms: string[] = [];
    for (const y of [2023, 2024]) for (let m = 1; m <= 12; m++) yms.push(`${y}-${String(m).padStart(2, "0")}`);
    const txs = yms.flatMap((ym) => {
      const dec = ym.endsWith("-12");
      return [
        tx({ kind: "income", amount: 500, incomeAccount: "A", date: `${ym}-05` }),
        tx({ kind: "expense", category: "Х", amount: dec ? 300 : 100, outcomeAccount: "A", date: `${ym}-20` }),
      ];
    });
    const f = buildScenarioForecast(txs, 12, 12); // 12 months ahead → next December included
    const decF = f.find((p) => p.isForecast && p.ym.endsWith("-12"))!;
    const junF = f.find((p) => p.isForecast && p.ym.endsWith("-06"))!;
    expect(junF.expense).toBeCloseTo(100); // typical month ≈ base
    expect(decF.expense).toBeGreaterThan(junF.expense * 2); // December seasonal spike
  });

  it("obligatory («постоянные») expenses don't inflate the band (issue #28 pt.2)", () => {
    // «Аренда» (obligatory) VARIES ±20 but is treated as fixed/predictable;
    // «Кафе» (optional) is constant. With meta the band collapses to ~0, while
    // without the split «Аренда»'s variance leaks into the coridor.
    const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
    const rent = [100, 140, 100, 140, 100, 140];
    const txs = months.flatMap((ym, i) => [
      tx({ kind: "income", amount: 500, incomeAccount: "A", date: `${ym}-05` }),
      tx({ kind: "expense", category: "Аренда", amount: rent[i], outcomeAccount: "A", date: `${ym}-10` }),
      tx({ kind: "expense", category: "Кафе", amount: 50, outcomeAccount: "A", date: `${ym}-20` }),
    ]);
    const meta = { Кафе: { required: false } }; // «Аренда» → obligatory by default
    const withMeta = buildScenarioForecast(txs, 1, 6, { categoryMeta: meta }).find((p) => p.isForecast)!;
    const without = buildScenarioForecast(txs, 1, 6).find((p) => p.isForecast)!;
    const bandWith = withMeta.optimistic - withMeta.realistic;
    const bandWithout = without.optimistic - without.realistic;
    expect(bandWith).toBeLessThan(bandWithout); // fixed variance excluded → tighter
    expect(bandWith).toBeCloseTo(0); // «Кафе» constant → variable part has no variance
  });
});

describe("netWorthSeries — openings & account membership (issue #3)", () => {
  it("seeds opening balances so the curve never dips artificially negative", () => {
    const txs = [
      tx({ kind: "expense", amountBase: 30000, outcomeAccount: "A", account: "A", date: "2020-02-01" }),
      tx({ kind: "expense", amountBase: 40000, outcomeAccount: "A", account: "A", date: "2020-03-01" }),
    ];
    // Without the opening, the cumulative flow goes negative early.
    const noOpening = netWorthSeries(txs);
    expect(Math.min(...noOpening.map((p) => p.net))).toBeLessThan(0);
    // With the opening seeded at the account's start, it stays positive.
    const withOpening = netWorthSeries(txs, null, {
      accounts: new Set(["A"]),
      openings: [{ date: "2020-01-01", amount: 100000 }],
    });
    expect(Math.min(...withOpening.map((p) => p.net))).toBeGreaterThan(0);
    // End = startBalance + flows = real balance.
    expect(withOpening[withOpening.length - 1].net).toBe(30000); // 100k − 30k − 40k
  });

  it("counts only in-set flows; a transfer scores only when it crosses the boundary", () => {
    const txs = [
      tx({ kind: "income", amountBase: 1000, incomeAccount: "A", account: "A", date: "2026-01-01" }),
      tx({ kind: "expense", amountBase: 200, outcomeAccount: "Out", account: "Out", date: "2026-01-02" }), // outside set
      tx({ kind: "transfer", amountBase: 300, outcomeAccount: "A", incomeAccount: "B", date: "2026-01-03" }), // within set → 0
      tx({ kind: "transfer", amountBase: 500, outcomeAccount: "A", incomeAccount: "Out", date: "2026-01-04" }), // leaves set → −500
    ];
    const series = netWorthSeries(txs, null, { accounts: new Set(["A", "B"]) });
    expect(series[series.length - 1].net).toBe(500); // +1000 (in-set income) − 500 (transfer out), «Out» expense ignored
  });
});

describe("netWorthBasis (issue #3)", () => {
  const RUB: CurrencyRates = { base: "RUB", rates: { RUB: 1 } };
  const acc = (over: Partial<Parameters<typeof netWorthBasis>[0][number]>) => ({
    title: "X", currency: "RUB", startBalance: 0, startDate: null, archive: false, inBalance: true, balance: 0, ...over,
  });

  it("берёт счета в балансе, включая закрытые, и датирует стартовые остатки", () => {
    const live = [
      acc({ title: "A", startBalance: 100000, startDate: "2020-01-01" }),
      acc({ title: "B", startBalance: 5000, startDate: null }), // no startDate → earliest tx
      acc({ title: "Old", startBalance: 9, archive: true }),
      acc({ title: "Off", startBalance: 9, inBalance: false }),
    ];
    const txs = [tx({ account: "B", outcomeAccount: "B", date: "2021-03-01" })];
    const { accounts, openings } = netWorthBasis(live, txs, RUB, false);
    // Закрытый счёт остаётся: в прошлом на нём лежали настоящие деньги, и без
    // него кривая совокупного баланса занижала всю историю.
    expect([...accounts].sort()).toEqual(["A", "B", "Old"]);
    expect(accounts.has("Off")).toBe(false);
    expect(openings).toContainEqual({ date: "2020-01-01", amount: 100000 });
    expect(openings).toContainEqual({ date: "2021-03-01", amount: 5000 }); // fell back to first tx
  });

  it("сумма остатков возвращается вместе с базисом", () => {
    const live = [
      acc({ title: "A", balance: 100 }),
      acc({ title: "Б", balance: 250 }),
      acc({ title: "Вне", balance: 999, inBalance: false }),
    ];
    expect(netWorthBasis(live, [], RUB, false).total).toBe(350);
    expect(netWorthBasis(live, [], RUB, true).total).toBe(1349);
  });

  it("история закрытого счёта не пропадает из совокупного баланса", () => {
    // Тот самый случай: счёт закрыли в этом году, но в прошлые годы на нём
    // были деньги. Раньше из 32 счетов в расчёт попадали 12, и максимум за всю
    // историю выходил на миллион меньше, чем в самом Дзен-мани.
    const live = [
      acc({ title: "Живой", startBalance: 1000, startDate: "2020-01-01" }),
      acc({ title: "Закрытый", startBalance: 500000, startDate: "2020-01-01", archive: true }),
    ];
    const { accounts, openings } = netWorthBasis(live, [], RUB, false);
    expect(accounts.has("Закрытый")).toBe(true);
    expect(openings).toContainEqual({ date: "2020-01-01", amount: 500000 });
  });

  it("includes off-balance accounts when the toggle is on", () => {
    const live = [acc({ title: "Off", startBalance: 7, inBalance: false, startDate: "2024-01-01" })];
    const { accounts } = netWorthBasis(live, [], RUB, true);
    expect(accounts.has("Off")).toBe(true);
  });

  it("ignores an epoch/1970 startDate and falls back to the first transaction", () => {
    // Zenmoney sometimes returns a bogus 1970 startDate — it must NOT seed a
    // phantom «01.01.1970» opening (that inflated net worth for a user).
    const live = [acc({ title: "Legacy", startBalance: 100000, startDate: "1970-01-01" })];
    const txs = [tx({ account: "Legacy", outcomeAccount: "Legacy", date: "2021-03-01" })];
    const { openings } = netWorthBasis(live, txs, RUB, false);
    expect(openings).toContainEqual({ date: "2021-03-01", amount: 100000 });
    expect(openings.some((o) => o.date === "1970-01-01")).toBe(false);
  });
});

describe("detectRecurring — nextExpected projection", () => {
  const NOW = +new Date("2026-06-15T12:00:00Z");
  const monthly = (payee: string, dates: string[]) =>
    dates.map((d) => tx({ payee, kind: "expense", amount: 500, date: d }));

  it("projects «next expected» into the future for a live payment", () => {
    const txs = monthly("Netflix", ["2026-03-10", "2026-04-10", "2026-05-10"]);
    const [c] = detectRecurring(txs, 3, NOW);
    expect(c.payee).toBe("Netflix");
    // last + 1 interval would be ~2026-06-10 (already past NOW) → rolled forward.
    expect(c.nextExpected >= "2026-06-15").toBe(true);
  });

  it("leaves «next expected» in the past for a long-dead payment", () => {
    const txs = monthly("Старый", ["2020-01-10", "2020-02-10", "2020-03-10"]);
    const [c] = detectRecurring(txs, 3, NOW);
    expect(c.lastDate).toBe("2020-03-10");
    expect(c.nextExpected.startsWith("2020")).toBe(true);
    expect(c.stale).toBe(true);
  });

  it("marks a monthly plan silent for a few months as stale (not just >1 year)", () => {
    // Last paid 2026-01-10 → ~5 months before NOW (2026-06-15). Cadence-aware
    // staleness flags it well under a year, and the projection stays in the past.
    const txs = monthly("Заброшенный", ["2025-11-10", "2025-12-10", "2026-01-10"]);
    const [c] = detectRecurring(txs, 3, NOW);
    expect(c.lastDate).toBe("2026-01-10");
    expect(c.stale).toBe(true);
    expect(c.nextExpected < "2026-06-15").toBe(true);
  });

  it("keeps a recently-charged monthly plan active (not stale)", () => {
    const txs = monthly("Живой", ["2026-03-10", "2026-04-10", "2026-05-10"]);
    const [c] = detectRecurring(txs, 3, NOW);
    expect(c.stale).toBe(false);
  });
});

describe("hashtagCategoryTrees", () => {
  it("builds a per-tag category → subcategory tree with expense/income/count", () => {
    const trees = hashtagCategoryTrees([
      tx({ comment: "обед #катя", category: "Еда", subcategory: "Кафе", kind: "expense", amountBase: 100 }),
      tx({ comment: "ужин #катя", category: "Еда", subcategory: "Кафе", kind: "expense", amountBase: 50 }),
      tx({ comment: "такси #катя", category: "Транспорт", subcategory: null, kind: "expense", amountBase: 200 }),
      tx({ comment: "#другой", category: "Еда", subcategory: null, kind: "expense", amountBase: 999 }),
    ]);
    const katya = trees.get("катя")!;
    // Sorted by expense+income desc: Транспорт (200) before Еда (150).
    expect(katya.map((n) => n.category)).toEqual(["Транспорт", "Еда"]);
    const eda = katya.find((n) => n.category === "Еда")!;
    expect(eda).toMatchObject({ expense: 150, income: 0, count: 2 });
    expect(eda.subs).toEqual([{ name: "Кафе", expense: 150, income: 0, count: 2 }]);
    expect(trees.has("другой")).toBe(true);
  });

  it("tracks income in its own bucket and lets refunds shrink expense", () => {
    const trees = hashtagCategoryTrees([
      tx({ comment: "#x", category: "Еда", kind: "expense", amountBase: 500 }),
      tx({ comment: "#x", category: "Еда", kind: "refund", amountBase: 200 }),
      tx({ comment: "#x", category: "Зарплата", kind: "income", amountBase: 9999 }),
    ]);
    const x = trees.get("x")!;
    expect(x).toHaveLength(2);
    expect(x.find((n) => n.category === "Еда")).toMatchObject({ expense: 300, income: 0, count: 2 });
    expect(x.find((n) => n.category === "Зарплата")).toMatchObject({ expense: 0, income: 9999, count: 1 });
  });
});

describe("groupByCategory", () => {
  it("sums expenses per category and ignores transfers", () => {
    const buckets = groupByCategory([
      tx({ category: "Еда", kind: "expense", amountBase: 100 }),
      tx({ category: "Еда", kind: "expense", amountBase: 50 }),
      tx({ category: "Перевод", kind: "transfer", amountBase: 999 }),
    ]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].category).toBe("Еда");
    expect(buckets[0].expense).toBe(150);
  });

  it("treats a refund as a reduction of the category's expense", () => {
    const buckets = groupByCategory([
      tx({ category: "Электроника", kind: "expense", amountBase: 1000 }),
      tx({ category: "Электроника", kind: "refund", amountBase: 300 }),
    ]);
    expect(buckets[0].expense).toBe(700); // 1000 − 300
  });
});

describe("computeKPI", () => {
  it("computes income, expense and net; transfers excluded", () => {
    const k = computeKPI([
      tx({ kind: "income", amountBase: 1000 }),
      tx({ kind: "expense", amountBase: 400 }),
      tx({ kind: "transfer", amountBase: 999 }),
    ]);
    expect(k.income).toBe(1000);
    expect(k.expense).toBe(400);
    expect(k.net).toBe(600);
  });

  it("nets a refund against expense (not income)", () => {
    const k = computeKPI([
      tx({ kind: "expense", amountBase: 500 }),
      tx({ kind: "refund", amountBase: 200 }),
    ]);
    expect(k.expense).toBe(300); // 500 − 200
    expect(k.income).toBe(0);
    expect(k.count).toBe(2); // refund still counts as an operation
  });
});

describe("cumulativeNetAt", () => {
  const txs = [
    tx({ date: "2026-01-01", kind: "income", amountBase: 1000 }),
    tx({ date: "2026-01-10", kind: "expense", amountBase: 300 }),
    tx({ date: "2026-01-20", kind: "refund", amountBase: 100 }),
    tx({ date: "2026-02-01", kind: "expense", amountBase: 500 }),
  ];

  it("accumulates only up to and including the given date", () => {
    expect(cumulativeNetAt(txs, "2026-01-10")).toBe(700); // 1000 − 300
  });

  it("treats a refund as an inflow (same direction as income)", () => {
    expect(cumulativeNetAt(txs, "2026-01-20")).toBe(800); // 1000 − 300 + 100
  });

  it("includes everything when the date is in the future", () => {
    expect(cumulativeNetAt(txs, "2026-12-31")).toBe(300); // 800 − 500
  });
});

describe("extractHashtags", () => {
  it("pulls multiple hashtags out of a comment", () => {
    expect(extractHashtags("Бензин #Mazda3 и мойка #Катя")).toEqual([
      "Mazda3",
      "Катя",
    ]);
  });

  it("returns an empty array for text without hashtags or empty input", () => {
    expect(extractHashtags("обычный комментарий")).toEqual([]);
    expect(extractHashtags("")).toEqual([]);
  });

  it("схлопывает повтор одного тега — это одна пометка, а не две", () => {
    expect(extractHashtags("#еда обед #еда")).toEqual(["еда"]);
  });

  it("не схлопывает теги, различающиеся регистром", () => {
    // «#еда» и «#Еда» — разные теги во всём сервисе.
    expect(extractHashtags("#еда и #Еда")).toEqual(["еда", "Еда"]);
  });

  it("сохраняет порядок первого появления", () => {
    expect(extractHashtags("#б #а #б #в")).toEqual(["б", "а", "в"]);
  });
});

describe("groupByHashtag: повтор тега в комментарии (issue #63)", () => {
  it("не задваивает сумму и количество операции", () => {
    const [bucket] = groupByHashtag([
      tx({ id: "t1", comment: "#еда обед #еда", amount: 500, kind: "expense" }),
    ]);
    expect(bucket.expense).toBe(500);
    expect(bucket.count).toBe(1);
    expect(bucket.txIds).toEqual(["t1"]);
  });

  it("разные теги в одном комментарии по-прежнему считаются каждый", () => {
    const buckets = groupByHashtag([
      tx({ id: "t1", comment: "#еда #кафе", amount: 500, kind: "expense" }),
    ]);
    expect(buckets.map((b) => [b.tag, b.expense, b.count])).toEqual([
      ["еда", 500, 1],
      ["кафе", 500, 1],
    ]);
  });
});

describe("hashtagCategoryTrees: повтор тега в комментарии (issue #63)", () => {
  it("не задваивает статью внутри тега", () => {
    const nodes = hashtagCategoryTrees([
      tx({
        id: "t1",
        comment: "#еда #еда",
        amount: 500,
        kind: "expense",
        category: "Продукты",
      }),
    ]).get("еда")!;
    expect(nodes).toHaveLength(1);
    expect(nodes[0].expense).toBe(500);
    expect(nodes[0].count).toBe(1);
  });
});

describe("detectDuplicates: одна строка в разных полях", () => {
  // Яндекс-банк присылал «Выплата процентов» у одних операций комментарием, у
  // других — получателем. Три одинаковых зачисления за день расходились по
  // разным группам, и третье в дубли не попадало.
  const same = { date: "2026-07-22", amount: 199.99, account: "Яндекс Бессрочный" } as const;

  it("получателя, записанного в комментарий, узнаём как того же", () => {
    const groups = detectDuplicates([
      tx({ id: "a", ...same, payee: "", comment: "Выплата процентов" }),
      tx({ id: "b", ...same, payee: "", comment: "Выплата процентов" }),
      tx({ id: "c", ...same, payee: "Выплата процентов", comment: "" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].txs.map((t) => t.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("разные получатели по-прежнему не дубли", () => {
    const groups = detectDuplicates([
      tx({ id: "a", ...same, payee: "Пятёрочка" }),
      tx({ id: "b", ...same, payee: "Магнит" }),
    ]);
    expect(groups).toEqual([]);
  });

  it("пустой получатель и пустой комментарий у обеих — всё ещё группа", () => {
    const groups = detectDuplicates([
      tx({ id: "a", ...same, payee: "", comment: "" }),
      tx({ id: "b", ...same, payee: "", comment: "" }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it("разные комментарии при одном получателе остаются разными покупками", () => {
    const groups = detectDuplicates([
      tx({ id: "a", ...same, payee: "Пятёрочка", comment: "Кешью" }),
      tx({ id: "b", ...same, payee: "Пятёрочка", comment: "Томаты" }),
    ]);
    expect(groups).toEqual([]);
  });
});

describe("detectDuplicates: приметы дубля (issue #66)", () => {
  it("по умолчанию — только один и тот же день", () => {
    // Ежедневная одинаковая покупка дублем не является.
    const daily = [
      tx({ id: "d1", date: "2026-01-10", payee: "Кофейня", amount: 250, account: "Карта" }),
      tx({ id: "d2", date: "2026-01-11", payee: "Кофейня", amount: 250, account: "Карта" }),
      tx({ id: "d3", date: "2026-01-12", payee: "Кофейня", amount: 250, account: "Карта" }),
    ];
    expect(detectDuplicates(daily)).toEqual([]);
    // А два списания одним днём — да.
    const twice = [
      tx({ id: "t1", date: "2026-01-10", payee: "Кофейня", amount: 250, account: "Карта" }),
      tx({ id: "t2", date: "2026-01-10", payee: "Кофейня", amount: 250, account: "Карта" }),
    ];
    expect(detectDuplicates(twice)).toHaveLength(1);
  });

  it("разные счета — не дубль, даже в один день", () => {
    // Один платёж не может пройти дважды по разным счетам.
    const cards = [
      tx({ id: "c1", date: "2026-01-10", payee: "Кофейня", amount: 250, account: "Карта" }),
      tx({ id: "c2", date: "2026-01-10", payee: "Кофейня", amount: 250, account: "Наличные" }),
    ];
    expect(detectDuplicates(cards)).toEqual([]);
  });

  it("счёт попал в примету — старые исключения её не перекрывают", () => {
    const twice = [
      tx({ id: "t1", date: "2026-01-10", payee: "Кофейня", amount: 250, account: "Карта" }),
      tx({ id: "t2", date: "2026-01-10", payee: "Кофейня", amount: 250, account: "Карта" }),
    ];
    const [g] = detectDuplicates(twice);
    expect(g.signature).toContain("Карта");
    expect(detectDuplicates(twice, 0, new Set([g.signature]))).toEqual([]);
  });

  it("окно по-прежнему расширяется вручную", () => {
    const nextDay = [
      tx({ id: "n1", date: "2026-01-10", payee: "Кофейня", amount: 250, account: "Карта" }),
      tx({ id: "n2", date: "2026-01-11", payee: "Кофейня", amount: 250, account: "Карта" }),
    ];
    expect(detectDuplicates(nextDay, 0)).toEqual([]);
    expect(detectDuplicates(nextDay, 3)).toHaveLength(1);
  });
});

describe("detectDuplicates", () => {
  it("flags two same-amount same-payee same-kind ops within the window", () => {
    const groups = detectDuplicates(
      [
        tx({ id: "a", date: "2026-01-10", payee: "Магнит", amount: 250, kind: "expense" }),
        tx({ id: "b", date: "2026-01-11", payee: "Магнит", amount: 250, kind: "expense" }),
      ],
      3
    );
    expect(groups.length).toBe(1);
  });

  it("orders groups by most-recent date first, not by total amount (issue #10)", () => {
    const groups = detectDuplicates(
      [
        // Older but BIGGER duplicate pair.
        tx({ id: "o1", date: "2026-01-10", payee: "Старый", amount: 9000, kind: "expense" }),
        tx({ id: "o2", date: "2026-01-11", payee: "Старый", amount: 9000, kind: "expense" }),
        // Newer but smaller duplicate pair.
        tx({ id: "n1", date: "2026-06-10", payee: "Новый", amount: 100, kind: "expense" }),
        tx({ id: "n2", date: "2026-06-11", payee: "Новый", amount: 100, kind: "expense" }),
      ],
      3
    );
    expect(groups.map((g) => g.txs[0].payee)).toEqual(["Новый", "Старый"]);
  });

  it("does not flag ops far apart in time", () => {
    const groups = detectDuplicates(
      [
        tx({ id: "a", date: "2026-01-01", payee: "Магнит", amount: 250 }),
        tx({ id: "b", date: "2026-02-01", payee: "Магнит", amount: 250 }),
      ],
      3
    );
    expect(groups.length).toBe(0);
  });

  it("skips groups whose signature is in the exclusion set («не дубликаты»)", () => {
    const txs = [
      tx({ id: "a", date: "2026-01-10", payee: "Магнит", amount: 250, kind: "expense" }),
      tx({ id: "b", date: "2026-01-11", payee: "Магнит", amount: 250, kind: "expense" }),
    ];
    const sig = detectDuplicates(txs, 3)[0].signature;
    expect(detectDuplicates(txs, 3, new Set([sig]))).toEqual([]);
    // an unrelated signature in the set doesn't suppress real duplicates
    expect(detectDuplicates(txs, 3, new Set(["other"]))).toHaveLength(1);
  });
});

describe("buildSankey — savings & deficit funding (issue #8)", () => {
  const sumLinks = (
    data: ReturnType<typeof buildSankey>,
    pred: (n: { name: string }) => boolean,
    side: "in" | "out"
  ) => {
    const idx = data.nodes.findIndex(pred);
    return data.links
      .filter((l) => (side === "in" ? l.target : l.source) === idx)
      .reduce((s, l) => s + l.value, 0);
  };

  it("adds a Сбережения outflow when income exceeds expenses", () => {
    const data = buildSankey([
      tx({ kind: "income", category: "Зарплата", amount: 1000 }),
      tx({ kind: "expense", category: "Еда", amount: 600 }),
    ]);
    const savings = data.nodes.find((n) => n.kind === "savings");
    expect(savings?.name).toBe("Сбережения");
    expect(data.nodes.some((n) => n.kind === "funding")).toBe(false);
    // budget node stays balanced: 1000 in, 600 expense + 400 savings out
    expect(sumLinks(data, (n) => n.name === "Бюджет", "in")).toBe(1000);
    expect(sumLinks(data, (n) => n.name === "Бюджет", "out")).toBe(1000);
    expect(sumLinks(data, (n) => n.name === "Сбережения", "in")).toBe(400);
  });

  it("adds an Из накоплений inflow when expenses exceed income", () => {
    const data = buildSankey([
      tx({ kind: "income", category: "Зарплата", amount: 400 }),
      tx({ kind: "expense", category: "Еда", amount: 1000 }),
    ]);
    const funding = data.nodes.find((n) => n.kind === "funding");
    expect(funding?.name).toBe("Из накоплений");
    expect(data.nodes.some((n) => n.kind === "savings")).toBe(false);
    // budget node stays balanced: 400 income + 600 funding in, 1000 expense out
    expect(sumLinks(data, (n) => n.name === "Бюджет", "in")).toBe(1000);
    expect(sumLinks(data, (n) => n.name === "Бюджет", "out")).toBe(1000);
    expect(sumLinks(data, (n) => n.name === "Из накоплений", "out")).toBe(600);
  });

  it("adds neither node when income equals expenses", () => {
    const data = buildSankey([
      tx({ kind: "income", category: "Зарплата", amount: 500 }),
      tx({ kind: "expense", category: "Еда", amount: 500 }),
    ]);
    expect(data.nodes.some((n) => n.kind === "savings")).toBe(false);
    expect(data.nodes.some((n) => n.kind === "funding")).toBe(false);
  });
});

describe("fireSeries — rolling months-of-life", () => {
  it("months = net worth ÷ rolling avg obligatory expense", () => {
    // Three months, 100 obligatory expense each. Net worth is seeded flat at
    // 1200 via the passed series. avg obligatory = 100 → months = 12.
    const txs = ["01", "02", "03"].map((m, i) =>
      tx({
        id: "e" + i,
        date: `2026-${m}-15`,
        kind: "expense",
        category: "Аренда",
        amount: 100,
        amountBase: 100,
      })
    );
    const netWorth = [
      { date: "2026-01-15", net: 1200 },
      { date: "2026-02-15", net: 1200 },
      { date: "2026-03-15", net: 1200 },
    ];
    // Add 300 income each month to check the rolling income series too.
    const withIncome = [
      ...txs,
      ...["01", "02", "03"].map((m, i) =>
        tx({ id: "i" + i, date: `2026-${m}-10`, kind: "income", amount: 300, amountBase: 300 })
      ),
    ];
    const series = fireSeries(netWorth, withIncome, {});
    expect(series).toHaveLength(3);
    // Every month's trailing-average obligatory spend is 100, income 300.
    expect(series.every((p) => p.avgObligatory === 100)).toBe(true);
    expect(series.every((p) => p.avgIncome === 300)).toBe(true);
    expect(series[2].months).toBeCloseTo(12, 5);
  });

  it("optional categories don't count toward the obligatory denominator", () => {
    const txs = [
      tx({ id: "o", date: "2026-01-15", kind: "expense", category: "Развлечения", amount: 500, amountBase: 500 }),
      tx({ id: "r", date: "2026-01-16", kind: "expense", category: "Аренда", amount: 100, amountBase: 100 }),
      tx({ id: "o2", date: "2026-02-15", kind: "expense", category: "Развлечения", amount: 500, amountBase: 500 }),
      tx({ id: "r2", date: "2026-02-16", kind: "expense", category: "Аренда", amount: 100, amountBase: 100 }),
    ];
    const netWorth = [
      { date: "2026-01-16", net: 1000 },
      { date: "2026-02-16", net: 1000 },
    ];
    // «Развлечения» is optional; only «Аренда» (100/mo) is the denominator.
    const series = fireSeries(netWorth, txs, { "Развлечения": { required: false } });
    expect(series[1].avgObligatory).toBe(100);
    // All-expense average still counts «Развлечения»: (500+100)/mo = 600.
    expect(series[1].avgExpenseAll).toBe(600);
    expect(series[1].months).toBeCloseTo(10, 5);
  });

  it("ignores an epoch/1970 net-worth point when choosing the chart start (issue #35)", () => {
    const txs = [
      tx({ id: "a", date: "2026-01-15", kind: "expense", category: "Аренда", amount: 100, amountBase: 100 }),
      tx({ id: "b", date: "2026-02-15", kind: "expense", category: "Аренда", amount: 100, amountBase: 100 }),
    ];
    // A phantom 1970 net-worth point must NOT drag the axis back ~56 years.
    const netWorth = [
      { date: "1970-01-01", net: 1000 },
      { date: "2026-01-15", net: 1000 },
      { date: "2026-02-15", net: 1000 },
    ];
    const series = fireSeries(netWorth, txs, {});
    expect(series[0].ym).toBe("2026-01");
    expect(series.length).toBeLessThanOrEqual(3); // 2026 months, not 670+ from 1970
  });

  it("ignores a 1970-dated transaction when choosing the start (issue #35)", () => {
    const txs = [
      tx({ id: "old", date: "1970-01-05", kind: "expense", category: "Аренда", amount: 100, amountBase: 100 }),
      tx({ id: "a", date: "2026-01-15", kind: "expense", category: "Аренда", amount: 100, amountBase: 100 }),
    ];
    const netWorth = [
      { date: "1970-01-05", net: 900 },
      { date: "2026-01-15", net: 1000 },
    ];
    const series = fireSeries(netWorth, txs, {});
    expect(series[0].ym).toBe("2026-01");
  });
});

describe("statsByDayOfWeek / statsByHourOfWeek — refund-aware totals (issue #36)", () => {
  const txs = [
    tx({ kind: "expense", amountBase: 100, date: "2026-01-05" }), // Monday
    tx({ kind: "refund", amountBase: 30, date: "2026-01-05" }),
    tx({ kind: "income", amountBase: 500, date: "2026-01-06" }),
  ];

  it("statsByDayOfWeek nets refunds out of the expense total (matches Categories)", () => {
    const total = statsByDayOfWeek(txs, "expense").reduce((s, b) => s + b.total, 0);
    expect(total).toBe(70); // 100 expense − 30 refund, not 100
  });

  it("statsByHourOfWeek nets refunds out of the expense total", () => {
    const total = statsByHourOfWeek(txs, "expense").reduce((s, c) => s + c.total, 0);
    expect(total).toBe(70);
  });

  it("income total is unaffected by refunds/expenses", () => {
    const total = statsByDayOfWeek(txs, "income").reduce((s, b) => s + b.total, 0);
    expect(total).toBe(500);
  });
});

describe("transferTotals — «Переводы» и «Накопления» (issue #42)", () => {
  const SAV = new Set(["Вклад", "Сейв", "ИИС"]);
  const xf = (from: string, to: string, amount: number) =>
    tx({
      kind: "transfer",
      amount,
      amountBase: amount,
      outcomeAccount: from,
      incomeAccount: to,
    });

  it("«Переводы» — сумма всех переводов, той же формулой, что и значок дня", () => {
    const txs = [
      xf("Карта", "Вклад", 1000),
      xf("Вклад", "Карта", 400),
      tx({ kind: "expense", amount: 50, amountBase: 50 }),
      tx({ kind: "income", amount: 70, amountBase: 70 }),
    ];
    expect(transferTotals(txs, SAV).xfer).toBe(1400);
  });

  it("перевод НА накопительный счёт — с плюсом", () => {
    expect(transferTotals([xf("Карта", "Вклад", 1000)], SAV).savings).toBe(1000);
  });

  it("перевод С накопительного счёта — с минусом", () => {
    expect(transferTotals([xf("Вклад", "Карта", 1000)], SAV).savings).toBe(-1000);
  });

  it("накопительный → накопительный даёт ноль и не учитывается", () => {
    expect(transferTotals([xf("Вклад", "Сейв", 1000)], SAV).savings).toBe(0);
  });

  it("ноль по накопительным даже при разных суммах ног (валютный перевод)", () => {
    // Ноги валютного перевода не равны — сложение ± оставило бы курсовой хвост.
    const t = tx({
      kind: "transfer",
      amount: 1000,
      amountBase: 1000,
      outcomeAccount: "Вклад",
      incomeAccount: "ИИС",
      outcomeAmount: 1000,
      incomeAmount: 1013,
    });
    expect(transferTotals([t], SAV).savings).toBe(0);
  });

  it("переводы между обычными счетами не трогают «Накопления»", () => {
    expect(transferTotals([xf("Карта", "Наличные", 500)], SAV).savings).toBe(0);
  });

  it("доходы и расходы в расчёт не входят", () => {
    const txs = [
      tx({ kind: "income", amount: 900, amountBase: 900, incomeAccount: "Вклад" }),
      tx({ kind: "expense", amount: 300, amountBase: 300, outcomeAccount: "Вклад" }),
    ];
    expect(transferTotals(txs, SAV)).toEqual({ xfer: 0, savings: 0 });
  });

  it("без накопительных счетов (CSV-режим) — только «Переводы»", () => {
    expect(transferTotals([xf("Карта", "Вклад", 1000)], new Set())).toEqual({
      xfer: 1000,
      savings: 0,
    });
  });

  it("итог = сумма пополнений минус изъятия", () => {
    const txs = [
      xf("Карта", "Вклад", 5000),
      xf("Карта", "Сейв", 3000),
      xf("Вклад", "Сейв", 2000), // между накопительными — ноль
      xf("Сейв", "Карта", 1500),
    ];
    expect(transferTotals(txs, SAV)).toEqual({ xfer: 11500, savings: 6500 });
  });
});

describe("stripFromAnalytics — per-category + off-balance exclusion (#14)", () => {
  const txs = [
    tx({ kind: "expense", category: "Еда", categoryFull: "Еда", amount: 100, amountBase: 100 }),
    tx({ kind: "expense", category: "Еда", subcategory: "Кафе", categoryFull: "Еда / Кафе", amount: 40, amountBase: 40 }),
    tx({ kind: "income", category: "Возмещения", categoryFull: "Возмещения", amount: 500, amountBase: 500 }),
    tx({ kind: "expense", category: "Техника", categoryFull: "Техника", account: "Брокер", amount: 70, amountBase: 70 }),
  ];

  it("returns the SAME reference when nothing is excluded", () => {
    expect(stripFromAnalytics(txs)).toBe(txs);
    expect(stripFromAnalytics(txs, {})).toBe(txs);
    expect(stripFromAnalytics(txs, { excludedCategories: new Set(), offBalanceTitles: new Set() })).toBe(txs);
  });

  it("excluding a ROOT category drops the root and all its subs", () => {
    const out = stripFromAnalytics(txs, { excludedCategories: new Set(["Еда"]) });
    expect(out.map((t) => t.categoryFull)).toEqual(["Возмещения", "Техника"]);
  });

  it("excluding a SUB category drops only that sub, keeping the root", () => {
    const out = stripFromAnalytics(txs, { excludedCategories: new Set(["Еда / Кафе"]) });
    expect(out.map((t) => t.categoryFull)).toEqual(["Еда", "Возмещения", "Техника"]);
  });

  it("off-balance titles drop flows touching that account", () => {
    const out = stripFromAnalytics(txs, { offBalanceTitles: new Set(["Брокер"]) });
    expect(out.map((t) => t.category)).toEqual(["Еда", "Еда", "Возмещения"]);
  });

  it("off-balance drop checks all transfer legs", () => {
    const xfer = tx({ kind: "transfer", category: "Перевод", categoryFull: "Перевод", account: "Карта", outcomeAccount: "Карта", incomeAccount: "Брокер", amount: 200, amountBase: 200 });
    const out = stripFromAnalytics([xfer], { offBalanceTitles: new Set(["Брокер"]) });
    expect(out).toHaveLength(0);
  });

  it("categories and off-balance combine", () => {
    const out = stripFromAnalytics(txs, {
      excludedCategories: new Set(["Возмещения"]),
      offBalanceTitles: new Set(["Брокер"]),
    });
    expect(out.map((t) => t.categoryFull)).toEqual(["Еда", "Еда / Кафе"]);
  });
});

describe("scaleKPI", () => {
  const kpi = {
    income: 300,
    expense: 150,
    net: 150,
    count: 9,
    avgExpense: 50,
    avgIncome: 100,
    daysSpan: 90,
    uniqueCategories: 4,
    uniquePayees: 7,
  };

  it("делит складываемые величины на число периодов", () => {
    const s = scaleKPI(kpi, 3);
    expect(s.income).toBe(100);
    expect(s.expense).toBe(50);
    expect(s.net).toBe(50);
    expect(s.count).toBe(3);
    expect(s.daysSpan).toBe(30);
  });

  it("НЕ трогает средние на операцию — их делить бессмысленно", () => {
    const s = scaleKPI(kpi, 3);
    expect(s.avgExpense).toBe(kpi.avgExpense);
    expect(s.avgIncome).toBe(kpi.avgIncome);
  });

  it("НЕ трогает счётчики различных категорий и получателей", () => {
    const s = scaleKPI(kpi, 3);
    expect(s.uniqueCategories).toBe(kpi.uniqueCategories);
    expect(s.uniquePayees).toBe(kpi.uniquePayees);
  });

  it("один период и меньше оставляют KPI как есть", () => {
    expect(scaleKPI(kpi, 1)).toBe(kpi);
    expect(scaleKPI(kpi, 0)).toBe(kpi);
  });
});

describe("stackedBalanceByAccount — issue #59", () => {
  const last = (r: { series: StackedBalancePoint[] }) => r.series[r.series.length - 1];

  it("счёт с нулевым остатком заканчивается нулём, а не накопленным потоком", () => {
    // «Наличные»: за историю пришло 5 000 переводом, реальный остаток — 0.
    // Без якоря линия показывала +5 000, и «Итого» расходилось с совокупным
    // балансом ровно на эту величину.
    const txs = [
      tx({ date: "2026-01-10", kind: "transfer", outcomeAccount: "Карта", incomeAccount: "Наличные", amount: 5000 }),
      tx({ date: "2026-03-10", kind: "income", incomeAccount: "Карта", amount: 12000 }),
    ];
    const r = stackedBalanceByAccount(txs, 8, { Карта: 7000, Наличные: 0 });
    const p = last(r);
    expect(p["Наличные"]).toBe(0);
    expect(p["Карта"]).toBe(7000);
    // «Итого» = совокупный баланс по API.
    expect(p.total).toBe(7000);
  });

  it("операция 1970 года не создаёт точку на оси, но её поток сохраняется", () => {
    // Дзен-мани отдаёт legacy-записи с эпоховой датой. Одна такая растягивала
    // ось на полвека, и реальный диапазон схлопывался в правый край.
    const txs = [
      tx({ date: "1970-01-01", kind: "income", incomeAccount: "Карта", amount: 300 }),
      tx({ date: "2026-08-01", kind: "income", incomeAccount: "Карта", amount: 1000 }),
    ];
    const r = stackedBalanceByAccount(txs, 8);
    expect(r.series.map((s) => s.date)).toEqual(["2026-08-01"]);
    // Поток «эпоховой» операции ушёл в стартовое значение линии: 300 + 1000.
    expect(last(r)["Карта"]).toBe(1300);
  });

  it("с якорем эпоховая операция не сдвигает конечный остаток", () => {
    const txs = [
      tx({ date: "1970-01-01", kind: "expense", outcomeAccount: "Карта", amount: 500 }),
      tx({ date: "2026-08-01", kind: "income", incomeAccount: "Карта", amount: 1000 }),
    ];
    const r = stackedBalanceByAccount(txs, 8, { Карта: 9000 });
    expect(r.series.map((s) => s.date)).toEqual(["2026-08-01"]);
    expect(last(r)["Карта"]).toBe(9000);
  });
});

describe("stackedBalanceByAccount — отбор счетов для графика", () => {
  const last = (r: { series: StackedBalancePoint[] }) => r.series[r.series.length - 1];
  const real = { Карта: 7000, Наличные: 3000, Вклад: 50_000, Копилка: 1000 };
  const txs = [
    tx({ date: "2026-01-10", kind: "income", incomeAccount: "Карта", amount: 1000 }),
    tx({ date: "2026-02-10", kind: "income", incomeAccount: "Наличные", amount: 2000 }),
    tx({ date: "2026-03-10", kind: "income", incomeAccount: "Вклад", amount: 5000 }),
    tx({ date: "2026-03-11", kind: "income", incomeAccount: "Копилка", amount: 500 }),
  ];

  it("без отбора — прежнее поведение: топ-N и «Прочие»", () => {
    const r = stackedBalanceByAccount(txs, 2, real);
    expect(r.accounts).toEqual(["Вклад", "Карта", "Прочие"]);
    expect(last(r).total).toBe(61_000);
  });

  it("пустой список считается как «без отбора»", () => {
    const r = stackedBalanceByAccount(txs, 2, real, null, []);
    expect(r.accounts).toEqual(["Вклад", "Карта", "Прочие"]);
  });

  it("с отбором — ровно выбранные счета, без «Прочих»", () => {
    const r = stackedBalanceByAccount(txs, 8, real, null, ["Карта", "Наличные"]);
    expect(r.accounts).toEqual(["Карта", "Наличные"]);
    expect(r.accounts).not.toContain("Прочие");
    // «Итого» — сумма выбранных, а НЕ совокупный баланс: 50 000 «Вклада» в
    // стопку не попали ни слоем, ни в «Прочие».
    expect(last(r).total).toBe(10_000);
    expect(last(r)["Карта"]).toBe(7000);
    expect(last(r)["Наличные"]).toBe(3000);
  });

  it("слои идут по весу счёта, а не в порядке выбора", () => {
    const r = stackedBalanceByAccount(txs, 8, real, null, ["Наличные", "Вклад"]);
    expect(r.accounts).toEqual(["Вклад", "Наличные"]);
  });

  it("«Прочие» из одного счёта не собираем — показываем его своим слоем", () => {
    // Счетов ровно на один больше, чем слоёв: свалка из одного счёта ничего не
    // обобщает, только прячет его название.
    const r = stackedBalanceByAccount(txs, 3, real);
    expect(r.accounts).toEqual(["Вклад", "Карта", "Наличные", "Копилка"]);
    expect(r.accounts).not.toContain("Прочие");
    expect(last(r).total).toBe(61_000);
  });

  it("счёт без операций тоже считается «лишним» — «Прочие» из него не делаем", () => {
    // «Копилка» есть только в остатках: правило должно видеть и такие счета,
    // иначе рядом с тремя слоями встали бы «Прочие» с одной «Копилкой».
    const noOps = txs.filter((t) => t.incomeAccount !== "Копилка");
    const r = stackedBalanceByAccount(noOps, 3, real);
    expect(r.accounts).toContain("Копилка");
    expect(r.accounts).not.toContain("Прочие");
    expect(last(r)["Копилка"]).toBe(1000);
  });

  it("дни чужих операций остаются на оси — линия не рвётся", () => {
    // Выбрана одна «Карта», а операции есть и по другим счетам. Без сохранения
    // дней ось схлопнулась бы до одной точки 10 января.
    const r = stackedBalanceByAccount(txs, 8, real, null, ["Карта"]);
    expect(r.series.map((s) => s.date)).toEqual([
      "2026-01-10",
      "2026-02-10",
      "2026-03-10",
      "2026-03-11",
    ]);
    // Остаток «Карты» на чужих днях не меняется.
    expect(r.series.map((s) => s["Карта"])).toEqual([7000, 7000, 7000, 7000]);
  });

  it("выбранный счёт без операций рисуется своим остатком, а не пропадает", () => {
    const r = stackedBalanceByAccount(
      txs,
      8,
      { ...real, Брокерский: 12_000 },
      null,
      ["Карта", "Брокерский"]
    );
    expect(r.accounts).toEqual(["Брокерский", "Карта"]);
    expect(last(r)["Брокерский"]).toBe(12_000);
    expect(last(r).total).toBe(19_000);
  });
});

describe("дубли: разные покупки в одном магазине", () => {
  const buy = (p: Parameters<typeof tx>[0]) =>
    tx({ date: "2026-06-30", kind: "expense", amount: 500, amountBase: 500,
         payee: "Фуд Сити", account: "Кошелек", ...p });

  it("разные комментарий и категория — не дубль", () => {
    // Скриншот из жизни: «Кешью по 120» и «Томаты по 200» на 500 ₽ в один день.
    const groups = detectDuplicates([
      buy({ comment: "Кешью по 120", categoryFull: "Продукты / Орехи, семечки" }),
      buy({ comment: "Томаты по 200", categoryFull: "Продукты / Овощи, фрукты" }),
    ]);
    expect(groups).toHaveLength(0);
  });

  it("настоящая копия ловится, даже если у одной нет комментария", () => {
    // Импорт часто приносит копию без комментария — она всё ещё копия.
    const groups = detectDuplicates([
      buy({ comment: "Кешью по 120", categoryFull: "Продукты / Орехи, семечки" }),
      buy({ comment: "", categoryFull: "Продукты / Орехи, семечки" }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it("одинаковые комментарии — по-прежнему дубль", () => {
    const groups = detectDuplicates([
      buy({ comment: "Кешью по 120" }),
      buy({ comment: "Кешью по 120" }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it("различие только в категории тоже разводит операции", () => {
    const groups = detectDuplicates([
      buy({ categoryFull: "Продукты / Орехи, семечки" }),
      buy({ categoryFull: "Продукты / Овощи, фрукты" }),
    ]);
    expect(groups).toHaveLength(0);
  });
});

describe("дубли: подкатегории", () => {
  const buy = (p: Parameters<typeof tx>[0]) =>
    tx({ date: "2026-06-30", kind: "expense", amount: 500, amountBase: 500,
         payee: "Фуд Сити", account: "Кошелек", ...p });

  it("соседние подкатегории одной категории — не дубль", () => {
    expect(detectDuplicates([
      buy({ categoryFull: "Продукты / Орехи, семечки" }),
      buy({ categoryFull: "Продукты / Овощи, фрукты" }),
    ])).toHaveLength(0);
  });

  it("категория и её подкатегория не спорят — это уточнение", () => {
    // Копию могли уточнить руками до подкатегории, а вторую оставить как есть.
    expect(detectDuplicates([
      buy({ categoryFull: "Продукты" }),
      buy({ categoryFull: "Продукты / Орехи, семечки" }),
    ])).toHaveLength(1);
  });

  it("одинаковая подкатегория — дубль", () => {
    expect(detectDuplicates([
      buy({ categoryFull: "Продукты / Орехи, семечки" }),
      buy({ categoryFull: "Продукты / Орехи, семечки" }),
    ])).toHaveLength(1);
  });
});

describe("дубли: копейки", () => {
  const fee = (amount: number) =>
    tx({ date: "2023-11-27", kind: "expense", amount, amountBase: amount,
         payee: "", account: "И_Т_ИИС", categoryFull: "Инвестиции / Комиссия" });

  it("комиссии 0,22 и 0,01 — разные операции", () => {
    // Округление до целых рублей делало обе нулём и склеивало в одну группу.
    expect(detectDuplicates([fee(0.22), fee(0.01)])).toHaveLength(0);
  });

  it("одинаковые копеечные суммы по-прежнему дубль", () => {
    expect(detectDuplicates([fee(0.22), fee(0.22)])).toHaveLength(1);
  });

  it("10 и 20 копеек — разные суммы", () => {
    expect(detectDuplicates([fee(0.1), fee(0.2)])).toHaveLength(0);
  });

  it("одна и та же сумма с погрешностью округления — всё ещё дубль", () => {
    // Не «0,1 против 0,2»: обе операции на 30 копеек, просто одна получилась
    // сложением и хранится как 0.30000000000000004.
    expect(detectDuplicates([fee(0.1 + 0.2), fee(0.3)])).toHaveLength(1);
  });

  it("рубли не склеиваются с соседними", () => {
    expect(detectDuplicates([fee(100.4), fee(99.6)])).toHaveLength(0);
  });
});

describe("привязка кривой к реальным остаткам", () => {
  it("конец кривой садится ровно на сумму остатков, форма не меняется", () => {
    // Операции объясняют только 300 из 500: остальное — курсовая переоценка и
    // прочее, чего в потоках нет. Раньше кривая на этом и заканчивалась.
    const txs = [
      tx({ kind: "income", incomeAccount: "A", amountBase: 100, date: "2024-01-01" }),
      tx({ kind: "income", incomeAccount: "A", amountBase: 200, date: "2024-02-01" }),
    ];
    const opts = { accounts: new Set(["A"]), anchorTo: 500 };
    const s = netWorthSeries(txs, null, opts);
    expect(s[s.length - 1].net).toBe(500);
    // Сдвиг общий, поэтому расстояние между точками осталось прежним.
    expect(s[1].net - s[0].net).toBe(200);
  });

  it("без привязки всё как было", () => {
    const txs = [tx({ kind: "income", incomeAccount: "A", amountBase: 100, date: "2024-01-01" })];
    const s = netWorthSeries(txs, null, { accounts: new Set(["A"]) });
    expect(s[s.length - 1].net).toBe(100);
  });

  it("ручная калибровка сильнее привязки", () => {
    // Калибровка — заявление человека «на эту дату у меня было столько».
    const txs = [
      tx({ kind: "income", incomeAccount: "A", amountBase: 100, date: "2024-01-01" }),
      tx({ kind: "income", incomeAccount: "A", amountBase: 100, date: "2024-02-01" }),
    ];
    const s = netWorthSeries(txs, { date: "2024-02-01", amount: 1000 }, {
      accounts: new Set(["A"]),
      anchorTo: 999999,
    });
    expect(s[s.length - 1].net).toBe(1000);
  });

  it("пустая история не падает и не выдумывает точку", () => {
    expect(netWorthSeries([], null, { accounts: new Set(["A"]), anchorTo: 500 })).toEqual([]);
  });
});


describe("stackedBalanceByAccount — долговой счёт по контрагентам", () => {
  // В Дзен-мани все долги лежат на одном счёте, и «сколько должен Иван» из
  // общего остатка не видно. Разбивка выделяет контрагента отдельным слоем.
  // Сумма перевода всегда положительна, направление задают ноги: «дали в долг»
  // — деньги ушли на счёт «Долги», «вернули» — с него.
  const debt = (
    id: string,
    date: string,
    payee: string,
    amount: number,
    lent: boolean
  ) =>
    ({
      id,
      date,
      amount,
      amountBase: amount,
      currency: "RUB",
      kind: "transfer",
      payee,
      account: lent ? "Сбер" : "Долги",
      outcomeAccount: lent ? "Сбер" : "Долги",
      incomeAccount: lent ? "Долги" : "Сбер",
      category: "Долг",
      categoryFull: "Долг",
    }) as unknown as Transaction;

  const txs = [
    debt("d1", "2026-01-10", "Иван", 1000, true),
    debt("d2", "2026-02-10", "Мария", 500, true),
    debt("d3", "2026-03-10", "Иван", 400, false),
  ];

  it("выбранный контрагент идёт своим слоем, остальные остаются на счёте", () => {
    const split = new Map([["Долги", new Set(["Иван"])]]);
    const { accounts, series } = stackedBalanceByAccount(
      txs,
      9,
      null,
      null,
      ["Долги", "Долги\u0000Иван", "Сбер"],
      split
    );
    expect(accounts).toContain("Долги\u0000Иван");
    const last = series[series.length - 1];
    // Иван: дали 1000, вернул 400 → 600. Мария осталась на самом счёте: 500.
    expect(last["Долги\u0000Иван"]).toBe(600);
    expect(last["Долги"]).toBe(500);
  });

  it("без разбивки всё лежит на счёте — как и раньше", () => {
    const { series } = stackedBalanceByAccount(txs, 9, null, null, ["Долги"]);
    expect(series[series.length - 1]["Долги"]).toBe(1100);
  });

  it("итог стопки от разбивки не меняется", () => {
    const plain = stackedBalanceByAccount(txs, 9, null, null, ["Долги", "Сбер"]);
    const split = stackedBalanceByAccount(
      txs,
      9,
      null,
      null,
      ["Долги", "Долги\u0000Иван", "Сбер"],
      new Map([["Долги", new Set(["Иван"])]])
    );
    const totalOf = (s: { total: number }[]) => s[s.length - 1].total;
    expect(totalOf(split.series)).toBe(totalOf(plain.series));
  });
});
