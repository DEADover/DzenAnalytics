import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import clsx from "clsx";

/**
 * Пикер в стиле остальных полей сервиса: строка `.input` с текущим значением и
 * раскрывающийся список. Один компонент на вид счёта, срок и начисление
 * процентов — иначе три соседних поля выглядели бы тремя разными элементами.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  className,
  portal = false,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
  /**
   * Рисовать список в портале, позиционируя его по месту поля.
   *
   * Нужно внутри прокручиваемых областей — например в теле модального окна:
   * обычный абсолютный список обрезается контейнером с `overflow`, и до нижних
   * вариантов приходится прокручивать само окно.
   */
  portal?: boolean;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const current = options.find((o) => o.value === value)?.label ?? "";

  // Клик мимо закрывает список. В режиме портала список лежит вне контейнера,
  // поэтому проверяем и его — иначе выбор варианта закрывал бы список раньше,
  // чем срабатывал сам выбор.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (boxRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !portal) {
      setPos(null);
      return;
    }
    const place = () => {
      const r = boxRef.current?.getBoundingClientRect();
      if (!r) return;
      const gap = 8;
      const below = window.innerHeight - r.bottom - gap - 8;
      const above = r.top - gap - 8;
      // Разворачиваем вверх, если снизу теснее: у поля в нижней части окна
      // список иначе уходит за край экрана.
      const dropUp = below < 160 && above > below;
      const maxHeight = Math.max(120, Math.min(320, dropUp ? above : below));
      setPos({
        left: r.left,
        top: dropUp ? r.top - gap - maxHeight : r.bottom + gap,
        width: r.width,
        maxHeight,
      });
    };
    place();
    // `true` — ловим прокрутку любого предка, а не только окна: поле как раз и
    // живёт внутри прокручиваемой области.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, portal]);

  const list = (
    <div
      ref={popupRef}
      role="listbox"
      className={clsx(
        "border border-border rounded-lg bg-panel p-1 shadow-xl overflow-y-auto",
        portal ? "fixed z-[70]" : "absolute left-0 right-0 z-30 mt-2 min-w-max"
      )}
      style={
        portal && pos
          ? { left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight }
          : undefined
      }
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="option"
          aria-selected={o.value === value}
          onClick={() => {
            onChange(o.value);
            setOpen(false);
          }}
          className={clsx(
            "w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm text-left",
            // В портале ширина списка равна ширине поля, поэтому длинную
            // подпись переносим, а не расталкиваем ею соседей.
            portal ? "whitespace-normal" : "whitespace-nowrap",
            o.value === value ? "bg-accent/10 text-accent" : "text-text hover:bg-panel2"
          )}
        >
          <span>{o.label}</span>
          {o.value === value && <Check className="w-3.5 h-3.5 shrink-0" />}
        </button>
      ))}
    </div>
  );

  return (
    <div ref={boxRef} className={clsx("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="input h-10 flex items-center justify-between gap-2 w-full text-left"
      >
        <span className="truncate text-sm">{current}</span>
        <ChevronDown
          className={clsx(
            "w-4 h-4 text-muted shrink-0 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (portal ? (pos ? createPortal(list, document.body) : null) : list)}
    </div>
  );
}
