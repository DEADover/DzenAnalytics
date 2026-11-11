import { BlockTitle } from "./shared";
import type { TipProps } from "./shared";
import { useMemo, useState } from "react";
import { ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, Area, Line, ReferenceArea, ReferenceDot, ReferenceLine } from "recharts";
import { ChartContainer } from "../../ChartContainer";
import { Segmented } from "../../Segmented";
import { ArrowUp, ArrowDown } from "lucide-react";
import { ChartTooltipCard, TooltipFacts } from "../../TooltipFacts";
import { RangeCompareCard, RangeDatePill } from "../../RangeCompareCard";
import { useChartRangeSelect } from "../../../hooks/useChartRangeSelect";
import { rangeChange } from "../../../lib/rangeCompare";
import { formatMoney, formatNum, formatPct, monthLabel, dayTitle, chartTooltipProps, chartColor, chartGridStroke, chartAxisStroke } from "../../../lib/format";
import {
  CAPITAL_PERIODS,
  capitalPeriodStart,
  capitalSlice,
  capitalSummary,
  thinBalances,
  type CapitalPeriod,
  type CapitalPoint,
} from "../../../lib/capital";
import { SectionEmpty } from "../../SectionEmpty";


/* ─────────────────────────────  капитал  ───────────────────────────── */

function CapitalTip({
  active,
  payload,
  base,
  start,
}: TipProps & { base: string; start: number }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as { date?: string; net?: number } | undefined;
  if (!row?.date) return null;
  const net = row.net ?? 0;
  return (
    <ChartTooltipCard>
      <TooltipFacts
        title={dayTitle(row.date)}
        facts={[
          {
            label: "Капитал",
            value: formatMoney(net, base),
            swatchColor: "rgb(var(--c-accent))",
            strong: true,
          },
          {
            label: "От начала периода",
            value: formatMoney(net - start, base, { signed: true }),
          },
        ]}
      />
    </ChartTooltipCard>
  );
}

/**
 * Виджет «Капитал»: сколько денег сейчас и как это число менялось.
 *
 * Слева — ответ: капитал сегодня, изменение за выбранный период в деньгах и
 * процентах, крайние точки и средний прирост в месяц. Справа — кривая за тот
 * же период с пунктиром уровня на его начало: выше пунктира — прибавили,
 * ниже — потеряли.
 *
 * Кривая та же, что «Совокупный баланс» на «Счетах», — числа совпадают.
 */
export function CapitalBlock({
  series,
  base,
  today,
  accounts,
}: {
  series: CapitalPoint[];
  base: string;
  today: string;
  /** Счета главной — из них складывается разбивка «Из чего состоит». */
  accounts: { balanceBase: number; savings: boolean; archive: boolean }[];
}) {
  const [period, setPeriod] = useState<CapitalPeriod>("1y");
  const points = useMemo(
    // Линия доходит до сегодня: в дни без операций остаток тот же.
    () => capitalSlice(series, capitalPeriodStart(period, today), today),
    [series, period, today]
  );
  const summary = useMemo(() => capitalSummary(points), [points]);
  const chart = useMemo(() => thinBalances(points), [points]);
  // Сравнение двух дат протяжкой по графику — то же, что у «Совокупного
  // баланса» на «Счетах»: общий хук, общий расчёт и общая карточка итога.
  const chartDates = useMemo(() => chart.map((p) => p.date), [chart]);
  const range = useChartRangeSelect(chartDates);
  const change = useMemo(
    () => (range.active ? rangeChange(chart, range.active[0], range.active[1], (p) => p.net) : null),
    [chart, range.active]
  );
  // Пока тянут мышь, данные графика не трогаем — иначе кривая пересчитывается
  // на каждое движение (см. «Совокупный баланс» на «Счетах»).
  const settled = change !== null && !range.dragging;
  const chartData = useMemo(() => {
    if (!change || !settled) return chart;
    const { from, to } = change;
    return chart.map((p) => ({ ...p, sel: p.date >= from.date && p.date <= to.date ? p.net : null }));
  }, [chart, change, settled]);
  const rangeColor = !change
    ? "rgb(var(--c-accent))"
    : change.delta >= 0
      ? chartColor.income
      : chartColor.expense;
  const periodLabel = CAPITAL_PERIODS.find((p) => p.id === period)?.label ?? "";
  // Из чего капитал состоит сегодня: деньги на обычных счетах, накопления и
  // долги (кредитки, кредиты — всё, что в минусе).
  const parts = useMemo(() => {
    let cash = 0;
    let saved = 0;
    let debt = 0;
    for (const a of accounts) {
      if (a.archive) continue;
      if (a.balanceBase < 0) debt += a.balanceBase;
      else if (a.savings) saved += a.balanceBase;
      else cash += a.balanceBase;
    }
    return { cash, saved, debt };
  }, [accounts]);
  const partsTotal = parts.cash + parts.saved + Math.abs(parts.debt);

  return (
    <>
      <BlockTitle
        title="Капитал"
        info={
          <>
            <p>
              Сумма остатков на счетах «в балансе» — та же, что «Совокупный
              баланс» на «Счетах»: каждый счёт в своей валюте по курсу дня,
              долги и кредитки с минусом.
            </p>
            <p>
              Изменение — от остатка на первый день периода до сегодняшнего.
              Пунктир на графике — уровень на начало периода. Процент не
              пишется, если на старте капитал был нулевым или отрицательным:
              от такой базы он ничего не значит.
            </p>
            <p>
              Проведите мышью по графику — сравним две даты: насколько изменился
              капитал между ними, в деньгах, процентах и в среднем за месяц.
              Снять выделение — кликом или Esc.
            </p>
          </>
        }
        right={
          <Segmented
            tight
            label="Период капитала"
            value={period}
            onChange={setPeriod}
            options={CAPITAL_PERIODS.map((p) => ({ value: p.id, label: p.label }))}
            className="ml-auto"
          />
        }
        to="/accounts"
        linkLabel="Счета"
      />
      {!summary ? (
        <SectionEmpty variant="compact">Истории остатков пока нет</SectionEmpty>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-5">
          <div className="flex flex-col gap-3 min-w-0">
            <div
              className={`font-mono tabular-nums font-semibold text-3xl leading-none ${
                summary.current < 0 ? "text-expense" : ""
              }`}
              style={{ wordSpacing: "-0.22em" }}
            >
              {formatMoney(summary.current, base)}
            </div>
            <div
              className={`flex items-baseline gap-2 text-sm tabular-nums ${
                summary.delta >= 0 ? "text-income" : "text-expense"
              }`}
            >
              {summary.delta >= 0 ? (
                <ArrowUp className="w-4 h-4 self-center" aria-hidden />
              ) : (
                <ArrowDown className="w-4 h-4 self-center" aria-hidden />
              )}
              <span className="font-semibold">{formatMoney(summary.delta, base, { signed: true })}</span>
              {summary.pct != null && (
                <span>
                  {summary.pct > 0 ? "+" : ""}
                  {formatPct(summary.pct / 100)}
                </span>
              )}
              <span className="text-muted">
                {period === "all" ? "за всё время" : `за ${periodLabel.toLowerCase()}`}
              </span>
            </div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm border-t border-border pt-3">
              <dt className="text-muted">На начало периода</dt>
              <dd className="text-right tabular-nums">
                {formatMoney(summary.start, base)}
                <span className="block text-xs text-muted">{dayTitle(points[0].date)}</span>
              </dd>
              <dt className="text-muted">Максимум</dt>
              <dd className="text-right tabular-nums">
                {formatMoney(summary.max.net, base)}
                <span className="block text-xs text-muted">{dayTitle(summary.max.date)}</span>
              </dd>
              <dt className="text-muted">Минимум</dt>
              <dd className="text-right tabular-nums">
                {formatMoney(summary.min.net, base)}
                <span className="block text-xs text-muted">{dayTitle(summary.min.date)}</span>
              </dd>
              {summary.perMonth != null && (
                <>
                  <dt className="text-muted">В среднем в месяц</dt>
                  <dd
                    className={`text-right tabular-nums font-medium ${
                      summary.perMonth >= 0 ? "text-income" : "text-expense"
                    }`}
                  >
                    {formatMoney(summary.perMonth, base, { signed: true })}
                  </dd>
                </>
              )}
            </dl>
            {/* Низ колонки — из чего капитал состоит сегодня. Карточка выше
                своего содержимого (высоту ряда задают соседи), и здесь было
                пусто; разбивка отвечает на следующий вопрос после «сколько». */}
            {partsTotal > 0 && (
              <div className="mt-auto pt-3 border-t border-border">
                <div className="label mb-2">Из чего состоит</div>
                <div className="flex h-2 rounded-full overflow-hidden bg-border/60 mb-2">
                  {[
                    { v: parts.cash, c: "rgb(var(--c-accent))" },
                    { v: parts.saved, c: "rgb(var(--c-income))" },
                    { v: Math.abs(parts.debt), c: "rgb(var(--c-expense))" },
                  ]
                    .filter((x) => x.v > 0)
                    .map((x, i) => (
                      <div key={i} style={{ width: `${(x.v / partsTotal) * 100}%`, background: x.c }} />
                    ))}
                </div>
                <div className="flex flex-col gap-1 text-sm">
                  {[
                    { label: "На счетах", v: parts.cash, c: "bg-accent" },
                    { label: "Накопления", v: parts.saved, c: "bg-income" },
                    { label: "Долги и кредиты", v: parts.debt, c: "bg-expense" },
                  ]
                    .filter((x) => x.v !== 0)
                    .map((x) => (
                      <div key={x.label} className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2 text-muted">
                          <span className={`w-2 h-2 rounded-full ${x.c}`} aria-hidden />
                          {x.label}
                        </span>
                        <span className={`tabular-nums ${x.v < 0 ? "text-expense" : ""}`}>
                          {formatMoney(x.v, base)}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
          <div className="min-w-0 flex flex-col gap-2">
            {chart.length > 1 && (
              <div className="flex justify-end min-h-10">
                <RangeCompareCard
                  change={change}
                  base={base}
                  hint="Проведите мышью по графику — сравним две даты"
                  onClear={range.clear}
                />
              </div>
            )}
            <div className="flex-1 min-h-[200px]">
            <ChartContainer>
              <ComposedChart
                data={chartData}
                margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
                {...range.handlers}
                className="select-none"
                style={{ cursor: "crosshair" }}
              >
                <defs>
                  <linearGradient id="dashCapital" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(var(--c-accent))" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="rgb(var(--c-accent))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} vertical={false} />
                <XAxis
                  dataKey="date"
                  stroke={chartAxisStroke}
                  fontSize={11}
                  tickLine={false}
                  tickFormatter={(d) => monthLabel((d as string).slice(0, 7))}
                  minTickGap={50}
                />
                <YAxis
                  stroke={chartAxisStroke}
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  // «600 тыс.» и «4,8 млн» в 48 px не влезали — подписи
                  // обрезались по краю.
                  width={68}
                  tickFormatter={(v) => formatNum(v, { compact: true })}
                  domain={["auto", "auto"]}
                />
                <ReferenceLine
                  y={summary.start}
                  stroke={chartAxisStroke}
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                />
                <Tooltip
                  cursor={chartTooltipProps.cursor}
                  wrapperStyle={chartTooltipProps.wrapperStyle}
                  content={<CapitalTip base={base} start={summary.start} />}
                />
                {change && (
                  <ReferenceArea
                    x1={change.from.date}
                    x2={change.to.date}
                    fill={rangeColor}
                    fillOpacity={0.06}
                    ifOverflow="hidden"
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="net"
                  // С выделением линия вне отрезка гаснет — глаз идёт за
                  // окрашенным куском, как на «Счетах».
                  stroke="rgb(var(--c-accent))"
                  strokeOpacity={settled ? 0.35 : 1}
                  strokeWidth={2}
                  fill="url(#dashCapital)"
                  fillOpacity={settled ? 0.4 : 1}
                  isAnimationActive={false}
                />
                {change && (
                  <>
                    {settled && (
                      <Line
                        type="monotone"
                        dataKey="sel"
                        stroke={rangeColor}
                        strokeWidth={2.5}
                        dot={false}
                        activeDot={false}
                        isAnimationActive={false}
                        legendType="none"
                        tooltipType="none"
                      />
                    )}
                    {[change.from, change.to].map((p, i) => {
                      // Начало подписано слева от линии, конец — справа; у края
                      // графика плашка уходит внутрь, чтобы не обрезаться.
                      const at = chartDates.indexOf(p.date) / Math.max(1, chartDates.length - 1);
                      const side: "left" | "right" =
                        i === 0 ? (at < 0.15 ? "right" : "left") : at > 0.85 ? "left" : "right";
                      return (
                        <ReferenceLine
                          key={`l-${p.date}`}
                          x={p.date}
                          stroke={chartAxisStroke}
                          strokeDasharray="4 3"
                          label={(props: { viewBox?: { x?: number; y?: number } }) => (
                            <RangeDatePill viewBox={props.viewBox} date={p.date} side={side} />
                          )}
                        />
                      );
                    })}
                    {settled && [change.from, change.to].map((p) => (
                      <ReferenceDot
                        key={`d-${p.date}`}
                        x={p.date}
                        y={p.value}
                        r={5}
                        fill={rangeColor}
                        stroke="rgb(var(--c-panel))"
                        strokeWidth={2}
                      />
                    ))}
                  </>
                )}
              </ComposedChart>
            </ChartContainer>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
