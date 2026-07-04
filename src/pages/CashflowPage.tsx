import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ReferenceLine,
  Area,
  AreaChart,
  Cell,
} from "recharts";
import {
  TrendingDown,
  TrendingUp,
  Wallet,
  List,
  Calendar,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  Layers,
  LineChart as LineChartIcon,
  Sparkles,
} from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { colorForCategory } from "../lib/categoryColor";
import {
  useFiltersStore,
  applyFilters,
  type DatePreset,
} from "../store/useFiltersStore";
import { useDrillStore } from "../store/useDrillStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { periodKey } from "../lib/period";
import {
  groupByMonth,
  computeKPI,
  buildInsights,
  buildScenarioForecast,
  yearOverYearMonthly,
  vsAverageStats,
  buildStreamData,
  detectSeasonality,
} from "../lib/aggregations";
import { InsightsPanel } from "../components/InsightsPanel";
import {
  formatMoney,
  monthLabel,
  monthLabelFull,
  formatNum,
  toNum,
  ymKey,
  chartTooltipProps,
  chartGridStroke,
  chartAxisStroke,
} from "../lib/format";
import { Stat } from "../components/Stat";
import { EmptyState } from "../components/EmptyState";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";
import { SortableTable } from "../components/SortableTable";
import type { MonthBucket } from "../lib/aggregations";

export function CashflowPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const categoryMeta = useCategoryMetaStore((s) => s.meta);
  const metaLoaded = useCategoryMetaStore((s) => s.loaded);
  const hydrateMeta = useCategoryMetaStore((s) => s.hydrate);
  useEffect(() => {
    if (!metaLoaded) hydrateMeta();
  }, [metaLoaded, hydrateMeta]);
  const filters = useFiltersStore();

  const showDrill = useDrillStore((s) => s.show);
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);

  // This is a history chart, so it has its OWN period (default «12 мес») rather
  // than inheriting the global «месяц» filter — otherwise a first visit would
  // show a single month. Other global filters (счета/категории/валюты/поиск)
  // still apply. Mirrors the Calendar page's local-period pattern.
  const [period, setPeriod] = useState<DatePreset>("12m");
  const effectiveFilters = useMemo(
    () => ({ ...filters, preset: period, from: null, to: null }),
    [filters, period]
  );

  const filtered = useMemo(
    () => applyFilters(transactions, effectiveFilters, monthStartDay),
    [transactions, effectiveFilters, monthStartDay]
  );
  const months = useMemo(
    () => groupByMonth(filtered, { monthStartDay }),
    [filtered, monthStartDay]
  );
  const kpi = useMemo(() => computeKPI(filtered), [filtered]);
  const insights = useMemo(() => buildInsights(filtered), [filtered]);
  const vsAvg = useMemo(
    () => vsAverageStats(filtered, { monthStartDay }),
    [filtered, monthStartDay]
  );

  // «Год к году» и «сезонность» — многолетние разрезы, поэтому они НЕ
  // ограничиваются локальным периодом (иначе на 3-месячном окне им просто
  // нечего показать). Но остальные глобальные фильтры (счета/категории/валюты/
  // поиск/без переводов) должны применяться ко всей странице одинаково —
  // иначе смена категории меняла основной график, но не эти два. Берём всю
  // историю с применёнными фильтрами-измерениями (preset: "all").
  const dimensionFiltered = useMemo(
    () =>
      applyFilters(
        transactions,
        { ...filters, preset: "all", from: null, to: null },
        monthStartDay
      ),
    [transactions, filters, monthStartDay]
  );

  // Forecast (seasonality + level + band) is computed from the FULL history
  // (dimensionFiltered — dimension filters, no period), NOT the selected period:
  // a short window (<18 мес) drops below the seasonality threshold and the
  // projection goes flat. The chart still shows only the period's bars — the
  // historical months are clipped to `months` in chartData below.
  const scenarios = useMemo(
    () => buildScenarioForecast(dimensionFiltered, 6, 6, { monthStartDay, categoryMeta }),
    [dimensionFiltered, monthStartDay, categoryMeta]
  );

  const allYears = useMemo(() => {
    const set = new Set<number>();
    for (const t of dimensionFiltered) set.add(Number(t.date.slice(0, 4)));
    return Array.from(set).sort();
  }, [dimensionFiltered]);
  const [yoyYear, setYoyYear] = useState(allYears[allYears.length - 1] || new Date().getFullYear());
  const [yoyKind, setYoyKind] = useState<"expense" | "income">("expense");
  // Clamp the selected year-over-year year if the available list
  // changes (e.g. after a data reload) and the current pick falls out
  // of range. Keeps the <select> showing a valid value.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (allYears.length && !allYears.includes(yoyYear)) setYoyYear(allYears[allYears.length - 1]);
  }, [allYears, yoyYear]);
  const yoyData = useMemo(
    () => yearOverYearMonthly(dimensionFiltered, yoyYear, yoyKind),
    [dimensionFiltered, yoyYear, yoyKind]
  );

  // Cash-flow visualization mode: bars (по умолчанию) или stream graph
  const [vizMode, setVizMode] = useState<"bars" | "stream">("bars");
  const stream = useMemo(() => buildStreamData(filtered, 10, "expense"), [filtered]);

  // Seasonality
  const seasonality = useMemo(() => detectSeasonality(dimensionFiltered), [dimensionFiltered]);

  function openMonth(ym: string) {
    const txs = filtered.filter(
      (t) =>
        (monthStartDay === 1 ? ymKey(t.date) : periodKey(t.date, monthStartDay)) ===
        ym
    );
    showDrill(monthLabel(ym), txs, "Месяц");
  }
  function openAll() {
    showDrill("Все операции (с фильтрами)", filtered, "Период");
  }

  if (transactions.length === 0) return <EmptyState />;

  // Forecast is built from the full history; show only the SELECTED period's
  // historical bars (plus the forecast months, always). income/expense are
  // populated for EVERY month (historical or forecast) so both use the same two
  // bar series — no empty reserved slots, no gap between past and forecast. The
  // forecast months are styled apart via <Cell> (lighter + dashed).
  const periodYms = new Set(months.map((m) => m.ym));
  const chartData = scenarios
    .filter((p) => p.isForecast || periodYms.has(p.ym))
    .map((p) => ({
      ym: p.ym,
      month: monthLabel(p.ym),
      income: Math.round(p.income),
      expense: Math.round(p.expense),
      net: p.isForecast ? null : Math.round(p.realistic),
      netForecastTop: p.isForecast ? Math.round(p.optimistic) : null,
      netForecastBottom: p.isForecast ? Math.round(p.pessimistic) : null,
      netForecastMid: p.isForecast ? Math.round(p.realistic) : null,
      isForecast: p.isForecast,
    }));
  // Bridge the solid «Чистый поток» line into the dashed forecast line: give the
  // last historical month the forecast values too, so the lines/band connect.
  const lastHistIdx = chartData.reduce((acc, r, i) => (r.isForecast ? acc : i), -1);
  if (lastHistIdx >= 0) {
    const n = chartData[lastHistIdx].net;
    chartData[lastHistIdx].netForecastMid = n;
    chartData[lastHistIdx].netForecastTop = n;
    chartData[lastHistIdx].netForecastBottom = n;
  }

  const monthsCount = months.length || 1;
  const avgMonthlyExpense = kpi.expense / monthsCount;
  const avgMonthlyIncome = kpi.income / monthsCount;
  const savingsRate = kpi.income > 0 ? (kpi.income - kpi.expense) / kpi.income : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={LineChartIcon}
        title="Cash-flow"
        hint="Доходы, расходы и чистый поток по месяцам."
      />
      <GlobalFilters period={period} onPeriodChange={setPeriod} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat
          label="Доходы"
          value={formatMoney(kpi.income, base)}
          tone="income"
          icon={<TrendingUp className="w-4 h-4" />}
          hint={`${formatNum(avgMonthlyIncome)} ${base} / мес`}
        />
        <Stat
          label="Расходы"
          value={formatMoney(kpi.expense, base)}
          tone="expense"
          icon={<TrendingDown className="w-4 h-4" />}
          hint={`${formatNum(avgMonthlyExpense)} ${base} / мес`}
        />
        <Stat
          label="Чистый поток"
          value={formatMoney(kpi.net, base, { signed: true })}
          tone={kpi.net >= 0 ? "income" : "expense"}
          icon={<Wallet className="w-4 h-4" />}
          hint={`Норма сбережений: ${(savingsRate * 100).toFixed(1)}%`}
        />
        <button onClick={openAll} className="text-left">
          <Stat
            label="Операций (клик)"
            value={formatNum(kpi.count)}
            icon={<List className="w-4 h-4" />}
            hint={
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {kpi.daysSpan} дн · {kpi.uniqueCategories} кат · {kpi.uniquePayees} получ.
              </span>
            }
          />
        </button>
      </div>

      <InsightsPanel insights={insights} base={base} />

      <div className="card card-pad">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <div className="font-semibold">
              {vizMode === "bars" ? "Доходы и расходы по месяцам" : "Поток расходов по категориям"}
            </div>
            <div className="text-xs text-muted">
              {vizMode === "bars"
                ? "Столбцы — суммы, линия — чистый поток"
                : "Категории как реки расходов во времени"}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-panel2 rounded-lg p-1 border border-border">
              <button
                onClick={() => setVizMode("bars")}
                className={`px-3 py-1 text-xs rounded-md flex items-center gap-1 ${vizMode === "bars" ? "bg-accent text-accent-fg" : "text-muted"}`}
              >
                <BarChart3 className="w-3 h-3" />
                Бары
              </button>
              <button
                onClick={() => setVizMode("stream")}
                className={`px-3 py-1 text-xs rounded-md flex items-center gap-1 ${vizMode === "stream" ? "bg-accent text-accent-fg" : "text-muted"}`}
              >
                <Layers className="w-3 h-3" />
                Поток
              </button>
            </div>
            <div className="text-xs text-muted">{months.length} мес.</div>
          </div>
        </div>
        <div className="h-80">
          {vizMode === "bars" ? (
          <ResponsiveContainer>
            <ComposedChart
              data={chartData}
              // Столбцы держим компактной парой у центра месяца, чтобы линия
              // и коридор прогноза (они идут через центр месяца) визуально
              // накрывали оба столбца, а не обрывались перед крайним красным.
              barCategoryGap="30%"
              barGap={0}
              maxBarSize={15}
              onClick={(e: unknown) => {
                const ev = e as { activePayload?: { payload?: { ym?: string } }[] } | undefined;
                const ym = ev?.activePayload?.[0]?.payload?.ym;
                if (ym) openMonth(ym);
              }}
              style={{ cursor: "pointer" }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
              <XAxis
                dataKey="month"
                stroke={chartAxisStroke}
                fontSize={11}
                // Thin out labels so they don't overlap on long periods
                // («за всё время» — десятки месяцев, issue #28).
                minTickGap={40}
                interval="preserveStartEnd"
              />
              <YAxis
                stroke={chartAxisStroke}
                fontSize={11}
                tickFormatter={(v) => formatNum(v, { compact: true })}
              />
              <Tooltip
                {...chartTooltipProps}
                formatter={(v: unknown) => formatMoney(toNum(v), base)}
                // Прогнозные строки — всегда после фактических (Доходы,
                // Расходы, Чистый поток), и в прошлых, и в прогнозных месяцах.
                itemSorter={(item) =>
                  ({
                    income: 0,
                    expense: 1,
                    net: 2,
                    netForecastTop: 3,
                    netForecastBottom: 4,
                    netForecastMid: 5,
                  }[String(item.dataKey)] ?? 9)
                }
              />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                content={() => (
                  <div className="flex flex-wrap justify-center gap-4 pt-1 text-xs">
                    {[
                      { label: "Доходы", color: "#10B981", bar: true },
                      { label: "Расходы", color: "#EF4444", bar: true },
                      { label: "Чистый поток", color: "#22D3EE", bar: false },
                      { label: "Прогноз", color: "#A78BFA", bar: false, dashed: true },
                    ].map((it) => (
                      <span key={it.label} className="inline-flex items-center gap-1.5" style={{ color: it.color }}>
                        {it.bar ? (
                          <span style={{ width: 12, height: 12, borderRadius: 2, background: it.color }} />
                        ) : (
                          <span style={{ width: 16, borderTop: `2px ${it.dashed ? "dashed" : "solid"} ${it.color}` }} />
                        )}
                        {it.label}
                      </span>
                    ))}
                  </div>
                )}
              />
              {/* Two bar series only (Доходы/Расходы); forecast months are the
                  same series, styled apart per-point via <Cell> (lighter +
                  dashed). No separate forecast bars → no reserved empty slots. */}
              <Bar dataKey="income" name="Доходы" fill="#10B981" radius={[4, 4, 0, 0]} activeBar={false} isAnimationActive={false}>
                {chartData.map((d, i) => (
                  <Cell
                    key={i}
                    fill="#10B981"
                    fillOpacity={d.isForecast ? 0.4 : 1}
                    stroke={d.isForecast ? "#10B981" : undefined}
                    strokeDasharray={d.isForecast ? "3 3" : undefined}
                  />
                ))}
              </Bar>
              <Bar dataKey="expense" name="Расходы" fill="#EF4444" radius={[4, 4, 0, 0]} activeBar={false} isAnimationActive={false}>
                {chartData.map((d, i) => (
                  <Cell
                    key={i}
                    fill="#EF4444"
                    fillOpacity={d.isForecast ? 0.4 : 1}
                    stroke={d.isForecast ? "#EF4444" : undefined}
                    strokeDasharray={d.isForecast ? "3 3" : undefined}
                  />
                ))}
              </Bar>
              {/* Actual net flow — solid cyan. */}
              <Line
                type="monotone"
                dataKey="net"
                name="Чистый поток"
                stroke="#22D3EE"
                strokeWidth={2}
                dot={{ r: 3 }}
                isAnimationActive={false}
              />
              {/* Forecast coridor — violet band (hidden from legend) + dashed
                  violet «Прогноз» line, distinct from the cyan actual flow. */}
              <Area
                type="monotone"
                dataKey="netForecastTop"
                name="Прогноз (оптимист)"
                stroke="none"
                fill="#A78BFA"
                fillOpacity={0.12}
                legendType="none"
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="netForecastBottom"
                name="Прогноз (пессимист)"
                stroke="none"
                fill="#A78BFA"
                fillOpacity={0.12}
                legendType="none"
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="netForecastMid"
                name="Прогноз (реалист)"
                stroke="#A78BFA"
                strokeWidth={2}
                strokeDasharray="5 3"
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
          ) : (
            <ResponsiveContainer>
              <AreaChart
                data={stream.data}
                stackOffset="silhouette"
                onClick={(e: unknown) => {
                  const ev = e as { activePayload?: { payload?: { ym?: string } }[] } | undefined;
                  const ym = ev?.activePayload?.[0]?.payload?.ym;
                  if (ym) openMonth(ym);
                }}
                style={{ cursor: "pointer" }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                <XAxis
                  dataKey="label"
                  stroke={chartAxisStroke}
                  fontSize={11}
                  tickFormatter={(d) => monthLabel(String(d))}
                  minTickGap={40}
                />
                <YAxis hide />
                <Tooltip
                  {...chartTooltipProps}
                  labelFormatter={(d) => monthLabel(String(d))}
                  formatter={(v: unknown, n: unknown) => [
                    formatMoney(toNum(v), base),
                    String(n),
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {stream.categories.map((cat) => {
                  const color = colorForCategory(cat, categoryMeta);
                  return (
                    <Area
                      key={cat}
                      type="monotone"
                      dataKey={cat}
                      stackId="stream"
                      stroke={color}
                      fill={color}
                      fillOpacity={0.75}
                    />
                  );
                })}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
        {vsAvg.current && vsAvg.avg.expense > 0 && (
          <div className="text-xs mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-muted text-center">
            <div>
              Расходы текущего месяца:{" "}
              <span
                className={
                  vsAvg.current.expense > vsAvg.avg.expense * 1.1
                    ? "text-expense"
                    : vsAvg.current.expense < vsAvg.avg.expense * 0.9
                      ? "text-income"
                      : "text-text"
                }
              >
                {((vsAvg.current.expense / vsAvg.avg.expense - 1) * 100).toFixed(0)}%
              </span>{" "}
              от среднего
            </div>
            <div>
              Доходы текущего месяца:{" "}
              <span className="text-text">
                {vsAvg.avg.income > 0
                  ? `${((vsAvg.current.income / vsAvg.avg.income - 1) * 100).toFixed(0)}%`
                  : "—"}
              </span>{" "}
              от среднего
            </div>
            <div>
              Чистый: <span className={vsAvg.current.net > vsAvg.avg.net ? "text-income" : "text-expense"}>
                {vsAvg.current.net > vsAvg.avg.net ? "лучше" : "хуже"}
              </span>{" "}
              среднего на {formatMoney(Math.abs(vsAvg.current.net - vsAvg.avg.net), base)}
            </div>
          </div>
        )}
      </div>

      {allYears.length >= 2 && (
        <div className="card card-pad">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
            <div>
              <div className="font-semibold">Год к году</div>
              <div className="text-xs text-muted">
                Сравнение с тем же месяцем годом ранее · вся история (период не влияет)
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex bg-panel2 rounded-lg p-1 border border-border">
                <button
                  onClick={() => setYoyKind("expense")}
                  className={`px-3 py-1 text-xs rounded-md ${yoyKind === "expense" ? "bg-expense text-white" : "text-muted"}`}
                >
                  Расходы
                </button>
                <button
                  onClick={() => setYoyKind("income")}
                  className={`px-3 py-1 text-xs rounded-md ${yoyKind === "income" ? "bg-income text-white" : "text-muted"}`}
                >
                  Доходы
                </button>
              </div>
              <div className="flex items-center gap-1 bg-panel2 rounded-lg p-1 border border-border">
                <button
                  onClick={() =>
                    setYoyYear((y) => {
                      const idx = allYears.indexOf(y);
                      return idx > 0 ? allYears[idx - 1] : y;
                    })
                  }
                  disabled={allYears.indexOf(yoyYear) <= 0}
                  className="p-1 hover:text-accent disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-3 text-sm font-medium tabular-nums">{yoyYear}</span>
                <button
                  onClick={() =>
                    setYoyYear((y) => {
                      const idx = allYears.indexOf(y);
                      return idx < allYears.length - 1 ? allYears[idx + 1] : y;
                    })
                  }
                  disabled={allYears.indexOf(yoyYear) >= allYears.length - 1}
                  className="p-1 hover:text-accent disabled:opacity-30"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
          <div className="h-72">
            <ResponsiveContainer>
              <ComposedChart data={yoyData}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                <XAxis dataKey="monthName" stroke={chartAxisStroke} fontSize={11} />
                <YAxis
                  stroke={chartAxisStroke}
                  fontSize={11}
                  tickFormatter={(v) => formatNum(v, { compact: true })}
                />
                <Tooltip
                  {...chartTooltipProps}
                  formatter={(v: unknown) => formatMoney(toNum(v), base)}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  dataKey="lastYear"
                  name={`${yoyYear - 1}`}
                  fill="#A78BFA"
                  radius={[4, 4, 0, 0]}
                  activeBar={false}
                />
                <Bar
                  dataKey="thisYear"
                  name={`${yoyYear}`}
                  fill={yoyKind === "expense" ? "#EF4444" : "#10B981"}
                  radius={[4, 4, 0, 0]}
                  activeBar={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Seasonality */}
      {seasonality.some((s) => s.yearsSampled >= 2) && (
        <div className="card card-pad">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div>
              <div className="font-semibold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-warn" />
                Сезонность расходов
              </div>
              <div className="text-xs text-muted">
                Средний расход по месяцу года, цветом — отклонение от общего среднего · вся история (период не влияет)
              </div>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer>
              <ComposedChart data={seasonality}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                <XAxis dataKey="monthName" stroke={chartAxisStroke} fontSize={11} />
                <YAxis
                  stroke={chartAxisStroke}
                  fontSize={11}
                  tickFormatter={(v) => formatNum(v, { compact: true })}
                />
                <Tooltip
                  {...chartTooltipProps}
                  // Bars coloured per-point via <Cell> (no Bar fill), so pin the
                  // tooltip value to the theme text colour for dark-theme readability.
                  itemStyle={{ color: "rgb(var(--c-text))" }}
                  formatter={(v: unknown, _n: unknown, p: { payload?: { expenseDeviationPct?: number; yearsSampled?: number } }) => {
                    const dev = p.payload?.expenseDeviationPct ?? 0;
                    const ys = p.payload?.yearsSampled ?? 0;
                    return [
                      `${formatMoney(toNum(v), base)} · ${dev > 0 ? "+" : ""}${(dev * 100).toFixed(0)}% · ${ys} год${ys === 1 ? "" : "а"} в выборке`,
                      "Расход",
                    ];
                  }}
                />
                <ReferenceLine y={0} stroke={chartGridStroke} />
                <Legend
                  content={() => (
                    <div className="flex flex-wrap justify-center gap-4 pt-1 text-xs">
                      {[
                        { label: "Ниже среднего", color: "#10B981" },
                        { label: "Около среднего", color: "#A78BFA" },
                        { label: "Выше среднего", color: "#EF4444" },
                      ].map((it) => (
                        <span key={it.label} className="inline-flex items-center gap-1.5" style={{ color: it.color }}>
                          <span style={{ width: 12, height: 12, borderRadius: 2, background: it.color }} />
                          {it.label}
                        </span>
                      ))}
                    </div>
                  )}
                />
                <Bar dataKey="avgExpense" radius={[4, 4, 0, 0]} activeBar={false} isAnimationActive={false}>
                  {seasonality.map((s, i) => {
                    const dev = s.expenseDeviationPct;
                    const color =
                      dev > 0.15 ? "#EF4444" : dev < -0.15 ? "#10B981" : "#A78BFA";
                    return <Cell key={i} fill={color} />;
                  })}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs mt-3">
            {(() => {
              const sorted = [...seasonality].sort(
                (a, b) => Math.abs(b.expenseDeviationPct) - Math.abs(a.expenseDeviationPct)
              );
              const items = sorted
                .filter((s) => s.yearsSampled >= 2 && Math.abs(s.expenseDeviationPct) > 0.1)
                .slice(0, 3);
              return items.map((s) => (
                <div
                  key={s.monthIdx}
                  className={`p-2 rounded ${s.expenseDeviationPct > 0 ? "bg-expense/10 text-expense" : "bg-income/10 text-income"}`}
                >
                  <strong>{s.monthName}</strong>:{" "}
                  {s.expenseDeviationPct > 0 ? "выше" : "ниже"} среднего на{" "}
                  {(Math.abs(s.expenseDeviationPct) * 100).toFixed(0)}%
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      <div className="card card-pad">
        <SortableTable<MonthBucket>
          title="Помесячная сводка"
          data={months}
          rowKey={(m) => m.ym}
          defaultSortKey="ym"
          defaultSortDir="desc"
          onRowClick={(m) => openMonth(m.ym)}
          exportName="cashflow_monthly"
          columns={[
            {
              key: "ym",
              label: "Месяц",
              sortValue: (m) => m.ym,
              render: (m) => <span className="font-medium">{monthLabelFull(m.ym)}</span>,
            },
            {
              key: "income",
              label: "Доходы",
              align: "right",
              sortValue: (m) => m.income,
              render: (m) => (
                <span className="tabular-nums text-income">
                  {formatMoney(m.income, base)}
                </span>
              ),
            },
            {
              key: "expense",
              label: "Расходы",
              align: "right",
              sortValue: (m) => m.expense,
              render: (m) => (
                <span className="tabular-nums text-expense">
                  {formatMoney(m.expense, base)}
                </span>
              ),
            },
            {
              key: "net",
              label: "Чистый",
              align: "right",
              sortValue: (m) => m.net,
              render: (m) => (
                <span
                  className={`tabular-nums font-medium ${
                    m.net >= 0 ? "text-income" : "text-expense"
                  }`}
                >
                  {formatMoney(m.net, base, { signed: true })}
                </span>
              ),
            },
            {
              key: "rate",
              label: "Норма сбер.",
              align: "right",
              sortValue: (m) => (m.income > 0 ? (m.income - m.expense) / m.income : -999),
              render: (m) => {
                const sr = m.income > 0 ? (m.income - m.expense) / m.income : 0;
                return (
                  <span className="tabular-nums text-muted">{(sr * 100).toFixed(0)}%</span>
                );
              },
            },
            {
              key: "count",
              label: "Операций",
              align: "right",
              sortValue: (m) => m.count,
              render: (m) => <span className="text-muted">{m.count}</span>,
            },
          ]}
        />
      </div>
    </div>
  );
}
