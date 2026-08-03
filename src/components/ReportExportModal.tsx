// «Выгрузка в Excel» — настройки перед скачиванием отчёта «Доходы и расходы».
//
// Раньше переключатель формата сумм жил прямо в строке над таблицей и занимал
// место у того, что к самой таблице не относится: выгрузка — разовое действие,
// а её настройка висела на экране постоянно. Здесь же видно и то, чего в строке
// не помещалось: в какой валюте уйдут суммы и как именно они будут выглядеть.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Loader2, X } from "lucide-react";
import { Segmented } from "./Segmented";
import { currencySymbol } from "../lib/format";
import {
  NUMBER_STYLE_LABELS,
  type XlsxNumberStyle,
} from "../lib/categoryReportXlsx";

interface Props {
  /** Базовая валюта сервиса — в ней уходят все суммы отчёта. */
  baseCurrency: string;
  /** Имя файла, который получит пользователь, — показываем как есть. */
  fileName: string;
  /** Скачать. Модалка сама держит состояние ожидания и закрывается по успеху. */
  onExport: (style: XlsxNumberStyle) => Promise<void>;
  onClose: () => void;
}

/** Как сумма будет выглядеть в ячейке при выбранном формате. */
function preview(style: XlsxNumberStyle, baseCurrency: string): string {
  const number = "1 234,00";
  return style === "plain" ? number : `${number} ${currencySymbol(baseCurrency)}`;
}

export function ReportExportModal({
  baseCurrency,
  fileName,
  onExport,
  onClose,
}: Props) {
  const [style, setStyle] = useState<XlsxNumberStyle>("money");
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
      await onExport(style);
      onClose();
    } catch {
      // Провал выгрузки разбирает вызывающая сторона — она же показывает диалог
      // с объяснением. Окно оставляем открытым: человек может сменить формат и
      // попробовать снова, не проходя путь до кнопки заново.
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
        aria-labelledby="report-export-title"
        className="w-full max-w-md rounded-2xl border border-border bg-panel shadow-2xl outline-none"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border rounded-t-2xl">
          <div className="flex items-center gap-2 min-w-0">
            <span className="p-1.5 rounded-lg bg-accent/10 text-accent shrink-0">
              <Download className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <div id="report-export-title" className="font-semibold">
                Выгрузка в Excel
              </div>
              <div className="text-xs text-muted truncate" title={fileName}>
                {fileName}
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
            <div className="label mb-2">Суммы</div>
            <Segmented
              value={style}
              onChange={setStyle}
              label="Формат сумм в выгрузке"
              options={[
                { value: "money" as XlsxNumberStyle, label: NUMBER_STYLE_LABELS.money },
                { value: "plain" as XlsxNumberStyle, label: NUMBER_STYLE_LABELS.plain },
              ]}
            />
            <p className="text-xs text-muted mt-2">
              В ячейке будет{" "}
              <span className="tabular-nums text-text">
                {preview(style, baseCurrency)}
              </span>
              .{" "}
              {style === "plain"
                ? "Обычное число — удобно тащить в свои формулы и сводные таблицы."
                : "Со знаком валюты — как на экране."}
            </p>
          </div>

          <div className="rounded-xl bg-panel2 border border-border px-3 py-2.5 text-xs text-muted">
            Суммы уходят <span className="text-text">числами</span>, а не текстом,
            — по ним сразу считаются формулы и строятся диаграммы. Валюта —{" "}
            <span className="text-text">{baseCurrency}</span>, базовая в
            настройках сервиса.
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button type="button" className="btn-ghost text-sm" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button type="button" className="btn text-sm" onClick={run} disabled={busy}>
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
            ) : (
              <Download className="w-4 h-4" aria-hidden />
            )}
            Скачать
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
