import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

/**
 * Метка всплывающей поверхности.
 *
 * Всплывающие списки живут в портале на `body`, то есть в дереве они не внутри
 * окна, которое их открыло, — и отличить «прокрутили список внутри окна» от
 * «прокрутили страницу под окном» по `contains` нельзя. Метка это и решает:
 * любая поверхность, помеченная ею, считается своей.
 */
export const SURFACE_ATTR = "data-popover-surface";

interface Props {
  open: boolean;
  /** Trigger element to position against. Put it on the trigger's WRAPPER, not
   *  inside a <Tooltip> (Tooltip clones the child and overrides its ref). */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Which horizontal edge aligns with the anchor. Default "left". */
  align?: "left" | "right";
  /** Force the popover width to equal the anchor's width (dropdowns/selects). */
  matchWidth?: boolean;
  /** Styling for the popover surface (e.g. "card p-1"). */
  className?: string;
  children: ReactNode;
}

/**
 * Anchored popover / menu rendered in a portal on <body> with FIXED
 * positioning — so it's never clipped by a card, an `overflow-hidden` wrapper,
 * or the viewport edge. It flips ABOVE the trigger when there isn't room below,
 * clamps horizontally into the viewport, closes on outside-click / scroll /
 * resize, and measures its own size first (rendered hidden) so the flip
 * decision uses the real height.
 */
export function Popover({
  open,
  anchorRef,
  onClose,
  align = "left",
  matchWidth,
  className,
  children,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width?: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    const a = anchor.getBoundingClientRect();
    const width = matchWidth ? a.width : menu.offsetWidth;
    const height = menu.offsetHeight;
    const openUp = window.innerHeight - a.bottom < height + 12;
    const left = align === "right" ? a.right - width : a.left;
    setPos({
      left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
      top: openUp ? Math.max(8, a.top - height - 4) : a.bottom + 4,
      width: matchWidth ? width : undefined,
    });
    // Content is static while open; recompute only on open/align/width changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, align, matchWidth]);

  useEffect(() => {
    if (!open) return;
    const close = (e?: Event) => {
      // Окно приклеено к якорю на момент открытия: уехал якорь — уехало и оно,
      // поэтому прокрутка страницы его закрывает. Но прокрутка ВНУТРИ него
      // самого или внутри списка, который оно открыло, якоря не двигает.
      // Обработчик висит в фазе перехвата и ловит любую прокрутку в документе,
      // из-за чего листание списка счетов в настройках бюджета захлопывало сами
      // настройки.
      const target = e?.target;
      if (target instanceof Element && target.closest(`[${SURFACE_ATTR}]`)) return;
      onClose();
    };
    // Изменился размер окна — якорь наверняка переехал, тут закрываем без
    // разбора, кто источник.
    const onResize = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <>
      <div className="fixed inset-0 z-[70]" onClick={onClose} />
      <div
        ref={menuRef}
        {...{ [SURFACE_ATTR]: "" }}
        className={clsx("fixed z-[80]", className)}
        style={
          pos
            ? { left: pos.left, top: pos.top, width: pos.width }
            : { left: -9999, top: 0, visibility: "hidden" }
        }
      >
        {children}
      </div>
    </>,
    document.body
  );
}
