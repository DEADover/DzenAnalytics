import type { Transaction } from "../types";
import { formatMoney, formatNum } from "./format";
import {
  groupByMonth,
  netWorthSeries,
  splitByObligation,
  detectUncategorized,
  type CalibrationInput,
  type ObligationMeta,
} from "./aggregations";

export type HealthStatus = "good" | "fair" | "poor" | "na";

export interface HealthComponent {
  id: string;
  label: string;
  weight: number;     // raw weight (used to normalise when one component is N/A)
  score: number;     // 0–100 (or 0 if status is "na")
  value: number | null; // raw metric (savings rate, coverage months, %, etc.)
  status: HealthStatus;
  detail: string;    // what is measured, plain-language
  hint: string;      // advice when score is poor / fair
  /** Optional secondary, purely informational figures shown under the card —
   *  do NOT affect the score. Used by «Подушка безопасности» to also expose the
   *  runway on OBLIGATORY-only spending AND the average monthly obligatory
   *  expense it's based on (issue #32). Raw numbers so the UI can format money
   *  with the user's fraction-digit settings. */
  extra?: {
    /** Runway on obligatory-only spending, in months. */
    obligatoryMonths: number;
    /** Average monthly obligatory expense over the last 12 months (base currency). */
    avgMonthly: number;
    hint?: string;
  };
}

export interface HealthScore {
  overall: number;       // 0–100, weighted across components with status !== "na"
  grade: string;         // A+ / A / B / C / D / E
  components: HealthComponent[];
  baseCurrency: string;
}

interface ComputeOptions {
  transactions: Transaction[];
  baseCurrency: string;
  calibration: CalibrationInput | null;
  /** Category meta (title / full-path → { required }) — drives the
   *  obligatory/optional split per transaction, subcategory-aware (#5). */
  categoryMeta: ObligationMeta;
  /** Off-balance accounts' total (base currency) to add to the emergency fund —
   *  savings kept off-balance ARE the cushion. Pass the sum NOT already counted
   *  by the net-worth calibration (i.e. when «include off-balance» is off). */
  extraLiquid?: number;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

function classify(score: number): HealthStatus {
  if (score >= 75) return "good";
  if (score >= 50) return "fair";
  return "poor";
}

function gradeFor(overall: number): string {
  if (overall >= 90) return "A+";
  if (overall >= 80) return "A";
  if (overall >= 70) return "B";
  if (overall >= 60) return "C";
  if (overall >= 50) return "D";
  return "E";
}

// ─── individual components ────────────────────────────────────────────────────

function computeSavingsRate(opts: ComputeOptions): HealthComponent {
  const months = groupByMonth(opts.transactions);
  const recent = months.slice(-6);
  const avgIncome = mean(recent.map((m) => m.income));
  const avgExpense = mean(recent.map((m) => m.expense));
  const rate = avgIncome > 0 ? (avgIncome - avgExpense) / avgIncome : 0;

  // Target 20%. Score: 0% → 0, 20% → 100, clamp.
  const score = clamp((rate / 0.2) * 100);

  return {
    id: "savings_rate",
    label: "Норма сбережений",
    weight: 30,
    score,
    value: rate,
    status: recent.length === 0 ? "na" : classify(score),
    // Spell out the three numbers behind the percentage: without them the score
    // can't be checked against the same metric on the FIRE block, and «почему у
    // меня столько» остаётся без ответа.
    // Строками, а не одним предложением: бабл рендерит `whitespace-pre-line`,
    // и три суммы под собой читаются с одного взгляда.
    detail:
      "Какую долю дохода вы откладываете: (доход − расход) ÷ доход.\n" +
      "Считаем за последние 6 месяцев. Хорошо — от 20%." +
      (recent.length
        ? `\n\nСредние за период:\n` +
          `· доход — ${formatMoney(avgIncome, opts.baseCurrency)}\n` +
          `· расход — ${formatMoney(avgExpense, opts.baseCurrency)}\n` +
          `· остаётся — ${formatMoney(avgIncome - avgExpense, opts.baseCurrency)} в месяц`
        : ""),
    hint:
      rate < 0.1
        ? "Стремитесь откладывать 20%. Начните с необязательных трат — кафе, развлечения, подписки: там проще всего высвободить деньги."
        : rate < 0.2
          ? "Почти у цели в 20%. Загляните в топ категорий — где ещё можно сэкономить."
          : "",
  };
}

function computeEmergencyFund(opts: ComputeOptions): HealthComponent {
  const series = netWorthSeries(opts.transactions, opts.calibration);
  const netWorth = series.length > 0 ? series[series.length - 1].net : 0;
  // Off-balance savings count toward the cushion even when they're excluded
  // from the headline net worth.
  const liquid = netWorth + (opts.extraLiquid ?? 0);
  const months = groupByMonth(opts.transactions);
  const recent = months.slice(-6);
  const avgExpense = mean(recent.map((m) => m.expense));
  const coverage = avgExpense > 0 ? liquid / avgExpense : 0;

  // Runway on OBLIGATORY spending over the last 12 months (issue #32). In a
  // real emergency the discretionary spend is the first thing cut, so the
  // savings actually last longer than the all-expenses figure suggests — this
  // «worst-case survival» number divides the same liquid cushion by the
  // average MONTHLY obligatory expense across up to 12 recent months.
  const last12 = months.slice(-12);
  const last12Set = new Set(last12.map((m) => m.ym));
  const last12Txs = opts.transactions.filter((t) =>
    last12Set.has(t.date.slice(0, 7))
  );
  const obligatory12 = splitByObligation(last12Txs, opts.categoryMeta).obligatory;
  const avgMonthlyObligatory =
    last12.length > 0 ? obligatory12 / last12.length : 0;
  const obligatoryCoverage =
    avgMonthlyObligatory > 0 ? liquid / avgMonthlyObligatory : 0;

  // Target: 6 months. Score: 0 → 0, 6 → 100, clamp.
  const score = clamp((coverage / 6) * 100);

  return {
    id: "emergency_fund",
    label: "Подушка безопасности",
    weight: 25,
    score,
    value: coverage,
    status: avgExpense <= 0 ? "na" : classify(score),
    // Числа, из которых получились месяцы: без них «3,4 месяца» невозможно
    // сверить ни с балансом на «Счетах», ни со средним расходом (issue #52).
    detail:
      "Запас денег на чёрный день. На сколько месяцев хватит накоплений, если доход вдруг пропадёт, а траты оставить прежними. Цель — 6 месяцев." +
      (avgExpense > 0
        ? "\n\nОткуда цифра:\n" +
          `· накопления — ${formatMoney(liquid, opts.baseCurrency)}\n` +
          `· средний расход — ${formatMoney(avgExpense, opts.baseCurrency)} в месяц (за 6 мес)\n` +
          `· хватит на — ${coverage.toFixed(1)} мес`
        : ""),
    extra:
      avgMonthlyObligatory > 0
        ? {
            obligatoryMonths: obligatoryCoverage,
            avgMonthly: avgMonthlyObligatory,
            hint: "А если в кризис оставить только обязательные траты — накоплений хватит на дольше. Считаем по средним обязательным расходам за последний год.",
          }
        : undefined,
    hint:
      coverage < 1
        ? "Меньше месяца запаса — это рискованно. Сделайте подушку первой целью."
        : coverage < 3
          ? "Стремитесь хотя бы к 3 месяцам. Полноценная подушка — это 6 месяцев расходов."
          : coverage < 6
            ? "Уже неплохо. Доведите до 6 месяцев — этого хватит, чтобы спокойно пережить потерю работы или крупную непредвиденную трату."
            : "",
  };
}

function computeUncategorized(opts: ComputeOptions): HealthComponent {
  const total = opts.transactions.filter((t) => t.kind !== "transfer").length;
  const uncategorized = detectUncategorized(opts.transactions).length;
  const pct = total > 0 ? uncategorized / total : 0;

  // Target: < 5%. Score: 0% → 100, 10% → 0.
  const score = clamp(100 - pct * 1000);

  return {
    id: "uncategorized",
    label: "Чистота категоризации",
    weight: 15,
    score,
    // Reported as the SHARE THAT IS categorized — 100% means everything has a
    // category (the intuitive «all good» direction), not the uncategorized %.
    value: total > 0 ? 1 - pct : 0,
    status: total === 0 ? "na" : classify(score),
    detail:
      "Доля операций, которым присвоена категория. Чем больше — тем точнее вся аналитика. Хорошо — от 95%." +
      (total > 0
        ? "\n\nОткуда цифра:\n" +
          `· без категории — ${formatNum(uncategorized)} из ${formatNum(total)} операций\n` +
          `· это ${(pct * 100).toFixed(1)}% — переводы между своими счетами не считаем`
        : ""),
    hint:
      pct > 0.1
        ? "Много операций без категории — из-за этого аналитика неточная. На странице «Без категории» есть умные подсказки: они создают правила в один клик."
        : pct > 0.05
          ? "Осталось немного разобрать. Загляните на страницу «Без категории»."
          : "",
  };
}

function computeStability(opts: ComputeOptions): HealthComponent {
  const months = groupByMonth(opts.transactions);
  const recent = months.slice(-12);
  if (recent.length < 3) {
    return {
      id: "stability",
      label: "Стабильность сбережений",
      weight: 15,
      score: 0,
      value: null,
      status: "na",
      detail:
        "Насколько ровно вы откладываете из месяца в месяц за последний год. Чем стабильнее — тем лучше.",
      hint: "Нужно минимум 3 месяца данных, чтобы оценить.",
    };
  }
  const rates = recent
    .filter((m) => m.income > 0)
    .map((m) => (m.income - m.expense) / m.income);
  if (rates.length < 3) {
    return {
      id: "stability",
      label: "Стабильность сбережений",
      weight: 15,
      score: 0,
      value: null,
      status: "na",
      detail:
        "Насколько ровно вы откладываете из месяца в месяц за последний год. Чем стабильнее — тем лучше.",
      hint: "Нужно минимум 3 месяца с положительным доходом, чтобы оценить.",
    };
  }
  const m = mean(rates);
  const sd = stddev(rates);
  // CV = sd / |mean|. Если mean маленький — CV неустойчив, поэтому защитимся.
  const cv = Math.abs(m) > 0.01 ? sd / Math.abs(m) : sd / 0.01;
  // Target CV ≤ 0.5. Score: CV 0 → 100, CV 1 → 0.
  const score = clamp(100 - cv * 100);

  return {
    id: "stability",
    label: "Стабильность сбережений",
    weight: 15,
    score,
    value: cv,
    status: classify(score),
    detail:
      "Насколько ровно вы откладываете из месяца в месяц. Чем ровнее суммы — тем лучше. То густо, то пусто — балл ниже.\n\n" +
      "Откуда цифра:\n" +
      `· месяцев в расчёте — ${rates.length} (берём последние 12, считаем те, где был доход)\n` +
      `· откладываете в среднем — ${(m * 100).toFixed(0)}% дохода\n` +
      `· разброс по месяцам — ±${(sd * 100).toFixed(0)} п.п.\n` +
      `· оценка = разброс ÷ среднее = ${cv.toFixed(2)}; хорошо — до 0.50`,
    hint:
      cv > 1
        ? "Суммы сильно скачут. Настройте автоперевод на накопления в начале месяца — так ровнее."
        : cv > 0.5
          ? "Суммы накоплений скачут от месяца к месяцу. Попробуйте откладывать одну и ту же сумму каждый месяц — так проще и стабильнее."
          : "",
  };
}

function computeFixedLoad(opts: ComputeOptions): HealthComponent {
  const months = groupByMonth(opts.transactions);
  const recent = months.slice(-6);
  const avgIncome = mean(recent.map((m) => m.income));

  // Берём расходы последних 6 месяцев и считаем долю обязательных.
  const recentSet = new Set(recent.map((r) => r.ym));
  const recentTxs = opts.transactions.filter((t) =>
    recentSet.has(t.date.slice(0, 7))
  );
  const split = splitByObligation(recentTxs, opts.categoryMeta);
  const monthlyObligatory =
    recent.length > 0 ? split.obligatory / recent.length : 0;
  const share = avgIncome > 0 ? monthlyObligatory / avgIncome : 0;

  // Target ≤ 50%. Score: 30% → 100, 80% → 0.
  const score = clamp(100 - (share - 0.3) * 200);

  return {
    id: "fixed_load",
    label: "Обязательные траты в доходе",
    weight: 15,
    score,
    value: share,
    status: avgIncome <= 0 ? "na" : classify(score),
    detail:
      "Какая часть дохода уходит на то, без чего не обойтись: жильё, продукты, кредиты, транспорт. Чем меньше — тем больше остаётся на цели и накопления. Хорошо — меньше 50%. Отметить обязательные категории можно на странице «Категории»." +
      (avgIncome > 0
        ? "\n\nСредние за 6 месяцев:\n" +
          `· доход — ${formatMoney(avgIncome, opts.baseCurrency)} в месяц\n` +
          `· обязательные траты — ${formatMoney(monthlyObligatory, opts.baseCurrency)} в месяц\n` +
          // Один знак после запятой — как в самой карточке: «61%» против
          // «60.5%» на строке выше читалось бы как расхождение.
          `· доля — ${(share * 100).toFixed(1)}%`
        : ""),
    hint:
      share > 0.8
        ? "Обязательные траты забирают почти весь доход — запаса почти нет. По возможности пересмотрите крупные платежи: рефинансирование кредита, переезд, отказ от лишних подписок."
        : share > 0.5
          ? "Около половины дохода уходит на обязательное — рабочий уровень, но запас прочности небольшой. Хороший следующий шаг — нарастить подушку и снизить постоянные платежи."
          : "",
  };
}

// ─── public API ───────────────────────────────────────────────────────────────

export function computeHealthScore(opts: ComputeOptions): HealthScore {
  const components: HealthComponent[] = [
    computeSavingsRate(opts),
    computeEmergencyFund(opts),
    computeUncategorized(opts),
    computeStability(opts),
    computeFixedLoad(opts),
  ];

  // Weighted average over components with non-NA status.
  const active = components.filter((c) => c.status !== "na");
  const totalWeight = active.reduce((s, c) => s + c.weight, 0);
  const overall =
    totalWeight > 0
      ? Math.round(active.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight)
      : 0;

  return {
    overall,
    grade: gradeFor(overall),
    components,
    baseCurrency: opts.baseCurrency,
  };
}
