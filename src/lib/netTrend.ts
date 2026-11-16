/**
 * Тренд остатка — сглаженная линия чистого потока по месяцам и вывод словами.
 *
 * Чистый поток по месяцам скачет: премия, отпуск, крупная покупка. По зубцам
 * не видно главного — остаётся ли денег после расходов больше или меньше, чем
 * раньше. Сглаживание (экспоненциальное среднее) гасит разовые скачки, а вывод
 * сравнивает начало сглаженной линии с её концом.
 */

/** Вес свежего месяца в сглаживании: 0,4 — три последних месяца дают ~80%. */
export const NET_TREND_ALPHA = 0.4;

/** Меньше полных месяцев — вывода нет: по двум-трём точкам тренд случаен. */
export const NET_TREND_MIN_MONTHS = 4;

/** Изменение меньше этой доли среднего месячного расхода — «держится ровно». */
export const NET_TREND_FLAT_SHARE = 0.05;

/** Экспоненциальное среднее ряда: первая точка — как есть, дальше с весом `alpha`. */
export function smoothSeries(values: readonly number[], alpha: number = NET_TREND_ALPHA): number[] {
  const out: number[] = [];
  values.forEach((v, i) => {
    out.push(i === 0 ? v : alpha * v + (1 - alpha) * out[i - 1]);
  });
  return out;
}

export type NetTrendDirection = "up" | "down" | "flat";

export interface NetTrendVerdict {
  direction: NetTrendDirection;
  /** Сглаженный остаток в последнем месяце: плюс — деньги остаются. */
  last: number;
  /** На сколько сглаженный остаток изменился с первого месяца по последний. */
  change: number;
  /** Хорошо, плохо или нейтрально — для цвета. */
  tone: "good" | "bad" | "neutral";
  text: string;
}

/**
 * Вывод по сглаженному ряду. `avgExpense` — средний месячный расход периода:
 * от него отсчитывается, что считать заметным изменением (5%).
 * `null` — месяцев мало.
 */
export function netTrendVerdict(smoothed: readonly number[], avgExpense: number): NetTrendVerdict | null {
  if (smoothed.length < NET_TREND_MIN_MONTHS) return null;
  const first = smoothed[0];
  const last = smoothed[smoothed.length - 1];
  const change = last - first;
  const flat = Math.abs(change) < Math.max(1, Math.abs(avgExpense) * NET_TREND_FLAT_SHARE);
  const direction: NetTrendDirection = flat ? "flat" : change > 0 ? "up" : "down";
  const positive = last >= 0;
  const text =
    direction === "up"
      ? positive
        ? "После расходов остаётся всё больше денег"
        : "Расходы всё ещё больше доходов, но разрыв сокращается"
      : direction === "down"
        ? positive
          ? "После расходов остаётся всё меньше денег"
          : "Расходы больше доходов, и разрыв растёт"
        : positive
          ? "Остаток после расходов держится на одном уровне"
          : "Расходы стабильно больше доходов";
  const tone: NetTrendVerdict["tone"] =
    direction === "up" ? "good" : direction === "down" || !positive ? "bad" : "neutral";
  return { direction, last, change, tone, text };
}
