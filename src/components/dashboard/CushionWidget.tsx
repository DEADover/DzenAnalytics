/**
 * «Подушка безопасности» — на сколько месяцев обычных расходов хватит денег.
 * Считает показатель «Финансового здоровья», поэтому числа здесь и в разделе
 * одни и те же. Хук читается здесь, а не на главной: он нужен только тем, кто
 * виджет поставил.
 */

import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BlockTitle } from "./blocks/shared";
import { ChartContainer } from "../ChartContainer";
import { ChartTooltipCard, TooltipFacts } from "../TooltipFacts";
import { ProgressBar } from "../ProgressBar";
import { SectionEmpty } from "../SectionEmpty";
import { useCushionHistory, useHealthScore } from "../../hooks/useHealthScore";
import { cushionView } from "../../lib/cushionWidget";
import type { CushionPoint } from "../../lib/health";
import { MONTHS } from "../../lib/months";
import {
  chartAxisStroke,
  chartGridStroke,
  chartTooltipProps,
  formatMoney,
  monthTitle,
} from "../../lib/format";
import { pluralRu } from "../../lib/plural";

/** «3,4 месяца», «3 месяца», «5 месяцев»: у дробного числа форма одна. */
function monthsLabel(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  const text = rounded.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
  const word = Number.isInteger(rounded) ? pluralRu(rounded, ["месяц", "месяца", "месяцев"]) : "месяца";
  return `${text} ${word}`;
}

function CushionTip({
  active,
  payload,
  base,
}: {
  active?: boolean;
  payload?: readonly { payload?: CushionPoint }[];
  base: string;
}) {
  const p = payload?.[0]?.payload;
  if (!active || !p || p.months === null) return null;
  return (
    <ChartTooltipCard>
      <TooltipFacts
        title={monthTitle(p.ym)}
        facts={[
          { label: "Запас", value: monthsLabel(p.months), strong: true },
          { label: "Накопления", value: formatMoney(p.liquid, base) },
          { label: "Расход в месяц", value: formatMoney(p.avgExpense, base) },
        ]}
      />
    </ChartTooltipCard>
  );
}

/** Запас по месяцам и линия цели: растёт подушка или тает. */
function CushionChart({
  points,
  target,
  base,
}: {
  points: readonly CushionPoint[];
  target: number;
  base: string;
}) {
  const top = Math.ceil(Math.max(target, ...points.map((p) => p.months ?? 0)) * 1.1);
  return (
    <div className="flex-1 min-h-[8rem] flex flex-col" data-testid="cushion-chart">
      <div className="label mb-1">Запас за {points.length} {pluralRu(points.length, ["месяц", "месяца", "месяцев"])}</div>
      <div className="flex-1 min-h-0">
        <ChartContainer>
          <ComposedChart data={[...points]} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="cushion-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(var(--c-accent))" stopOpacity={0.28} />
                <stop offset="100%" stopColor="rgb(var(--c-accent))" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} vertical={false} />
            <XAxis
              dataKey="ym"
              stroke={chartAxisStroke}
              fontSize={11}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={28}
              tickFormatter={(ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym}
            />
            <YAxis
              stroke={chartAxisStroke}
              fontSize={11}
              tickLine={false}
              width={24}
              allowDecimals={false}
              domain={[0, top]}
            />
            <ChartTooltip {...chartTooltipProps} content={(props) => <CushionTip {...props} base={base} />} />
            <ReferenceLine y={target} stroke="rgb(var(--c-income))" strokeDasharray="4 3" />
            <Area
              type="monotone"
              dataKey="months"
              stroke="rgb(var(--c-accent))"
              strokeWidth={2}
              fill="url(#cushion-fill)"
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ChartContainer>
      </div>
    </div>
  );
}

export function CushionWidget({ base }: { base: string }) {
  const health = useHealthScore();
  const history = useCushionHistory();
  const chartPoints = useMemo(() => history.filter((p) => p.months !== null), [history]);
  const view = useMemo(
    () => cushionView(health?.components.find((c) => c.id === "emergency_fund")),
    [health]
  );
  const tone = !view ? "accent" : view.ratio >= 1 ? "income" : view.months < 1 ? "expense" : view.ratio < 0.5 ? "warn" : "accent";

  return (
    <>
      <BlockTitle
        title="Подушка безопасности"
        info={
          <p>
            На сколько месяцев хватит денег, если доход пропадёт, а траты останутся
            прежними: остаток на счетах, делённый на средний расход за 6 полных
            месяцев. График показывает запас на конец каждого месяца, пунктир —
            цель. Цель задаётся в «Финансовом здоровье», числа те же, что там.
            Общие фильтры главной на виджет не действуют.
          </p>
        }
        to="/health"
        linkLabel="Здоровье"
      />
      {!view ? (
        <SectionEmpty variant="compact">Пока мало расходов, чтобы посчитать запас</SectionEmpty>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col gap-3" data-testid="cushion">
          <div>
            <div
              className="font-mono tabular-nums font-semibold text-3xl leading-none"
              style={{ wordSpacing: "-0.22em" }}
              data-testid="cushion-months"
            >
              {monthsLabel(view.months)}
            </div>
            <div className="mt-1.5 text-[13px] text-muted">Хватит при обычных расходах</div>
          </div>
          <div>
            <ProgressBar value={view.ratio} tone={tone} label="Доля цели по подушке" />
            <div className="mt-1.5 flex items-baseline justify-between gap-2 text-[12px] text-muted tabular-nums">
              <span>Цель — {monthsLabel(view.target)}</span>
              <span>{Math.round(view.ratio * 100)}%</span>
            </div>
          </div>
          {chartPoints.length >= 2 && (
            <CushionChart points={chartPoints} target={view.target} base={base} />
          )}
          <dl className="mt-auto grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm border-t border-border pt-3">
            <dt className="text-muted">Накопления</dt>
            <dd className="text-right tabular-nums">{formatMoney(view.liquid, base)}</dd>
            <dt className="text-muted">Расход в месяц</dt>
            <dd className="text-right tabular-nums">{formatMoney(view.avgExpense, base)}</dd>
            <dt className="text-muted">До цели</dt>
            <dd className={`text-right tabular-nums ${view.toTarget > 0 ? "" : "text-income font-medium"}`}>
              {view.toTarget > 0 ? formatMoney(view.toTarget, base) : "Цель достигнута"}
            </dd>
            {view.obligatoryMonths !== null && (
              <>
                <dt className="text-muted">Только обязательные</dt>
                <dd className="text-right tabular-nums">{monthsLabel(view.obligatoryMonths)}</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </>
  );
}
