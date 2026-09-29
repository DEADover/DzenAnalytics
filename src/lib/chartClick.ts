/**
 * Строка данных графика, по которой щёлкнули.
 *
 * В Recharts 2 обработчик щелчка по графику получал `activePayload` — строки
 * под курсором. В Recharts 3 этого поля нет: приходят только номер точки
 * (`activeIndex`, строкой) и подпись оси. Все переходы по щелчку, написанные
 * под `activePayload`, после обновления молча перестали работать — щелчок по
 * месяцу на главной, в «Cash-flow», «Трендах», «Динамике» и «Годе в цифрах»
 * ничего не открывал. Строку берём по номеру точки из тех же данных, что
 * отданы графику.
 */
export function clickedRow<T>(state: unknown, data: readonly T[]): T | undefined {
  const s = state as { activeIndex?: unknown; activeTooltipIndex?: unknown } | null | undefined;
  const raw = s?.activeTooltipIndex ?? s?.activeIndex;
  const i = typeof raw === "number" ? raw : typeof raw === "string" && raw !== "" ? Number(raw) : NaN;
  return Number.isInteger(i) && i >= 0 && i < data.length ? data[i] : undefined;
}

/** Ключ серии под курсором, если график его знает (у линий — при наведении на точку). */
export function clickedDataKey(state: unknown): string | undefined {
  const k = (state as { activeDataKey?: unknown } | null | undefined)?.activeDataKey;
  return typeof k === "string" ? k : undefined;
}
