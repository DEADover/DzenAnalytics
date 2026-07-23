import { useMemo, useState } from "react";
import { ArrowRight, ArrowUpRight, ArrowDownRight, Minus, GitCompare } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { useDataStore } from "../store/useDataStore";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useDrillStore } from "../store/useDrillStore";
import { computeKPI, groupByCategory } from "../lib/aggregations";
import { affectsExpense } from "../lib/txKindStyle";
import {
  formatMoney,
  formatPct,
  formatDate,
  formatNum,
  toNum,
  chartTooltipProps,
  chartGridStroke,
  chartAxisStroke,
} from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { periodKey, periodRange, shiftPeriod } from "../lib/period";
import { DateField } from "../components/DateField";
import type { Transaction } from "../types";

/** Same logic as `periodKey` but accepts a Date instead of an ISO string. */
function periodKeyFromDate(d: Date, startDay: number): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return periodKey(`${yyyy}-${mm}-${dd}`, startDay);
}

type Preset = "this_vs_prev_month" | "ytd_vs_prev_ytd" | "last_30_vs_prev_30" | "last_90_vs_prev_90" | "custom";

interface Range {
  from: string;
  to: string;
  label: string;
}

function rangeOf(
  preset: Preset,
  maxDate: string,
  monthStartDay: number = 1
): { a: Range; b: Range } {
  const max = new Date(maxDate);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);

  if (preset === "this_vs_prev_month") {
    // Respect the user's reporting period. The "current month" is the
    // billing period the latest transaction falls into; "previous month"
    // is one billing period earlier.
    const curYM = periodKeyFromDate(max, monthStartDay);
    const prevYM = shiftPeriod(curYM, -1);
    const aRange = periodRange(curYM, monthStartDay);
    const bRange = periodRange(prevYM, monthStartDay);
    const labelFor = (ym: string) => {
      const [y, m] = ym.split("-").map(Number);
      return new Date(y, m - 1, 1).toLocaleDateString("ru-RU", {
        month: "long",
        year: "numeric",
      });
    };
    return {
      a: { from: aRange.from, to: ymd(max) < aRange.to ? ymd(max) : aRange.to, label: labelFor(curYM) },
      b: { from: bRange.from, to: bRange.to, label: labelFor(prevYM) },
    };
  }
  if (preset === "ytd_vs_prev_ytd") {
    const aFrom = new Date(max.getFullYear(), 0, 1);
    const aTo = max;
    const bFrom = new Date(max.getFullYear() - 1, 0, 1);
    const bTo = new Date(max.getFullYear() - 1, max.getMonth(), max.getDate());
    return {
      a: { from: ymd(aFrom), to: ymd(aTo), label: `${max.getFullYear()} YTD` },
      b: { from: ymd(bFrom), to: ymd(bTo), label: `${max.getFullYear() - 1} YTD` },
    };
  }
  if (preset === "last_30_vs_prev_30") {
    const aFrom = new Date(max);
    aFrom.setDate(aFrom.getDate() - 29);
    const bTo = new Date(aFrom);
    bTo.setDate(bTo.getDate() - 1);
    const bFrom = new Date(bTo);
    bFrom.setDate(bFrom.getDate() - 29);
    return {
      a: { from: ymd(aFrom), to: ymd(max), label: "Последние 30 дней" },
      b: { from: ymd(bFrom), to: ymd(bTo), label: "Предыдущие 30 дней" },
    };
  }
  if (preset === "last_90_vs_prev_90") {
    const aFrom = new Date(max);
    aFrom.setDate(aFrom.getDate() - 89);
    const bTo = new Date(aFrom);
    bTo.setDate(bTo.getDate() - 1);
    const bFrom = new Date(bTo);
    bFrom.setDate(bFrom.getDate() - 89);
    return {
      a: { from: ymd(aFrom), to: ymd(max), label: "Последние 90 дней" },
      b: { from: ymd(bFrom), to: ymd(bTo), label: "Предыдущие 90 дней" },
    };
  }
  return {
    a: { from: ymd(max), to: ymd(max), label: "А" },
    b: { from: ymd(max), to: ymd(max), label: "Б" },
  };
}

function inRange(t: Transaction, r: Range): boolean {
  return t.date >= r.from && t.date <= r.to;
}

function Delta({ a, b, invert = false }: { a: number; b: number; invert?: boolean }) {
  if (b === 0 && a === 0)
    return (
      <span className="text-muted text-xs flex items-center gap-1">
        <Minus className="w-3 h-3" /> 0
      </span>
    );
  const diff = a - b;
  const pct = b !== 0 ? diff / Math.abs(b) : null;
  const positive = invert ? diff < 0 : diff > 0;
  const tone = positive ? "text-income" : diff === 0 ? "text-muted" : "text-expense";
  const Icon = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus;
  return (
    <span className={`text-xs flex items-center gap-1 tabular-nums ${tone}`}>
      <Icon className="w-3 h-3" />
      {pct !== null ? formatPct(pct, 1) : `${diff >= 0 ? "+" : ""}${formatNum(diff)}`}
    </span>
  );
}

export function ComparePage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const filters = useFiltersStore();

  const [preset, setPreset] = useState<Preset>("this_vs_prev_month");
  const [customA, setCustomA] = useState<Range>({ from: "", to: "", label: "Период А" });
  const [customB, setCustomB] = useState<Range>({ from: "", to: "", label: "Период Б" });

  const filtered = useMemo(
    () =>
      applyFilters(transactions, { ...filters, preset: "all", from: null, to: null }),
    [transactions, filters]
  );

  const maxDate = useMemo(
    () => filtered.reduce((m, t) => (t.date > m ? t.date : m), ""),
    [filtered]
  );

  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const ranges = useMemo<{ a: Range; b: Range }>(() => {
    if (preset === "custom") {
      return {
        a: { ...customA, label: customA.label || "Период А" },
        b: { ...customB, label: customB.label || "Период Б" },
      };
    }
    return rangeOf(
      preset,
      maxDate || new Date().toISOString().slice(0, 10),
      monthStartDay
    );
  }, [preset, customA, customB, maxDate, monthStartDay]);

  const txsA = useMemo(
    () => filtered.filter((t) => ranges.a.from && ranges.a.to && inRange(t, ranges.a)),
    [filtered, ranges]
  );
  const txsB = useMemo(
    () => filtered.filter((t) => ranges.b.from && ranges.b.to && inRange(t, ranges.b)),
    [filtered, ranges]
  );

  const kpiA = useMemo(() => computeKPI(txsA), [txsA]);
  const kpiB = useMemo(() => computeKPI(txsB), [txsB]);

  const catsA = useMemo(() => groupByCategory(txsA, "top"), [txsA]);
  const catsB = useMemo(() => groupByCategory(txsB, "top"), [txsB]);

  const showDrill = useDrillStore((s) => s.show);

  function openPeriod(label: "A" | "B") {
    const range = label === "A" ? ranges.a : ranges.b;
    const txs = label === "A" ? txsA : txsB;
    showDrill(range.label, txs, `Период ${label}`);
  }
  function openCategoryInPeriod(category: string, label: "A" | "B") {
    const txs = (label === "A" ? txsA : txsB).filter(
      (t) => affectsExpense(t.kind) && t.category === category
    );
    const range = label === "A" ? ranges.a : ranges.b;
    showDrill(`${category} · ${range.label}`, txs, `Расходы в периоде ${label}`);
  }

  const allCats = useMemo(() => {
    const set = new Set<string>();
    catsA.forEach((c) => set.add(c.category));
    catsB.forEach((c) => set.add(c.category));
    return Array.from(set);
  }, [catsA, catsB]);

  const compareData = useMemo(() => {
    const aByCat = new Map(catsA.map((c) => [c.category, c.expense]));
    const bByCat = new Map(catsB.map((c) => [c.category, c.expense]));
    return allCats
      .map((cat) => ({
        category: cat,
        // Clamp at 0 for the bar chart: a category whose refunds exceed its
        // expenses has a negative "expense" total, which would otherwise drag
        // the X-axis below zero and waste half the plot. The metrics table
        // above still shows the real signed numbers.
        a: Math.max(0, Math.round(aByCat.get(cat) || 0)),
        b: Math.max(0, Math.round(bByCat.get(cat) || 0)),
        diff: (aByCat.get(cat) || 0) - (bByCat.get(cat) || 0),
      }))
      // Drop rows with no expense in either period (income-only categories, or
      // net-refund categories clamped to 0) so the chart has no empty bars.
      // All remaining categories are shown (no top-N cap); the chart height
      // grows with the count so nothing is silently hidden.
      .filter((d) => d.a > 0 || d.b > 0)
      .sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b));
  }, [catsA, catsB, allCats]);

  if (transactions.length === 0) return <EmptyState />;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={GitCompare}
        title="Сравнение периодов"
        hint="Два периода рядом: ключевые метрики и расходы по категориям."
        right={
          <div className="flex bg-panel2 rounded-lg p-1 border border-border flex-wrap">
            {(
              [
                ["this_vs_prev_month", "Месяц"],
                ["last_30_vs_prev_30", "30 дней"],
                ["last_90_vs_prev_90", "90 дней"],
                ["ytd_vs_prev_ytd", "YTD"],
                ["custom", "Свои даты"],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setPreset(k)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  preset === k
                    ? "bg-accent text-accent-fg"
                    : "text-muted hover:text-text"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        }
      />

      {preset === "custom" && (
        <div className="card card-pad">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="label mb-2">Период А</div>
              <div className="flex gap-2">
                <DateField
                  value={customA.from}
                  onChange={(e) => setCustomA({ ...customA, from: e.target.value })}
                  className="input text-xs py-1.5"
                  wrapperClassName="flex-1"
                />
                <DateField
                  value={customA.to}
                  onChange={(e) => setCustomA({ ...customA, to: e.target.value })}
                  className="input text-xs py-1.5"
                  wrapperClassName="flex-1"
                />
              </div>
            </div>
            <div>
              <div className="label mb-2">Период Б</div>
              <div className="flex gap-2">
                <DateField
                  value={customB.from}
                  onChange={(e) => setCustomB({ ...customB, from: e.target.value })}
                  className="input text-xs py-1.5"
                  wrapperClassName="flex-1"
                />
                <DateField
                  value={customB.to}
                  onChange={(e) => setCustomB({ ...customB, to: e.target.value })}
                  className="input text-xs py-1.5"
                  wrapperClassName="flex-1"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { range: ranges.a, kpi: kpiA, label: "А", letter: "A" as const },
          { range: ranges.b, kpi: kpiB, label: "Б", letter: "B" as const },
        ].map(({ range, kpi, label, letter }) => (
          <button
            key={label}
            onClick={() => openPeriod(letter)}
            className="card card-pad text-left hover:border-accent transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold capitalize">{range.label}</div>
              <div className="text-xs text-muted">
                {range.from ? formatDate(range.from, "short") : "?"}
                <ArrowRight className="w-3 h-3 inline mx-1" />
                {range.to ? formatDate(range.to, "short") : "?"}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="label">Доходы</div>
                <div className="text-income font-semibold tabular-nums">
                  {formatMoney(kpi.income, base)}
                </div>
              </div>
              <div>
                <div className="label">Расходы</div>
                <div className="text-expense font-semibold tabular-nums">
                  {formatMoney(kpi.expense, base)}
                </div>
              </div>
              <div>
                <div className="label">Чистый</div>
                <div
                  className={`font-semibold tabular-nums ${
                    kpi.net >= 0 ? "text-income" : "text-expense"
                  }`}
                >
                  {formatMoney(kpi.net, base, { signed: true })}
                </div>
              </div>
            </div>
            <div className="text-xs text-muted mt-3 flex items-center justify-between">
              <span>
                {kpi.count} операций · {kpi.uniqueCategories} категорий
              </span>
              <span className="text-accent">показать →</span>
            </div>
          </button>
        ))}
      </div>

      <div className="card card-pad">
        <div className="font-semibold mb-4">Изменения в ключевых метриках</div>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="table-th">Метрика</th>
              <th className="table-th text-right">{ranges.a.label}</th>
              <th className="table-th text-right">{ranges.b.label}</th>
              <th className="table-th text-right">Δ</th>
            </tr>
          </thead>
          <tbody>
            <tr onClick={() => openPeriod("A")} className="hover:bg-panel2/40 cursor-pointer">
              <td className="table-td">Доходы</td>
              <td className="table-td text-right tabular-nums">{formatMoney(kpiA.income, base)}</td>
              <td className="table-td text-right tabular-nums text-muted">{formatMoney(kpiB.income, base)}</td>
              <td className="table-td text-right">
                <div className="flex justify-end">
                  <Delta a={kpiA.income} b={kpiB.income} />
                </div>
              </td>
            </tr>
            <tr>
              <td className="table-td">Расходы</td>
              <td className="table-td text-right tabular-nums">{formatMoney(kpiA.expense, base)}</td>
              <td className="table-td text-right tabular-nums text-muted">{formatMoney(kpiB.expense, base)}</td>
              <td className="table-td text-right">
                <div className="flex justify-end">
                  <Delta a={kpiA.expense} b={kpiB.expense} invert />
                </div>
              </td>
            </tr>
            <tr>
              <td className="table-td">Чистый поток</td>
              <td className="table-td text-right tabular-nums">{formatMoney(kpiA.net, base, { signed: true })}</td>
              <td className="table-td text-right tabular-nums text-muted">{formatMoney(kpiB.net, base, { signed: true })}</td>
              <td className="table-td text-right">
                <div className="flex justify-end">
                  <Delta a={kpiA.net} b={kpiB.net} />
                </div>
              </td>
            </tr>
            <tr>
              <td className="table-td">Средний чек расхода</td>
              <td className="table-td text-right tabular-nums">{formatMoney(kpiA.avgExpense, base)}</td>
              <td className="table-td text-right tabular-nums text-muted">{formatMoney(kpiB.avgExpense, base)}</td>
              <td className="table-td text-right">
                <div className="flex justify-end">
                  <Delta a={kpiA.avgExpense} b={kpiB.avgExpense} invert />
                </div>
              </td>
            </tr>
            <tr>
              <td className="table-td">Операций</td>
              <td className="table-td text-right tabular-nums">{formatNum(kpiA.count)}</td>
              <td className="table-td text-right tabular-nums text-muted">{formatNum(kpiB.count)}</td>
              <td className="table-td text-right">
                <div className="flex justify-end">
                  <Delta a={kpiA.count} b={kpiB.count} />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card card-pad">
        <div className="font-semibold mb-3">
          Расходы по категориям: {ranges.a.label} vs {ranges.b.label}
        </div>
        {compareData.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted">
            Нет расходов по категориям в выбранных периодах — измените фильтры или периоды.
          </div>
        ) : (
        <div style={{ height: Math.max(384, compareData.length * 34 + 48) }}>
          <ResponsiveContainer>
            <BarChart data={compareData} layout="vertical" margin={{ left: 100 }} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
              <XAxis
                type="number"
                allowDecimals={false}
                stroke={chartAxisStroke}
                fontSize={11}
                tickFormatter={(v) => formatNum(v, { compact: true })}
              />
              {/* interval={0} prevents Recharts from auto-skipping
                  category labels when the list gets long. */}
              <YAxis
                type="category"
                dataKey="category"
                stroke={chartAxisStroke}
                fontSize={11}
                width={160}
                interval={0}
              />
              <Tooltip
                {...chartTooltipProps}
                formatter={(v: unknown) => formatMoney(toNum(v), base)}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar
                dataKey="a"
                name={ranges.a.label}
                fill="#22D3EE"
                radius={[0, 4, 4, 0]}
                maxBarSize={13}
                isAnimationActive={false}
                cursor="pointer"
                activeBar={false}
                onClick={((d: unknown) => {
                  const cat = (d as { category?: string } | undefined)?.category;
                  if (cat) openCategoryInPeriod(cat, "A");
                }) as never}
              />
              <Bar
                dataKey="b"
                name={ranges.b.label}
                fill="#A78BFA"
                radius={[0, 4, 4, 0]}
                maxBarSize={13}
                isAnimationActive={false}
                cursor="pointer"
                activeBar={false}
                onClick={((d: unknown) => {
                  const cat = (d as { category?: string } | undefined)?.category;
                  if (cat) openCategoryInPeriod(cat, "B");
                }) as never}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        )}
      </div>
    </div>
  );
}
