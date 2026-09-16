import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import clsx from "clsx";
import { useFiltersDockStore } from "../store/useFiltersDockStore";

type Phase = "hidden" | "in" | "shown" | "out";

/**
 * Полка под шапкой для панели общих фильтров (`useFiltersDockStore`).
 *
 * Живёт ВНУТРИ `<header>` (см. TopNav) вторым ярусом: одна подложка, одно
 * размытие, и при упругой прокрутке вверх шапка с панелью едут вместе — раньше
 * панель висела отдельным слоем на `body` и в этот момент уезжала под шапку,
 * выдавая шов. Внутри шапки она стоит `absolute` под её нижним краем, поэтому
 * высоты шапки не меняет: страница под ней не сдвигается, а `--app-header-h`
 * остаётся прежней.
 *
 * Выезжает из-под нижнего края шапки сдвигом, а на время хода контейнер
 * обрезает её по этому краю (`overflow: hidden`). Не `clip-path`: у предка он
 * становится корнем размытия, и матовое стекло панели во время анимации
 * ничего не размывало. Закрытая панель остаётся смонтированной
 * (`hidden`): у фильтров есть работа и в спрятанном виде — они подгружают
 * сведения о счетах, без которых фильтрация неполная.
 *
 * Внутри панели не должно быть `position: fixed`: у обёртки на время хода
 * есть сдвиг, и такой потомок считался бы от неё, а не от экрана. Все выпадающие списки
 * фильтров уходят порталом на `body` (`Popover`, `MultiSelect`, даты).
 */
export function FiltersDock() {
  const open = useFiltersDockStore((s) => s.open);
  const close = useFiltersDockStore((s) => s.close);
  const setDockEl = useFiltersDockStore((s) => s.setDockEl);
  const [phase, setPhase] = useState<Phase>("hidden");
  const { pathname } = useLocation();

  const reduce =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // Фаза следует за open. Смена состояния прямо в отрисовке — чтобы кадр
  // появления не мелькнул без анимации.
  const [seenOpen, setSeenOpen] = useState(open);
  if (seenOpen !== open) {
    setSeenOpen(open);
    setPhase(open ? (reduce ? "shown" : "in") : reduce ? "hidden" : "out");
  }

  // Страховка на случай, когда `animationend` не придёт: во вкладке в фоне
  // анимации не идут, и панель осталась бы спрятанной (у `dockIn` кадр
  // «закрыто» — это панель, целиком уехавшая за край шапки). По таймеру фаза доедет до покоя в любом
  // случае, а если событие придёт раньше — оно же таймер и снимет.
  useEffect(() => {
    if (phase !== "in" && phase !== "out") return;
    const id = window.setTimeout(() => setPhase(open ? "shown" : "hidden"), 600);
    return () => window.clearTimeout(id);
  }, [phase, open]);

  // Новый раздел — панель убираем: переход открывает страницу, а не фильтр.
  useEffect(() => {
    close();
  }, [pathname, close]);

  // Escape прячет панель, если поверх неё не открыто своё меню или окно:
  // у них Escape свой, и одно нажатие не должно закрывать всё сразу.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector('[role="dialog"], .z-\\[70\\], .z-\\[80\\]')) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <div
      // Под нижним краем шапки во всю её ширину: панель — её продолжение.
      // Обрезка — только на время хода: в покое обрезать нечего.
      className={clsx(
        "absolute left-0 right-0 top-full pointer-events-none",
        (phase === "in" || phase === "out") && "overflow-hidden"
      )}
      hidden={phase === "hidden"}
      inert={!open || undefined}
    >
      <div
        className={clsx(
          "pointer-events-auto",
          phase === "in" && "animate-dock-in",
          phase === "out" && "animate-dock-out"
        )}
        onAnimationEnd={(e) => {
          if (e.target !== e.currentTarget) return;
          setPhase(open ? "shown" : "hidden");
        }}
      >
        <div ref={setDockEl} />
      </div>
    </div>
  );
}
