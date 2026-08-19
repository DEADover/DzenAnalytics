/**
 * Кирпичи главной страницы.
 *
 * Все варианты главной собираются из этих блоков — различается только
 * раскладка и оболочка. Иначе четыре варианта разъехались бы по мелочам, и
 * сравнивать пришлось бы не композицию, а случайные различия в отступах.
 *
 * Правила, общие для всех блоков:
 *   • цвет берётся ТОЛЬКО из токенов темы (`rgb(var(--c-…))`) — на старой
 *     главной в графиках стояли хексы тёмной темы, и в светлой линия «Чистый»
 *     давала контраст около 1,8:1;
 *   • доход и расход всегда несут знак «+» / «−» рядом с цветом: зелёный и
 *     красный при дейтеранопии различаются на ΔE 5.0, то есть почти никак;
 *   • атрибут `title` не используется — системные подсказки в проекте
 *     запрещены и недоступны с тача.
 */

import type { ReactNode } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  AreaChart,
  Area,
} from "recharts";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { CategoryDot } from "../CategoryDot";
import { AccountLogo } from "../AccountLogo";
import {
  formatMoney,
  formatNum,
  formatDate,
  monthLabel,
  toNum,
  chartTooltipProps,
  chartGridStroke,
  chartAxisStroke,
} from "../../lib/format";
import { heatStep, robustCeiling } from "../../lib/dashboardModel";

const MONTH_TICKS = ["янв", "фев", "мар", "апр", "май", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек"];
import type { DashboardModel } from "../../hooks/useDashboardModel";

/* ─────────────────────────────  мелочи  ───────────────────────────── */

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      {/* Настоящий заголовок раздела, а не просто мелкий текст: на старой
          главной не было ни одного h2–h6, и с клавиатуры страница читалась
          как одно сплошное полотно. */}
      <h2 className="text-[11.5px] uppercase tracking-[0.12em] text-muted font-medium">
        {children}
      </h2>
      <span className="flex-1 h-px bg-border" />
    </div>
  );
}

export function BlockTitle({
  title,
  sub,
  to,
  linkLabel = "Все",
  right,
}: {
  title: ReactNode;
  sub?: ReactNode;
  to?: string;
  linkLabel?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="min-w-0">
        <h3 className="font-semibold text-[16px] text-balance">{title}</h3>
        {sub && <div className="text-[12.5px] text-muted mt-0.5">{sub}</div>}
      </div>
      {right}
      {to && (
        <Link
          to={to}
          className="text-xs text-accent hover:underline flex items-center gap-1 shrink-0"
        >
          {linkLabel} <ArrowRight className="w-3 h-3" />
        </Link>
      )}
    </div>
  );
}

/** Легенда «Доход + / Расход −»: знак делает серии различимыми без цвета. */
export function IncomeExpenseLegend() {
  return (
    <div className="flex items-center gap-3 text-[11.5px] text-muted">
      <span className="flex items-center gap-1.5">
        <i className="w-2.5 h-2.5 rounded-sm bg-income block" />
        Доход&nbsp;+
      </span>
      <span className="flex items-center gap-1.5">
        <i className="w-2.5 h-2.5 rounded-sm bg-expense block" />
        Расход&nbsp;−
      </span>
    </div>
  );
}

/* ─────────────────────────────  герой месяца  ───────────────────────────── */

/**
 * Сколько денег останется свободными и каким темпом мы к этому идём.
 *
 * `size` меняет только масштаб числа: в «Сводке» оно работает заголовком
 * страницы, в плиточных вариантах — обычным показателем.
 */
export function FreeMoneyHero({
  m,
  size = "lg",
}: {
  m: DashboardModel;
  size?: "lg" | "xl" | "md";
}) {
  const numClass =
    size === "xl"
      ? "text-5xl 3xl:text-6xl"
      : size === "lg"
        ? "text-4xl 3xl:text-5xl"
        : "text-3xl";
  const spentPct = Math.min(100, m.month.progress * 100);
  // База для доли «впереди» — план месяца, если он есть, иначе ожидаемый расход
  // по темпу. Раньше базой был выдуманный прогноз дохода, и полоса врала вместе
  // с ним.
  const aheadBase = m.planExpense ?? m.projExpense;
  const aheadPct =
    aheadBase > 0 ? Math.min(100 - spentPct, (m.upcomingTotalBase / aheadBase) * 100) : 0;

  // Период пуст, а история есть — значит операции вычистил отбор. Показать
  // здесь бодрое число нельзя: оно будет посчитано из среднего и выдано за
  // факт. Честнее назвать причину и подсказать, где её снять.
  if (!m.hasCurrentData) {
    return (
      <div className="flex flex-col gap-3">
        <div className="label">Свободно до конца месяца</div>
        <div className="text-2xl font-semibold tracking-tight">Пока нечего считать</div>
        <div className="text-[14px] text-muted leading-relaxed max-w-[52ch]">
          За {monthLabel(m.ym)} в аналитику не попало ни одной операции. Обычно это отбор:
          активный разрез данных или выключённые внебалансовые счета — они убирают операции
          везде, кроме списка счетов.
        </div>
      </div>
    );
  }

  const short = m.free.value < 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="label">
        {short ? "Не хватает до конца месяца" : "Свободно до конца месяца"}
      </div>
      <div
        className={`font-mono font-semibold tabular-nums tracking-tight leading-none ${numClass} ${
          short ? "text-expense" : ""
        }`}
        style={{ wordSpacing: "-0.22em" }}
      >
        {formatMoney(Math.abs(m.free.value), m.base)}
      </div>
      {/* Формула целиком: по ней видно, из чего сложился итог, и её можно
          сверить с разделом «Бюджет» — там ровно эти же доход и расход. */}
      <div className="text-[14px] text-muted leading-relaxed max-w-[54ch]">
        Доход {monthLabel(m.ym)}{" "}
        <span className="font-mono tabular-nums text-income">
          {formatMoney(m.free.income, m.base)}
        </span>{" "}
        − потрачено{" "}
        <span className="font-mono tabular-nums text-expense">
          {formatMoney(m.free.spent, m.base)}
        </span>
        {m.free.ahead > 0 && (
          <>
            {" "}
            − впереди{" "}
            <span className="font-mono tabular-nums text-expense">
              {formatMoney(m.free.ahead, m.base)}
            </span>
          </>
        )}
      </div>
      {(m.planIncome !== null || m.month.running) && (
        <div className="text-[12.5px] text-muted">
          {m.planIncome !== null && m.planExpense !== null ? (
            <>
              План месяца:{" "}
              <span className="font-mono tabular-nums">
                {formatMoney(m.planIncome, m.base)}
              </span>{" "}
              дохода и{" "}
              <span className="font-mono tabular-nums">
                {formatMoney(m.planExpense, m.base)}
              </span>{" "}
              расхода
            </>
          ) : (
            <>
              Если темп не изменится, расход месяца составит{" "}
              <span className="font-mono tabular-nums">
                {formatMoney(m.projExpense, m.base)}
              </span>
            </>
          )}
        </div>
      )}
      <div className="mt-1">
        <div className="h-2 rounded-full bg-panel2 relative overflow-hidden">
          <i
            className="absolute inset-y-0 left-0 bg-expense/75 rounded-full"
            style={{ width: `${spentPct}%` }}
          />
          <i
            className="absolute inset-y-0 bg-warn/80"
            style={{ left: `${spentPct}%`, width: `${Math.max(0, aheadPct)}%` }}
          />
        </div>
        <div className="flex items-center justify-between pt-2 text-[12px] text-muted">
          <span>
            Прожито {m.month.day} из {m.month.days} дн
            {m.free.ahead > 0 && " · жёлтым то, что ещё спишется"}
          </span>
          <span>осталось {m.month.left} дн</span>
        </div>
      </div>
    </div>
  );
}

/** Кольцо темпа: во сколько раз тратим быстрее обычного. */
export function PaceRing({ m, size = 104 }: { m: DashboardModel; size?: number }) {
  if (m.pace === null) {
    return (
      <div className="flex flex-col items-center text-center gap-2">
        <div className="label">Темп трат</div>
        <div className="text-sm text-muted py-6">Пока не с чем сравнить</div>
      </div>
    );
  }
  const over = m.pace - 1;
  const tone = over > 0.08 ? "warn" : over < -0.08 ? "income" : "accent";
  const stroke =
    tone === "warn" ? "rgb(var(--c-warn))" : tone === "income" ? "rgb(var(--c-income))" : "rgb(var(--c-accent))";
  // Длина окружности при r=40 — 251.2. Заполняем долю от обычного темпа,
  // но не больше полного круга: при трёхкратном перерасходе кольцо просто полное.
  const frac = Math.max(0, Math.min(1, m.pace));
  return (
    <div className="flex flex-col items-center text-center gap-2">
      <div className="label">Темп трат</div>
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
        <circle cx="50" cy="50" r="40" fill="none" stroke="rgb(var(--c-panel2))" strokeWidth="10" />
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke={stroke}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray="251.2"
          strokeDashoffset={251.2 * (1 - frac)}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div
        className={`font-mono tabular-nums font-semibold text-xl ${
          tone === "warn" ? "text-warn" : tone === "income" ? "text-income" : "text-accent"
        }`}
      >
        {over >= 0 ? "+" : "−"}
        {Math.abs(over * 100).toFixed(0)} %
      </div>
      <div className="text-[11.5px] text-muted leading-snug">
        к обычному темпу
        <br />
        за первые {m.month.day} дн
      </div>
    </div>
  );
}

/* ─────────────────────────────  графики  ───────────────────────────── */

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
  onMonth?: (ym: string) => void;
}) {
  const tail = m.forecast.slice(-(window + 3));
  const { cap, clipped } = robustCeiling(
    tail.flatMap((p) => [p.income, p.expense]).map((v) => Math.round(v))
  );
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
        <ResponsiveContainer>
          <ComposedChart
            data={data}
            margin={{ top: 18, right: 4, bottom: 0, left: 0 }}
            barCategoryGap="14%"
            barGap={3}
            onClick={(e: unknown) => {
              const ev = e as { activePayload?: { payload?: { ym?: string } }[] } | undefined;
              const ym = ev?.activePayload?.[0]?.payload?.ym;
              const isF = tail.find((p) => p.ym === ym)?.isForecast;
              if (ym && !isF && onMonth) onMonth(ym);
            }}
            style={{ cursor: onMonth ? "pointer" : undefined }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} vertical={false} />
            <XAxis dataKey="month" stroke={chartAxisStroke} fontSize={11} tickLine={false} />
            <YAxis
              stroke={chartAxisStroke}
              fontSize={11}
              tickLine={false}
              axisLine={false}
              domain={[0, cap > 0 ? cap : "auto"]}
              tickFormatter={(v) => formatNum(v, { compact: true })}
            />
            <Tooltip
              {...chartTooltipProps}
              // Показываем настоящую сумму, а не срезанную высоту столбца.
              formatter={(_v: unknown, name: unknown, item: unknown) => {
                const row = (item as { payload?: Record<string, number> } | undefined)?.payload;
                const isIncome = String(name).includes("Доход");
                const real = row?.[isIncome ? "incomeReal" : "expenseReal"] ?? 0;
                return [formatMoney(real, m.base), String(name)];
              }}
            />
            <Bar
              dataKey="income"
              name="Доход +"
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
              fill="rgb(var(--c-expense))"
              maxBarSize={30}
              activeBar={false}
              isAnimationActive={false}
              shape={(props: object) => (
                <CashBar {...(props as CashBarProps)} clipFlag="expenseClipped" realKey="expenseReal" />
              )}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {clipped && (
        <div className="text-[11.5px] text-muted">
          Шкала срезана по обычному размаху — рекордные месяцы подписаны числом,
          иначе остальные прижимались бы ко дну.
        </div>
      )}
    </div>
  );
}

/** Как рос совокупный баланс. */
export function NetWorthArea({ m, height = 240 }: { m: DashboardModel; height?: number }) {
  return (
    <div className="flex-1 min-h-0" style={{ minHeight: height }}>
      <ResponsiveContainer>
        <AreaChart data={m.netWorthSeries}>
          <defs>
            <linearGradient id="dashNwV2" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(var(--c-accent))" stopOpacity={0.5} />
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
            tickFormatter={(v) => formatNum(v, { compact: true })}
            domain={["auto", "auto"]}
          />
          <Tooltip
            {...chartTooltipProps}
            labelFormatter={(d) => formatDate(d as string)}
            formatter={(v: unknown) => [formatMoney(toNum(v), m.base, { signed: true }), "Баланс"]}
          />
          <Area
            type="monotone"
            dataKey="net"
            stroke="rgb(var(--c-accent))"
            strokeWidth={2}
            fill="url(#dashNwV2)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ─────────────────────────────  списки  ───────────────────────────── */

export function AccountsList({
  m,
  onAccount,
}: {
  m: DashboardModel;
  onAccount?: (title: string) => void;
}) {
  if (m.accounts.length === 0) {
    return <div className="text-sm text-muted text-center py-6">Счетов пока нет</div>;
  }
  const total = m.accounts.reduce((s, a) => s + a.balanceBase, 0);
  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Список прокручивается внутри карточки: счетов бывает и двенадцать, а
          обрезать их числом значило бы врать итогом внизу. */}
      <div className="scroll-soft flex-1 min-h-0 max-h-[22rem] -mx-1 px-1">
      {m.accounts.map((a) => (
        <button
          key={a.title}
          type="button"
          onClick={() => onAccount?.(a.title)}
          className="flex items-center justify-between gap-3 py-2.5 border-b border-border last:border-0 text-left group rounded-lg -mx-2 px-2 transition-colors duration-200 hover:bg-panel2/70 active:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <span className="flex items-center gap-2.5 min-w-0">
            <AccountLogo title={a.title} type={a.type} />
            <span className="truncate text-[15px] group-hover:text-accent">{a.title}</span>
            {a.savings && <span className="text-[10px] text-muted shrink-0">· Накопительный</span>}
          </span>
          <span className="text-right shrink-0">
            <span
              className={`block font-mono tabular-nums font-semibold text-[15px] ${
                a.balanceBase < 0 ? "text-expense" : ""
              }`}
            >
              {formatMoney(a.balanceBase, m.base)}
            </span>
            {a.nativeCurrency !== m.base && (
              <span className="block font-mono tabular-nums text-[12px] text-muted">
                {formatMoney(a.nativeBalance, a.nativeCurrency)}
              </span>
            )}
          </span>
        </button>
      ))}
      </div>
      <div className="mt-auto flex items-center justify-between pt-2.5 border-t border-border text-[12.5px] text-muted">
        <span>Всего {m.accounts.length}</span>
        <span className="font-mono tabular-nums">{formatMoney(total, m.base)}</span>
      </div>
    </div>
  );
}

/**
 * На что уходит в этом месяце.
 *
 * Точка отвечает за «кто» (её цвет — из справочника категорий), длина и
 * насыщенность полосы — за «сколько». На старой главной эти два кодирования
 * спорили: точка была цветная, а полоса у всех одинаково красная.
 */
export function CategoriesList({
  m,
  onCategory,
}: {
  m: DashboardModel;
  onCategory?: (name: string) => void;
}) {
  const rows = m.categories;
  if (rows.length === 0) {
    return (
      <div className="text-sm text-muted text-center py-6">
        За {monthLabel(m.ym)} расходов ещё не было
      </div>
    );
  }
  const top = rows[0].expense || 1;
  const total = rows.reduce((sum, c) => sum + c.expense, 0);
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="scroll-soft flex flex-col gap-3 flex-1 min-h-0 max-h-[22rem] -mx-1 px-1">
      {rows.map((c) => {
        const frac = c.expense / top;
        return (
          <button
            key={c.category}
            type="button"
            onClick={() => onCategory?.(c.category)}
            className="w-full text-left group py-0.5 rounded-lg -mx-2 px-2 transition-colors duration-200 hover:bg-panel2/70 active:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <div className="flex items-center gap-2 mb-1">
              <CategoryDot category={c.category} size="w-4 h-4" />
              <span className="truncate text-[15px] flex-1 group-hover:text-accent">
                {c.category}
              </span>
              <span className="font-mono tabular-nums text-[12px] text-muted">
                {Math.round(frac * 100)} %
              </span>
              <span className="font-mono tabular-nums text-[14px] font-medium shrink-0">
                {formatMoney(c.expense, m.base)}
              </span>
            </div>
            <div className="h-2 rounded-full bg-panel2 overflow-hidden">
              <div
                className="h-full rounded-full bg-expense"
                style={{ width: `${frac * 100}%`, opacity: 0.35 + 0.65 * frac }}
              />
            </div>
          </button>
        );
      })}
      </div>
      <div className="mt-auto flex items-center justify-between pt-2.5 border-t border-border text-[12.5px] text-muted">
        <span>Всего {rows.length}</span>
        <span className="font-mono tabular-nums">{formatMoney(total, m.base)}</span>
      </div>
    </div>
  );
}

/** Что ещё спишется до конца месяца. Итог — в базовой валюте. */
export function UpcomingList({ m }: { m: DashboardModel }) {
  if (m.upcoming.length === 0) {
    return (
      <div className="text-sm text-muted text-center py-6">
        До конца месяца регулярных платежей не ждём
      </div>
    );
  }
  return (
    // Все платежи, а не первые несколько: список обрезался числом, а итог в
    // шапке считался по всем — суммы на экране не сходились.
    <div className="scroll-soft flex flex-col flex-1 min-h-0 max-h-[22rem] -mx-1 px-1">
      {m.upcoming.map((p) => (
        <div
          key={p.payee + p.currency + p.date}
          className="flex items-center justify-between gap-3 py-2.5 border-b border-border last:border-0"
        >
          <span className="flex items-center gap-2.5 min-w-0">
            <i
              className={`w-[3px] h-6 rounded-sm shrink-0 block ${
                p.inDays <= 1 ? "bg-warn" : "bg-border"
              }`}
            />
            <span className="min-w-0">
              <span className="block text-[14.5px] font-medium truncate">{p.payee}</span>
              <span className="block text-[12px] text-muted">
                {formatDate(p.date, "short")} ·{" "}
                {p.inDays === 0 ? "сегодня" : p.inDays === 1 ? "завтра" : `через ${p.inDays} дн`}
              </span>
              {p.comment && (
                <span className="block text-[12px] text-muted truncate">{p.comment}</span>
              )}
            </span>
          </span>
          <span className="text-right shrink-0">
            <span className="block font-mono tabular-nums font-semibold text-[15px] text-expense">
              −{formatMoney(p.amount, p.currency)}
            </span>
            {p.currency !== m.base && (
              <span className="block font-mono tabular-nums text-[12px] text-muted">
                {formatMoney(p.amountBase, m.base)}
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Что заметно: наблюдения одним списком.
 *
 * Раньше это были два разных блока — узкая карточка «Что разогналось» на две
 * строки и панель из шести плиток-наблюдений. Первая пустовала, во второй
 * половина плиток была шумом.
 *
 * Отбор и порядок задаёт `buildNotices`; здесь только подача.
 */
export function ObservationsList({
  m,
  limit = 5,
}: {
  m: DashboardModel;
  limit?: number;
}) {
  const rows = m.notices.slice(0, limit);
  const excess = m.spikes
    .filter((s) => s.ym === m.ym)
    .reduce((sum, r) => sum + Math.max(0, r.current - r.baseline), 0);

  if (rows.length === 0) {
    return (
      <div className="text-sm text-muted py-3">
        Ничего необычного — месяц идёт в своих обычных пределах
      </div>
    );
  }

  const toneClass = {
    expense: "bg-expense",
    income: "bg-income",
    warn: "bg-warn",
    accent: "bg-accent",
  } as const;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {rows.map((r) => (
        <div
          key={r.id}
          className="flex items-start justify-between gap-3 py-2.5 border-b border-border last:border-0"
        >
          <span className="flex items-start gap-2.5 min-w-0">
            {r.category ? (
              <span className="mt-1 shrink-0">
                <CategoryDot category={r.category} size="w-3.5 h-3.5" />
              </span>
            ) : (
              <i className={`mt-[7px] w-2 h-2 rounded-full shrink-0 block ${toneClass[r.tone]}`} />
            )}
            <span className="min-w-0">
              <span className="block text-[14.5px] font-medium truncate">{r.title}</span>
              <span className="block text-[12.5px] text-muted leading-snug">{r.body}</span>
            </span>
          </span>
          {r.value !== undefined && (
            <span className="font-mono tabular-nums font-semibold text-[14px] shrink-0 pt-0.5">
              {formatMoney(r.value, m.base)}
            </span>
          )}
        </div>
      ))}
      {excess > 0 && (
        <div className="mt-auto pt-3 border-t border-border flex items-center justify-between text-[12.5px] text-muted">
          <span>Сверх обычного за месяц</span>
          <span className="font-mono tabular-nums font-semibold text-expense">
            +{formatMoney(excess, m.base)}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Активность по дням.
 *
 * У шкалы есть подписи в деньгах: «меньше / больше» не отвечало на вопрос
 * «а сколько это». Ступени строятся из токена расхода через `color-mix`,
 * поэтому тёмная тема работает по устройству, а не по совпадению.
 */
export function ActivityHeat({
  m,
  weeks = 53,
}: {
  m: DashboardModel;
  /** Сколько недель показываем. Год (53) заполняет широкую карточку целиком. */
  weeks?: number;
}) {
  const today = new Date();
  // Сетка выравнивается по понедельникам: без этого столбец — не неделя, а
  // просто семь подряд идущих дней, и сравнивать столбцы между собой нельзя.
  const shiftToMonday = (new Date(today).getDay() + 6) % 7;
  const lastMonday = new Date(today);
  lastMonday.setDate(lastMonday.getDate() - shiftToMonday);
  const first = new Date(lastMonday);
  first.setDate(first.getDate() - (weeks - 1) * 7);

  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;

  const cells: { key: string; date: Date | null; expense: number }[] = [];
  const monthTicks: { col: number; label: string }[] = [];
  for (let w = 0; w < weeks; w++) {
    for (let dow = 0; dow < 7; dow++) {
      const d = new Date(first);
      d.setDate(d.getDate() + w * 7 + dow);
      // Дни после сегодняшнего рисуем пустыми: их ещё не было.
      const future = d > today;
      const key = ymd(d);
      cells.push({ key, date: future ? null : d, expense: future ? 0 : m.dayMap.get(key)?.expense ?? 0 });
      if (dow === 0 && d.getDate() <= 7) {
        monthTicks.push({ col: w, label: MONTH_TICKS[d.getMonth()] });
      }
    }
  }

  // Шкала цвета строится по устойчивому максимуму, а не по рекордному дню:
  // одна покупка на 2,4 млн загоняла все остальные дни в самую бледную
  // ступень, и год превращался в ровное поле с одной красной клеткой.
  const { cap } = robustCeiling(cells.map((c) => c.expense));
  const realMax = Math.max(...cells.map((c) => c.expense), 0);
  const shade = (step: number) =>
    step === 0
      ? "rgb(var(--c-panel2))"
      : `color-mix(in srgb, rgb(var(--c-expense)) ${[0, 22, 44, 68, 100][step]}%, rgb(var(--c-panel2)))`;

  const past = cells.filter((c) => c.date);
  const quiet = past.filter((c) => c.expense <= 0).length;
  const busiest = past.reduce(
    (best, c) => (c.expense > (best?.expense ?? 0) ? c : best),
    null as (typeof past)[number] | null
  );

  const cols = `repeat(${weeks}, minmax(0, 1fr))`;

  return (
    <div className="flex flex-col gap-1.5 flex-1 min-h-0">
      {/* Подписи месяцев: без них год клеток — просто узор. */}
      <div className="grid gap-[2px] text-[10px] text-muted" style={{ gridTemplateColumns: cols }}>
        {Array.from({ length: weeks }, (_, w) => {
          const tick = monthTicks.find((t) => t.col === w);
          return (
            <span key={w} className="leading-none whitespace-nowrap">
              {tick ? tick.label : ""}
            </span>
          );
        })}
      </div>

      <div
        className="grid grid-flow-col gap-[2px]"
        style={{ gridTemplateColumns: cols, gridTemplateRows: "repeat(7, auto)" }}
        role="img"
        aria-label={`Расходы по дням за ${weeks} недель. Самый крупный день — ${formatMoney(
          realMax,
          m.base
        )}.`}
      >
        {cells.map((c) => (
          <i
            key={c.key}
            className="block w-full aspect-square rounded-[2px]"
            style={{
              background: c.date ? shade(heatStep(c.expense, cap)) : "transparent",
            }}
          />
        ))}
      </div>

      <div className="flex items-center justify-end gap-1.5 pt-1 text-[11px] text-muted">
        Меньше
        {[0, 1, 2, 3, 4].map((s) => (
          <i
            key={s}
            className="block rounded-[2px]"
            style={{ width: 9, height: 9, background: shade(s) }}
          />
        ))}
        {formatMoney(cap, m.base)} и больше
      </div>

      <div className="mt-auto pt-3 border-t border-border grid grid-cols-2 gap-4 text-[12.5px]">
        <div>
          <div className="text-muted">Дней без трат</div>
          <div className="font-mono tabular-nums font-semibold text-[15px]">
            {quiet} <span className="text-muted font-normal text-[12px]">из {past.length}</span>
          </div>
        </div>
        {busiest && busiest.expense > 0 && (
          <div className="text-right">
            <div className="text-muted">Самый дорогой день</div>
            <div className="font-mono tabular-nums font-semibold text-[15px] text-expense">
              {formatMoney(busiest.expense, m.base)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
