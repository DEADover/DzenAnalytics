import { CalendarCheck, ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { DateField } from "./DateField";
import { shiftDays, spanDays } from "../lib/period";
import { MONTHS, MONTHS_SHORT } from "../lib/months";

/**
 * «15 авг. 2026» — дата словами. В широкой дорожке она читается лучше цифр, а
 * год у второй границы печатается всегда: у первой его прячем, когда обе даты
 * в одном году, — «15 авг. — 14 сент. 2026» короче и понятнее.
 *
 * У мая точки нет: это слово целиком, а не сокращение.
 */
function textDate(iso: string, withYear: boolean): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  const short = MONTHS_SHORT[m - 1];
  const dot = short === MONTHS[m - 1] ? "" : ".";
  return `${d} ${short.toLowerCase()}${dot}${withYear ? ` ${y}` : ""}`;
}

/** Подпись поля: словами на широком экране, числами на узком. */
function dateLabel(iso: string | null, withYear: boolean) {
  if (!iso) return undefined;
  return (
    <>
      <span className="hidden 2xl:inline">{textDate(iso, withYear)}</span>
      <span className="2xl:hidden">{numericDate(iso)}</span>
    </>
  );
}

/** «15.08.26» — компактная запись для узких окон. */
function numericDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y.slice(2)}`;
}

/**
 * Свой отрезок дат — одной дорожкой со стрелками, как месяц и год рядом.
 *
 * Прежде это были две отдельные пилюли полей с тире между ними: по виду не
 * пара, а два случайных контрола, и листать отрезок было нечем, хотя у соседа
 * стрелки есть. Теперь дорожка та же самая (`.seg-track`), а стрелки двигают
 * окно на его собственную длину: отрезок в 22 дня шагает по 22 дня.
 */
export function DateRangePicker({
  from,
  to,
  active,
  dimmed,
  size = "sm",
  onChange,
  onStepPeriod,
  onCurrent,
  atCurrent,
}: {
  from: string | null;
  to: string | null;
  /** Отрезок — действующий фильтр: дорожка подсвечивается, как у месяца. */
  active: boolean;
  /** Действует не он: дорожка приглушается, чтобы работающий контрол был виден. */
  dimmed?: boolean;
  /**
   * Чем листать вместо длины окна. У отчётного месяца шаг — соседний отчётный
   * месяц, даже когда в месяцах разное число дней; у своих дат такого якоря
   * нет, и там шагаем самой длиной отрезка.
   */
  onStepPeriod?: (dir: -1 | 1) => void;
  /**
   * Вернуться к периоду, который идёт сейчас. Кнопка гаснет, когда мы и так в
   * нём: после пары шагов назад дорога обратно была только через пресеты.
   */
  onCurrent?: () => void;
  /** Мы уже в текущем периоде — возвращаться некуда. */
  atCurrent?: boolean;
  /** Ступень: `sm` 34 — ряд общего фильтра, `md` 42 — ряд контролов раздела. */
  size?: "sm" | "md";
  onChange: (from: string | null, to: string | null) => void;
}) {
  // Листать можно только заданный отрезок: у половинки длины нет, и шагать ей
  // было бы не на что.
  const sameYear = !!from && !!to && from.slice(0, 4) === to.slice(0, 4);
  const step = from && to ? spanDays(from, to) : 0;
  const icon = size === "md" ? "seg-icon-md" : "seg-icon-sm";
  const canStep = onStepPeriod ? true : step > 0;
  const stepHint = onStepPeriod
    ? { back: "Предыдущий отчётный месяц", fwd: "Следующий отчётный месяц" }
    : step > 0
      ? { back: `Предыдущие ${step} дн.`, fwd: `Следующие ${step} дн.` }
      : { back: "Задайте обе даты, чтобы листать", fwd: "Задайте обе даты, чтобы листать" };

  const shift = (dir: -1 | 1) => {
    if (onStepPeriod) {
      onStepPeriod(dir);
      return;
    }
    if (!from || !to || step <= 0) return;
    onChange(shiftDays(from, dir * step), shiftDays(to, dir * step));
  };

  return (
    <div
      className={clsx(
        // Дорожка забирает остаток строки, а даты внутри стоят по центру своих
        // половин: прижатые к краям, они оставляли дыру посередине — растянуть
        // мало, надо ещё и выровнять.
        // Минимум под две даты со стрелками: ужиматься дальше некуда, лучше
        // перенести дорожку на следующую строку целиком.
        "seg-track flex-1 min-w-[12.5rem] max-sm:w-full max-sm:min-w-0",
        // Действующий отрезок не только обведён, но и залит: рамка одна на
        // светлом фоне читалась слабо, особенно рядом с такой же дорожкой.
        active && "!border-accent bg-accent/5",
        dimmed && "opacity-55"
      )}
    >
      <button
        type="button"
        onClick={() => shift(-1)}
        disabled={!canStep}
        className={clsx("seg-icon", icon)}
        title={stepHint.back}
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      {/* Пара дат — единой группой по ЦЕНТРУ дорожки. Растянутые на половину
          каждая, они прижимались к стрелкам, и середина зияла пустотой:
          свободное место должно лежать по краям группы, а не внутри неё. */}
      <div className="flex-1 flex items-center justify-center gap-1.5 min-w-0">
        <DateField
          value={from || ""}
          onChange={(e) => onChange(e.target.value || null, to)}
          className={clsx(
            "seg-item min-w-0",
            size === "md" ? "seg-item-md" : "seg-item-sm",
            from && (active ? "text-accent" : "text-text")
          )}
          wrapperClassName="min-w-0"
          icon={false}
          shortYear
          display={dateLabel(from, !sameYear)}
          placeholder="Начало"
        />
        <span className="text-muted text-xs shrink-0" aria-hidden="true">
          —
        </span>
        <DateField
          value={to || ""}
          onChange={(e) => onChange(from, e.target.value || null)}
          className={clsx(
            "seg-item min-w-0",
            size === "md" ? "seg-item-md" : "seg-item-sm",
            to && (active ? "text-accent" : "text-text")
          )}
          wrapperClassName="min-w-0"
          icon={false}
          shortYear
          display={dateLabel(to, true)}
          placeholder="Конец"
        />
      </div>

      <button
        type="button"
        onClick={() => shift(1)}
        disabled={!canStep}
        className={clsx("seg-icon", icon)}
        title={stepHint.fwd}
      >
        <ChevronRight className="w-4 h-4" />
      </button>

      {onCurrent && (
        <button
          type="button"
          onClick={onCurrent}
          disabled={atCurrent}
          className={clsx("seg-icon", icon)}
          title={atCurrent ? "Это текущий отчётный период" : "Вернуться к текущему отчётному периоду"}
        >
          <CalendarCheck className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
