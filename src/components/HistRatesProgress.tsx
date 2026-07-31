import { Loader2, TriangleAlert, X } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { resetMirrorProbe } from "../lib/historicalRates";
import { pluralRu } from "../lib/plural";

/**
 * Small fixed chip in the corner, with two faces.
 *
 * While CBR historical rates warm in the background it shows progress:
 * analytics already render (at sync-time rates) and snap to the historical
 * values once this finishes — the chip just explains the brief shift.
 *
 * If the warm ended with dates unresolved (сервис курсов не ответил), it turns
 * into a warning with a retry. Раньше о такой неудаче можно было узнать только
 * из консоли браузера — суммы просто молча считались по текущему курсу
 * (issue #53).
 *
 * Idle and nothing to report → renders nothing.
 */
export function HistRatesProgress() {
  const warming = useDataStore((s) => s.histWarming);
  const unavailable = useDataStore((s) => s.histRatesUnavailable);
  const warm = useDataStore((s) => s.warmHistoricalRates);
  const dismiss = useDataStore((s) => s.dismissHistRatesWarning);

  if (warming) {
    const { done, total } = warming;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return (
      <Chip>
        <Loader2 className="w-4 h-4 text-accent animate-spin shrink-0" aria-hidden />
        <div className="flex flex-col leading-tight">
          <span>Загружаю курсы ЦБ на даты операций</span>
          <span className="text-muted tabular-nums">
            {done} / {total} ({pct}%)
          </span>
        </div>
      </Chip>
    );
  }

  if (unavailable > 0) {
    return (
      <Chip>
        <TriangleAlert className="w-4 h-4 text-warn shrink-0" aria-hidden />
        <div className="flex flex-col leading-tight gap-1">
          <span>Курсы ЦБ загрузились не полностью</span>
          <span className="text-muted">
            Сервис курсов не ответил на {unavailable}{" "}
            {pluralRu(unavailable, ["дату", "даты", "дат"])}. Операции в валюте за эти дни посчитаны по
            текущему курсу.
          </span>
          <button
            type="button"
            className="self-start mt-0.5 text-accent hover:underline"
            onClick={() => {
              dismiss();
              resetMirrorProbe();
              void warm();
            }}
          >
            Попробовать снова
          </button>
        </div>
        <button
          type="button"
          className="shrink-0 self-start text-muted hover:text-text"
          onClick={dismiss}
          title="Закрыть"
          aria-label="Закрыть"
        >
          <X className="w-3.5 h-3.5" aria-hidden />
        </button>
      </Chip>
    );
  }

  return null;
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex items-start gap-2.5 rounded-lg border border-border bg-panel shadow-lg px-3 py-2 text-xs text-text max-w-xs"
      role="status"
      aria-live="polite"
    >
      {children}
    </div>
  );
}
