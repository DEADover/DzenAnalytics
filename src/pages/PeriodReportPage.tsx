import { useLayoutEffect, useRef, useState } from "react";
import { Download, FileCode2, FileText, Loader2 } from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { GlobalFilters } from "../components/GlobalFilters";
import { InfoPopover, InfoTerm } from "../components/InfoPopover";
import { PageHeader } from "../components/PageHeader";
import { SectionControls } from "../components/SectionControls";
import { Tooltip } from "../components/Tooltip";
import { PeriodReportDocument } from "../components/report/PeriodReportDocument";
import { usePeriodReport } from "../hooks/usePeriodReport";
import { formatDate } from "../lib/format";
import { PERIOD_REPORT_CSS, SHEET_W } from "../lib/periodReportCss";
import { useDataStore } from "../store/useDataStore";
import { usePrivacyStore } from "../store/usePrivacyStore";
import { toast } from "../store/useToastStore";

/**
 * «Отчёт за период»: листы отчёта на экране такими, какими они уйдут в файл,
 * и выгрузка в PDF и HTML. Период и фильтры — общие, сверху страницы.
 */
export function PeriodReportPage() {
  const hasData = useDataStore((s) => s.transactions.length > 0);
  const report = usePeriodReport();
  const hideAmounts = usePrivacyStore((s) => s.hideAmounts);
  const docRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  /** Высота стопки листов до масштаба — под неё подгоняем место на странице. */
  const [docH, setDocH] = useState(0);
  const [busy, setBusy] = useState<"pdf" | "html" | null>(null);
  const hasReport = report !== null;
  const [generated] = useState(() => formatDate(new Date().toISOString().slice(0, 10), "full"));

  // Лист A4 шире колонки на ноутбуке — превью ужимаем целиком, не трогая сам
  // лист: в файл уходит он в настоящую величину.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const fit = () => {
      setScale(Math.min(1, box.clientWidth / SHEET_W));
      setDocH(docRef.current?.offsetHeight ?? 0);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    if (docRef.current) ro.observe(docRef.current);
    return () => ro.disconnect();
  }, [hasData, hasReport]);

  if (!hasData) return <EmptyState />;

  const run = async (kind: "pdf" | "html") => {
    const root = docRef.current?.querySelector<HTMLElement>(".pr-doc");
    if (!root || !report) return;
    setBusy(kind);
    try {
      const { downloadReportHtml, downloadReportPdf, reportFileName } = await import("../lib/periodReportExport");
      const name = reportFileName(report.range.from, report.range.to, kind);
      const title = `Отчёт за период — ${report.title}`;
      if (kind === "pdf") await downloadReportPdf(root, name, title);
      else await downloadReportHtml(root, name, title);
    } catch (e) {
      console.error(e);
      toast(
        kind === "pdf"
          ? "Отчёт не выгрузился в PDF. Попробуйте ещё раз, а если повторится — обновите страницу."
          : "Отчёт не выгрузился в HTML. Попробуйте ещё раз, а если повторится — обновите страницу.",
        { tone: "err" }
      );
    } finally {
      setBusy(null);
    }
  };
  const blocked = hideAmounts
    ? "Суммы скрыты — выключите «Скрыть суммы» (H), чтобы выгрузить отчёт"
    : null;

  const button = (kind: "pdf" | "html", label: string, hint: string) => (
    <Tooltip content={blocked ?? hint}>
      <button
        type="button"
        className="btn-ghost"
        onClick={() => void run(kind)}
        disabled={!report || !!blocked || busy !== null}
        aria-label={`Скачать ${label}`}
        data-report-export={kind}
      >
        {busy === kind ? (
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
        ) : kind === "pdf" ? (
          <Download className="w-4 h-4" aria-hidden />
        ) : (
          <FileCode2 className="w-4 h-4" aria-hidden />
        )}
        {label}
      </button>
    </Tooltip>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={FileText}
        title="Отчёт за период"
        info={
          <InfoPopover>
            <p>
              Итоги выбранного периода одним документом: доходы и расходы со
              сравнением к прошлому такому же периоду, движение денег, куда ушли
              деньги, крупные траты, счета, бюджет и наблюдения. Период, счета и
              категории — из <InfoTerm>общего фильтра</InfoTerm> сверху.
            </p>
            <p>
              <InfoTerm>PDF</InfoTerm> — листы A4 для печати и пересылки.{" "}
              <InfoTerm>HTML</InfoTerm> — тот же отчёт веб-страницей одним файлом:
              открывается в любом браузере без сервиса и без интернета, текст в
              нём ищется, а у столбцов графика по наведению видны суммы.
            </p>
            <p>
              Числа — те же, что в разделах: итоги как в «Cash-flow», категории как
              в «Категориях», бюджет — по правилам «Бюджетов».
            </p>
          </InfoPopover>
        }
      />
      <SectionControls>
        {button("pdf", "PDF", "Скачать отчёт листами A4 в PDF")}
        {button("html", "HTML", "Скачать отчёт веб-страницей одним файлом")}
      </SectionControls>
      <GlobalFilters />

      <style>{PERIOD_REPORT_CSS}</style>
      <div ref={boxRef} className="w-full" data-report-preview>
        {report ? (
          <div
            className="mx-auto"
            style={{
              width: SHEET_W * scale,
              height: docH > 0 ? docH * scale : undefined,
            }}
          >
            <div
              ref={docRef}
              className="[&_.pr-doc]:flex [&_.pr-doc]:flex-col [&_.pr-doc]:gap-6 [&_.pr-page]:rounded-md [&_.pr-page]:shadow-[0_1px_3px_rgba(16,24,40,.08),0_12px_32px_rgba(16,24,40,.10)] [&_.pr-page]:ring-1 [&_.pr-page]:ring-black/5"
              style={{ width: SHEET_W, transform: `scale(${scale})`, transformOrigin: "top left" }}
            >
              <PeriodReportDocument report={report} generated={generated} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">За выбранный период операций нет — выберите другой период в фильтре.</p>
        )}
      </div>
    </div>
  );
}
