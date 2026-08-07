import {
  cloneElement,
  isValidElement,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface Props {
  /** Tooltip body. When falsy, the child renders with no tooltip at all. */
  content?: ReactNode;
  children: ReactElement;
  /** Preferred side; flips to stay on-screen. Default "top". */
  placement?: "top" | "bottom";
  /** Hover delay before showing, ms. Default 120. */
  delay?: number;
}

/**
 * App-themed tooltip that replaces the browser-native `title`. Wraps a single
 * element and renders a styled bubble in a portal on hover/focus — positioned
 * from the child's bounding box, so it adds NO wrapper box and never disturbs
 * the surrounding (often flex) layout. Pass a falsy `content` to disable it
 * conditionally without unwrapping (e.g. `content={editing ? null : text}`).
 *
 * Width is a plain `max-w-md` on purpose: a `min(20rem, 100vw - 1rem)` guard
 * computed to max-width 0 in the embedded browser (the bubble collapsed to one
 * character per line), and it isn't needed — the positioning below already
 * clamps the box inside the viewport. Ширина подобрана под подсказки в
 * несколько фраз: на 20rem объяснение в три абзаца вытягивалось в узкий
 * столбик высотой в пол-экрана.
 *
 * Positioning measures the bubble's REAL size after it mounts and shifts the
 * whole box to stay within the viewport — so near a screen edge it slides
 * sideways instead of squishing into a tall one-word-per-line column.
 */
export function Tooltip({ content, children, placement = "top", delay = 120 }: Props) {
  const [shown, setShown] = useState(false);
  // The anchor DOM node is kept in STATE (not a ref) — a callback ref into
  // setState avoids the `react-hooks/refs` rule that fires on ref-setters passed
  // through cloneElement, and re-running effects on remount is harmless here.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, ready: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  const open = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setPos((p) => ({ ...p, ready: false }));
      setShown(true);
    }, delay);
  }, [delay]);

  const close = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setShown(false);
  }, []);

  // Position once the bubble is in the DOM: measure both boxes, centre on the
  // anchor, then clamp so the whole bubble stays on-screen.
  useLayoutEffect(() => {
    if (!shown || !anchor || !bubble.current) return;
    const reposition = () => {
      if (!anchor || !bubble.current) return;
      const a = anchor.getBoundingClientRect();
      const b = bubble.current.getBoundingClientRect();
      const m = 8; // viewport margin
      const below = placement === "bottom" || a.top < b.height + 12;
      const left = Math.min(
        Math.max(a.left + a.width / 2 - b.width / 2, m),
        window.innerWidth - b.width - m
      );
      const top = below ? a.bottom + 6 : a.top - b.height - 6;
      setPos({ left, top, ready: true });
    };
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [shown, anchor, placement, content]);

  if (!content || !isValidElement(children)) return children;

  // Merge our handlers/ref onto the child without adding a layout wrapper.
  const childProps = children.props as Record<string, unknown>;
  const call = (name: string) => (e: unknown) => {
    (childProps[name] as ((ev: unknown) => void) | undefined)?.(e);
  };
  // Wrapped elements here don't carry their own ref, so the state setter doubles
  // as a callback ref. The rule below false-positives on `ref` in cloneElement —
  // the callback runs at commit, not during render.
  // eslint-disable-next-line react-hooks/refs
  const merged = cloneElement(children, {
    ref: setAnchor,
    "aria-describedby": shown ? id : undefined,
    onMouseEnter: (e: unknown) => {
      call("onMouseEnter")(e);
      open();
    },
    onMouseLeave: (e: unknown) => {
      call("onMouseLeave")(e);
      close();
    },
    onFocus: (e: unknown) => {
      call("onFocus")(e);
      open();
    },
    onBlur: (e: unknown) => {
      call("onBlur")(e);
      close();
    },
  } as Record<string, unknown>);

  return (
    <>
      {merged}
      {shown &&
        createPortal(
          <div
            ref={bubble}
            role="tooltip"
            id={id}
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              opacity: pos.ready ? 1 : 0,
            }}
            className="pointer-events-none z-[100] w-max max-w-md rounded-lg border border-border bg-panel2 px-3 py-2 text-xs leading-relaxed text-text shadow-lg whitespace-pre-line transition-opacity duration-100"
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
}
