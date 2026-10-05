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
 *
 * Годы совмещаются по календарной дате, а не по номеру дня: в високосном
 * году 270-й день — 26 сентября, в обычном — 27-е. 29 февраля в паре с
 * обычным годом ложится на 28-е.
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
  /** Последний день, где есть обе линии: на нём честно сравнивать периоды. */
  cmpDay: number;
  /** Итог А и Б на `cmpDay`. */
  aAtCmp: number;
  bAtCmp: number;
  /** Итоги целиком. */
  aTotal: number;
  bTotal: number;
  /** А ещё идёт: данные кончаются раньше его календарного конца. */
  running: boolean;
  /** Б кончается раньше А (например, Б — идущий год против прошлого целиком). */
  bShorter: boolean;
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

/**
 * Та же календарная дата в периоде Б: год сдвигается на разницу начал
 * периодов. 29 февраля в невисокосном году — 28-е.
 */
function sameDateIn(dateA: string, aFrom: string, bFrom: string): string {
  const y = Number(dateA.slice(0, 4)) + (Number(bFrom.slice(0, 4)) - Number(aFrom.slice(0, 4)));
  let md = dateA.slice(5);
  if (md === "02-29" && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) md = "02-28";
  return `${y}-${md}`;
}

export function buildCompareTrack(
  txs: Transaction[],
  kind: TrackKind,
  /** Период А: полные границы и последний день с данными (`to` ≤ `full.to`). */
  a: { full: DayRange; to: string },
  /** Окна периода Б, целиком. В «Среднем» их несколько, свежее — первое. */
  windowsB: DayRange[],
  /**
   * Совмещать по календарной дате (годы, «с начала года»), а не по номеру дня.
   * Берётся первое окно Б.
   */
  calendar = false
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
  if (calendar && aFullDays > 0) {
    // Ось — даты А; у каждой своя дата в Б с тем же числом и месяцем.
    const w = windows[0];
    const cb = w ? cumB[0] : [];
    for (let day = 1; day <= aFullDays; day++) {
      const dateA = endAfterDays(a.full.from, day);
      const dateB = w ? sameDateIn(dateA, a.full.from, w.from) : null;
      let b: number | null = null;
      if (w && dateB && dateB >= w.from && dateB <= w.to) b = cb[spanDays(w.from, dateB) - 1] ?? 0;
      points.push({ day, dateA, dateB, a: day <= aDays ? cumA[day - 1] : null, b });
    }
  } else {
    for (let day = 1; day <= days; day++) {
      points.push({
        day,
        dateA: day <= aFullDays ? endAfterDays(a.full.from, day) : null,
        dateB: windows.length && day <= bLens[0] ? endAfterDays(windows[0].from, day) : null,
        a: day <= aDays ? cumA[day - 1] : null,
        b: bAt(day),
      });
    }
  }

  // Последний день, где есть обе линии.
  let cmpDay = 0;
  for (const p of points) if (p.a != null && p.b != null) cmpDay = p.day;
  const at = cmpDay > 0 ? points[cmpDay - 1] : null;
  const lastB = [...points].reverse().find((p) => p.b != null);

  return {
    points,
    days: points.length,
    aDays,
    cmpDay,
    aAtCmp: at?.a ?? 0,
    bAtCmp: at?.b ?? 0,
    aTotal: aDays > 0 ? cumA[aDays - 1] : 0,
    bTotal: calendar ? (cumB[0]?.[cumB[0].length - 1] ?? 0) : (bAt(bMaxLen) ?? 0),
    running: aDays > 0 && aDays < aFullDays,
    bShorter: !!lastB && aDays > 0 && lastB.day < aDays,
  };
}
