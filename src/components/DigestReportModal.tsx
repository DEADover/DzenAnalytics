import { useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileCode2, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { usePeriodReport, type ReportSpec } from "../hooks/usePeriodReport";
import { formatDate } from "../lib/format";
import { PERIOD_REPORT_CSS } from "../lib/periodReportCss";
import { usePrivacyStore } from "../store/usePrivacyStore";
import { toast } from "../store/useToastStore";
import { FormatChoice, type FormatOption } from "./FormatChoice";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "./Modal";
import { PeriodReportDocument } from "./report/PeriodReportDocument";

type ReportFormat = "pdf" | "html" | "xlsx";

const FORMATS: FormatOption<ReportFormat>[] = [
  {
    value: "pdf",
    label: "PDF",
    icon: FileText,
    what: "Листы A4 — для печати и пересылки",
  },
  {
    value: "html",
    label: "HTML",
    icon: FileCode2,
    what: "Страница одним файлом — откроется в браузере без интернета, суммы по наведению",
  },
  {
    value: "xlsx",
    label: "Excel",
    icon: FileSpreadsheet,
    what: "Разделы таблицами на своих листах — суммы числами, можно считать",
  },
];

const FORMAT_LABEL: Record<ReportFormat, string> = { pdf: "PDF", html: "HTML", xlsx: "Excel" };

/** Сколько ждать, пока листы отчёта разложатся, прежде чем снимать их. */
const LAYOUT_WAIT_MS = 4000;

async function waitForPages(host: HTMLElement): Promise<HTMLElement> {
  const start = performance.now();
  for (;;) {
    const page = host.querySelector<HTMLElement>("[data-report-page]");
    const root = page?.closest<HTMLElement>(".pr-doc");
    if (root) return root;
    if (performance.now() - start > LAYOUT_WAIT_MS) throw new Error("Листы отчёта не собрались");
    await new Promise((r) => requestAnimationFrame(r));
  }
}

/**
 * «Отчёт» в «Дайджесте»: выбрать формат и скачать отчёт за выбранный там
 * период.
 *
 * Пока окно открыто, листы отчёта нарисованы за краем экрана: PDF снимает их
 * картинками, HTML забирает разметку — на экране видно только окно. Закрыли
 * — листы исчезают и не пересчитываются при каждом шаге по «Дайджесту».
 */
export function DigestReportModal({ spec, onClose }: { spec: ReportSpec; onClose: () => void }) {
  const report = usePeriodReport(spec);
  const hideAmounts = usePrivacyStore((s) => s.hideAmounts);
  const [format, setFormat] = useState<ReportFormat>("pdf");
  const [busy, setBusy] = useState(false);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [generated] = useState(() => formatDate(new Date().toISOString().slice(0, 10), "full"));

  async function run() {
    if (busy || !host || !report) return;
    setBusy(true);
    try {
      const { downloadReportHtml, downloadReportPdf, reportFileName } = await import("../lib/periodReportExport");
      const name = reportFileName(report.range.from, report.range.to, format);
      const title = `Отчёт — ${report.title}`;
      if (format === "xlsx") {
        // Таблицы собираются из модели отчёта — листы для снимка не нужны.
        const { downloadReportXlsx } = await import("../lib/periodReportXlsx");
        await downloadReportXlsx(report, generated, name);
      } else {
        const root = await waitForPages(host);
        if (format === "pdf") await downloadReportPdf(root, name, title);
        else await downloadReportHtml(root, name, title);
      }
      onClose();
    } catch (e) {
      console.error(e);
      toast(`Отчёт не выгрузился в ${FORMAT_LABEL[format]}. Попробуйте ещё раз, а если повторится — обновите страницу.`, {
        tone: "err",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal onClose={onClose} busy={busy} width="2xl">
        <ModalHeader icon={FileText} title={`Отчёт за ${spec.kind === "month" ? spec.title.toLowerCase() : spec.title.replace(/^Неделя/, "неделю")}`} subtitle={report?.dates} />
        <ModalBody>
          <p className="text-sm text-muted">
            Итоги периода с главным одной фразой и сравнением с обычным, движение денег, траты по дням, куда ушли
            деньги и что изменилось, кому заплатили впервые, крупные траты, счета
            {spec.kind === "month" ? ", бюджет" : ""} и наблюдения.
          </p>
          <FormatChoice options={FORMATS} value={format} onChange={setFormat} disabled={busy} />
          {hideAmounts && (
            <p className="text-xs text-warn" data-report-blocked>
              Суммы скрыты — выключите «Скрыть суммы» (H), чтобы скачать отчёт.
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <button type="button" className="btn-ghost text-sm" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button
            type="button"
            className="btn-primary text-sm"
            onClick={() => void run()}
            disabled={busy || hideAmounts || !report}
            data-report-download
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Download className="w-4 h-4" aria-hidden />}
            {busy ? "Собираем…" : "Скачать"}
          </button>
        </ModalFooter>
      </Modal>
      {report &&
        createPortal(
          <div
            ref={setHost}
            aria-hidden
            data-report-offscreen
            style={{ position: "fixed", left: -20000, top: 0, pointerEvents: "none" }}
          >
            <style>{PERIOD_REPORT_CSS}</style>
            <PeriodReportDocument report={report} generated={generated} />
          </div>,
          document.body
        )}
    </>
  );
}
