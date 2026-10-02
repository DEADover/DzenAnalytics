/**
 * Как показывать разницу двух сумм в столбцах «Отклонение», «Изменение» и им
 * подобных: деньгами, процентом или деньгами с процентом в скобках.
 *
 * Один набор режимов на все такие столбцы продукта — переключатель в шапке
 * (`DiffModeToggle`) перебирает их по кругу, а выбранный запоминается для
 * каждой таблицы отдельно (`useDiffModeStore`).
 */

export type DiffMode = "money" | "pct" | "both";

export const DIFF_MODES: readonly DiffMode[] = ["money", "pct", "both"];

export const isDiffMode = (v: unknown): v is DiffMode =>
  typeof v === "string" && (DIFF_MODES as readonly string[]).includes(v);

/** Следующий режим по кругу: деньги → проценты → оба → деньги. */
export function nextDiffMode(mode: DiffMode): DiffMode {
  return DIFF_MODES[(DIFF_MODES.indexOf(mode) + 1) % DIFF_MODES.length];
}

/** Что показывает режим — для подсказки переключателя. */
export const DIFF_MODE_TEXT: Record<DiffMode, string> = {
  money: "в деньгах",
  pct: "в процентах",
  both: "в деньгах и процентах",
};

/**
 * По чему сортировать столбец разницы. В процентном режиме — по относительному
 * изменению (база около нуля уходит вниз, а не притворяется бесконечностью), в
 * остальных — по самой разнице: «деньги (процент)» читаются по деньгам.
 */
export function diffSortValue(
  current: number,
  baseline: number | undefined,
  mode: DiffMode
): number | undefined {
  if (baseline === undefined) return undefined;
  const diff = current - baseline;
  if (mode !== "pct") return diff;
  return Math.abs(baseline) >= 0.5 ? diff / Math.abs(baseline) : undefined;
}
