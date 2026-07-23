import { describe, it, expect } from "vitest";
import {
  groupByCategory,
  computeKPI,
  cumulativeNetAt,
  extractHashtags,
  detectDuplicates,
  hashtagCategoryTrees,
  detectRecurring,
  stackedBalanceByAccount,
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
} from "./aggregations";
import { tx } from "../test/fixtures";
import type { CurrencyRates } from "../types";

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

  it("ranks top accounts by real balance (not turnover) in API mode", () => {
    const t = [
      // C: huge turnover, tiny balance — would top a turnover ranking.
      tx({ kind: "income", amount: 1_000_000, incomeAccount: "C", date: "2026-01-01" }),
      tx({ kind: "expense", amount: 999_000, outcomeAccount: "C", date: "2026-01-02" }),
      tx({ kind: "income", amount: 100, incomeAccount: "A", date: "2026-01-01" }),
      tx({ kind: "income", amount: 100, incomeAccount: "B", date: "2026-01-01" }),
    ];
    const { accounts } = stackedBalanceByAccount(t, 2, { A: 900_000, B: 800_000, C: 1000 });
    expect(accounts).toEqual(expect.arrayContaining(["A", "B", "Прочие"]));
    expect(accounts).not.toContain("C"); // small balance → folded into «Прочие»
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
    title: "X", currency: "RUB", startBalance: 0, startDate: null, archive: false, inBalance: true, ...over,
  });

  it("includes only non-archived in-balance accounts and dates openings", () => {
    const live = [
      acc({ title: "A", startBalance: 100000, startDate: "2020-01-01" }),
      acc({ title: "B", startBalance: 5000, startDate: null }), // no startDate → earliest tx
      acc({ title: "Old", startBalance: 9, archive: true }),
      acc({ title: "Off", startBalance: 9, inBalance: false }),
    ];
    const txs = [tx({ account: "B", outcomeAccount: "B", date: "2021-03-01" })];
    const { accounts, openings } = netWorthBasis(live, txs, RUB, false);
    expect([...accounts].sort()).toEqual(["A", "B"]);
    expect(openings).toContainEqual({ date: "2020-01-01", amount: 100000 });
    expect(openings).toContainEqual({ date: "2021-03-01", amount: 5000 }); // fell back to first tx
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
