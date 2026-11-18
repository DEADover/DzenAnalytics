/**
 * «Прогноз остатка» — сколько останется на повседневных счетах к концу
 * месяца: остаток по дням до сегодня и пунктир дальше, с запланированными
 * операциями в свои дни. Отвечает на вопрос «хватит ли до зарплаты».
 *
 * Считает сам: история остатков по счетам нужна только тем, кто этот виджет
 * поставил. Правила — в `lib/balanceOutlook`.
 */

import { useMemo } from "react";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
} from "recharts";
import { BlockTitle } from "./blocks/shared";
import { ChartContainer } from "../ChartContainer";
import { ChartTooltipCard, TooltipFacts, type TooltipFact } from "../TooltipFacts";
import { SectionEmpty } from "../SectionEmpty";
import { useLiveAccounts } from "../../hooks/useLiveAccounts";
import { useNetWorthSeries } from "../../hooks/useNetWorthSeries";
import { useDataStore } from "../../store/useDataStore";
import { accountKeyOf } from "../../lib/accountKey";
import type { ForecastOp } from "../../lib/balanceForecast";
import { buildBalanceOutlook, isEverydayAccount, type OutlookPoint } from "../../lib/balanceOutlook";
import { toBase } from "../../lib/csv";
import { niceScale } from "../../lib/dashboardModel";
import { dayAndMonth } from "../../lib/dayLabel";
import {
  chartAxisStroke,
  chartColor,
  chartGridStroke,
  chartTooltipProps,
  formatMoney,
  formatNum,
} from "../../lib/format";
import { periodRange } from "../../lib/period";
import { pluralRu } from "../../lib/plural";
import type { PlannedOp } from "../../lib/plannedOps";

function OutlookTip({
  active,
  payload,
  base,
}: {
  active?: boolean;
  payload?: { payload?: OutlookPoint }[];
  base: string;
}) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  const facts: TooltipFact[] = [];
  if (p.fact != null)
    facts.push({ label: "Остаток", value: formatMoney(p.fact, base), swatch: "bg-accent", strong: true });
  else if (p.plan != null)
    facts.push({
      label: "Прогноз",
      value: formatMoney(p.plan, base),
      swatch: "bg-accent opacity-60",
      tone: p.plan < 0 ? "expense" : undefined,
      strong: true,
    });
  return (
    <ChartTooltipCard>
      <TooltipFacts title={dayAndMonth(p.date)} facts={facts} />
    </ChartTooltipCard>
  );
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "income" | "expense";
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] uppercase tracking-[0.06em] text-muted truncate">{label}</div>
      <div
        className={`mt-0.5 text-[13px] font-medium tabular-nums truncate ${
          tone === "income" ? "text-income" : tone === "expense" ? "text-expense" : ""
        }`}
      >
        {value}
      </div>
      <div className="text-[11.5px] text-muted truncate">{note}</div>
    </div>
  );
}

export function OutlookWidget({
  planned,
  nowYm,
  monthStartDay,
  today,
  base,
}: {
  /** Запланированные операции идущего месяца; `null` — Дзен-мани не подключён. */
  planned: readonly PlannedOp[] | null;
  /** Идущий отчётный месяц: прогноз всегда про него. */
  nowYm: string;
  monthStartDay: number;
  today: string;
  base: string;
}) {
  const live = useLiveAccounts();
  const transactions = useDataStore((s) => s.transactions);
  const rates = useDataStore((s) => s.rates);

  const keys = useMemo(
    () => (live ?? []).filter(isEverydayAccount).map((a) => accountKeyOf(a)),
    [live]
  );
  const series = useNetWorthSeries(transactions, keys);

  const outlook = useMemo(() => {
    if (keys.length === 0 || series.length === 0) return null;
    const picked = new Set(keys);
    const ops: ForecastOp[] = (planned ?? [])
      // Прогнозы самого Дзен-мани — догадки; в линию идут только назначенные.
      .filter((p) => !p.forecast && !p.done)
      .map((p) => ({
        date: p.date,
        kind: p.kind,
        amountBase: p.amountBase,
        toAmountBase:
          p.toAmount != null && p.toCurrency ? toBase(p.toAmount, p.toCurrency, rates) : null,
        account: p.accountKey ?? p.account,
        toAccount: p.toAccountKey ?? p.toAccount,
        title: "",
      }));
    return buildBalanceOutlook(
      series,
      periodRange(nowYm, monthStartDay),
      today,
      ops,
      (a) => picked.has(a)
    );
  }, [keys, series, planned, rates, nowYm, monthStartDay, today]);

  const title = (
    <BlockTitle
      title="Прогноз остатка"
      info={
        <>
          <p>
            Сколько денег останется к концу месяца на повседневных счетах: картах
            и наличных в балансе. Накопительные счета, вклады, кредиты и долги не
            считаются — иначе не видно, хватит ли до зарплаты.
          </p>
          <p>
            Сплошная линия — остаток по дням до сегодня. Пунктир — прогноз:
            каждая запланированная операция встаёт в свой день. Перевод на вклад
            уменьшает остаток, перевод между своими картами — нет. Просроченные
            операции и прогнозы самого Дзен-мани в линию не идут. Виджет всегда
            про идущий месяц.
          </p>
        </>
      }
      to="/cashflow"
      linkLabel="Cash-flow"
    />
  );

  if (!outlook) {
    return (
      <>
        {title}
        <SectionEmpty variant="compact">
          {live === null || (live ?? []).length === 0
            ? "Остатки по счетам известны только при подключении к Дзен-мани"
            : "Повседневных счетов в балансе нет"}
        </SectionEmpty>
      </>
    );
  }

  const delta = outlook.end - outlook.now;
  const short = outlook.min.value < 0;
  const todayPoint = outlook.points.find((p) => p.date === today);
  const minPoint = outlook.points.find((p) => p.date === outlook.min.date);
  let lo = 0;
  let hi = 0;
  for (const p of outlook.points)
    for (const v of [p.fact, p.plan])
      if (v != null) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
  // Круглая шкала от нуля; ниже нуля (уходим в минус) — по данным.
  const yScale = lo < 0 || hi <= 0 ? null : niceScale(hi * 1.1);
  const color = chartColor.accent;

  return (
    <>
      {title}
      <div className="flex-1 min-h-0 flex flex-col gap-3" data-testid="outlook-widget">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.08em] text-muted">
            Останется к {dayAndMonth(periodRange(nowYm, monthStartDay).to)}
          </div>
          <div className="mt-1 flex items-center gap-2.5 flex-wrap">
            <span
              className={`text-[28px] font-bold tracking-[-0.03em] tabular-nums leading-[1.1] whitespace-nowrap ${
                outlook.end < 0 ? "text-expense" : ""
              }`}
              data-testid="outlook-end"
            >
              {formatMoney(outlook.end, base)}
            </span>
            {short ? (
              <span className="rounded-full px-2 py-0.5 text-[12px] font-medium bg-expense/10 text-expense tabular-nums whitespace-nowrap">
                Не хватит {formatMoney(-outlook.min.value, base)}
              </span>
            ) : (
              Math.abs(delta) >= 0.5 && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[12px] font-medium tabular-nums whitespace-nowrap ${
                    delta > 0 ? "bg-income/10 text-income" : "bg-expense/10 text-expense"
                  }`}
                >
                  {formatMoney(delta, base, { signed: true })}
                </span>
              )
            )}
          </div>
          <div className={`mt-1.5 text-[12px] tabular-nums ${short ? "text-expense" : "text-muted"}`}>
            {short && outlook.below
              ? outlook.below === today
                ? "Остаток уже ниже нуля"
                : `${dayAndMonth(outlook.below)} остаток уйдёт в минус`
              : `Сейчас на счетах — ${formatMoney(outlook.now, base)}`}
          </div>
        </div>

        <div className="flex-1 min-h-[120px]">
          <ChartContainer>
            <ComposedChart data={outlook.points} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} vertical={false} />
              <XAxis
                dataKey="day"
                stroke={chartAxisStroke}
                fontSize={11}
                tickLine={false}
                minTickGap={18}
                tickFormatter={(v) => {
                  const p = outlook.points[Number(v) - 1];
                  return p ? String(Number(p.date.slice(8))) : String(v);
                }}
              />
              <YAxis
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
                content={<OutlookTip base={base} />}
              />
              {lo < 0 && <ReferenceLine y={0} stroke={chartColor.expense} strokeWidth={1} />}
              {todayPoint && (
                <ReferenceLine x={todayPoint.day} stroke={chartAxisStroke} strokeDasharray="2 2" />
              )}
              <Line
                type="stepAfter"
                dataKey="plan"
                stroke={color}
                strokeWidth={2}
                strokeDasharray="4 3"
                strokeOpacity={0.75}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Line
                type="stepAfter"
                dataKey="fact"
                stroke={color}
                strokeWidth={2.5}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
              {minPoint && minPoint.date !== today && minPoint.plan != null && (
                <ReferenceDot
                  x={minPoint.day}
                  y={minPoint.plan}
                  r={4}
                  fill="rgb(var(--c-panel))"
                  stroke={short ? chartColor.expense : chartColor.warn}
                  strokeWidth={2}
                />
              )}
              {todayPoint?.fact != null && (
                <ReferenceDot
                  x={todayPoint.day}
                  y={todayPoint.fact}
                  r={4.5}
                  fill={color}
                  stroke="rgb(var(--c-panel))"
                  strokeWidth={2}
                />
              )}
            </ComposedChart>
          </ChartContainer>
        </div>

        <div className="grid grid-cols-3 gap-2 border-t border-border pt-2.5" data-testid="outlook-stats">
          <Stat
            label="Минимум"
            value={formatMoney(outlook.min.value, base)}
            note={outlook.min.date === today ? "Сегодня" : dayAndMonth(outlook.min.date)}
            tone={short ? "expense" : undefined}
          />
          <Stat
            label="Спишется"
            value={outlook.outCount > 0 ? `−${formatMoney(outlook.out, base)}` : formatMoney(0, base)}
            note={
              outlook.outCount > 0
                ? `${formatNum(outlook.outCount)} ${pluralRu(outlook.outCount, ["платёж", "платежа", "платежей"])}`
                : "Платежей нет"
            }
            tone={outlook.outCount > 0 ? "expense" : undefined}
          />
          <Stat
            label="Придёт"
            value={outlook.incomeCount > 0 ? `+${formatMoney(outlook.income, base)}` : formatMoney(0, base)}
            note={outlook.nextIncome ? dayAndMonth(outlook.nextIncome) : "Поступлений нет"}
            tone={outlook.incomeCount > 0 ? "income" : undefined}
          />
        </div>
      </div>
    </>
  );
}
