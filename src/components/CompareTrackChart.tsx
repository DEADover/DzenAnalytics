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

function TrackTip({
  active,
  payload,
  base,
  labelA,
  labelB,
  color,
  datesB,
}: {
  active?: boolean;
  payload?: { payload?: TrackPoint }[];
  base: string;
  labelA: string;
  labelB: string;
  color: string;
  /** Показывать ли дату дня в периоде Б: у среднего за несколько месяцев её нет. */
  datesB: boolean;
}) {
  const p = payload?.[0]?.payload;
  if (!active || !p || (p.a == null && p.b == null)) return null;
  const facts: TooltipFact[] = [];
  if (p.a != null)
    facts.push({ label: labelA, value: formatMoney(p.a, base), swatchColor: color, strong: true });
  // Дату дня Б пишем, только если она другая, чем у А: у месяцев и годов это
  // то же число, а «30 дней» и свои даты бывают сдвинуты.
  const sameDay = !!p.dateA && !!p.dateB && p.dateA.slice(5) === p.dateB.slice(5);
  if (p.b != null)
    facts.push({
      label: datesB && p.dateB && !sameDay ? `${labelB} · ${dayLabel(p.dateB)}` : labelB,
      value: formatMoney(p.b, base),
      swatch: "bg-muted opacity-60",
    });
  if (p.a != null && p.b != null)
    facts.push({
      label: "Разница",
      value: formatMoney(p.a - p.b, base, { signed: true }),
      icon: <Scale />,
      strong: true,
    });
  const title = p.dateA ? dayLabel(p.dateA) : `${formatNum(p.day)}-й день`;
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
}: {
  track: CompareTrack;
  kind: TrackKind;
  onKindChange: (k: TrackKind) => void;
  base: string;
  labelA: string;
  labelB: string;
  /** Есть ли у дней периода Б свои даты (нет у среднего за несколько месяцев). */
  datesB: boolean;
}) {
  const color = kind === "expense" ? chartColor.expense : chartColor.income;
  const muted = chartColor.muted;
  const noun = kind === "expense" ? "Расходы" : "Доходы";
  const lastA = track.aDays > 0 ? track.points[track.aDays - 1] : null;
  const hasB = track.points.some((p) => p.b != null);
  const atDay = lastA?.dateA ? ` на ${dayLabel(lastA.dateA)}` : "";

  return (
    <SectionCard
      icon={TrendingUp}
      title={`${noun} нарастающим итогом`}
      info={
        <p>
          Сколько набралось с начала периода к каждому дню. Сплошная линия —
          {` «${labelA}»`}, пунктир — {`«${labelB}»`}. Дни считаются от начала
          каждого периода, поэтому пятое число одного месяца стоит над пятым
          числом другого. Идущий период обрывается на последнем дне с
          операциями, сравнивается он с тем, что было к тому же дню.
        </p>
      }
      right={<KindSwitcher kind={kind} onChange={onKindChange} />}
    >
      <div className="flex items-center gap-x-5 gap-y-1 flex-wrap text-sm mt-1 mb-2" data-testid="compare-track-summary">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3.5 h-0.5 rounded-full" style={{ background: color }} />
          <span className="text-muted">
            {labelA}
            {track.running ? atDay : ""}
          </span>
          <span className="font-semibold tabular-nums">{formatMoney(track.aTotal, base)}</span>
        </span>
        {hasB && (
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-3.5 border-t-2 border-dashed"
              style={{ borderColor: muted }}
            />
            <span className="text-muted">
              {labelB}
              {track.running ? " к тому же дню" : ""}
            </span>
            <span className="font-semibold tabular-nums">{formatMoney(track.bAtA, base)}</span>
          </span>
        )}
        {hasB && track.aDays > 0 && (
          <DeviationPill
            current={track.aTotal}
            baseline={track.bAtA}
            base={base}
            mode="both"
            kind={kind}
            upTitle={`Больше, чем «${labelB}» к тому же дню`}
            downTitle={`Меньше, чем «${labelB}» к тому же дню`}
          />
        )}
        {hasB && track.running && (
          <span className="text-muted">
            {labelB} целиком —{" "}
            <span className="text-text tabular-nums">{formatMoney(track.bTotal, base)}</span>
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
              minTickGap={28}
              // На оси — даты периода А: «1 окт … 31 окт». За его концом (Б
              // длиннее) — номер дня.
              tickFormatter={(v) => {
                const p = track.points[Number(v) - 1];
                return p?.dateA ? dayLabel(p.dateA, "short") : String(v);
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
              content={
                <TrackTip base={base} labelA={labelA} labelB={labelB} color={color} datesB={datesB} />
              }
            />
            {track.running && lastA && (
              <ReferenceLine x={lastA.day} stroke={chartAxisStroke} strokeDasharray="2 2" />
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
            {track.running && lastA && lastA.b != null && (
              <ReferenceDot x={lastA.day} y={lastA.b} r={3.5} fill={muted} stroke="none" />
            )}
            {track.running && lastA && lastA.a != null && (
              <ReferenceDot x={lastA.day} y={lastA.a} r={4.5} fill={color} stroke="rgb(var(--c-panel))" strokeWidth={2} />
            )}
          </ComposedChart>
        </ChartContainer>
      </div>
    </SectionCard>
  );
}
