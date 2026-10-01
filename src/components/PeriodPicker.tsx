import { useRef, useState } from "react";
import { CalendarCheck, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { DateField } from "./DateField";
import { MonthMenu } from "./MonthMenu";
import { monthLabelFull } from "../lib/format";
import { quarterLabel, quarterOf, shiftDays, shiftPeriod, spanDays } from "../lib/period";
import { MONTHS, MONTHS_SHORT } from "../lib/months";
import { StableWidth } from "./StableWidth";

/**
 * Все двенадцать подписей месяцев этого года — по ним кнопка берёт ширину.
 * Считать «самый длинный» по числу букв нельзя: шрифт пропорциональный, и
 * «Февраль» шире «Сентября» в одних начертаниях и уже в других.
 */
function monthLabels(year: number): string[] {
  return MONTHS.map((_, i) => monthLabelFull(`${year}-${String(i + 1).padStart(2, "0")}`));
}

/**
 * «01 авг. 2026» — дата словами, всегда одной длины.
 *
 * День с ведущим нулём и год у обеих границ — не для красоты: короткая запись
 * («1 сен.» против «30 сент. 2026») оставляла в поле пустое место, и между
 * месяцем и датами зияла дыра. Одинаковая длина заполняет отведённое место и
 * заодно держит контрол неподвижным при листании.
 */
function textDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  const short = MONTHS_SHORT[m - 1];
  const dot = short === MONTHS[m - 1] ? "" : ".";
  return `${String(d).padStart(2, "0")} ${short.toLowerCase()}${dot} ${y}`;
}

/** «15.08.26» — компактная запись для узких окон. */
function numericDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y.slice(2)}`;
}

/**
 * Варианты подписи даты — по ним поле берёт ширину.
 *
 * Даты в дорожке меняются чаще всего, и каждая смена двигала контрол: «2 янв.
 * 2023» заметно уже «18 сент. 2025», и от переключения пресета весь ряд
 * фильтров перекладывался. Берём самый широкий случай: двузначный день, любой
 * месяц, четырёхзначный год — он же и есть максимум для этого поля.
 */
const DATE_CANDIDATES = MONTHS_SHORT.map(
  (short, i) => `00 ${short.toLowerCase()}${short === MONTHS[i] ? "" : "."} 2026`
);

/**
 * Подпись поля: словами везде, кроме телефона.
 *
 * Прежде словами печаталось только от 1536 — и на обычном ноутбуке дата всегда
 * была цифрами, хотя разница в ширине у «15 сен. — 14 окт. 2026» и «15.09.26 —
 * 14.10.26» всего пара десятков пикселей, а дорожка и так тянется на остаток
 * строки.
 */
function dateLabel(iso: string | null) {
  if (!iso) return undefined;
  return (
    <>
      <span className="hidden dates:inline">
        <StableWidth value={textDate(iso)} candidates={DATE_CANDIDATES} />
      </span>
      {/* Цифры — моноширинные: «11.11.26» и «30.09.26» иначе разной ширины. */}
      <span className="dates:hidden tabular-nums">{numericDate(iso)}</span>
    </>
  );
}

/**
 * Период — двумя контролами, у каждого свои стрелки.
 *
 *   • Выбранный период: ‹ «III кв. 2026 ▾» › и возврат к текущему. Стрелки
 *     листают его единицей — месяц, квартал или год.
 *   • Свободный отрезок: ‹ «01.07.26 — 30.09.26» ›. Стрелки сдвигают отрезок
 *     на его же длину, даты правятся руками.
 *
 * Одной дорожкой (стрелки общие) было не понять, что листается: у названия
 * и у дат разный шаг, а стрелки делали то одно, то другое в зависимости от
 * того, что выбрано. Две дорожки стоят рядом одной группой и переносятся
 * вместе; подсвечена та, что СЕЙЧАС задаёт период.
 */
export function PeriodPicker({
  monthYM,
  minYM,
  maxYM,
  mode = "month",
  monthActive,
  rangeActive,
  from,
  to,
  monthHint,
  size = "sm",
  onSelectMonth,
  onSelectYear,
  onSelectQuarter,
  blank = false,
  rangeFixed = false,
  minDate = null,
  maxDate = null,
  onStep,
  onRangeChange,
  onCurrent,
  atCurrent,
}: {
  /** Месяц-якорь «YYYY-MM» — от него подпись и список. */
  monthYM: string;
  minYM: string;
  maxYM: string;
  /**
   * В режиме года подпись — «2026», а список открывается сразу годами; в
   * режиме квартала — «III кв. 2026», в списке кварталы.
   */
  mode?: "month" | "quarter" | "year";
  /** Период задаёт название (месяц или год). */
  monthActive: boolean;
  /** Период задаёт отрезок дат. */
  rangeActive: boolean;
  from: string | null;
  to: string | null;
  /** Подсказка к названию — даты отчётного месяца, когда он не календарный. */
  monthHint?: string;
  size?: "sm" | "md";
  onSelectMonth: (ym: string) => void;
  onSelectYear: (year: number) => void;
  onSelectQuarter?: (ym: string) => void;
  /**
   * Названия у периода нет — выбрано «Всё» или скользящее окно. Вместо
   * месяца прочерк: подпись «Сентябрь 26 г.» выдавала себя за выбранный период.
   */
  blank?: boolean;
  /**
   * Отрезок — вся история («Всё»): сдвигать его некуда, стрелки дат гаснут.
   * Иначе они шагали на длину всей истории — на пять лет за раз.
   */
  rangeFixed?: boolean;
  /**
   * Границы истории по дням — дальше них отрезок не сдвигается: окно, целиком
   * ушедшее за первую операцию или за сегодняшний день, показывало бы пустоту.
   */
  minDate?: string | null;
  maxDate?: string | null;
  /** Листнуть период: месяц, год или отчётный месяц — смотря что выбрано. */
  onStep: (dir: -1 | 1) => void;
  onRangeChange: (from: string | null, to: string | null) => void;
  /** Вернуться к периоду, который идёт сейчас. */
  onCurrent: () => void;
  atCurrent: boolean;
}) {
  const [open, setOpen] = useState(false);
  const monthBtnRef = useRef<HTMLButtonElement>(null);
  const icon = size === "md" ? "seg-icon-md" : "seg-icon-sm";
  const item = size === "md" ? "seg-item-md" : "seg-item-sm";
  const isYear = mode === "year";
  const isQuarter = mode === "quarter";
  const unitTitle = isYear ? "год" : isQuarter ? "квартал" : "период";
  const year = Number(monthYM?.slice(0, 4)) || new Date().getFullYear();

  const windowStep = from && to && !rangeFixed ? spanDays(from, to) : 0;

  // Названия листаются только в пределах истории: от первого месяца с
  // операциями до последнего (или текущего, если он позже — см. `maxYM`).
  const unitMonths = isYear ? 12 : isQuarter ? 3 : 1;
  const unitStart = isYear
    ? `${year}-01`
    : isQuarter
      ? `${year}-${String((quarterOf(monthYM) - 1) * 3 + 1).padStart(2, "0")}`
      : monthYM;
  const canPrevUnit = !blank && (!minYM || shiftPeriod(unitStart, -1) >= minYM);
  const canNextUnit = !blank && (!maxYM || shiftPeriod(unitStart, unitMonths) <= maxYM);
  // Отрезок — пока сдвинутое окно хоть краем задевает историю.
  const canPrevWindow =
    windowStep > 0 && (!minDate || !to || shiftDays(to, -windowStep) >= minDate);
  const canNextWindow =
    windowStep > 0 && (!maxDate || !from || shiftDays(from, windowStep) <= maxDate);
  const rangeTitle = rangeFixed
    ? "Выбрана вся история — сдвигать отрезок некуда"
    : "Задайте даты, чтобы листать отрезок";

  /** Сдвинуть свободный отрезок на его же длину. */
  const shiftWindow = (dir: -1 | 1) => {
    if (!from || !to || windowStep <= 0) return;
    onRangeChange(shiftDays(from, dir * windowStep), shiftDays(to, dir * windowStep));
  };

  const activeTrack = "!border-accent bg-accent/5";

  return (
    <div className="flex items-center gap-2 flex-1 min-w-fit max-sm:w-full max-sm:flex-wrap max-sm:min-w-0">
      {/* Выбранный период */}
      <div className={clsx("seg-track shrink-0", monthActive && activeTrack)}>
        <button
          type="button"
          onClick={() => onStep(-1)}
          disabled={!canPrevUnit}
          className={clsx("seg-icon", icon)}
          title={canPrevUnit || blank ? `Предыдущий ${unitTitle}` : "Раньше операций нет"}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          ref={monthBtnRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          title={monthHint ?? (isYear ? "Выбрать год" : isQuarter ? "Выбрать квартал" : "Выбрать месяц")}
          className={clsx("seg-item shrink-0", item, monthActive && "seg-on")}
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
          disabled={!canNextUnit}
          className={clsx("seg-icon", icon)}
          title={canNextUnit || blank ? `Следующий ${unitTitle}` : "Дальше операций нет"}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onCurrent}
          disabled={atCurrent}
          className={clsx("seg-icon", icon)}
          title={
            atCurrent
              ? `Это текущий ${isYear ? "год" : isQuarter ? "квартал" : "месяц"}`
              : `Вернуться к текущему ${isYear ? "году" : isQuarter ? "кварталу" : "месяцу"}`
          }
        >
          <CalendarCheck className="w-4 h-4" />
        </button>
      </div>

      {/* Свободный отрезок */}
      <div
        className={clsx(
          // На узком экране — своей строкой: `basis-full`, а не `w-full` —
          // у `flex-1` основа нулевая и перебивала ширину, отрезок сжимался до
          // 30 пикселей рядом с месяцем и наезжал сам на себя.
          "seg-track flex-1 min-w-fit max-sm:basis-full max-sm:min-w-0",
          rangeActive && activeTrack
        )}
      >
        <button
          type="button"
          onClick={() => shiftWindow(-1)}
          disabled={!canPrevWindow}
          className={clsx("seg-icon", icon)}
          title={canPrevWindow ? `Предыдущие ${windowStep} дн.` : windowStep > 0 ? "Раньше операций нет" : rangeTitle}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        {/* Даты — единой группой по центру свободного места. */}
        <div
          className={clsx(
            "flex-1 flex items-center justify-center gap-1 min-w-0 rounded-control-sm",
            rangeActive && "seg-on px-1"
          )}
        >
          <DateField
            value={from || ""}
            onChange={(e) => onRangeChange(e.target.value || null, to)}
            className={clsx(
              "seg-item min-w-0 !px-2",
              item,
              // Внутри залитой зоны подпись берёт её цвет, а наведение
              // подсвечивается по самой заливке.
              rangeActive ? "text-inherit hover:bg-black/10 hover:text-inherit" : "text-accent"
            )}
            wrapperClassName="min-w-0"
            icon={false}
            display={dateLabel(from)}
            placeholder="Начало"
          />
          <span
            className={clsx("text-xs shrink-0", rangeActive ? "text-inherit opacity-70" : "text-muted")}
            aria-hidden="true"
          >
            —
          </span>
          <DateField
            value={to || ""}
            onChange={(e) => onRangeChange(from, e.target.value || null)}
            className={clsx(
              "seg-item min-w-0 !px-2",
              item,
              rangeActive ? "text-inherit hover:bg-black/10 hover:text-inherit" : "text-accent"
            )}
            wrapperClassName="min-w-0"
            icon={false}
            display={dateLabel(to)}
            placeholder="Конец"
          />
        </div>
        <button
          type="button"
          onClick={() => shiftWindow(1)}
          disabled={!canNextWindow}
          className={clsx("seg-icon", icon)}
          title={canNextWindow ? `Следующие ${windowStep} дн.` : windowStep > 0 ? "Дальше операций нет" : rangeTitle}
        >
          <ChevronRight className="w-4 h-4" />
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
    </div>
  );
}
