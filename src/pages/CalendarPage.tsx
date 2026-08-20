import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useDrillStore } from "../store/useDrillStore";
import { dailyExpenseMap, transferTotals, type DayCell } from "../lib/aggregations";
import { loadZenCache, type ZenCache } from "../lib/zenmoneyCache";
import clsx from "clsx";
import { plannedOps, plannedBreakdown } from "../lib/plannedOps";
import { getLiveAccountsFromCache } from "../store/useZenmoneyStore";
import { formatMoney, formatDate, formatNum, ymdKey } from "../lib/format";
import { pluralRu } from "../lib/plural";
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
        hint="Тепловая карта по дням года"
        right={
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex bg-panel2 rounded-full p-1 border border-border shadow-tray">
              <button
                onClick={() => setKind("expense")}
                className={`px-3 py-1 text-xs rounded-full ${kind === "expense" ? "bg-expense text-white" : "text-muted"}`}
              >
                Расходы
              </button>
              <button
                onClick={() => setKind("income")}
                className={`px-3 py-1 text-xs rounded-full ${kind === "income" ? "bg-income text-white" : "text-muted"}`}
              >
                Доходы
              </button>
            </div>
            <div className="flex items-center gap-1 bg-panel2 rounded-full p-1 border border-border shadow-tray">
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
          </div>
        }
      />
      <GlobalFilters showDateRange={false} dateRangeHint="Период задаётся календарём ниже" />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="card-tray card-pad">
          <div className="label mb-1">Расходы за {year}</div>
          <YearValue tone="text-expense">
            {formatMoney(yearStats.total, base)}
          </YearValue>
          <PlannedNote
            plan={plannedYear.planExpense}
            forecast={plannedYear.fcExpense}
            base={base}
          />
        </div>
        <div className="card-tray card-pad">
          <div className="label mb-1">Доходы за {year}</div>
          <YearValue tone="text-income">
            {formatMoney(yearStats.totalInc, base)}
          </YearValue>
          <PlannedNote
            plan={plannedYear.planIncome}
            forecast={plannedYear.fcIncome}
            base={base}
          />
        </div>
        {/* «Накопления» за год (issue #48) — сумма из правила #42. */}
        <div className="card-tray card-pad">
          <div className="label mb-1">Накопления за {year}</div>
          <YearValue
            tone={savingsYear > 0 ? "text-income" : savingsYear < 0 ? "text-expense" : ""}
            tip={
              <div className="space-y-1">
                <div className="font-medium">Как считается</div>
                <div className="text-muted">
                  Переводы НА накопительные счета минус переводы С них за год.
                </div>
                <div className="text-muted">
                  Перевод между двумя накопительными даёт ноль.
                </div>
                <div className="text-muted">
                  Начальные остатки не учитываются — только переводы.
                </div>
              </div>
            }
          >
            {formatMoney(savingsYear, base, { signed: true })}
          </YearValue>
        </div>
        <div className="card-tray card-pad">
          <div className="label mb-1">Операций</div>
          <div className="stat-num">{formatNum(yearStats.count)}</div>
        </div>
        <div className="card-tray card-pad">
          <div className="label mb-1">Активных дней</div>
          <div className="stat-num">
            {yearStats.activeDays}
            <span className="text-muted text-sm ml-1">/ {daysInYear(year)}</span>
          </div>
        </div>
      </div>

      <div className="card-tray card-pad">
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
              className="w-3 h-3 rounded-md border border-border/30"
              style={{ background: c }}
            />
          ))}
          <span>Больше</span>
        </div>
      </div>
    </div>
  );
}

/**
 * «Справочно» line under a year total: what Дзен-мани still has scheduled for
 * this year (issue #48). Lives on the tile face rather than in a tooltip —
 * a hover-only number is a number nobody finds.
 *
 * Renders nothing at all when there's nothing scheduled, so accounts that don't
 * use планы/прогнозы don't carry a row of zeroes.
 */
function PlannedNote({
  plan,
  forecast,
  base,
}: {
  plan: number;
  forecast: number;
  base: string;
}) {
  const parts = plannedBreakdown(plan, forecast);
  if (parts.length === 0) return null;
  return (
    <Tooltip
      content={
        <div className="space-y-1">
          <div className="font-medium">Ещё не наступившие операции</div>
          <div>
            <span className="text-text">План</span>
            <span className="text-muted"> — вы запланировали их сами</span>
          </div>
          <div>
            <span className="text-text">Прогноз</span>
            <span className="text-muted"> — Дзен предсказал по регулярным платежам</span>
          </div>
        </div>
      }
    >
      <div className="text-xs text-muted mt-1 tabular-nums cursor-help w-max">
        {parts.map((p, i) => (
          <span key={p.label}>
            {i > 0 && " · "}
            {p.label} {formatMoney(p.amount, base)}
          </span>
        ))}
      </div>
    </Tooltip>
  );
}

/** Yearly headline number; when `tip` is set the value gets a hover tooltip
 *  (and a help cursor) instead of a caption line under it. */
function YearValue({
  tone,
  tip,
  children,
}: {
  tone?: string;
  tip?: React.ReactNode;
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
          // A day can hold operations and still be colourless — the heatmap
          // shows ONE side (расходы or доходы), so a day with income only is a
          // flat zero while «Расходы» is selected. It's still clickable, so mark
          // it: otherwise it looks dead and the click reads as broken.
          const otherKindOnly = !!c.cell && v === 0;
          const cell = (
            <button
              key={i}
              onClick={() => c.cell && onClick(c.date)}
              disabled={!c.cell}
              className={clsx(
                "aspect-square rounded-md text-[10px] flex items-center justify-center transition-transform hover:scale-110 hover:border-accent disabled:hover:scale-100 disabled:cursor-default",
                otherKindOnly
                  ? "border border-dashed border-accent/50"
                  : "border border-border/40 disabled:hover:border-border/40"
              )}
              style={{ background: bg }}
            >
              <span className={isStrong ? "text-white font-medium" : v > 0 ? "text-text" : "text-muted"}>
                {c.d}
              </span>
            </button>
          );
          // Only days that HAVE operations get a tooltip: a disabled button
          // fires no mouse events, so a bubble on an empty day would never show
          // anyway — and its date is already readable from the grid.
          if (!c.cell) return cell;
          return (
            <Tooltip key={i} content={<DayTip date={c.date} value={v} count={c.cell.count} kind={kind} base={base} />}>
              {cell}
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Body of a day's tooltip: date on top, then the side the heatmap is showing,
 * then how many operations. Three short lines beat one long string — the day
 * cells are 20 px wide, so a single-line bubble ends up wider than the month.
 */
function DayTip({
  date,
  value,
  count,
  kind,
  base,
}: {
  date: string;
  value: number;
  count: number;
  kind: "expense" | "income";
  base: string;
}) {
  const side = kind === "expense" ? "Расходы" : "Доходы";
  return (
    <div className="space-y-0.5">
      <div className="font-medium">{formatDate(date)}</div>
      <div className={value > 0 ? (kind === "expense" ? "text-expense" : "text-income") : "text-muted"}>
        {value > 0 ? `${side}: ${formatMoney(value, base)}` : `${side.toLowerCase()} отсутствуют`}
      </div>
      <div className="text-muted">
        {formatNum(count)} {pluralRu(count, ["операция", "операции", "операций"])}
      </div>
    </div>
  );
}

/** 366 in a leap year — the «активных дней» denominator must match the grid
 *  actually drawn, which does include 29 February. */
function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}
