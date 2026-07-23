import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, MousePointerClick } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useDrillStore } from "../store/useDrillStore";
import { dailyExpenseMap, transferTotals, type DayCell } from "../lib/aggregations";
import { loadZenCache, type ZenCache } from "../lib/zenmoneyCache";
import { plannedOps } from "../lib/plannedOps";
import { getLiveAccountsFromCache } from "../store/useZenmoneyStore";
import { formatMoney, formatDate, formatNum, ymdKey } from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";
import { Tooltip } from "../components/Tooltip";

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const EXPENSE_PALETTE = [
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

const INCOME_PALETTE = [
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

function buildThresholds(values: number[], n = 8): number[] {
  const positives = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (positives.length === 0) return [];
  const out: number[] = [];
  for (let i = 1; i <= n - 1; i++) {
    const idx = Math.floor((i / n) * positives.length);
    out.push(positives[Math.min(idx, positives.length - 1)]);
  }
  return out;
}

function binIdx(v: number, thresholds: number[], paletteSize: number): number {
  if (v <= 0) return 0;
  if (thresholds.length === 0) return paletteSize - 1;
  for (let i = 0; i < thresholds.length; i++) {
    if (v <= thresholds[i]) return i + 1;
  }
  return paletteSize - 1;
}

export function CalendarPage() {
  const transactions = useDataStore((s) => s.transactions);
  const rates = useDataStore((s) => s.rates);
  const base = rates.base;
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const showDrill = useDrillStore((s) => s.show);

  const [kind, setKind] = useState<"expense" | "income">("expense");

  // Titles of accounts marked «накопительный» — for the «Накопления» tile
  // (issue #48, reusing the transfer/savings rule from #42). Empty in CSV mode.
  const [savingsAccounts, setSavingsAccounts] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    getLiveAccountsFromCache().then((live) => {
      if (cancelled || !live) return;
      setSavingsAccounts(new Set(live.filter((a) => a.savings).map((a) => a.title)));
    });
    return () => {
      cancelled = true;
    };
  }, [transactions]);

  // Planned / forecast operations from Zenmoney (issue #47) — shown here as a
  // reference figure under the yearly totals (issue #48).
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

  // The calendar's own year selector IS the time axis here, so the global
  // *date range* must not constrain it — otherwise the default "current
  // month" filter collapses the heatmap to one month and locks the year
  // arrows. Keep every other global filter (accounts/categories/currencies/
  // search), just neutralise the date range.
  const calendarFilters = useMemo(
    () => ({ ...filters, preset: "all" as const, from: null, to: null }),
    [filters]
  );
  const filtered = useMemo(
    () => applyFilters(transactions, calendarFilters, monthStartDay),
    [transactions, calendarFilters, monthStartDay]
  );
  const dayMap = useMemo(() => dailyExpenseMap(filtered), [filtered]);

  const dates = useMemo(() => {
    const ds = filtered.map((t) => t.date).filter(Boolean).sort();
    return { min: ds[0] || "", max: ds[ds.length - 1] || "" };
  }, [filtered]);

  const initialYear = dates.max ? Number(dates.max.slice(0, 4)) : new Date().getFullYear();
  const [year, setYear] = useState(initialYear);

  const yearMin = dates.min ? Number(dates.min.slice(0, 4)) : initialYear;
  const yearMax = dates.max ? Number(dates.max.slice(0, 4)) : initialYear;

  const yearStats = useMemo(() => {
    let total = 0;
    let totalInc = 0;
    let count = 0;
    let max = 0;
    let activeDays = 0;
    const values: number[] = [];
    for (const [d, c] of dayMap) {
      if (d.startsWith(String(year))) {
        total += c.expense;
        totalInc += c.income;
        count += c.count;
        const v = kind === "expense" ? c.expense : c.income;
        if (v > max) max = v;
        if (v > 0) values.push(v);
        if (c.count > 0) activeDays++;
      }
    }
    const thresholds = buildThresholds(values, 8);
    return { total, totalInc, count, max, activeDays, thresholds };
  }, [dayMap, year, kind]);

  // «Накопления» за год: переводы НА накопительные счета минус переводы С них
  // (перевод между двумя накопительными даёт ноль) — как в разделе «Операции».
  const savingsYear = useMemo(() => {
    const yearTxs = filtered.filter((t) => t.date.startsWith(String(year)));
    return transferTotals(yearTxs, savingsAccounts).savings;
  }, [filtered, year, savingsAccounts]);

  // Планируемые / прогнозные суммы за год — справочно под годовыми итогами.
  const plannedYear = useMemo(() => {
    const inYear = planned.filter((p) => p.date.startsWith(String(year)));
    const sum = (k: "expense" | "income", forecast: boolean) =>
      inYear
        .filter((p) => p.kind === k && p.forecast === forecast)
        .reduce((s, p) => s + p.amountBase, 0);
    return {
      planExpense: sum("expense", false),
      planIncome: sum("income", false),
      fcExpense: sum("expense", true),
      fcIncome: sum("income", true),
    };
  }, [planned, year]);

  function openDay(date: string) {
    const txs = filtered.filter((t) => t.date === date);
    showDrill(formatDate(date), txs, "Операции за день");
  }

  if (transactions.length === 0) return <EmptyState />;

  const palette = kind === "expense" ? EXPENSE_PALETTE : INCOME_PALETTE;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={CalendarDays}
        title="Календарь"
        hint={`Тепловая карта по дням года. Клик по дню — операции.`}
        right={
          <div className="flex flex-wrap gap-2 items-center">
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
            <div className="flex items-center gap-1 bg-panel2 rounded-lg p-1 border border-border">
              <button
                onClick={() => setYear((y) => Math.max(yearMin, y - 1))}
                disabled={year <= yearMin}
                className="p-1 hover:text-accent disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-3 text-sm font-medium tabular-nums">{year}</span>
              <button
                onClick={() => setYear((y) => Math.min(yearMax, y + 1))}
                disabled={year >= yearMax}
                className="p-1 hover:text-accent disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <MousePointerClick className="w-3.5 h-3.5" />
              Кликабельный
            </span>
          </div>
        }
      />
      <GlobalFilters showDateRange={false} />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="card card-pad">
          <div className="label mb-1">Расходы за {year}</div>
          <YearValue
            tone="text-expense"
            tip={plannedTip(plannedYear.planExpense, plannedYear.fcExpense, base)}
          >
            {formatMoney(yearStats.total, base)}
          </YearValue>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Доходы за {year}</div>
          <YearValue
            tone="text-income"
            tip={plannedTip(plannedYear.planIncome, plannedYear.fcIncome, base)}
          >
            {formatMoney(yearStats.totalInc, base)}
          </YearValue>
        </div>
        {/* «Накопления» за год (issue #48) — сумма из правила #42. */}
        <div className="card card-pad">
          <div className="label mb-1">Накопления за {year}</div>
          <YearValue
            tone={savingsYear > 0 ? "text-income" : savingsYear < 0 ? "text-expense" : ""}
            tip="Переводы НА накопительные счета минус переводы С них за год. Перевод между двумя накопительными счетами даёт ноль. Начальные остатки не учитываются — только переводы."
          >
            {formatMoney(savingsYear, base, { signed: true })}
          </YearValue>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Операций</div>
          <div className="stat-num">{formatNum(yearStats.count)}</div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Активных дней</div>
          <div className="stat-num">
            {yearStats.activeDays}<span className="text-muted text-sm ml-1">/ 365</span>
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 12 }, (_, m) => (
            <MonthGrid
              key={m}
              year={year}
              month={m}
              dayMap={dayMap}
              kind={kind}
              thresholds={yearStats.thresholds}
              palette={palette}
              onClick={openDay}
              base={base}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 mt-6 text-xs text-muted justify-end">
          <span>Меньше</span>
          {palette.map((c, i) => (
            <span
              key={i}
              className="w-3 h-3 rounded-sm border border-border/30"
              style={{ background: c }}
            />
          ))}
          <span>Больше</span>
        </div>
      </div>
    </div>
  );
}

/** Tooltip text with the planned (and, if any, forecast) operation sums from
 *  Zenmoney for a year — moved off the tile face into a hover (issue #48). */
function plannedTip(plan: number, forecast: number, base: string): string | null {
  const parts: string[] = [];
  if (plan > 0) parts.push(`Планируется по Дзен-мани: ${formatMoney(plan, base)}`);
  if (forecast > 0) parts.push(`Прогноз Дзен-мани: ${formatMoney(forecast, base)}`);
  return parts.length ? parts.join(" · ") : null;
}

/** Yearly headline number; when `tip` is set the value gets a hover tooltip
 *  (and a help cursor) instead of a caption line under it. */
function YearValue({
  tone,
  tip,
  children,
}: {
  tone?: string;
  tip?: string | null;
  children: React.ReactNode;
}) {
  const num = <div className={`stat-num ${tone ?? ""} ${tip ? "cursor-help" : ""}`}>{children}</div>;
  return tip ? <Tooltip content={tip}>{num}</Tooltip> : num;
}

function MonthGrid({
  year,
  month,
  dayMap,
  kind,
  thresholds,
  palette,
  onClick,
  base,
}: {
  year: number;
  month: number;
  dayMap: Map<string, DayCell>;
  kind: "expense" | "income";
  thresholds: number[];
  palette: string[];
  onClick: (date: string) => void;
  base: string;
}) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const firstWeekday = (firstDay.getDay() + 6) % 7;

  const cells: ({ d: number; date: string; cell?: DayCell } | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = ymdKey(`${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    cells.push({ d, date, cell: dayMap.get(date) });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  let monthTotal = 0;
  for (const c of cells) {
    if (c?.cell) monthTotal += kind === "expense" ? c.cell.expense : c.cell.income;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="font-medium text-sm">{MONTHS[month]}</div>
        <div className={`text-xs tabular-nums ${kind === "expense" ? "text-expense" : "text-income"}`}>
          {monthTotal > 0 ? formatMoney(monthTotal, base) : ""}
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-[10px] text-muted text-center">
            {w}
          </div>
        ))}
        {cells.map((c, i) => {
          if (!c) return <div key={i} className="aspect-square" />;
          const v = c.cell ? (kind === "expense" ? c.cell.expense : c.cell.income) : 0;
          const idx = binIdx(v, thresholds, palette.length);
          const bg = palette[idx];
          const isStrong = idx >= Math.ceil(palette.length * 0.55);
          const tooltip = c.cell
            ? `${formatDate(c.date)}: ${formatMoney(v, base)} · ${c.cell.count} оп.`
            : formatDate(c.date);
          return (
            <button
              key={i}
              onClick={() => c.cell && onClick(c.date)}
              disabled={!c.cell}
              title={tooltip}
              className="aspect-square rounded-sm border border-border/40 text-[10px] flex items-center justify-center transition-transform hover:scale-110 hover:border-accent disabled:hover:scale-100 disabled:hover:border-border/40 disabled:cursor-default"
              style={{ background: bg }}
            >
              <span className={isStrong ? "text-white font-medium" : v > 0 ? "text-text" : "text-muted"}>
                {c.d}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
