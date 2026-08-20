import { useMemo, useState } from "react";
import { Cloud, MousePointerClick } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useDrillStore } from "../store/useDrillStore";
import { buildWordcloud, type WordcloudWord } from "../lib/aggregations";
import { formatMoney, formatNum } from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";

const PALETTE = [
  "#22D3EE",
  "#A78BFA",
  "#F59E0B",
  "#10B981",
  "#EF4444",
  "#EC4899",
  "#3B82F6",
  "#84CC16",
  "#F97316",
  "#14B8A6",
];

export function WordcloudPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const showDrill = useDrillStore((s) => s.show);

  const [minLen, setMinLen] = useState(3);
  const [topN, setTopN] = useState(120);

  const filtered = useMemo(() => applyFilters(transactions, filters, monthStartDay), [transactions, filters, monthStartDay]);
  const words = useMemo(
    () => buildWordcloud(filtered, minLen, topN),
    [filtered, minLen, topN]
  );

  if (transactions.length === 0) return <EmptyState />;

  const maxCount = words[0]?.count || 1;
  const minCount = words[words.length - 1]?.count || 1;

  function fontSize(count: number): number {
    if (maxCount === minCount) return 18;
    const t = (count - minCount) / (maxCount - minCount);
    return Math.round(12 + t * 38);
  }

  function openWord(w: WordcloudWord) {
    const escaped = w.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|\\s|[.,!?;:#-])${escaped}($|[.,!?;:\\s-])`, "iu");
    const txs = filtered.filter((t) => t.comment && re.test(t.comment));
    showDrill(`«${w.text}»`, txs, "Слово в комментариях");
  }

  const totalCommentTxs = filtered.filter((t) => t.comment && t.kind !== "transfer").length;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Cloud}
        title="Облако слов"
        hint="Самые частые слова в комментариях"
        right={
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-muted">
              <span>min длина</span>
              <input
                type="range"
                min="2"
                max="6"
                value={minLen}
                onChange={(e) => setMinLen(Number(e.target.value))}
                className="accent-accent"
              />
              <span className="tabular-nums w-4">{minLen}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted">
              <span>топ</span>
              <input
                type="range"
                min="40"
                max="300"
                step="20"
                value={topN}
                onChange={(e) => setTopN(Number(e.target.value))}
                className="accent-accent"
              />
              <span className="tabular-nums w-10">{topN}</span>
            </div>
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <MousePointerClick className="w-3.5 h-3.5" />
              Кликабельные
            </span>
          </div>
        }
      />
      <GlobalFilters />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="card-tray card-pad">
          <div className="label mb-1">Уникальных слов</div>
          <div className="stat-num">{formatNum(words.length)}</div>
        </div>
        <div className="card-tray card-pad">
          <div className="label mb-1">Операций с комментариями</div>
          <div className="stat-num">{formatNum(totalCommentTxs)}</div>
        </div>
        <div className="card-tray card-pad">
          <div className="label mb-1">Самое частое</div>
          <div className="stat-num text-accent text-xl truncate" title={words[0]?.text}>
            {words[0]?.text || "—"}
          </div>
          <div className="text-xs text-muted mt-1">
            {words[0] ? `${formatNum(words[0].count)} раз` : ""}
          </div>
        </div>
      </div>

      {words.length === 0 ? (
        <div className="card-tray card-pad text-center py-12 text-muted">
          В текущем фильтре нет комментариев или все они слишком короткие
        </div>
      ) : (
        <div className="card-tray card-pad">
          <div className="flex flex-wrap gap-2 justify-center items-center py-6">
            {words.map((w, i) => (
              <button
                key={w.text}
                onClick={() => openWord(w)}
                className="hover:bg-panel2/60 px-1.5 py-0.5 rounded transition-colors"
                style={{
                  fontSize: `${fontSize(w.count)}px`,
                  color: PALETTE[i % PALETTE.length],
                  fontWeight: fontSize(w.count) > 30 ? 700 : fontSize(w.count) > 20 ? 600 : 500,
                  lineHeight: 1.1,
                }}
                title={`«${w.text}» · ${w.count} раз · ${formatMoney(w.totalAmount, base)}`}
              >
                {w.text}
              </button>
            ))}
          </div>
        </div>
      )}

      {words.length > 0 && (
        <div className="card-tray card-pad">
          <div className="font-semibold mb-3">Топ-30 слов</div>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="table-th w-10">#</th>
                <th className="table-th">Слово</th>
                <th className="table-th text-right">Частота</th>
                <th className="table-th text-right">Сумма операций</th>
              </tr>
            </thead>
            <tbody>
              {words.slice(0, 30).map((w, i) => (
                <tr
                  key={w.text}
                  onClick={() => openWord(w)}
                  className="hover:bg-panel2/50 cursor-pointer"
                >
                  <td className="table-td text-muted">{i + 1}</td>
                  <td className="table-td font-medium">{w.text}</td>
                  <td className="table-td text-right tabular-nums">{w.count}</td>
                  <td className="table-td text-right tabular-nums text-muted">
                    {formatMoney(w.totalAmount, base)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
