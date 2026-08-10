import { useMemo } from "react";
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
import { buildMonthCashflow } from "../lib/budgets";
import {
  formatMoney,
  formatNum,
  toNum,
  chartTooltipProps,
  chartGridStroke,
  chartAxisStroke,
} from "../lib/format";

const INCOME = "#10B981";
const EXPENSE = "#EF4444";

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

export function MonthCashflowChart({
  transactions,
  ym,
  base,
  onDayClick,
  plannedIncome,
  plannedExpense,
  plannedIncomeByDay,
  plannedExpenseByDay,
}: {
  transactions: Transaction[];
  ym: string;
  base: string;
  /** Click a day on the chart → drill into that day's transactions. */
  onDayClick?: (day: number) => void;
  /** Month budget plans — when given, the end-of-month forecast projects to the
   *  plan (Zen-style) instead of extrapolating the current daily pace. */
  plannedIncome?: number;
  plannedExpense?: number;
  /** Запланированные операции Дзен-мани по дням месяца: прогноз рисует их
   *  ступенькой в свой день, а не размазывает ровно до конца месяца. */
  plannedIncomeByDay?: number[];
  plannedExpenseByDay?: number[];
}) {
  const cf = useMemo(
    () =>
      buildMonthCashflow(transactions, ym, Date.now(), {
        plannedIncome,
        plannedExpense,
        plannedIncomeByDay,
        plannedExpenseByDay,
      }),
    [transactions, ym, plannedIncome, plannedExpense, plannedIncomeByDay, plannedExpenseByDay]
  );
  const hasForecast = cf.todayDay > 0 && cf.todayDay < cf.days;

  return (
    <div className="card card-pad">
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
          onDayClick(Math.round(1 + frac * (cf.days - 1)));
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
            />
            <YAxis
              stroke={chartAxisStroke}
              fontSize={11}
              tickLine={false}
              width={48}
              tickFormatter={(v) => formatNum(v, { compact: true })}
            />
            <ChartTooltip
              {...chartTooltipProps}
              labelFormatter={(d) => `День ${d}`}
              formatter={(v: unknown, name: unknown) => [formatMoney(toNum(v), base), String(name)]}
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
  );
}
