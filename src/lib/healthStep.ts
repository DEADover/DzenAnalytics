/**
 * «Главный шаг» и прогноз подушки в «Финансовом здоровье».
 *
 * Главный шаг — одно действие, которое поднимет общую оценку сильнее всего,
 * с суммой в рублях: вместо списка слабых мест — с чего начать.
 */
import { overallOf, type HealthComponent, type HealthScore } from "./health";
import { formatMoney, formatNum } from "./format";
import { pluralRu } from "./plural";

export interface HealthStep {
  /** К какому показателю относится шаг. */
  id: string;
  text: string;
  /** Оценка сейчас и после шага. */
  from: number;
  to: number;
}

const monthsWord = (n: number) => pluralRu(n, ["месяц", "месяца", "месяцев"]);

/** Вариант шага: что сделать и каким станет балл показателя. */
function candidate(c: HealthComponent, base: string): { text: string; score: number } | null {
  const f = c.facts;
  if (c.status === "na" || !f) return null;
  switch (c.id) {
    case "savings_rate": {
      const saved = f.avgIncome - f.avgExpense;
      const rate = f.avgIncome > 0 ? saved / f.avgIncome : 0;
      if (rate >= 0.2 || f.avgIncome <= 0) return null;
      // Ближайшая ступень: сначала 10%, потом цель 20%.
      const goal = rate < 0.1 ? 0.1 : 0.2;
      const need = goal * f.avgIncome - saved;
      return {
        text: `Откладывайте на ${formatMoney(need, base)} в месяц больше — норма сбережений дойдёт до ${goal * 100}%.`,
        score: (goal / 0.2) * 100,
      };
    }
    case "emergency_fund": {
      const coverage = f.avgExpense > 0 ? f.liquid / f.avgExpense : 0;
      if (coverage >= f.target || f.avgExpense <= 0) return null;
      // Ближайшая ступень: три месяца, затем цель.
      const goal = coverage < 3 && f.target > 3 ? 3 : f.target;
      const need = goal * f.avgExpense - f.liquid;
      return {
        text: `Подушка покрывает ${coverage.toFixed(1).replace(".", ",")} мес. Ещё ${formatMoney(need, base)} — и будет ${goal} ${monthsWord(goal)}.`,
        score: Math.min(100, (goal / f.target) * 100),
      };
    }
    case "uncategorized": {
      if (f.uncategorized <= 0) return null;
      return {
        text: `Разберите ${formatNum(f.uncategorized)} ${pluralRu(f.uncategorized, ["операцию", "операции", "операций"])} без категории — аналитика станет точнее.`,
        score: 100,
      };
    }
    case "stability": {
      if (c.score >= 75) return null;
      return {
        text: "Откладывайте одну и ту же сумму каждый месяц — например, автопереводом в день зарплаты.",
        score: 75,
      };
    }
    case "fixed_load": {
      const need = f.monthlyObligatory - 0.5 * f.avgIncome;
      if (need <= 0) return null;
      return {
        text: `Обязательные траты на ${formatMoney(need, base)} в месяц выше половины дохода. Сократите их или отметьте необязательные категории.`,
        // Половина дохода на обязательное — 60 баллов из 100.
        score: 60,
      };
    }
    default:
      return null;
  }
}

/** Шаг с наибольшим приростом общей оценки; `null` — подтягивать нечего. */
export function healthNextStep(score: HealthScore): HealthStep | null {
  let best: HealthStep | null = null;
  for (const c of score.components) {
    const cand = candidate(c, score.baseCurrency);
    if (!cand || cand.score <= c.score) continue;
    const to = overallOf(score.components.map((x) => (x.id === c.id ? { ...x, score: cand.score } : x)));
    if (to > score.overall && (!best || to > best.to)) {
      best = { id: c.id, text: cand.text, from: score.overall, to };
    }
  }
  return best;
}

export interface CushionForecast {
  /** Цель, месяцев расходов. */
  target: number;
  /** Сколько не хватает до цели; 0 — цель набрана. */
  remaining: number;
  /** Сколько откладывается в месяц. */
  pace: number;
  /** Через сколько месяцев наберётся; `null` — при таком темпе не наберётся. */
  months: number | null;
  /** Месяц, когда наберётся, «2027-03». */
  ym: string | null;
}

/** Когда подушка дорастёт до цели при текущем темпе сбережений. */
export function cushionForecast(score: HealthScore, today: string): CushionForecast | null {
  const cushion = score.components.find((c) => c.id === "emergency_fund")?.facts;
  const savings = score.components.find((c) => c.id === "savings_rate")?.facts;
  if (!cushion || cushion.avgExpense <= 0) return null;
  const remaining = Math.max(0, cushion.target * cushion.avgExpense - cushion.liquid);
  const pace = savings ? savings.avgIncome - savings.avgExpense : 0;
  const months = remaining === 0 ? 0 : pace > 0 ? Math.ceil(remaining / pace) : null;
  let ym: string | null = null;
  if (months !== null) {
    const [y, m] = today.slice(0, 7).split("-").map(Number);
    const d = new Date(y, m - 1 + months, 1);
    ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  return { target: cushion.target, remaining, pace, months, ym };
}
