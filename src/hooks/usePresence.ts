import { useEffect, useState } from "react";

/** Сколько длится уход всплывающей поверхности — `--motion-fast` в index.css. */
export const EXIT_MS = 150;

function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Держит закрытую поверхность в дереве, пока доигрывает её уход.
 *
 * `mounted` — рисовать ли её вообще (открыта или уходит), `closing` — идёт
 * уход: поверхность уже не отвечает на клики и не видна вспомогательным
 * технологиям. Признак ухода выставляется в том же проходе отрисовки, где
 * пришло `open = false`, а не эффектом: иначе поверхность на один проход
 * снималась бы с дерева и монтировалась заново — с начала анимации появления.
 *
 * При «уменьшить движение» ухода нет — закрытие мгновенное.
 */
export function usePresence(open: boolean, exitMs = EXIT_MS) {
  const [prevOpen, setPrevOpen] = useState(open);
  const [closing, setClosing] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    setClosing(!open && exitMs > 0 && !reducedMotion());
  }
  useEffect(() => {
    if (!closing) return;
    const t = window.setTimeout(() => setClosing(false), exitMs);
    return () => window.clearTimeout(t);
  }, [closing, exitMs]);
  return { mounted: open || closing, closing: closing && !open };
}

/** С какого края растёт поверхность: от кнопки вниз, вверх, от правого края. */
export type PopOrigin = "down" | "up" | "right" | "up-right";

/**
 * Разметка всплывающей поверхности для общего движения `[data-pop]`
 * (index.css): появление, уход и край, от которого она растёт. Уходящая
 * поверхность — `inert` и `aria-hidden`, чтобы клик, фокус и поиск по ролям
 * её уже не находили, пока она гаснет.
 */
export function popSurfaceProps(closing: boolean, origin: PopOrigin = "down") {
  return {
    "data-pop": origin,
    "data-closing": closing ? "" : undefined,
    "aria-hidden": closing ? true : undefined,
    inert: closing ? true : undefined,
  } as const;
}
