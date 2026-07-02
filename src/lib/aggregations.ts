import type { Transaction, CurrencyRates } from "../types";
import { ymKey, ymdKey } from "./format";
import { periodKey } from "./period";
import { affectsExpense, expenseDelta } from "./txKindStyle";

export interface MonthBucket {
  ym: string;
  income: number;
  expense: number;
  net: number;
  count: number;
}

/**
 * Group transactions by month bucket.
 *
 * `monthStartDay` lets callers respect the user's reporting-period
 * setting — passing `11` makes every period span e.g. `11/05 → 10/06`
 * and the bucket key is `YYYY-MM` of the start month. Default `1`
 * collapses to plain calendar months (the historical behaviour).
 */
export function groupByMonth(
  txs: Transaction[],
  opts: { monthStartDay?: number } = {}
): MonthBucket[] {
  const startDay = opts.monthStartDay ?? 1;
  const map = new Map<string, MonthBucket>();
  for (const t of txs) {
    if (t.kind === "transfer") continue;
    const ym = startDay === 1 ? ymKey(t.date) : periodKey(t.date, startDay);
    if (!ym) continue;
    let b = map.get(ym);
    if (!b) {
      b = { ym, income: 0, expense: 0, net: 0, count: 0 };
      map.set(ym, b);
    }
    if (t.kind === "income") b.income += t.amountBase;
    else if (t.kind === "refund") {
      // Refund is an inflow on the account but logically a *reversal*
      // of a previous expense — so it shrinks the expense bucket
      // rather than swelling income. See `TxKind` doc in `types.ts`.
      b.expense -= t.amountBase;
    } else b.expense += t.amountBase;
    b.count++;
  }
  for (const b of map.values()) b.net = b.income - b.expense;
  return Array.from(map.values()).sort((a, b) => a.ym.localeCompare(b.ym));
}

export interface CategoryBucket {
  category: string;
  expense: number;
  income: number;
  net: number;
  count: number;
}

export function groupByCategory(
  txs: Transaction[],
  level: "top" | "full" = "top"
): CategoryBucket[] {
  const map = new Map<string, CategoryBucket>();
  for (const t of txs) {
    if (t.kind === "transfer") continue;
    const key = level === "top" ? t.category : t.categoryFull;
    let b = map.get(key);
    if (!b) {
      b = { category: key, expense: 0, income: 0, net: 0, count: 0 };
      map.set(key, b);
    }
    if (t.kind === "income") b.income += t.amountBase;
    else if (t.kind === "refund") {
      // Refund reduces this category's expense total — that's the
      // whole point of refunds in Zenmoney's data model.
      b.expense -= t.amountBase;
    } else b.expense += t.amountBase;
    b.count++;
  }
  for (const b of map.values()) b.net = b.income - b.expense;
  return Array.from(map.values()).sort((a, b) => b.expense - a.expense);
}

export interface AccountBalance {
  account: string;
  balance: number;
  income: number;
  expense: number;
  count: number;
}

export function balancesByAccount(txs: Transaction[]): AccountBalance[] {
  const map = new Map<string, AccountBalance>();
  for (const t of txs) {
    const accs: { acc: string; delta: number }[] = [];
    if (t.kind === "expense") accs.push({ acc: t.outcomeAccount, delta: -t.amountBase });
    else if (t.kind === "income" || t.kind === "refund") {
      // Refund is a real cash inflow on the account (the merchant
      // gave money back to the card), so the account's running
      // balance grows just like with regular income. The semantic
      // difference vs. income only matters at the category / KPI
      // level, not at the account level.
      accs.push({ acc: t.incomeAccount, delta: t.amountBase });
    } else if (t.kind === "transfer") {
      accs.push({ acc: t.outcomeAccount, delta: -t.amountBase });
      accs.push({ acc: t.incomeAccount, delta: t.amountBase });
    }
    for (const { acc, delta } of accs) {
      if (!acc) continue;
      let b = map.get(acc);
      if (!b) {
        b = { account: acc, balance: 0, income: 0, expense: 0, count: 0 };
        map.set(acc, b);
      }
      b.balance += delta;
      if (delta > 0) b.income += delta;
      else b.expense += -delta;
      b.count++;
    }
  }
  return Array.from(map.values()).sort((a, b) => b.balance - a.balance);
}

export interface DailyPoint {
  date: string;
  balance: number;
  delta: number;
}

export function dailyBalanceSeries(
  txs: Transaction[],
  account?: string
): DailyPoint[] {
  const days = new Map<string, number>();
  for (const t of txs) {
    const d = ymdKey(t.date);
    if (!d) continue;
    let delta = 0;
    if (account) {
      // Refund is an inflow on the account-of-record, same as income.
      if (t.outcomeAccount === account && (t.kind === "expense" || t.kind === "transfer")) delta -= t.amountBase;
      if (t.incomeAccount === account && (t.kind === "income" || t.kind === "refund" || t.kind === "transfer")) delta += t.amountBase;
    } else {
      if (t.kind === "income" || t.kind === "refund") delta += t.amountBase;
      else if (t.kind === "expense") delta -= t.amountBase;
    }
    if (delta !== 0) days.set(d, (days.get(d) || 0) + delta);
  }
  const sorted = Array.from(days.keys()).sort();
  let bal = 0;
  return sorted.map((d) => {
    bal += days.get(d)!;
    return { date: d, balance: bal, delta: days.get(d)! };
  });
}

export interface StackedBalancePoint {
  date: string;
  total: number;
  [account: string]: number | string;
}

export function stackedBalanceByAccount(
  allTxs: Transaction[],
  topN = 8,
  /** Real current balance per account title (base currency), API mode only.
   *  When given, each line is shifted to END at the real balance — turning the
   *  «накопленный поток с нуля» into an actual balance-over-time, so the stack
   *  sums to real net worth and funded accounts don't sink below zero. */
  realBalances?: Record<string, number | null> | null,
  /** Ids of unsynced local drafts that ARE walked in `allTxs` but are NOT yet
   *  reflected in `realBalances` (cloud truth from the API). They stay in the
   *  line SHAPE, but are excluded from the real-balance anchor reconciliation —
   *  so the line ends at the projected balance (cloud + draft) and the whole
   *  historical baseline isn't shifted down by the draft amount. Issue #18. */
  unsyncedIds?: Set<string> | null
): { series: StackedBalancePoint[]; accounts: string[] } {
  const balances = balancesByAccount(allTxs);
  // Pick the «biggest» accounts. With real balances (API mode, where the chart
  // shows actual balances) rank by |real balance| — so the largest accounts by
  // money get their own area and small ones fold into «Прочие». Without them
  // (CSV) rank by turnover + net flow, since that's all we have.
  const score = (b: { account: string; balance: number; income: number; expense: number }) =>
    realBalances
      ? Math.abs(realBalances[b.account] ?? 0)
      : Math.abs(b.balance) + b.income + b.expense;
  const topAccounts = balances
    .slice()
    .sort((a, b) => score(b) - score(a))
    .slice(0, topN)
    .map((b) => b.account);
  const accountSet = new Set(topAccounts);

  const days = new Map<string, Map<string, number>>();
  // Per-account flow contributed by unsynced drafts, binned the same way as
  // `days`. Subtracted from the running total before anchoring so the cloud
  // balance reconciles against the synced flow only (issue #18).
  const unsyncedFlow = new Map<string, number>();
  for (const t of allTxs) {
    const d = ymdKey(t.date);
    if (!d) continue;
    const unsynced = unsyncedIds ? unsyncedIds.has(t.id) : false;
    const apply = (acc: string, delta: number) => {
      if (!acc) return;
      const key = accountSet.has(acc) ? acc : "Прочие";
      let dayMap = days.get(d);
      if (!dayMap) {
        dayMap = new Map();
        days.set(d, dayMap);
      }
      dayMap.set(key, (dayMap.get(key) || 0) + delta);
      if (unsynced) unsyncedFlow.set(key, (unsyncedFlow.get(key) || 0) + delta);
    };
    if (t.kind === "expense") apply(t.outcomeAccount, -t.amountBase);
    else if (t.kind === "income" || t.kind === "refund") {
      // Refund is a cash inflow on the account — treat like income for
      // the running stacked-balance series.
      apply(t.incomeAccount, t.amountBase);
    } else if (t.kind === "transfer") {
      apply(t.outcomeAccount, -t.amountBase);
      apply(t.incomeAccount, t.amountBase);
    }
  }

  const accountList = [...topAccounts];
  const hasOther = Array.from(days.values()).some((m) => m.has("Прочие"));
  if (hasOther) accountList.push("Прочие");

  const sortedDates = Array.from(days.keys()).sort();
  const running: Record<string, number> = {};
  for (const a of accountList) running[a] = 0;

  const series: StackedBalancePoint[] = [];
  for (const date of sortedDates) {
    const dayMap = days.get(date)!;
    for (const a of accountList) {
      running[a] += dayMap.get(a) || 0;
    }
    const point: StackedBalancePoint = { date, total: 0 };
    let total = 0;
    for (const a of accountList) {
      point[a] = Math.round(running[a]);
      total += running[a];
    }
    point.total = Math.round(total);
    series.push(point);
  }

  // Anchor to real balances (API mode): after the loop, `running[a]` is each
  // account's cumulative flow at the last day. Shift the whole line by a
  // constant so it ends at the real balance; the day-to-day shape (real flows)
  // is preserved. «Прочие» is anchored to the combined real balance of every
  // account that isn't one of the shown top ones.
  if (realBalances) {
    const topSet = new Set(accountList.filter((a) => a !== "Прочие"));
    let prochieReal = 0;
    for (const [acc, bal] of Object.entries(realBalances)) {
      if (bal != null && !topSet.has(acc)) prochieReal += bal;
    }
    // Reconcile against the SYNCED flow only: the API balance excludes unsynced
    // drafts, so strip their flow from `running` before computing the shift.
    // Otherwise the whole line slides by the draft amount (issue #18) — the
    // offset becomes the true opening balance and the line ends at cloud+draft.
    const offset: Record<string, number> = {};
    for (const a of accountList) {
      const synced = (running[a] || 0) - (unsyncedFlow.get(a) || 0);
      if (a === "Прочие") {
        offset[a] = prochieReal - synced;
      } else {
        const real = realBalances[a];
        offset[a] = real == null ? 0 : real - synced;
      }
    }
    for (const point of series) {
      let total = 0;
      for (const a of accountList) {
        const v = (point[a] as number) + offset[a];
        point[a] = Math.round(v);
        total += v;
      }
      point.total = Math.round(total);
    }
  }

  return { series, accounts: accountList };
}

export interface CalibrationInput {
  date: string;
  amount: number;
}

// ============= Waterfall =============

export interface WaterfallStep {
  label: string;
  value: number;
  cumulative: number;
  kind: "open" | "income" | "expense" | "close";
  start: number;
  end: number;
}

export function buildWaterfall(
  txs: Transaction[],
  monthYM: string,
  openingBalance: number,
  topCategories = 8
): WaterfallStep[] {
  const monthTxs = txs.filter((t) => t.date.startsWith(monthYM));

  let totalIncome = 0;
  const expenseByCategory = new Map<string, number>();
  for (const t of monthTxs) {
    if (t.kind === "income") totalIncome += t.amountBase;
    else if (t.kind === "expense") {
      expenseByCategory.set(
        t.category,
        (expenseByCategory.get(t.category) || 0) + t.amountBase
      );
    } else if (t.kind === "refund") {
      // Refund reduces that category's expense bar in the waterfall.
      expenseByCategory.set(
        t.category,
        (expenseByCategory.get(t.category) || 0) - t.amountBase
      );
    }
  }

  const sortedCats = Array.from(expenseByCategory.entries()).sort(
    (a, b) => b[1] - a[1]
  );
  const top = sortedCats.slice(0, topCategories);
  const otherSum = sortedCats.slice(topCategories).reduce((s, [, v]) => s + v, 0);

  const steps: WaterfallStep[] = [];
  let cumulative = openingBalance;

  steps.push({
    label: "Начало",
    value: openingBalance,
    cumulative,
    kind: "open",
    start: 0,
    end: cumulative,
  });

  if (totalIncome > 0) {
    const start = cumulative;
    cumulative += totalIncome;
    steps.push({
      label: "Доходы",
      value: totalIncome,
      cumulative,
      kind: "income",
      start,
      end: cumulative,
    });
  }

  for (const [cat, value] of top) {
    const start = cumulative;
    cumulative -= value;
    steps.push({
      label: cat,
      value,
      cumulative,
      kind: "expense",
      start: cumulative,
      end: start,
    });
  }

  if (otherSum > 0) {
    const start = cumulative;
    cumulative -= otherSum;
    steps.push({
      label: "Прочие",
      value: otherSum,
      cumulative,
      kind: "expense",
      start: cumulative,
      end: start,
    });
  }

  steps.push({
    label: "Конец",
    value: cumulative,
    cumulative,
    kind: "close",
    start: 0,
    end: cumulative,
  });

  return steps;
}

// ============= Stream graph data =============

export interface StreamPoint {
  ym: string;
  label: string;
  [category: string]: number | string;
}

export function buildStreamData(
  txs: Transaction[],
  topCategories = 10,
  kind: "expense" | "income" = "expense"
): { data: StreamPoint[]; categories: string[] } {
  const monthsSet = new Set<string>();
  const totals = new Map<string, number>();
  const byMonthCat = new Map<string, Map<string, number>>();

  for (const t of txs) {
    // For the expense view we also include refunds, but signed
    // negative — so a refunded purchase shrinks its category's
    // ribbon, matching how Zenmoney's own reports look.
    const include = kind === "expense" ? affectsExpense(t.kind) : t.kind === kind;
    if (!include) continue;
    const ym = t.date.slice(0, 7);
    if (!ym) continue;
    monthsSet.add(ym);
    const delta = kind === "expense" ? expenseDelta(t) : t.amountBase;
    totals.set(t.category, (totals.get(t.category) || 0) + delta);
    let m = byMonthCat.get(ym);
    if (!m) {
      m = new Map();
      byMonthCat.set(ym, m);
    }
    m.set(t.category, (m.get(t.category) || 0) + delta);
  }

  const topCats = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topCategories)
    .map(([k]) => k);
  const topSet = new Set(topCats);

  const months = Array.from(monthsSet).sort();
  const data: StreamPoint[] = months.map((ym) => {
    const m = byMonthCat.get(ym) || new Map();
    const point: StreamPoint = { ym, label: ym };
    for (const cat of topCats) point[cat] = Math.round(m.get(cat) || 0);
    let other = 0;
    for (const [cat, v] of m) if (!topSet.has(cat)) other += v;
    point["Прочие"] = Math.round(other);
    return point;
  });

  return { data, categories: [...topCats, "Прочие"] };
}

// ============= Seasonality =============

export interface SeasonalityPoint {
  monthIdx: number;
  monthName: string;
  avgExpense: number;
  avgIncome: number;
  yearsSampled: number;
  expenseDeviationPct: number;
}

const SEASON_MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

export function detectSeasonality(txs: Transaction[]): SeasonalityPoint[] {
  const monthly = new Map<string, { income: number; expense: number }>();
  for (const t of txs) {
    if (t.kind === "transfer") continue;
    const ym = t.date.slice(0, 7);
    if (!ym) continue;
    let m = monthly.get(ym);
    if (!m) {
      m = { income: 0, expense: 0 };
      monthly.set(ym, m);
    }
    if (t.kind === "income") m.income += t.amountBase;
    else if (t.kind === "refund") m.expense -= t.amountBase;
    else m.expense += t.amountBase;
  }

  const byMonth: { income: number[]; expense: number[] }[] = Array.from(
    { length: 12 },
    () => ({ income: [], expense: [] })
  );

  for (const [ym, vals] of monthly) {
    const m = Number(ym.slice(5, 7)) - 1;
    if (m < 0 || m > 11) continue;
    byMonth[m].income.push(vals.income);
    byMonth[m].expense.push(vals.expense);
  }

  const overallAvgExpense =
    Array.from(monthly.values()).reduce((s, m) => s + m.expense, 0) /
    Math.max(monthly.size, 1);

  return byMonth.map((b, i) => {
    const avgExpense =
      b.expense.length > 0
        ? b.expense.reduce((s, v) => s + v, 0) / b.expense.length
        : 0;
    const avgIncome =
      b.income.length > 0
        ? b.income.reduce((s, v) => s + v, 0) / b.income.length
        : 0;
    const dev =
      overallAvgExpense > 0
        ? (avgExpense - overallAvgExpense) / overallAvgExpense
        : 0;
    return {
      monthIdx: i,
      monthName: SEASON_MONTH_NAMES[i],
      avgExpense,
      avgIncome,
      yearsSampled: b.expense.length,
      expenseDeviationPct: dev,
    };
  });
}

// ============= Word cloud =============

const RU_STOPWORDS = new Set([
  "и","в","на","с","по","для","к","от","за","до","из","о","но","а","что","это","как","или","же","бы","ли","не","ни","во","со","ко","у","над","под","при","между","через","также","ещё","еще","там","тут","где","куда","сюда","туда","когда","тогда","сейчас","потом","уже","вот","есть","будет","был","была","было","были","быть","буду","будут","можно","нужно","надо","даже","если","потому","чтобы","того","этой","этом","эта","этот","эти","всё","все","всех","весь","вся","моя","моё","наш","наша","ваш","ваша","его","её","их","чей","меня","мне","мы","нам","нас","ты","вы","вас","вам","я","он","она","оно","они","них","ним","ему","ей","им","ими","себя","сам","сама",
  "the","a","an","of","to","in","on","for","with","at","by","from","is","are","was","were","be","been","being","have","has","had","do","does","did","will","would","can","could","should","may","might","must","this","that","these","those","it","its","i","my","you","your","he","she","they","we",
  "руб","р","₽","шт","ст","оп","нет","да",
]);

export interface WordcloudWord {
  text: string;
  count: number;
  totalAmount: number;
  txIds: string[];
}

export function buildWordcloud(
  txs: Transaction[],
  minLength = 3,
  topN = 100
): WordcloudWord[] {
  const map = new Map<string, WordcloudWord>();

  for (const t of txs) {
    if (t.kind === "transfer") continue;
    if (!t.comment) continue;
    const seen = new Set<string>();
    const tokens = t.comment
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s#-]+/gu, " ")
      .split(/\s+/)
      .filter(Boolean);
    for (const raw of tokens) {
      const w = raw.replace(/^[#-]+|[#-]+$/g, "");
      if (w.length < minLength) continue;
      if (RU_STOPWORDS.has(w)) continue;
      if (/^\d+$/.test(w)) continue;
      if (seen.has(w)) continue;
      seen.add(w);
      let entry = map.get(w);
      if (!entry) {
        entry = { text: w, count: 0, totalAmount: 0, txIds: [] };
        map.set(w, entry);
      }
      entry.count++;
      entry.totalAmount += t.amountBase;
      if (entry.txIds.length < 200) entry.txIds.push(t.id);
    }
  }

  return Array.from(map.values())
    .filter((w) => w.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

// ============= Smart category suggestions =============

export interface CategorySuggestion {
  txId: string;
  payee: string;
  comment: string;
  amount: number;
  currency: string;
  date: string;
  suggested: string;
  confidence: number;
  reasonExamples: string[];
}

function tokenize(text: string): Set<string> {
  return new Set(
    (text || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !RU_STOPWORDS.has(w) && !/^\d+$/.test(w))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function suggestCategoriesForUncategorized(
  txs: Transaction[],
  uncategorized: Transaction[],
  k = 5
): CategorySuggestion[] {
  const corpus = txs
    .filter((t) => {
      if (t.kind === "transfer") return false;
      const cat = t.categoryFull || "";
      if (!cat) return false;
      if (/^\s*$/.test(cat)) return false;
      if (/^без катего/i.test(cat)) return false;
      return true;
    })
    .map((t) => ({
      tx: t,
      tokens: tokenize(`${t.payee} ${t.comment} ${t.categoryFull}`),
      payee: (t.payee || "").toLowerCase(),
    }));

  const suggestions: CategorySuggestion[] = [];

  for (const u of uncategorized) {
    const uTokens = tokenize(`${u.payee} ${u.comment}`);
    const uPayee = (u.payee || "").toLowerCase();

    const scored = corpus
      .map((c) => {
        const sim = jaccard(uTokens, c.tokens);
        const payeeBoost =
          uPayee && c.payee && (uPayee === c.payee || c.payee.includes(uPayee) || uPayee.includes(c.payee))
            ? 0.5
            : 0;
        return { tx: c.tx, score: sim + payeeBoost };
      })
      .filter((x) => x.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    if (scored.length === 0) continue;

    const votes = new Map<string, { score: number; examples: string[] }>();
    for (const s of scored) {
      const cat = s.tx.categoryFull;
      let v = votes.get(cat);
      if (!v) {
        v = { score: 0, examples: [] };
        votes.set(cat, v);
      }
      v.score += s.score;
      if (v.examples.length < 3 && s.tx.payee) v.examples.push(s.tx.payee);
    }
    const winner = Array.from(votes.entries()).sort(
      (a, b) => b[1].score - a[1].score
    )[0];
    if (!winner) continue;

    const totalScore = scored.reduce((s, x) => s + x.score, 0);
    const conf = totalScore > 0 ? winner[1].score / totalScore : 0;

    suggestions.push({
      txId: u.id,
      payee: u.payee,
      comment: u.comment,
      amount: u.amount,
      currency: u.currency,
      date: u.date,
      suggested: winner[0],
      confidence: conf,
      reasonExamples: winner[1].examples,
    });
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence);
}

export interface DuplicateGroup {
  signature: string;
  txs: Transaction[];
  totalAmount: number;
}

export function detectDuplicates(
  txs: Transaction[],
  windowDays = 3,
  /** Signatures the user marked «не дубликаты» — never flagged again. */
  excluded?: Set<string>
): DuplicateGroup[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.kind === "transfer") continue;
    const sig = `${t.kind}|${t.payee || "?"}|${Math.round(t.amount)}|${t.currency}`;
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig)!.push(t);
  }
  const out: DuplicateGroup[] = [];
  for (const [sig, list] of groups) {
    if (excluded?.has(sig)) continue; // user said these aren't duplicates
    if (list.length < 2) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    const cluster: Transaction[] = [list[0]];
    for (let i = 1; i < list.length; i++) {
      const days =
        (+new Date(list[i].date) - +new Date(cluster[cluster.length - 1].date)) /
        86400000;
      if (days <= windowDays) {
        cluster.push(list[i]);
      } else {
        if (cluster.length >= 2) {
          out.push({
            signature: sig,
            txs: [...cluster],
            totalAmount: cluster.reduce((s, x) => s + x.amountBase, 0),
          });
        }
        cluster.length = 0;
        cluster.push(list[i]);
      }
    }
    if (cluster.length >= 2) {
      out.push({
        signature: sig,
        txs: [...cluster],
        totalAmount: cluster.reduce((s, x) => s + x.amountBase, 0),
      });
    }
  }
  // Most-recent groups first — the common case is a botched recent import, so
  // the user wants the latest duplicates at the top (not the biggest by sum).
  const lastDate = (g: DuplicateGroup) =>
    g.txs.reduce((m, t) => (t.date > m ? t.date : m), "");
  return out.sort((a, b) => lastDate(b).localeCompare(lastDate(a)));
}

export function detectUncategorized(txs: Transaction[]): Transaction[] {
  // Only truly category-less operations count: an empty category or the
  // explicit «Без категории». Zenmoney has no «Прочие» concept — that label
  // only ever appears as a synthesized chart bucket, never as a real tag — so
  // we don't treat it as uncategorised.
  const empty = /^\s*$/;
  const noCategory = /^без катего/i;
  return txs.filter((t) => {
    if (t.kind === "transfer") return false;
    return empty.test(t.category) || noCategory.test(t.category);
  });
}

export interface ScenarioForecast {
  ym: string;
  income: number;
  expense: number;
  optimistic: number;
  realistic: number;
  pessimistic: number;
  isForecast: boolean;
}

export function buildScenarioForecast(
  txs: Transaction[],
  monthsAhead = 6,
  lookback = 6,
  opts: { monthStartDay?: number } = {}
): ScenarioForecast[] {
  const months = groupByMonth(txs, { monthStartDay: opts.monthStartDay });
  if (months.length === 0) return [];
  const recent = months.slice(-lookback);
  const incomes = recent.map((m) => m.income);
  const expenses = recent.map((m) => m.expense);
  const meanI = incomes.reduce((s, v) => s + v, 0) / incomes.length;
  const meanE = expenses.reduce((s, v) => s + v, 0) / expenses.length;
  const stdI = Math.sqrt(
    incomes.reduce((s, v) => s + (v - meanI) ** 2, 0) / incomes.length
  );
  const stdE = Math.sqrt(
    expenses.reduce((s, v) => s + (v - meanE) ** 2, 0) / expenses.length
  );

  // Project from the MEDIAN month, not the mean — a single spike month (a bonus,
  // a big one-off purchase) drags the mean and pushes the «realist» net above a
  // typical month. Spread: the std of net = income − expense for two independent
  // series is √(stdI² + stdE²), NOT stdI + stdE. Summing them assumes the worst
  // income AND worst expense happen together at full 1σ, which over-counts
  // volatility and sends the «pessimist» far deeper than anything observed
  // (issue #28). hypot keeps the band realistic and the center consistent with
  // the projected income/expense bars (medI − medE).
  const median = (arr: number[]): number => {
    if (arr.length === 0) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const medI = median(incomes);
  const medE = median(expenses);
  const medNet = medI - medE;
  const band = Math.hypot(stdI, stdE);

  const out: ScenarioForecast[] = months.map((m) => ({
    ym: m.ym,
    income: m.income,
    expense: m.expense,
    optimistic: m.net,
    realistic: m.net,
    pessimistic: m.net,
    isForecast: false,
  }));

  const last = months[months.length - 1].ym;
  const [ly, lm] = last.split("-").map(Number);
  for (let i = 1; i <= monthsAhead; i++) {
    const d = new Date(ly, lm - 1 + i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({
      ym,
      income: medI,
      expense: medE,
      optimistic: medNet + band,
      realistic: medNet,
      pessimistic: medNet - band,
      isForecast: true,
    });
  }
  return out;
}

export interface HourOfWeekCell {
  dow: number;
  hour: number;
  total: number;
  count: number;
}

export function statsByHourOfWeek(
  txs: Transaction[],
  kind: "expense" | "income" = "expense"
): HourOfWeekCell[] {
  const cells: HourOfWeekCell[] = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      cells.push({ dow: d, hour: h, total: 0, count: 0 });
    }
  }
  for (const t of txs) {
    if (t.kind !== kind) continue;
    const d = new Date(t.createdAt || t.date);
    const dow = d.getDay();
    const hour = d.getHours();
    const cell = cells[dow * 24 + hour];
    cell.total += t.amountBase;
    cell.count++;
  }
  return cells;
}

export function vsAverageStats(
  txs: Transaction[],
  opts: { monthStartDay?: number } = {}
): { current: { ym: string; expense: number; income: number; net: number } | null; avg: { expense: number; income: number; net: number } } {
  const months = groupByMonth(txs, { monthStartDay: opts.monthStartDay });
  if (months.length === 0) {
    return { current: null, avg: { expense: 0, income: 0, net: 0 } };
  }
  const current = months[months.length - 1];
  const previous = months.slice(0, -1);
  if (previous.length === 0) {
    return {
      current: { ym: current.ym, expense: current.expense, income: current.income, net: current.net },
      avg: { expense: 0, income: 0, net: 0 },
    };
  }
  const avgE = previous.reduce((s, m) => s + m.expense, 0) / previous.length;
  const avgI = previous.reduce((s, m) => s + m.income, 0) / previous.length;
  return {
    current: { ym: current.ym, expense: current.expense, income: current.income, net: current.net },
    avg: { expense: avgE, income: avgI, net: avgI - avgE },
  };
}

export interface YoYPoint {
  monthIdx: number;
  monthName: string;
  thisYear: number | null;
  lastYear: number | null;
}

export function yearOverYearMonthly(
  txs: Transaction[],
  year: number,
  kind: "expense" | "income" = "expense"
): YoYPoint[] {
  const months = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
  const totals = new Map<string, number>();
  for (const t of txs) {
    // Expense YoY nets refunds out of the same month they belong to;
    // income YoY only counts true `income` (refunds are not income).
    const include = kind === "expense" ? affectsExpense(t.kind) : t.kind === kind;
    if (!include) continue;
    const ym = t.date.slice(0, 7);
    const delta = kind === "expense" ? expenseDelta(t) : t.amountBase;
    totals.set(ym, (totals.get(ym) || 0) + delta);
  }
  const out: YoYPoint[] = [];
  for (let m = 0; m < 12; m++) {
    const thisKey = `${year}-${String(m + 1).padStart(2, "0")}`;
    const lastKey = `${year - 1}-${String(m + 1).padStart(2, "0")}`;
    out.push({
      monthIdx: m,
      monthName: months[m],
      thisYear: totals.has(thisKey) ? Math.round(totals.get(thisKey)!) : null,
      lastYear: totals.has(lastKey) ? Math.round(totals.get(lastKey)!) : null,
    });
  }
  return out;
}

export interface SankeyData {
  nodes: {
    name: string;
    kind?: "income" | "account" | "category" | "savings" | "funding";
  }[];
  links: { source: number; target: number; value: number }[];
}

export function buildSankey(txs: Transaction[]): SankeyData {
  const incomeCats = new Map<string, number>();
  const expenseCats = new Map<string, number>();
  let totalIncome = 0;
  let totalExpense = 0;
  for (const t of txs) {
    if (t.kind === "income") {
      const k = t.category || "Прочие доходы";
      incomeCats.set(k, (incomeCats.get(k) || 0) + t.amountBase);
      totalIncome += t.amountBase;
    } else if (t.kind === "expense") {
      const k = t.category || "Прочие";
      expenseCats.set(k, (expenseCats.get(k) || 0) + t.amountBase);
      totalExpense += t.amountBase;
    } else if (t.kind === "refund") {
      // Refund flows back to the source category — shrink that ribbon
      // accordingly rather than adding a new income source. Clamp at
      // zero so the Sankey doesn't try to draw negative-width ribbons
      // if a category somehow ends up net-positive after refunds.
      const k = t.category || "Прочие";
      const prev = expenseCats.get(k) || 0;
      const next = Math.max(0, prev - t.amountBase);
      expenseCats.set(k, next);
      totalExpense -= Math.min(prev, t.amountBase);
    }
  }
  const incomeArr = Array.from(incomeCats.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const expenseArr = Array.from(expenseCats.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  const incomeOther = totalIncome - incomeArr.reduce((s, x) => s + x[1], 0);
  const expenseOther = totalExpense - expenseArr.reduce((s, x) => s + x[1], 0);

  const finalIncome = [...incomeArr];
  if (incomeOther > 0) finalIncome.push(["Прочие доходы", incomeOther]);
  const finalExpense = [...expenseArr];
  if (expenseOther > 0) finalExpense.push(["Прочие траты", expenseOther]);

  // Period balance: did income cover spending? The Sankey only tracks
  // income/expense category flows (transfers are ignored), so the surplus
  // (income − expense) is what was effectively SAVED this period, and a
  // deficit is what had to be PULLED from existing balances / savings to
  // cover the spending. Round against the same per-link rounding so the
  // budget node stays visually balanced (in == out).
  const inSum = finalIncome.reduce((s, e) => s + Math.round(e[1] as number), 0);
  const outSum = finalExpense.reduce((s, e) => s + Math.round(e[1] as number), 0);
  const net = inSum - outSum;

  const nodes: SankeyData["nodes"] = [];
  const links: { source: number; target: number; value: number }[] = [];
  const POOL_NAME = "Бюджет";

  finalIncome.forEach(([name]) => nodes.push({ name: name as string, kind: "income" }));
  // Deficit funding sits on the LEFT as an extra source feeding the budget.
  let fundingIdx = -1;
  if (net < 0) {
    fundingIdx = nodes.length;
    nodes.push({ name: "Из накоплений", kind: "funding" });
  }
  const poolIdx = nodes.length;
  nodes.push({ name: POOL_NAME, kind: "account" });
  const expenseStart = nodes.length;
  finalExpense.forEach(([name]) => nodes.push({ name: name as string, kind: "category" }));
  // Surplus sits on the RIGHT as an extra target drawn from the budget.
  let savingsIdx = -1;
  if (net > 0) {
    savingsIdx = nodes.length;
    nodes.push({ name: "Сбережения", kind: "savings" });
  }

  finalIncome.forEach((entry, i) => {
    const v = Math.round(entry[1] as number);
    if (v > 0) links.push({ source: i, target: poolIdx, value: v });
  });
  if (fundingIdx >= 0) links.push({ source: fundingIdx, target: poolIdx, value: -net });
  finalExpense.forEach((entry, i) => {
    const v = Math.round(entry[1] as number);
    if (v > 0) links.push({ source: poolIdx, target: expenseStart + i, value: v });
  });
  if (savingsIdx >= 0) links.push({ source: poolIdx, target: savingsIdx, value: net });

  return { nodes, links };
}

/** Categories that count as «обязательная» (mandatory). Default is obligatory —
 *  only an explicit `required === false` (set in the «Обязательность расходов в
 *  категориях» editor / pulled from Zenmoney) makes a category optional. Built
 *  from the categories present in `txs`. Single source of the rule, shared by
 *  the Dashboard «Свободные деньги», Health «доля обязательных» and 50/30/20. */
export type ObligationMeta = Record<string, { required?: boolean | null }>;

/** Is this transaction's spending obligatory («обязательная»)? The
 *  SUBCATEGORY's own flag wins when it set one (keyed by the full path
 *  «Родитель / Подкатегория»); otherwise the parent category's flag; default
 *  obligatory — only an explicit `required === false` makes it optional. This
 *  lets a single «необязательная» subcategory under an obligatory parent be
 *  counted correctly (issue #5). */
export function isObligatoryTx(t: Transaction, meta: ObligationMeta): boolean {
  if (t.subcategory) {
    const sub = meta[t.categoryFull];
    if (sub && sub.required != null) return sub.required !== false;
  }
  const cat = meta[t.category];
  return cat ? cat.required !== false : true;
}

export interface ObligationData {
  obligatory: number;
  optional: number;
}

/** Split expense into obligatory vs optional buckets, per-transaction (so
 *  subcategory-level «обязательность» is respected). Refunds subtract from
 *  their bucket — `expenseDelta` already returns a negative amount there. */
export function splitByObligation(
  txs: Transaction[],
  meta: ObligationMeta
): ObligationData {
  let obligatory = 0;
  let optional = 0;
  for (const t of txs) {
    if (!affectsExpense(t.kind)) continue;
    const delta = expenseDelta(t);
    if (isObligatoryTx(t, meta)) obligatory += delta;
    else optional += delta;
  }
  return { obligatory, optional };
}

export interface FirePoint {
  ym: string;
  /** Rolling average monthly OBLIGATORY expense over the trailing window. */
  avgObligatory: number;
  /** Rolling average monthly ALL expense (obligatory + optional) over the window. */
  avgExpenseAll: number;
  /** Rolling average monthly INCOME over the trailing window. */
  avgIncome: number;
  /** Net worth at month end (from the passed series — assets on all counted
   *  accounts; enable «забалансовые» to include investment portfolios). */
  net: number;
  /** «Months of life» = net / avgObligatory — how many months of average
   *  obligatory spending the accumulated assets cover. */
  months: number;
}

/** Enumerate contiguous "YYYY-MM" keys from `from` to `to`, inclusive. */
function enumerateMonths(from: string, to: string): string[] {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const out: string[] = [];
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * Rolling «months of life» (FIRE) series — one point per calendar month.
 *
 * At each month it takes the net worth at month end and divides it by the
 * AVERAGE monthly obligatory expense over the trailing `window` months, so the
 * denominator floats with recent spending and the ratio shows the FIRE runway
 * over time (`months` ≈ 300 → 100% FIRE on the 4%-rule). Both series the user
 * asked for come out of this: `avgObligatory` (spending dynamics) and `months`
 * (the runway). Needs the daily cumulative net-worth series plus the raw
 * transactions + obligation meta to build the trailing spend.
 */
export function fireSeries(
  netWorth: { date: string; net: number }[],
  txs: Transaction[],
  meta: ObligationMeta,
  window = 12,
  monthStartDay = 1
): FirePoint[] {
  if (netWorth.length === 0 || txs.length === 0) return [];

  // Bucket by the user's REPORTING period, not the raw calendar month, so the
  // «as-of» date of every point honours «Первый день отчётного месяца». The key
  // stays a sortable "YYYY-MM" (of the period's start month), like groupByMonth.
  const periodOf = (d: string) =>
    monthStartDay === 1 ? d.slice(0, 7) : periodKey(d, monthStartDay);

  // Obligatory expense, all expense (refunds subtract via expenseDelta) and
  // income per period.
  const oblByMonth = new Map<string, number>();
  const allExpByMonth = new Map<string, number>();
  const incByMonth = new Map<string, number>();
  let firstTxYm = "9999-99";
  for (const t of txs) {
    const ym = periodOf(t.date);
    if (!ym) continue;
    if (ym < firstTxYm) firstTxYm = ym;
    if (t.kind === "income") {
      incByMonth.set(ym, (incByMonth.get(ym) || 0) + t.amountBase);
      continue;
    }
    if (!affectsExpense(t.kind)) continue;
    const d = expenseDelta(t);
    allExpByMonth.set(ym, (allExpByMonth.get(ym) || 0) + d);
    if (isObligatoryTx(t, meta)) oblByMonth.set(ym, (oblByMonth.get(ym) || 0) + d);
  }

  const nwFirst = periodOf(netWorth[0].date);
  const lastYm = periodOf(netWorth[netWorth.length - 1].date);
  const firstYm = firstTxYm < nwFirst ? firstTxYm : nwFirst;
  const monthsList = enumerateMonths(firstYm, lastYm);
  if (monthsList.length === 0) return [];

  // Net worth at each period end: last known cumulative value in that period,
  // carried forward across periods with no activity.
  const netByMonth = new Map<string, number>();
  for (const p of netWorth) netByMonth.set(periodOf(p.date), p.net);
  let carried = netWorth[0].net;
  for (const ym of monthsList) {
    if (netByMonth.has(ym)) carried = netByMonth.get(ym)!;
    netByMonth.set(ym, carried);
  }

  const out: FirePoint[] = [];
  for (let i = 0; i < monthsList.length; i++) {
    const ym = monthsList[i];
    const start = Math.max(0, i - window + 1);
    const slice = monthsList.slice(start, i + 1);
    const oblSum = slice.reduce((s, m) => s + (oblByMonth.get(m) || 0), 0);
    const allSum = slice.reduce((s, m) => s + (allExpByMonth.get(m) || 0), 0);
    const incSum = slice.reduce((s, m) => s + (incByMonth.get(m) || 0), 0);
    const avgObligatory = slice.length > 0 ? oblSum / slice.length : 0;
    const avgExpenseAll = slice.length > 0 ? allSum / slice.length : 0;
    const avgIncome = slice.length > 0 ? incSum / slice.length : 0;
    const net = netByMonth.get(ym) ?? 0;
    const months = avgObligatory > 0 ? net / avgObligatory : 0;
    out.push({ ym, avgObligatory, avgExpenseAll, avgIncome, net, months });
  }
  return out;
}

const ANCHOR_PATTERNS = [
  /начальн[ыо]\s*остат/i,
  /корректировк/i,
  /initial\s*balance/i,
  /opening\s*balance/i,
  /balance\s*adjust/i,
  /starting\s*balance/i,
  /остат[ок]+\s+на\s+нач/i,
];

export interface BalanceAnchor {
  tx: Transaction;
  amount: number;
  reason: string;
}

export function detectBalanceAnchors(txs: Transaction[]): BalanceAnchor[] {
  const out: BalanceAnchor[] = [];
  for (const t of txs) {
    const text = `${t.categoryFull} ${t.payee} ${t.comment}`;
    for (const re of ANCHOR_PATTERNS) {
      if (re.test(text)) {
        out.push({
          tx: t,
          amount: t.amountBase * (t.kind === "expense" ? -1 : 1),
          reason: re.source,
        });
        break;
      }
    }
  }
  return out.sort((a, b) => b.tx.date.localeCompare(a.tx.date));
}

export function cumulativeNetAt(txs: Transaction[], date: string): number {
  let net = 0;
  for (const t of txs) {
    if (t.date > date) continue;
    // Refund is a real cash inflow on the running cumulative net,
    // same direction as income.
    if (t.kind === "income" || t.kind === "refund") net += t.amountBase;
    else if (t.kind === "expense") net -= t.amountBase;
  }
  return net;
}

export function lastTransactionDate(txs: Transaction[]): string {
  let max = "";
  for (const t of txs) if (t.date > max) max = t.date;
  return max;
}

export interface NetWorthOptions {
  /** Dated opening-balance events (base currency) — each account's startBalance
   *  placed at its opening date. Seeds initial capital so the curve reflects it
   *  from the right moment instead of as a flat offset across all of history. */
  openings?: { date: string; amount: number }[];
  /** When set, only flows touching these accounts count, and transfers are
   *  scored by membership: a transfer crossing the set boundary is a real
   *  in/outflow, one within the set nets to zero. Together with `openings` this
   *  makes the series end exactly at the real total of these accounts. */
  accounts?: Set<string> | null;
}

/** Subset of `LiveAccount` (avoids a store→lib import) needed to seed openings. */
export interface NetWorthAccount {
  title: string;
  currency: string;
  startBalance: number;
  startDate: string | null;
  archive: boolean;
  inBalance: boolean;
}

/**
 * Build the net-worth reconstruction basis from live accounts: which accounts
 * count, and a dated opening-balance event per account (its `startBalance` in
 * base currency, placed at `startDate` → first transaction → global earliest).
 */
export function netWorthBasis(
  liveAccounts: NetWorthAccount[],
  txs: Transaction[],
  rates: CurrencyRates,
  includeOffBalance: boolean
): { accounts: Set<string>; openings: { date: string; amount: number }[] } {
  const earliest = new Map<string, string>();
  let globalEarliest = "";
  for (const t of txs) {
    const d = t.date;
    if (!d) continue;
    if (!globalEarliest || d < globalEarliest) globalEarliest = d;
    for (const a of [t.outcomeAccount, t.incomeAccount, t.account]) {
      if (!a) continue;
      const cur = earliest.get(a);
      if (!cur || d < cur) earliest.set(a, d);
    }
  }
  const toBaseAmt = (amount: number, currency: string) =>
    currency === rates.base ? amount : amount * (rates.rates[currency] || 1);
  const accounts = new Set<string>();
  const openings: { date: string; amount: number }[] = [];
  for (const a of liveAccounts) {
    if (a.archive) continue;
    if (!a.inBalance && !includeOffBalance) continue;
    accounts.add(a.title);
    if (a.startBalance) {
      // Zenmoney occasionally hands back an epoch/1970 `startDate` (legacy or
      // import artifact). Such a date would plant a phantom opening balance «at
      // the dawn of time» (01.01.1970) and inflate/skew the curve. Treat an
      // implausibly-old startDate as absent and fall back to the account's
      // first transaction (or the global earliest). Legitimate early dates
      // (an account opened before the first visible transaction) are kept.
      const plausibleStart =
        a.startDate && a.startDate >= "2000-01-01" ? a.startDate : null;
      const date = plausibleStart || earliest.get(a.title) || globalEarliest;
      if (date) openings.push({ date, amount: toBaseAmt(a.startBalance, a.currency) });
    }
  }
  return { accounts, openings };
}

export function netWorthSeries(
  allTxs: Transaction[],
  calibration?: CalibrationInput | null,
  opts?: NetWorthOptions
): { date: string; net: number }[] {
  const set = opts?.accounts ?? null;
  const inSet = (a: string | null | undefined) => !!a && set!.has(a);
  const days = new Map<string, number>();
  const add = (d: string, v: number) => {
    if (v !== 0) days.set(d, (days.get(d) || 0) + v);
  };
  for (const t of allTxs) {
    const d = ymdKey(t.date);
    if (!d) continue;
    let delta = 0;
    if (set) {
      // Account-aware: a flow only moves net worth if its account is in the set;
      // transfers count only when they cross the set boundary.
      if (t.kind === "income" || t.kind === "refund") {
        if (inSet(t.incomeAccount)) delta += t.amountBase;
      } else if (t.kind === "expense") {
        if (inSet(t.outcomeAccount)) delta -= t.amountBase;
      } else if (t.kind === "transfer") {
        const out = inSet(t.outcomeAccount);
        const inc = inSet(t.incomeAccount);
        if (out && !inc) delta -= t.amountBase;
        else if (inc && !out) delta += t.amountBase;
      }
    } else {
      // Refund increments net worth on the day, like income.
      if (t.kind === "income" || t.kind === "refund") delta += t.amountBase;
      else if (t.kind === "expense") delta -= t.amountBase;
    }
    add(d, delta);
  }
  // Seed dated opening balances (account creation capital).
  if (opts?.openings) {
    for (const o of opts.openings) {
      const d = ymdKey(o.date);
      if (d) add(d, o.amount);
    }
  }
  const sorted = Array.from(days.keys()).sort();
  let net = 0;
  const raw = sorted.map((d) => {
    net += days.get(d)!;
    return { date: d, net };
  });
  if (!calibration) return raw;

  let rawAtCal = 0;
  for (const p of raw) {
    if (p.date <= calibration.date) rawAtCal = p.net;
    else break;
  }
  const offset = calibration.amount - rawAtCal;
  return raw.map((p) => ({ date: p.date, net: p.net + offset }));
}

export function accountMonthlyDeltas(
  txs: Transaction[],
  account: string,
  months = 12
): number[] {
  const map = new Map<string, number>();
  for (const t of txs) {
    const ym = t.date.slice(0, 7);
    if (!ym) continue;
    let delta = 0;
    if (t.outcomeAccount === account && (t.kind === "expense" || t.kind === "transfer")) {
      delta -= t.amountBase;
    }
    // Refund lands on the account's income side (the merchant gave
    // money back) so it bumps the monthly delta upward.
    if (
      t.incomeAccount === account &&
      (t.kind === "income" || t.kind === "refund" || t.kind === "transfer")
    ) {
      delta += t.amountBase;
    }
    if (delta !== 0) map.set(ym, (map.get(ym) || 0) + delta);
  }
  const sorted = Array.from(map.keys()).sort();
  const last = sorted.slice(-months);
  return last.map((ym) => Math.round(map.get(ym) || 0));
}

export interface PayeeBucket {
  payee: string;
  total: number;
  count: number;
}

/** Bucket label for transactions without a payee. Also the value the drill-down
 *  matches against, via `t.payee || NO_PAYEE_LABEL` — so clicking the row opens
 *  exactly those empty-payee operations instead of an empty drawer. */
export const NO_PAYEE_LABEL = "Без получателя";

export function topPayees(txs: Transaction[], kind: "expense" | "income" = "expense", limit = 20): PayeeBucket[] {
  const map = new Map<string, PayeeBucket>();
  for (const t of txs) {
    // For the expense view, a refund to the same payee should reduce
    // that payee's net spend ("I bought X then returned it" → net 0).
    const include = kind === "expense" ? affectsExpense(t.kind) : t.kind === kind;
    if (!include) continue;
    const key = t.payee || NO_PAYEE_LABEL;
    let b = map.get(key);
    if (!b) {
      b = { payee: key, total: 0, count: 0 };
      map.set(key, b);
    }
    b.total += kind === "expense" ? expenseDelta(t) : t.amountBase;
    b.count++;
  }
  // Drop fully-refunded payees (net 0) so they don't pollute the top.
  return Array.from(map.values())
    .filter((b) => b.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

export function topTransactions(
  txs: Transaction[],
  kind: "expense" | "income" = "expense",
  limit = 30
): Transaction[] {
  return txs
    .filter((t) => t.kind === kind)
    .sort((a, b) => b.amountBase - a.amountBase)
    .slice(0, limit);
}

const HASHTAG_RE = /#([\p{L}\p{N}_-]+)/gu;

export function extractHashtags(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(HASHTAG_RE)) out.push(m[1]);
  return out;
}

export interface TagBucket {
  tag: string;
  expense: number;
  income: number;
  count: number;
  txIds: string[];
}

export function groupByHashtag(txs: Transaction[]): TagBucket[] {
  const map = new Map<string, TagBucket>();
  for (const t of txs) {
    if (t.kind === "transfer") continue;
    const tags = extractHashtags(t.comment);
    for (const tag of tags) {
      let b = map.get(tag);
      if (!b) {
        b = { tag, expense: 0, income: 0, count: 0, txIds: [] };
        map.set(tag, b);
      }
      if (t.kind === "income") b.income += t.amountBase;
      // Refund shrinks the hashtag's expense bucket — without this
      // it would be lumped into income (wrong: refund is reversal,
      // not earnings) or expense (wrong direction).
      else if (t.kind === "refund") b.expense -= t.amountBase;
      else b.expense += t.amountBase;
      b.count++;
      b.txIds.push(t.id);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.expense + b.income - (a.expense + a.income));
}

export interface TagCatSub {
  name: string;
  expense: number;
  income: number;
  count: number;
}
export interface TagCatNode {
  category: string;
  expense: number;
  income: number;
  count: number;
  subs: TagCatSub[];
}

/**
 * For each hashtag, a breakdown by category → subcategory with expense,
 * income and operation count — so the Hashtags page can show each tag's
 * «Категория → Подкатегория» rows aligned with the table's columns.
 * Refunds shrink the expense bucket (same convention as groupByHashtag);
 * income lands in its own bucket. Sorted by expense+income, descending.
 */
export function hashtagCategoryTrees(
  txs: Transaction[]
): Map<string, TagCatNode[]> {
  const add = (b: { expense: number; income: number }, t: Transaction) => {
    if (t.kind === "income") b.income += t.amountBase;
    else if (t.kind === "refund") b.expense -= t.amountBase;
    else b.expense += t.amountBase;
  };
  const byTag = new Map<string, Map<string, TagCatNode>>();
  for (const t of txs) {
    if (t.kind === "transfer") continue;
    const tags = extractHashtags(t.comment);
    if (tags.length === 0) continue;
    for (const tag of tags) {
      let cats = byTag.get(tag);
      if (!cats) {
        cats = new Map();
        byTag.set(tag, cats);
      }
      let node = cats.get(t.category);
      if (!node) {
        node = { category: t.category, expense: 0, income: 0, count: 0, subs: [] };
        cats.set(t.category, node);
      }
      add(node, t);
      node.count++;
      if (t.subcategory) {
        let sub = node.subs.find((s) => s.name === t.subcategory);
        if (!sub) {
          sub = { name: t.subcategory, expense: 0, income: 0, count: 0 };
          node.subs.push(sub);
        }
        add(sub, t);
        sub.count++;
      }
    }
  }
  const score = (b: { expense: number; income: number }) => b.expense + b.income;
  const out = new Map<string, TagCatNode[]>();
  for (const [tag, cats] of byTag) {
    const nodes = Array.from(cats.values()).sort((a, b) => score(b) - score(a));
    for (const n of nodes) n.subs.sort((a, b) => score(b) - score(a));
    out.set(tag, nodes);
  }
  return out;
}

export interface DayCell {
  date: string;
  expense: number;
  income: number;
  count: number;
}

export function dailyExpenseMap(txs: Transaction[]): Map<string, DayCell> {
  const map = new Map<string, DayCell>();
  for (const t of txs) {
    if (t.kind === "transfer") continue;
    const d = ymdKey(t.date);
    if (!d) continue;
    let cell = map.get(d);
    if (!cell) {
      cell = { date: d, expense: 0, income: 0, count: 0 };
      map.set(d, cell);
    }
    if (t.kind === "income") cell.income += t.amountBase;
    // Refund nets out of the day's expense (used by Calendar
    // heat-map). Without this it would be added on top.
    else if (t.kind === "refund") cell.expense -= t.amountBase;
    else cell.expense += t.amountBase;
    cell.count++;
  }
  return map;
}

export interface RecurringCandidate {
  payee: string;
  category: string;
  avgAmount: number;
  currency: string;
  occurrences: number;
  avgIntervalDays: number;
  monthsCovered: number;
  consistency: number;
  lastDate: string;
  nextExpected: string;
  /** Whole days between `lastDate` and "now". Drives the staleness test. */
  daysSinceLast: number;
  /**
   * True when the payment has gone silent for more than ~2 cadence cycles
   * (plus a grace) — a monthly plan unpaid for 2.5+ months, a weekly one for
   * a month, etc. Such a payment is almost certainly cancelled, so the UI
   * hides it from "active" recurring payments by default and never projects
   * its "next expected" into the future. Cadence-aware, unlike a flat
   * "older than a year" cutoff, so recently-dropped subscriptions are caught
   * long before a year passes.
   */
  stale: boolean;
  totalSpent: number;
  txIds: string[];
  /**
   * Coarse interval category — derived from `avgIntervalDays`. Lets
   * the UI offer "show only monthly / weekly / yearly subscriptions"
   * pills without re-deriving from the day count.
   */
  cadence: "weekly" | "monthly" | "quarterly";
  /**
   * Price-change signal: compare the *last* observed amount vs. the
   * mean of all *earlier* occurrences. Positive `changePct` = the
   * subscription got more expensive on its most recent charge.
   * Threshold for "noteworthy" is ±10% (see `priceFlag`).
   *
   *   • `priceFlag: "up"`   — last charge > avg × 1.10
   *   • `priceFlag: "down"` — last charge < avg × 0.90
   *   • `priceFlag: "flat"` — within ±10%
   */
  priceTrend: { changePct: number; priceFlag: "up" | "down" | "flat" };
}

export function detectRecurring(
  txs: Transaction[],
  minOccurrences = 3,
  now = Date.now()
): RecurringCandidate[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.kind !== "expense") continue;
    if (!t.payee) continue;
    const key = `${t.payee}::${t.currency}`;
    let arr = groups.get(key);
    if (!arr) {
      arr = [];
      groups.set(key, arr);
    }
    arr.push(t);
  }

  const out: RecurringCandidate[] = [];

  for (const [, list] of groups) {
    if (list.length < minOccurrences) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));

    const amounts = list.map((t) => t.amount);
    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    if (mean === 0) continue;
    const variance =
      amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length;
    const cv = Math.sqrt(variance) / mean;

    const intervals: number[] = [];
    for (let i = 1; i < list.length; i++) {
      const d = (+new Date(list[i].date) - +new Date(list[i - 1].date)) / 86400000;
      intervals.push(d);
    }
    if (intervals.length === 0) continue;
    const meanInterval = intervals.reduce((s, x) => s + x, 0) / intervals.length;
    if (meanInterval < 5 || meanInterval > 95) continue;

    const intervalVariance =
      intervals.reduce((s, x) => s + (x - meanInterval) ** 2, 0) / intervals.length;
    const intervalCv = Math.sqrt(intervalVariance) / Math.max(meanInterval, 1);

    const consistency = Math.max(0, 1 - cv * 0.5 - intervalCv * 0.5);
    if (consistency < 0.3) continue;

    const months = new Set(list.map((t) => t.date.slice(0, 7)));
    if (months.size < 2) continue;

    const last = list[list.length - 1];
    const intervalMs = Math.round(meanInterval) * 86400000;
    const lastMs = +new Date(last.date);
    const daysSinceLast = Math.floor((now - lastMs) / 86400000);
    // "Stale" = silent for more than ~2 cadence cycles (+ 2-week grace for
    // late charges). Cadence-aware: ~75 days for a monthly plan, ~4 weeks for
    // a weekly one, ~half a year for a quarterly one. Far sharper than a flat
    // "older than a year" rule, which let a monthly sub linger for months
    // after it was clearly cancelled.
    const stale = daysSinceLast > Math.round(meanInterval) * 2 + 14;
    let nextMs = lastMs + intervalMs;
    // "Next expected" should never sit in the past for a payment that's still
    // alive — project it forward by whole cycles to the first date ≥ today.
    // Stale (dead) ones keep their past projection, so they don't masquerade
    // as upcoming in the list or the "expected" feed.
    if (!stale && nextMs < now && intervalMs > 0) {
      nextMs += Math.ceil((now - nextMs) / intervalMs) * intervalMs;
    }
    const nextDate = new Date(nextMs);

    const totalSpent = list.reduce((s, t) => s + t.amount, 0);
    const cats: Record<string, number> = {};
    for (const t of list) cats[t.category] = (cats[t.category] || 0) + 1;
    const dominantCategory =
      Object.entries(cats).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

    // Cadence bucket — derived once so the UI doesn't re-classify.
    // Boundaries match the user's mental model: ~weekly = 5-9 days,
    // ~monthly = 10-45 days, anything longer reads as "quarterly".
    // (`detectRecurring` itself rejects intervals >95 days, so the
    // tail of the distribution is bounded.)
    const cadence: RecurringCandidate["cadence"] =
      meanInterval < 10 ? "weekly" : meanInterval < 46 ? "monthly" : "quarterly";

    // Price-change signal — compare the last observed amount with the
    // mean of all *earlier* occurrences. Catches subscription price
    // hikes ("Netflix went from 800 → 1100") and rare downward
    // re-pricings. Need at least 2 earlier points to draw a baseline
    // we can trust; otherwise flag as "flat".
    let priceFlag: "up" | "down" | "flat" = "flat";
    let changePct = 0;
    if (list.length >= 3) {
      const earlier = list.slice(0, -1);
      const earlierMean =
        earlier.reduce((s, t) => s + t.amount, 0) / earlier.length;
      const lastAmt = list[list.length - 1].amount;
      if (earlierMean > 0) {
        changePct = (lastAmt - earlierMean) / earlierMean;
        if (changePct > 0.1) priceFlag = "up";
        else if (changePct < -0.1) priceFlag = "down";
      }
    }

    out.push({
      payee: list[0].payee,
      category: dominantCategory,
      avgAmount: mean,
      currency: list[0].currency,
      occurrences: list.length,
      avgIntervalDays: Math.round(meanInterval),
      monthsCovered: months.size,
      consistency,
      lastDate: last.date,
      nextExpected: nextDate.toISOString().slice(0, 10),
      daysSinceLast,
      stale,
      totalSpent,
      txIds: list.map((t) => t.id),
      cadence,
      priceTrend: { changePct, priceFlag },
    });
  }

  return out.sort((a, b) => b.totalSpent - a.totalSpent);
}

export interface Insight {
  kind: "highlight" | "trend" | "warning" | "fact";
  title: string;
  body: string;
  value?: number;
  positive?: boolean;
}

export function buildInsights(txs: Transaction[]): Insight[] {
  const insights: Insight[] = [];
  const expenses = txs.filter((t) => t.kind === "expense");
  if (expenses.length === 0) return insights;

  const top = expenses.reduce((m, t) => (t.amountBase > m.amountBase ? t : m), expenses[0]);
  insights.push({
    kind: "highlight",
    title: "Самая крупная трата",
    body: `${top.payee || top.categoryFull} — ${top.comment || top.categoryFull} (${top.date})`,
    value: top.amountBase,
  });

  const dow: number[] = [0, 0, 0, 0, 0, 0, 0];
  const dowCount: number[] = [0, 0, 0, 0, 0, 0, 0];
  for (const t of expenses) {
    const wd = new Date(t.date).getDay();
    dow[wd] += t.amountBase;
    dowCount[wd]++;
  }
  const avgDow = dow.map((s, i) => (dowCount[i] ? s / dowCount[i] : 0));
  const dowNames = ["воскресенье", "понедельник", "вторник", "среду", "четверг", "пятницу", "субботу"];
  let maxIdx = 0;
  for (let i = 0; i < 7; i++) if (avgDow[i] > avgDow[maxIdx]) maxIdx = i;
  insights.push({
    kind: "fact",
    title: "Самый дорогой день",
    body: `В ${dowNames[maxIdx]} средний чек выше всего`,
    value: avgDow[maxIdx],
  });

  const weekend = dow[0] + dow[6];
  const weekday = dow.slice(1, 6).reduce((s, x) => s + x, 0);
  const wkPerDay = weekend / 2;
  const wdPerDay = weekday / 5;
  if (wkPerDay > 0 && wdPerDay > 0) {
    const ratio = wkPerDay / wdPerDay;
    insights.push({
      kind: ratio > 1.3 ? "warning" : "fact",
      title: "Выходные vs будни",
      body:
        ratio > 1.3
          ? `В выходные тратите в ${ratio.toFixed(1)}× больше за день`
          : ratio < 0.8
            ? `В будни тратите в ${(1 / ratio).toFixed(1)}× больше за день`
            : "Расходы по дням недели примерно ровные",
      value: ratio,
    });
  }

  const months = groupByMonth(txs);
  if (months.length >= 2) {
    const last = months[months.length - 1];
    const prev = months[months.length - 2];
    const diff = last.expense - prev.expense;
    const pct = prev.expense > 0 ? diff / prev.expense : 0;
    if (Math.abs(pct) > 0.1) {
      insights.push({
        kind: pct > 0 ? "warning" : "trend",
        title: "Расходы MoM",
        body:
          pct > 0
            ? `В этом месяце расходы выше прошлого на ${(pct * 100).toFixed(0)}%`
            : `В этом месяце расходы ниже прошлого на ${(Math.abs(pct) * 100).toFixed(0)}%`,
        value: pct,
        positive: pct < 0,
      });
    }

    const cats = groupByCategory(txs, "top");
    if (cats.length > 0) {
      const lastTxs = txs.filter((t) => t.date.slice(0, 7) === last.ym);
      const prevTxs = txs.filter((t) => t.date.slice(0, 7) === prev.ym);
      const lastByCat = groupByCategory(lastTxs, "top");
      const prevByCat = new Map(groupByCategory(prevTxs, "top").map((c) => [c.category, c.expense]));
      let bestCat = "";
      let bestDelta = 0;
      for (const c of lastByCat) {
        const prevExp = prevByCat.get(c.category) || 0;
        const delta = c.expense - prevExp;
        if (Math.abs(delta) > Math.abs(bestDelta)) {
          bestDelta = delta;
          bestCat = c.category;
        }
      }
      if (bestCat && Math.abs(bestDelta) > 0) {
        insights.push({
          kind: bestDelta > 0 ? "warning" : "trend",
          title: bestDelta > 0 ? "Категория растёт" : "Категория падает",
          body: `«${bestCat}»: ${bestDelta > 0 ? "+" : ""}${Math.round(bestDelta).toLocaleString("ru-RU")} к прошлому месяцу`,
          value: bestDelta,
          positive: bestDelta < 0,
        });
      }
    }
  }

  const sr = computeKPI(txs);
  if (sr.income > 0) {
    const rate = sr.net / sr.income;
    insights.push({
      kind: rate > 0.2 ? "trend" : rate < 0 ? "warning" : "fact",
      title: "Норма сбережений",
      body:
        rate > 0.2
          ? "Сберегаете больше 20% дохода — отличный результат"
          : rate > 0
            ? `Сберегаете ${(rate * 100).toFixed(0)}% дохода`
            : "Расходы превышают доходы",
      value: rate,
      positive: rate > 0,
    });
  }

  return insights;
}

export interface Anomaly {
  tx: Transaction;
  reason: "outlier-category" | "outlier-payee" | "spike-month";
  zScore: number;
  baseline: number;
  context: string;
}

export function detectAnomalies(txs: Transaction[], threshold = 2.5): Anomaly[] {
  const anomalies: Anomaly[] = [];

  const byCategory = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.kind !== "expense") continue;
    if (!byCategory.has(t.categoryFull)) byCategory.set(t.categoryFull, []);
    byCategory.get(t.categoryFull)!.push(t);
  }

  for (const [cat, list] of byCategory) {
    if (list.length < 5) continue;
    const amounts = list.map((t) => t.amountBase);
    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const variance = amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length;
    const std = Math.sqrt(variance);
    if (std === 0) continue;
    for (const t of list) {
      const z = (t.amountBase - mean) / std;
      if (z > threshold) {
        anomalies.push({
          tx: t,
          reason: "outlier-category",
          zScore: z,
          baseline: mean,
          context: `средний по категории «${cat}» — ${Math.round(mean).toLocaleString("ru-RU")}, эта в ${(t.amountBase / mean).toFixed(1)}× больше`,
        });
      }
    }
  }

  const byPayee = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.kind !== "expense" || !t.payee) continue;
    if (!byPayee.has(t.payee)) byPayee.set(t.payee, []);
    byPayee.get(t.payee)!.push(t);
  }

  for (const [payee, list] of byPayee) {
    if (list.length < 5) continue;
    const amounts = list.map((t) => t.amountBase);
    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const variance = amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length;
    const std = Math.sqrt(variance);
    if (std === 0) continue;
    for (const t of list) {
      const z = (t.amountBase - mean) / std;
      if (z > threshold) {
        const already = anomalies.some((a) => a.tx.id === t.id);
        if (!already) {
          anomalies.push({
            tx: t,
            reason: "outlier-payee",
            zScore: z,
            baseline: mean,
            context: `обычный чек у «${payee}» — ${Math.round(mean).toLocaleString("ru-RU")}, эта в ${(t.amountBase / mean).toFixed(1)}× больше`,
          });
        }
      }
    }
  }

  return anomalies.sort((a, b) => b.zScore - a.zScore);
}

export interface MonthSpike {
  ym: string;
  category: string;
  current: number;
  baseline: number;
  delta: number;
  ratio: number;
}

export function detectMonthSpikes(txs: Transaction[], minRatio = 1.5): MonthSpike[] {
  const monthsCats = new Map<string, Map<string, number>>();
  for (const t of txs) {
    // Net refunds against the same-month/category total — otherwise
    // a "category jumped 2× this month" alert would fire even when
    // the user fully returned the purchases.
    if (!affectsExpense(t.kind)) continue;
    const ym = t.date.slice(0, 7);
    if (!ym) continue;
    let mc = monthsCats.get(ym);
    if (!mc) {
      mc = new Map();
      monthsCats.set(ym, mc);
    }
    mc.set(t.category, (mc.get(t.category) || 0) + expenseDelta(t));
  }

  const sortedMonths = Array.from(monthsCats.keys()).sort();
  const out: MonthSpike[] = [];

  for (let i = 1; i < sortedMonths.length; i++) {
    const ym = sortedMonths[i];
    const cur = monthsCats.get(ym)!;
    const prev3 = sortedMonths.slice(Math.max(0, i - 3), i);
    if (prev3.length === 0) continue;
    for (const [cat, amount] of cur) {
      let baseSum = 0;
      let baseCount = 0;
      for (const pym of prev3) {
        const v = monthsCats.get(pym)?.get(cat) || 0;
        baseSum += v;
        baseCount++;
      }
      const baseline = baseCount ? baseSum / baseCount : 0;
      if (baseline > 0 && amount / baseline >= minRatio && amount - baseline > 1000) {
        out.push({
          ym,
          category: cat,
          current: amount,
          baseline,
          delta: amount - baseline,
          ratio: amount / baseline,
        });
      }
    }
  }

  return out.sort((a, b) => b.delta - a.delta);
}

export interface CategoryMonthPoint {
  ym: string;
  total: number;
  count: number;
}

export function categoryMonthlySeries(
  txs: Transaction[],
  category: string,
  level: "top" | "full" = "top",
  kind: "expense" | "income" = "expense"
): CategoryMonthPoint[] {
  const map = new Map<string, CategoryMonthPoint>();
  for (const t of txs) {
    // Expense series nets refunds against the same month; income
    // series is unaffected (refunds are not income).
    const include = kind === "expense" ? affectsExpense(t.kind) : t.kind === kind;
    if (!include) continue;
    const matches = level === "top" ? t.category === category : t.categoryFull === category;
    if (!matches) continue;
    const ym = t.date.slice(0, 7);
    if (!ym) continue;
    let p = map.get(ym);
    if (!p) {
      p = { ym, total: 0, count: 0 };
      map.set(ym, p);
    }
    p.total += kind === "expense" ? expenseDelta(t) : t.amountBase;
    p.count++;
  }
  const allMonths = new Set<string>();
  for (const t of txs) {
    if (t.date) allMonths.add(t.date.slice(0, 7));
  }
  const sorted = Array.from(allMonths).sort();
  return sorted.map((ym) => map.get(ym) || { ym, total: 0, count: 0 });
}

export interface DayOfWeekStat {
  dow: number;
  name: string;
  total: number;
  count: number;
  avg: number;
}

const DOW_NAMES = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
const DOW_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

export function statsByDayOfWeek(
  txs: Transaction[],
  kind: "expense" | "income" = "expense"
): DayOfWeekStat[] {
  const buckets = Array.from({ length: 7 }, (_, i) => ({
    dow: i,
    name: DOW_NAMES[i],
    short: DOW_SHORT[i],
    total: 0,
    count: 0,
    avg: 0,
  }));
  const dayCount = new Set<string>();
  for (const t of txs) {
    if (t.kind !== kind) continue;
    const d = new Date(t.date);
    const wd = d.getDay();
    buckets[wd].total += t.amountBase;
    buckets[wd].count++;
    dayCount.add(`${wd}-${t.date}`);
  }
  for (const b of buckets) {
    const days = Array.from(dayCount).filter((k) => k.startsWith(`${b.dow}-`)).length;
    b.avg = days > 0 ? b.total / days : 0;
  }
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.map((i) => buckets[i]);
}

export interface ForecastPoint {
  ym: string;
  income: number;
  expense: number;
  net: number;
  isForecast: boolean;
}

export function buildForecast(
  txs: Transaction[],
  monthsAhead = 3,
  lookback = 6,
  opts: { monthStartDay?: number } = {}
): ForecastPoint[] {
  const months = groupByMonth(txs, { monthStartDay: opts.monthStartDay });
  if (months.length === 0) return [];

  const recent = months.slice(-lookback);
  const avgIncome = recent.reduce((s, m) => s + m.income, 0) / recent.length;
  const avgExpense = recent.reduce((s, m) => s + m.expense, 0) / recent.length;

  const out: ForecastPoint[] = months.map((m) => ({
    ym: m.ym,
    income: m.income,
    expense: m.expense,
    net: m.net,
    isForecast: false,
  }));

  if (months.length === 0) return out;
  const last = months[months.length - 1].ym;
  const [ly, lm] = last.split("-").map(Number);

  for (let i = 1; i <= monthsAhead; i++) {
    const d = new Date(ly, lm - 1 + i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({
      ym,
      income: avgIncome,
      expense: avgExpense,
      net: avgIncome - avgExpense,
      isForecast: true,
    });
  }
  return out;
}

export interface KPI {
  income: number;
  expense: number;
  net: number;
  count: number;
  avgExpense: number;
  avgIncome: number;
  daysSpan: number;
  uniqueCategories: number;
  uniquePayees: number;
}

export function computeKPI(txs: Transaction[]): KPI {
  let income = 0;
  let expense = 0;
  let countExp = 0;
  let countInc = 0;
  const cats = new Set<string>();
  const payees = new Set<string>();
  let minD = "";
  let maxD = "";
  for (const t of txs) {
    if (t.kind === "transfer") continue;
    if (t.kind === "income") {
      income += t.amountBase;
      countInc++;
    } else if (t.kind === "refund") {
      // Refund net-reduces the period's expense; doesn't show up in
      // income KPIs. Count it on the expense side for transaction
      // count so the dashboard "X операций" doesn't drop refunds.
      expense -= t.amountBase;
      countExp++;
    } else {
      expense += t.amountBase;
      countExp++;
    }
    cats.add(t.categoryFull);
    if (t.payee) payees.add(t.payee);
    const d = t.date;
    if (!minD || d < minD) minD = d;
    if (!maxD || d > maxD) maxD = d;
  }
  const daysSpan =
    minD && maxD
      ? Math.max(1, Math.round((+new Date(maxD) - +new Date(minD)) / 86400000) + 1)
      : 0;
  return {
    income,
    expense,
    net: income - expense,
    count: countExp + countInc,
    avgExpense: countExp ? expense / countExp : 0,
    avgIncome: countInc ? income / countInc : 0,
    daysSpan,
    uniqueCategories: cats.size,
    uniquePayees: payees.size,
  };
}
