import { TrendingUp, Scale, ArrowLeftRight } from "lucide-react";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  CartesianGrid,
  ReferenceLine,
  ReferenceDot,
  Area,
} from "recharts";
import { ChartContainer } from "./ChartContainer";
import { SectionCard } from "./SectionCard";
import { KindSwitcher } from "./KindSwitcher";
import { DeviationPill } from "./DeviationPill";
import { ChartTooltipCard, TooltipFacts, type TooltipFact } from "./TooltipFacts";
import type { BalancePoint, BalanceTrack, CompareTrack, TrackKind, TrackPoint } from "../lib/compareTrack";
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
  if (!active || !p || (p.a == null && p.b == null)) return null;
  const facts: TooltipFact[] = [];
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
  if (p.b != null)
    facts.push({
      label: datesB && byIndex && p.dateB ? `${labelB} · ${dayLabel(p.dateB)}` : labelB,
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
}) {
  const color = kind === "expense" ? chartColor.expense : chartColor.income;
  const muted = chartColor.muted;
  const noun = kind === "expense" ? "расходов" : "доходов";
  const hasB = track.points.some((p) => p.b != null);
  // Один из периодов ещё идёт — сравниваем на последнем общем дне и отмечаем
  // его на графике.
  const limited = track.limited;
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
          период обрывается на последнем дне с операциями, и тогда периоды
          сравниваются на этом дне.
        </p>
      }
      right={<KindSwitcher kind={kind} onChange={onKindChange} />}
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

function BalanceTip({ active, payload, base }: { active?: boolean; payload?: { payload?: BalancePoint }[]; base: string }) {
  const p = payload?.[0]?.payload;
  if (!active || !p || p.income == null || p.expense == null) return null;
  const net = p.income - p.expense;
  return (
    <ChartTooltipCard>
      <TooltipFacts
        title={dayLabel(p.date)}
        facts={[
          { label: "Доходы", value: formatMoney(p.income, base), swatchColor: chartColor.income },
          { label: "Расходы", value: formatMoney(p.expense, base), swatchColor: chartColor.expense },
          {
            label: "Остаток",
            value: formatMoney(net, base, { signed: true }),
            tone: net >= 0 ? "income" : "expense",
            icon: <Scale />,
            strong: true,
          },
        ]}
      />
    </ChartTooltipCard>
  );
}

/**
 * Доходы против расходов одного периода нарастающим итогом по дням: сколько
 * пришло и сколько ушло к каждому дню. Между линиями — заливка: зелёная, пока
 * доходов больше, красная, когда расходы их обогнали. Над графиком — итоги,
 * остаток и с какого дня расходы держатся выше доходов.
 */
export function BalanceTrackChart({
  track,
  base,
  label,
  axis,
}: {
  track: BalanceTrack;
  base: string;
  /** Название периода — «Октябрь 2026», «Последние 30 дней». */
  label: string;
  axis: TrackAxis;
}) {
  const last = track.days > 0 ? track.points[track.days - 1] : null;
  const atDay = track.running && last ? ` на ${dayLabel(last.date)}` : "";
  const firstDD = track.points[0]?.date.slice(8);
  const monthTicks =
    axis === "month" ? track.points.filter((p) => p.date.slice(8) === firstDD).map((p) => p.day) : undefined;
  const verdict =
    track.days === 0
      ? null
      : track.deficitSince
        ? `Расходы больше доходов с ${dayLabel(track.deficitSince)}`
        : track.income > 0
          ? `Доходы покрывают расходы${track.running ? " — пока" : ""}`
          : null;

  return (
    <SectionCard
      icon={ArrowLeftRight}
      title="Доходы и расходы"
      subtitle={label}
      info={
        <p>
          Доходы и расходы периода А нарастающим итогом: сколько пришло и
          сколько ушло к каждому дню. Зелёная заливка между линиями — доходов
          больше, красная — расходы их обогнали. Возвраты уменьшают расходы,
          переводы не учитываются. Идущий период обрывается на последнем дне с
          операциями.
        </p>
      }
    >
      <div className="flex items-center gap-x-5 gap-y-1 flex-wrap text-sm mt-1 mb-2" data-testid="balance-track-summary">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3.5 h-0.5 rounded-full" style={{ background: chartColor.income }} />
          <span className="text-muted">Доходы{atDay}</span>
          <span className="font-semibold tabular-nums">{formatMoney(track.income, base)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3.5 h-0.5 rounded-full" style={{ background: chartColor.expense }} />
          <span className="text-muted">Расходы</span>
          <span className="font-semibold tabular-nums">{formatMoney(track.expense, base)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-muted">Остаток</span>
          <span className={`font-semibold tabular-nums ${track.net >= 0 ? "text-income" : "text-expense"}`}>
            {formatMoney(track.net, base, { signed: true })}
          </span>
        </span>
        {verdict && <span className="text-muted">{verdict}</span>}
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
                if (axis === "dayIndex" || !p) return String(v);
                return axis === "month" ? monthShort(p.date) : String(Number(p.date.slice(8)));
              }}
            />
            <YAxis stroke={chartAxisStroke} fontSize={11} tickLine={false} width={48} tickFormatter={(v) => formatNum(v, { compact: true })} />
            <ChartTooltip
              cursor={chartTooltipProps.cursor}
              wrapperStyle={chartTooltipProps.wrapperStyle}
              content={<BalanceTip base={base} />}
            />
            <Area dataKey="surplus" name="Доходов больше" stroke="none" fill={chartColor.income} fillOpacity={0.14} isAnimationActive={false} connectNulls={false} />
            <Area dataKey="deficit" name="Расходов больше" stroke="none" fill={chartColor.expense} fillOpacity={0.14} isAnimationActive={false} connectNulls={false} />
            <Line type="linear" dataKey="income" name="Доходы" stroke={chartColor.income} strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
            <Line type="linear" dataKey="expense" name="Расходы" stroke={chartColor.expense} strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
            {track.running && last && (
              <ReferenceLine x={last.day} stroke={chartAxisStroke} strokeDasharray="2 2" />
            )}
          </ComposedChart>
        </ChartContainer>
      </div>
    </SectionCard>
  );
}
