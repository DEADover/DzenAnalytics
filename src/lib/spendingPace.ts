/**
 * «Темп трат» — расходы месяца нарастающим итогом рядом с прошлым месяцем и
 * со средним за несколько последних.
 *
 * «Итоги месяца» говорят, во сколько раз темп отличается от обычного, одним
 * числом. Здесь тот же вопрос — линией: видно, с какого дня месяц пошёл
 * быстрее и одна ли крупная покупка в этом виновата.
 *
 * Нарастающие итоги считает `buildCompareTrack` — тот же расчёт, что у графика
 * в «Сравнении периодов», чтобы два места в сервисе не разошлись: возврат
 * уменьшает расход, переводы не считаются, месяцы совмещаются по номеру дня.
 */

import type { Transaction } from "../types";
import { buildCompareTrack } from "./compareTrack";
import { endAfterDays, periodKey, periodRange, shiftPeriod, spanDays } from "./period";
import { NO_CATEGORY } from "./zenmoneyMap";

export interface PacePoint {
  /** День от начала отчётного месяца, с 1. */
  day: number;
  /** Календарная дата этого дня в месяце виджета. */
  date: string;
  /** Потрачено к этому дню; null — день ещё не наступил. */
  now: number | null;
  /** Столько же в прошлом месяце; null — истории нет или месяц короче. */
  prev: number | null;
  /** В среднем за последние месяцы; null — сравнивать не с чем. */
  avg: number | null;
}

export interface SpendingPace {
  points: PacePoint[];
  /** До какого дня дошёл месяц (0 — ещё не начался). */
  nowDays: number;
  /** Месяц ещё идёт. */
  running: boolean;
  /** Потрачено к последнему дню с данными. */
  nowAt: number;
  /** Прошлый месяц к тому же дню; null — истории нет. */
  prevAt: number | null;
  /** Среднее к тому же дню; null — меньше двух полных месяцев истории. */
  avgAt: number | null;
  /** Прошлый месяц целиком. */
  prevTotal: number | null;
  /** Сколько месяцев вошло в среднее (0 — среднего нет). */
  avgMonths: number;
}

/** Сколько месяцев берётся в среднее, если история позволяет. */
export const PACE_AVG_MONTHS = 3;

export function buildSpendingPace(
  txs: Transaction[],
  ym: string,
  startDay: number,
  /** «Сегодня», YYYY-MM-DD: идущий месяц обрывается на нём. */
  today: string,
  avgMonths: number = PACE_AVG_MONTHS
): SpendingPace {
  const full = periodRange(ym, startDay);
  const days = spanDays(full.from, full.to);
  const to = today < full.from ? "" : today < full.to ? today : full.to;

  // Первый месяц истории: всё, что раньше него, — пустота, а не «ноль трат».
  const first = txs.reduce((mn, t) => (mn === "" || t.date < mn ? t.date : mn), "");
  const firstYm = first ? periodKey(first, startDay) : "";

  const prevYm = shiftPeriod(ym, -1);
  const hasPrev = firstYm !== "" && prevYm >= firstYm;
  // В среднее идут только ПОЛНЫЕ месяцы: первый месяц истории обычно начат с
  // середины и занизил бы линию.
  const avgWindows = [];
  for (let k = 1; k <= avgMonths; k++) {
    const w = shiftPeriod(ym, -k);
    if (firstYm === "" || w <= firstYm) break;
    avgWindows.push(periodRange(w, startDay));
  }
  // Среднее по одному месяцу — это и есть прошлый месяц: вторая линия поверх
  // первой ничего не добавляет.
  const hasAvg = avgWindows.length >= 2;

  const a = { full, to };
  const prev = buildCompareTrack(txs, "expense", a, hasPrev ? [periodRange(prevYm, startDay)] : []);
  const avg = hasAvg ? buildCompareTrack(txs, "expense", a, avgWindows) : null;

  const points: PacePoint[] = [];
  for (let i = 0; i < days; i++) {
    const p = prev.points[i];
    points.push({
      day: i + 1,
      date: p?.dateA ?? "",
      now: p?.a ?? null,
      prev: hasPrev ? (p?.b ?? null) : null,
      avg: avg ? (avg.points[i]?.b ?? null) : null,
    });
  }

  const nowDays = prev.aDays;
  const at = nowDays > 0 ? points[nowDays - 1] : null;
  return {
    points,
    nowDays,
    running: nowDays < days,
    nowAt: prev.aTotal,
    // В коротком прошлом месяце этого дня могло не быть — тогда его итог.
    prevAt: hasPrev ? (at?.prev ?? prev.bTotal) : null,
    avgAt: avg ? (at?.avg ?? avg.bTotal) : null,
    prevTotal: hasPrev ? prev.bTotal : null,
    avgMonths: hasAvg ? avgWindows.length : 0,
  };
}

/** Статья расходов месяца рядом с тем же отрезком прошлого. */
export interface PaceCategory {
  name: string;
  /** Потрачено с начала месяца. */
  now: number;
  /** За столько же дней прошлого месяца; null — истории нет. */
  prev: number | null;
  /** Строка «Остальное»: всё, что не вошло в первые. */
  rest?: boolean;
}

/** Сколько статей показывать поимённо: остальные складываются в одну строку. */
export const PACE_TOP_CATEGORIES = 4;

/**
 * Крупнейшие статьи расходов месяца и сколько на них ушло за те же дни
 * прошлого — как в «Расходах» Дзен-мани.
 *
 * Отрезки те же, что у линий графика: идущий месяц — по сегодня, от прошлого
 * берётся столько же дней. Сумма строк равна числу в шапке виджета.
 */
export function paceCategories(
  txs: Transaction[],
  ym: string,
  startDay: number,
  today: string,
  top: number = PACE_TOP_CATEGORIES
): PaceCategory[] {
  const full = periodRange(ym, startDay);
  if (today < full.from) return [];
  const to = today < full.to ? today : full.to;
  const prevFull = periodRange(shiftPeriod(ym, -1), startDay);
  const prevEnd = endAfterDays(prevFull.from, spanDays(full.from, to));
  const prevTo = prevEnd < prevFull.to ? prevEnd : prevFull.to;
  const hasPrev = txs.some((t) => t.date <= prevFull.to);

  const now = new Map<string, number>();
  const prev = new Map<string, number>();
  for (const t of txs) {
    const amount = t.kind === "expense" ? t.amountBase : t.kind === "refund" ? -t.amountBase : 0;
    if (amount === 0) continue;
    const into =
      t.date >= full.from && t.date <= to
        ? now
        : t.date >= prevFull.from && t.date <= prevTo
          ? prev
          : null;
    if (!into) continue;
    const name = t.category || NO_CATEGORY;
    into.set(name, (into.get(name) ?? 0) + amount);
  }

  const sorted = [...now.entries()].sort((a, b) => b[1] - a[1]);
  const head = sorted.filter(([, v]) => v > 0).slice(0, top);
  const named = new Set(head.map(([name]) => name));
  const rows: PaceCategory[] = head.map(([name, v]) => ({
    name,
    now: v,
    prev: hasPrev ? (prev.get(name) ?? 0) : null,
  }));

  let restNow = 0;
  let restPrev = 0;
  let restAny = false;
  for (const [name, v] of now)
    if (!named.has(name)) {
      restNow += v;
      restAny = true;
    }
  for (const [name, v] of prev)
    if (!named.has(name)) {
      restPrev += v;
      restAny = true;
    }
  if (restAny) rows.push({ name: "Остальное", now: restNow, prev: hasPrev ? restPrev : null, rest: true });
  return rows;
}
