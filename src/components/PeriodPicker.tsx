import { useRef, useState } from "react";
import { CalendarCheck, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { DateField } from "./DateField";
import { MonthMenu } from "./MonthMenu";
import { monthLabelFull } from "../lib/format";
import { shiftDays, spanDays } from "../lib/period";
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
 * Период одним контролом: название месяца (или года), его даты, стрелки и
 * возврат к текущему.
 *
 * Залита та зона, которая СЕЙЧАС задаёт период, — ровно одна из двух: название,
 * когда выбран месяц или год, и пара дат, когда отрезок задан руками. Заливка,
 * а не цвет цифр: у названия она такая же, и два разных способа показать одно и
 * то же состояние читались как разные состояния.
 *
 * Раньше это были две отдельные дорожки — месяц и отрезок дат, — и каждая
 * ширина окна ломала их по-своему: то они наезжали друг на друга, то
 * разъезжались лесенкой, то кнопка сброса оставалась в строке одна. Один блок
 * либо помещается целиком, либо целиком переносится, и чинить больше нечего.
 *
 * Внутри две зоны, и подсвечена та, которая СЕЙЧАС задаёт период: название —
 * когда выбран месяц или год, даты — когда отрезок свой.
 */
export function PeriodPicker({
  monthYM,
  minYM,
  maxYM,
  mode = "month",
  monthActive,
  rangeActive,
  stepsByWindow,
  from,
  to,
  monthHint,
  size = "sm",
  onSelectMonth,
  onSelectYear,
  onStep,
  onRangeChange,
  onCurrent,
  atCurrent,
}: {
  /** Месяц-якорь «YYYY-MM» — от него подпись и список. */
  monthYM: string;
  minYM: string;
  maxYM: string;
  /** В режиме года подпись — «2026», а список открывается сразу годами. */
  mode?: "month" | "year";
  /** Период задаёт название (месяц или год). */
  monthActive: boolean;
  /** Период задаёт отрезок дат. */
  rangeActive: boolean;
  /**
   * Чем листать: своим отрезком (по его длине) или периодом (месяц, год,
   * отчётный месяц). У отчётного месяца длина не постоянна, и шагать ею
   * нельзя — «Сентябрь» с днём 15 ушёл бы на 16.08, а не на 15.08.
   */
  stepsByWindow: boolean;
  from: string | null;
  to: string | null;
  /** Подсказка к названию — даты отчётного месяца, когда он не календарный. */
  monthHint?: string;
  size?: "sm" | "md";
  onSelectMonth: (ym: string) => void;
  onSelectYear: (year: number) => void;
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
  const year = Number(monthYM?.slice(0, 4)) || new Date().getFullYear();

  const windowStep = from && to ? spanDays(from, to) : 0;
  const canStep = stepsByWindow ? windowStep > 0 : true;

  const shift = (dir: -1 | 1) => {
    if (!stepsByWindow) {
      onStep(dir);
      return;
    }
    if (!from || !to || windowStep <= 0) return;
    onRangeChange(shiftDays(from, dir * windowStep), shiftDays(to, dir * windowStep));
  };

  return (
    <div
      className={clsx(
        // Дорожка забирает остаток строки, но не больше разумного: на широком
        // экране (и при уменьшенном масштабе) она иначе оставляла перед кнопкой
        // сброса дыру в пол-экрана. Запас забирают ДАТЫ: у названия своя
        // заливка, и растянутое, оно читается как половина контрола, а не как
        // выбранный месяц.
        //
        // На телефоне даты переносятся на свою строку: в 390 пикселей месяц,
        // две даты и четыре значка в один ряд не встают — даты сжимались до
        // нуля и печатались одна поверх другой.
        "seg-track flex-1 min-w-fit max-sm:w-full max-sm:min-w-0 max-sm:flex-wrap",
        (monthActive || rangeActive) && "!border-accent bg-accent/5"
      )}
    >
      <button
        type="button"
        onClick={() => shift(-1)}
        disabled={!canStep}
        className={clsx("seg-icon", icon)}
        title={stepsByWindow ? `Предыдущие ${windowStep} дн.` : isYear ? "Предыдущий год" : "Предыдущий период"}
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      <button
        ref={monthBtnRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={monthHint ?? (isYear ? "Выбрать год" : "Выбрать месяц")}
        className={clsx("seg-item shrink-0", item, monthActive && "seg-on")}
      >
        {/* Ширина держится по месяцам даже в режиме года: «2026» вдвое уже
            «Сентября», и переключение «Месяц ↔ Год» дёргало бы весь ряд. */}
        <StableWidth
          value={isYear ? year : monthLabelFull(monthYM)}
          candidates={monthLabels(year)}
        />
        <ChevronDown className="w-3 h-3 opacity-60" aria-hidden="true" />
      </button>

      <span className="w-px self-center h-4 bg-border shrink-0" aria-hidden="true" />

      {/* Даты — единой группой по центру свободного места: растянутые на
          половину каждая, они прижимались к стрелкам, и середина зияла. */}
      <div
        className={clsx(
          "flex-1 flex items-center justify-center gap-1 min-w-0 rounded-control-sm",
          "max-sm:basis-full max-sm:order-last",
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
            // подсвечивается по самой заливке: общий `hover:bg-panel` выбелил бы
            // поле пятном посреди акцента.
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
        onClick={() => shift(1)}
        disabled={!canStep}
        className={clsx("seg-icon", icon)}
        title={stepsByWindow ? `Следующие ${windowStep} дн.` : isYear ? "Следующий год" : "Следующий период"}
      >
        <ChevronRight className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={onCurrent}
        disabled={atCurrent}
        className={clsx("seg-icon", icon)}
        title={atCurrent ? "Это текущий отчётный период" : "Вернуться к текущему отчётному периоду"}
      >
        <CalendarCheck className="w-4 h-4" />
      </button>

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
      />
    </div>
  );
}
