import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import clsx from "clsx";
import { useFiltersDockStore } from "../store/useFiltersDockStore";

type Phase = "hidden" | "in" | "shown" | "out";

/**
 * Место под шапкой для панели общих фильтров (`useFiltersDockStore`).
 *
 * Лежит поверх страницы, прибитое к низу шапки, поэтому открывается с любого
 * места прокрутки и ничего не сдвигает: график, на который смотришь, остаётся
 * где был. Порталом в body — внутри шапки `fixed` считался бы от неё (у шапки
 * размытие фона).
 *
 * Появление и уход — ключевыми кадрами без заливки: в покое у панели нет
 * `transform`, иначе она стала бы системой отсчёта для `fixed`-меню внутри
 * фильтров. Закрытая панель остаётся смонтированной (`hidden`): у фильтров
 * есть работа и в спрятанном виде — они подгружают сведения о счетах, без
 * которых фильтрация неполная.
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

  return createPortal(
    <div
      // Без полей по бокам: панель — продолжение шапки, во всю её ширину.
      className="fixed inset-x-0 z-20 pointer-events-none"
      style={{ top: "var(--app-header-h)" }}
      hidden={phase === "hidden"}
      inert={!open || undefined}
    >
      <div
        ref={setDockEl}
        className={clsx(
          "pointer-events-auto",
          phase === "in" && "animate-dock-in",
          phase === "out" && "animate-dock-out"
        )}
        onAnimationEnd={(e) => {
          if (e.target !== e.currentTarget) return;
          setPhase(open ? "shown" : "hidden");
        }}
      />
    </div>,
    document.body
  );
}
