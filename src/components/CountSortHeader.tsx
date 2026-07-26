import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import clsx from "clsx";

/** Row order for the Справочники tables: alphabetical by default, or by
 *  operation count either way. */
export type SortMode = "title" | "count-desc" | "count-asc";

/**
 * «Операций» column header that doubles as a sort toggle, cycling
 * off → ↓ (most first) → ↑ (fewest first) → off. Shared by the Категории and
 * Контрагенты tables so both sort the same way.
 */
export function CountSortHeader({
  sort,
  onChange,
  className,
}: {
  sort: SortMode;
  onChange: (next: SortMode) => void;
  className?: string;
}) {
  const next: SortMode =
    sort === "count-desc" ? "count-asc" : sort === "count-asc" ? "title" : "count-desc";
  const Icon =
    sort === "count-desc" ? ArrowDown : sort === "count-asc" ? ArrowUp : ArrowUpDown;
  return (
    <button
      onClick={() => onChange(next)}
      title={
        sort === "count-desc"
          ? "Сначала с наименьшим числом операций"
          : sort === "count-asc"
            ? "Вернуть сортировку по алфавиту"
            : "Сначала с наибольшим числом операций"
      }
      className={clsx(
        "inline-flex items-center justify-center gap-1 uppercase tracking-wide hover:text-accent",
        sort !== "title" && "text-accent",
        className
      )}
    >
      Операций
      <Icon className="w-3 h-3 shrink-0" />
    </button>
  );
}
