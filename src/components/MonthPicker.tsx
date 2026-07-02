import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, ChevronDown, CalendarRange } from "lucide-react";
import clsx from "clsx";
import { monthLabel } from "../lib/format";

const MONTHS = [
  "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
  "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
];

/**
 * Month filter control: ‹ prev › step arrows around a label button that opens
 * a month + year picker (year nav + a 3×4 month grid). Months outside the
 * available data range [minYM, maxYM] are disabled. Used by GlobalFilters, so
 * it covers every page with the month filter.
 */
export function MonthPicker({
  value,
  minYM,
  maxYM,
  active,
  onSelect,
  onStep,
}: {
  /** Currently shown month, "YYYY-MM". */
  value: string;
  minYM: string;
  maxYM: string;
  /** Whether the month filter is the active date mode. */
  active: boolean;
  onSelect: (ym: string) => void;
  onStep: (dir: -1 | 1) => void;
}) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(
    () => Number(value?.slice(0, 4)) || new Date().getFullYear()
  );
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  const canPrev = !!minYM && value > minYM;
  const canNext = !!maxYM && value < maxYM;
  const minY = Number(minYM?.slice(0, 4)) || 1970;
  const maxY = Number(maxYM?.slice(0, 4)) || 3000;

  // Sync the visible year to the selected month whenever the picker opens.
  useEffect(() => {
    if (open) setViewYear(Number(value?.slice(0, 4)) || new Date().getFullYear());
  }, [open, value]);

  useLayoutEffect(() => {
    const el = btnRef.current;
    if (!open || !el) {
      setPos(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const estH = 240;
    const below = window.innerHeight - r.bottom - 8;
    const flipUp = below < estH && r.top - 8 > below;
    setPos(
      flipUp
        ? { left: r.left, bottom: window.innerHeight - r.top + 4 }
        : { left: r.left, top: r.bottom + 4 }
    );
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      const t = e.target;
      if (menuRef.current && t instanceof Node && menuRef.current.contains(t)) return;
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

  return (
    <div
      className={clsx(
        "flex items-center bg-panel2 rounded-lg p-0.5 border",
        active ? "border-accent" : "border-border"
      )}
      title="Перейти к одному месяцу"
    >
      <button
        onClick={() => onStep(-1)}
        disabled={!canPrev}
        className="p-1 rounded hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed"
        title="Предыдущий месяц"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={clsx(
          "px-2 py-1 text-xs rounded-md flex items-center gap-1.5 transition-colors min-w-[118px] justify-center",
          active ? "bg-accent text-accent-fg font-medium" : "text-muted hover:text-text"
        )}
      >
        <CalendarRange className="w-3 h-3" />
        {value ? monthLabel(value) : "Месяц"}
        <ChevronDown className={clsx("w-3 h-3 transition-transform", open && "rotate-180")} />
      </button>

      <button
        onClick={() => onStep(1)}
        disabled={!canNext}
        className="p-1 rounded hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed"
        title="Следующий месяц"
      >
        <ChevronRight className="w-4 h-4" />
      </button>

      {open &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} />
            <div
              ref={menuRef}
              className="fixed z-[80] card p-3 w-64"
              style={{ left: pos.left, top: pos.top, bottom: pos.bottom }}
            >
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={() => setViewYear((y) => y - 1)}
                  disabled={viewYear <= minY}
                  className="p-1 rounded hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Предыдущий год"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm font-semibold tabular-nums">{viewYear}</span>
                <button
                  onClick={() => setViewYear((y) => y + 1)}
                  disabled={viewYear >= maxY}
                  className="p-1 rounded hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Следующий год"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1">
                {MONTHS.map((m, i) => {
                  const ym = `${viewYear}-${String(i + 1).padStart(2, "0")}`;
                  const disabled = (!!minYM && ym < minYM) || (!!maxYM && ym > maxYM);
                  const isSel = ym === value;
                  return (
                    <button
                      key={m}
                      disabled={disabled}
                      onClick={() => {
                        onSelect(ym);
                        setOpen(false);
                      }}
                      className={clsx(
                        "px-2 py-2 rounded-md text-sm transition-colors",
                        isSel
                          ? "bg-accent text-accent-fg font-medium"
                          : "text-text hover:bg-panel2",
                        disabled && "opacity-30 cursor-not-allowed hover:bg-transparent"
                      )}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
