import { useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ReferenceLine,
  ReferenceDot,
} from "recharts";
import type { Projection } from "../../lib/whatif";
import {
  chartAxisStroke,
  chartColor,
  chartGridStroke,
  formatMoney,
  formatNum,
} from "../../lib/format";
import { SERIES_COLOR, monthYear } from "../../lib/whatifView";
import { ChartTooltipCard, TooltipFacts, type TooltipFact } from "../TooltipFacts";

export interface ChartSeries {
  name: string;
  projection: Projection;
}

/**
 * Траектория капитала: «как сейчас», открытый сценарий и, если выбран, второй
 * для сравнения. Линия цели FIRE — когда до неё на графике недалеко; точка —
 * месяц, в который сценарий до неё дорастает.
 *
 * Сценарий — залитой областью, остальные — линиями: главное на графике то,
 * что вы сейчас двигаете, а «как сейчас» — фон, с которым его сравнивают.
 */
export function WhatIfChart({
  now,
  active,
  compare,
  base,
}: {
  now: ChartSeries;
  active: ChartSeries;
  compare: ChartSeries | null;
  base: string;
}) {
  const data = useMemo(
    () =>
      active.projection.points.map((p, i) => ({
        ym: p.ym,
        now: Math.round(now.projection.points[i]?.capital ?? 0),
        active: Math.round(p.capital),
        compare: compare ? Math.round(compare.projection.points[i]?.capital ?? 0) : undefined,
      })),
    [now, active, compare]
  );

  // Деления оси — по годам: подпись каждого месяца на 10 лет — это 120 подписей.
  const years = Math.max(1, Math.round((data.length - 1) / 12));
  const step = years <= 3 ? 3 : years <= 10 ? 12 : years <= 20 ? 24 : 60;
  const ticks = data.filter((_, i) => i % step === 0).map((d) => d.ym);

  const target = active.projection.fireTarget;
  const max = Math.max(...data.map((d) => Math.max(d.now, d.active, d.compare ?? 0)));
  // Цель показываем, когда капитал подбирается к ней хотя бы наполовину:
  // иначе линия цели вверху сжимает всю траекторию в полоску у нуля.
  const showTarget = target > 0 && max >= target * 0.5;
  const fireYm = active.projection.fireYm;
  const firePoint = fireYm ? data.find((d) => d.ym === fireYm) : undefined;

  return (
    <div className="h-80">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="whatIfFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES_COLOR.active} stopOpacity={0.35} />
              <stop offset="100%" stopColor={SERIES_COLOR.active} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} vertical={false} />
          <XAxis
            dataKey="ym"
            ticks={ticks}
            stroke={chartAxisStroke}
            fontSize={11}
            tickFormatter={(ym: string) => (step >= 12 ? ym.slice(0, 4) : monthYear(ym))}
          />
          <YAxis
            stroke={chartAxisStroke}
            fontSize={11}
            width={56}
            tickFormatter={(v: number) => formatNum(v, { compact: true })}
          />
          <RTooltip
            cursor={{ stroke: chartAxisStroke, strokeDasharray: "3 3" }}
            content={(props) => (
              <CapitalTooltip
                {...(props as unknown as TooltipProps)}
                base={base}
                names={{ now: now.name, active: active.name, compare: compare?.name }}
                events={active.projection.eventsByYm}
              />
            )}
          />
          {showTarget && (
            <ReferenceLine
              y={target}
              stroke={chartColor.warn}
              strokeDasharray="4 4"
              // Цель чуть выше траектории — ось дотягивается до неё сама, с
              // круглыми делениями, а не обрезает линию.
              ifOverflow="extendDomain"
              label={{
                value: "Цель FIRE",
                position: "insideTopLeft",
                fill: chartColor.warn,
                fontSize: 11,
              }}
            />
          )}
          <ReferenceLine y={0} stroke={chartAxisStroke} />
          <Area
            type="monotone"
            dataKey="active"
            name={active.name}
            stroke={SERIES_COLOR.active}
            strokeWidth={2}
            fill="url(#whatIfFill)"
            isAnimationActive={false}
          />
          {compare && (
            <Line
              type="monotone"
              dataKey="compare"
              name={compare.name}
              stroke={SERIES_COLOR.compare}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          )}
          <Line
            type="monotone"
            dataKey="now"
            name={now.name}
            stroke={SERIES_COLOR.now}
            strokeWidth={1.5}
            strokeDasharray="5 4"
            dot={false}
            isAnimationActive={false}
          />
          {firePoint && showTarget && (
            <ReferenceDot
              x={firePoint.ym}
              y={firePoint.active}
              r={5}
              fill={chartColor.warn}
              stroke="rgb(var(--c-panel))"
              strokeWidth={2}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

interface TooltipProps {
  active?: boolean;
  label?: string;
  payload?: { dataKey?: string; value?: number; color?: string }[];
}

function CapitalTooltip({
  active,
  label,
  payload,
  base,
  names,
  events,
}: TooltipProps & {
  base: string;
  names: { now: string; active: string; compare?: string };
  events: Record<string, number>;
}) {
  if (!active || !payload?.length || !label) return null;
  const val = (key: string) => payload.find((p) => p.dataKey === key)?.value;
  const now = val("now");
  const act = val("active");
  const cmp = val("compare");
  const facts: TooltipFact[] = [];
  if (act != null) facts.push({ label: names.active, value: formatMoney(act, base), swatchColor: SERIES_COLOR.active, strong: true });
  if (cmp != null && names.compare)
    facts.push({ label: names.compare, value: formatMoney(cmp, base), swatchColor: SERIES_COLOR.compare });
  if (now != null) facts.push({ label: names.now, value: formatMoney(now, base), swatchColor: SERIES_COLOR.now });
  if (act != null && now != null && Math.round(act - now) !== 0)
    facts.push({
      label: "Разница со «Как сейчас»",
      value: formatMoney(act - now, base, { signed: true }),
      tone: act > now ? "income" : "expense",
    });
  const ev = events[label];
  if (ev)
    facts.push({
      label: "События месяца",
      value: formatMoney(ev, base, { signed: true }),
      tone: ev > 0 ? "income" : "expense",
    });
  return (
    <ChartTooltipCard>
      <TooltipFacts title={monthYear(label)} facts={facts} />
    </ChartTooltipCard>
  );
}
