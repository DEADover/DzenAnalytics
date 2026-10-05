import type { Transaction } from "../types";
import { endAfterDays, spanDays, type DayRange } from "./period";

/**
 * Расходы или доходы двух периодов нарастающим итогом по дням — для графика
 * в «Сравнении периодов», как «Сравнение расходов» в Дзен-мани (#117).
 *
 * Ось — номер дня от начала периода, а не дата: так ложатся друг на друга
 * сентябрь и октябрь, 2025 и 2026 год, и «Сколько потрачено к пятому числу»
 * сравнивается напрямую.
 *
 * Период А рисуется до последнего дня с данными (идущий месяц обрывается на
 * сегодня), период Б — целиком: видно, где он в итоге закончился. Если у Б
 * несколько окон (режим «Среднее»), линия — среднее их нарастающих итогов;
 * короткое окно после своего конца держит итог (у 30-дневного месяца 31-й
 * день равен 30-му).
 */

export type TrackKind = "expense" | "income";

export interface TrackPoint {
  /** День от начала периода, с 1. */
  day: number;
  /** Календарная дата этого дня в периоде А; null — за концом А. */
  dateA: string | null;
  /** Дата этого дня в (первом) окне периода Б; null — за его концом. */
  dateB: string | null;
  /** Нарастающий итог А; null — после последнего дня с данными. */
  a: number | null;
  /** Нарастающий итог Б (среднее по окнам); null — за концом самого длинного окна. */
  b: number | null;
}

export interface CompareTrack {
  points: TrackPoint[];
  /** Сколько дней на оси: самый длинный из периодов. */
  days: number;
  /** До какого дня у А есть данные (0 — данных в периоде нет). */
  aDays: number;
  /** Итог А на его последний день с данными. */
  aTotal: number;
  /** Итог Б к тому же дню — с ним честно сравнивать А. */
  bAtA: number;
  /** Итог Б целиком. */
  bTotal: number;
  /** А ещё идёт: данные кончаются раньше его календарного конца. */
  running: boolean;
}

/** Сколько операция добавляет к расходам или доходам. Возврат уменьшает расход. */
function amountOf(t: Transaction, kind: TrackKind): number {
  if (kind === "income") return t.kind === "income" ? t.amountBase : 0;
  if (t.kind === "expense") return t.amountBase;
  if (t.kind === "refund") return -t.amountBase;
  return 0;
}

/** Нарастающие итоги по дням отрезка: [итог к 1-му дню, к 2-му, …]. */
function cumulative(txs: Transaction[], kind: TrackKind, range: DayRange, len: number): number[] {
  const daily = new Array<number>(len).fill(0);
  for (const t of txs) {
    if (t.date < range.from || t.date > range.to) continue;
    const i = spanDays(range.from, t.date) - 1;
    if (i >= 0 && i < len) daily[i] += amountOf(t, kind);
  }
  let run = 0;
  return daily.map((v) => (run += v));
}

export function buildCompareTrack(
  txs: Transaction[],
  kind: TrackKind,
  /** Период А: полные границы и последний день с данными (`to` ≤ `full.to`). */
  a: { full: DayRange; to: string },
  /** Окна периода Б, целиком. В «Среднем» их несколько, свежее — первое. */
  windowsB: DayRange[]
): CompareTrack {
  const aFullDays = a.full.from && a.full.to ? spanDays(a.full.from, a.full.to) : 0;
  const aDays = a.full.from && a.to ? Math.min(spanDays(a.full.from, a.to), aFullDays) : 0;
  const windows = windowsB.filter((w) => w.from && w.to && spanDays(w.from, w.to) > 0);
  const bLens = windows.map((w) => spanDays(w.from, w.to));
  const days = Math.max(aFullDays, 0, ...bLens);

  const cumA = cumulative(txs, kind, { from: a.full.from, to: a.to }, aDays);
  const cumB = windows.map((w, k) => cumulative(txs, kind, w, bLens[k]));
  const bMaxLen = Math.max(0, ...bLens);

  const bAt = (day: number): number | null => {
    if (windows.length === 0 || day > bMaxLen) return null;
    let sum = 0;
    for (let k = 0; k < cumB.length; k++) {
      const c = cumB[k];
      sum += c[Math.min(day, c.length) - 1] ?? 0;
    }
    return sum / cumB.length;
  };

  const points: TrackPoint[] = [];
  for (let day = 1; day <= days; day++) {
    points.push({
      day,
      dateA: day <= aFullDays ? endAfterDays(a.full.from, day) : null,
      dateB: windows.length && day <= bLens[0] ? endAfterDays(windows[0].from, day) : null,
      a: day <= aDays ? cumA[day - 1] : null,
      b: bAt(day),
    });
  }

  return {
    points,
    days,
    aDays,
    aTotal: aDays > 0 ? cumA[aDays - 1] : 0,
    bAtA: aDays > 0 ? bAt(aDays) ?? 0 : 0,
    bTotal: bAt(bMaxLen) ?? 0,
    running: aDays > 0 && aDays < aFullDays,
  };
}
