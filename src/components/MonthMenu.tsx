import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { MONTHS_SHORT } from "../lib/months";

/**
 * Всплывающий выбор месяца (и года) — общий для дорожки месяца и для единого
 * контрола периода.
 *
 * Раньше он жил внутри `MonthPicker`, и второму потребителю пришлось бы его
 * копировать со всей арифметикой позиционирования: панель шириной 16rem
 * прижимается к краю экрана и переворачивается вверх, когда снизу не хватает
 * места.
 */
export function MonthMenu({
  open,
  onClose,
  anchorRef,
  value,
  minYM,
  maxYM,
  mode = "month",
  onSelect,
  onSelectYear,
}: {
  open: boolean;
  onClose: () => void;
  /** Кнопка, от которой рисуется панель. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Текущий месяц «YYYY-MM» — от него берётся открытый год и подсветка. */
  value: string;
  minYM: string;
  maxYM: string;
  /** В режиме года панель сразу показывает список лет. */
  mode?: "month" | "year";
  onSelect: (ym: string) => void;
  onSelectYear?: (year: number) => void;
}) {
  // Открытая панель показывает год выбранного месяца. Синхронизировать это
  // эффектом не нужно: потребитель пересоздаёт панель на каждое открытие
  // (`key`), и начальное значение считается заново.
  const [viewYear, setViewYear] = useState(
    () => Number(value?.slice(0, 4)) || new Date().getFullYear()
  );
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  const year = Number(value?.slice(0, 4)) || new Date().getFullYear();
  const minY = Number(minYM?.slice(0, 4)) || 1970;
  const maxY = Number(maxYM?.slice(0, 4)) || 3000;
  const isYear = mode === "year";
  const years: number[] = [];
  for (let y = maxY; y >= minY; y--) years.push(y);

  useLayoutEffect(() => {
    const el = anchorRef.current;
    if (!open || !el) return;
    const r = el.getBoundingClientRect();
    const estH = 240;
    const below = window.innerHeight - r.bottom - 8;
    const flipUp = below < estH && r.top - 8 > below;
    // Прижимаем к экрану: панель рисуется от ЛЕВОГО края кнопки, и у контрола
    // в правом углу она уезжала за границу окна.
    const PANEL = 256; // w-64
    const MARGIN = 8;
    const vw = window.innerWidth || PANEL + MARGIN * 2;
    const left = Math.min(Math.max(r.left, MARGIN), Math.max(MARGIN, vw - PANEL - MARGIN));
    setPos(flipUp ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      const t = e.target;
      if (menuRef.current && t instanceof Node && menuRef.current.contains(t)) return;
      onClose();
    };
    const onResize = () => onClose();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, onClose]);

  if (!open || !pos) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[70]" onClick={onClose} />
      <div
        ref={menuRef}
        className="fixed z-[80] card p-3 w-64"
        style={{ left: pos.left, top: pos.top, bottom: pos.bottom }}
      >
        {isYear ? (
          <div className="grid grid-cols-3 gap-1 max-h-64 overflow-y-auto">
            {years.map((y) => (
              <button
                key={y}
                onClick={() => {
                  onSelectYear?.(y);
                  onClose();
                }}
                className={clsx(
                  "px-2 py-2 rounded-md text-sm tabular-nums transition-colors",
                  y === year ? "bg-accent text-accent-fg font-medium" : "text-text hover:bg-panel2"
                )}
              >
                {y}
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => setViewYear((y) => y - 1)}
                disabled={viewYear <= minY}
                className="btn-icon btn-icon-sm"
                title="Предыдущий год"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {/* Год в шапке — кнопка: из списка месяцев часто нужен «весь этот
                  год», а дорога к нему шла через отдельный пресет. */}
              <button
                onClick={() => {
                  onSelectYear?.(viewYear);
                  onClose();
                }}
                disabled={!onSelectYear}
                className="px-2 py-0.5 rounded-md text-sm font-semibold tabular-nums transition-colors hover:bg-panel2 disabled:hover:bg-transparent"
                title={onSelectYear ? `Показать весь ${viewYear} год` : undefined}
              >
                {viewYear}
              </button>
              <button
                onClick={() => setViewYear((y) => y + 1)}
                disabled={viewYear >= maxY}
                className="btn-icon btn-icon-sm"
                title="Следующий год"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1">
              {MONTHS_SHORT.map((m, i) => {
                const ym = `${viewYear}-${String(i + 1).padStart(2, "0")}`;
                const disabled = (!!minYM && ym < minYM) || (!!maxYM && ym > maxYM);
                const isSel = ym === value;
                return (
                  <button
                    key={m}
                    disabled={disabled}
                    onClick={() => {
                      onSelect(ym);
                      onClose();
                    }}
                    className={clsx(
                      "px-2 py-2 rounded-md text-sm transition-colors",
                      isSel ? "bg-accent text-accent-fg font-medium" : "text-text hover:bg-panel2",
                      disabled && "opacity-30 cursor-not-allowed hover:bg-transparent"
                    )}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>,
    document.body
  );
}
