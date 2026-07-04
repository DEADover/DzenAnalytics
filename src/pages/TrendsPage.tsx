import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Cell,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
} from "recharts";
import { Activity, Calendar } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useLocalPeriod } from "../hooks/useLocalPeriod";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useDrillStore } from "../store/useDrillStore";
import {
  categoryMonthlySeries,
  groupByCategory,
  statsByDayOfWeek,
  statsByHourOfWeek,
} from "../lib/aggregations";
import {
  formatMoney,
  formatNum,
  monthLabel,
  toNum,
  chartTooltipProps,
  chartGridStroke,
  chartAxisStroke,
} from "../lib/format";
import { affectsExpense } from "../lib/txKindStyle";
import type { Transaction } from "../types";
import { EmptyState } from "../components/EmptyState";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { colorForCategory } from "../lib/categoryColor";
import { useEffect } from "react";

export function TrendsPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const categoryMeta = useCategoryMetaStore((s) => s.meta);
  const metaLoaded = useCategoryMetaStore((s) => s.loaded);
  const hydrateMeta = useCategoryMetaStore((s) => s.hydrate);
  useEffect(() => {
    if (!metaLoaded) hydrateMeta();
  }, [metaLoaded, hydrateMeta]);
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const showDrill = useDrillStore((s) => s.show);

  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [level, setLevel] = useState<"top" | "full">("top");
  const [selected, setSelected] = useState<string[]>([]);
  // History page → own period (default «12 мес»), not the global «месяц» filter,
  // so it opens on a meaningful span. Supports presets, a specific month and a
  // custom range (issue #36). Other global filters still apply.
  const lp = useLocalPeriod("12m");
  const effectiveFilters = useMemo(
    () => ({
      ...filters,
      preset: lp.preset,
      monthYM: lp.monthYM,
      from: lp.from,
      to: lp.to,
    }),
    [filters, lp.preset, lp.monthYM, lp.from, lp.to]
  );

  const filtered = useMemo(() => applyFilters(transactions, effectiveFilters, monthStartDay), [transactions, effectiveFilters, monthStartDay]);

  const allCategories = useMemo(
    () =>
      groupByCategory(filtered, level)
        .filter((c) => (kind === "expense" ? c.expense : c.income) > 0)
        .slice(0, 50)
        .map((c) => c.category),
    [filtered, level, kind]
  );

  const activeCategories = selected.length > 0 ? selected : allCategories.slice(0, 5);

  const series = useMemo(() => {
    const allMonths = new Set<string>();
    for (const t of filtered) {
      if (t.date) allMonths.add(t.date.slice(0, 7));
    }
    const sorted = Array.from(allMonths).sort();
    const data: Record<string, number | string>[] = sorted.map((ym) => ({ ym, label: monthLabel(ym) }));
    for (const cat of activeCategories) {
      const s = categoryMonthlySeries(filtered, cat, level, kind);
      const byYm = new Map(s.map((p) => [p.ym, p.total]));
      for (const point of data) {
        point[cat] = Math.round(byYm.get(point.ym as string) || 0);
      }
    }
    return data;
  }, [filtered, activeCategories, level, kind]);

  const dowStats = useMemo(() => statsByDayOfWeek(filtered, kind), [filtered, kind]);
  const howCells = useMemo(() => statsByHourOfWeek(filtered, kind), [filtered, kind]);

  const dowChart = dowStats.map((d) => ({
    name: d.name.slice(0, 3),
    fullName: d.name,
    avg: Math.round(d.avg),
    total: Math.round(d.total),
    count: d.count,
    isWeekend: d.dow === 0 || d.dow === 6,
  }));

  const radarData = dowStats.map((d) => ({
    day: d.name.slice(0, 3),
    value: Math.round(d.avg),
  }));

  const weekend = dowStats.filter((d) => d.dow === 0 || d.dow === 6);
  const weekday = dowStats.filter((d) => d.dow !== 0 && d.dow !== 6);
  const weekendAvg = weekend.reduce((s, d) => s + d.avg, 0) / Math.max(weekend.length, 1);
  const weekdayAvg = weekday.reduce((s, d) => s + d.avg, 0) / Math.max(weekday.length, 1);

  const weekendTotal = weekend.reduce((s, d) => s + d.total, 0);
  const weekdayTotal = weekday.reduce((s, d) => s + d.total, 0);

  function toggleCategory(cat: string) {
    setSelected((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  }

  // Expense-side drill-downs include refunds so the rows in the
  // drawer add up to the net figure the user clicked on. Parameter
  // is the full `TxKind` (incl. "transfer") because the callers pass
  // `t.kind` straight in — the function just returns `false` for
  // anything that isn't a match.
  const matchesKind = (k: Transaction["kind"]) =>
    kind === "expense" ? affectsExpense(k) : k === kind;
  function openCategoryMonth(cat: string, ym: string) {
    const txs = filtered.filter(
      (t) =>
        matchesKind(t.kind) &&
        (level === "top" ? t.category === cat : t.categoryFull === cat) &&
        t.date.slice(0, 7) === ym
    );
    showDrill(`${cat} · ${monthLabel(ym)}`, txs, "Тренд категории");
  }

  function openDay(dow: number) {
    const txs = filtered.filter((t) => matchesKind(t.kind) && new Date(t.date).getDay() === dow);
    const name = ["воскресеньям", "понедельникам", "вторникам", "средам", "четвергам", "пятницам", "субботам"][dow];
    showDrill(`Все по ${name}`, txs, "День недели");
  }

  if (transactions.length === 0) return <EmptyState />;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Activity}
        title="Тренды"
        hint="Помесячная динамика и паттерны по дням недели."
        right={
          <div className="flex flex-wrap gap-2">
            <div className="flex bg-panel2 rounded-lg p-1 border border-border">
              <button
                onClick={() => setKind("expense")}
                className={`px-3 py-1 text-xs rounded-md ${kind === "expense" ? "bg-expense text-white" : "text-muted"}`}
              >
                Расходы
              </button>
              <button
                onClick={() => setKind("income")}
                className={`px-3 py-1 text-xs rounded-md ${kind === "income" ? "bg-income text-white" : "text-muted"}`}
              >
                Доходы
              </button>
            </div>
            <div className="flex bg-panel2 rounded-lg p-1 border border-border">
              <button
                onClick={() => setLevel("top")}
                title="Группировать по верхнеуровневым категориям"
                className={`px-3 py-1 text-xs rounded-md ${level === "top" ? "bg-accent text-accent-fg" : "text-muted"}`}
              >
                Крупно
              </button>
              <button
                onClick={() => setLevel("full")}
                title="Разбивать по подкатегориям"
                className={`px-3 py-1 text-xs rounded-md ${level === "full" ? "bg-accent text-accent-fg" : "text-muted"}`}
              >
                Детально
              </button>
            </div>
          </div>
        }
      />
      <GlobalFilters period={lp} />

      <div className="card card-pad">
        <div className="flex items-start justify-between mb-3 flex-wrap gap-3">
          <div>
            <div className="font-semibold">Категории по месяцам</div>
            <div className="text-xs text-muted">
              {selected.length === 0
                ? `Авто: топ-5 категорий (${activeCategories.length})`
                : `Выбрано: ${selected.length}`}
              {" · "}
              <button onClick={() => setSelected([])} className="text-accent hover:underline">
                сбросить
              </button>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {allCategories.slice(0, 30).map((cat) => {
            const isActive = activeCategories.includes(cat);
            const isSelected = selected.includes(cat);
            const color = colorForCategory(cat, categoryMeta);
            return (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  isSelected
                    ? "bg-accent/15 text-text border-accent"
                    : isActive
                      ? "bg-panel2 text-text border-border"
                      : "bg-panel2 text-muted border-border hover:border-accent/50"
                }`}
                style={isActive ? { borderLeftWidth: 3, borderLeftColor: color } : {}}
              >
                {cat}
              </button>
            );
          })}
        </div>
        <div className="h-80">
          <ResponsiveContainer>
            <LineChart
              data={series}
              onClick={(e: unknown) => {
                const ev = e as
                  | { activePayload?: { payload?: { ym?: string }; dataKey?: string }[] }
                  | undefined;
                const ym = ev?.activePayload?.[0]?.payload?.ym;
                const cat = ev?.activePayload?.[0]?.dataKey;
                if (ym && cat && typeof cat === "string") openCategoryMonth(cat, ym);
              }}
              style={{ cursor: "pointer" }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
              <XAxis dataKey="label" stroke={chartAxisStroke} fontSize={11} minTickGap={20} />
              <YAxis
                stroke={chartAxisStroke}
                fontSize={11}
                tickFormatter={(v) => formatNum(v, { compact: true })}
              />
              <Tooltip
                {...chartTooltipProps}
                formatter={(v: unknown) => formatMoney(toNum(v), base)}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {activeCategories.map((cat) => (
                <Line
                  key={cat}
                  type="monotone"
                  dataKey={cat}
                  stroke={colorForCategory(cat, categoryMeta)}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card card-pad lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-semibold flex items-center gap-2">
                <Calendar className="w-4 h-4 text-accent" />
                По дням недели
              </div>
              <div className="text-xs text-muted">Средний чек {kind === "expense" ? "расхода" : "дохода"} за день</div>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart
                data={dowChart}
                onClick={(e: unknown) => {
                  const ev = e as { activePayload?: { payload?: { fullName?: string } }[] } | undefined;
                  const name = ev?.activePayload?.[0]?.payload?.fullName;
                  const idx = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"].indexOf(name || "");
                  if (idx >= 0) openDay(idx);
                }}
                style={{ cursor: "pointer" }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                <XAxis dataKey="name" stroke={chartAxisStroke} fontSize={11} />
                <YAxis stroke={chartAxisStroke} fontSize={11} tickFormatter={(v) => formatNum(v, { compact: true })} />
                <Tooltip
                  {...chartTooltipProps}
                  // Bars coloured per-point via <Cell> (no Bar fill), so pin the
                  // tooltip value to the theme text colour for dark-theme readability.
                  itemStyle={{ color: "rgb(var(--c-text))" }}
                  labelFormatter={(_, p) => (p?.[0]?.payload as { fullName?: string })?.fullName ?? ""}
                  formatter={(v: unknown, n: unknown) => [
                    formatMoney(toNum(v), base),
                    n === "avg" ? "Средний за день" : "Всего",
                  ]}
                />
                <Bar dataKey="avg" radius={[4, 4, 0, 0]} activeBar={false}>
                  {dowChart.map((d, i) => (
                    <Cell
                      key={i}
                      fill={d.isWeekend ? "#A78BFA" : kind === "expense" ? "#EF4444" : "#10B981"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card card-pad">
          <div className="mb-3">
            <div className="font-semibold flex items-center gap-2">
              <Calendar className="w-4 h-4 text-accent" />
              Радар
            </div>
            <div className="text-xs text-muted">
              Средний чек {kind === "expense" ? "расхода" : "дохода"} за день —
              форма недели
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer>
              <RadarChart data={radarData}>
                <PolarGrid stroke={chartGridStroke} />
                <PolarAngleAxis dataKey="day" stroke={chartAxisStroke} fontSize={11} />
                {/* Anchor the radius at 0 so spokes are proportional to the
                    value — without this Recharts can start the scale at the
                    data min, collapsing small days to the centre and distorting
                    the shape. */}
                <PolarRadiusAxis domain={[0, "auto"]} tick={false} axisLine={false} />
                <Radar
                  dataKey="value"
                  name="Средний за день"
                  stroke="#22D3EE"
                  fill="#22D3EE"
                  fillOpacity={0.3}
                  strokeWidth={2}
                />
                <Tooltip
                  {...chartTooltipProps}
                  formatter={(v: unknown) => formatMoney(toNum(v), base)}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card card-pad">
          <div className="label mb-1">Будни (среднее за день)</div>
          <div className={`stat-num ${kind === "expense" ? "text-expense" : "text-income"}`}>
            {formatMoney(weekdayAvg, base)}
          </div>
          <div className="text-xs text-muted mt-1">
            Всего за будни: {formatMoney(weekdayTotal, base)}
          </div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Выходные (среднее за день)</div>
          <div className="stat-num text-accent2">
            {formatMoney(weekendAvg, base)}
          </div>
          <div className="text-xs text-muted mt-1">
            Всего за выходные: {formatMoney(weekendTotal, base)}
          </div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Соотношение</div>
          <div className="stat-num">
            {weekdayAvg > 0 ? `${(weekendAvg / weekdayAvg).toFixed(2)}×` : "—"}
          </div>
          <div className="text-xs text-muted mt-1">
            {weekendAvg > weekdayAvg
              ? "В выходные тратите больше за день"
              : "В будни тратите больше за день"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <HourOfWeekHeatmap cells={howCells} kind={kind} base={base} />
        <HourOfDayBars cells={howCells} kind={kind} base={base} />
      </div>
    </div>
  );
}

function HourOfWeekHeatmap({
  cells,
  kind,
  base,
}: {
  cells: { dow: number; hour: number; total: number; count: number }[];
  kind: "expense" | "income";
  base: string;
}) {
  const max = cells.reduce((m, c) => Math.max(m, c.total), 0);
  const palette =
    kind === "expense"
      ? [
          "rgb(var(--c-panel2))",
          "rgba(239, 68, 68, 0.10)",
          "rgba(239, 68, 68, 0.20)",
          "rgba(239, 68, 68, 0.32)",
          "rgba(239, 68, 68, 0.46)",
          "rgba(239, 68, 68, 0.60)",
          "rgba(239, 68, 68, 0.74)",
          "rgba(239, 68, 68, 0.88)",
          "rgba(220, 38, 38, 1)",
        ]
      : [
          "rgb(var(--c-panel2))",
          "rgba(16, 185, 129, 0.10)",
          "rgba(16, 185, 129, 0.20)",
          "rgba(16, 185, 129, 0.32)",
          "rgba(16, 185, 129, 0.46)",
          "rgba(16, 185, 129, 0.60)",
          "rgba(16, 185, 129, 0.74)",
          "rgba(16, 185, 129, 0.88)",
          "rgba(5, 150, 105, 1)",
        ];

  const positives = cells
    .map((c) => c.total)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const thresholds: number[] = [];
  for (let i = 1; i <= palette.length - 2; i++) {
    const idx = Math.floor((i / (palette.length - 1)) * positives.length);
    thresholds.push(positives[Math.min(idx, positives.length - 1)] || 0);
  }

  function color(v: number): string {
    if (v <= 0) return palette[0];
    for (let i = 0; i < thresholds.length; i++) {
      if (v <= thresholds[i]) return palette[i + 1];
    }
    return palette[palette.length - 1];
  }

  const dowOrder = [1, 2, 3, 4, 5, 6, 0];
  const dowNames = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

  return (
    <div className="card card-pad flex flex-col">
      <div className="font-semibold mb-1">
        Когда вы {kind === "expense" ? "тратите" : "получаете"}
      </div>
      <div className="text-xs text-muted mb-3">
        По дням недели и часам. Чем темнее клетка — тем больше сумма.
      </div>
      <div className="flex-1 flex items-center overflow-x-auto">
        <div className="grid w-full gap-[2px]" style={{ gridTemplateColumns: `auto repeat(24, minmax(18px, 1fr))` }}>
          <div></div>
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="text-[10px] text-muted text-center">
              {h % 3 === 0 ? h : ""}
            </div>
          ))}
          {dowOrder.map((dow, idx) => (
            <Row key={dow} dow={dow} label={dowNames[idx]} cells={cells} max={max} colorFn={color} base={base} />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-3 text-xs text-muted justify-end">
        <span>меньше</span>
        {palette.map((c, i) => (
          <span
            key={i}
            className="w-3 h-3 rounded-sm border border-border/30"
            style={{ background: c }}
          />
        ))}
        <span>больше</span>
      </div>
    </div>
  );
}

function Row({
  dow,
  label,
  cells,
  max,
  colorFn,
  base,
}: {
  dow: number;
  label: string;
  cells: { dow: number; hour: number; total: number; count: number }[];
  max: number;
  colorFn: (v: number) => string;
  base: string;
}) {
  const row = cells.filter((c) => c.dow === dow);
  return (
    <>
      <div className="text-[10px] text-muted pr-2 text-right self-center">{label}</div>
      {row.map((c) => {
        const pct = max > 0 ? (c.total / max) * 100 : 0;
        return (
          <div
            key={c.hour}
            title={
              c.count > 0
                ? `${label} ${String(c.hour).padStart(2, "0")}:00 — ${c.total.toLocaleString("ru-RU")} ${base}, ${c.count} оп.`
                : `${label} ${String(c.hour).padStart(2, "0")}:00`
            }
            className="aspect-square rounded-[2px] border border-border/20"
            style={{ background: colorFn(c.total) }}
            data-pct={pct}
          />
        );
      })}
    </>
  );
}

/** Time-of-day distribution — the column-marginal of the hour-of-week heatmap
 *  (sum over all weekdays), as a 24-bar chart. Reveals peak spending hours,
 *  which the heatmap holds but is hard to read as totals. */
function HourOfDayBars({
  cells,
  kind,
  base,
}: {
  cells: { dow: number; hour: number; total: number; count: number }[];
  kind: "expense" | "income";
  base: string;
}) {
  const data = useMemo(() => {
    const totals = Array.from({ length: 24 }, () => 0);
    for (const c of cells) totals[c.hour] += c.total;
    return totals.map((total, hour) => ({ hour, total: Math.round(total) }));
  }, [cells]);

  const peak = data.reduce((m, d) => (d.total > m.total ? d : m), data[0]);
  const color = kind === "expense" ? "#EF4444" : "#10B981";

  return (
    <div className="card card-pad flex flex-col">
      <div className="font-semibold mb-1">По часам суток</div>
      <div className="text-xs text-muted mb-3">
        Сумма {kind === "expense" ? "расходов" : "доходов"} по каждому часу дня
        за период.
        {peak.total > 0 && ` Пик — около ${peak.hour}:00.`}
      </div>
      <div className="flex-1 min-h-[240px]">
        <ResponsiveContainer>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} vertical={false} />
            <XAxis
              dataKey="hour"
              stroke={chartAxisStroke}
              fontSize={11}
              interval={2}
              tickFormatter={(h) => `${h}`}
            />
            <YAxis
              stroke={chartAxisStroke}
              fontSize={11}
              tickFormatter={(v) => formatNum(v as number, { compact: true })}
            />
            <Tooltip
              {...chartTooltipProps}
              // The <Bar> colours its <Cell>s individually, so Recharts can't
              // resolve a series colour for the tooltip item and falls back to
              // black — invisible in dark theme. Pin it to the theme text colour.
              itemStyle={{ color: "rgb(var(--c-text))" }}
              labelFormatter={(h) => `${String(h).padStart(2, "0")}:00–${String(h).padStart(2, "0")}:59`}
              formatter={(v: unknown) => [
                formatMoney(toNum(v), base),
                kind === "expense" ? "Расход" : "Доход",
              ]}
            />
            <Bar dataKey="total" radius={[3, 3, 0, 0]}>
              {data.map((d) => (
                <Cell
                  key={d.hour}
                  fill={color}
                  fillOpacity={peak.total > 0 ? 0.35 + 0.65 * (d.total / peak.total) : 0.5}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
