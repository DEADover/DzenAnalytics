import type { Transaction } from "../types";
import { groupByMonth, groupByCategory } from "./aggregations";
import { affectsExpense, expenseDelta } from "./txKindStyle";
import { toIsoDate } from "./period";

export interface YearTopItem {
  name: string;
  amount: number;
  count: number;
}

/**
 * Отрезок года, по которому вообще есть чем мерить.
 *
 * Год — это 365 дней, но данные покрывают не весь: у текущего года впереди
 * будущее, а у первого года истории позади пустота до первой операции. Всё,
 * что считается «по дням» — средний расход, серии без трат, — обязано мерить
 * этот отрезок, а не календарь.
 */
export interface YearWindow {
  /** 1 января — или день первой операции в истории, если она позже. */
  from: string;
  /** 31 декабря — или сегодня, если год ещё идёт. */
  to: string;
  /** Сколько дней в отрезке. Ноль — мерить нечего. */
  days: number;
}

/** Самый долгий перерыв в тратах и когда он случился. */
export interface YearStreak {
  days: number;
  from: string;
  to: string;
}

export interface YearMonthlyPoint {
  ym: string;
  income: number;
  expense: number;
  net: number;
}

export interface YearReview {
  year: number;
  hasData: boolean;
  // Headline numbers
  totalIncome: number;
  totalExpense: number;
  netFlow: number;
  savingsRate: number;
  txCount: number;

  // Comparison to previous year (if available)
  prev: {
    available: boolean;
    income: number;
    expense: number;
    net: number;
    incomeDelta: number;     // (this - prev) / prev
    expenseDelta: number;
    netDelta: number;
  };

  // Tops
  topCategories: YearTopItem[];   // by expense
  topPayees: YearTopItem[];        // by expense
  topTransactions: Transaction[]; // largest single expenses

  // Highlights
  recordMonths: {
    biggestIncome: YearMonthlyPoint | null;
    biggestExpense: YearMonthlyPoint | null;
    bestSaving: YearMonthlyPoint | null; // highest net
  };

  // Patterns
  /** Расход по каждому дню недели, Пн→Вс. Профиль недели одной полоской. */
  weekdays: { name: string; dative: string; total: number }[];
  /** Кварталы года: сезонность крупным планом, без чтения двенадцати месяцев. */
  quarters: { q: number; income: number; expense: number; net: number }[];
  favoriteWeekday: {
    weekday: number; // 0=Пн..6=Вс
    /** Короткое имя: «Сб». */
    name: string;
    /** «субботам» — для фразы «тратили по …». */
    dative: string;
    total: number;
  };
  monthly: YearMonthlyPoint[];

  // Fun facts
  /** Отрезок, по которому считаются все «подневные» числа. */
  window: YearWindow;
  /** Расход в среднем за день отрезка — не за календарный день года. */
  avgPerDay: number;
  /** Средний расход на одну операцию. */
  avgCheck: number;
  /** Сколько операций формируют расход (по ним и считается средний). */
  expenseCount: number;
  /** Какую долю расходов занимает первая пятёрка статей. */
  topFiveShare: number;
  /** Самый долгий перерыв в тратах внутри отрезка. */
  longestStreak: YearStreak;
  /** Сколько дней отрезка были с тратами. */
  daysWithExpense: number;
  /** Контрагентов, а не написаний из выписки. */
  uniqueMerchants: number;
  uniqueCategories: number;
}

/**
 * Имя контрагента для сводок.
 *
 * `payee` — то, что напечатал банк: «DOSTAVKA PYATEROCHKA» и «DOSTAVKA IZ
 * PYATEROCHK» это два разных «получателя» и одна и та же «Пятёрочка». `brand` —
 * запись справочника контрагентов, то самое имя, которое человек видит в
 * операции и сам же завёл. Берём его, а строкой из выписки пользуемся только
 * там, где контрагент к операции не привязан.
 */
export function counterpartyOf(t: Transaction): string {
  return (t.brand?.trim() || t.payee?.trim() || "");
}

/** Сколько строк в топах статей и контрагентов. */
const TOP_SIZE = 10;

const WEEKDAY_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/** Дательный падеж множественного числа: «тратили по субботам». */
const WEEKDAY_RU_DATIVE = [
  "понедельникам",
  "вторникам",
  "средам",
  "четвергам",
  "пятницам",
  "субботам",
  "воскресеньям",
];

function inYear(dateStr: string, year: number): boolean {
  return dateStr.startsWith(`${year}-`);
}

function weekdayMonFirst(d: Date): number {
  // JS: Sun=0, Mon=1, ... → Mon=0, ... Sun=6
  return (d.getDay() + 6) % 7;
}

/** Дни отрезка включительно. Пустой отрезок — пустой список. */
function dayList(from: string, to: string): string[] {
  if (!from || !to || from > to) return [];
  const days: string[] = [];
  const [y, m, d] = from.split("-").map(Number);
  // Локальный конструктор и локальная же сборка обратно: через `toISOString()`
  // в поясе UTC+3 каждый день уезжал бы на сутки назад.
  for (const cur = new Date(y, m - 1, d); ; cur.setDate(cur.getDate() + 1)) {
    const mm = String(cur.getMonth() + 1).padStart(2, "0");
    const dd = String(cur.getDate()).padStart(2, "0");
    const iso = `${cur.getFullYear()}-${mm}-${dd}`;
    if (iso > to) break;
    days.push(iso);
  }
  return days;
}

/**
 * Отрезок года, по которому есть чем мерить.
 *
 * Слева — 1 января или день первой операции в истории: до неё не «не тратили»,
 * а «не вели учёт». Справа — 31 декабря или сегодня: в идущем году впереди
 * будущее, и оно не серия без трат, а просто ещё не наступило. Без правой
 * границы «самая длинная серия без трат» в августе показывала 128 дней —
 * ровно столько оставалось до Нового года.
 */
export function yearWindow(
  transactions: Transaction[],
  year: number,
  today: string
): YearWindow {
  let firstEver = "";
  for (const t of transactions) {
    if (!firstEver || t.date < firstEver) firstEver = t.date.slice(0, 10);
  }
  const from =
    firstEver && firstEver > `${year}-01-01` ? firstEver : `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const to = today < yearEnd ? today : yearEnd;
  if (!from || !to || from > to) return { from, to, days: 0 };
  return { from, to, days: dayList(from, to).length };
}

export function availableYears(transactions: Transaction[]): number[] {
  const set = new Set<number>();
  for (const t of transactions) {
    const y = Number(t.date.slice(0, 4));
    if (Number.isFinite(y)) set.add(y);
  }
  return Array.from(set).sort((a, b) => b - a);
}

export function buildYearReview(
  transactions: Transaction[],
  year: number,
  /** Сегодня, ISO. Параметром — чтобы «идущий год» можно было проверить тестом. */
  today: string = toIsoDate(new Date())
): YearReview {
  const thisYear = transactions.filter((t) => inYear(t.date, year));
  const prevYear = transactions.filter((t) => inYear(t.date, year - 1));
  const window = yearWindow(transactions, year, today);

  const empty: YearReview = {
    year,
    hasData: false,
    totalIncome: 0,
    totalExpense: 0,
    netFlow: 0,
    savingsRate: 0,
    txCount: 0,
    prev: {
      available: prevYear.length > 0,
      income: 0,
      expense: 0,
      net: 0,
      incomeDelta: 0,
      expenseDelta: 0,
      netDelta: 0,
    },
    topCategories: [],
    topPayees: [],
    topTransactions: [],
    recordMonths: { biggestIncome: null, biggestExpense: null, bestSaving: null },
    weekdays: WEEKDAY_RU.map((name, i) => ({
      name,
      dative: WEEKDAY_RU_DATIVE[i],
      total: 0,
    })),
    quarters: [1, 2, 3, 4].map((q) => ({ q, income: 0, expense: 0, net: 0 })),
    favoriteWeekday: {
      weekday: 0,
      name: WEEKDAY_RU[0],
      dative: WEEKDAY_RU_DATIVE[0],
      total: 0,
    },
    monthly: [],
    window,
    avgPerDay: 0,
    avgCheck: 0,
    expenseCount: 0,
    topFiveShare: 0,
    longestStreak: { days: 0, from: "", to: "" },
    daysWithExpense: 0,
    uniqueMerchants: 0,
    uniqueCategories: 0,
  };

  if (thisYear.length === 0) return empty;

  // Headline aggregates
  let totalIncome = 0;
  let totalExpense = 0;
  for (const t of thisYear) {
    if (t.kind === "income") totalIncome += t.amountBase;
    // Refund nets out of the year's expense; never inflates income.
    else if (affectsExpense(t.kind)) totalExpense += expenseDelta(t);
  }
  const netFlow = totalIncome - totalExpense;
  const savingsRate = totalIncome > 0 ? netFlow / totalIncome : 0;

  // Previous year totals
  let prevIncome = 0;
  let prevExpense = 0;
  for (const t of prevYear) {
    if (t.kind === "income") prevIncome += t.amountBase;
    else if (affectsExpense(t.kind)) prevExpense += expenseDelta(t);
  }
  const prevNet = prevIncome - prevExpense;
  const dRel = (cur: number, prev: number) =>
    Math.abs(prev) > 0.01 ? (cur - prev) / Math.abs(prev) : 0;

  // Monthly aggregates
  const monthly: YearMonthlyPoint[] = groupByMonth(thisYear).map((m) => ({
    ym: m.ym,
    income: m.income,
    expense: m.expense,
    net: m.net,
  }));

  // Best / worst month: highest income; highest expense; best net.
  let biggestIncome = monthly[0] || null;
  let biggestExpense = monthly[0] || null;
  let bestSaving = monthly[0] || null;
  for (const m of monthly) {
    if (!biggestIncome || m.income > biggestIncome.income) biggestIncome = m;
    if (!biggestExpense || m.expense > biggestExpense.expense) biggestExpense = m;
    if (!bestSaving || m.net > bestSaving.net) bestSaving = m;
  }

  // Top categories / payees / transactions (expenses only)
  // Статьи дохода в список расходов не берём: «Зарплата — 0 ₽, 0 %» занимала
  // строку в «Куда уходили деньги», хотя деньги оттуда приходили.
  const cats = groupByCategory(thisYear);
  const topCategories: YearTopItem[] = cats
    .filter((c) => c.expense > 0)
    .slice(0, TOP_SIZE)
    .map((c) => ({ name: c.category, amount: c.expense, count: c.count }));

  const payeeMap = new Map<string, { amount: number; count: number }>();
  for (const t of thisYear) {
    // Include refunds so a year's top-payee total reflects net spend
    // ("я заказал на 200к и вернул на 50к" → net 150к, не 200к).
    if (!affectsExpense(t.kind)) continue;
    const key = counterpartyOf(t) || "—";
    const cur = payeeMap.get(key) || { amount: 0, count: 0 };
    cur.amount += expenseDelta(t);
    cur.count++;
    payeeMap.set(key, cur);
  }
  const topPayees: YearTopItem[] = Array.from(payeeMap.entries())
    .map(([name, v]) => ({ name, amount: v.amount, count: v.count }))
    .filter((p) => p.amount > 0) // fully refunded payees drop out
    .sort((a, b) => b.amount - a.amount)
    .slice(0, TOP_SIZE);

  // Кварталы — из тех же помесячных сумм: сезонность видно без чтения
  // двенадцати столбцов подряд.
  const quarters = [1, 2, 3, 4].map((q) => {
    const acc = { q, income: 0, expense: 0, net: 0 };
    for (const m of monthly) {
      const mm = Number(m.ym.slice(5, 7));
      if (Math.ceil(mm / 3) !== q) continue;
      acc.income += m.income;
      acc.expense += m.expense;
      acc.net += m.net;
    }
    return acc;
  });

  const topTransactions = [...thisYear]
    .filter((t) => t.kind === "expense")
    .sort((a, b) => b.amountBase - a.amountBase)
    .slice(0, 5);

  // Favorite weekday (by expense total)
  const weekdayTotals = new Array(7).fill(0) as number[];
  const merchants = new Set<string>();
  const categories = new Set<string>();
  const expenseDays = new Set<string>();
  let expenseCount = 0;
  for (const t of thisYear) {
    if (affectsExpense(t.kind)) expenseCount++;
    if (t.kind === "expense") {
      const d = new Date(t.date);
      if (!Number.isNaN(d.getTime())) {
        weekdayTotals[weekdayMonFirst(d)] += t.amountBase;
      }
      expenseDays.add(t.date.slice(0, 10));
    }
    const who = counterpartyOf(t);
    if (who) merchants.add(who);
    if (t.category) categories.add(t.category);
  }
  let fwdIdx = 0;
  for (let i = 1; i < 7; i++) {
    if (weekdayTotals[i] > weekdayTotals[fwdIdx]) fwdIdx = i;
  }

  // Самый долгий перерыв в тратах — только внутри отрезка с данными.
  const allDays = dayList(window.from, window.to);
  let curStreak = 0;
  let curFrom = "";
  const longestStreak: YearStreak = { days: 0, from: "", to: "" };
  let daysWithExpense = 0;
  for (const d of allDays) {
    if (expenseDays.has(d)) {
      daysWithExpense++;
      curStreak = 0;
      continue;
    }
    if (curStreak === 0) curFrom = d;
    curStreak++;
    if (curStreak > longestStreak.days) {
      longestStreak.days = curStreak;
      longestStreak.from = curFrom;
      longestStreak.to = d;
    }
  }

  return {
    year,
    hasData: true,
    totalIncome,
    totalExpense,
    netFlow,
    savingsRate,
    txCount: thisYear.length,
    prev: {
      available: prevYear.length > 0,
      income: prevIncome,
      expense: prevExpense,
      net: prevNet,
      incomeDelta: dRel(totalIncome, prevIncome),
      expenseDelta: dRel(totalExpense, prevExpense),
      netDelta: dRel(netFlow, prevNet),
    },
    topCategories,
    topPayees,
    topTransactions,
    recordMonths: { biggestIncome, biggestExpense, bestSaving },
    favoriteWeekday: {
      weekday: fwdIdx,
      name: WEEKDAY_RU[fwdIdx],
      dative: WEEKDAY_RU_DATIVE[fwdIdx],
      total: weekdayTotals[fwdIdx],
    },
    weekdays: WEEKDAY_RU.map((name, i) => ({
      name,
      dative: WEEKDAY_RU_DATIVE[i],
      total: weekdayTotals[i],
    })),
    quarters,
    monthly,
    window,
    // Делим на дни отрезка, а не года: иначе расход идущего года размазывался
    // бы по будущему и средний день выходил вдвое меньше настоящего.
    avgPerDay: totalExpense / Math.max(1, window.days),
    avgCheck: expenseCount > 0 ? totalExpense / expenseCount : 0,
    expenseCount,
    topFiveShare:
      totalExpense > 0
        ? topCategories.slice(0, 5).reduce((n, c) => n + c.amount, 0) / totalExpense
        : 0,
    longestStreak,
    daysWithExpense,
    uniqueMerchants: merchants.size,
    uniqueCategories: categories.size,
  };
}
