import { useMemo, useState } from "react";
import { Select } from "./Select";
import { Segmented } from "./Segmented";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ReferenceLine,
} from "recharts";
import { Flame } from "lucide-react";
import type { FirePoint } from "../lib/aggregations";
import {
  formatMoney,
  formatNum,
  monthLabel,
  chartTooltipProps,
  chartGridStroke,
  chartAxisStroke,
  chartColor,
  formatFixed,
} from "../lib/format";
import { Tooltip } from "./Tooltip";
import { TooltipFacts } from "./TooltipFacts";
import { CardHeader } from "./CardHeader";

/** FIRE goal on the 4%-rule: 25 годовых расходов = 300 месяцев. */
const FIRE_TARGET = 300;

type Mode = "months" | "expense" | "income";
type ExpKind = "obligatory" | "all";
/** X-axis granularity (issue #35). */
type Scale = "month" | "quarter" | "year";
/** How far back the chart reaches (issue #35). */
type Range = "1y" | "3y" | "5y" | "all";

const MODES: { id: Mode; label: string; color: string }[] = [
  { id: "months", label: "Месяцы жизни", color: chartColor.income },
  { id: "expense", label: "Расходы", color: chartColor.expense },
  { id: "income", label: "Доходы", color: chartColor.accent },
];

const SCALES: { id: Scale; label: string }[] = [
  { id: "month", label: "Месяцы" },
  { id: "quarter", label: "Кварталы" },
  { id: "year", label: "Годы" },
];

const RANGES: { id: Range; label: string; months: number | null }[] = [
  { id: "1y", label: "1 год", months: 12 },
  { id: "3y", label: "3 года", months: 36 },
  { id: "5y", label: "5 лет", months: 60 },
  { id: "all", label: "Всё", months: null },
];

const ROMAN = ["I", "II", "III", "IV"];

/** Bucket id for a reporting month under the chosen scale. */
function bucketOf(ym: string, scale: Scale): string {
  if (scale === "month") return ym;
  const [y, m] = ym.split("-");
  if (scale === "year") return y;
  return `${y}-Q${Math.floor((Number(m) - 1) / 3) + 1}`;
}

/** Human label for a bucket id. */
function bucketLabel(key: string, scale: Scale): string {
  if (scale === "month") return monthLabel(key);
  if (scale === "year") return key;
  const [y, q] = key.split("-Q");
  return `${ROMAN[Number(q) - 1]} кв. ${y.slice(2)}`;
}

/**
 * Rolling «months of life» (FIRE) chart. One point per reporting month. A
 * toggle flips between three trailing-12-month series: the runway (МЖ, with the
 * FIRE target line), the average expense (obligatory or all, via a sub-toggle),
 * and the average income — all on the same rolling-window principle.
 */
export function FireChart({
  data,
  base,
  bare = false,
}: {
  data: FirePoint[];
  base: string;
  /** Render content only (no card wrapper) — for merging with the FIRE block. */
  bare?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("months");
  const [expKind, setExpKind] = useState<ExpKind>("obligatory");
  const [scale, setScale] = useState<Scale>("month");
  const [range, setRange] = useState<Range>("all");

  const chart = useMemo(() => {
    // 1) Period — trailing window over the monthly points.
    const months = RANGES.find((r) => r.id === range)!.months;
    const sliced = months ? data.slice(-months) : data;
    // 2) Scale — every point is a ROLLING snapshot (месяцы жизни, средние за
    //    12 мес), so a quarter/year is represented by its LAST month, never by
    //    a sum or an average of averages.
    const byBucket = new Map<string, (typeof data)[number]>();
    for (const p of sliced) byBucket.set(bucketOf(p.ym, scale), p);
    return [...byBucket.entries()].map(([key, p]) => ({
      key,
      months: Math.round(p.months * 10) / 10,
      obligatory: Math.round(p.avgObligatory),
      expenseAll: Math.round(p.avgExpenseAll),
      income: Math.round(p.avgIncome),
    }));
  }, [data, scale, range]);

  if (data.length < 2) return null;

  const last = data[data.length - 1];
  const firePct = (last.months / FIRE_TARGET) * 100;
  const color = MODES.find((m) => m.id === mode)!.color;
  const asOf = monthLabel(last.ym);

  // Scale the Y axis to what's VISIBLE, so narrowing the period zooms in.
  const monthsMax = Math.max(...chart.map((p) => p.months), 0);
  const showTarget = monthsMax >= FIRE_TARGET * 0.5;
  const monthsDomainMax = showTarget
    ? Math.round(Math.max(monthsMax, FIRE_TARGET) * 1.05)
    : Math.max(Math.ceil(monthsMax * 1.15), 1);

  const expenseVal =
    expKind === "obligatory" ? last.avgObligatory : last.avgExpenseAll;

  /** Формула целиком: чаще всего спрашивают, что тут капитал и откуда расход. */
  const howItWorks = (
    <TooltipFacts
      title="Месяцы жизни = капитал ÷ средний обязательный расход"
      facts={[
        { label: "Капитал", value: formatMoney(last.net, base) },
        {
          label: "Расход, среднее за 12 мес",
          value: formatMoney(last.avgObligatory, base),
        },
        {
          label: "Хватит на",
          value: `${formatNum(Math.round(last.months))} мес`,
        },
        { label: "Цель", value: `${FIRE_TARGET} мес` },
      ]}
      note={
        <>
          <div>
            Капитал — сумма остатков по всем счетам, кроме архивных и тех, что вы
            исключили в блоке «Финансовая независимость».
          </div>
          <div className="mt-1.5">
            Расход — только категории с признаком «Обязательная», усреднённые за
            последние 12 месяцев. Переводы между своими счетами расходом не
            считаются, возвраты вычитаются.
          </div>
          <div className="mt-1.5">
            Цель 300 месяцев — это правило 4%: капитал, равный 25 годовым
            расходам.
          </div>
          <div className="mt-1.5">
            Значение колеблется даже при ровных доходах и расходах: окно
            скользящее, и каждый месяц из него выпадает месяц годичной давности.
            Крупная обязательная трата поднимает график ровно через год —
            когда покидает окно. Курс валют и цена активов двигают капитал сами
            по себе.
          </div>
        </>
      }
    />
  );

  const description =
    mode === "months"
      ? "На сколько месяцев жизни хватит накоплений, если тратить только на обязательное. Цель — 300 месяцев."
      : mode === "income"
        ? "Средние доходы за последний год (по месяцам)."
        : expKind === "obligatory"
          ? "Средние обязательные расходы за последний год (по месяцам)."
          : "Средние расходы за последний год — все категории.";

  const dataKey =
    mode === "months"
      ? "months"
      : mode === "income"
        ? "income"
        : expKind === "obligatory"
          ? "obligatory"
          : "expenseAll";

  const headline =
    mode === "months" ? (
      <>
        {last.months.toFixed(0)}{" "}
        <Tooltip content="Месяцы жизни — сколько месяцев вы продержитесь на накоплениях, покрывая только обязательные траты, если доход пропадёт. Это ваш запас автономности.">
          <span className="text-base font-semibold text-muted cursor-help border-b border-dotted border-muted">
            мес
          </span>
        </Tooltip>
      </>
    ) : (
      <>
        {formatMoney(mode === "income" ? last.avgIncome : expenseVal, base)}{" "}
        <span className="text-base font-semibold text-muted">/ мес</span>
      </>
    );

  const subline =
    mode === "months"
      ? `${firePct.toFixed(0)}% пути к цели · на ${asOf}`
      : `среднее за год · на ${asOf}`;

  return (
    <div className={bare ? "" : "card card-pad"}>
      <CardHeader
        icon={Flame}
        title="Путь к FIRE"
        infoLabel="Как считается «Путь к FIRE»"
        info={howItWorks}
        subtitle={description}
        right={
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums text-income leading-none">
              {headline}
            </div>
            <div className="text-xs text-muted mt-1 tabular-nums">{subline}</div>
          </div>
        }
      />

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {/* Что откладываем по оси — общим `Segmented`. Вид расходов прежде
            прятался в выпадающее меню внутри пилюли «Расходы» — своя
            разметка, которой больше нигде нет; теперь это поле рядом,
            и появляется оно, только когда выбраны расходы. */}
        <Segmented
          size="sm"
          label="Что показать на графике"
          value={mode}
          onChange={setMode}
          options={[
            { value: "months", label: "Месяцы жизни" },
            { value: "income", label: "Доходы" },
            { value: "expense", label: "Расходы" },
          ]}
        />
        {mode === "expense" && (
          <Select
            size="sm"
            className="w-36"
            value={expKind}
            onChange={setExpKind}
            options={[
              { value: "obligatory", label: "Обязательные" },
              { value: "all", label: "Все" },
            ]}
            ariaLabel="Какие расходы"
          />
        )}

        {/* Period + scale of the chart (issue #35). Pushed right so the series
            pills stay the primary control. */}
        <div className="ml-auto flex items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs text-muted">
            Период
            <Select
              size="sm"
              className="w-24"
              value={range}
              onChange={setRange}
              options={RANGES.map((r) => ({ value: r.id, label: r.label }))}
              ariaLabel="Период графика"
              title="За какой отрезок истории построить график"
            />
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-muted">
            Шкала
            <Select
              size="sm"
              className="w-28"
              value={scale}
              onChange={setScale}
              options={SCALES.map((s) => ({ value: s.id, label: s.label }))}
              ariaLabel="Шаг по оси времени"
              title="Шаг по оси времени: месяцы, кварталы или годы (берётся значение на конец периода)"
            />
          </label>
        </div>
      </div>

      <div className="h-72">
        <ResponsiveContainer>
          <AreaChart data={chart}>
            <defs>
              <linearGradient id="fireFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.5} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
            <XAxis
              dataKey="key"
              stroke={chartAxisStroke}
              fontSize={11}
              tickFormatter={(d) => bucketLabel(d as string, scale)}
              minTickGap={40}
            />
            <YAxis
              stroke={chartAxisStroke}
              fontSize={11}
              tickFormatter={(v) =>
                mode === "months"
                  ? `${v} мес`
                  : formatNum(v as number, { compact: true })
              }
              domain={mode === "months" ? [0, monthsDomainMax] : ["auto", "auto"]}
            />
            <RTooltip
              {...chartTooltipProps}
              labelFormatter={(d) => bucketLabel(d as string, scale)}
              formatter={(v: unknown) =>
                mode === "months"
                  ? [
                      `${formatFixed(Number(v))} мес · ${((Number(v) / FIRE_TARGET) * 100).toFixed(0)}% пути к цели`,
                      "Запас",
                    ]
                  : [
                      formatMoney(Number(v), base),
                      mode === "income"
                        ? "Доход / мес"
                        : expKind === "obligatory"
                          ? "Обязательные / мес"
                          : "Все расходы / мес",
                    ]
              }
            />
            {mode === "months" && showTarget && (
              <ReferenceLine
                y={FIRE_TARGET}
                stroke={chartColor.warn}
                strokeWidth={2}
                strokeDasharray="4 4"
                label={{
                  value: "цель · FIRE 100%",
                  position: "insideTopRight",
                  fill: chartColor.warn,
                  fontSize: 11,
                }}
              />
            )}
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={2}
              fill="url(#fireFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
