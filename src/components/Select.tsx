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
  size = "md",
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
  /**
   * `sm` — плотный вариант для строк-настроек, где поле стоит в ряд с числом и
   * подписью: у обычного размера высота 40 px, и рядом с полем ввода на 32 px
   * они выглядят собранными из разных наборов.
   */
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    /** Не уже поля — иначе список выглядит оторванным от него. */
    minWidth: number;
    /** Но и не шире свободного места справа: за край экрана не лезем. */
    maxWidth: number;
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
      /** Не липнуть к самому краю окна — иначе список выглядит обрезанным. */
      const edge = 8;
      const below = window.innerHeight - r.bottom - gap - edge;
      const above = r.top - gap - edge;
      // Разворачиваем вверх, если снизу теснее: у поля в нижней части окна
      // список иначе уходит за край экрана.
      const dropUp = below < 160 && above > below;
      // Высота — РОВНО по свободному месту, без нижней планки. Планка в 120 px
      // и была причиной, по которой у поля у самого низа окна список вылезал
      // за край: свободных 60 px, а высота всё равно 120. Не поместившееся
      // прокручивается внутри списка — он и так `overflow-y-auto`.
      const maxHeight = Math.max(0, Math.min(320, dropUp ? above : below));
      // Верх и низ прижаты к окну с обеих сторон: даже если якорь съехал между
      // замером и отрисовкой, список останется внутри экрана.
      const top = dropUp
        ? Math.max(edge, r.top - gap - maxHeight)
        : Math.min(r.bottom + gap, window.innerHeight - edge - maxHeight);
      setPos({
        left: r.left,
        top: Math.max(edge, top),
        minWidth: r.width,
        // Список ШИРЕ поля, если так помещается подпись. Раньше ширина была
        // ровно по полю, и «Только новые» в семисантиметровом поле ломалось на
        // две строки — при том, что справа было пусто.
        maxWidth: Math.max(r.width, Math.min(360, window.innerWidth - r.left - edge)),
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
        // z-96: ВЫШЕ всплывающих окон (`Popover` — 80, `InfoPopover` — 91,
        // `SliceSwitcher` — 95) и ниже подсказок (100). Список на 70 оказывался
        // ПОД окном, из которого его же и открыли: видно было только тот кусок,
        // что торчал из-под края.
        portal ? "fixed z-[96]" : "absolute left-0 right-0 z-30 mt-2 min-w-max"
      )}
      style={
        portal && pos
          ? {
              left: pos.left,
              top: pos.top,
              minWidth: pos.minWidth,
              maxWidth: pos.maxWidth,
              maxHeight: pos.maxHeight,
            }
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
            // Перенос — только когда подпись не влезла даже в расширенный
            // список: ширина у него растёт по содержимому до `maxWidth`.
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
        className={clsx(
          "input flex items-center justify-between gap-2 w-full text-left",
          size === "sm" ? "h-8 !px-2 !py-1" : "h-10"
        )}
      >
        <span className={clsx("truncate", size === "sm" ? "text-xs" : "text-sm")}>
          {current}
        </span>
        <ChevronDown
          className={clsx(
            "text-muted shrink-0 transition-transform",
            size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (portal ? (pos ? createPortal(list, document.body) : null) : list)}
    </div>
  );
}
