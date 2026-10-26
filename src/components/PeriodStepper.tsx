import { useRef, useState } from "react";
import { CalendarCheck, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { MonthMenu } from "./MonthMenu";
import { StableWidth } from "./StableWidth";
import { monthLabelFull } from "../lib/format";
import { MONTHS } from "../lib/months";
import { quarterLabel, quarterOf, shiftPeriod } from "../lib/period";

/**
 * Все двенадцать подписей месяцев этого года — по ним кнопка берёт ширину.
 * Считать «самый длинный» по числу букв нельзя: шрифт пропорциональный, и
 * «Февраль» шире «Сентября» в одних начертаниях и уже в других.
 */
function monthLabels(year: number): string[] {
  return MONTHS.map((_, i) => monthLabelFull(`${year}-${String(i + 1).padStart(2, "0")}`));
}

/** Свои стрелки и подписи — для скользящего окна общего фильтра. */
export interface StepOverride {
  canPrev: boolean;
  canNext: boolean;
  prevTitle: string;
  nextTitle: string;
  currentTitle: string;
}

/**
 * Выбранный период одной дорожкой: ‹ «Октябрь 2026 ▾» › и значок «вернуться к
 * текущему» в ней же. Стрелки листают единицей — месяц, квартал или год;
 * название открывает список (`MonthMenu`).
 *
 * Один контрол на весь продукт: общий фильтр (`PeriodPicker`) и бюджет.
 * Прежде у бюджета были свои стрелки, родное поле месяца и текстовая ссылка
 * «Текущий», которая появлялась и пропадала, двигая ряд.
 */
export function PeriodStepper({
  monthYM,
  minYM = "",
  maxYM = "",
  mode = "month",
  active = false,
  hint,
  size = "sm",
  blank = false,
  onStep,
  onCurrent,
  atCurrent,
  onSelectMonth,
  onSelectYear,
  onSelectQuarter,
  override,
}: {
  /** Месяц-якорь «YYYY-MM» — от него подпись и список. */
  monthYM: string;
  /** Границы листания и списка; пусто — без границ. */
  minYM?: string;
  maxYM?: string;
  mode?: "month" | "quarter" | "year";
  /** Период задаёт именно этот контрол — дорожка и название подсвечены. */
  active?: boolean;
  /** Подсказка к названию (даты отчётного месяца). */
  hint?: string;
  size?: "sm" | "md";
  /** Названия нет («Всё», скользящее окно) — вместо него прочерк. */
  blank?: boolean;
  onStep: (dir: -1 | 1) => void;
  onCurrent: () => void;
  atCurrent: boolean;
  onSelectMonth: (ym: string) => void;
  onSelectYear: (year: number) => void;
  onSelectQuarter?: (ym: string) => void;
  /** Стрелки и подписи не по единице периода (окно «30 дней»). */
  override?: StepOverride;
}) {
  const [open, setOpen] = useState(false);
  const monthBtnRef = useRef<HTMLButtonElement>(null);
  const icon = size === "md" ? "seg-icon-md" : "seg-icon-sm";
  const item = size === "md" ? "seg-item-md" : "seg-item-sm";
  const isYear = mode === "year";
  const isQuarter = mode === "quarter";
  const unitTitle = isYear ? "год" : isQuarter ? "квартал" : "период";
  const year = Number(monthYM?.slice(0, 4)) || new Date().getFullYear();

  // Названия листаются только в пределах истории (`minYM`…`maxYM`).
  const unitMonths = isYear ? 12 : isQuarter ? 3 : 1;
  const unitStart = isYear
    ? `${year}-01`
    : isQuarter
      ? `${year}-${String((quarterOf(monthYM) - 1) * 3 + 1).padStart(2, "0")}`
      : monthYM;
  const canPrevUnit = !blank && (!minYM || shiftPeriod(unitStart, -1) >= minYM);
  const canNextUnit = !blank && (!maxYM || shiftPeriod(unitStart, unitMonths) <= maxYM);
  const canPrev = override ? override.canPrev : canPrevUnit;
  const canNext = override ? override.canNext : canNextUnit;
  const prevTitle = override
    ? override.prevTitle
    : canPrevUnit || blank
      ? `Предыдущий ${unitTitle}`
      : "Раньше операций нет";
  const nextTitle = override
    ? override.nextTitle
    : canNextUnit || blank
      ? `Следующий ${unitTitle}`
      : "Дальше операций нет";
  const unitName = isYear ? "год" : isQuarter ? "квартал" : "месяц";
  const unitDative = isYear ? "году" : isQuarter ? "кварталу" : "месяцу";
  const currentTitle = override
    ? override.currentTitle
    : atCurrent
      ? `Это текущий ${unitName}`
      : `Вернуться к текущему ${unitDative}`;

  return (
    <>
      <div className={clsx("seg-track shrink-0", active && "!border-accent bg-accent/5")}>
        <button
          type="button"
          onClick={() => onStep(-1)}
          disabled={!canPrev}
          className={clsx("seg-icon", icon)}
          title={prevTitle}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          ref={monthBtnRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          title={hint ?? (isYear ? "Выбрать год" : isQuarter ? "Выбрать квартал" : "Выбрать месяц")}
          className={clsx("seg-item shrink-0", item, active && "seg-on")}
        >
          {/* Ширина держится по месяцам даже в режиме года и квартала:
              «2026» вдвое уже «Сентября», и переключение дёргало бы ряд. */}
          <StableWidth
            value={
              blank ? "—" : isYear ? year : isQuarter ? quarterLabel(monthYM) : monthLabelFull(monthYM)
            }
            candidates={monthLabels(year)}
          />
          <ChevronDown className="w-3 h-3 opacity-60" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onStep(1)}
          disabled={!canNext}
          className={clsx("seg-icon", icon)}
          title={nextTitle}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        {/* Возврат к текущему — значком в той же дорожке, а не ссылкой рядом:
            ссылка появлялась и пропадала и двигала соседей. Здесь кнопка на
            месте всегда, на текущем периоде просто неактивна. */}
        <button
          type="button"
          onClick={onCurrent}
          disabled={atCurrent}
          className={clsx("seg-icon", icon)}
          title={currentTitle}
          aria-label={currentTitle}
        >
          <CalendarCheck className="w-4 h-4" />
        </button>
      </div>
      <MonthMenu
        // Новый ключ на каждое открытие: панель начинает с года выбранного
        // месяца, а не с того, где её оставили в прошлый раз.
        key={open ? monthYM : "closed"}
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={monthBtnRef}
        value={monthYM}
        minYM={minYM}
        maxYM={maxYM}
        mode={mode}
        onSelect={onSelectMonth}
        onSelectYear={onSelectYear}
        onSelectQuarter={onSelectQuarter}
      />
    </>
  );
}
