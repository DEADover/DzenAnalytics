// «Выгрузка годового отчёта» — выбор формата и месяца перед скачиванием.
//
// Раньше это было меню под кнопкой: два пункта и втиснутая над ними сетка
// месяцев. Формат и месяц — равноправные решения, а в меню месяц выглядел
// припиской к пунктам, и рассказать про каждый формат было негде. В окне у обоих
// есть место: формат выбирается карточкой с описанием, месяц — обычной сеткой, и
// тут же видно, какой файл получится.

import { useState } from "react";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import clsx from "clsx";
import { MONTHS } from "../lib/months";
import {
  budgetExportFileName,
  type BudgetExportFormat,
} from "../lib/budgetExportName";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "./Modal";

export type { BudgetExportFormat };

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

  return (
    <Modal onClose={onClose} busy={busy} width="lg">
      <ModalHeader
        icon={Download}
        title={`Годовой отчёт за ${year} год`}
        subtitle={<span className="block truncate">{budgetExportFileName(year, month, format)}</span>}
      />

      <ModalBody>
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
      </ModalBody>

      <ModalFooter>
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
      </ModalFooter>
    </Modal>
  );
}
