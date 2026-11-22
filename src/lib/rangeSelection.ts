/**
 * Выделение диапазона строк через Shift — как в почте и файловых менеджерах.
 *
 * Обычный клик переключает одну строку и делает её точкой отсчёта. Shift +
 * клик приводит всё от точки отсчёта до этой строки к одному состоянию:
 * строка была снята — отмечаем диапазон, была отмечена — снимаем. Порядок —
 * порядок списка на экране со всеми фильтрами и сортировкой, включая строки,
 * которые ещё не подгрузились.
 */

/** Как именно кликнули: с зажатым Shift или без. */
export interface SelectGesture {
  shift: boolean;
}

export function applyRangeToggle(
  selected: ReadonlySet<string>,
  order: readonly string[],
  anchor: string | null,
  target: string,
  shift: boolean
): Set<string> {
  const next = new Set(selected);
  // Пустое выделение — начало нового: старая точка отсчёта уже ни о чём не говорит.
  const from = shift && anchor !== null && selected.size > 0 ? order.indexOf(anchor) : -1;
  const to = order.indexOf(target);
  if (from < 0 || to < 0 || from === to) {
    if (next.has(target)) next.delete(target);
    else next.add(target);
    return next;
  }
  const on = !selected.has(target);
  for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
    if (on) next.add(order[i]);
    else next.delete(order[i]);
  }
  return next;
}
