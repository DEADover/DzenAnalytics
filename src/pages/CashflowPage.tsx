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
  BarChart3,
  CalendarRange,
  Layers,
  LineChart as LineChartIcon,
  Sparkles,
  Table as TableIcon,
} from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { colorForCategory } from "../lib/categoryColor";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useLocalPeriod } from "../hooks/useLocalPeriod";
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
  formatPct,
  monthLabel,
  monthLabelFull,
  formatNum,
  ymKey,
  chartTooltipProps,
  chartGridStroke,
  chartAxisStroke,
  chartColor,
} from "../lib/format";
import { StatCell, StatRow } from "../components/SectionCard";
import { EmptyState } from "../components/EmptyState";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";
import { CardHeader } from "../components/CardHeader";
import { Segmented } from "../components/Segmented";
import { KindSwitcher } from "../components/KindSwitcher";
import { YearPicker } from "../components/MonthPicker";
import { pluralRu } from "../lib/plural";
import { ChartTooltipCard, TooltipFacts, SeriesTooltip } from "../components/TooltipFacts";
import { DataTable } from "../components/DataTable";
import { toneOfSigned } from "../components/table/tableKit";
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
  // show a single month. Supports presets, a specific month and a custom range.
  // Other global filters (счета/категории/валюты/поиск) still apply.
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
  // Годы без операций перешагиваем: сравнивать в них не с чем, а эффект выше
  // всё равно вернул бы выбор к последнему году.
  const pickYoyYear = (y: number) => {
    if (allYears.includes(y)) return setYoyYear(y);
    const next =
      y > yoyYear
        ? allYears.find((v) => v > yoyYear)
        : [...allYears].reverse().find((v) => v < yoyYear);
    if (next !== undefined) setYoyYear(next);
  };
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
      />
      <GlobalFilters period={lp} />

      <StatRow>
        <StatCell
          label="Доходы"
          value={formatMoney(kpi.income, base)}
          tone="income"
          icon={<TrendingUp className="w-4 h-4" />}
          note={`${formatNum(avgMonthlyIncome)} ${base} / мес`}
        />
        <StatCell
          label="Расходы"
          value={formatMoney(kpi.expense, base)}
          tone="expense"
          icon={<TrendingDown className="w-4 h-4" />}
          note={`${formatNum(avgMonthlyExpense)} ${base} / мес`}
        />
        <StatCell
          label="Чистый поток"
          value={formatMoney(kpi.net, base, { signed: true })}
          tone={kpi.net >= 0 ? "income" : "expense"}
          icon={<Wallet className="w-4 h-4" />}
          note={`Норма сбережений: ${formatPct(savingsRate, 1)}`}
        />
        {/* Итог не кликается целиком: действие — отдельной кнопкой-значком,
            иначе непонятно, какое из четырёх чисел ведёт в операции. */}
        <StatCell
          label="Операций"
          value={formatNum(kpi.count)}
          icon={
            <button
              type="button"
              onClick={openAll}
              className="btn-icon -m-1.5"
              title="Открыть операции периода"
              aria-label="Открыть операции периода"
            >
              <List className="w-4 h-4" />
            </button>
          }
          note={`${kpi.daysSpan} дн · ${kpi.uniqueCategories} кат · ${kpi.uniquePayees} получ.`}
        />
      </StatRow>

      <InsightsPanel insights={insights} base={base} />

      <div className="card-tray card-pad">
        <CardHeader
          icon={vizMode === "bars" ? BarChart3 : Layers}
          title={vizMode === "bars" ? "Доходы и расходы по месяцам" : "Поток расходов по категориям"}
          subtitle={
            vizMode === "bars"
              ? "Столбцы — суммы, линия — чистый поток"
              : "Категории как реки расходов во времени"
          }
          right={
            <>
              <Segmented
                size="sm"
                label="Вид графика"
                value={vizMode}
                onChange={setVizMode}
                options={[
                  { value: "bars", label: "Бары", icon: BarChart3 },
                  { value: "stream", label: "Поток", icon: Layers },
                ]}
              />
              <div className="text-xs text-muted">{months.length} мес.</div>
            </>
          }
        />
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
                content={
                  <SeriesTooltip
                    formatValue={(v) => formatMoney(v, base)}
                    // Заголовок уже готов: в данных графика `month` — это
                    // подпись месяца, а не ключ, и пропускать её через
                    // `monthLabel` значило получить «Invalid Date».
                    // Границы прогнозного коридора — служебные серии: на графике
                    // это одна заливка, а строками они читались бы как три
                    // отдельных числа.
                    skipKeys={["netForecastTop", "netForecastBottom"]}
                  />
                }
              />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                content={() => (
                  <div className="flex flex-wrap justify-center gap-4 pt-1 text-xs">
                    {[
                      { label: "Доходы", color: chartColor.income, bar: true },
                      { label: "Расходы", color: chartColor.expense, bar: true },
                      { label: "Чистый поток", color: chartColor.accent, bar: false },
                      { label: "Прогноз", color: chartColor.accent2, bar: false, dashed: true },
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
              <Bar dataKey="income" name="Доходы" fill={chartColor.income} radius={[4, 4, 0, 0]} activeBar={false} isAnimationActive={false}>
                {chartData.map((d, i) => (
                  <Cell
                    key={i}
                    fill={chartColor.income}
                    fillOpacity={d.isForecast ? 0.4 : 1}
                    stroke={d.isForecast ? chartColor.income : undefined}
                    strokeDasharray={d.isForecast ? "3 3" : undefined}
                  />
                ))}
              </Bar>
              <Bar dataKey="expense" name="Расходы" fill={chartColor.expense} radius={[4, 4, 0, 0]} activeBar={false} isAnimationActive={false}>
                {chartData.map((d, i) => (
                  <Cell
                    key={i}
                    fill={chartColor.expense}
                    fillOpacity={d.isForecast ? 0.4 : 1}
                    stroke={d.isForecast ? chartColor.expense : undefined}
                    strokeDasharray={d.isForecast ? "3 3" : undefined}
                  />
                ))}
              </Bar>
              {/* Actual net flow — solid cyan. */}
              <Line
                type="monotone"
                dataKey="net"
                name="Чистый поток"
                stroke={chartColor.accent}
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
                fill={chartColor.accent2}
                fillOpacity={0.12}
                legendType="none"
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="netForecastBottom"
                name="Прогноз (пессимист)"
                stroke="none"
                fill={chartColor.accent2}
                fillOpacity={0.12}
                legendType="none"
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="netForecastMid"
                name="Прогноз (реалист)"
                stroke={chartColor.accent2}
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
                  content={
                    <SeriesTooltip
                      formatValue={(v) => formatMoney(v, base)}
                      formatLabel={(d) => monthLabel(String(d))}
                    />
                  }
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
        <div className="card-tray card-pad">
          {/* Расходы / доходы и год — общими контролами, как в «Календаре»:
              своя дорожка с красной и зелёной заливкой и своя перелистывалка
              года без подписи-кнопки повторяли их в другом виде. */}
          <CardHeader
            icon={CalendarRange}
            title="Год к году"
            subtitle="Сравнение с тем же месяцем годом ранее · вся история (период не влияет)"
            right={
              <>
                <KindSwitcher kind={yoyKind} onChange={setYoyKind} />
                <YearPicker
                  year={yoyYear}
                  minYear={allYears[0]}
                  maxYear={allYears[allYears.length - 1]}
                  onChange={pickYoyYear}
                />
              </>
            }
          />
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
                  content={<SeriesTooltip formatValue={(v) => formatMoney(v, base)} />}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  dataKey="lastYear"
                  name={`${yoyYear - 1}`}
                  fill={chartColor.accent2}
                  radius={[4, 4, 0, 0]}
                  activeBar={false}
                />
                <Bar
                  dataKey="thisYear"
                  name={`${yoyYear}`}
                  fill={yoyKind === "expense" ? chartColor.expense : chartColor.income}
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
        <div className="card-tray card-pad">
          <CardHeader
            icon={Sparkles}
            tone="warn"
            title="Сезонность расходов"
            subtitle="Средний расход по месяцу года, цветом — отклонение от общего среднего · вся история (период не влияет)"
          />
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
                {/* Своя подсказка, а не общая: тут кроме суммы есть отклонение
                    от среднего и размер выборки. Сплошной строкой
                    «85 166 ₽ · +12% · 3 года в выборке» это читалось тяжело —
                    теперь три отдельные строки, а размер выборки ушёл в
                    примечание, потому что это не про этот месяц, а про то,
                    насколько числу можно верить. */}
                <Tooltip
                  {...chartTooltipProps}
                  content={({ active, payload, label }) => {
                    const point = payload?.[0]?.payload as
                      | { expenseDeviationPct?: number; yearsSampled?: number }
                      | undefined;
                    const value = Number(payload?.[0]?.value);
                    if (!active || !point || !Number.isFinite(value)) return null;
                    const dev = point.expenseDeviationPct ?? 0;
                    const ys = point.yearsSampled ?? 0;
                    return (
                      <ChartTooltipCard>
                        <TooltipFacts
                          title={String(label ?? "")}
                          facts={[
                            { label: "Расход", value: formatMoney(value, base), strong: true },
                            {
                              label: "К среднему",
                              value: `${dev > 0 ? "+" : dev < 0 ? "−" : ""}${Math.abs(dev * 100).toFixed(0)}%`,
                            },
                          ]}
                          note={`${ys} ${pluralRu(ys, ["год", "года", "лет"])} в выборке`}
                        />
                      </ChartTooltipCard>
                    );
                  }}
                />
                <ReferenceLine y={0} stroke={chartGridStroke} />
                <Legend
                  content={() => (
                    <div className="flex flex-wrap justify-center gap-4 pt-1 text-xs">
                      {[
                        { label: "Ниже среднего", color: chartColor.income },
                        { label: "Около среднего", color: chartColor.accent2 },
                        { label: "Выше среднего", color: chartColor.expense },
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
                      dev > 0.15 ? chartColor.expense : dev < -0.15 ? chartColor.income : chartColor.accent2;
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

      <DataTable<MonthBucket>
        icon={TableIcon}
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
            type: "text",
            label: "Месяц",
            sortValue: (m) => m.ym,
            render: (m) => monthLabelFull(m.ym),
          },
          {
            key: "income",
            type: "money",
            label: "Доходы",
            sortValue: (m) => m.income,
            render: (m) => formatMoney(m.income, base),
          },
          {
            key: "expense",
            type: "money",
            label: "Расходы",
            sortValue: (m) => m.expense,
            render: (m) => formatMoney(m.expense, base),
          },
          {
            key: "net",
            type: "main",
            tone: (m) => toneOfSigned(m.net),
            label: "Чистый",
            sortValue: (m) => m.net,
            render: (m) => formatMoney(m.net, base, { signed: true }),
          },
          {
            key: "rate",
            type: "pct",
            label: "Норма сбер.",
            sortValue: (m) => (m.income > 0 ? (m.income - m.expense) / m.income : null),
            render: (m) => (m.income > 0 ? formatPct((m.income - m.expense) / m.income, 0) : "—"),
          },
          {
            key: "count",
            type: "count",
            label: "Операций",
            sortValue: (m) => m.count,
            render: (m) => formatNum(m.count),
          },
        ]}
      />
    </div>
  );
}
