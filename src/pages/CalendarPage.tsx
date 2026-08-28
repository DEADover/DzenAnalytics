import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CalendarCheck,
  PiggyBank,
  Receipt,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
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
import { InfoPopover, InfoTerm } from "../components/InfoPopover";
import { Segmented } from "../components/Segmented";
import { MonthPicker } from "../components/MonthPicker";
import { StatCell } from "../components/SectionCard";

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
            {/* Общие контролы вместо двух самодельных: свои пилюли и своя
                перелистывалка года повторяли то, что в продукте уже есть, и
                расходились с ними в мелочах. */}
            <Segmented
              value={kind}
              onChange={setKind}
              label="Что показывать на карте"
              size="sm"
              options={[
                { value: "expense" as const, label: "Расходы", icon: TrendingDown },
                { value: "income" as const, label: "Доходы", icon: TrendingUp },
              ]}
            />
            <MonthPicker
              value={`${year}-01`}
              minYM={`${yearMin}-01`}
              maxYM={`${yearMax}-12`}
              active
              mode="year"
              onSelect={(ym) => setYear(Number(ym.slice(0, 4)))}
              onSelectYear={setYear}
              onStep={(dir) => setYear((y) => Math.min(yearMax, Math.max(yearMin, y + dir)))}
            />
            <InfoPopover>
              <p>
                Каждая клетка — день года, её цвет — сколько в этот день{" "}
                {kind === "expense" ? "потрачено" : "получено"}. Пороги оттенков
                считаются по <InfoTerm>вашим же дням</InfoTerm> этого года, а не
                по круглым суммам: самый насыщенный цвет — не «сто тысяч», а
                «ваш самый дорогой день». Поэтому карта одинаково читается и при
                тратах в тысячу рублей в день, и при тратах в сто тысяч.
              </p>
              <p>
                Пустая клетка — день без операций. Нажатие на день открывает его
                операции.
              </p>
              <p>
                Период в общем фильтре на этой странице не показан: его задаёт сам
                календарь — выбранный год. Остальные фильтры (счета, статьи,
                поиск) применяются.
              </p>
            </InfoPopover>
          </div>
        }
      />
      <GlobalFilters showDateRange={false} dateRangeHint="Период задаётся календарём ниже" />

      {/* Пять чисел одним рядом с волосяными чертами — как итоги на других
          страницах. Пятью отдельными карточками они несли столько же рамок и
          отступов, сколько содержимого. */}
      <div className="tray">
        <div className="tray-core px-5 py-4">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-x-4 gap-y-4 divide-border lg:divide-x">
            <StatCell
              label={`Расходы за ${year}`}
              value={formatMoney(yearStats.total, base)}
              icon={<TrendingDown className="w-4 h-4" />}
              tone="expense"
              note={plannedNote(plannedYear.planExpense, plannedYear.fcExpense, base)}
            />
            <StatCell
              label={`Доходы за ${year}`}
              value={formatMoney(yearStats.totalInc, base)}
              icon={<TrendingUp className="w-4 h-4" />}
              tone="income"
              note={plannedNote(plannedYear.planIncome, plannedYear.fcIncome, base)}
              pad
            />
            <StatCell
              label={`Накопления за ${year}`}
              value={formatMoney(savingsYear, base, { signed: true })}
              icon={<PiggyBank className="w-4 h-4" />}
              tone={savingsYear > 0 ? "income" : savingsYear < 0 ? "expense" : "default"}
              note="переводы на копилки минус с них"
              pad
            />
            <StatCell
              label="Операций"
              value={formatNum(yearStats.count)}
              icon={<Receipt className="w-4 h-4" />}
              note={`${formatNum(daysInYear(year))} дней в году`}
              pad
            />
            <StatCell
              label="Активных дней"
              value={`${formatNum(yearStats.activeDays)} из ${formatNum(daysInYear(year))}`}
              icon={<CalendarCheck className="w-4 h-4" />}
              note={
                daysInYear(year) > 0
                  ? `${Math.round((yearStats.activeDays / daysInYear(year)) * 100)}% дней с операциями`
                  : undefined
              }
              pad
            />
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
 * «Ещё не наступило» — строчкой под годовым числом.
 *
 * Дзен-мани знает, что в этом году ещё запланировано и что он сам предсказал по
 * регулярным платежам. Раньше это жило отдельным компонентом с подсказкой при
 * наведении; в ряду ячеек для него есть готовое место — подпись под числом, а
 * наведение прятало число от того, кто про него не знает.
 *
 * Пусто, когда планировать нечего: счёт без планов не должен нести строку нулей.
 */
function plannedNote(plan: number, forecast: number, base: string): string | undefined {
  const parts = plannedBreakdown(plan, forecast);
  if (parts.length === 0) return undefined;
  return `Ещё ${parts.map((p) => `${p.label.toLowerCase()} ${formatMoney(p.amount, base)}`).join(" · ")}`;
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
