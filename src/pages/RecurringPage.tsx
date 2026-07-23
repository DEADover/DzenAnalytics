import { useEffect, useMemo, useState } from "react";
import {
  Repeat,
  Calendar,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  CalendarClock,
  Coins,
  Sparkles,
  ListChecks,
} from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useDrillStore } from "../store/useDrillStore";
import { detectRecurring, type RecurringCandidate } from "../lib/aggregations";
import { loadZenCache, type ZenCache } from "../lib/zenmoneyCache";
import { plannedOps, type PlannedOp } from "../lib/plannedOps";
import { formatMoney, formatDate, formatNum } from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { Stat } from "../components/Stat";
import { SortableTable, type Column } from "../components/SortableTable";

// One pill per coarse cadence bucket, plus an "all" pseudo-option.
// Order matches the user's likely usage frequency on this page:
// most subscriptions are monthly, weekly is the next bucket, and
// quarterly ones are the rare-but-meaningful tail.
type CadenceFilter = "all" | "weekly" | "monthly" | "quarterly";
const CADENCE_LABEL: Record<Exclude<CadenceFilter, "all">, string> = {
  weekly: "Еженедельные",
  monthly: "Ежемесячные",
  quarterly: "Реже раза в месяц",
};

// Page-level tabs: Zenmoney's own plans vs. our history-based detection (#3).
const PAGE_TABS = [
  { id: "zen", label: "Планы Дзен-мани", icon: CalendarClock },
  { id: "dzen", label: "Планы DzenAnalytics", icon: Sparkles },
] as const;
type PageTab = (typeof PAGE_TABS)[number]["id"];

// Date-window filter for the planned table.
type PlannedPeriod = "all" | "month" | "30d" | "3m" | "6m" | "1y";
const PLANNED_PERIODS: { id: PlannedPeriod; label: string }[] = [
  { id: "month", label: "Текущий месяц" },
  { id: "30d", label: "30 дней" },
  { id: "3m", label: "3 месяца" },
  { id: "6m", label: "6 месяцев" },
  { id: "1y", label: "1 год" },
  { id: "all", label: "Все" },
];

/** yyyy-mm-dd from LOCAL fields (no UTC shift). */
function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** Inclusive upper date bound for a period, or null for «Все». */
function plannedPeriodEnd(period: PlannedPeriod): string | null {
  const n = new Date();
  const y = n.getFullYear();
  const m = n.getMonth();
  const d = n.getDate();
  switch (period) {
    case "month":
      return isoLocal(new Date(y, m + 1, 0)); // last day of current month
    case "30d":
      return isoLocal(new Date(y, m, d + 30));
    case "3m":
      return isoLocal(new Date(y, m + 3, d));
    case "6m":
      return isoLocal(new Date(y, m + 6, d));
    case "1y":
      return isoLocal(new Date(y + 1, m, d));
    default:
      return null;
  }
}

/** Signed, coloured amount for a planned op (shared by table + overdue list). */
function plannedAmount(p: PlannedOp, base: string) {
  const sign = p.kind === "income" ? "+" : p.kind === "expense" ? "−" : "";
  const tone =
    p.kind === "income" ? "text-income" : p.kind === "transfer" ? "text-muted" : "text-expense";
  return (
    <span className={`tabular-nums whitespace-nowrap ${tone}`}>
      {sign}
      {formatMoney(p.amountBase, base)}
    </span>
  );
}

export function RecurringPage() {
  const transactions = useDataStore((s) => s.transactions);
  const rates = useDataStore((s) => s.rates);
  const base = rates.base;
  const showDrill = useDrillStore((s) => s.show);

  // Planned / forecast operations straight from Zenmoney (issue #47). They ride
  // in the same cache as the transactions — no extra sync needed.
  const [zenCache, setZenCache] = useState<ZenCache | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadZenCache().then((c) => {
      if (!cancelled) setZenCache(c);
    });
    return () => {
      cancelled = true;
    };
  }, [transactions]);
  const planned = useMemo(() => plannedOps(zenCache, rates), [zenCache, rates]);
  const [pageTab, setPageTab] = useState<PageTab>("zen");
  const [plannedTab, setPlannedTab] = useState<"all" | "plan" | "forecast">("all");
  const [plannedPeriod, setPlannedPeriod] = useState<PlannedPeriod>("month");
  const todayIso = isoLocal(new Date());

  // Overdue = a plan the user scheduled that nobody carried out. Forecast rows
  // are excluded: a stale projection isn't something to act on, calling it
  // «просрочено» would be misinformation.
  const plannedOverdue = useMemo(
    () => planned.filter((p) => p.date < todayIso && !p.forecast),
    [planned, todayIso]
  );
  /** Upcoming, ignoring tab & period — this decides whether the section shows at
   *  all, so an empty tab/period can never make the whole card disappear. */
  const plannedUpcoming = useMemo(
    () => planned.filter((p) => p.date >= todayIso),
    [planned, todayIso]
  );
  /** Upcoming within the selected date window (before the tab split), so the tab
   *  counts always match what the chosen period actually contains. */
  const plannedInPeriod = useMemo(() => {
    const end = plannedPeriodEnd(plannedPeriod);
    return end ? plannedUpcoming.filter((p) => p.date <= end) : plannedUpcoming;
  }, [plannedUpcoming, plannedPeriod]);
  const plannedCounts = useMemo(
    () => ({
      all: plannedInPeriod.length,
      plan: plannedInPeriod.filter((p) => !p.forecast).length,
      forecast: plannedInPeriod.filter((p) => p.forecast).length,
    }),
    [plannedInPeriod]
  );
  // A tab whose bucket is empty in the current period is disabled (Zenmoney
  // delivers few forecast markers, so «Прогноз» is often 0). If the selected tab
  // has nothing to show, fall back to «Все» so the table never looks broken.
  const effectiveTab = plannedCounts[plannedTab] > 0 ? plannedTab : "all";
  const plannedShown = useMemo(
    () =>
      plannedInPeriod.filter((p) =>
        effectiveTab === "all" ? true : effectiveTab === "plan" ? !p.forecast : p.forecast
      ),
    [plannedInPeriod, effectiveTab]
  );

  const allCandidates = useMemo(() => detectRecurring(transactions), [transactions]);
  const [cadenceFilter, setCadenceFilter] = useState<CadenceFilter>("all");
  const [onlyPriceUp, setOnlyPriceUp] = useState(false);
  // "Активные" = платёж идёт по графику (пропущено не больше ~2 циклов с учётом
  // периодичности). ON by default: a subscription cancelled a few months ago
  // isn't really "recurring" anymore, so we hide those unless the user
  // explicitly asks to see the full history. The staleness test is
  // cadence-aware (see `detectRecurring`), so a monthly plan unpaid for a
  // couple of months is hidden long before the old flat "older than a year".
  const [onlyActive, setOnlyActive] = useState(true);

  // Pool after the toggle filters (active / price-up) but BEFORE the cadence
  // pick. Used both for the result list AND for the per-cadence pill counts, so
  // a period pill's number always equals what «Найдено» shows for that cadence
  // under the current toggles (e.g. «Ежемесячные 17» → выбрал → Найдено 17).
  const filterPool = useMemo(
    () =>
      allCandidates.filter((c) => {
        if (onlyPriceUp && c.priceTrend.priceFlag !== "up") return false;
        if (onlyActive && c.stale) return false;
        return true;
      }),
    [allCandidates, onlyPriceUp, onlyActive]
  );

  const candidates = useMemo(
    () =>
      cadenceFilter === "all"
        ? filterPool
        : filterPool.filter((c) => c.cadence === cadenceFilter),
    [filterPool, cadenceFilter]
  );

  // Respects the «Только активные» toggle (but not the price-up filter itself,
  // which this card toggles): counts price-jumped subscriptions among active
  // ones when the toggle is on, so the number matches what clicking it reveals.
  const priceUpCount = allCandidates.filter(
    (c) => c.priceTrend.priceFlag === "up" && (!onlyActive || !c.stale)
  ).length;

  const totalMonthly = useMemo(
    () =>
      candidates.reduce((s, c) => {
        if (c.avgIntervalDays > 0) return s + (c.avgAmount * 30) / c.avgIntervalDays;
        return s;
      }, 0),
    [candidates]
  );

  const upcoming = useMemo(
    () =>
      candidates
        .filter((c) => c.nextExpected >= todayIso)
        .sort((a, b) => a.nextExpected.localeCompare(b.nextExpected)),
    [candidates, todayIso]
  );

  // ── Column definitions ──────────────────────────────────────────────────
  const plannedColumns = useMemo<Column<PlannedOp>[]>(
    () => [
      {
        key: "date",
        label: "Дата",
        width: "7%",
        sortValue: (p) => p.date,
        render: (p) => (
          <span className="text-muted whitespace-nowrap tabular-nums">
            {formatDate(p.date, "short")}
          </span>
        ),
      },
      {
        key: "type",
        label: "Тип",
        align: "center",
        width: "8%",
        sortValue: (p) => (p.forecast ? 1 : 0),
        exportValue: (p) => (p.forecast ? "Прогноз" : "План"),
        render: (p) => (
          <span
            className={`pill text-[11px] ${
              p.forecast ? "text-muted" : "text-accent border-accent/40"
            }`}
          >
            {p.forecast ? "Прогноз" : "План"}
          </span>
        ),
      },
      {
        key: "payee",
        label: "Получатель",
        width: "16%",
        sortValue: (p) => p.payee || "",
        render: (p) => (
          <span className="block truncate font-semibold" title={p.payee || ""}>
            {p.payee || "—"}
          </span>
        ),
      },
      {
        key: "category",
        label: "Категория",
        width: "19%",
        sortValue: (p) => p.category,
        render: (p) => (
          <span className="block truncate text-muted" title={p.category || ""}>
            {p.category || "—"}
          </span>
        ),
      },
      {
        key: "comment",
        label: "Комментарий",
        width: "22%",
        sortValue: (p) => p.comment || "",
        render: (p) =>
          p.comment ? (
            <span className="block truncate text-muted" title={p.comment}>
              {p.comment}
            </span>
          ) : (
            <span className="text-muted/50">—</span>
          ),
      },
      {
        key: "account",
        label: "Счёт",
        width: "15%",
        sortValue: (p) => p.account,
        render: (p) => (
          <span className="block truncate text-muted">
            {p.kind === "transfer" ? `${p.account} → ${p.toAccount}` : p.account}
          </span>
        ),
      },
      {
        key: "amount",
        label: "Сумма",
        align: "right",
        width: "13%",
        sortValue: (p) => p.amountBase,
        exportValue: (p) =>
          (p.kind === "expense" ? -p.amountBase : p.amountBase).toFixed(2),
        render: (p) => plannedAmount(p, base),
      },
    ],
    [base]
  );

  const recurringColumns = useMemo<Column<RecurringCandidate>[]>(
    () => [
      {
        // Traffic-light status: green = active (payments on schedule),
        // red = inactive (no payment for more than ~2 expected cycles).
        key: "status",
        label: "Статус",
        align: "center",
        width: "6%",
        sortValue: (c) => (c.stale ? "неактивен" : "активен"),
        render: (c) => (
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full ${
              c.stale ? "bg-expense" : "bg-income"
            }`}
            title={
              c.stale
                ? `Неактивен: нет платежа ${c.daysSinceLast} дн. при периоде ~${c.avgIntervalDays} дн.`
                : "Активен: платежи идут по графику"
            }
          />
        ),
      },
      {
        key: "payee",
        label: "Получатель",
        width: "15%",
        sortValue: (c) => c.payee,
        render: (c) => (
          <span className="block truncate font-medium" title={c.payee}>
            {c.payee}
          </span>
        ),
      },
      {
        key: "category",
        label: "Категория",
        width: "11%",
        sortValue: (c) => c.category,
        render: (c) => (
          <span className="block truncate text-muted" title={c.category}>
            {c.category}
          </span>
        ),
      },
      {
        key: "avgAmount",
        label: "Сумма ср.",
        align: "right",
        width: "9%",
        sortValue: (c) => c.avgAmount,
        render: (c) => (
          <span className="tabular-nums whitespace-nowrap">
            {formatMoney(c.avgAmount, c.currency)}
          </span>
        ),
      },
      {
        // Price-trend column — shows a small arrow + the % change of the *last*
        // charge vs. the historical average. Empty cell for "flat" so the column
        // stays visually quiet on the (majority) stable subscriptions.
        key: "priceTrend",
        label: "Изменение",
        align: "right",
        width: "8%",
        sortValue: (c) => c.priceTrend.changePct,
        render: (c) => {
          const { priceFlag, changePct } = c.priceTrend;
          if (priceFlag === "flat") return <span className="text-muted">—</span>;
          const pct = (changePct * 100).toFixed(0);
          const Icon = priceFlag === "up" ? TrendingUp : TrendingDown;
          return (
            <span
              className={`inline-flex items-center justify-end gap-1 tabular-nums ${
                priceFlag === "up" ? "text-warn" : "text-income"
              }`}
              title={
                priceFlag === "up"
                  ? "Последний платёж дороже исторического среднего"
                  : "Последний платёж дешевле исторического среднего"
              }
            >
              <Icon className="w-3.5 h-3.5" />
              {priceFlag === "up" ? "+" : ""}
              {pct}%
            </span>
          );
        },
      },
      {
        key: "avgInterval",
        label: "Раз в",
        align: "right",
        width: "6%",
        sortValue: (c) => c.avgIntervalDays,
        render: (c) => <span className="text-muted whitespace-nowrap">{c.avgIntervalDays} дн</span>,
      },
      {
        key: "occurrences",
        label: "Повторов",
        align: "right",
        width: "7%",
        sortValue: (c) => c.occurrences,
        render: (c) => <span className="text-muted tabular-nums">{formatNum(c.occurrences)}</span>,
      },
      {
        key: "consistency",
        label: "Стабильность",
        align: "right",
        width: "12%",
        sortValue: (c) => c.consistency,
        render: (c) => (
          <div className="flex items-center justify-end gap-2">
            <div className="w-12 h-1.5 bg-panel2 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent"
                style={{ width: `${c.consistency * 100}%` }}
              />
            </div>
            <span className="text-xs text-muted tabular-nums w-10 text-right">
              {(c.consistency * 100).toFixed(0)}%
            </span>
          </div>
        ),
      },
      {
        key: "lastDate",
        label: "Последний",
        width: "8%",
        sortValue: (c) => c.lastDate,
        render: (c) => (
          <span className="text-muted whitespace-nowrap">{formatDate(c.lastDate, "short")}</span>
        ),
      },
      {
        key: "nextExpected",
        label: "Следующий",
        width: "8%",
        sortValue: (c) => c.nextExpected,
        render: (c) => (
          <span className="text-muted whitespace-nowrap">
            {formatDate(c.nextExpected, "short")}
          </span>
        ),
      },
      {
        key: "totalSpent",
        label: "Итого",
        align: "right",
        width: "10%",
        sortValue: (c) => c.totalSpent,
        render: (c) => (
          <span className="tabular-nums whitespace-nowrap text-expense font-medium">
            {formatMoney(c.totalSpent, c.currency)}
          </span>
        ),
      },
    ],
    []
  );

  if (transactions.length === 0) return <EmptyState />;

  function openCandidate(c: { txIds: string[]; payee: string }) {
    const txs = transactions.filter((t) => c.txIds.includes(t.id));
    showDrill(c.payee, txs, "Регулярные платежи");
  }

  const plannedTabs = [
    { id: "all", label: "Все" },
    { id: "plan", label: "План" },
    { id: "forecast", label: "Прогноз" },
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Регулярные платежи"
        icon={Repeat}
        hint="Планы из Дзен-мани и автодетект подписок по вашей истории. Глобальные фильтры здесь не применяются."
      />

      {/* Page-level tabs: Zen plans vs our own detection (#3). */}
      <div className="flex gap-1 bg-panel2 rounded-lg p-1 border border-border w-fit">
        {PAGE_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setPageTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              pageTab === t.id ? "bg-accent text-accent-fg" : "text-muted hover:text-text"
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* ══ Планы из Дзен-мани (issue #47) ══════════════════════════════════ */}
      {pageTab === "zen" && (
        <>
          <p className="text-sm text-muted">
            Операции из Дзен-мани: запланированные вами вручную (план) и достроенные Дзеном
            по регулярности (прогноз).
          </p>
          {plannedUpcoming.length === 0 && plannedOverdue.length === 0 ? (
            <div className="card card-pad text-center py-12">
              <CalendarClock className="w-10 h-10 text-muted mx-auto mb-3" />
              <div className="font-medium mb-1">Нет запланированных операций из Дзен-мани</div>
              <div className="text-sm text-muted max-w-md mx-auto">
                Планы и прогнозы появятся после синхронизации с Дзен-мани. Автоопределённые
                регулярные платежи — во вкладке «Планы DzenAnalytics».
              </div>
            </div>
          ) : (
          <div className="card card-pad space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="font-semibold flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-accent" />
                Планируемые операции
              </div>
              <div className="flex bg-panel2 rounded-lg p-0.5 border border-border shrink-0">
                {plannedTabs.map((t) => {
                  const empty = plannedCounts[t.id] === 0;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setPlannedTab(t.id)}
                      disabled={empty}
                      title={empty ? "Нет таких операций в выбранном периоде" : undefined}
                      className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                        effectiveTab === t.id
                          ? "bg-accent text-accent-fg"
                          : empty
                            ? "text-muted/40 cursor-not-allowed"
                            : "text-muted hover:text-text"
                      }`}
                    >
                      {t.label}
                      <span className="opacity-60"> {plannedCounts[t.id]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Date-window filter for the plans table. */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted mr-1">Период:</span>
              {PLANNED_PERIODS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlannedPeriod(p.id)}
                  className={`px-3 py-1 rounded-full border transition-colors ${
                    plannedPeriod === p.id
                      ? "bg-accent/10 border-accent/40 text-accent"
                      : "border-border text-muted hover:text-text"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Overdue plans — the ones that actually need action. Shown above the
                upcoming table and independent of the tab/period filter. */}
            {plannedOverdue.length > 0 && (
              <div className="rounded-lg border border-warn/40 bg-warn/5 p-3">
                <div className="text-xs font-semibold text-warn mb-2 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  Просрочено: {formatNum(plannedOverdue.length)}
                </div>
                <div className="space-y-1.5">
                  {plannedOverdue.slice(0, 8).map((p) => (
                    <div key={p.id} className="flex items-center gap-3 text-sm">
                      <span className="text-warn tabular-nums w-20 shrink-0">
                        {formatDate(p.date, "short")}
                      </span>
                      <span className="flex-1 min-w-0 truncate">
                        {p.payee || p.comment || p.category || "—"}
                      </span>
                      <span className="shrink-0">{plannedAmount(p, base)}</span>
                    </div>
                  ))}
                </div>
                {plannedOverdue.length > 8 && (
                  <div className="text-[11px] text-muted pt-1.5">
                    и ещё {formatNum(plannedOverdue.length - 8)}
                  </div>
                )}
              </div>
            )}

            {plannedShown.length === 0 ? (
              <div className="text-sm text-muted py-2">
                {plannedInPeriod.length === 0 && plannedPeriod !== "all"
                  ? "В выбранном периоде операций нет — попробуйте расширить период."
                  : effectiveTab === "plan"
                    ? "Нет запланированных вручную операций."
                    : effectiveTab === "forecast"
                      ? "Нет прогнозных операций в этом периоде."
                      : "Ничего не запланировано на будущее."}
              </div>
            ) : (
              <SortableTable<PlannedOp>
                data={plannedShown}
                columns={plannedColumns}
                rowKey={(p) => p.id}
                defaultSortKey="date"
                defaultSortDir="asc"
                limit={40}
                exportable={false}
                fixed
              />
            )}
          </div>
          )}
        </>
      )}

      {/* ══ Планы DzenAnalytics — автодетект по истории (#4) ════════════════ */}
      {pageTab === "dzen" && (
        <>
          <p className="text-sm text-muted">
            Подписки и регулярные траты, найденные DzenAnalytics по вашей истории:
            одинаковый получатель, стабильная сумма, интервал 5–95 дней, минимум 3 повтора.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat
          dense
          label="Найдено"
          value={formatNum(candidates.length)}
          icon={<Repeat className="w-4 h-4" />}
          hint="регулярных платежей"
        />
        <Stat
          dense
          label="≈ в месяц"
          value={formatMoney(totalMonthly, base)}
          tone="warn"
          icon={<Coins className="w-4 h-4" />}
          hint="оценка нагрузки"
        />
        <Stat
          dense
          label="≈ в год"
          value={formatMoney(totalMonthly * 12, base)}
          tone="warn"
          icon={<Calendar className="w-4 h-4" />}
          hint="экстраполяция"
        />
        {/* "Подорожали" — clickable filter tile; matches the dense Stat look. */}
        <button
          type="button"
          onClick={() => priceUpCount > 0 && setOnlyPriceUp((v) => !v)}
          disabled={priceUpCount === 0}
          className={`card p-3 text-left transition-colors ${
            priceUpCount > 0 ? "hover:border-warn cursor-pointer" : "cursor-default"
          } ${onlyPriceUp ? "border-warn ring-1 ring-warn/30" : ""}`}
        >
          <div className="flex items-center justify-between mb-0.5">
            <div className="label">Подорожали</div>
            <TrendingUp className={`w-4 h-4 ${priceUpCount > 0 ? "text-warn" : "text-muted"}`} />
          </div>
          <div
            className={`text-xl font-semibold tabular-nums ${
              priceUpCount > 0 ? "text-warn" : "text-muted"
            }`}
          >
            {formatNum(priceUpCount)}
          </div>
          <div className="text-xs text-muted mt-1">
            {priceUpCount > 0 ? "клик — показать только их" : "за всю историю"}
          </div>
        </button>
      </div>

      {/* Cadence filter — three mutually-exclusive pills + "Все", plus the
          active-only toggle. Hidden when nothing has been detected yet. */}
      {allCandidates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted mr-1">Период:</span>
          {(["all", "monthly", "weekly", "quarterly"] as const).map((c) => {
            const label = c === "all" ? "Все" : CADENCE_LABEL[c];
            const count =
              c === "all"
                ? filterPool.length
                : filterPool.filter((x) => x.cadence === c).length;
            const active = cadenceFilter === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCadenceFilter(c)}
                className={`px-3 py-1 rounded-full border transition-colors ${
                  active
                    ? "bg-accent/10 border-accent/40 text-accent"
                    : "border-border text-muted hover:text-text"
                }`}
              >
                {label}
                <span className="ml-1.5 opacity-60">{count}</span>
              </button>
            );
          })}
          {onlyPriceUp && (
            <button
              type="button"
              onClick={() => setOnlyPriceUp(false)}
              className="px-3 py-1 rounded-full border border-warn/40 bg-warn/10 text-warn"
            >
              Только подорожавшие ×
            </button>
          )}
          {/* Active-only is a toggle, not a period — different style (switch)
              and pushed to the right edge so it doesn't read as a 5th pill. */}
          <button
            type="button"
            role="switch"
            aria-checked={onlyActive}
            onClick={() => setOnlyActive((v) => !v)}
            title="Показывать только активные. Неактивные — те, по которым пропущено больше ~2 ожидаемых платежей (с учётом периодичности)"
            className={`ml-auto flex items-center gap-2 transition-colors ${
              onlyActive ? "text-text" : "text-muted hover:text-text"
            }`}
          >
            <span>Только активные</span>
            <span
              className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
                onlyActive ? "bg-accent" : "bg-border"
              }`}
            >
              <span
                className={`inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
                  onlyActive ? "translate-x-3.5" : "translate-x-0.5"
                }`}
              />
            </span>
          </button>
        </div>
      )}

      {candidates.length === 0 && (
        <div className="card card-pad text-center py-12">
          <AlertCircle className="w-10 h-10 text-muted mx-auto mb-3" />
          <div className="font-medium mb-1">Регулярных платежей не найдено</div>
          <div className="text-sm text-muted">
            Нужно минимум 3 повтора одного получателя с интервалом ~раз в месяц.
          </div>
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="card card-pad">
          <div className="font-semibold mb-3 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-accent" />
            Ближайшие ожидаемые
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {upcoming.slice(0, 6).map((c) => {
              const daysUntil = Math.round(
                (+new Date(c.nextExpected) - +new Date(todayIso)) / 86400000
              );
              return (
                <button
                  key={c.payee + c.currency}
                  onClick={() => openCandidate(c)}
                  className="text-left p-3 rounded-lg bg-panel2 border border-border hover:border-accent transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="font-medium text-sm truncate">{c.payee}</div>
                    <div className="text-xs pill shrink-0">
                      {daysUntil === 0 ? "сегодня" : `через ${daysUntil} дн.`}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span>{formatDate(c.nextExpected, "short")}</span>
                    <span className="text-expense font-semibold tabular-nums">
                      ≈ {formatMoney(c.avgAmount, c.currency)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {candidates.length > 0 && (
        <div className="card card-pad">
          <SortableTable<RecurringCandidate>
            title={
              <span className="flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-accent" />
                Все регулярные платежи
              </span>
            }
            data={candidates}
            columns={recurringColumns}
            rowKey={(c) => c.payee + c.currency}
            defaultSortKey="totalSpent"
            defaultSortDir="desc"
            onRowClick={openCandidate}
            exportName="recurring_payments"
            fixed
          />
        </div>
      )}
        </>
      )}
    </div>
  );
}
