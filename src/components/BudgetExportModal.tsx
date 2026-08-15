// «Выгрузка годового отчёта» — выбор формата и месяца перед скачиванием.
//
// Раньше это было меню под кнопкой: два пункта и втиснутая над ними сетка
// месяцев. Формат и месяц — равноправные решения, а в меню месяц выглядел
// припиской к пунктам, и рассказать про каждый формат было негде. В окне у обоих
// есть место: формат выбирается карточкой с описанием, месяц — обычной сеткой, и
// тут же видно, какой файл получится.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileSpreadsheet, FileText, Loader2, X } from "lucide-react";
import clsx from "clsx";

export type BudgetExportFormat = "xlsx" | "pdf";

/** Месяцы по-русски. Полными словами: в окне для них есть место. */
export const MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

interface Props {
  year: number;
  /** Месяц отчёта, 0…11. Живёт СНАРУЖИ: по нему же строится печатная вёрстка,
   *  которую снимает выгрузка в PDF, и к моменту скачивания она должна быть
   *  перерисована. */
  month: number;
  onMonthChange: (m: number) => void;
  /** Скачать. Окно само держит ожидание и закрывается по успеху. */
  onExport: (format: BudgetExportFormat) => Promise<void>;
  onClose: () => void;
}

/** Имя файла, который получит пользователь. */
export function budgetExportFileName(
  year: number,
  month: number,
  format: BudgetExportFormat
): string {
  // У PDF месяц в имени: лист нарисован по одному месяцу, и без него два отчёта
  // за разные месяцы одного года различались бы только цифрами внутри. В Excel
  // лежат все двенадцать, там месяц в имени соврал бы.
  return format === "xlsx"
    ? `Бюджет-${year}.xlsx`
    : `Бюджет-${year}-${MONTHS[month].toLowerCase()}.pdf`;
}

const FORMATS: {
  value: BudgetExportFormat;
  label: string;
  icon: typeof FileText;
  what: string;
}[] = [
  {
    value: "xlsx",
    label: "Excel",
    icon: FileSpreadsheet,
    what: "Четыре листа: сводка с диаграммами, помесячная таблица, сравнение с прошлым годом и исходные числа",
  },
  {
    value: "pdf",
    label: "PDF",
    icon: FileText,
    what: "Сводка альбомным листом, а разрезы по статьям — книжными: расходы, доходы и переводы каждый со своей страницы",
  },
];

export function BudgetExportModal({
  year,
  month,
  onMonthChange,
  onExport,
  onClose,
}: Props) {
  const [format, setFormat] = useState<BudgetExportFormat>("xlsx");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      await onExport(format);
      onClose();
    } catch {
      // Провал разбирает вызывающая сторона — она же объясняет, что случилось.
      // Окно оставляем открытым: можно сменить формат и попробовать снова.
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="budget-export-title"
        className="w-full max-w-lg rounded-2xl border border-border bg-panel shadow-2xl outline-none"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border rounded-t-2xl">
          <div className="flex items-center gap-2 min-w-0">
            <span className="p-1.5 rounded-lg bg-accent/10 text-accent shrink-0">
              <Download className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <div id="budget-export-title" className="font-semibold">
                Годовой отчёт за {year}
              </div>
              <div className="text-xs text-muted truncate">
                {budgetExportFileName(year, month, format)}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-muted hover:text-text shrink-0 disabled:opacity-40"
            aria-label="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <div className="label mb-2">Формат</div>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Формат">
              {FORMATS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  role="radio"
                  aria-checked={f.value === format}
                  onClick={() => setFormat(f.value)}
                  disabled={busy}
                  className={clsx(
                    "rounded-xl border p-3 text-left transition-colors disabled:opacity-60",
                    f.value === format
                      ? "border-accent bg-accent/5"
                      : "border-border hover:bg-panel2"
                  )}
                >
                  <span
                    className={clsx(
                      "flex items-center gap-2 font-medium",
                      f.value === format ? "text-accent" : "text-text"
                    )}
                  >
                    <f.icon className="w-4 h-4 shrink-0" />
                    {f.label}
                  </span>
                  <span className="block text-xs text-muted mt-1.5">{f.what}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Месяц — только у PDF. В книге он переключается прямо на листе
              «Дашборд», и выбирать его заранее не нужно: там лежат все
              двенадцать месяцев. */}
          {format === "pdf" && (
            <div>
              <div className="label mb-1">Месяц отчёта</div>
              <p className="text-xs text-muted mb-2">
                Задаёт показатели «за месяц» и отрезок «с начала года».
              </p>
              <div className="grid grid-cols-4 gap-1.5">
                {MONTHS.map((name, i) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => onMonthChange(i)}
                    disabled={busy}
                    aria-pressed={i === month}
                    className={clsx(
                      "rounded-lg border px-1 py-1.5 text-xs transition-colors disabled:opacity-60",
                      i === month
                        ? "border-accent bg-accent/10 text-accent font-medium"
                        : "border-transparent text-muted hover:bg-panel2"
                    )}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            type="button"
            className="btn-ghost text-sm"
            onClick={onClose}
            disabled={busy}
          >
            Отмена
          </button>
          <button type="button" className="btn-primary text-sm" onClick={run} disabled={busy}>
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
            ) : (
              <Download className="w-4 h-4" aria-hidden />
            )}
            {busy ? "Собираем…" : "Скачать"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
