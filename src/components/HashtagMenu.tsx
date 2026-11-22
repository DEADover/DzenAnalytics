import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Hash } from "lucide-react";
import { popSurfaceProps } from "../hooks/usePresence";

const ITEM_H = 34; // px per row, for height estimation
const MAX_H = 240; // menu caps here and scrolls; nav keeps the active item in view

type MenuPos = {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
};

/**
 * Список хэштегов под полем — один на поле комментария и поля поиска.
 *
 * В портале с `position: fixed`: плавает поверх всего, не двигает форму и
 * открывается вверх, если снизу нет места. Какой пункт активен и что делать с
 * выбором — решает поле.
 */
export function HashtagMenu({
  anchorRef,
  items,
  index,
  onPick,
  onDismiss,
}: {
  /** Поле, под которым стоит список. */
  anchorRef: RefObject<HTMLElement | null>;
  items: readonly string[];
  index: number;
  onPick: (tag: string) => void;
  /** Страница прокрутилась или окно сменило размер: координаты устарели. */
  onDismiss: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<MenuPos | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const estH = Math.min(items.length * ITEM_H + 8, MAX_H);
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    // Вверх — только когда там больше места и список действительно влезает:
    // поле комментария стоит прямо над кнопками окна, и закрывать их незачем.
    const flipUp = above > below && above >= Math.min(estH, ITEM_H + 8);
    setPos(
      flipUp
        ? { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(estH, above) }
        : { left: r.left, width: r.width, top: r.bottom + 4, maxHeight: Math.min(estH, below) }
    );
  }, [anchorRef, items.length]);

  useEffect(() => {
    // Прокрутка внутри самого списка — не повод его закрывать.
    const onScroll = (e: Event) => {
      const t = e.target;
      if (menuRef.current && t instanceof Node && menuRef.current.contains(t)) return;
      onDismiss();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onDismiss);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onDismiss);
    };
  }, [onDismiss]);

  // Активный пункт — на виду. Листаем только список, не страницу.
  useEffect(() => {
    const menu = menuRef.current;
    const item = menu?.children[index] as HTMLElement | undefined;
    if (!menu || !item) return;
    const mt = menu.scrollTop;
    if (item.offsetTop < mt) menu.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > mt + menu.clientHeight) {
      menu.scrollTop = item.offsetTop + item.offsetHeight - menu.clientHeight;
    }
  }, [index, pos]);

  if (!pos || items.length === 0) return null;
  return createPortal(
    <div
      ref={menuRef}
      data-hashtag-menu
      // Только появление: подсказки меняются на каждой букве, и уходящий
      // список показывал бы уже не те варианты.
      {...popSurfaceProps(false, pos.bottom != null ? "up" : "down")}
      className="fixed z-[80] overflow-auto rounded-lg border border-border bg-panel shadow-xl"
      style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
    >
      {items.map((t, i) => (
        <button
          key={t}
          type="button"
          // mousedown, а не click: срабатывает раньше потери фокуса полем.
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(t);
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
  );
}
