import type { TipProps } from "./shared";
import { useRef } from "react";
import { clickedRow } from "../../../lib/chartClick";
import { ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { ChartContainer } from "../../ChartContainer";
import { Scale } from "lucide-react";
import { ChartTooltipCard, TooltipFacts, type TooltipFact } from "../../TooltipFacts";
import { formatMoney, formatNum, monthLabel, chartTooltipProps, chartGridStroke, chartAxisStroke } from "../../../lib/format";
import { robustCeiling, niceScale } from "../../../lib/dashboardModel";
import type { DashboardModel } from "../../../hooks/useDashboardModel";
import { NARROW_QUERY, useMediaQuery } from "../../../hooks/useMediaQuery";


function CashflowTip({ active, payload, base }: TipProps & { base: string }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as
    | { ym?: string; isForecast?: boolean; incomeReal?: number; expenseReal?: number }
    | undefined;
  if (!row?.ym) return null;
  const inc = row.incomeReal ?? 0;
  const exp = row.expenseReal ?? 0;
  const fc = !!row.isForecast;
  const diff = inc - exp;
  const facts: TooltipFact[] = [
    {
      label: fc ? "Прогноз дохода" : "Доход",
      value: formatMoney(inc, base),
      swatch: `bg-income${fc ? " opacity-60" : ""}`,
      strong: !fc,
    },
    {
      label: fc ? "Прогноз расхода" : "Расход",
      value: formatMoney(exp, base),
      swatch: `bg-expense${fc ? " opacity-60" : ""}`,
      strong: !fc,
    },
    {
      label: "Разница",
      value: formatMoney(diff, base, { signed: true }),
      icon: <Scale />,
      tone: diff >= 0 ? "income" : "expense",
      strong: true,
    },
  ];
  return (
    <ChartTooltipCard>
      <TooltipFacts
        title={monthLabel(row.ym)}
        facts={facts}
        note={fc ? "Прогноз по среднему за последние месяцы" : undefined}
      />
    </ChartTooltipCard>
  );
}



/** Прямоугольник со скруглённым верхом — рисуем сами, раз у столбца своя форма. */
function topRoundedPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return (
    `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} ` +
    `L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`
  );
}

interface CashBarProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  payload?: Record<string, unknown>;
  /** Имя поля-признака «столбец срезан» в строке данных. */
  clipFlag: string;
  /** Имя поля с настоящей суммой — её печатаем над срезанным столбцом. */
  realKey: string;
}

/**
 * Столбец, который умеет показать, что он срезан, и что он прогнозный.
 *
 * Прогноз рисуется здесь же, а не отдельной серией: каждая серия резервирует
 * свой слот в КАЖДОМ месяце, даже когда её значение пустое, — четыре серии
 * давали столбцы по шесть пикселей. Двух серий хватает, а факт от прогноза
 * отличает заливка.
 *
 * У срезанного столбца верхняя кромка зубчатая — общепринятый знак разрыва
 * шкалы, — а над ним стоит настоящая сумма. Без этого срез был бы враньём:
 * столбец выглядел бы обычным, просто высоким.
 */
function CashBar(props: CashBarProps) {
  const { x = 0, y = 0, width = 0, height = 0, fill } = props;
  if (height <= 0 || width <= 0) return null;
  const row = props.payload ?? {};
  const clipped = !!row[props.clipFlag];
  const forecast = !!row.isForecast;
  const real = Number(row[props.realKey] ?? 0);
  const step = width / 4;
  return (
    <g>
      <path
        d={topRoundedPath(x, y, width, height, 3)}
        fill={fill}
        fillOpacity={forecast ? 0.28 : 1}
        stroke={forecast ? fill : undefined}
        strokeDasharray={forecast ? "3 3" : undefined}
      />
      {clipped && (
        <>
          <path
            d={`M${x},${y} l${step},-3.5 l${step},7 l${step},-7 l${step},3.5`}
            fill="none"
            stroke={fill}
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <text
            x={x + width / 2}
            y={y - 9}
            textAnchor="middle"
            fill={fill}
            fontSize={10}
            fontWeight={600}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {formatNum(real, { compact: true })}
          </text>
        </>
      )}
    </g>
  );
}

/**
 * Доходы и расходы по месяцам.
 *
 * Показываем последние `window` месяцев, а не всю историю: на сорока месяцах
 * столбцы выходили по два пикселя.
 *
 * Шкала строится по устойчивому максимуму (`robustCeiling`): один месяц с
 * крупной покупкой прижимал остальные четырнадцать ко дну, и график переставал
 * показывать обычный ритм. Всё, что выше среза, рисуется с зубчатой кромкой и
 * настоящим числом над столбцом.
 */
export function CashflowBars({
  m,
  height = 240,
  window = 12,
  onMonth,
}: {
  m: DashboardModel;
  height?: number;
  window?: number;
  /** Клик по месяцу. `kind` — если попали в столбец: доходы или расходы. */
  onMonth?: (ym: string, kind?: "income" | "expense") => void;
}) {
  const tail = m.forecast.slice(-(window + 3));
  // Клик по столбцу доходит и до самого графика; столбец успевает первым и
  // помечает, что клик уже разобран, — иначе поверх шторки доходов тут же
  // открылась бы шторка всего месяца.
  const barClicked = useRef(false);
  // На телефоне подписи месяцев через одну шли вплотную («Июль 26Сент. 26»).
  const narrow = useMediaQuery(NARROW_QUERY);
  const { cap: rawCap, clipped } = robustCeiling(
    tail.flatMap((p) => [p.income, p.expense]).map((v) => Math.round(v))
  );
  // Круглый верх и ровный шаг: сырой срез давал деление «680,9 тыс.», которое
  // не влезало в ось и срезалось слева.
  const scale = niceScale(rawCap);
  const cap = scale.max;
  // Срезанный столбец не дотягивается до верха: над ним нужно место под число.
  const limit = cap * 0.9;
  const draw = (v: number) => (clipped ? Math.min(v, limit) : v);

  const data = tail.map((p) => {
    const inc = Math.round(p.income);
    const exp = Math.round(p.expense);
    return {
      ym: p.ym,
      month: monthLabel(p.ym),
      isForecast: !!p.isForecast,
      income: draw(inc),
      expense: draw(exp),
      incomeReal: inc,
      expenseReal: exp,
      incomeClipped: clipped && inc > limit,
      expenseClipped: clipped && exp > limit,
    };
  });

  return (
    // `flex-1` работает, только когда карточка сама колонка-флекс: тогда график
    // забирает всю оставшуюся высоту вместо того, чтобы оставлять под собой
    // пустое поле, когда соседняя карточка в ряду выше. Там, где родитель не
    // флекс, размер задаёт `minHeight`, и поведение не меняется.
    <div className="flex flex-col gap-1 flex-1 min-h-0">
      <div className="flex-1 min-h-0" style={{ minHeight: height }}>
        <ChartContainer>
          <ComposedChart
            data={data}
            // Справа — место под подпись последнего месяца: она стоит по центру
            // крайнего столбца и при 4 px срезалась («Янв. 2…»).
            margin={{ top: 18, right: 16, bottom: 0, left: 0 }}
            barCategoryGap="14%"
            barGap={3}
            onClick={(e: unknown) => {
              if (barClicked.current) {
                barClicked.current = false;
                return;
              }
              const row = clickedRow(e, data);
              if (row && !row.isForecast && onMonth) onMonth(row.ym);
            }}
            style={{ cursor: onMonth ? "pointer" : undefined }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} vertical={false} />
            {/* Подписи через одну и без « г.»: пятнадцать полных «Окт. 25 г.»
                в ряд не помещаются, и Recharts выбрасывал их сам — вразнобой,
                отчего ось выглядела сбитой. Через одну шаг ровный, а год
                остаётся при месяце и без служебного хвоста. */}
            <XAxis
              dataKey="month"
              stroke={chartAxisStroke}
              fontSize={11}
              tickLine={false}
              interval={narrow ? 2 : 1}
              tickFormatter={(v: string) => String(v).replace(/\s*г\.$/, "")}
            />
            <YAxis
              stroke={chartAxisStroke}
              fontSize={11}
              tickLine={false}
              axisLine={false}
              domain={[0, cap > 0 ? cap : "auto"]}
              ticks={cap > 0 ? scale.ticks : undefined}
              tickFormatter={(v) => formatNum(v, { compact: true })}
            />
            {/* Настоящие суммы, а не срезанные высоты столбцов, — их берёт
                сам тултип из строки данных. */}
            <Tooltip
              cursor={chartTooltipProps.cursor}
              wrapperStyle={chartTooltipProps.wrapperStyle}
              content={<CashflowTip base={m.base} />}
            />
            <Bar
              dataKey="income"
              name="Доход +"
              onClick={(bar: { payload?: { ym?: string; isForecast?: boolean } }) => {
                const row = bar?.payload;
                if (!row?.ym || row.isForecast || !onMonth) return;
                barClicked.current = true;
                onMonth(row.ym, "income");
              }}
              fill="rgb(var(--c-income))"
              maxBarSize={30}
              activeBar={false}
              isAnimationActive={false}
              shape={(props: object) => (
                <CashBar {...(props as CashBarProps)} clipFlag="incomeClipped" realKey="incomeReal" />
              )}
            />
            <Bar
              dataKey="expense"
              name="Расход −"
              onClick={(bar: { payload?: { ym?: string; isForecast?: boolean } }) => {
                const row = bar?.payload;
                if (!row?.ym || row.isForecast || !onMonth) return;
                barClicked.current = true;
                onMonth(row.ym, "expense");
              }}
              fill="rgb(var(--c-expense))"
              maxBarSize={30}
              activeBar={false}
              isAnimationActive={false}
              shape={(props: object) => (
                <CashBar {...(props as CashBarProps)} clipFlag="expenseClipped" realKey="expenseReal" />
              )}
            />
          </ComposedChart>
        </ChartContainer>
      </div>
    </div>
  );
}
