import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ComposedChart,
  type TooltipContentProps,
} from "recharts";
import {
  Wallet,
  List,
  Layers,
  LineChart as LineChartIcon,
  Settings2,
  Trash2,
  CheckCircle2,
  LayoutGrid,
  Table as TableIcon,
  Archive,
} from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useDrillStore } from "../store/useDrillStore";
import { useCalibrationStore } from "../store/useCalibrationStore";
import { confirm } from "../store/useConfirmStore";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { getLiveAccountsFromCache } from "../store/useZenmoneyStore";
import { useOffBalanceStore } from "../store/useOffBalanceStore";
import { useDraftsStore } from "../store/useDraftsStore";
import type { LiveAccount } from "../store/useZenmoneyStore";
import {
  balancesByAccount,
  computeKPI,
  dailyBalanceSeries,
  stackedBalanceByAccount,
  accountMonthlyDeltas,
  detectBalanceAnchors,
  cumulativeNetAt,
  lastTransactionDate,
} from "../lib/aggregations";
import { useNetWorthSeries } from "../hooks/useNetWorthSeries";
import {
  formatMoney,
  chartTooltipStyle,
  formatNum,
  formatDate,
  toNum,
  chartTooltipProps,
  chartGridStroke,
  chartAxisStroke,
} from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";
import { Sparkline } from "../components/Sparkline";
import { AccountLogo } from "../components/AccountLogo";
import { DateField } from "../components/DateField";
import { accountTypeLabel } from "../lib/accountType";

const STACK_COLORS = [
  "#22D3EE", "#A78BFA", "#F59E0B", "#10B981", "#EC4899",
  "#3B82F6", "#84CC16", "#F97316", "#14B8A6", "#6B7280",
];

type View = "stacked" | "single";
type Scope = "filtered" | "all";
type AccountsView = "cards" | "table";

export function AccountsPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const rates = useDataStore((s) => s.rates);
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);

  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [view, setView] = useState<View>("stacked");
  const [scope, setScope] = useState<Scope>("all");
  const [accountsView, setAccountsView] = useState<AccountsView>("table");
  const [hideArchived, setHideArchived] = useState(false);
  // Off-balance accounts (Zenmoney inBalance:false — savings/brokerage) are
  // shown only when the global setting (Настройки → Обработка) is on.
  const includeOffBalance = useOffBalanceStore((s) => s.includeOffBalance);

  // Real per-account balances (API mode only). CSV mode → null, we fall back
  // to the flow-derived delta and label it honestly.
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

  const showDrill = useDrillStore((s) => s.show);
  const calibration = useCalibrationStore((s) => s.calibration);
  const setCalibration = useCalibrationStore((s) => s.set);
  const clearCalibration = useCalibrationStore((s) => s.clear);
  const hydrateCalibration = useCalibrationStore((s) => s.hydrate);
  // API auto-calibrates on every sync — hide the manual UI when connected.
  const zenToken = useZenmoneyStore((s) => s.token);
  const zenHydrate = useZenmoneyStore((s) => s.hydrate);
  const zenLoaded = useZenmoneyStore((s) => s.loaded);
  useEffect(() => {
    if (!zenLoaded) zenHydrate();
  }, [zenLoaded, zenHydrate]);
  const calibLoaded = useCalibrationStore((s) => s.loaded);

  useEffect(() => {
    if (!calibLoaded) hydrateCalibration();
  }, [calibLoaded, hydrateCalibration]);

  const [calibOpen, setCalibOpen] = useState(false);
  const [calibDate, setCalibDate] = useState(calibration?.date || "");
  const [calibAmount, setCalibAmount] = useState(
    calibration ? String(calibration.amount) : ""
  );

  // Re-seed the editable calibration form when the stored calibration
  // changes (e.g. after hydrate or a reset elsewhere). Form inputs must
  // stay editable, so this mirror-into-local-state effect is correct.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setCalibDate(calibration?.date || "");
    setCalibAmount(calibration ? String(calibration.amount) : "");
  }, [calibration]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const filtered = useMemo(() => applyFilters(transactions, filters, monthStartDay), [transactions, filters, monthStartDay]);
  const baseTxs = scope === "all" ? transactions : filtered;

  const accounts = useMemo(() => balancesByAccount(filtered), [filtered]);
  const accountsAll = useMemo(() => balancesByAccount(transactions), [transactions]);

  // Merge the flow-derived figures (delta / income / expense / count — these
  // respect the active filters) with the real current balance from the API
  // cache (when connected). `balanceBase` is null in CSV mode / for accounts
  // the cache doesn't know about — the UI then shows the delta instead.
  //
  // The row set is the UNION of (a) accounts with activity under the current
  // filters and (b) every real Zenmoney account that counts toward the
  // balance — so debts / credit cards / deposits with a balance but no
  // operations in the period still show up (their delta/income/expense are
  // just 0). Credit/debt accounts carry their native sign, so a liability
  // renders negative (red) and reduces the totals correctly.
  const accountRows = useMemo(() => {
    const liveList = liveAccounts ?? [];
    const liveByTitle = new Map(liveList.map((a) => [a.title, a]));
    const txByTitle = new Map(accounts.map((a) => [a.account, a]));
    const toBase = (amt: number, cur: string) =>
      cur === base ? amt : amt * (rates.rates[cur] || 1);

    const titles = new Set<string>();
    for (const a of accounts) titles.add(a.account);
    for (const a of liveList) {
      // Archived (closed) accounts are kept but grouped below active ones
      // (see the sort), so the user can still review them without clutter up top.
      // Off-balance accounts only when the global setting opts them in.
      if (!a.inBalance && !includeOffBalance) continue;
      // Skip dormant zero-balance accounts with no activity — they'd be noise.
      if (Math.abs(a.balance) <= 0.005 && !txByTitle.has(a.title)) continue;
      titles.add(a.title);
    }

    const rows = [...titles].map((title) => {
      const live = liveByTitle.get(title);
      const tx = txByTitle.get(title);
      return {
        account: title,
        delta: tx?.balance ?? 0,
        income: tx?.income ?? 0,
        expense: tx?.expense ?? 0,
        count: tx?.count ?? 0,
        balanceBase: live ? toBase(live.balance, live.currency) : null,
        nativeBalance: live ? live.balance : null,
        nativeCurrency: live ? live.currency : null,
        type: live?.type ?? "",
        archive: live?.archive ?? false,
        // Only treat as off-balance when the cache actually knows the account;
        // CSV/unknown accounts default to "in balance" (no badge).
        offBalance: live ? !live.inBalance : false,
      };
    });
    // Active first, archived grouped below; within each group sort by real
    // balance when we have it, otherwise by the flow delta.
    rows.sort((x, y) => {
      if (x.archive !== y.archive) return x.archive ? 1 : -1;
      return (y.balanceBase ?? y.delta) - (x.balanceBase ?? x.delta);
    });
    return rows;
  }, [accounts, liveAccounts, base, rates, includeOffBalance]);

  // True when at least one account carries a real (API) balance — drives the
  // headline ("Баланс" vs "Изменение") and the table's column labels.
  const hasRealBalances = accountRows.some((r) => r.balanceBase !== null);
  // Optional «hide archived» toggle (only useful when some account is archived).
  const hasArchived = accountRows.some((r) => r.archive);
  const visibleRows = hideArchived
    ? accountRows.filter((r) => !r.archive)
    : accountRows;
  // Real current balance per account (base currency) — only in API mode. Lets
  // the stacked chart show actual balances instead of cumulative-flow-from-zero.
  const realBalancesByAccount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of accountRows) {
      if (r.balanceBase != null) m[r.account] = r.balanceBase;
    }
    return m;
  }, [accountRows]);
  const series = useMemo(
    () => dailyBalanceSeries(filtered, selectedAccount ?? undefined),
    [filtered, selectedAccount]
  );
  // Unsynced drafts live in `baseTxs` but not in the API balances — keep them
  // out of the stacked chart's real-balance anchor so the line isn't shifted
  // by the draft amount (issue #18).
  const drafts = useDraftsStore((s) => s.drafts);
  const unsyncedIds = useMemo(() => new Set(Object.keys(drafts)), [drafts]);
  const stacked = useMemo(
    () =>
      stackedBalanceByAccount(
        baseTxs,
        8,
        hasRealBalances ? realBalancesByAccount : null,
        unsyncedIds
      ),
    [baseTxs, hasRealBalances, realBalancesByAccount, unsyncedIds]
  );
  const netWorth = useNetWorthSeries(baseTxs);

  // Stacked-chart tooltip: per-account rows + a bold «Итого» — the day's net
  // worth, which the chart already carries on each datum as `total` (issue #27).
  const renderStackedTooltip = ({ active, payload, label }: TooltipContentProps) => {
    if (!active || !payload || payload.length === 0) return null;
    const datum = payload[0]?.payload as { total?: number } | undefined;
    const total = datum?.total ?? payload.reduce((s, p) => s + toNum(p.value), 0);
    return (
      <div style={chartTooltipStyle}>
        <div className="text-xs text-muted mb-1">{formatDate(label as string)}</div>
        <div className="space-y-0.5">
          {payload.map((p) => (
            <div key={String(p.dataKey)} className="flex items-center gap-3 text-sm">
              <span
                className="w-2.5 h-2.5 rounded-[2px] shrink-0"
                style={{ background: p.color as string }}
              />
              <span className="flex-1 min-w-0 truncate">{p.name}</span>
              <span className="tabular-nums">
                {formatMoney(toNum(p.value), base, { signed: true })}
              </span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 text-sm font-semibold mt-1 pt-1 border-t border-border">
          <span className="w-2.5 shrink-0" />
          <span className="flex-1">Итого</span>
          <span className="tabular-nums">{formatMoney(total, base, { signed: true })}</span>
        </div>
      </div>
    );
  };

  function applyCalibration() {
    const amt = Number(calibAmount);
    if (!calibDate || !Number.isFinite(amt)) return;
    setCalibration({ date: calibDate, amount: amt });
    setCalibOpen(false);
  }

  function calibrateForToday() {
    const lastDate = lastTransactionDate(transactions);
    if (lastDate) setCalibDate(lastDate);
  }

  const lastDateOverall = useMemo(() => lastTransactionDate(transactions), [transactions]);
  const rawAtCalibDate = useMemo(
    () => (calibDate ? cumulativeNetAt(transactions, calibDate) : 0),
    [transactions, calibDate]
  );
  const anchors = useMemo(() => detectBalanceAnchors(transactions), [transactions]);

  function applyAnchor() {
    if (anchors.length === 0) return;
    const a = anchors[0];
    const cum = cumulativeNetAt(transactions, a.tx.date);
    setCalibration({ date: a.tx.date, amount: cum + a.amount });
    setCalibOpen(false);
  }

  function openAccount(account: string) {
    const txs = filtered.filter(
      (t) => t.outcomeAccount === account || t.incomeAccount === account
    );
    showDrill(account, txs, "Операции по счёту");
  }

  if (transactions.length === 0) return <EmptyState />;

  const totalNet = accounts.reduce((s, a) => s + a.balance, 0);
  // Headline доход/расход = real income/expense, EXCLUDING internal transfers
  // (computeKPI skips kind="transfer"). Summing per-account flows instead would
  // double-count every transfer between own accounts (both legs), inflating the
  // figures to near-equal turnover that has no match in the operations list.
  const kpi = computeKPI(filtered);
  const totalIncome = kpi.income;
  const totalExpense = kpi.expense;

  const totalAllAccounts = accountsAll.reduce((s, a) => s + a.balance, 0);
  const peakNetWorth = netWorth.reduce((m, p) => Math.max(m, p.net), 0);
  const lastNetWorth = netWorth.length ? netWorth[netWorth.length - 1].net : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Wallet}
        title="Счета"
        hint="Данные по всем счетам, их балансы и другая аналитика."
        right={
          <div className="flex flex-wrap gap-2">
            <div className="flex bg-panel2 rounded-lg p-1 border border-border">
              <button
                onClick={() => setScope("all")}
                className={`px-3 py-1 text-xs rounded-md ${scope === "all" ? "bg-accent text-accent-fg" : "text-muted"}`}
              >
                Вся история
              </button>
              <button
                onClick={() => setScope("filtered")}
                className={`px-3 py-1 text-xs rounded-md ${scope === "filtered" ? "bg-accent text-accent-fg" : "text-muted"}`}
              >
                По фильтрам
              </button>
            </div>
            <div className="flex bg-panel2 rounded-lg p-1 border border-border">
              <button
                onClick={() => setView("stacked")}
                className={`px-3 py-1 text-xs rounded-md flex items-center gap-1 ${view === "stacked" ? "bg-accent text-accent-fg" : "text-muted"}`}
              >
                <Layers className="w-3 h-3" />
                По счетам
              </button>
              <button
                onClick={() => setView("single")}
                className={`px-3 py-1 text-xs rounded-md flex items-center gap-1 ${view === "single" ? "bg-accent text-accent-fg" : "text-muted"}`}
              >
                <LineChartIcon className="w-3 h-3" />
                Совокупно
              </button>
            </div>
            {!zenToken && (
              <button
                onClick={() => setCalibOpen((o) => !o)}
                className={`btn-ghost text-xs ${calibration ? "border-accent2 text-accent2" : ""}`}
                title="Привязать график к фактическому балансу"
              >
                <Settings2 className="w-3.5 h-3.5" />
                {calibration ? "Калибровка вкл." : "Калибровка"}
              </button>
            )}
          </div>
        }
      />
      <GlobalFilters />

      {calibOpen && !zenToken && (
        <div className="card card-pad bg-accent2/5 border-accent2/40">
          <div className="font-semibold mb-2 flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-accent2" />
            Калибровка совокупного баланса
          </div>
          <p className="text-xs text-muted mb-4">
            CSV не содержит начальных остатков счетов — поэтому без калибровки график показывает
            <em> изменение</em> богатства, а не реальный баланс. Введите вашу <b>текущую</b> сумму
            на всех счетах — весь график сдвинется так, чтобы на эту дату показал указанное
            значение.
          </p>

          {anchors.length > 0 && (
            <div className="mb-3 p-3 rounded-lg bg-panel2 border border-border flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">
                  В данных найдены {anchors.length} «якорных» операций
                </div>
                <div className="text-xs text-muted mt-1">
                  Дзен-мани иногда экспортирует «Корректировка остатка» / «Начальный остаток» как
                  обычные транзакции. Самая свежая:{" "}
                  {anchors[0].tx.date} · {anchors[0].tx.categoryFull}
                </div>
              </div>
              <button onClick={applyAnchor} className="btn-ghost text-xs whitespace-nowrap">
                Применить
              </button>
            </div>
          )}

          <div className="flex items-center gap-2 mb-2">
            <button onClick={calibrateForToday} className="btn-ghost text-xs">
              Использовать дату последней операции
            </button>
            <span className="text-xs text-muted">
              ({lastDateOverall || "—"})
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div>
              <label className="label block mb-1">На дату</label>
              <DateField
                value={calibDate}
                onChange={(e) => setCalibDate(e.target.value)}
                className="input text-sm"
              />
            </div>
            <div>
              <label className="label block mb-1">У меня было ({base})</label>
              <input
                type="number"
                value={calibAmount}
                onChange={(e) => setCalibAmount(e.target.value)}
                placeholder="2900000"
                className="input text-sm"
              />
              {calibDate && (
                <div className="text-[11px] text-muted mt-1">
                  Сейчас график показывает{" "}
                  <span className="tabular-nums">
                    {formatMoney(rawAtCalibDate, base, { signed: true })}
                  </span>{" "}
                  на эту дату
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={applyCalibration} className="btn-primary text-sm flex-1">
                <CheckCircle2 className="w-4 h-4" />
                Применить
              </button>
              {calibration && (
                <button
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Сбросить калибровку?",
                      message:
                        "Текущая балансовая привязка будет удалена. Можно будет настроить заново.",
                      confirmLabel: "Сбросить",
                      tone: "danger",
                    });
                    if (ok) clearCalibration();
                  }}
                  className="btn-danger text-sm"
                  title="Сбросить"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          <div className="text-xs text-muted mt-3">
            Применяется только к графику «Совокупно» и KPI-карточке «Совокупный баланс».
            Сток-чарт «По счетам» остаётся «от нуля» — он показывает изменения, не остатки.
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card card-pad">
          <div className="label mb-1">Совокупный баланс</div>
          <div className={`stat-num ${lastNetWorth >= 0 ? "text-income" : "text-expense"}`}>
            {formatMoney(lastNetWorth, base, { signed: true })}
          </div>
          <div className="text-xs text-muted mt-1">
            {scope === "all" ? "Вся история" : "В пределах фильтра"}
          </div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Пиковое значение</div>
          <div className="stat-num text-accent">
            {formatMoney(peakNetWorth, base)}
          </div>
          <div className="text-xs text-muted mt-1">Максимум за период графика</div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Доходы (фильтр)</div>
          <div className="stat-num text-income">
            {formatMoney(totalIncome, base)}
          </div>
          <div className="text-xs text-muted mt-1">Без переводов между счетами</div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Расходы (фильтр)</div>
          <div className="stat-num text-expense">
            {formatMoney(totalExpense, base)}
          </div>
          <div className="text-xs text-muted mt-1">Без переводов между счетами</div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="font-semibold">
              {view === "stacked"
                ? hasRealBalances
                  ? "Баланс по счетам (стопкой)"
                  : "Накопленный поток по счетам (стопкой)"
                : "Совокупный баланс (одной линией)"}
            </div>
            <div className="text-xs text-muted">
              {view === "stacked"
                ? hasRealBalances
                  ? "Реальные остатки по счетам · вся история, без фильтров"
                  : "Накопление с нуля, без стартовых остатков · без фильтров"
                : scope === "all"
                  ? "Все транзакции, без учёта фильтров"
                  : "С учётом фильтров"}
              {view === "stacked" && ` · топ-${stacked.accounts.length} счетов`}
            </div>
          </div>
        </div>
        <div className="h-96">
          {view === "stacked" ? (
            <ResponsiveContainer>
              <AreaChart data={stacked.series}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                <XAxis
                  dataKey="date"
                  stroke={chartAxisStroke}
                  fontSize={11}
                  tickFormatter={(d) => formatDate(d, "short")}
                  minTickGap={50}
                />
                <YAxis
                  stroke={chartAxisStroke}
                  fontSize={11}
                  tickFormatter={(v) => formatNum(v, { compact: true })}
                />
                <Tooltip {...chartTooltipProps} content={renderStackedTooltip} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {stacked.accounts.map((acc, i) => (
                  <Area
                    key={acc}
                    type="monotone"
                    dataKey={acc}
                    stackId="1"
                    stroke={STACK_COLORS[i % STACK_COLORS.length]}
                    fill={STACK_COLORS[i % STACK_COLORS.length]}
                    fillOpacity={0.7}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer>
              <ComposedChart data={netWorth}>
                <defs>
                  <linearGradient id="netfill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22D3EE" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="#22D3EE" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                <XAxis
                  dataKey="date"
                  stroke={chartAxisStroke}
                  fontSize={11}
                  tickFormatter={(d) => formatDate(d, "short")}
                  minTickGap={50}
                />
                <YAxis
                  stroke={chartAxisStroke}
                  fontSize={11}
                  tickFormatter={(v) => formatNum(v, { compact: true })}
                />
                <Tooltip
                  {...chartTooltipProps}
                  labelFormatter={(d) => formatDate(d as string)}
                  formatter={(v: unknown) => [
                    formatMoney(toNum(v), base, { signed: true }),
                    "Баланс",
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="net"
                  stroke="#22D3EE"
                  strokeWidth={2}
                  fill="url(#netfill)"
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="card card-pad">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="font-semibold">
              {selectedAccount ? `Дельта по счёту: ${selectedAccount}` : "Дельта по фильтру"}
            </div>
            <div className="text-xs text-muted">
              Изменение баланса за период (нарастающим итогом)
            </div>
          </div>
          {selectedAccount && (
            <button onClick={() => setSelectedAccount(null)} className="btn-ghost text-xs">
              Все счета
            </button>
          )}
        </div>
        <div className="h-64">
          <ResponsiveContainer>
            <AreaChart data={series}>
              <defs>
                <linearGradient id="bal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#A78BFA" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#A78BFA" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
              <XAxis
                dataKey="date"
                stroke={chartAxisStroke}
                fontSize={11}
                tickFormatter={(d) => formatDate(d, "short")}
                minTickGap={40}
              />
              <YAxis
                stroke={chartAxisStroke}
                fontSize={11}
                tickFormatter={(v) => formatNum(v, { compact: true })}
              />
              <Tooltip
                {...chartTooltipProps}
                labelFormatter={(d) => formatDate(d as string)}
                formatter={(v: unknown, n: unknown) => [
                  formatMoney(toNum(v), base, { signed: true }),
                  n === "balance" ? "Баланс" : "Дельта",
                ]}
              />
              <Area
                type="monotone"
                dataKey="balance"
                stroke="#A78BFA"
                strokeWidth={2}
                fill="url(#bal)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card card-pad">
          <div className="label mb-1">Чистая дельта (фильтр)</div>
          <div
            className={`stat-num ${totalNet >= 0 ? "text-income" : "text-expense"}`}
          >
            {formatMoney(totalNet, base, { signed: true })}
          </div>
          <div className="text-xs text-muted mt-1">По текущим фильтрам</div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Чистая дельта (вся история)</div>
          <div className={`stat-num ${totalAllAccounts >= 0 ? "text-income" : "text-expense"}`}>
            {formatMoney(totalAllAccounts, base, { signed: true })}
          </div>
          <div className="text-xs text-muted mt-1">Без фильтров</div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Счетов</div>
          <div className="stat-num">{accountsAll.length}</div>
          <div className="text-xs text-muted mt-1">{accounts.length} в фильтре</div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
          <div className="font-semibold flex items-center gap-2">
            <Wallet className="w-4 h-4" />
            Счета ({visibleRows.length})
          </div>
          <div className="flex items-center gap-2 flex-wrap">
          {hasArchived && (
            <button
              onClick={() => setHideArchived((v) => !v)}
              aria-pressed={hideArchived}
              className={`px-3 py-1.5 text-xs rounded-lg border flex items-center gap-1 ${
                hideArchived
                  ? "bg-accent/10 border-accent/40 text-accent"
                  : "bg-panel2 border-border text-muted hover:text-text"
              }`}
              title="Скрыть/показать архивные (закрытые) счета"
            >
              <Archive className="w-3.5 h-3.5" />
              {hideArchived ? "Архивные скрыты" : "Скрыть архивные"}
            </button>
          )}
          <div
            role="group"
            aria-label="Вид списка счетов"
            className="flex bg-panel2 rounded-lg p-1 border border-border"
          >
            <button
              onClick={() => setAccountsView("table")}
              aria-pressed={accountsView === "table"}
              className={`px-3 py-1 text-xs rounded-md flex items-center gap-1 ${
                accountsView === "table" ? "bg-accent text-accent-fg" : "text-muted"
              }`}
            >
              <TableIcon className="w-3 h-3" />
              Таблица
            </button>
            <button
              onClick={() => setAccountsView("cards")}
              aria-pressed={accountsView === "cards"}
              className={`px-3 py-1 text-xs rounded-md flex items-center gap-1 ${
                accountsView === "cards" ? "bg-accent text-accent-fg" : "text-muted"
              }`}
            >
              <LayoutGrid className="w-3 h-3" />
              Карточки
            </button>
          </div>
          </div>
        </div>
        <div className="text-xs text-muted mb-3">
          {hasRealBalances
            ? "«Баланс» — актуальная сумма из Дзен-мани. «Δ период» — изменение по текущим фильтрам. "
            : "В CSV нет остатков счетов — показано «Изменение» (доход − расход) по фильтрам. "}
          Клик по карточке/строке — фильтр графика «Дельта». «Операции» — список транзакций.
        </div>

        {accountsView === "cards" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {visibleRows.map((a) => {
              const isSel = selectedAccount === a.account;
              const hasReal = a.balanceBase !== null;
              // Headline = real balance when known, else the flow delta.
              const headline = hasReal ? a.balanceBase! : a.delta;
              const headlineNeg = headline < 0;
              // Real balances are neutral when positive (match dashboard);
              // a flow delta keeps income/expense colouring.
              const headlineColor = headlineNeg
                ? "text-expense"
                : hasReal
                  ? "text-text"
                  : "text-income";
              const sparkColor = headlineNeg
                ? "rgb(var(--c-expense))"
                : "rgb(var(--c-income))";
              return (
                <div
                  key={a.account}
                  className={`p-4 rounded-lg border transition-colors ${
                    isSel
                      ? "bg-accent/10 border-accent"
                      : "bg-panel2 border-border hover:border-accent/50"
                  } ${a.archive ? "opacity-60" : ""}`}
                >
                  <div className="flex items-start justify-between mb-2 gap-2">
                    <button
                      onClick={() => setSelectedAccount(isSel ? null : a.account)}
                      className="flex items-center gap-2 min-w-0 text-left flex-1"
                      title={a.account}
                    >
                      <AccountLogo title={a.account} type={a.type} />
                      <span className="min-w-0">
                        <span className="font-medium text-sm truncate block">
                          {a.account}
                        </span>
                        {hasReal && (
                          <span className="text-[10px] text-muted">
                            {accountTypeLabel(a.type)}
                            {a.offBalance && (
                              <span className="ml-1 text-accent2">· вне баланса</span>
                            )}
                            {a.archive && (
                              <span className="ml-1 text-muted">· архив</span>
                            )}
                          </span>
                        )}
                      </span>
                    </button>
                    <span className="pill text-[10px] shrink-0">{a.count}</span>
                  </div>
                  <button
                    onClick={() => setSelectedAccount(isSel ? null : a.account)}
                    className="block text-left w-full"
                  >
                    <div className="text-[10px] uppercase tracking-wider text-muted">
                      {hasReal ? "Баланс" : "Изменение"}
                    </div>
                    <div className="flex items-end justify-between gap-2">
                      <div className="min-w-0">
                        <div
                          className={`text-xl font-bold tabular-nums truncate ${headlineColor}`}
                          title={formatMoney(headline, base, { decimals: 2 })}
                        >
                          {formatMoney(headline, base, { signed: !hasReal })}
                        </div>
                        {hasReal &&
                          a.nativeCurrency &&
                          a.nativeCurrency !== base && (
                            <div
                              className="text-[11px] text-muted tabular-nums"
                              title={formatMoney(a.nativeBalance!, a.nativeCurrency, {
                                decimals: 2,
                              })}
                            >
                              {formatMoney(a.nativeBalance!, a.nativeCurrency)}
                            </div>
                          )}
                      </div>
                      <Sparkline
                        data={accountMonthlyDeltas(transactions, a.account, 12)}
                        color={sparkColor}
                        width={70}
                        height={20}
                      />
                    </div>
                    <div className="text-xs text-muted flex justify-between mt-2 mb-3">
                      {hasReal ? (
                        <span title="Изменение по текущим фильтрам">
                          Δ {formatMoney(a.delta, base, { signed: true })}
                        </span>
                      ) : (
                        <span />
                      )}
                      <span className="flex gap-2">
                        <span className="text-income">
                          +{formatMoney(a.income, base)}
                        </span>
                        <span className="text-expense">
                          −{formatMoney(a.expense, base)}
                        </span>
                      </span>
                    </div>
                  </button>
                  <button
                    onClick={() => openAccount(a.account)}
                    className="btn-ghost text-xs w-full !py-1.5"
                  >
                    <List className="w-3 h-3" />
                    Операции
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto">
            {/* table-fixed + colgroup keep column widths stable, so changing
                the filter (different rows/content) never reflows the columns.
                Numeric columns are sized to fit million-ruble values so nothing
                overflows its cell (which would force a horizontal scrollbar). */}
            <table className="w-full min-w-[960px] text-base table-fixed">
              <colgroup>
                <col />
                <col style={{ width: 140 }} />
                <col style={{ width: 132 }} />
                <col style={{ width: 140 }} />
                <col style={{ width: 140 }} />
                <col style={{ width: 64 }} />
                <col style={{ width: 140 }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="table-th">Счёт</th>
                  <th className="table-th text-right">
                    {hasRealBalances ? "Баланс" : "Изменение"}
                  </th>
                  <th className="table-th text-right">Δ период</th>
                  <th className="table-th text-right">Поступления</th>
                  <th className="table-th text-right">Списания</th>
                  <th className="table-th text-right">Опер.</th>
                  <th className="table-th" aria-hidden />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((a) => {
                  const isSel = selectedAccount === a.account;
                  const hasReal = a.balanceBase !== null;
                  const headline = hasReal ? a.balanceBase! : a.delta;
                  const headlineNeg = headline < 0;
                  const headlineColor = headlineNeg
                    ? "text-expense"
                    : hasReal
                      ? "text-text"
                      : "text-income";
                  return (
                    <tr
                      key={a.account}
                      onClick={() => setSelectedAccount(isSel ? null : a.account)}
                      className={`align-middle cursor-pointer group ${
                        isSel ? "bg-accent/10" : "hover:bg-panel2/50"
                      } ${a.archive ? "opacity-60" : ""}`}
                    >
                      <td className="table-td">
                        <div className="flex items-center gap-2 min-w-0">
                          <AccountLogo title={a.account} type={a.type} />
                          <div className="min-w-0">
                            <div
                              className="font-medium truncate max-w-[200px] group-hover:text-accent"
                              title={a.account}
                            >
                              {a.account}
                            </div>
                            {hasReal && (
                              <div className="text-[13px] text-muted">
                                {accountTypeLabel(a.type)}
                                {a.offBalance && (
                                  <span className="ml-1 text-accent2">· вне баланса</span>
                                )}
                                {a.archive && (
                                  <span className="ml-1 text-muted">· архив</span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td
                        className={`table-td text-right tabular-nums font-semibold whitespace-nowrap ${headlineColor}`}
                        title={formatMoney(headline, base, { decimals: 2 })}
                      >
                        {formatMoney(headline, base, { signed: !hasReal })}
                        {hasReal && a.nativeCurrency && a.nativeCurrency !== base && (
                          <div className="text-[13px] text-muted font-normal">
                            {formatMoney(a.nativeBalance!, a.nativeCurrency)}
                          </div>
                        )}
                      </td>
                      <td
                        className={`table-td text-right tabular-nums whitespace-nowrap ${
                          a.delta >= 0 ? "text-income" : "text-expense"
                        }`}
                      >
                        {formatMoney(a.delta, base, { signed: true })}
                      </td>
                      <td className="table-td text-right tabular-nums text-income whitespace-nowrap">
                        {formatMoney(a.income, base)}
                      </td>
                      <td className="table-td text-right tabular-nums text-expense whitespace-nowrap">
                        {formatMoney(a.expense, base)}
                      </td>
                      <td className="table-td text-right tabular-nums text-muted">
                        {formatNum(a.count)}
                      </td>
                      <td className="table-td text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openAccount(a.account);
                          }}
                          className="btn-ghost text-xs !py-1 whitespace-nowrap"
                          title="Список операций"
                        >
                          <List className="w-3 h-3" />
                          Операции
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
