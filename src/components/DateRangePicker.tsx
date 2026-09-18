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
  size = "sm",
  onChange,
}: {
  from: string | null;
  to: string | null;
  /** Отрезок — действующий фильтр: дорожка подсвечивается, как у месяца. */
  active: boolean;
  /** Ступень: `sm` 34 — ряд общего фильтра, `md` 42 — ряд контролов раздела. */
  size?: "sm" | "md";
  onChange: (from: string | null, to: string | null) => void;
}) {
  // Листать можно только заданный отрезок: у половинки длины нет, и шагать ей
  // было бы не на что.
  const step = from && to ? spanDays(from, to) : 0;
  const icon = size === "md" ? "seg-icon-md" : "seg-icon-sm";

  const shift = (dir: -1 | 1) => {
    if (!from || !to || step <= 0) return;
    onChange(shiftDays(from, dir * step), shiftDays(to, dir * step));
  };

  return (
    <div
      className={clsx(
        // Базис — желаемая ширина, но сжиматься дорожка обязана: на узком
        // окне она иначе выталкивала соседей за край.
        "seg-track flex-1 basis-56 min-w-0 max-sm:w-full",
        active && "!border-accent"
      )}
    >
      <button
        type="button"
        onClick={() => shift(-1)}
        disabled={step <= 0}
        className={clsx("seg-icon", icon)}
        title={step > 0 ? `Предыдущие ${step} дн.` : "Задайте обе даты, чтобы листать"}
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      <DateField
        value={from || ""}
        onChange={(e) => onChange(e.target.value || null, to)}
        className={clsx(
          "seg-item flex-1 min-w-0",
          size === "md" ? "seg-item-md" : "seg-item-sm",
          from && "text-text"
        )}
        wrapperClassName="flex-1 min-w-0"
        icon={false}
        centered
        placeholder="Начало"
      />
      <span className="text-muted text-xs px-0.5 shrink-0" aria-hidden="true">
        —
      </span>
      <DateField
        value={to || ""}
        onChange={(e) => onChange(from, e.target.value || null)}
        className={clsx(
          "seg-item flex-1 min-w-0",
          size === "md" ? "seg-item-md" : "seg-item-sm",
          to && "text-text"
        )}
        wrapperClassName="flex-1 min-w-0"
        icon={false}
        centered
        placeholder="Конец"
      />

      <button
        type="button"
        onClick={() => shift(1)}
        disabled={step <= 0}
        className={clsx("seg-icon", icon)}
        title={step > 0 ? `Следующие ${step} дн.` : "Задайте обе даты, чтобы листать"}
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
