import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  Tooltip,
  ComposedChart,
  Bar,
  Line,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  PiggyBank,
  ArrowRight,
  CalendarDays,
  Repeat,
  Hash,
  GitCompare,
  PieChart,
  LayoutDashboard,
} from "lucide-react";
import { useEffect } from "react";
import { useDataStore } from "../store/useDataStore";
import { useDrillStore } from "../store/useDrillStore";
import { useCalibrationStore } from "../store/useCalibrationStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useOffBalanceStore } from "../store/useOffBalanceStore";
import { currentPeriod, periodKey } from "../lib/period";
import {
  groupByMonth,
  groupByCategory,
  buildInsights,
  detectRecurring,
  dailyExpenseMap,
  buildForecast,
  splitByObligation,
  balancesByAccount,
} from "../lib/aggregations";
import { useNetWorthSeries } from "../hooks/useNetWorthSeries";
import {
  getLiveAccountsFromCache,
  type LiveAccount,
} from "../store/useZenmoneyStore";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { CategoryDot } from "../components/CategoryDot";
import {
  formatMoney,
  formatNum,
  formatPct,
  formatDate,
  monthLabel,
  toNum,
  chartTooltipProps,
  chartGridStroke,
  chartAxisStroke,
  ymdKey,
} from "../lib/format";
import { affectsExpense } from "../lib/txKindStyle";
import { AccountLogo } from "../components/AccountLogo";
import { accountTypeLabel } from "../lib/accountType";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { InsightsPanel } from "../components/InsightsPanel";
import { QuickCalibration } from "../components/QuickCalibration";
import type { DayCell } from "../lib/aggregations";

const HEATMAP_COLORS = [
  "rgb(var(--c-panel2))",
  "rgba(239, 68, 68, 0.10)",
  "rgba(239, 68, 68, 0.20)",
  "rgba(239, 68, 68, 0.32)",
  "rgba(239, 68, 68, 0.46)",
  "rgba(239, 68, 68, 0.60)",
  "rgba(239, 68, 68, 0.74)",
  "rgba(239, 68, 68, 0.88)",
  "rgba(220, 38, 38, 1)",
];

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTH_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

// Zenmoney account-type strings → Russian labels for the dashboard table.
function buildBins(values: number[], n = 8): number[] {
  const positives = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (positives.length === 0) return [];
  const out: number[] = [];
  for (let i = 1; i <= n - 1; i++) {
    const idx = Math.floor((i / n) * positives.length);
    out.push(positives[Math.min(idx, positives.length - 1)]);
  }
  return out;
}

function binIndex(v: number, thresholds: number[]): number {
  if (v <= 0) return 0;
  if (thresholds.length === 0) return v > 0 ? HEATMAP_COLORS.length - 1 : 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (v <= thresholds[i]) return i + 1;
  }
  return HEATMAP_COLORS.length - 1;
}

function MiniHeatmap({
  dayMap,
  days = 90,
  base,
}: {
  dayMap: Map<string, DayCell>;
  days?: number;
  base: string;
}) {
  const today = new Date();
  const cells: { date: string; cell?: DayCell }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = ymdKey(d.toISOString().slice(0, 10));
    cells.push({ date: key, cell: dayMap.get(key) });
  }

  const thresholds = buildBins(
    cells.map((c) => c.cell?.expense || 0),
    HEATMAP_COLORS.length - 1
  );

  const startDow = (new Date(cells[0].date).getDay() + 6) % 7;
  const totalSlots = startDow + cells.length;
  const numCols = Math.ceil(totalSlots / 7);

  const grid: ({ date: string; cell?: DayCell } | null)[][] = Array.from(
    { length: 7 },
    () => Array(numCols).fill(null)
  );

  let slot = startDow;
  for (const c of cells) {
    const row = slot % 7;
    const col = Math.floor(slot / 7);
    grid[row][col] = c;
    slot++;
  }

  const monthLabels: { col: number; label: string }[] = [];
  let lastMonth = -1;
  for (let col = 0; col < numCols; col++) {
    for (let row = 0; row < 7; row++) {
      const c = grid[row][col];
      if (c?.date) {
        const m = new Date(c.date).getMonth();
        if (m !== lastMonth) {
          monthLabels.push({ col, label: MONTH_SHORT[m] });
          lastMonth = m;
        }
        break;
      }
    }
  }

  return (
    <div className="flex gap-1.5">
      <div className="flex flex-col gap-[2px] pt-4 shrink-0">
        {WEEKDAY_LABELS.map((w, i) => (
          <div
            key={w}
            className="text-[10px] text-muted leading-none flex items-center"
            style={{ height: "calc((100% - 12px) / 7)", minHeight: 14 }}
          >
            {i % 2 === 1 ? w : ""}
          </div>
        ))}
      </div>
      <div className="flex-1 flex flex-col gap-[2px]">
        <div className="flex gap-[2px] h-3 relative">
          {monthLabels.map((m) => (
            <div
              key={m.col}
              className="text-[10px] text-muted absolute"
              style={{ left: `calc(${(m.col / numCols) * 100}% + 1px)` }}
            >
              {m.label}
            </div>
          ))}
        </div>
        {grid.map((row, i) => (
          <div key={i} className="flex gap-[2px]">
            {row.map((c, j) => {
              const v = c?.cell?.expense || 0;
              const idx = binIndex(v, thresholds);
              return (
                <div
                  key={j}
                  title={
                    c?.date
                      ? `${formatDate(c.date)}: ${
                          c.cell ? formatMoney(c.cell.expense, base) : "—"
                        }${c.cell ? ` · ${c.cell.count} оп.` : ""}`
                      : ""
                  }
                  className="flex-1 aspect-square rounded-[3px] border border-border/30"
                  style={{
                    background: c ? HEATMAP_COLORS[idx] : "transparent",
                    borderColor: c ? undefined : "transparent",
                  }}
                />
              );
            })}
          </div>
        ))}
        <div className="flex items-center justify-end gap-1.5 mt-2 text-[10px] text-muted">
          <span>меньше</span>
          {HEATMAP_COLORS.map((c, i) => (
            <span
              key={i}
              className="w-2.5 h-2.5 rounded-[2px] border border-border/30"
              style={{ background: c }}
            />
          ))}
          <span>больше</span>
        </div>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const showDrill = useDrillStore((s) => s.show);
  const calibration = useCalibrationStore((s) => s.calibration);
  const hydrateCalibration = useCalibrationStore((s) => s.hydrate);
  const calibLoaded = useCalibrationStore((s) => s.loaded);
  // API-mode users get auto-calibration on every sync, so the manual
  // calibration banner becomes noise. Hide it.
  const zenToken = useZenmoneyStore((s) => s.token);
  const zenHydrate = useZenmoneyStore((s) => s.hydrate);
  const zenLoaded = useZenmoneyStore((s) => s.loaded);
  useEffect(() => {
    if (!zenLoaded) zenHydrate();
  }, [zenLoaded, zenHydrate]);
  const apiConnected = !!zenToken;
  const categoryMeta = useCategoryMetaStore((s) => s.meta);
  const metaHydrate = useCategoryMetaStore((s) => s.hydrate);
  const metaLoaded = useCategoryMetaStore((s) => s.loaded);
  useEffect(() => {
    if (!calibLoaded) hydrateCalibration();
    if (!metaLoaded) metaHydrate();
  }, [calibLoaded, hydrateCalibration, metaLoaded, metaHydrate]);

  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const months = useMemo(
    () => groupByMonth(transactions, { monthStartDay }),
    [transactions, monthStartDay]
  );
  const forecast = useMemo(
    () => buildForecast(transactions, 3, 6, { monthStartDay }),
    [transactions, monthStartDay]
  );
  const netWorth = useNetWorthSeries(transactions);
  const insights = useMemo(() => {
    // Insights are most actionable when scoped to the current calendar year —
    // year-old MoM swings or annual totals are noise on a dashboard.
    const year = new Date().getFullYear().toString();
    const thisYear = transactions.filter((t) => t.date.startsWith(year));
    return buildInsights(thisYear);
  }, [transactions]);
  const recurring = useMemo(() => detectRecurring(transactions), [transactions]);
  const obligationBreakdown = useMemo(() => {
    const lastMonthYM = months[months.length - 1]?.ym;
    const lastTxs = lastMonthYM
      ? transactions.filter(
          (t) => periodKey(t.date, monthStartDay) === lastMonthYM
        )
      : transactions;
    return splitByObligation(lastTxs, categoryMeta);
  }, [categoryMeta, months, transactions, monthStartDay]);
  const dayMap = useMemo(() => dailyExpenseMap(transactions), [transactions]);

  // Account balances. If the Zenmoney cache is present, prefer real
  // per-account balances from the API (they include startBalance and any
  // server-side reconciliation). Otherwise fall back to the CSV-style
  // flow-derived totals.
  const [liveAccounts, setLiveAccounts] = useState<LiveAccount[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    getLiveAccountsFromCache().then((data) => {
      if (!cancelled) setLiveAccounts(data);
    });
    return () => {
      cancelled = true;
    };
  }, [transactions]);
  const baseRates = useDataStore((s) => s.rates);
  // Account-list filter toggles. We persist nothing — these are session-only
  // ergonomic switches matching the toggles the user sees in Zenmoney itself.
  const [hideZero, setHideZero] = useState(true);
  const [hideArchived, setHideArchived] = useState(true);
  // Off-balance accounts (Zenmoney inBalance:false — savings/brokerage) are
  // shown only when the global setting (Настройки → Обработка) is on.
  const includeOffBalance = useOffBalanceStore((s) => s.includeOffBalance);
  // PNG-export state. Declared here (with the other hooks) rather than
  // lower down — they must run before the early `return <EmptyState />`
  // so hook order stays stable across renders (rules-of-hooks).
  const accountRows = useMemo(() => {
    if (liveAccounts && liveAccounts.length > 0) {
      // Convert to base currency and sort by |balance| desc.
      return liveAccounts
        .filter((a) => (includeOffBalance ? true : a.inBalance))
        .filter((a) => (hideArchived ? !a.archive : true))
        .filter((a) => (hideZero ? Math.abs(a.balance) > 0.005 : true))
        .map((a) => ({
          title: a.title,
          balanceBase:
            a.currency === baseRates.base
              ? a.balance
              : a.balance * (baseRates.rates[a.currency] || 1),
          nativeBalance: a.balance,
          nativeCurrency: a.currency,
          type: a.type,
          archive: a.archive,
          offBalance: !a.inBalance,
        }))
        .sort((a, b) => Math.abs(b.balanceBase) - Math.abs(a.balanceBase));
    }
    return balancesByAccount(transactions)
      .filter((a) => (hideZero ? Math.abs(a.balance) > 0.005 : true))
      .map((a) => ({
        title: a.account,
        balanceBase: a.balance,
        nativeBalance: a.balance,
        nativeCurrency: base,
        type: "",
        archive: false,
        offBalance: false,
      }));
  }, [liveAccounts, transactions, base, baseRates, hideZero, hideArchived, includeOffBalance]);
  const hasArchived = !!liveAccounts?.some((a) => a.archive && a.inBalance);

  // Top-10 categories of the CURRENT month (replaces all-time top-7).
  const currentYM = useMemo(
    () => currentPeriod(monthStartDay),
    [monthStartDay]
  );
  const catsThisMonth = useMemo(() => {
    const thisMonthTxs = transactions.filter(
      (t) => periodKey(t.date, monthStartDay) === currentYM
    );
    return groupByCategory(thisMonthTxs, "top")
      .filter((c) => c.expense > 0)
      .slice(0, 10);
  }, [transactions, currentYM, monthStartDay]);

  function openAccount(title: string) {
    const txs = transactions.filter(
      (t) =>
        t.account === title ||
        t.outcomeAccount === title ||
        t.incomeAccount === title
    );
    showDrill(title, txs, "Операции по счёту");
  }

  if (transactions.length === 0) return <EmptyState />;

  const last = months[months.length - 1];
  const prev = months[months.length - 2];
  const lastNetWorth = netWorth.length ? netWorth[netWorth.length - 1].net : 0;
  // Savings rate needs income to divide by. The current month often has 0
  // income for the first days (nothing paid in yet) → fall back to the latest
  // month that actually had income, so the KPI isn't blank at every month start.
  const srMonth =
    last && last.income > 0
      ? last
      : [...months].reverse().find((m) => m.income > 0) ?? null;
  const sr = srMonth ? srMonth.net / srMonth.income : null;
  const expDelta = last && prev && prev.expense > 0 ? (last.expense - prev.expense) / prev.expense : null;
  const incDelta = last && prev && prev.income > 0 ? (last.income - prev.income) / prev.income : null;

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = recurring
    .filter((r) => r.nextExpected >= today)
    .sort((a, b) => a.nextExpected.localeCompare(b.nextExpected))
    .slice(0, 5);

  function openCategory(name: string) {
    // Include refunds for that category — they're what made the
    // displayed net total smaller in the chart the user clicked on.
    const txs = transactions.filter((t) => affectsExpense(t.kind) && t.category === name);
    showDrill(name, txs, "Расходы по категории");
  }

  function openMonth(ym: string) {
    const txs = transactions.filter(
      (t) => periodKey(t.date, monthStartDay) === ym
    );
    showDrill(monthLabel(ym), txs, "Месяц");
  }

  const forecastChart = forecast.map((p) => ({
    month: monthLabel(p.ym),
    ym: p.ym,
    income: p.isForecast ? null : Math.round(p.income),
    expense: p.isForecast ? null : Math.round(p.expense),
    incomeF: p.isForecast ? Math.round(p.income) : null,
    expenseF: p.isForecast ? Math.round(p.expense) : null,
    net: Math.round(p.net),
  }));

  const netWorthChart = netWorth.map((p) => ({ date: p.date, net: Math.round(p.net) }));

  // Only ACTIVE subscriptions (not stale ones — those whose schedule lapsed
  // by >~2 cycles). Used for both the monthly estimate and the count badge so
  // a cancelled-months-ago plan neither inflates the figure nor the count.
  const activeRecurring = recurring.filter((c) => !c.stale);
  // Active subscriptions on a monthly cadence — the headline count for the
  // «Ближайшие регулярные» widget (its estimate below is a per-month figure).
  const activeMonthly = activeRecurring.filter((c) => c.cadence === "monthly");
  const totalRecurringMonthly = activeRecurring.reduce(
    (s, c) => s + (c.avgIntervalDays > 0 ? (c.avgAmount * 30) / c.avgIntervalDays : 0),
    0
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={LayoutDashboard}
        title="Главная"
        hint="Ключевые метрики, тренды и быстрые переходы."
      />

      {!apiConnected && (
        <div data-export-skip="1">
          <QuickCalibration />
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card card-pad">
          <div className="flex items-start justify-between mb-2">
            <div className="label">Совокупный баланс</div>
            <Wallet className="w-4 h-4 text-muted" />
          </div>
          <div className={`stat-num ${lastNetWorth >= 0 ? "text-income" : "text-expense"}`}>
            {formatMoney(lastNetWorth, base, { signed: true })}
          </div>
          <div className="text-xs text-muted mt-1">
            {liveAccounts && liveAccounts.length > 0
              ? "С учётом начальных остатков счетов"
              : calibration
                ? `Откалибровано на ${calibration.date}`
                : "от 0 в начале истории"}
          </div>
        </div>

        <button
          onClick={() => last && openMonth(last.ym)}
          className="card card-pad text-left hover:border-accent transition-colors"
        >
          <div className="flex items-start justify-between mb-2">
            <div className="label">Доход {last ? monthLabel(last.ym) : ""}</div>
            <TrendingUp className="w-4 h-4 text-income" />
          </div>
          <div className="stat-num text-income">
            {last ? formatMoney(last.income, base) : "—"}
          </div>
          {incDelta !== null && (
            <div className={`text-xs mt-1 ${incDelta >= 0 ? "text-income" : "text-muted"}`}>
              {incDelta >= 0 ? "↑" : "↓"} {formatPct(Math.abs(incDelta), 1)} к пред. месяцу
            </div>
          )}
        </button>

        <button
          onClick={() => last && openMonth(last.ym)}
          className="card card-pad text-left hover:border-accent transition-colors"
        >
          <div className="flex items-start justify-between mb-2">
            <div className="label">Расход {last ? monthLabel(last.ym) : ""}</div>
            <TrendingDown className="w-4 h-4 text-expense" />
          </div>
          <div className="stat-num text-expense">
            {last ? formatMoney(last.expense, base) : "—"}
          </div>
          {expDelta !== null && (
            <div className={`text-xs mt-1 ${expDelta <= 0 ? "text-income" : "text-warn"}`}>
              {expDelta >= 0 ? "↑" : "↓"} {formatPct(Math.abs(expDelta), 1)} к пред. месяцу
            </div>
          )}
        </button>

        <div className="card card-pad">
          <div className="flex items-start justify-between mb-2">
            <div className="label">Норма сбережений</div>
            <PiggyBank className="w-4 h-4 text-muted" />
          </div>
          <div className={`stat-num ${sr !== null && sr > 0 ? "text-income" : "text-expense"}`}>
            {sr !== null ? `${(sr * 100).toFixed(0)}%` : "—"}
          </div>
          <div className="text-xs text-muted mt-1">
            {sr !== null && srMonth
              ? `Чистый ${formatMoney(srMonth.net, base, { signed: true })} · ${monthLabel(srMonth.ym)}`
              : "—"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card card-pad lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-semibold">Cash-flow с прогнозом</div>
              <div className="text-xs text-muted">
                История + 3 мес прогноз (среднее за последние 6 мес)
              </div>
            </div>
            <Link to="/cashflow" className="text-xs text-accent hover:underline flex items-center gap-1">
              Подробнее <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="h-64">
            <ResponsiveContainer>
              <ComposedChart data={forecastChart} onClick={(e: unknown) => {
                const ev = e as { activePayload?: { payload?: { ym?: string; isForecast?: boolean } }[] } | undefined;
                const ym = ev?.activePayload?.[0]?.payload?.ym;
                const isF = forecast.find((p) => p.ym === ym)?.isForecast;
                if (ym && !isF) openMonth(ym);
              }} style={{ cursor: "pointer" }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                <XAxis dataKey="month" stroke={chartAxisStroke} fontSize={11} />
                <YAxis stroke={chartAxisStroke} fontSize={11} tickFormatter={(v) => formatNum(v, { compact: true })} />
                <Tooltip
                  {...chartTooltipProps}
                  formatter={(v: unknown) => formatMoney(toNum(v), base)}
                />
                <Bar dataKey="income" name="Доход" fill="#10B981" radius={[4, 4, 0, 0]} activeBar={false} />
                <Bar dataKey="expense" name="Расход" fill="#EF4444" radius={[4, 4, 0, 0]} activeBar={false} />
                <Bar dataKey="incomeF" name="Прогноз дох." fill="#10B981" fillOpacity={0.35} stroke="#10B981" strokeDasharray="3 3" radius={[4, 4, 0, 0]} activeBar={false} />
                <Bar dataKey="expenseF" name="Прогноз расх." fill="#EF4444" fillOpacity={0.35} stroke="#EF4444" strokeDasharray="3 3" radius={[4, 4, 0, 0]} activeBar={false} />
                <Line type="monotone" dataKey="net" name="Чистый" stroke="#22D3EE" strokeWidth={2} dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card card-pad">
          {/* Two-line title block matches Cash-flow card so both plot areas
              line up vertically. Without the subtitle the AreaChart was ~16px
              taller and looked like it belonged to a different layout. */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-semibold">Совокупный баланс</div>
              <div className="text-xs text-muted">
                Итог по всём счетам
              </div>
            </div>
            <Link to="/accounts" className="text-xs text-accent hover:underline flex items-center gap-1">
              Счета <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={netWorthChart}>
                <defs>
                  <linearGradient id="dashNw" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22D3EE" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="#22D3EE" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                <XAxis
                  dataKey="date"
                  stroke={chartAxisStroke}
                  fontSize={11}
                  // Match Cash-flow X-axis: "май 23 г." style. The previous
                  // DD.MM format ("23.10") looked alien next to the left chart
                  // and lost the year on multi-year data.
                  tickFormatter={(d) => monthLabel((d as string).slice(0, 7))}
                  minTickGap={50}
                />
                <YAxis
                  stroke={chartAxisStroke}
                  fontSize={11}
                  // Same compact-number style as Cash-flow Y-axis on the left —
                  // no currency suffix → narrower labels → less horizontal
                  // padding → both charts read as a coordinated pair.
                  tickFormatter={(v) => formatNum(v, { compact: true })}
                  // Auto-scale to the actual balance range instead of starting
                  // from 0. With net worth in millions the [0..max] domain
                  // leaves a huge empty band at the bottom; using ["auto", "auto"]
                  // makes the chart fill its container the same way Cash-flow does.
                  domain={["auto", "auto"]}
                />
                <Tooltip
                  {...chartTooltipProps}
                  labelFormatter={(d) => formatDate(d as string)}
                  formatter={(v: unknown) => [
                    formatMoney(toNum(v), base, { signed: true }),
                    "Баланс",
                  ]}
                />
                <Area type="monotone" dataKey="net" stroke="#22D3EE" strokeWidth={2} fill="url(#dashNw)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {insights.length > 0 && <InsightsPanel insights={insights.slice(0, 6)} base={base} />}

      {(obligationBreakdown.obligatory > 0 || obligationBreakdown.optional > 0) && (
        <div className="card card-pad">
          <div className="font-semibold mb-2">Структура расходов последнего месяца</div>
          <div className="text-xs text-muted mb-3">
            На основе обязательности категорий (редактор «Обязательность расходов» на странице «Категории»). «Свободные деньги» = доход − обязательные расходы.
          </div>
          {(() => {
            const totalSpend = obligationBreakdown.obligatory + obligationBreakdown.optional;
            const lastIncome = months[months.length - 1]?.income || 0;
            const freedom = lastIncome - obligationBreakdown.obligatory;
            return (
              <>
                <div className="h-6 flex rounded-md overflow-hidden bg-panel2 mb-2">
                  {obligationBreakdown.obligatory > 0 && (
                    <div
                      className="bg-warn"
                      style={{ width: `${(obligationBreakdown.obligatory / totalSpend) * 100}%` }}
                      title={`Обязательные: ${formatMoney(obligationBreakdown.obligatory, base)}`}
                    />
                  )}
                  {obligationBreakdown.optional > 0 && (
                    <div
                      className="bg-accent2"
                      style={{ width: `${(obligationBreakdown.optional / totalSpend) * 100}%` }}
                      title={`Необязательные: ${formatMoney(obligationBreakdown.optional, base)}`}
                    />
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                  <div>
                    <div className="label flex items-center gap-1">
                      <span className="w-2 h-2 rounded bg-warn" /> Обязательные
                    </div>
                    <div className="font-semibold tabular-nums">
                      {formatMoney(obligationBreakdown.obligatory, base)}
                    </div>
                  </div>
                  <div>
                    <div className="label flex items-center gap-1">
                      <span className="w-2 h-2 rounded bg-accent2" /> Необязательные
                    </div>
                    <div className="font-semibold tabular-nums">
                      {formatMoney(obligationBreakdown.optional, base)}
                    </div>
                  </div>
                  <div>
                    <div className="label">«Свободные деньги»</div>
                    <div
                      className={`font-semibold tabular-nums ${
                        freedom > 0 ? "text-income" : "text-expense"
                      }`}
                    >
                      {formatMoney(freedom, base, { signed: true })}
                    </div>
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Account balances — table.
            BOTH cards in this row share the same `max-h` so they line up
            visually no matter how many accounts the user has. Inside each
            card the scrollable region is `flex-1 min-h-0 overflow-y-auto`
            — fills empty space when content is small, scrolls when long. */}
        <div className="card card-pad flex flex-col max-h-[560px]">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="font-semibold flex items-center gap-2">
              <Wallet className="w-4 h-4 text-accent" />
              Балансы счетов
            </div>
            <Link
              to="/accounts"
              className="text-xs text-accent hover:underline flex items-center gap-1"
            >
              Все <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <button
              onClick={() => setHideZero((v) => !v)}
              className={`text-[11px] px-2 py-1 rounded-md border transition-colors ${
                hideZero
                  ? "bg-accent/10 border-accent/40 text-accent"
                  : "bg-panel2 border-border text-muted hover:text-text"
              }`}
              title={hideZero ? "Сейчас скрыты — клик чтобы показать" : "Сейчас показаны — клик чтобы скрыть"}
            >
              {hideZero ? "Без нулевых" : "Все, включая нулевые"}
            </button>
            {hasArchived && (
              <button
                onClick={() => setHideArchived((v) => !v)}
                className={`text-[11px] px-2 py-1 rounded-md border transition-colors ${
                  hideArchived
                    ? "bg-accent/10 border-accent/40 text-accent"
                    : "bg-panel2 border-border text-muted hover:text-text"
                }`}
                title={hideArchived ? "Архивные сейчас скрыты — клик чтобы показать" : "Архивные сейчас показаны — клик чтобы скрыть"}
              >
                {hideArchived ? "Без архивных" : "С архивными"}
              </button>
            )}
            <span className="text-[11px] text-muted ml-auto tabular-nums">
              {accountRows.length} счетов
            </span>
          </div>
          {accountRows.length === 0 ? (
            <div className="text-sm text-muted text-center py-6">Нет счетов</div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
              <table className="w-full text-base">
                <thead className="sticky top-0 bg-panel z-10">
                  <tr>
                    <th className="table-th" colSpan={2}>Счёт</th>
                    <th className="table-th">Тип</th>
                    <th className="table-th text-right">Баланс</th>
                  </tr>
                </thead>
                <tbody>
                  {accountRows.map((a) => {
                    const isNegative = a.balanceBase < 0;
                    const hasFx = a.nativeCurrency !== base;
                    return (
                      <tr
                        key={a.title}
                        onClick={() => openAccount(a.title)}
                        className={`align-middle hover:bg-panel2/50 cursor-pointer group ${
                          a.archive ? "opacity-60" : ""
                        }`}
                      >
                          <td className="table-td w-8">
                            <AccountLogo title={a.title} type={a.type} />
                          </td>
                          <td className="table-td">
                            <div
                              className="font-medium truncate max-w-[180px] group-hover:text-accent"
                              title={a.title}
                            >
                              {a.title}
                            </div>
                          </td>
                          <td className="table-td text-[13px] text-muted whitespace-nowrap">
                            {accountTypeLabel(a.type)}
                            {a.offBalance && (
                              <span className="ml-1 text-accent2">· вне баланса</span>
                            )}
                          </td>
                          <td className="table-td text-right whitespace-nowrap">
                            <div
                              className={`font-semibold tabular-nums ${
                                isNegative ? "text-expense" : "text-text"
                              }`}
                              title={formatMoney(a.balanceBase, base, {
                                decimals: 2,
                              })}
                            >
                              {formatMoney(a.balanceBase, base)}
                            </div>
                            {hasFx && (
                              <div
                                className="text-[13px] text-muted tabular-nums"
                                title={formatMoney(
                                  a.nativeBalance,
                                  a.nativeCurrency,
                                  { decimals: 2 }
                                )}
                              >
                                {formatMoney(a.nativeBalance, a.nativeCurrency)}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Top-10 categories of the current month.
            Mirrors the balances card layout: same `max-h-[560px]`, flex-col,
            scrollable list region with `flex-1 min-h-0 overflow-y-auto` so
            both cards in this row stay perfectly aligned in height. */}
        <div className="card card-pad flex flex-col max-h-[560px]">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold flex items-center gap-2">
              <PieChart className="w-4 h-4 text-accent" />
              <span>Топ-10 категорий за {monthLabel(currentYM)}</span>
            </div>
            <Link
              to="/categories"
              className="text-xs text-accent hover:underline flex items-center gap-1"
            >
              Все <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {catsThisMonth.length === 0 ? (
            <div className="text-sm text-muted text-center py-6">
              За {monthLabel(currentYM)} ещё нет расходов.
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2 -mr-1 pr-1">
              {catsThisMonth.map((c) => {
                const pct =
                  catsThisMonth[0].expense > 0
                    ? c.expense / catsThisMonth[0].expense
                    : 0;
                return (
                  <button
                    key={c.category}
                    onClick={() => openCategory(c.category)}
                    className="w-full text-left text-sm group"
                  >
                    <div className="flex items-center justify-between mb-1 gap-2">
                      <span className="truncate group-hover:text-accent flex items-center gap-2 min-w-0">
                        <CategoryDot category={c.category} size="w-5 h-5" />
                        <span className="truncate">{c.category}</span>
                      </span>
                      <span className="tabular-nums text-xs shrink-0">
                        {formatMoney(c.expense, base)}
                      </span>
                    </div>
                    <div className="h-1.5 bg-panel2 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-expense rounded-full transition-all"
                        style={{ width: `${pct * 100}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-muted mt-0.5">
                      {c.count} оп.
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card card-pad">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold flex items-center gap-2">
              <Repeat className="w-4 h-4 text-accent" />
              Ближайшие регулярные
            </div>
            <Link to="/recurring" className="text-xs text-accent hover:underline flex items-center gap-1">
              Ежемесячные ({activeMonthly.length}) <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <div className="text-sm text-muted text-center py-6">
              Нет ожидаемых регулярных платежей
            </div>
          ) : (
            <div className="space-y-2">
              {upcoming.map((c) => {
                const days = Math.round((+new Date(c.nextExpected) - +new Date(today)) / 86400000);
                return (
                  <div
                    key={c.payee + c.currency}
                    className="flex items-center justify-between p-2 -mx-2 rounded bg-panel2/40"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{c.payee}</div>
                      <div className="text-xs text-muted">
                        {formatDate(c.nextExpected, "short")} · {days === 0 ? "сегодня" : `через ${days} дн`}
                      </div>
                    </div>
                    <div className="text-sm font-semibold tabular-nums text-expense whitespace-nowrap">
                      ≈ {formatMoney(c.avgAmount, c.currency)}
                    </div>
                  </div>
                );
              })}
              <div className="mt-3 pt-3 border-t border-border text-xs text-muted">
                ≈ {formatMoney(totalRecurringMonthly, base)} / мес на активные регулярные
              </div>
            </div>
          )}
        </div>

        <div className="card card-pad">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-accent" />
              Активность за 90 дней
            </div>
            <Link to="/calendar" className="text-xs text-accent hover:underline flex items-center gap-1">
              Календарь <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <MiniHeatmap dayMap={dayMap} days={90} base={base} />
          <div className="text-xs text-muted mt-3">
            Цвет — интенсивность расходов по дням
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Link to="/calendar" className="card card-pad hover:border-accent transition-colors flex items-center gap-3">
          <CalendarDays className="w-5 h-5 text-accent" />
          <div>
            <div className="font-medium text-sm">Календарь</div>
            <div className="text-xs text-muted">Heatmap по дням</div>
          </div>
        </Link>
        <Link to="/tags" className="card card-pad hover:border-accent transition-colors flex items-center gap-3">
          <Hash className="w-5 h-5 text-accent" />
          <div>
            <div className="font-medium text-sm">Теги</div>
            <div className="text-xs text-muted">Из комментариев</div>
          </div>
        </Link>
        <Link to="/compare" className="card card-pad hover:border-accent transition-colors flex items-center gap-3">
          <GitCompare className="w-5 h-5 text-accent" />
          <div>
            <div className="font-medium text-sm">Сравнение</div>
            <div className="text-xs text-muted">Периоды</div>
          </div>
        </Link>
        <Link to="/recurring" className="card card-pad hover:border-accent transition-colors flex items-center gap-3">
          <Repeat className="w-5 h-5 text-accent" />
          <div>
            <div className="font-medium text-sm">Регулярные</div>
            <div className="text-xs text-muted">{activeRecurring.length} активных</div>
          </div>
        </Link>
      </div>
    </div>
  );
}
