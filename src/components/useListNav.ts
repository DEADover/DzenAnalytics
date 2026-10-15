import { useId, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

/**
 * Подсвеченный пункт выпадающего списка — общий для `Combobox`, `Select` и
 * `CategoryCascadePicker`: ↑/↓ двигают подсветку, Enter выбирает её.
 *
 * Подсветка одна на список — и для клавиш, и для мыши: наведение переносит её
 * на пункт под курсором, иначе подсвеченными оказывались бы два пункта сразу.
 * Прокрутка к подсвеченному — только после клавиш и при открытии: при
 * наведении пункт и так на виду, а прокрутка под неподвижным курсором тащила
 * бы список за мышью.
 */
export function useListNav(count: number, open: boolean) {
  const [raw, setRaw] = useState(-1);
  /**
   * Довести ли следующую подсветку до глаз: `list` — прокрутить только сам
   * список (открытие: окно и страница не должны дёргаться от щелчка по полю),
   * `full` — ещё и окно, если список в нём обрезан (шаг стрелкой).
   */
  const scrollNext = useRef<"none" | "list" | "full">("none");
  /** Где курсор стоял в прошлый раз: `mousemove` бывает и без движения мыши —
   *  когда список прокрутился под курсором, — его не считаем наведением. */
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const baseId = useId();

  /** Список сузился (поиск) — подсветка за его краем не считается. */
  const active = raw >= 0 && raw < count ? raw : -1;
  const optionId = (i: number) => `${baseId}opt${i}`;

  useLayoutEffect(() => {
    const mode = scrollNext.current;
    if (!open || active < 0 || mode === "none") return;
    scrollNext.current = "none";
    const el = document.getElementById(optionId(active));
    if (!el) return;
    revealInList(el);
    if (mode === "full") el.scrollIntoView({ block: "nearest" });
    // optionId — производная от baseId, он постоянен.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  return {
    /** Индекс подсвеченного пункта, −1 — подсветки нет. */
    active,
    listId: `${baseId}list`,
    optionId,
    /** Шаг стрелкой. Без подсветки ↓ встаёт на первый пункт, ↑ — на последний;
     *  у краёв списка подсветка останавливается, а не перескакивает. */
    move(delta: number): number {
      if (count === 0) return -1;
      const next =
        active < 0
          ? delta > 0
            ? 0
            : count - 1
          : Math.max(0, Math.min(count - 1, active + delta));
      scrollNext.current = "full";
      setRaw(next);
      return next;
    },
    /** Поставить подсветку; `scroll` — прокрутить список к пункту. */
    set(i: number, scroll = false) {
      scrollNext.current = scroll ? "list" : "none";
      setRaw(i);
    },
    /** `onMouseMove` пункта: подсветка переезжает под курсор. */
    hover(i: number, e: ReactMouseEvent) {
      const p = lastPointer.current;
      if (p && p.x === e.clientX && p.y === e.clientY) return;
      lastPointer.current = { x: e.clientX, y: e.clientY };
      if (i !== active) setRaw(i);
    },
  };
}

/**
 * Прокрутить ближайший прокручиваемый контейнер пункта внутри его
 * `role="listbox"` (сам список) так, чтобы
 * пункт стал виден целиком. В отличие от `scrollIntoView`, не трогает окно и
 * страницу. Учитывает `scroll-margin-top` — место под липкий заголовок группы.
 */
function revealInList(el: HTMLElement) {
  // Ищем не выше самого списка: короткий список не прокручивается, и тогда
  // поиск ушёл бы в тело окна — открытие поля сдвигало бы форму.
  const root = el.closest('[role="listbox"]');
  let box = el.parentElement;
  while (box) {
    const oy = getComputedStyle(box).overflowY;
    if ((oy === "auto" || oy === "scroll") && box.scrollHeight > box.clientHeight) break;
    if (box === root) return;
    box = box.parentElement;
  }
  if (!box) return;
  const b = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const marginTop = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  if (r.top - marginTop < b.top) box.scrollTop -= b.top - (r.top - marginTop);
  else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom;
}
