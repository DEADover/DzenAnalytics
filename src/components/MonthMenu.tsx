import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useEscapeLayer } from "../lib/escapeStack";
import { createPortal } from "react-dom";
import { popSurfaceProps, usePresence } from "../hooks/usePresence";
import { ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { MONTHS_SHORT } from "../lib/months";
import { quarterOf } from "../lib/period";

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
  onSelectQuarter,
  yearsOnly = false,
  exclude,
  align = "left",
}: {
  open: boolean;
  onClose: () => void;
  /** Кнопка, от которой рисуется панель. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Текущий месяц «YYYY-MM» — от него берётся открытый год и подсветка. */
  value: string;
  minYM: string;
  maxYM: string;
  /**
   * В режиме года панель сразу показывает список лет; в режиме квартала — год
   * со стрелками и четыре квартала, выбор отдаёт первый месяц квартала.
   */
  mode?: "month" | "quarter" | "year";
  onSelect: (ym: string) => void;
  onSelectYear?: (year: number) => void;
  /** Есть — в панели строка кварталов. */
  onSelectQuarter?: (ym: string) => void;
  /** Выбирают только год — панель показывает сетку лет. */
  yearsOnly?: boolean;
  /**
   * Значение, которое выбрать нельзя: «YYYY-MM» (или год при `yearsOnly`). В
   * «Сравнении» это второй период — сравнивать месяц с ним же незачем.
   */
  exclude?: string;
  /** Панель от левого края кнопки или по её центру. */
  align?: "left" | "center";
}) {
  // Открытая панель показывает год выбранного месяца. Синхронизировать это
  // эффектом не нужно: потребитель пересоздаёт панель на каждое открытие
  // (`key`), и начальное значение считается заново.
  const [viewYear, setViewYear] = useState(
    () => Number(value?.slice(0, 4)) || new Date().getFullYear()
  );
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const { mounted, closing, openKey } = usePresence(open);

  const year = Number(value?.slice(0, 4)) || new Date().getFullYear();
  const minY = Number(minYM?.slice(0, 4)) || 1970;
  const maxY = Number(maxYM?.slice(0, 4)) || 3000;
  const isYear = mode === "year";

  useEscapeLayer(open, onClose);

  const excludedYear = yearsOnly && exclude ? Number(exclude.slice(0, 4)) : null;
  const excludedYM = !yearsOnly && exclude ? exclude : null;
  const years: number[] = [];
  for (let y = maxY; y >= minY; y--) years.push(y);

  /** Поставить панель под кнопкой (или над ней, если снизу тесно). `false` —
   *  кнопка уехала за край окна, держать панель открытой незачем. */
  const place = (): boolean => {
    const el = anchorRef.current;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) return false;
    const estH = 240;
    const below = window.innerHeight - r.bottom - 8;
    const flipUp = below < estH && r.top - 8 > below;
    // Прижимаем к экрану: у контрола в правом углу панель уезжала бы за
    // границу окна.
    const PANEL = 256; // w-64
    const MARGIN = 8;
    const vw = window.innerWidth || PANEL + MARGIN * 2;
    const start = align === "center" ? r.left + r.width / 2 - PANEL / 2 : r.left;
    const left = Math.min(Math.max(start, MARGIN), Math.max(MARGIN, vw - PANEL - MARGIN));
    setPos(flipUp ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
    return true;
  };
  const placeRef = useRef(place);
  useLayoutEffect(() => {
    placeRef.current = place;
  });

  useLayoutEffect(() => {
    if (open) placeRef.current();
  }, [open]);

  // Прокрутка и смена размера окна не закрывают панель, а двигают её вслед
  // за кнопкой: внутри окна события или страницы, прокрученной на пару
  // пикселей, она иначе исчезала прямо из-под мыши (issue #118). Закрываем,
  // только когда сама кнопка ушла за край.
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const follow = (e: Event) => {
      const t = e.target;
      if (menuRef.current && t instanceof Node && menuRef.current.contains(t)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!placeRef.current()) onClose();
      });
    };
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [open, onClose]);

  if (!mounted || !pos) return null;

  return createPortal(
    <>
      {!closing && <div className="fixed inset-0 z-[70]" onClick={onClose} />}
      <div
        ref={menuRef}
        key={openKey}
        {...popSurfaceProps(closing, pos.bottom != null ? "up" : "down")}
        className="fixed z-[80] card p-3 w-64"
        style={{ left: pos.left, top: pos.top, bottom: pos.bottom }}
      >
        {yearsOnly ? (
          <div className="grid grid-cols-3 gap-1 max-h-64 overflow-y-auto">
            {years.map((y) => (
              <button
                type="button"
                key={y}
                disabled={y === excludedYear}
                title={y === excludedYear ? "Уже выбран для другого периода" : undefined}
                onClick={() => {
                  onSelectYear?.(y);
                  onClose();
                }}
                className={clsx(
                  "px-2 py-2 rounded-md text-sm tabular-nums transition-colors",
                  y === year ? "bg-accent text-accent-fg font-medium" : "text-text hover:bg-panel2",
                  y === excludedYear && "opacity-30 cursor-not-allowed hover:bg-transparent"
                )}
              >
                {y}
              </button>
            ))}
          </div>
        ) : (
        <>
        {/* Одна панель на все три режима: год в шапке, под ним кварталы,
            ниже месяцы. Выделено то, что выбрано сейчас, а нажатие на любое
            переключает режим. Прежде у года была своя сетка лет, и из «Года»
            в месяц через панель было не попасть — только из месяца в год. */}
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={() => setViewYear((y) => y - 1)}
            disabled={viewYear <= minY}
            className="btn-icon btn-icon-sm"
            title="Предыдущий год"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              onSelectYear?.(viewYear);
              onClose();
            }}
            disabled={!onSelectYear}
            className={clsx(
              "px-2 py-0.5 rounded-md text-sm font-semibold tabular-nums transition-colors disabled:hover:bg-transparent",
              isYear && viewYear === year ? "bg-accent text-accent-fg" : "hover:bg-panel2"
            )}
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

        {onSelectQuarter && (
          <div className="grid grid-cols-4 gap-1 mb-2 pb-2 border-b border-border">
            {[1, 2, 3, 4].map((q) => {
              const first = `${viewYear}-${String((q - 1) * 3 + 1).padStart(2, "0")}`;
              const last = `${viewYear}-${String(q * 3).padStart(2, "0")}`;
              // Квартал доступен, если в нём есть хоть один месяц с данными.
              const disabled = (!!minYM && last < minYM) || (!!maxYM && first > maxYM);
              const isSel = mode === "quarter" && quarterOf(value) === q && viewYear === year;
              return (
                <button
                  key={q}
                  disabled={disabled}
                  onClick={() => {
                    onSelectQuarter(first);
                    onClose();
                  }}
                  title={`${["I", "II", "III", "IV"][q - 1]} квартал ${viewYear}`}
                  className={clsx(
                    "px-1 py-1.5 rounded-md text-sm transition-colors",
                    isSel ? "bg-accent text-accent-fg font-medium" : "text-text hover:bg-panel2",
                    disabled && "opacity-30 cursor-not-allowed hover:bg-transparent"
                  )}
                >
                  {["I", "II", "III", "IV"][q - 1]} кв.
                </button>
              );
            })}
          </div>
        )}

        <div className="grid grid-cols-3 gap-1">
          {MONTHS_SHORT.map((m, i) => {
            const ym = `${viewYear}-${String(i + 1).padStart(2, "0")}`;
            const disabled = (!!minYM && ym < minYM) || (!!maxYM && ym > maxYM) || ym === excludedYM;
            const isSel = mode === "month" && ym === value;
            return (
              <button
                key={m}
                disabled={disabled}
                title={ym === excludedYM ? "Уже выбран для другого периода" : undefined}
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
