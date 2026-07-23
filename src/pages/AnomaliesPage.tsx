import { useMemo, useState } from "react";
import { AlertTriangle, Zap, TrendingUp } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useDrillStore } from "../store/useDrillStore";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { detectAnomalies, detectMonthSpikes, type Anomaly, type MonthSpike } from "../lib/aggregations";
import { SortableTable, type Column } from "../components/SortableTable";
import { PageHeader } from "../components/PageHeader";
import { GlobalFilters } from "../components/GlobalFilters";
import { formatMoney, formatDate, monthLabel } from "../lib/format";
import { affectsExpense } from "../lib/txKindStyle";
import { EmptyState } from "../components/EmptyState";
import { Stat } from "../components/Stat";

export function AnomaliesPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const showDrill = useDrillStore((s) => s.show);
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);

  const [tab, setTab] = useState<"transactions" | "spikes">("transactions");
  const [threshold, setThreshold] = useState(2.5);

  // Honour the global filters (account / currency / category / dates / search).
  // Outliers run on the fully-filtered set.
  const filtered = useMemo(
    () => applyFilters(transactions, filters, monthStartDay),
    [transactions, filters, monthStartDay]
  );
  // Month-spikes need trailing months to form a baseline, so the date filter
  // must NOT shrink their input — apply only the non-date filters, then scope
  // the SHOWN spikes to the selected window below.
  const spikesInput = useMemo(
    () => applyFilters(transactions, { ...filters, preset: "all", from: null, to: null }, monthStartDay),
    [transactions, filters, monthStartDay]
  );

  const anomalies = useMemo(() => detectAnomalies(filtered, threshold), [filtered, threshold]);

  const allSpikes = useMemo(() => detectMonthSpikes(spikesInput), [spikesInput]);
  const spikes = useMemo(() => {
    const dateActive = filters.preset !== "all" || !!filters.from || !!filters.to;
    if (!dateActive) return allSpikes;
    if (filtered.length === 0) return [];
    let minYM = "9999-99";
    let maxYM = "0000-00";
    for (const t of filtered) {
      const ym = t.date.slice(0, 7);
      if (ym < minYM) minYM = ym;
      if (ym > maxYM) maxYM = ym;
    }
    return allSpikes.filter((s) => s.ym >= minYM && s.ym <= maxYM);
  }, [allSpikes, filtered, filters.preset, filters.from, filters.to]);

  if (transactions.length === 0) return <EmptyState />;

  function openTx(id: string) {
    const tx = transactions.find((t) => t.id === id);
    if (!tx) return;
    showDrill(tx.payee || tx.categoryFull, [tx], "Аномальная операция");
  }

  function openCategoryMonth(cat: string, ym: string) {
    // Include refunds for the same category — they offset the spike
    // total shown in the row, so they belong in the drilldown list.
    const txs = spikesInput.filter(
      (t) => affectsExpense(t.kind) && t.category === cat && t.date.startsWith(ym)
    );
    showDrill(`${cat} · ${monthLabel(ym)}`, txs, "Всплеск трат");
  }

  const totalAnomalyAmount = anomalies.reduce((s, a) => s + a.tx.amountBase, 0);
  const totalSpikesDelta = spikes.reduce((s, sp) => s + sp.delta, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Zap}
        iconTone="text-warn"
        title="Аномалии"
        hint="Авто-детект необычных операций и резких всплесков по категориям. Учитывает фильтры по счетам, валютам, категориям и датам. Всплески считают базу по всей истории (с учётом фильтров, кроме дат)."
        hintWrap
        right={
          tab === "transactions" ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">Чувствительность (σ)</span>
              <input
                type="range"
                min="2"
                max="4"
                step="0.5"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="accent-accent"
              />
              <span className="text-xs tabular-nums w-8">{threshold.toFixed(1)}</span>
            </div>
          ) : undefined
        }
      />

      <GlobalFilters />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Stat
          label="Аномальных операций"
          value={anomalies.length}
          tone="warn"
          hint={<>σ &gt; {threshold}</>}
        />
        <Stat
          label="Их сумма"
          value={formatMoney(totalAnomalyAmount, base)}
          tone="expense"
        />
        <Stat
          label="Всплески по категориям"
          value={spikes.length}
          tone="warn"
          hint={<>Превышение {formatMoney(totalSpikesDelta, base)}</>}
        />
      </div>

      <div className="flex gap-2 border-b border-border">
        {(
          [
            ["transactions", "Операции-выбросы", anomalies.length],
            ["spikes", "Всплески по категориям", spikes.length],
          ] as const
        ).map(([k, l, n]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
              tab === k ? "border-accent text-accent" : "border-transparent text-muted hover:text-text"
            }`}
          >
            {l} <span className="text-muted">({n})</span>
          </button>
        ))}
      </div>

      {tab === "transactions" &&
        (anomalies.length === 0 ? (
          <div className="card card-pad text-center py-12">
            <AlertTriangle className="w-10 h-10 text-muted mx-auto mb-3" />
            <div className="font-medium mb-1">Аномалий не обнаружено</div>
            <div className="text-sm text-muted">
              Уменьшите чувствительность ниже, чтобы увидеть менее сильные выбросы
            </div>
          </div>
        ) : (
          <div className="card card-pad">
            <SortableTable<Anomaly>
              data={anomalies}
              rowKey={(a) => a.tx.id}
              defaultSortKey="zScore"
              defaultSortDir="desc"
              onRowClick={(a) => openTx(a.tx.id)}
              limit={100}
              exportName="anomalies"
              columns={
                [
                  {
                    key: "date",
                    label: "Дата",
                    sortValue: (a) => a.tx.date,
                    render: (a) => (
                      <span className="whitespace-nowrap text-muted">
                        {formatDate(a.tx.date, "full")}
                      </span>
                    ),
                  },
                  {
                    key: "payee",
                    label: "Получатель",
                    sortValue: (a) => a.tx.payee || "",
                    render: (a) => (
                      <span className="font-medium truncate max-w-[160px] inline-block" title={a.tx.payee}>
                        {a.tx.payee || "—"}
                      </span>
                    ),
                  },
                  {
                    key: "category",
                    label: "Категория",
                    sortValue: (a) => a.tx.categoryFull,
                    render: (a) => (
                      <span
                        className="truncate max-w-[140px] inline-block text-muted text-xs"
                        title={a.tx.categoryFull}
                      >
                        {a.tx.categoryFull}
                      </span>
                    ),
                  },
                  {
                    key: "context",
                    label: "Контекст",
                    sortable: false,
                    render: (a) => (
                      <div className="text-xs text-muted max-w-[300px]">
                        <div className="line-clamp-2" title={a.context}>
                          {a.context}
                        </div>
                        {a.tx.comment && (
                          <div className="text-[0.8em] mt-1 italic line-clamp-1" title={a.tx.comment}>
                            {a.tx.comment}
                          </div>
                        )}
                      </div>
                    ),
                  },
                  {
                    key: "zScore",
                    label: "σ",
                    align: "right",
                    sortValue: (a) => a.zScore,
                    render: (a) => (
                      <span className="tabular-nums text-warn font-medium">
                        {a.zScore.toFixed(1)}σ
                      </span>
                    ),
                  },
                  {
                    key: "amount",
                    label: "Сумма",
                    align: "right",
                    sortValue: (a) => a.tx.amountBase,
                    render: (a) => (
                      <span className="tabular-nums text-expense font-semibold whitespace-nowrap">
                        −{formatMoney(a.tx.amount, a.tx.currency)}
                      </span>
                    ),
                  },
                ] as Column<Anomaly>[]
              }
            />
          </div>
        ))}

      {tab === "spikes" &&
        (spikes.length === 0 ? (
          <div className="card card-pad text-center py-12">
            <TrendingUp className="w-10 h-10 text-muted mx-auto mb-3" />
            <div className="font-medium mb-1">Всплесков по категориям не найдено</div>
            <div className="text-sm text-muted">
              Категория должна вырасти минимум в 1.5× к среднему за 3 предыдущих месяца
            </div>
          </div>
        ) : (
          <div className="card card-pad">
            <SortableTable<MonthSpike>
              data={spikes}
              rowKey={(s, i) => `${s.ym}-${s.category}-${i}`}
              defaultSortKey="delta"
              defaultSortDir="desc"
              onRowClick={(s) => openCategoryMonth(s.category, s.ym)}
              exportName="month_spikes"
              columns={
                [
                  {
                    key: "ym",
                    label: "Месяц",
                    sortValue: (s) => s.ym,
                    render: (s) => (
                      <span className="whitespace-nowrap font-medium">{monthLabel(s.ym)}</span>
                    ),
                  },
                  {
                    key: "category",
                    label: "Категория",
                    sortValue: (s) => s.category,
                    render: (s) => s.category,
                  },
                  {
                    key: "baseline",
                    label: "База (3 мес ср.)",
                    align: "right",
                    sortValue: (s) => s.baseline,
                    render: (s) => (
                      <span className="tabular-nums text-muted">
                        {formatMoney(s.baseline, base)}
                      </span>
                    ),
                  },
                  {
                    key: "current",
                    label: "Факт",
                    align: "right",
                    sortValue: (s) => s.current,
                    render: (s) => (
                      <span className="tabular-nums text-expense">
                        {formatMoney(s.current, base)}
                      </span>
                    ),
                  },
                  {
                    key: "delta",
                    label: "Превышение",
                    align: "right",
                    sortValue: (s) => s.delta,
                    render: (s) => (
                      <span className="tabular-nums text-warn font-medium">
                        +{formatMoney(s.delta, base)}
                      </span>
                    ),
                  },
                  {
                    key: "ratio",
                    label: "×",
                    align: "right",
                    sortValue: (s) => s.ratio,
                    render: (s) => (
                      <span className="tabular-nums text-warn font-bold">
                        {s.ratio.toFixed(1)}×
                      </span>
                    ),
                  },
                ] as Column<MonthSpike>[]
              }
            />
          </div>
        ))}
    </div>
  );
}
