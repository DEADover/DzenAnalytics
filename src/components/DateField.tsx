import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * A fully Russian date field. The native <input type="date"> and its
 * calendar popup are rendered by the *browser* from its UI locale, not the
 * page, so neither the "dd.mm.yyyy" placeholder nor the English month/day
 * calendar can be localised. So we don't use the native control at all:
 * the field is a button showing "дд.мм.гггг" / "01.05.2026", and clicking
 * it opens our own Russian calendar popup.
 *
 * Drop-in for the old date input: `value` is an ISO "YYYY-MM-DD" string and
 * `onChange` still gets `{ target: { value } }`, so existing call sites
 * (`onChange={(e) => …e.target.value}`) work unchanged.
 */

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const MONTHS_SHORT = [
  "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
  "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
];

const pad = (n: number) => String(n).padStart(2, "0");
const toISO = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

function parseISO(iso: string): { y: number; m: number; d: number } | null {
  const x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return x ? { y: +x[1], m: +x[2] - 1, d: +x[3] } : null;
}

function parseYM(s: string): { y: number; m: number } | null {
  const x = /^(\d{4})-(\d{2})$/.exec(s);
  return x ? { y: +x[1], m: +x[2] - 1 } : null;
}

function toDisplay(iso: string): string {
  const p = parseISO(iso);
  return p ? `${pad(p.d)}.${pad(p.m + 1)}.${p.y}` : "";
}

/**
 * «Авг. 2026» — месяц сокращённо, чтобы кнопка не меняла ширину от «Мая» до
 * «Сентября» и была уже.
 *
 * У мая точки нет: «Май» — это всё слово целиком, а не сокращение, и точка
 * после него была бы ошибкой. Остальные одиннадцать — сокращения, и точка им
 * положена.
 */
function toDisplayMonth(ym: string): string {
  const p = parseYM(ym);
  if (!p) return "";
  const short = MONTHS_SHORT[p.m];
  const dot = short === MONTHS[p.m] ? "" : ".";
  return `${short}${dot} ${p.y}`;
}

interface Props {
  value?: string;
  onChange?: (e: { target: { value: string } }) => void;
  className?: string;
  wrapperClassName?: string;
  placeholder?: string;
  /**
   * Выравнивать значение по центру кнопки, а не по левому краю.
   *
   * Нужно там, где поле стоит между стрелками «предыдущий/следующий» и работает
   * как счётчик: значение прыгает по длине («Май 2026» → «Сентябрь 2026»), и
   * прижатое влево оно ездит относительно стрелок. Значок календаря при этом
   * остаётся справа, а слева встаёт пустышка той же ширины — иначе «центр»
   * оказался бы смещён на значок.
   */
  centered?: boolean;
  /**
   * "day" (default) → value is "YYYY-MM-DD", calendar picks a day.
   * "month" → value is "YYYY-MM", the same popup opens straight to the month
   * grid and selecting a month emits "YYYY-MM" (no day step). Reuses the one
   * Russian calendar component instead of a native <input type="month">.
   */
  granularity?: "day" | "month";
}

export function DateField({
  value = "",
  onChange,
  className = "",
  wrapperClassName = "",
  placeholder,
  centered = false,
  granularity = "day",
}: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const display = value
    ? granularity === "month"
      ? toDisplayMonth(value)
      : toDisplay(value)
    : "";
  const ph = placeholder || (granularity === "month" ? "месяц год" : "дд.мм.гггг");
  const emit = (v: string) => onChange?.({ target: { value: v } });

  return (
    <div className={`relative ${wrapperClassName}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={placeholder || "Дата"}
        // В режиме счётчика (`centered`) просветы меньше: поле стоит между
        // стрелками, и лишние миллиметры там видны сразу.
        className={`${className} flex items-center justify-between ${
          centered ? "gap-1.5" : "gap-2"
        } text-left`}
      >
        {centered && <span className="w-4 shrink-0" aria-hidden />}
        <span
          className={`truncate ${centered ? "flex-1 text-center" : ""} ${
            display ? "" : "text-muted"
          }`}
        >
          {display || ph}
        </span>
        <Calendar className="w-4 h-4 shrink-0 text-muted" />
      </button>
      {open && (
        <CalendarPopup
          anchorRef={btnRef}
          value={value}
          granularity={granularity}
          onSelect={(v) => {
            emit(v);
            setOpen(false);
          }}
          onClear={() => {
            emit("");
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function computePos(anchor: HTMLElement | null) {
  if (!anchor) return { left: 8, top: 8 };
  const r = anchor.getBoundingClientRect();
  const W = 268;
  const H = 322;
  let left = r.left;
  let top = r.bottom + 4;
  if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8;
  if (left < 8) left = 8;
  // Flip above the field if there's no room below.
  if (top + H > window.innerHeight - 8 && r.top - H - 4 > 8) top = r.top - H - 4;
  return { left, top };
}

function CalendarPopup({
  anchorRef,
  value,
  granularity = "day",
  onSelect,
  onClear,
  onClose,
}: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  value: string;
  granularity?: "day" | "month";
  onSelect: (iso: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isMonth = granularity === "month";
  const sel = value
    ? isMonth
      ? (() => {
          const p = parseYM(value);
          return p ? { y: p.y, m: p.m, d: 1 } : null;
        })()
      : parseISO(value)
    : null;
  const today = new Date();
  const [view, setView] = useState(() =>
    sel
      ? { y: sel.y, m: sel.m }
      : { y: today.getFullYear(), m: today.getMonth() }
  );
  // The header title drills up — "Июнь 2026" → month grid → decade grid —
  // and tapping a cell drills back down, so a far-off month/year is two
  // clicks away instead of dozens of ‹ › steps. In month-granularity mode we
  // start on the month grid and a month tap is the final selection.
  const [mode, setMode] = useState<"days" | "months" | "years">(
    isMonth ? "months" : "days"
  );
  const [yearStart, setYearStart] = useState(view.y - 6); // 12-year grid origin
  // Position against the anchor in a layout effect — reading the ref's
  // .current during render is unsafe (and lint-flagged); a layout effect
  // runs before paint so there's no flash at the default 8/8 spot.
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 8, top: 8 });
  useLayoutEffect(() => {
    setPos(computePos(anchorRef.current));
  }, [anchorRef]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [anchorRef, onClose]);

  const firstDow = (new Date(view.y, view.m, 1).getDay() + 6) % 7; // Mon = 0
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const prevMonth = () =>
    setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }));
  const nextMonth = () =>
    setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }));

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Выбор даты"
      className="fixed z-[70] w-[268px] rounded-xl border border-border bg-panel shadow-xl p-3 animate-fade"
      style={{ left: pos.left, top: pos.top }}
    >
      {mode === "days" && (
        <>
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => setMode("months")}
              className="font-semibold text-sm px-1.5 py-0.5 rounded-md hover:bg-panel2"
            >
              {MONTHS[view.m]} {view.y}
            </button>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={prevMonth}
                className="p-1 rounded-md text-muted hover:text-text hover:bg-panel2"
                aria-label="Предыдущий месяц"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={nextMonth}
                className="p-1 rounded-md text-muted hover:text-text hover:bg-panel2"
                aria-label="Следующий месяц"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map((w) => (
              <div key={w} className="text-[11px] text-muted py-1">
                {w}
              </div>
            ))}
            {cells.map((d, i) =>
              d === null ? (
                <div key={i} />
              ) : (
                (() => {
                  const isSel =
                    sel && sel.y === view.y && sel.m === view.m && sel.d === d;
                  const isToday =
                    today.getFullYear() === view.y &&
                    today.getMonth() === view.m &&
                    today.getDate() === d;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => onSelect(toISO(view.y, view.m, d))}
                      className={`h-8 rounded-md text-sm tabular-nums transition-colors ${
                        isSel
                          ? "bg-accent text-accent-fg font-semibold"
                          : isToday
                            ? "border border-accent/60 text-text"
                            : "text-text hover:bg-panel2"
                      }`}
                    >
                      {d}
                    </button>
                  );
                })()
              )
            )}
          </div>
        </>
      )}
      {mode === "months" && (
        <>
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => {
                setYearStart(view.y - 6);
                setMode("years");
              }}
              className="font-semibold text-sm px-1.5 py-0.5 rounded-md hover:bg-panel2"
            >
              {view.y}
            </button>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setView((v) => ({ ...v, y: v.y - 1 }))}
                className="p-1 rounded-md text-muted hover:text-text hover:bg-panel2"
                aria-label="Предыдущий год"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setView((v) => ({ ...v, y: v.y + 1 }))}
                className="p-1 rounded-md text-muted hover:text-text hover:bg-panel2"
                aria-label="Следующий год"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1 text-center">
            {MONTHS_SHORT.map((mname, mi) => {
              const isSel = sel && sel.y === view.y && sel.m === mi;
              const isCur =
                today.getFullYear() === view.y && today.getMonth() === mi;
              return (
                <button
                  key={mname}
                  type="button"
                  onClick={() => {
                    if (isMonth) {
                      onSelect(`${view.y}-${pad(mi + 1)}`);
                    } else {
                      setView((v) => ({ ...v, m: mi }));
                      setMode("days");
                    }
                  }}
                  className={`h-10 rounded-md text-sm transition-colors ${
                    isSel
                      ? "bg-accent text-accent-fg font-semibold"
                      : isCur
                        ? "border border-accent/60 text-text"
                        : "text-text hover:bg-panel2"
                  }`}
                >
                  {mname}
                </button>
              );
            })}
          </div>
        </>
      )}
      {mode === "years" && (
        <>
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold text-sm px-1.5 tabular-nums">
              {yearStart} – {yearStart + 11}
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setYearStart((s) => s - 12)}
                className="p-1 rounded-md text-muted hover:text-text hover:bg-panel2"
                aria-label="Предыдущие годы"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setYearStart((s) => s + 12)}
                className="p-1 rounded-md text-muted hover:text-text hover:bg-panel2"
                aria-label="Следующие годы"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1 text-center">
            {Array.from({ length: 12 }, (_, i) => yearStart + i).map((yr) => {
              const isSel = sel && sel.y === yr;
              const isCur = today.getFullYear() === yr;
              return (
                <button
                  key={yr}
                  type="button"
                  onClick={() => {
                    setView((v) => ({ ...v, y: yr }));
                    setMode("months");
                  }}
                  className={`h-10 rounded-md text-sm tabular-nums transition-colors ${
                    isSel
                      ? "bg-accent text-accent-fg font-semibold"
                      : isCur
                        ? "border border-accent/60 text-text"
                        : "text-text hover:bg-panel2"
                  }`}
                >
                  {yr}
                </button>
              );
            })}
          </div>
        </>
      )}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-muted hover:text-text"
        >
          Очистить
        </button>
        <button
          type="button"
          onClick={() =>
            onSelect(
              isMonth
                ? `${today.getFullYear()}-${pad(today.getMonth() + 1)}`
                : toISO(today.getFullYear(), today.getMonth(), today.getDate())
            )
          }
          className="text-xs text-accent hover:underline"
        >
          {isMonth ? "Текущий месяц" : "Сегодня"}
        </button>
      </div>
    </div>,
    document.body
  );
}
