import { SortButton } from "./table/TableParts";

/** Row order for the Справочники tables: alphabetical by default, or by
 *  operation count either way. */
export type SortMode = "title" | "count-desc" | "count-asc";

/**
 * «Операций» — сортируемая шапка справочников категорий и контрагентов.
 *
 * Вид — общий для всех таблиц (`SortButton`): ↕ в покое, стрелка у активной.
 * Порядок кликов свой, на три состояния: больше операций сверху → меньше
 * сверху → снова по алфавиту. По алфавиту — порядок справочника по умолчанию,
 * и вернуться к нему нужно без отдельной шапки у названия.
 */
export function CountSortHeader({
  sort,
  onChange,
}: {
  sort: SortMode;
  onChange: (next: SortMode) => void;
}) {
  const next: SortMode =
    sort === "count-desc" ? "count-asc" : sort === "count-asc" ? "title" : "count-desc";
  return (
    <SortButton
      label="Операций"
      sort={{
        active: sort !== "title",
        dir: sort === "count-asc" ? "asc" : "desc",
        onToggle: () => onChange(next),
      }}
    />
  );
}
