import { TrendingUp, Scale } from "lucide-react";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  CartesianGrid,
  ReferenceLine,
  ReferenceDot,
} from "recharts";
import { ChartContainer } from "./ChartContainer";
import { SectionCard } from "./SectionCard";
import { KindSwitcher } from "./KindSwitcher";
import { DeviationPill } from "./DeviationPill";
import { ChartTooltipCard, TooltipFacts, type TooltipFact } from "./TooltipFacts";
import { SmearPlanToggle } from "./SmearPlanToggle";
import { niceScale } from "../lib/dashboardModel";
import type { CompareTrack, TrackKind, TrackPoint } from "../lib/compareTrack";
import {
  chartAxisStroke,
  chartColor,
  chartGridStroke,
  chartTooltipProps,
  formatMoney,
  formatNum,
} from "../lib/format";

/** «5 октября» / «5 окт» по «ГГГГ-ММ-ДД». */
function dayLabel(date: string | null | undefined, month: "long" | "short" = "long"): string {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("ru-RU", { day: "numeric", month });
}

/**
 * Как подписать ось — зависит от того, что сравниваем:
 * - `monthDay` — месяц с месяцем (и со средним месяцем): числа месяца, общие
 *   для обоих;
 * - `month` — год с годом: месяцы;
 * - `dayIndex` — отрезки, которые не совпадают по числам (30/90 дней, свои
 *   даты): номер дня от начала периода, даты обоих — в подсказке.
 */
export type TrackAxis = "monthDay" | "month" | "dayIndex";

/** «янв» — короткое название месяца без точки. */
function monthShort(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("ru-RU", { month: "short" }).replace(".", "");
}

function TrackTip({
  active,
  payload,
  base,
  labelA,
  labelB,
  color,
  datesB,
  axis,
}: {
  active?: boolean;
  payload?: { payload?: TrackPoint }[];
  base: string;
  labelA: string;
  labelB: string;
  color: string;
  /** Показывать ли дату дня в периоде Б: у среднего за несколько месяцев её нет. */
  datesB: boolean;
  axis: TrackAxis;
}) {
  const p = payload?.[0]?.payload;
  if (!active || !p || (p.a == null && p.b == null && p.f == null)) return null;
  const facts: TooltipFact[] = [];
  // Прогноз — там, где факта уже нет: в сегодняшней точке они совпадают.
  const fc = p.a == null && p.f != null ? p.f : null;
  // По номеру дня у каждого периода своя дата — пишем обе в строках.
  const byIndex = axis === "dayIndex";
  if (p.a != null)
    facts.push({
      label: byIndex && p.dateA ? `${labelA} · ${dayLabel(p.dateA)}` : labelA,
      value: formatMoney(p.a, base),
      swatchColor: color,
    });
  // Даты в строках — только по номеру дня (30/90 дней, свои даты): там у
  // периодов разные числа. Месяцы совмещаются по числу, годы — по дате, и
  // дата одна — в заголовке.
  if (fc != null)
    facts.push({
      label: byIndex && p.dateA ? `Прогноз · ${dayLabel(p.dateA)}` : "Прогноз",
      value: formatMoney(fc, base),
      swatchColor: color,
      swatch: "opacity-60",
    });
  if (p.b != null)
    facts.push({
      label: datesB && byIndex && p.dateB ? `${labelB} · ${dayLabel(p.dateB)}` : labelB,
      value: formatMoney(p.b, base),
      swatch: "bg-muted opacity-60",
    });
  const aOrF = p.a ?? fc;
  if (aOrF != null && p.b != null)
    facts.push({
      label: "Разница",
      value: formatMoney(aOrF - p.b, base, { signed: true }),
      icon: <Scale />,
      strong: true,
    });
  const title = p.dateA && !byIndex ? dayLabel(p.dateA) : `${formatNum(p.day)}-й день`;
  return (
    <ChartTooltipCard>
      <TooltipFacts title={title} facts={facts} />
    </ChartTooltipCard>
  );
}

/**
 * Расходы или доходы двух периодов нарастающим итогом по дням (#117) — как
 * «Сравнение расходов» в Дзен-мани: период А сплошной линией до последнего
 * дня с данными, период Б пунктиром целиком. Над графиком — итог А, итог Б к
 * тому же дню и разница между ними; у идущего периода ещё и итог Б целиком.
 */
export function CompareTrackChart({
  track,
  kind,
  onKindChange,
  base,
  labelA,
  labelB,
  datesB,
  axis,
  smearToggle = false,
}: {
  track: CompareTrack;
  kind: TrackKind;
  onKindChange: (k: TrackKind) => void;
  base: string;
  labelA: string;
  labelB: string;
  /** Есть ли у дней периода Б свои даты (нет у среднего за несколько месяцев). */
  datesB: boolean;
  /** Подписи оси: числа месяца, месяцы или номер дня — см. {@link TrackAxis}. */
  axis: TrackAxis;
  /** Показать «Размазывать план» у прогноза: остаток бюджета к этому
   *  периоду применим (см. ComparePage). */
  smearToggle?: boolean;
}) {
  const color = kind === "expense" ? chartColor.expense : chartColor.income;
  const muted = chartColor.muted;
  const noun = kind === "expense" ? "расходов" : "доходов";
  const hasB = track.points.some((p) => p.b != null);
  // Один из периодов ещё идёт — сравниваем на последнем общем дне и отмечаем
  // его на графике.
  const limited = track.limited;
  // Прогноз до конца А — последняя точка пунктира.
  const lastF = [...track.points].reverse().find((p) => p.f != null && p.a == null) ?? null;
  // Запас сверху на десятую и круглые деления — как на графике месяца в
  // бюджете (и в Дзен-мани): конец прогноза не упирается в рамку. Ниже нуля
  // (возвраты больше трат) — шкала по данным.
  let lo = 0;
  let hi = 0;
  for (const p of track.points)
    for (const v of [p.a, p.b, p.f])
      if (v != null) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
  const yScale = lo < 0 || hi <= 0 ? null : niceScale(hi * 1.1);
  const cmp = track.cmpDay > 0 ? track.points[track.cmpDay - 1] : null;
  const atDay = limited && cmp?.dateA ? ` на ${dayLabel(cmp.dateA)}` : limited ? ` на ${formatNum(track.cmpDay)}-й день` : "";
  // У годов деления — на первый день каждого месяца периода А.
  const firstDD = track.points[0]?.dateA?.slice(8);
  const monthTicks =
    axis === "month"
      ? track.points.filter((p) => p.dateA && p.dateA.slice(8) === firstDD).map((p) => p.day)
      : undefined;

  return (
    <SectionCard
      icon={TrendingUp}
      title={`График сравнения ${noun}`}
      info={
        <p>
          Сколько набралось с начала периода к каждому дню. Сплошная линия —
          {` «${labelA}»`}, пунктир — {`«${labelB}»`}. Месяцы совмещаются по
          числам, годы — по датам, остальные отрезки — по номеру дня от начала.
          Законченные периоды сравниваются целиком, как в таблице выше. Идущий
          период доходит до сегодня, и периоды сравниваются на этом дне. Дальше
          — прогноз пунктиром: запланированные операции в свои дни и, если
          включено «Размазывать план», остаток бюджета ровно по оставшимся
          дням, как «План на день» в Дзен-мани.
        </p>
      }
      right={
        <div className="flex items-center gap-4 flex-wrap justify-end">
          {/* Рядом с переключателем вида, а не в легенде: в легенде он
              переносился отдельной строкой уже на 1440. */}
          {lastF && smearToggle && (
            <span className="text-sm text-muted">
              <SmearPlanToggle />
            </span>
          )}
          <KindSwitcher kind={kind} onChange={onKindChange} />
        </div>
      }
    >
      <div className="flex items-center gap-x-5 gap-y-1 flex-wrap text-sm mt-1 mb-2" data-testid="compare-track-summary">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3.5 h-0.5 rounded-full" style={{ background: color }} />
          <span className="text-muted">
            {labelA}
            {atDay}
          </span>
          <span className="font-semibold tabular-nums">
            {formatMoney(track.aAtCmp, base)}
          </span>
        </span>
        {hasB && (
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-3.5 border-t-2 border-dashed"
              style={{ borderColor: muted }}
            />
            <span className="text-muted">
              {labelB}
              {limited ? " к тому же дню" : ""}
            </span>
            <span className="font-semibold tabular-nums">
              {formatMoney(track.bAtCmp, base)}
            </span>
          </span>
        )}
        {hasB && track.aDays > 0 && (
          <DeviationPill
            current={track.aAtCmp}
            baseline={track.bAtCmp}
            base={base}
            mode="both"
            kind={kind}
            upTitle={`Больше, чем «${labelB}»${limited ? " к тому же дню" : ""}`}
            downTitle={`Меньше, чем «${labelB}»${limited ? " к тому же дню" : ""}`}
          />
        )}
        {limited && track.running && (
          <span className="text-muted">
            {labelB} целиком —{" "}
            <span className="text-text tabular-nums">{formatMoney(track.bTotal, base)}</span>
          </span>
        )}
        {limited && track.bShorter && (
          <span className="text-muted">
            {labelA} целиком —{" "}
            <span className="text-text tabular-nums">{formatMoney(track.aTotal, base)}</span>
          </span>
        )}
        {lastF?.f != null && (
          <span className="flex items-center gap-1.5" data-testid="compare-track-forecast">
            <span
              className="inline-block w-3.5 border-t-2 border-dashed"
              style={{ borderColor: color }}
            />
            <span className="text-muted">Прогноз к {dayLabel(lastF.dateA)}</span>
            <span className="font-semibold tabular-nums">{formatMoney(lastF.f, base)}</span>
          </span>
        )}
      </div>
      <div className="h-64">
        <ChartContainer>
          <ComposedChart data={track.points} margin={{ top: 12, right: 12, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} vertical={false} />
            <XAxis
              dataKey="day"
              stroke={chartAxisStroke}
              fontSize={11}
              tickLine={false}
              minTickGap={axis === "month" ? 4 : 20}
              ticks={monthTicks}
              tickFormatter={(v) => {
                const p = track.points[Number(v) - 1];
                if (axis === "dayIndex" || !p?.dateA) return String(v);
                return axis === "month" ? monthShort(p.dateA) : String(Number(p.dateA.slice(8)));
              }}
            />
            <YAxis
              stroke={chartAxisStroke}
              fontSize={11}
              tickLine={false}
              width={48}
              domain={yScale ? [0, yScale.max] : undefined}
              ticks={yScale ? yScale.ticks : undefined}
              tickFormatter={(v) => formatNum(v, { compact: true })}
            />
            <ChartTooltip
              cursor={chartTooltipProps.cursor}
              wrapperStyle={chartTooltipProps.wrapperStyle}
              content={
                <TrackTip base={base} labelA={labelA} labelB={labelB} color={color} datesB={datesB} axis={axis} />
              }
            />
            {limited && cmp && (
              <ReferenceLine x={cmp.day} stroke={chartAxisStroke} strokeDasharray="2 2" />
            )}
            <Line
              type="monotone"
              dataKey="b"
              name={labelB}
              stroke={muted}
              strokeWidth={2}
              strokeDasharray="4 3"
              strokeOpacity={0.7}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="a"
              name={labelA}
              stroke={color}
              strokeWidth={2.5}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            {lastF && (
              <Line
                type="monotone"
                dataKey="f"
                name="Прогноз"
                stroke={color}
                strokeWidth={2}
                strokeDasharray="4 3"
                strokeOpacity={0.7}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
            {limited && cmp && cmp.b != null && (
              <ReferenceDot x={cmp.day} y={cmp.b} r={3.5} fill={muted} stroke="none" />
            )}
            {limited && cmp && cmp.a != null && (
              <ReferenceDot x={cmp.day} y={cmp.a} r={4.5} fill={color} stroke="rgb(var(--c-panel))" strokeWidth={2} />
            )}
          </ComposedChart>
        </ChartContainer>
      </div>
    </SectionCard>
  );
}
