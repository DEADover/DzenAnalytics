import type { Transaction } from "../types";
import { addMonths, plannedFor, type BudgetKind, type BudgetLine } from "./budgets";
import { ALL_ACCOUNTS, budgetHit, type BudgetScope } from "./budgetScope";
import { periodKey } from "./period";

/**
 * Подсказки для «Заполнить по среднему» — постатейный план на месяц, собранный
 * из истории самих операций.
 *
 * Считает чистая функция, потому что предпросмотр и запись обязаны совпадать:
 * пользователь видит ровно те суммы, которые применятся.
 */

/** По чему считаем предложение: среднее арифметическое или медиана. */
export type ForecastBasis = "average" | "median";

/** Что заполняем: только пустые статьи или все, включая уже спланированные. */
export type ForecastScope = "empty" | "all";

export interface ForecastSuggestion {
  /** Ключ строки — (тип, категория, под-категория). */
  key: string;
  kind: BudgetKind;
  category: string;
  /** null = сам родительский тег (траты, помеченные им напрямую). */
  subcategory: string | null;
  /** Факт по месяцам окна, от старого к новому, уже без ведущих пустых. */
  history: number[];
  /** Сколько месяцев окна реально учтено (длина `history`). */
  monthsUsed: number;
  /** Текущий план на целевой месяц. */
  current: number;
  /** Предложение, округлённое; всегда > 0. */
  suggested: number;
}

export interface ForecastOptions {
  /** Глубина окна в месяцах: 1 — прошлый месяц, 3 — квартал, 12 — год. */
  months: number;
  basis: ForecastBasis;
  /** Шаг округления предложенной суммы. */
  round?: number;
  /** Периметр бюджета: по умолчанию все счета, без переводов. */
  scope?: BudgetScope;
  /**
   * Первый день отчётного месяца, 1–31. История берётся по тем же периодам, по
   * которым потом считается факт: иначе «среднее за квартал» складывалось бы из
   * календарных месяцев, а сравнивали бы его с отчётными.
   */
  monthStartDay?: number;
}

/** Ключ статьи бюджета: тип + категория + под-категория. */
export function tagKey(
  kind: string,
  category: string,
  subcategory: string | null
): string {
  return [kind, category, subcategory ?? ""].join("\u0000");
}

/**
 * Постатейные предложения плана на месяц `ym` по истории до него.
 *
 * Окно — `months` месяцев ПЕРЕД целевым: сам целевой месяц не берём, он ещё
 * не кончился и занизил бы среднее. Ведущие пустые месяцы отбрасываются: если
 * категория появилась в мае, средним за год у неё вышла бы четверть реальных
 * трат. Пустые месяцы ВНУТРИ окна остаются — так редкие траты (страховка раз в
 * квартал) честно размазываются по месяцам, а не выдаются за ежемесячные.
 */
export function buildForecast(
  transactions: Transaction[],
  lines: BudgetLine[],
  ym: string,
  opts: ForecastOptions
): ForecastSuggestion[] {
  const months = Math.max(1, Math.floor(opts.months));
  const round = opts.round ?? 100;
  // Месяцы окна от старого к новому и их позиции — чтобы разложить операции
  // по корзинам за один проход по транзакциям.
  const window: string[] = [];
  for (let i = months; i >= 1; i--) window.push(addMonths(ym, -i));
  const slot = new Map(window.map((m, i) => [m, i]));

  const buckets = new Map<
    string,
    { kind: BudgetKind; category: string; subcategory: string | null; by: number[] }
  >();
  const put = (
    kind: BudgetKind,
    category: string,
    subcategory: string | null,
    idx: number,
    amount: number
  ) => {
    const key = tagKey(kind, category, subcategory);
    let b = buckets.get(key);
    if (!b) {
      b = { kind, category, subcategory, by: new Array(months).fill(0) };
      buckets.set(key, b);
    }
    b.by[idx] += amount;
  };

  const scope = opts.scope ?? ALL_ACCOUNTS;
  const monthStartDay = opts.monthStartDay ?? 1;
  for (const t of transactions) {
    if (!t.date) continue;
    const idx = slot.get(periodKey(t.date, monthStartDay));
    if (idx === undefined) continue;
    const hit = budgetHit(t, scope);
    if (!hit) continue;
    put(hit.kind, hit.category, hit.subcategory, idx, hit.amount);
  }

  const out: ForecastSuggestion[] = [];
  for (const [key, b] of buckets) {
    const first = b.by.findIndex((v) => v !== 0);
    if (first === -1) continue; // в окне не было ни одной операции
    const history = b.by.slice(first);
    const raw =
      opts.basis === "median" ? median(history) : sum(history) / history.length;
    const suggested = Math.max(0, Math.round(raw / round) * round);
    if (suggested <= 0) continue; // ниже шага округления — это не план
    const line = lines.find(
      (l) =>
        l.kind === b.kind &&
        l.category === b.category &&
        (l.subcategory ?? null) === b.subcategory
    );
    out.push({
      key,
      kind: b.kind,
      category: b.category,
      subcategory: b.subcategory,
      history,
      monthsUsed: history.length,
      current: line ? plannedFor(line, ym) : 0,
      suggested,
    });
  }

  // Крупные статьи сверху: с них начинается любая правка бюджета.
  return out.sort((a, b) => b.suggested - a.suggested);
}

/**
 * Скопировать план предыдущего месяца — третий способ занести бюджет из #25,
 * рядом с «вручную» и «по прогнозу».
 *
 * Берёт именно ПЛАН прошлого месяца, а не его факт: у «Заполнить по среднему» с
 * окном в один месяц получилось бы похоже, но это другое число — сколько
 * потратили, а не сколько собирались.
 */
export function previousPlan(
  lines: BudgetLine[],
  ym: string
): ForecastSuggestion[] {
  const prev = addMonths(ym, -1);
  const out: ForecastSuggestion[] = [];
  for (const l of lines) {
    const was = plannedFor(l, prev);
    if (was <= 0) continue;
    out.push({
      key: tagKey(l.kind, l.category, l.subcategory ?? null),
      kind: l.kind,
      category: l.category,
      subcategory: l.subcategory ?? null,
      history: [was],
      monthsUsed: 1,
      current: plannedFor(l, ym),
      suggested: was,
    });
  }
  return out.sort((a, b) => b.suggested - a.suggested);
}

/** Строки, которые реально что-то меняют, с учётом выбранного охвата. */
export function forecastChanges(
  rows: ForecastSuggestion[],
  scope: ForecastScope
): ForecastSuggestion[] {
  return rows.filter((r) =>
    scope === "empty" ? r.current === 0 : r.suggested !== r.current
  );
}

function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

function median(xs: number[]): number {
  const v = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
