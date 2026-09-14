import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, ChevronDown, CalendarRange } from "lucide-react";
import clsx from "clsx";
import { MONTHS_SHORT } from "../lib/months";
import { monthLabel } from "../lib/format";


/**
 * Month filter control: ‹ prev › step arrows around a label button that opens
 * a month + year picker (year nav + a 3×4 month grid). Months outside the
 * available data range [minYM, maxYM] are disabled. Used by GlobalFilters, so
 * it covers every page with the month filter.
 *
 * В режиме `year` тот же контрол листает ГОДЫ: подпись — «2026», стрелки
 * шагают на год, в списке годы вместо месяцев. Отдельного контрола не делаем
 * намеренно — место в панели одно, и переключение единицы не должно менять
 * расположение кнопок под рукой (issue #64).
 */
export function MonthPicker({
  value,
  minYM,
  maxYM,
  active,
  mode = "month",
  size = "sm",
  onSelect,
  onSelectYear,
  onStep,
}: {
  /** Currently shown month, "YYYY-MM". В режиме года берётся только год. */
  value: string;
  minYM: string;
  maxYM: string;
  /** Whether the month filter is the active date mode. */
  active: boolean;
  /** Что выбираем — месяц или год. */
  mode?: "month" | "year";
  /**
   * Ступень: `sm` 34 — ряд общего фильтра и шапки карточек, `md` 42 — ряд
   * контролов раздела, где рядом дорожки крупной ступени.
   */
  size?: "sm" | "md";
  onSelect: (ym: string) => void;
  onSelectYear?: (year: number) => void;
  onStep: (dir: -1 | 1) => void;
}) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(
    () => Number(value?.slice(0, 4)) || new Date().getFullYear()
  );
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  const year = Number(value?.slice(0, 4)) || new Date().getFullYear();
  const minY = Number(minYM?.slice(0, 4)) || 1970;
  const maxY = Number(maxYM?.slice(0, 4)) || 3000;
  const isYear = mode === "year";
  const canPrev = isYear ? year > minY : !!minYM && value > minYM;
  const canNext = isYear ? year < maxY : !!maxYM && value < maxYM;
  const years: number[] = [];
  for (let y = maxY; y >= minY; y--) years.push(y);

  useLayoutEffect(() => {
    const el = btnRef.current;
    // Сбрасывать `pos` не нужно: список живёт только при `open`, а при
    // следующем открытии `useLayoutEffect` пересчитает координаты ДО того,
    // как браузер нарисует кадр, — старое значение показать некому. Лишний
    // сброс стоил перерисовки на каждом закрытии.
    if (!open || !el) return;
    const r = el.getBoundingClientRect();
    const estH = 240;
    const below = window.innerHeight - r.bottom - 8;
    const flipUp = below < estH && r.top - 8 > below;
    // Прижимаем к экрану: панель шириной 16rem рисуется от ЛЕВОГО края кнопки,
    // и у пикера, стоящего в правом углу шапки, она уезжала за границу окна —
    // половина годов оказывалась за кадром.
    const PANEL = 256; // w-64
    const MARGIN = 8;
    const vw = window.innerWidth || PANEL + MARGIN * 2;
    const left = Math.min(Math.max(r.left, MARGIN), Math.max(MARGIN, vw - PANEL - MARGIN));
    setPos(
      flipUp
        ? { left, bottom: window.innerHeight - r.top + 4 }
        : { left, top: r.bottom + 4 }
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
      // Дорожка и пункты — общие `.seg-*`: та же пилюля, что у `Segmented`
      // той же ступени, и выбранная подпись светится так же.
      className={clsx("seg-track", active && "!border-accent")}
      title={isYear ? "Перейти к одному году" : "Перейти к одному месяцу"}
    >
      <button
        onClick={() => onStep(-1)}
        disabled={!canPrev}
        className={clsx("seg-icon", size === "md" ? "seg-icon-md" : "seg-icon-sm")}
        title={isYear ? "Предыдущий год" : "Предыдущий месяц"}
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      <button
        ref={btnRef}
        onClick={() => {
          // Открываем — показываем год выбранного месяца. Это следствие
          // нажатия, а не состояния: эффектом оно правилось уже ПОСЛЕ
          // отрисовки, лишним проходом, и год успевал мигнуть прошлым.
          if (!open) setViewYear(Number(value?.slice(0, 4)) || new Date().getFullYear());
          setOpen((o) => !o);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={clsx(
          "seg-item",
          size === "md" ? "seg-item-md min-w-[132px]" : "seg-item-sm min-w-[118px]",
          active && "seg-on"
        )}
      >
        <CalendarRange className={size === "md" ? "w-4 h-4" : "w-3.5 h-3.5"} />
        {isYear ? year : value ? monthLabel(value) : "Месяц"}
        <ChevronDown
          className={clsx(size === "md" ? "w-4 h-4" : "w-3.5 h-3.5", "transition-transform", open && "rotate-180")}
        />
      </button>

      <button
        onClick={() => onStep(1)}
        disabled={!canNext}
        className={clsx("seg-icon", size === "md" ? "seg-icon-md" : "seg-icon-sm")}
        title={isYear ? "Следующий год" : "Следующий месяц"}
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
              {isYear ? (
                <div className="grid grid-cols-3 gap-1 max-h-64 overflow-y-auto">
                  {years.map((y) => (
                    <button
                      key={y}
                      onClick={() => {
                        onSelectYear?.(y);
                        setOpen(false);
                      }}
                      className={clsx(
                        "px-2 py-2 rounded-md text-sm tabular-nums transition-colors",
                        y === year
                          ? "bg-accent text-accent-fg font-medium"
                          : "text-text hover:bg-panel2"
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
                  className="p-1 rounded-full hover:text-accent hover:bg-panel/70 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Предыдущий год"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm font-semibold tabular-nums">{viewYear}</span>
                <button
                  onClick={() => setViewYear((y) => y + 1)}
                  disabled={viewYear >= maxY}
                  className="p-1 rounded-full hover:text-accent hover:bg-panel/70 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
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
              </>
              )}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}

/**
 * Выбор года — `MonthPicker` в режиме года с границами по годам.
 *
 * Один на все разделы («Календарь», «Итоги года», «Сравнение», «Год к году» в
 * Cash-flow): прежде каждый собирал его заново из семи пропсов, а «Год к году»
 * и вовсе держал свою перелистывалку — без подписи-кнопки и другой высоты.
 */
export function YearPicker({
  year,
  minYear,
  maxYear,
  onChange,
  size = "sm",
}: {
  year: number;
  minYear: number;
  maxYear: number;
  onChange: (year: number) => void;
  /** `md` 42 — год раздела в ряду контролов; `sm` 34 — в шапке карточки. */
  size?: "sm" | "md";
}) {
  return (
    <MonthPicker
      size={size}
      value={`${year}-01`}
      minYM={`${minYear}-01`}
      maxYM={`${maxYear}-12`}
      active
      mode="year"
      onSelect={(ym) => onChange(Number(ym.slice(0, 4)))}
      onSelectYear={onChange}
      onStep={(dir) => onChange(Math.min(maxYear, Math.max(minYear, year + dir)))}
    />
  );
}
