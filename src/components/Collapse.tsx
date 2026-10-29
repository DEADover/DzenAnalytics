import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { usePresence } from "../hooks/usePresence";

/** Сколько длится раскрытие — `--motion-slow` в index.css. */
const COLLAPSE_MS = 300;

/**
 * Раскрывающийся блок — одним движением на весь сервис: высота растёт по
 * строке сетки `0fr → 1fr` (настоящая высота содержимого, без `max-height`
 * наугад), содержимое проявляется вместе с ней. Сворачивается так же,
 * обратно, и только потом снимается с дерева.
 *
 * Обрезка по краю (`overflow: hidden`) нужна, только пока высота меняется:
 * в раскрытом блоке она резала бы кольца фокуса и тени у краёв.
 *
 * `keepMounted` — не снимать содержимое со свёрнутого блока (оно хранит своё
 * состояние); свёрнутое тогда `inert`, чтобы Tab по нему не ходил.
 */
export function Collapse({
  open,
  keepMounted = false,
  className,
  children,
}: {
  open: boolean;
  keepMounted?: boolean;
  /** Классы обёртки содержимого — отступы и т. п. Отступ сверху ставят ЗДЕСЬ,
   *  а не снаружи: снаружи он оставался бы и у свёрнутого блока. */
  className?: string;
  children: ReactNode;
}) {
  const { mounted } = usePresence(open, COLLAPSE_MS);
  const boxRef = useRef<HTMLDivElement>(null);
  // Что показывает сетка. Открытие: блок сначала встаёт свёрнутым и лишь
  // затем раскрывается — иначе переходу не от чего стартовать.
  const [shown, setShown] = useState(open);
  // Высота в пути — обрезаем края.
  const [moving, setMoving] = useState(false);

  useLayoutEffect(() => {
    if (open === shown) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Снять стиль свёрнутого состояния до смены — тогда переход сработает.
    // Смена — в эффекте намеренно: блок должен сперва встать в дерево
    // свёрнутым, иначе переходу не от чего стартовать.
    void boxRef.current?.offsetHeight;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShown(open);
    setMoving(!reduce);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!mounted && !keepMounted) return null;
  return (
    <div
      ref={boxRef}
      data-open={shown ? "" : undefined}
      className="collapse-box"
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === "grid-template-rows") setMoving(false);
      }}
    >
      <div
        inert={!open || undefined}
        className={clsx("min-h-0", (moving || !shown) && "overflow-hidden")}
      >
        <div className={className}>{children}</div>
      </div>
    </div>
  );
}
