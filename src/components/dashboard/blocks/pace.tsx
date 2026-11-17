import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  CartesianGrid,
  ReferenceDot,
} from "recharts";
import { MoreHorizontal } from "lucide-react";
import { ChartContainer } from "../../ChartContainer";
import { ChartTooltipCard, TooltipFacts, type TooltipFact } from "../../TooltipFacts";
import { DeviationPill } from "../../DeviationPill";
import { CategoryDot } from "../../CategoryDot";
import { SectionEmpty } from "../../SectionEmpty";
import { niceScale } from "../../../lib/dashboardModel";
import { dayAndMonth } from "../../../lib/dayLabel";
import { pluralRu } from "../../../lib/plural";
import {
  chartAxisStroke,
  chartColor,
  chartGridStroke,
  chartTooltipProps,
  formatMoney,
  formatNum,
} from "../../../lib/format";
import type { PaceCategory, PacePoint, SpendingPace } from "../../../lib/spendingPace";

/**
 * «Темп трат» — расходы месяца нарастающим итогом рядом с прошлым месяцем.
 *
 * Два вида одного ответа. «Со статьями» — как «Расходы» в Дзен-мани: число,
 * небольшая линия и крупнейшие статьи, у каждой — насколько она разошлась с
 * теми же днями прошлого месяца. «График» — линия во весь виджет и третья
 * линия, среднее за последние месяцы: по ней видно, обычный ли это месяц.
 */

export interface PaceLabels {
  /** «Ноябрь» — месяц виджета. */
  month: string;
  /** «Октябрь» — прошлый месяц. */
  prev: string;
  /** «октябре» — он же в предложном падеже. */
  prevIn: string;
}

function avgLabel(months: number): string {
  return `Среднее за ${months} ${pluralRu(months, ["месяц", "месяца", "месяцев"])}`;
}

function PaceTip({
  active,
  payload,
  base,
  labels,
  avgMonths,
}: {
  active?: boolean;
  payload?: { payload?: PacePoint }[];
  base: string;
  labels: PaceLabels;
  /** 0 — строки среднего в подсказке нет. */
  avgMonths: number;
}) {
  const p = payload?.[0]?.payload;
  if (!active || !p || (p.now == null && p.prev == null && p.avg == null)) return null;
  const facts: TooltipFact[] = [];
  if (p.now != null)
    facts.push({ label: labels.month, value: formatMoney(p.now, base), swatch: "bg-expense", strong: true });
  if (p.prev != null)
    facts.push({ label: labels.prev, value: formatMoney(p.prev, base), swatch: "bg-muted opacity-70" });
  if (avgMonths > 0 && p.avg != null)
    facts.push({ label: avgLabel(avgMonths), value: formatMoney(p.avg, base), swatch: "bg-muted opacity-40" });
  return (
    <ChartTooltipCard>
      <TooltipFacts title={p.date ? dayAndMonth(p.date) : `${formatNum(p.day)}-й день`} facts={facts} />
    </ChartTooltipCard>
  );
}

function PaceChart({
  pace,
  base,
  labels,
  compact,
}: {
  pace: SpendingPace;
  base: string;
  labels: PaceLabels;
  /** Без осей и без среднего: маленькая линия рядом с числом. */
  compact: boolean;
}) {
  const color = chartColor.expense;
  const muted = chartColor.muted;
  const showAvg = !compact && pace.avgMonths > 0;
  let lo = 0;
  let hi = 0;
  for (const p of pace.points)
    for (const v of [p.now, p.prev, showAvg ? p.avg : null])
      if (v != null) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
  // Запас сверху и круглые деления; ниже нуля (возвраты больше трат) — по данным.
  const yScale = lo < 0 || hi <= 0 ? null : niceScale(hi * 1.1);
  const last = pace.nowDays > 0 ? pace.points[pace.nowDays - 1] : null;
  return (
    <ChartContainer>
      <ComposedChart
        data={pace.points}
        margin={compact ? { top: 8, right: 8, bottom: 4, left: 4 } : { top: 10, right: 10, bottom: 0, left: 0 }}
      >
        {!compact && <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} vertical={false} />}
        <XAxis
          dataKey="day"
          hide={compact}
          stroke={chartAxisStroke}
          fontSize={11}
          tickLine={false}
          minTickGap={18}
          tickFormatter={(v) => {
            const p = pace.points[Number(v) - 1];
            return p?.date ? String(Number(p.date.slice(8))) : String(v);
          }}
        />
        <YAxis
          hide={compact}
          stroke={chartAxisStroke}
          fontSize={11}
          tickLine={false}
          width={52}
          domain={yScale ? [0, yScale.max] : undefined}
          ticks={yScale ? yScale.ticks : undefined}
          tickFormatter={(v) => formatNum(v, { compact: true })}
        />
        <ChartTooltip
          cursor={chartTooltipProps.cursor}
          wrapperStyle={chartTooltipProps.wrapperStyle}
          content={<PaceTip base={base} labels={labels} avgMonths={showAvg ? pace.avgMonths : 0} />}
        />
        {showAvg && (
          <Line
            type="monotone"
            dataKey="avg"
            stroke={muted}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            strokeOpacity={0.6}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        )}
        <Line
          type="monotone"
          dataKey="prev"
          stroke={muted}
          strokeWidth={2}
          strokeOpacity={0.55}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="now"
          stroke={color}
          strokeWidth={2.5}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        {last?.now != null && (
          <ReferenceDot
            x={last.day}
            y={last.now}
            r={4.5}
            fill={color}
            stroke="rgb(var(--c-panel))"
            strokeWidth={2}
          />
        )}
      </ComposedChart>
    </ChartContainer>
  );
}

/** Число, отклонение и с чем сравнили. */
function PaceHead({
  pace,
  base,
  labels,
}: {
  pace: SpendingPace;
  base: string;
  labels: PaceLabels;
}) {
  const last = pace.nowDays > 0 ? pace.points[pace.nowDays - 1] : null;
  const sameDay = pace.running ? " к этому дню" : "";
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-[0.08em] text-muted">
        {pace.running && last?.date
          ? `Потрачено к ${dayAndMonth(last.date)}`
          : `Потрачено за ${labels.month.toLowerCase()}`}
      </div>
      <div
        className="mt-1 text-[28px] font-bold tracking-[-0.03em] tabular-nums leading-[1.1] whitespace-nowrap"
        data-testid="pace-total"
      >
        {formatMoney(pace.nowAt, base)}
      </div>
      <div className="mt-1.5 text-[13px] text-muted tabular-nums">
        {pace.prevAt == null ? (
          "Сравнить пока не с чем"
        ) : (
          <>
            <DeviationPill
              current={pace.nowAt}
              baseline={pace.prevAt}
              base={base}
              mode="both"
              kind="expense"
              upTitle={`Больше, чем в ${labels.prevIn}${sameDay}`}
              downTitle={`Меньше, чем в ${labels.prevIn}${sameDay}`}
            />
            <div className="mt-1.5 text-[12px]">
              В {labels.prevIn}
              {sameDay} — {formatMoney(pace.prevAt, base)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function LegendMark({ dashed, color, opacity }: { dashed?: boolean; color: string; opacity?: number }) {
  return (
    <span
      className={`inline-block w-3.5 border-t-2 ${dashed ? "border-dashed" : ""}`}
      style={{ borderColor: color, opacity }}
      aria-hidden="true"
    />
  );
}

export function PaceBlock({
  pace,
  categories,
  base,
  labels,
  view,
  onCategory,
}: {
  pace: SpendingPace;
  categories: PaceCategory[];
  base: string;
  labels: PaceLabels;
  /** «categories» — число, линия и статьи; «chart» — линия во весь виджет. */
  view: "categories" | "chart";
  onCategory: (name: string) => void;
}) {
  if (pace.nowDays === 0) {
    return <SectionEmpty variant="compact">Месяц ещё не начался</SectionEmpty>;
  }

  if (view === "chart") {
    return (
      <div className="flex-1 min-h-0 flex flex-col gap-3" data-testid="pace-block">
        <PaceHead pace={pace} base={base} labels={labels} />
        <div className="flex-1 min-h-[160px]">
          <PaceChart pace={pace} base={base} labels={labels} compact={false} />
        </div>
        <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-[12px] text-muted">
          <span className="flex items-center gap-1.5">
            <LegendMark color={chartColor.expense} />
            {labels.month}
          </span>
          {pace.prevAt != null && (
            <span className="flex items-center gap-1.5">
              <LegendMark color={chartColor.muted} opacity={0.55} />
              {labels.prev}
            </span>
          )}
          {pace.avgMonths > 0 && (
            <span className="flex items-center gap-1.5">
              <LegendMark color={chartColor.muted} opacity={0.6} dashed />
              {avgLabel(pace.avgMonths)}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3" data-testid="pace-block">
      <div className="flex items-stretch gap-3">
        <PaceHead pace={pace} base={base} labels={labels} />
        <div className="flex-1 min-w-[96px] min-h-[96px]">
          <PaceChart pace={pace} base={base} labels={labels} compact />
        </div>
      </div>
      {categories.length === 0 ? (
        <SectionEmpty variant="compact">Расходов пока не было</SectionEmpty>
      ) : (
        <div className="scroll-soft flex flex-col flex-1 min-h-0 -mx-2 px-2" data-testid="pace-categories">
          {categories.map((c) => {
            const body = (
              <>
                {c.rest ? (
                  <span className="w-7 h-7 shrink-0 rounded-full bg-panel2 text-muted grid place-items-center">
                    <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
                  </span>
                ) : (
                  <CategoryDot category={c.name} size="w-7 h-7" />
                )}
                <span className={`flex-1 min-w-0 truncate text-[15px] ${c.rest ? "text-muted" : "group-hover:text-accent"}`}>
                  {c.name}
                </span>
                <span className="shrink-0 flex flex-col items-end gap-1">
                  <span className="font-mono tabular-nums text-[14px] font-medium">
                    {formatMoney(c.now, base)}
                  </span>
                  {c.prev != null && (
                    <span className="text-[13px]">
                      <DeviationPill
                        current={c.now}
                        baseline={c.prev}
                        base={base}
                        mode="both"
                        kind="expense"
                        upTitle={`Больше, чем в ${labels.prevIn}${pace.running ? " к этому дню" : ""}`}
                        downTitle={`Меньше, чем в ${labels.prevIn}${pace.running ? " к этому дню" : ""}`}
                      />
                    </span>
                  )}
                </span>
              </>
            );
            const row = "w-full shrink-0 flex items-center gap-2 py-1.5 px-2 rounded-lg text-left";
            return c.rest ? (
              <div key="__rest" className={row}>
                {body}
              </div>
            ) : (
              <button
                key={c.name}
                type="button"
                onClick={() => onCategory(c.name)}
                className={`${row} group transition-colors duration-200 hover:bg-panel2/70 active:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`}
              >
                {body}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
