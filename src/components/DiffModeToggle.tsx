import { currencySymbol } from "../lib/format";
import { DIFF_MODE_TEXT, nextDiffMode, type DiffMode } from "../lib/diffMode";

/**
 * Переключатель в шапке столбца разницы: «₽» → «%» → «₽ %» по кругу.
 *
 * Один на все такие столбцы продукта — и в `DataTable` (через `headerLead`), и
 * в таблицах на своей разметке. Подпись на кнопке — текущий режим, подсказка —
 * что сейчас и что будет по нажатию.
 */
export function DiffModeToggle({
  mode,
  onChange,
  base,
}: {
  mode: DiffMode;
  onChange: (next: DiffMode) => void;
  /** Валюта для значка денег; без неё — «₽». */
  base?: string;
}) {
  const money = base ? currencySymbol(base) : "₽";
  const next = nextDiffMode(mode);
  const hint = `Разница ${DIFF_MODE_TEXT[mode]}. Нажмите — ${DIFF_MODE_TEXT[next]}`;
  return (
    <button
      type="button"
      onClick={(e) => {
        // В шапке с сортировкой нажатие не должно пересортировать столбец.
        e.stopPropagation();
        onChange(next);
      }}
      className="normal-case rounded bg-panel2 px-1 leading-4 text-text hover:text-accent transition-colors whitespace-nowrap tabular-nums"
      title={hint}
      aria-label={hint}
    >
      {mode === "money" ? money : mode === "pct" ? "%" : `${money} %`}
    </button>
  );
}
