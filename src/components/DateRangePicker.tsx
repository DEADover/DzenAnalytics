import { ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { DateField } from "./DateField";
import { shiftDays, spanDays } from "../lib/period";

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
  /** Ступень: `sm` 34 — ряд общего фильтра, `md` 42 — ряд контролов раздела. */
  size?: "sm" | "md";
  onChange: (from: string | null, to: string | null) => void;
}) {
  // Листать можно только заданный отрезок: у половинки длины нет, и шагать ей
  // было бы не на что.
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
        "seg-track flex-1 min-w-0 max-sm:w-full",
        active && "!border-accent",
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
            from && "text-text"
          )}
          wrapperClassName="min-w-0"
          icon={false}
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
            to && "text-text"
          )}
          wrapperClassName="min-w-0"
          icon={false}
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
    </div>
  );
}
