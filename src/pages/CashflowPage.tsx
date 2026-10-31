import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
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
import { ChartContainer } from "../components/ChartContainer";
import {
  TrendingDown,
  TrendingUp,
  Wallet,
  List,
  BarChart3,
  CalendarRange,
  Layers,
  FlipVertical2,
  LineChart as LineChartIcon,
  Sparkles,
  Table as TableIcon,
  ChevronRight,
} from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useDisplayStore } from "../store/useDisplayStore";
import { useMediaQuery } from "../hooks/useMediaQuery";
import clsx from "clsx";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { colorForCategory } from "../lib/categoryColor";
import { useFiltersStore, applyFilters, presetToRange } from "../store/useFiltersStore";
import { useLocalPeriod } from "../hooks/useLocalPeriod";
import { useDrillStore } from "../store/useDrillStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { periodKey, periodRange, shiftDays, spanDays } from "../lib/period";
import {
  groupByMonth,
  computeKPI,
  buildInsights,
  buildScenarioForecast,
  yearOverYearMonthly,
  vsAverageStats,
  buildStreamData,
  buildMirrorData,
  detectSeasonality,
  type MirrorLayer,
  type MirrorPoint,
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
  chartTotalStroke,
  monthTitle,
  niceStep,
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
import type { MonthBucket, ScenarioForecast } from "../lib/aggregations";
import { clickedRow } from "../lib/chartClick";
import { forecastMonths } from "../lib/cashflowForecast";
import { useInBalanceTransactions } from "../hooks/useInBalanceTransactions";

export function CashflowPage() {
  // Без движений по счетам вне баланса, пока они не считаются, — как во всех
  // итогах сервиса (Настройки → Расчёты → «Счета вне баланса»).
  const transactions = useInBalanceTransactions();
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
      windowShift: lp.windowShift,
      monthYM: lp.monthYM,
      from: lp.from,
      to: lp.to,
    }),
    [filters, lp.preset, lp.windowShift, lp.monthYM, lp.from, lp.to]
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
  const insights = useMemo(() => buildInsights(filtered, monthStartDay), [filtered, monthStartDay]);
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
  const [vizMode, setVizMode] = useState<"bars" | "stream" | "mirror">("bars");
  // Границы периода графика — чтобы пометить крайние неполные месяцы и понять,
  // не короткий ли период.
  const periodBounds = useMemo(() => {
    if (lp.preset === "custom") return { from: lp.from, to: lp.to };
    const maxDate = transactions.reduce((m, t) => (t.date > m ? t.date : m), "");
    return presetToRange(lp.preset, maxDate, lp.monthYM, monthStartDay, lp.windowShift);
  }, [lp.preset, lp.windowShift, lp.from, lp.to, lp.monthYM, transactions, monthStartDay]);
  // Короткий период (месяц, 30 дней, свои даты до двух месяцев) — графики по
  // дням: помесячно там была бы одна точка. Дни — от начала периода до его
  // конца или до последней операции, если период ещё идёт.
  const dayKeys = useMemo(() => {
    const { from, to } = periodBounds;
    if (!from || !to) return null;
    const last = transactions.reduce((m, t) => (t.date > m ? t.date : m), "");
    const end = last && last < to ? (last < from ? from : last) : to;
    if (spanDays(from, end) > DAILY_MAX_DAYS) return null;
    const out: string[] = [];
    for (let d = from; d <= end; d = shiftDays(d, 1)) out.push(d);
    return out;
  }, [periodBounds, transactions]);
  const daily = dayKeys !== null;
  const buckets = useMemo(() => (dayKeys ? { keyOf: (d: string) => d, keys: dayKeys } : undefined), [dayKeys]);
  const stream = useMemo(
    () => buildStreamData(filtered, 10, "expense", monthStartDay, buckets),
    [filtered, monthStartDay, buckets]
  );
  // «Зеркало»: доходы слоями вверх, расходы слоями вниз — один взгляд на то,
  // откуда пришли деньги, куда ушли и какая сторона в каком месяце перевесила.
  const mirror = useMemo(
    () => buildMirrorData(filtered, { topIncome: 5, topExpense: 7, monthStartDay, buckets }),
    [filtered, monthStartDay, buckets]
  );
  // «Бары» по дням: доходы и расходы дня, линия — итог с начала периода.
  const dailyBars = useMemo(() => {
    if (!dayKeys) return [];
    const by = new Map(dayKeys.map((d) => [d, { income: 0, expense: 0 }]));
    for (const t of filtered) {
      const b = by.get(t.date);
      if (!b) continue;
      if (t.kind === "income") b.income += t.amountBase;
      else if (t.kind === "expense") b.expense += t.amountBase;
      else if (t.kind === "refund") b.expense -= t.amountBase;
    }
    let run = 0;
    return dayKeys.map((d) => {
      const b = by.get(d)!;
      run += b.income - b.expense;
      return { ym: d, income: Math.round(b.income), expense: Math.round(b.expense), net: Math.round(run) };
    });
  }, [dayKeys, filtered]);
  /** Столбик или точка графика — месяц или день, смотря по периоду. */
  function openBucket(key: string) {
    if (!daily) return openMonth(key);
    showDrill(dayTitle(key), filtered.filter((t) => t.date === key), "День");
  }

  // Seasonality
  const seasonality = useMemo(() => detectSeasonality(dimensionFiltered), [dimensionFiltered]);

  function openMonth(ym: string) {
    const txs = filtered.filter(
      (t) =>
        (monthStartDay === 1 ? ymKey(t.date) : periodKey(t.date, monthStartDay)) ===
        ym
    );
    showDrill(monthTitle(ym), txs, "Месяц");
  }
  function openAll() {
    showDrill("Все операции (с фильтрами)", filtered, "Период");
  }

  if (transactions.length === 0) return <EmptyState />;

  // Прогноз считается по всей истории, а на графике — столбцы только
  // выбранного периода и прогнозные месяцы, если период доходит до конца
  // истории (см. lib/cashflowForecast: для прошлого периода прогноза нет, на
  // коротком он короче). Доходы и расходы заполнены у всех месяцев — и
  // прошлых, и прогнозных: две серии столбцов без пустых мест и без разрыва
  // между прошлым и прогнозом. Прогнозные месяцы отличаются оформлением
  // (<Cell>: светлее и пунктиром).
  const periodYms = new Set(months.map((m) => m.ym));
  const history = scenarios.filter((p) => !p.isForecast);
  const lastHistYm = history.length ? history[history.length - 1].ym : null;
  const periodEnd = lp.preset === "custom" ? lp.to : periodBounds.to;
  const nForecast = daily
    ? 0
    : forecastMonths({
        lastHistYm,
        periodEndYm: periodEnd ? (monthStartDay === 1 ? ymKey(periodEnd) : periodKey(periodEnd, monthStartDay)) : null,
        shownMonths: history.filter((p) => periodYms.has(p.ym)).length,
      });
  const forecast = scenarios.filter((p) => p.isForecast).slice(0, nForecast);
  const chartData = [...history.filter((p) => periodYms.has(p.ym)), ...forecast]
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
  // Стык сплошной линии «Чистый поток» с пунктиром прогноза: последнему
  // месяцу истории даём и прогнозные значения, чтобы линии и коридор
  // сходились. Только когда прогноз есть — иначе у прошлого периода в
  // подсказке последнего месяца появлялся «Прогноз (реалист)».
  const lastHistIdx = chartData.reduce((acc, r, i) => (r.isForecast ? acc : i), -1);
  if (lastHistIdx >= 0 && forecast.length > 0) {
    const n = chartData[lastHistIdx].net;
    chartData[lastHistIdx].netForecastMid = n;
    chartData[lastHistIdx].netForecastTop = n;
    chartData[lastHistIdx].netForecastBottom = n;
  }

  const monthsCount = months.length || 1;
  const avgMonthlyExpense = kpi.expense / monthsCount;
  const avgMonthlyIncome = kpi.income / monthsCount;
  const savingsRate = kpi.income > 0 ? (kpi.income - kpi.expense) / kpi.income : 0;

  // Сравнение текущего месяца со средним — под графиком. В «Зеркале» оно
  // встаёт между графиком и легендой, а не под ней.
  const vsAvgRow =
    vsAvg.current && vsAvg.avg.expense > 0 ? (
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
    ) : null;

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
          icon={vizMode === "bars" ? BarChart3 : vizMode === "stream" ? Layers : FlipVertical2}
          title={
            vizMode === "bars"
              ? daily
                ? "Доходы и расходы по дням"
                : "Доходы и расходы по месяцам"
              : vizMode === "stream"
                ? "Поток расходов по категориям"
                : "Доходы и расходы по категориям"
          }
          subtitle={
            vizMode === "bars"
              ? daily
                ? "Столбцы — суммы дня, линия — итог с начала периода"
                : "Столбцы — суммы, линия — чистый поток"
              : vizMode === "stream"
                ? "Категории как реки расходов во времени"
                : "Доходы — вверх от оси, расходы — вниз, слоями по категориям"
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
                  { value: "mirror", label: "Зеркало", icon: FlipVertical2 },
                ]}
              />
              <div className="text-xs text-muted">{daily ? `${dayKeys!.length} дн.` : `${months.length} мес.`}</div>
            </>
          }
        />
        {/* Справа от графика — помесячная сводка, а где прогноз уместен, по
            переключателю — и он. Отдельной таблицей во всю ширину под
            страницей сводка была растянута ради нескольких узких столбцов. */}
        {/* Сводка справа — поверх запаса справа у графика. Шеврон на линии
            между ними уводит её вправо сдвигом (transform — без перестройки
            страницы на каждом кадре, поэтому плавно), а график перестраивается
            под новую ширину один раз и мягко проявляется (ChartContainer).
            Анимировать саму ширину колонки нельзя: график перерисовывался бы
            на каждом кадре и дёргался. */}
        <SummarySplit panel={{ months, forecast, base, onMonth: openMonth }}>
        {/* «Зеркалу» выше: под графиком ещё легенда по сторонам. */}
        <div className={vizMode === "mirror" ? "h-[32rem]" : "h-80"}>
          {vizMode === "bars" && daily ? (
            <DailyBarsChart data={dailyBars} base={base} onDay={openBucket} />
          ) : vizMode === "bars" ? (
          <ChartContainer>
            <ComposedChart
              data={chartData}
              // Столбцы держим компактной парой у центра месяца, чтобы линия
              // и коридор прогноза (они идут через центр месяца) визуально
              // накрывали оба столбца, а не обрывались перед крайним красным.
              barCategoryGap="30%"
              barGap={0}
              maxBarSize={15}
              onClick={(e: unknown) => {
                const ym = clickedRow(e, chartData)?.ym;
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
                    ].filter((it) => it.label !== "Прогноз" || forecast.length > 0).map((it) => (
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
          </ChartContainer>
          ) : vizMode === "mirror" ? (
            <MirrorChart
              data={mirror.data}
              layers={mirror.layers}
              base={base}
              onMonth={openBucket}
              bounds={periodBounds}
              daily={daily}
              monthStartDay={monthStartDay}
              summary={vsAvgRow}
            />
          ) : (
            <ChartContainer>
              <AreaChart
                data={stream.data}
                stackOffset="silhouette"
                onClick={(e: unknown) => {
                  const ym = (clickedRow(e, stream.data) as { ym?: string } | undefined)?.ym;
                  if (ym) openBucket(ym);
                }}
                style={{ cursor: "pointer" }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                <XAxis
                  dataKey="label"
                  stroke={chartAxisStroke}
                  fontSize={11}
                  tickFormatter={(d) => (daily ? dayTick(String(d)) : monthLabel(String(d)))}
                  minTickGap={40}
                />
                <YAxis hide />
                <Tooltip
                  {...chartTooltipProps}
                  content={
                    <SeriesTooltip
                      hideZero
                      formatValue={(v) => formatMoney(v, base)}
                      formatLabel={(d) => (daily ? dayTitle(String(d)) : monthLabel(String(d)))}
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
            </ChartContainer>
          )}
        </div>
        {vizMode !== "mirror" && vsAvgRow}
        </SummarySplit>
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
            <ChartContainer>
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
            </ChartContainer>
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
            <ChartContainer>
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
                <Bar dataKey="avgExpense" name="Средний расход" radius={[4, 4, 0, 0]} activeBar={false} isAnimationActive={false}>
                  {seasonality.map((s, i) => {
                    const dev = s.expenseDeviationPct;
                    const color =
                      dev > 0.15 ? chartColor.expense : dev < -0.15 ? chartColor.income : chartColor.accent2;
                    return <Cell key={i} fill={color} />;
                  })}
                </Bar>
              </ComposedChart>
            </ChartContainer>
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

    </div>
  );
}

/**
 * График и сводка справа от него. Свёрнута ли сводка, знает только этот
 * компонент: график сюда приходит готовым (`children`), и по шеврону
 * перерисовываются лишь обёртка и панель, а не вся страница с её графиками —
 * иначе в момент нажатия анимация запиналась.
 */
function SummarySplit({
  children,
  panel,
}: {
  children: ReactNode;
  panel: Omit<Parameters<typeof MonthlySidePanel>[0], "shown" | "onToggle">;
}) {
  // Выбор запоминается. Сворачивается только рядом с графиком: на узком окне
  // сводка стоит под ним и места не отнимает.
  const open = useDisplayStore((s) => s.cashflowSummary);
  const setOpen = useDisplayStore((s) => s.setCashflowSummary);
  const wide = useMediaQuery("(min-width: 1024px)");
  const shown = open || !wide;
  return (
    <div className="relative lg:overflow-x-clip">
      <div className={clsx("min-w-0 [&_.recharts-tooltip-wrapper]:z-20", shown ? "lg:pr-[30rem]" : "lg:pr-8")}>
        {children}
      </div>
      <MonthlySidePanel {...panel} shown={shown} onToggle={() => void setOpen(!open)} />
    </div>
  );
}

/**
 * Помесячная сводка справа от графика. Где прогноз уместен (см.
 * lib/cashflowForecast), переключатель «Сводка / Прогноз» показывает и
 * прогнозные месяцы. Норма сбережений и число операций — в подсказке
 * «Чистого»: отдельными столбцами панель не помещалась рядом с графиком, а в
 * выгрузке CSV они есть.
 *
 * На широком окне панель ровно в высоту графика и прокручивается внутри;
 * на узком встаёт под графиком.
 */
function MonthlySidePanel({
  months,
  forecast,
  base,
  onMonth,
  shown,
  onToggle,
}: {
  months: MonthBucket[];
  forecast: ScenarioForecast[];
  base: string;
  onMonth: (ym: string) => void;
  /** Свёрнута шевроном — уехала вправо, содержимое погасло и недоступно. */
  shown: boolean;
  onToggle: () => void;
}) {
  const [tab, setTab] = useState<"summary" | "forecast">("summary");
  const [exportSlot, setExportSlot] = useState<HTMLSpanElement | null>(null);
  const showForecast = tab === "forecast" && forecast.length > 0;
  const rate = (m: MonthBucket) => (m.income > 0 ? (m.income - m.expense) / m.income : null);
  return (
    // Свёрнутая — сдвинута вправо почти целиком: на виду остаётся только
    // шеврон у правого края графика.
    <section
      id="cashflow-side"
      aria-label={showForecast ? "Прогноз по месяцам" : "Помесячная сводка"}
      data-cashflow-side={shown ? "" : undefined}
      className={clsx(
        "relative min-w-0 max-lg:mt-4 lg:absolute lg:inset-y-0 lg:right-0 lg:w-[29rem]",
        "lg:transition-transform lg:duration-[var(--motion-slow)] lg:ease-[var(--ease-soft)] motion-reduce:transition-none",
        !shown && "lg:translate-x-[calc(29rem-0.75rem)]"
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={shown}
        aria-controls="cashflow-side-body"
        aria-label={shown ? "Скрыть сводку" : "Показать сводку"}
        title={shown ? "Скрыть сводку" : "Показать сводку"}
        data-cashflow-toggle
        className="hidden lg:grid place-items-center absolute left-0 top-1/2 z-10 w-6 h-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-panel text-muted shadow-sm transition-colors duration-[var(--motion-fast)] hover:text-accent hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <ChevronRight
          className={clsx(
            "w-3.5 h-3.5 transition-transform duration-[var(--motion-slow)] ease-[var(--ease-soft)] motion-reduce:transition-none",
            !shown && "rotate-180"
          )}
          aria-hidden
        />
      </button>
      <div
        id="cashflow-side-body"
        inert={!shown}
        className={clsx(
          "flex flex-col lg:h-full lg:border-l lg:border-border lg:pl-4",
          "transition-opacity duration-[var(--motion-slow)] ease-[var(--ease-soft)] motion-reduce:transition-none",
          !shown && "lg:opacity-0"
        )}
      >
        <div className="flex items-center justify-between gap-2 mb-2 min-h-[34px]">
          {forecast.length > 0 ? (
            <Segmented
              size="sm"
              label="Сводка или прогноз"
              value={showForecast ? "forecast" : "summary"}
              onChange={setTab}
              options={[
                { value: "summary", label: "Сводка", icon: TableIcon },
                { value: "forecast", label: "Прогноз", icon: Sparkles },
              ]}
            />
          ) : (
            <span className="inline-flex items-center gap-2 text-sm font-semibold">
              <TableIcon className="w-4 h-4 text-accent" aria-hidden />
              Помесячная сводка
            </span>
          )}
          {!showForecast && <span ref={setExportSlot} className="flex" />}
        </div>
        {/* Место под полосу прокрутки — всегда: иначе с прокруткой и без неё
            столбцы были бы разной ширины. */}
        <div data-cashflow-scroll className="flex-1 min-h-0 overflow-y-auto [scrollbar-gutter:stable] max-lg:max-h-80">
          {showForecast ? (
            <DataTable<ScenarioForecast>
              bare
              stickyHead
              density="compact"
              exportable={false}
              data={forecast}
              rowKey={(p) => p.ym}
              columns={[
                {
                  key: "ym",
                  type: "text",
                  label: "Месяц",
                  sortable: false,
                  render: (p) => <span className="whitespace-nowrap">{monthLabel(p.ym)}</span>,
                },
                {
                  key: "income",
                  type: "money",
                  label: "Доходы",
                  sortable: false,
                  render: (p) => formatMoney(p.income, base),
                },
                {
                  key: "expense",
                  type: "money",
                  label: "Расходы",
                  sortable: false,
                  render: (p) => formatMoney(p.expense, base),
                },
                {
                  key: "net",
                  type: "main",
                  tone: (p) => toneOfSigned(p.realistic),
                  label: "Чистый",
                  sortable: false,
                  cellTitle: (p) =>
                    `Коридор: от ${formatMoney(p.pessimistic, base, { signed: true })} до ${formatMoney(p.optimistic, base, { signed: true })}`,
                  render: (p) => formatMoney(p.realistic, base, { signed: true }),
                },
              ]}
            />
          ) : (
            <DataTable<MonthBucket>
              bare
              stickyHead
              density="compact"
              exportSlot={exportSlot}
              exportName="cashflow_monthly"
              data={months}
              rowKey={(m) => m.ym}
              defaultSortKey="ym"
              defaultSortDir="desc"
              onRowClick={(m) => onMonth(m.ym)}
              columns={[
                {
                  key: "ym",
                  type: "text",
                  label: "Месяц",
                  sortValue: (m) => m.ym,
                  exportValue: (m) => monthLabelFull(m.ym),
                  render: (m) => <span className="whitespace-nowrap">{monthLabel(m.ym)}</span>,
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
                  cellTitle: (m) => {
                    const r = rate(m);
                    const ops = `${formatNum(m.count)} ${pluralRu(m.count, ["операция", "операции", "операций"])}`;
                    return r === null ? ops : `Норма сбережений ${formatPct(r, 0)} · ${ops}`;
                  },
                  render: (m) => formatMoney(m.net, base, { signed: true }),
                },
                // Только в выгрузке: в панели не помещаются, видны в подсказке «Чистого».
                {
                  key: "rate",
                  type: "pct",
                  label: "Норма сбер.",
                  exportOnly: true,
                  sortValue: rate,
                  render: () => null,
                },
                {
                  key: "count",
                  type: "count",
                  label: "Операций",
                  exportOnly: true,
                  sortValue: (m) => m.count,
                  render: () => null,
                },
              ]}
            />
          )}
        </div>
      </div>
    </section>
  );
}

/** Прозрачность слоя: ближний к оси — плотный, дальние — светлее. */
function layerOpacity(i: number, n: number): number {
  return n <= 1 ? 0.85 : 0.85 - (0.55 * i) / (n - 1);
}

/** «15 октября» по «ГГГГ-ММ-ДД». */
function dayMonth(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

/**
 * «Зеркало»: доходы стопкой вверх от оси, расходы — вниз, поверх — итог месяца
 * линией. Слои одного цвета стороны разной плотности: плюс и минус читаются
 * сразу, а категория — по легенде (наведение на неё высвечивает слой) и
 * подсказке. Нажатие на месяц открывает его операции.
 */
function MirrorChart({
  data,
  layers,
  base,
  onMonth,
  bounds,
  monthStartDay,
  summary,
  daily = false,
}: {
  data: MirrorPoint[];
  layers: MirrorLayer[];
  base: string;
  onMonth: (ym: string) => void;
  /** Границы периода графика: крайние месяцы могут попасть в него не целиком. */
  bounds: { from: string | null; to: string | null };
  monthStartDay: number;
  /** Сводка «… от среднего» — сразу под графиком, до легенды. */
  summary?: ReactNode;
  /** Точки — дни короткого периода, а не месяцы. */
  daily?: boolean;
}) {
  const [focus, setFocus] = useState<string | null>(null);
  const income = layers.filter((l) => l.side === "income");
  const expense = layers.filter((l) => l.side === "expense");
  // Стопка «по знаку» считает ноль плюсом: месяц без трат в категории
  // поднимал её слой к доходам, и переход к тратам рисовался дугой через ось.
  // Пустой расход — чуть ниже нуля, слой остаётся внизу.
  const chartData = useMemo(
    () =>
      data.map((p) => {
        const q: MirrorPoint = { ...p, net: p.income - p.expense };
        for (const l of expense) if (q[l.key] === 0) q[l.key] = -1e-6;
        return q;
      }),
    [data, expense]
  );
  // Ось — по данным, а не зеркально: расходы вдвое меньше доходов — и низ
  // графика не пустует наполовину.
  const maxUp = Math.max(0, ...data.map((p) => p.income));
  const maxDown = Math.max(0, ...data.map((p) => p.expense));
  const step = niceStep(Math.max(maxUp, maxDown) / 3 || 1);
  const top = Math.ceil(maxUp / step) * step;
  const bottom = -Math.ceil(maxDown / step) * step;
  const ticks: number[] = [];
  for (let v = bottom; v <= top + 1e-6; v += step) ticks.push(v);

  // Крайние месяцы, попавшие в период не целиком: подписываем в подсказке.
  const partial = (ym: string): string | null => {
    if (daily) return null;
    const r = periodRange(ym, monthStartDay);
    const from = bounds.from && bounds.from > r.from ? bounds.from : null;
    const to = bounds.to && bounds.to < r.to ? bounds.to : null;
    if (from && to) return `Неполный месяц: с ${dayMonth(from)} по ${dayMonth(to)}`;
    if (from) return `Неполный месяц: с ${dayMonth(from)}`;
    if (to) return `Неполный месяц: по ${dayMonth(to)}`;
    return null;
  };

  const colorOf = (l: MirrorLayer) => (l.side === "income" ? chartColor.income : chartColor.expense);
  const opacityOf = (l: MirrorLayer) => {
    const group = l.side === "income" ? income : expense;
    const base0 = layerOpacity(group.indexOf(l), group.length);
    return focus && focus !== l.key ? base0 * 0.18 : focus === l.key ? 0.9 : base0;
  };
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0">
        <ChartContainer>
          <ComposedChart
            data={chartData}
            stackOffset="sign"
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            onClick={(e: unknown) => {
              const ym = (clickedRow(e, chartData) as { ym?: string } | undefined)?.ym;
              if (ym) onMonth(ym);
            }}
            style={{ cursor: "pointer" }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} vertical={false} />
            <XAxis
              dataKey="ym"
              stroke={chartAxisStroke}
              fontSize={11}
              tickFormatter={(d) => (daily ? dayTick(String(d)) : monthLabel(String(d)))}
              minTickGap={daily ? 12 : 40}
            />
            <YAxis
              stroke={chartAxisStroke}
              fontSize={11}
              width={56}
              domain={[bottom, top]}
              ticks={ticks}
              tickFormatter={(v: number) => formatNum(Math.abs(v), { compact: true })}
            />
            <Tooltip
              {...chartTooltipProps}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as MirrorPoint | undefined;
                if (!active || !p) return null;
                const row = (l: MirrorLayer) => {
                  const v = Math.abs(Number(p[l.key] ?? 0));
                  return v >= 0.5 ? [{ label: l.name, value: formatMoney(v, base), swatchColor: colorOf(l) }] : [];
                };
                const net = p.income - p.expense;
                return (
                  <ChartTooltipCard>
                    <TooltipFacts
                      title={daily ? dayTitle(p.ym) : monthLabelFull(p.ym)}
                      facts={[
                        { label: "Доходы", value: formatMoney(p.income, base), tone: "income" as const, strong: true },
                        ...income.flatMap(row),
                        { label: "Расходы", value: formatMoney(p.expense, base), tone: "expense" as const, strong: true },
                        ...expense.flatMap(row),
                        {
                          label: daily ? "Итог дня" : "Итог месяца",
                          value: formatMoney(net, base, { signed: true }),
                          tone: net >= 0 ? ("income" as const) : ("expense" as const),
                          strong: true,
                        },
                      ]}
                      note={partial(p.ym) ?? undefined}
                    />
                  </ChartTooltipCard>
                );
              }}
            />
            {layers.map((l) => (
              <Area
                key={l.key}
                type="monotone"
                dataKey={l.key}
                name={l.name}
                stackId="mirror"
                stroke="rgb(var(--c-panel))"
                strokeWidth={1}
                fill={colorOf(l)}
                fillOpacity={opacityOf(l)}
                isAnimationActive={false}
              />
            ))}
            {/* Ось времени — граница доходов и расходов. */}
            <ReferenceLine y={0} stroke={chartAxisStroke} strokeWidth={1.5} />
            {/* Итог месяца — доходы минус расходы: выше оси — месяц в плюсе. */}
            <Line
              type="monotone"
              dataKey="net"
              name={daily ? "Итог дня" : "Итог месяца"}
              stroke={chartTotalStroke}
              strokeWidth={2}
              dot={{ r: 2.5, fill: chartTotalStroke, strokeWidth: 0 }}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ChartContainer>
      </div>
      {summary}
      {/* Легенда: две колонки — доходы и расходы с суммой за период, категории
          плашками с суммой; наведение на плашку высвечивает её слой. */}
      <div className="mt-3 grid gap-x-8 gap-y-3 lg:grid-cols-[2fr_3fr]" onMouseLeave={() => setFocus(null)}>
        {([
          ["Доходы", income, "text-income"],
          ["Расходы", expense, "text-expense"],
        ] as const).map(([title, group, tone]) =>
          group.length === 0 ? null : (
            <div key={title} className="min-w-0">
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className="caps-label">{title}</span>
                <span className={`text-sm font-semibold tabular-nums ${tone}`}>
                  {formatMoney(group.reduce((sum, l) => sum + l.total, 0), base)}
                </span>
                <span className="text-xs text-muted">за период</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {group.map((l, i) => (
                  <span
                    key={l.key}
                    data-mirror-legend={l.key}
                    onMouseEnter={() => setFocus(l.key)}
                    onMouseLeave={() => setFocus(null)}
                    className={`inline-flex items-center gap-1.5 rounded-control-sm border px-2 py-1 text-xs cursor-default transition-colors ${
                      focus === l.key ? "border-border bg-panel2" : "border-transparent bg-panel2/50"
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-[3px] shrink-0"
                      style={{ background: colorOf(l), opacity: layerOpacity(i, group.length) }}
                    />
                    <span>{l.name}</span>
                    <span className="text-muted tabular-nums">{formatMoney(l.total, base, { compact: true })}</span>
                  </span>
                ))}
              </div>
            </div>
          )
        )}
        <div className="lg:col-span-2 flex items-center gap-2 text-xs text-muted">
          <span className="w-4 h-0.5 rounded-full" style={{ background: chartTotalStroke }} />
          <span>
            <span className="text-text font-medium">{daily ? "Итог дня" : "Итог месяца"}</span> — доходы минус расходы:
            выше оси {daily ? "день" : "месяц"} в плюсе, ниже — в минусе
          </span>
        </div>
      </div>
    </div>
  );
}

/** Дальше — помесячно: по дням столбики слишком тонкие. */
const DAILY_MAX_DAYS = 62;

/** «5» — число месяца на оси. */
function dayTick(d: string): string {
  return String(Number(d.slice(8)));
}

/** «Пн, 5 октября» — заголовок подсказки и боковой панели. */
function dayTitle(d: string): string {
  const [y, m, dd] = d.split("-").map(Number);
  const s = new Date(y, m - 1, dd).toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * «Бары» короткого периода: доходы и расходы по дням, линия — итог с начала
 * периода (дневной «чистый поток» скачет от нуля к зарплате и ничего не
 * говорит). Прогноза нет — он помесячный.
 */
function DailyBarsChart({
  data,
  base,
  onDay,
}: {
  data: { ym: string; income: number; expense: number; net: number }[];
  base: string;
  onDay: (d: string) => void;
}) {
  return (
    <ChartContainer>
      <ComposedChart
        data={data}
        barCategoryGap="20%"
        barGap={0}
        maxBarSize={14}
        onClick={(e: unknown) => {
          const d = (clickedRow(e, data) as { ym?: string } | undefined)?.ym;
          if (d) onDay(d);
        }}
        style={{ cursor: "pointer" }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} vertical={false} />
        <XAxis dataKey="ym" stroke={chartAxisStroke} fontSize={11} tickFormatter={(d) => dayTick(String(d))} minTickGap={12} />
        <YAxis stroke={chartAxisStroke} fontSize={11} tickFormatter={(v) => formatNum(v, { compact: true })} />
        <Tooltip
          {...chartTooltipProps}
          content={<SeriesTooltip formatValue={(v) => formatMoney(v, base)} formatLabel={(d) => dayTitle(String(d))} />}
        />
        <Legend
          content={() => (
            <div className="flex flex-wrap justify-center gap-4 pt-1 text-xs">
              {[
                { label: "Доходы", color: chartColor.income, bar: true },
                { label: "Расходы", color: chartColor.expense, bar: true },
                { label: "Итог с начала периода", color: chartColor.accent, bar: false },
              ].map((it) => (
                <span key={it.label} className="inline-flex items-center gap-1.5" style={{ color: it.color }}>
                  {it.bar ? (
                    <span style={{ width: 12, height: 12, borderRadius: 2, background: it.color }} />
                  ) : (
                    <span style={{ width: 16, borderTop: `2px solid ${it.color}` }} />
                  )}
                  {it.label}
                </span>
              ))}
            </div>
          )}
        />
        <ReferenceLine y={0} stroke={chartAxisStroke} />
        <Bar dataKey="income" name="Доходы" fill={chartColor.income} radius={[3, 3, 0, 0]} activeBar={false} isAnimationActive={false} />
        <Bar dataKey="expense" name="Расходы" fill={chartColor.expense} radius={[3, 3, 0, 0]} activeBar={false} isAnimationActive={false} />
        <Line type="linear" dataKey="net" name="Итог с начала периода" stroke={chartColor.accent} strokeWidth={2} dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ChartContainer>
  );
}
