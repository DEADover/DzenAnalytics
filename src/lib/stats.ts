/**
 * Медиана — типичное значение ряда, устойчивое к одиночным выбросам.
 * Пустой ряд — ноль. Исходный массив не меняется.
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
