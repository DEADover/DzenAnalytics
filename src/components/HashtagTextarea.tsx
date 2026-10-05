import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Hash } from "lucide-react";
import { prefixMatcher } from "../lib/keyboardLayout";

/**
 * A <textarea> with inline hashtag autocomplete. Typing «#» opens a menu of
 * the supplied `tags`, filtered live by the text after «#». Pick with click,
 * Enter/Tab, or ↑/↓ + Enter; Esc closes it.
 *
 * The menu renders in a portal with `position: fixed`, so it floats above
 * everything (high z-index), never reflows the surrounding form, and flips
 * above the field when there isn't room below.
 */
interface Props {
  value: string;
  onChange: (next: string) => void;
  tags: string[];
  className?: string;
  rows?: number;
  placeholder?: string;
}

const ITEM_H = 34; // px per row, for height estimation
const MAX_H = 240; // menu caps here and scrolls; nav keeps the active item in view
const MAX_ITEMS = 50;

export function HashtagTextarea({
  value,
  onChange,
  tags,
  className,
  rows = 1,
  placeholder,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [start, setStart] = useState(0);
  const [index, setIndex] = useState(0);

  const suggestions = useMemo(() => {
    if (!open) return [];
    // Набрали в другой раскладке — тоже находим: «#Jngecr» предлагает
    // «#Отпуск». Прямые совпадения — первыми.
    const m = prefixMatcher(query);
    return tags
      .map((t) => ({ t, r: m.rank(t) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r)
      .map((x) => x.t)
      .slice(0, MAX_ITEMS);
  }, [open, query, tags]);

  // ── Position (portal, fixed). Flip above when there's no room below. ──
  type MenuPos = {
    left: number;
    width: number;
    top?: number;
    bottom?: number;
    maxHeight: number;
  };
  const [pos, setPos] = useState<MenuPos | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    let next: MenuPos | null = null;
    if (open && suggestions.length > 0 && el) {
      const r = el.getBoundingClientRect();
      const estH = Math.min(suggestions.length * ITEM_H + 8, MAX_H);
      const below = window.innerHeight - r.bottom - 8;
      const above = r.top - 8;
      // Open toward the side with more room. For a field low on the screen
      // (the comment box sits just above the footer buttons) that's upward,
      // so the menu floats over the fields above instead of covering the
      // actions below. Only flip up when the menu actually fits there.
      const flipUp = above > below && above >= Math.min(estH, ITEM_H + 8);
      next = flipUp
        ? {
            left: r.left,
            width: r.width,
            bottom: window.innerHeight - r.top + 4,
            maxHeight: Math.min(estH, above),
          }
        : {
            left: r.left,
            width: r.width,
            top: r.bottom + 4,
            maxHeight: Math.min(estH, below),
          };
    }
    setPos(next);
  }, [open, suggestions.length]);

  // A moved/resized viewport invalidates the fixed coords — just close.
  useEffect(() => {
    if (!open) return;
    // Close when the page/containers scroll (fixed coords go stale) — but NOT
    // when the scroll happens inside the menu itself (the user is browsing it).
    const onScroll = (e: Event) => {
      const t = e.target;
      if (menuRef.current && t instanceof Node && menuRef.current.contains(t)) {
        return;
      }
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  // Keep the highlighted item visible when navigating a long list with the
  // keyboard. Scroll only the menu (not the page), so it can't trigger the
  // page-scroll close above.
  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const item = menu?.children[index] as HTMLElement | undefined;
    if (!menu || !item) return;
    const mt = menu.scrollTop;
    if (item.offsetTop < mt) menu.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > mt + menu.clientHeight) {
      menu.scrollTop = item.offsetTop + item.offsetHeight - menu.clientHeight;
    }
  }, [index, open]);

  /** Recompute the active «#fragment» under the caret and open/close the menu. */
  function sync(next: string, caret: number) {
    const upto = next.slice(0, caret);
    const hashIdx = upto.lastIndexOf("#");
    const between = hashIdx === -1 ? "" : upto.slice(hashIdx + 1);
    // Open only while the text right after «#» is a valid tag fragment
    // (letters/digits/_/-, no spaces) — same charset as the hashtag regex.
    // Плюс клавиши, на которых в другой раскладке стоят буквы «х ъ ж э б ю ё»
    // («[j,,b» — это «хобби»): подсказка решит, подходит ли такое начало.
    if (hashIdx !== -1 && /^[\p{L}\p{N}_\-[\];',.`]*$/u.test(between)) {
      setStart(hashIdx);
      if (between !== query) setIndex(0); // keep highlight stable on arrow nav
      setQuery(between);
      setOpen(true);
    } else {
      setOpen(false);
    }
  }

  /** Replace the active «#fragment» with the chosen tag, re-place the caret. */
  function pick(tag: string) {
    const before = value.slice(0, start);
    const after = value.slice(start + 1 + query.length);
    const insert = `#${tag}`;
    const sep = after.startsWith(" ") ? "" : " ";
    onChange(before + insert + sep + after);
    setOpen(false);
    const caret = (before + insert + sep).length;
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        el.focus();
        el.setSelectionRange(caret, caret);
      }
    });
  }

  return (
    <>
      <textarea
        ref={ref}
        value={value}
        rows={rows}
        placeholder={placeholder}
        className={className}
        onChange={(e) => {
          onChange(e.target.value);
          sync(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onClick={(e) =>
          sync(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)
        }
        onKeyUp={(e) =>
          sync(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)
        }
        onKeyDown={(e) => {
          if (!open || suggestions.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setIndex((i) => (i + 1) % suggestions.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            pick(suggestions[index]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
          }
        }}
        onBlur={() => setOpen(false)}
      />
      {open &&
        pos &&
        suggestions.length > 0 &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[80] overflow-auto rounded-lg border border-border bg-panel shadow-xl"
            style={{
              left: pos.left,
              width: pos.width,
              top: pos.top,
              bottom: pos.bottom,
              maxHeight: pos.maxHeight,
            }}
          >
            {suggestions.map((t, i) => (
              <button
                key={t}
                type="button"
                // mousedown (not click) fires before the textarea blur, so the
                // menu is still open when we insert the tag.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(t);
                }}
                className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-1.5 ${
                  i === index ? "bg-accent/10 text-accent" : "hover:bg-panel2"
                }`}
              >
                <Hash className="w-3 h-3 text-accent shrink-0" />
                {t}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
