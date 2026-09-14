// «Выгрузка в Excel» — настройки перед скачиванием отчёта «Доходы и расходы».
//
// Раньше переключатель формата сумм жил прямо в строке над таблицей и занимал
// место у того, что к самой таблице не относится: выгрузка — разовое действие,
// а её настройка висела на экране постоянно. Здесь же видно и то, чего в строке
// не помещалось: в какой валюте уйдут суммы и как именно они будут выглядеть.

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "./Modal";
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

  return (
    <Modal onClose={onClose} busy={busy} width="md">
      <ModalHeader
        icon={Download}
        title="Выгрузка в Excel"
        subtitle={<span className="block truncate" title={fileName}>{fileName}</span>}
      />

    <ModalBody>
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
      </ModalBody>

      <ModalFooter>
        <button type="button" className="btn-ghost text-sm" onClick={onClose} disabled={busy}>
          Отмена
        </button>
        <button type="button" className="btn-primary text-sm" onClick={run} disabled={busy}>
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
          ) : (
            <Download className="w-4 h-4" aria-hidden />
          )}
          Скачать
        </button>
      </ModalFooter>
    </Modal>
  );
}
