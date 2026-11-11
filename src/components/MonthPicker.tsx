import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, CalendarRange } from "lucide-react";
import clsx from "clsx";
import { MonthMenu } from "./MonthMenu";
import { monthLabelFull } from "../lib/format";

/** «YYYY-MM» плюс `n` месяцев. */
function addMonths(ym: string, n: number): string {
  const idx = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}


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
  dimmed,
  mode = "month",
  hint,
  size = "sm",
  onSelect,
  onSelectYear,
  onStep,
  exclude,
}: {
  /** Currently shown month, "YYYY-MM". В режиме года берётся только год. */
  value: string;
  minYM: string;
  maxYM: string;
  /** Whether the month filter is the active date mode. */
  active: boolean;
  /** Период задан не им: дорожка приглушается, чтобы рабочий контрол был виден. */
  dimmed?: boolean;
  /** Что выбираем — месяц или год. */
  mode?: "month" | "year";
  /**
   * Подсказка к подписи: при отчётном месяце не с 1-го числа название месяца
   * само по себе обманывает — «Август» с днём 28 идёт по 27 сентября. Даты
   * отрезка показываем подсказкой, чтобы не растить кнопку.
   */
  hint?: string;
  /**
   * Ступень: `sm` 34 — ряд общего фильтра и шапки карточек, `md` 42 — ряд
   * контролов раздела, где рядом дорожки крупной ступени.
   */
  size?: "sm" | "md";
  onSelect: (ym: string) => void;
  onSelectYear?: (year: number) => void;
  onStep: (dir: -1 | 1) => void;
  /**
   * Значение, которое выбрать нельзя: «YYYY-MM» (или год в режиме года). В
   * «Сравнении» это второй период — сравнивать месяц с ним же незачем.
   * В списке оно погашено, стрелки его перешагивают.
   */
  exclude?: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  /** Панель пересоздаётся на каждое открытие — с годом выбранного месяца. */
  const [openCount, setOpenCount] = useState(0);

  const year = Number(value?.slice(0, 4)) || new Date().getFullYear();
  const minY = Number(minYM?.slice(0, 4)) || 1970;
  const maxY = Number(maxYM?.slice(0, 4)) || 3000;
  const isYear = mode === "year";
  const excludedYear = isYear && exclude ? Number(exclude.slice(0, 4)) : null;
  const excludedYM = !isYear && exclude ? exclude : null;
  /** Куда шагнуть стрелкой: через исключённое значение — дальше на один. */
  const stepTarget = (dir: -1 | 1): { year: number; ym: string; skip: boolean } => {
    let y = year + dir;
    let ym = value ? addMonths(value, dir) : "";
    const skip = isYear ? y === excludedYear : !!ym && ym === excludedYM;
    if (skip) {
      y += dir;
      ym = addMonths(ym, dir);
    }
    return { year: y, ym, skip };
  };
  const inBounds = (t: { year: number; ym: string }) =>
    isYear ? t.year >= minY && t.year <= maxY : (!minYM || t.ym >= minYM) && (!maxYM || t.ym <= maxYM);
  const canPrev = (isYear ? year > minY : !!minYM && value > minYM) && inBounds(stepTarget(-1));
  const canNext = (isYear ? year < maxY : !!maxYM && value < maxYM) && inBounds(stepTarget(1));
  const step = (dir: -1 | 1) => {
    const t = stepTarget(dir);
    if (!t.skip) return onStep(dir);
    if (isYear) onSelectYear?.(t.year);
    else onSelect(t.ym);
  };

  return (
    <div
      // Дорожка и пункты — общие `.seg-*`: та же пилюля, что у `Segmented`
      // той же ступени, и выбранная подпись светится так же.
      className={clsx("seg-track", active && "!border-accent bg-accent/5", dimmed && "opacity-55")}
      title={isYear ? "Перейти к одному году" : "Перейти к одному месяцу"}
    >
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={!canPrev}
        className={clsx("seg-icon", size === "md" ? "seg-icon-md" : "seg-icon-sm")}
        title={isYear ? "Предыдущий год" : "Предыдущий месяц"}
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      <button
        type="button"
        ref={btnRef}
        onClick={() => {
          // Открываем — показываем год выбранного месяца. Это следствие
          // нажатия, а не состояния: эффектом оно правилось уже ПОСЛЕ
          // отрисовки, лишним проходом, и год успевал мигнуть прошлым.
          if (!open) setOpenCount((n) => n + 1);
          setOpen((o) => !o);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={hint}
        className={clsx(
          // `flex-1` — чтобы подпись стояла по центру, когда дорожка растянута
          // на всю ширину (узкое окно): иначе месяц жался к левой стрелке, а
          // справа зияла пустота.
          "seg-item flex-1",
          // Ширины хватает на самый длинный месяц («Сентябрь 26 г.») целиком:
          // сокращение «Сент.» экономило пиксели там, где их и так достаточно,
          // а читалось хуже.
          size === "md" ? "seg-item-md min-w-[160px]" : "seg-item-sm min-w-[148px]",
          active && "seg-on"
        )}
      >
        <CalendarRange className={size === "md" ? "w-4 h-4" : "w-3.5 h-3.5"} />
        {isYear ? year : value ? monthLabelFull(value) : "Месяц"}
        <ChevronDown
          className={clsx(size === "md" ? "w-4 h-4" : "w-3.5 h-3.5", "transition-transform", open && "rotate-180")}
        />
      </button>

      <button
        type="button"
        onClick={() => step(1)}
        disabled={!canNext}
        className={clsx("seg-icon", size === "md" ? "seg-icon-md" : "seg-icon-sm")}
        title={isYear ? "Следующий год" : "Следующий месяц"}
      >
        <ChevronRight className="w-4 h-4" />
      </button>

      <MonthMenu
        key={openCount}
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={btnRef}
        align="center"
        value={value}
        minYM={minYM}
        maxYM={maxYM}
        mode={isYear ? "year" : "month"}
        yearsOnly={isYear}
        exclude={exclude}
        onSelect={onSelect}
        onSelectYear={onSelectYear}
      />
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
  exclude,
}: {
  year: number;
  minYear: number;
  maxYear: number;
  onChange: (year: number) => void;
  /** `md` 42 — год раздела в ряду контролов; `sm` 34 — в шапке карточки. */
  size?: "sm" | "md";
  /** Год, который выбрать нельзя (второй период сравнения). */
  exclude?: number;
}) {
  return (
    <MonthPicker
      size={size}
      exclude={exclude != null ? String(exclude) : undefined}
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
