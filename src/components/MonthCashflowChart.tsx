import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import type { Transaction } from "../types";
import { Scale } from "lucide-react";
import { buildMonthCashflow } from "../lib/budgets";
import { ChartTooltipCard, TooltipFacts, type TooltipFact } from "./TooltipFacts";
import {
  formatMoney,
  formatNum,
  toNum,
  chartTooltipProps,
  chartGridStroke,
  chartAxisStroke,
  chartColor,
} from "../lib/format";

const INCOME = chartColor.income;
const EXPENSE = chartColor.expense;

/**
 * Full-width «денежный поток за месяц» widget — cumulative income (green) and
 * expense (red) across the days of `ym`, solid up to today and dashed as a
 * linear end-of-month forecast (mirrors Zenmoney «Планы» / «План на день»).
 * A readout below states the projected month-end gap: free money or shortfall.
 */
/** «Сегодня» marker label, rendered INSIDE the plot area at the very top,
 *  anchored to the RIGHT of the line — so early in the month (when the line
 *  sits next to the Y axis) it doesn't collide with the axis or its top tick. */
function TodayLabel({ viewBox }: { viewBox?: { x?: number; y?: number } }) {
  const x = viewBox?.x ?? 0;
  const y = viewBox?.y ?? 0;
  return (
    <text
      x={x + 5}
      y={y + 2}
      textAnchor="start"
      fontSize={11}
      fontWeight={600}
      fill={chartAxisStroke}
    >
      Сегодня
    </text>
  );
}

/**
 * Подсказка графика — той же вёрсткой, что и подсказки полос в статьях:
 * заголовок, ниже двумя колонками «подпись → сумма», у каждой строки метка
 * цвета своей линии. Рехартовская стандартная («Поступления : 157 708 ₽»
 * серым столбиком) выбивалась из раздела: одни и те же цифры выглядели
 * по-разному в двух местах одного экрана.
 */
/** «Август» — название месяца по «YYYY-MM», для заголовка карточки. */
function monthNameOf(ym: string): string {
  return new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString(
    "ru-RU",
    { month: "long" }
  );
}

/**
 * «13 августа» — подпись дня по его КАЛЕНДАРНОЙ дате.
 *
 * Дату берём готовой из точки графика: ось размечена номерами дней внутри
 * отчётного периода, а он может идти через стык месяцев (15.09–14.10), и по
 * одному номеру календарный день не восстановить.
 */
function dayLabelOf(date: string | undefined): string {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  });
}

function CashflowTip({
  active,
  payload,
  label,
  base,
  dateOf,
}: {
  active?: boolean;
  payload?: { name?: string; dataKey?: string | number; value?: number | null }[];
  label?: string | number;
  base: string;
  /** Календарная дата по номеру дня в периоде. */
  dateOf: (day: number) => string | undefined;
}) {
  const rows = (payload ?? []).filter((p) => p.value != null);
  if (!active || rows.length === 0) return null;
  const at = (keys: string[]) =>
    rows.find((p) => keys.includes(String(p.dataKey)))?.value ?? null;
  const income = at(["income", "incomeF"]);
  const expense = at(["expense", "expenseF"]);
  const facts: TooltipFact[] = rows.map((p) => {
    const key = String(p.dataKey);
    const forecast = key.endsWith("F");
    return {
      label: String(p.name ?? key),
      value: formatMoney(toNum(p.value), base),
      // Прогноз бледнее — ровно как его линия на графике.
      swatch: `${key.startsWith("income") ? "bg-income" : "bg-expense"}${
        forecast ? " opacity-60" : ""
      }`,
      strong: !forecast,
    };
  });
  if (income !== null && expense !== null) {
    const diff = income - expense;
    facts.push({
      label: "Разница",
      value: formatMoney(diff, base, { signed: true }),
      icon: <Scale />,
      tone: diff >= 0 ? "income" : "expense",
      strong: true,
    });
  }
  return (
    <ChartTooltipCard>
      <TooltipFacts title={dayLabelOf(dateOf(Number(label)))} facts={facts} />
    </ChartTooltipCard>
  );
}

export function MonthCashflowChart({
  transactions,
  ym,
  base,
  monthStartDay = 1,
  onDayClick,
  plannedIncome,
  plannedExpense,
  plannedIncomeByDay,
  plannedExpenseByDay,
}: {
  transactions: Transaction[];
  ym: string;
  base: string;
  /** Первый день отчётного месяца: ось графика идёт по отчётному периоду. */
  monthStartDay?: number;
  /** Click a day on the chart → drill into that day's transactions. Отдаём
   *  КАЛЕНДАРНУЮ дату: период может идти через стык месяцев. */
  onDayClick?: (date: string) => void;
  /** Month budget plans — when given, the end-of-month forecast projects to the
   *  plan (Zen-style) instead of extrapolating the current daily pace. */
  plannedIncome?: number;
  plannedExpense?: number;
  /** Запланированные операции Дзен-мани по дням месяца: прогноз рисует их
   *  ступенькой в свой день, а не размазывает ровно до конца месяца. */
  plannedIncomeByDay?: number[];
  plannedExpenseByDay?: number[];
}) {
  // «Сегодня» снимаем один раз при монтировании, а не читаем часы прямо в
  // рендере. Час в зависимостях `useMemo` не значился, поэтому вертикаль
  // «Сегодня» сдвигалась не в полночь, а когда случайно пересчитывался memo, —
  // то есть в момент, никак не связанный с временем.
  const [now] = useState(() => Date.now());
  const cf = useMemo(
    () =>
      buildMonthCashflow(transactions, ym, now, {
        plannedIncome,
        plannedExpense,
        plannedIncomeByDay,
        plannedExpenseByDay,
        monthStartDay,
      }),
    [
      transactions,
      ym,
      now,
      plannedIncome,
      plannedExpense,
      plannedIncomeByDay,
      plannedExpenseByDay,
      monthStartDay,
    ]
  );
  const hasForecast = cf.todayDay > 0 && cf.todayDay < cf.days;
  /** Календарная дата по номеру дня в периоде — для подписей и переходов. */
  const dateOf = (day: number) => cf.points[day - 1]?.date;

  return (
    <div className="tray">
    <div className="tray-core card-pad">
      {/* Заголовок и легенда: без них на карточке просто две кривые и пунктир —
          что именно нарисовано и почему линия обрывается на «Сегодня», читатель
          угадывал. Легенда своя, а не рехартовская: та встаёт отдельной
          строкой во всю ширину и повторяет четыре имени серий вместо трёх
          смыслов. */}
      <div className="flex items-baseline justify-between gap-x-4 gap-y-1 flex-wrap mb-2">
        <div className="label">Планы на {monthNameOf(ym)}</div>
        <div className="flex items-center gap-3 text-xs text-muted flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3.5 h-0.5 rounded-full" style={{ background: INCOME }} />
            Поступления
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3.5 h-0.5 rounded-full" style={{ background: EXPENSE }} />
            Расходы
          </span>
          {hasForecast && (
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block w-3.5 border-t-2 border-dashed"
                style={{ borderColor: chartAxisStroke }}
              />
              Прогноз до конца месяца
            </span>
          )}
          {onDayClick && <span>Клик по дню — его операции</span>}
        </div>
      </div>
      <div
        className={`h-64 ${onDayClick ? "cursor-pointer" : ""}`}
        onClick={(e) => {
          // Day from the click X within the plot area (left margin 8 + YAxis 48).
          if (!onDayClick) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const left = 56;
          const right = 12;
          const plotW = rect.width - left - right;
          if (plotW <= 0) return;
          const frac = Math.min(Math.max((e.clientX - rect.left - left) / plotW, 0), 1);
          const date = dateOf(Math.round(1 + frac * (cf.days - 1)));
          if (date) onDayClick(date);
        }}
      >
        <ResponsiveContainer>
          <ComposedChart data={cf.points} margin={{ top: 18, right: 12, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} vertical={false} />
            <XAxis
              dataKey="day"
              stroke={chartAxisStroke}
              fontSize={11}
              tickLine={false}
              minTickGap={24}
              // На оси — ЧИСЛО МЕСЯЦА, а не номер дня в периоде: с первым днём
              // 15 подписи идут «15 … 30, 1 … 14», как в календаре.
              tickFormatter={(v) => {
                const date = dateOf(Number(v));
                return date ? String(Number(date.slice(8, 10))) : String(v);
              }}
            />
            <YAxis
              stroke={chartAxisStroke}
              fontSize={11}
              tickLine={false}
              width={48}
              tickFormatter={(v) => formatNum(v, { compact: true })}
            />
            <ChartTooltip
              cursor={chartTooltipProps.cursor}
              wrapperStyle={chartTooltipProps.wrapperStyle}
              content={<CashflowTip base={base} dateOf={dateOf} />}
            />
            {hasForecast && (
              <ReferenceLine
                x={cf.todayDay}
                stroke={chartAxisStroke}
                strokeDasharray="2 2"
                label={<TodayLabel />}
              />
            )}
            {/* Actual cumulative — solid */}
            <Line type="monotone" dataKey="income" name="Поступления" stroke={INCOME} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="expense" name="Расходы" stroke={EXPENSE} strokeWidth={2} dot={false} isAnimationActive={false} />
            {/* Forecast — dashed continuation from today */}
            <Line type="monotone" dataKey="incomeF" name="Прогноз поступлений" stroke={INCOME} strokeWidth={2} strokeDasharray="4 3" strokeOpacity={0.7} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="expenseF" name="Прогноз расходов" stroke={EXPENSE} strokeWidth={2} strokeDasharray="4 3" strokeOpacity={0.7} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
    </div>
  );
}
