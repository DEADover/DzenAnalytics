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
import {
  Scale, Target, TrendingUp, ArrowUpRight, Clock, Lightbulb, Sigma,
} from "lucide-react";
import { CategoryDot } from "../CategoryDot";
import { ChartTooltipCard, TooltipFacts, type TooltipFact } from "../TooltipFacts";
import { InfoPopover } from "../InfoPopover";
import { AccountLogo } from "../AccountLogo";
import { accountKindLabel } from "../../lib/accountType";
import {
  formatMoney,
  formatNum,
  formatPct,
  formatDate,
  monthLabel,
  chartTooltipProps,
  chartGridStroke,
  chartAxisStroke,
} from "../../lib/format";
import { heatStep, robustCeiling } from "../../lib/dashboardModel";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/** «19 авг» — в узкой колонке полное название месяца переносит строку. */
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек"];
import type { DashboardModel } from "../../hooks/useDashboardModel";
import type { PlannedOp } from "../../lib/plannedOps";

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
  info,
  to,
  linkLabel = "Все",
  right,
}: {
  title: ReactNode;
  /**
   * Пояснение к виджету. Живёт под значком рядом с заголовком, а не строкой
   * под ним: подпись у каждой карточки съедала место и делала шапки разной
   * высоты, а нужна она раз в жизни.
   */
  info?: ReactNode;
  to?: string;
  linkLabel?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <div className="flex items-center gap-1.5 min-w-0">
        <h3 className="font-semibold text-[16px] truncate">{title}</h3>
        {info && <InfoPopover label="Что это за график">{info}</InfoPopover>}
      </div>
      {right}
      {to && (
        <Link
          to={to}
          className="pill-link"
        >
          {linkLabel}
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

/* ─────────────────────────────  графики  ───────────────────────────── */

/**
 * Подсказки графиков собраны на общем компоненте продукта
 * (`ChartTooltipCard` + `TooltipFacts`) — том же, что у графика месячного
 * бюджета. Своя вёрстка подсказки в каждом графике означала бы, что цвет
 * метки, порядок строк и подача разницы у каждого свои.
 */
interface TipProps {
  active?: boolean;
  payload?: { payload?: Record<string, unknown> }[];
}

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

function NetWorthTip({ active, payload, base }: TipProps & { base: string }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as { date?: string; net?: number } | undefined;
  if (!row?.date) return null;
  return (
    <ChartTooltipCard>
      <TooltipFacts
        title={formatDate(row.date)}
        facts={[
          {
            label: "Баланс",
            value: formatMoney(row.net ?? 0, base, { signed: true }),
            swatchColor: "rgb(var(--c-accent))",
            strong: true,
          },
        ]}
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
            {/* Подписи через одну и без « г.»: пятнадцать полных «Окт. 25 г.»
                в ряд не помещаются, и Recharts выбрасывал их сам — вразнобой,
                отчего ось выглядела сбитой. Через одну шаг ровный, а год
                остаётся при месяце и без служебного хвоста. */}
            <XAxis
              dataKey="month"
              stroke={chartAxisStroke}
              fontSize={11}
              tickLine={false}
              interval={1}
              tickFormatter={(v: string) => String(v).replace(/\s*г\.$/, "")}
            />
            <YAxis
              stroke={chartAxisStroke}
              fontSize={11}
              tickLine={false}
              axisLine={false}
              domain={[0, cap > 0 ? cap : "auto"]}
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
            cursor={chartTooltipProps.cursor}
            wrapperStyle={chartTooltipProps.wrapperStyle}
            content={<NetWorthTip base={m.base} />}
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
  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Список прокручивается внутри карточки: счетов бывает и двенадцать, а
          обрезать их числом значило бы врать итогом внизу. */}
      <div className="scroll-soft flex flex-col flex-1 min-h-0 -mx-2 px-2">
      {m.accounts.map((a) => {
        // Тип известен только из кэша Дзен-мани; в режиме CSV его нет.
        // И не повторяем его, когда он слово в слово совпал с названием счёта
        // («Наличные — Наличные»).
        const label = a.type ? accountKindLabel(a.type, a.savings) : "";
        const kind =
          label && label !== "—" && label.toLowerCase() !== a.title.trim().toLowerCase()
            ? label
            : "";
        return (
        <button
          key={a.title}
          type="button"
          onClick={() => onAccount?.(a.title)}
          className="flex h-[56px] shrink-0 items-center justify-between gap-3 border-b border-border last:border-0 text-left group rounded-lg px-2 transition-colors duration-200 hover:bg-panel2/70 active:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <span className="flex items-center gap-2.5 min-w-0">
            <AccountLogo title={a.title} type={a.type} size={28} />
            <span className="min-w-0">
              <span className="block truncate text-[15px] group-hover:text-accent">{a.title}</span>
              {/* Тип известен только из кэша Дзен-мани. В режиме CSV его нет, и
                  строка-прочерк была бы шумом — тогда её просто не рисуем. */}
              {kind && (
                <span className="block text-[12px] text-muted truncate">
                  {kind}
                  {a.offBalance && " · Вне баланса"}
                </span>
              )}
            </span>
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
        );
      })}
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
  // Полоса меряется от САМОЙ КРУПНОЙ статьи — так видно соотношение между
  // ними, — а процент считается от ВСЕХ расходов месяца, как на «Категориях».
  // Раньше процент тоже шёл от крупнейшей, и у верхней строки всегда стояло
  // «100%»: число, которое ничего не сообщало и расходилось с тем же разрезом
  // на своей странице.
  const top = rows[0].expense || 1;
  const total = rows.reduce((sum, c) => sum + c.expense, 0) || 1;
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="scroll-soft flex flex-col gap-3 flex-1 min-h-0 -mx-2 px-2">
      {rows.map((c) => {
        const frac = c.expense / top;
        return (
          <button
            key={c.category}
            type="button"
            onClick={() => onCategory?.(c.category)}
            // Значок стоит ПЕРЕД полосой, а не над ней: полоса живёт в той же
            // колонке, что и название, и начинается от одного с ним края —
            // так же, как в представлении «Bars» на «Категориях». Раньше она
            // шла во всю ширину строки, подныривая под значок, и левый край у
            // полос и названий не совпадал.
            className="w-full shrink-0 text-left group flex items-center gap-2 py-0.5 rounded-lg px-2 transition-colors duration-200 hover:bg-panel2/70 active:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <CategoryDot category={c.category} size="w-7 h-7" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-[15px] flex-1 group-hover:text-accent">
                  {c.category}
                </span>
                <span className="font-mono tabular-nums text-[12px] text-muted">
                  {formatPct(c.expense / total, 1)}
                </span>
                <span className="font-mono tabular-nums text-[14px] font-medium shrink-0">
                  {formatMoney(c.expense, m.base)}
                </span>
              </div>
              <div className="h-2 mt-1 rounded-full bg-panel2 overflow-hidden">
                <div
                  className="h-full rounded-full bg-expense"
                  style={{ width: `${frac * 100}%`, opacity: 0.35 + 0.65 * frac }}
                />
              </div>
            </div>
          </button>
        );
      })}
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
    <div className="scroll-soft flex flex-col flex-1 min-h-0 -mx-2 px-2">
      {m.upcoming.map((p) => (
        <div
          key={p.payee + p.currency + p.date}
          className="flex h-[56px] shrink-0 items-center justify-between gap-3 border-b border-border last:border-0"
        >
          <span className="flex items-center gap-2.5 min-w-0">
            <i
              className={`w-[3px] h-6 rounded-sm shrink-0 block ${
                p.inDays <= 1 ? "bg-warn" : "bg-border"
              }`}
            />
            <span className="min-w-0">
              <span className="block text-[14.5px] font-medium truncate">{p.payee}</span>
              {/* Дата и комментарий одной строкой: с двумя строка платежа была
                  выше строки счёта, и списки в соседних карточках не сходились. */}
              <span className="block text-[12px] text-muted truncate">
                {formatDate(p.date, "short")} ·{" "}
                {p.inDays === 0 ? "сегодня" : p.inDays === 1 ? "завтра" : `через ${p.inDays} дн`}
                {p.comment ? ` · ${p.comment}` : ""}
              </span>
            </span>
          </span>
          <span className="text-right shrink-0">
            {/* Без минуса: тратами здесь всё и так, знак повторял бы то, что уже
                сказано красным и самим названием карточки. */}
            <span className="block font-mono tabular-nums font-semibold text-[15px] text-expense">
              {formatMoney(p.amount, p.currency)}
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
/**
 * Планы Дзен-мани до конца месяца — второй вид «Запланированных операций».
 *
 * Расход и доход различаем цветом и знаком, как везде в продукте. Переводы не
 * показываем: перекладывание денег между своими счетами не спишется и не
 * придёт, а в списке ожидаемых операций читалось бы и тем и другим.
 *
 * Прогноз Дзен-мани от плана, поставленного руками, отличаем подписью: первое —
 * догадка по регулярному платежу, второе — намерение человека.
 */
export function ZenPlannedList({
  rows,
  base,
  today,
}: {
  rows: PlannedOp[] | null;
  base: string;
  today: string;
}) {
  if (rows === null) {
    return (
      <div className="text-sm text-muted text-center py-6">
        Планы приезжают из Дзен-мани — подключите синхронизацию
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="text-sm text-muted text-center py-6">
        До конца месяца планов в Дзен-мани нет
      </div>
    );
  }
  return (
    <div className="scroll-soft flex flex-col flex-1 min-h-0 -mx-2 px-2">
      {rows.map((p) => {
        const inDays = Math.max(0, Math.round((Date.parse(p.date) - Date.parse(today)) / 86400000));
        return (
          <div
            key={p.id}
            className="flex h-[56px] shrink-0 items-center justify-between gap-3 border-b border-border last:border-0"
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <i
                className={`w-[3px] h-6 rounded-sm shrink-0 block ${
                  inDays <= 1 ? "bg-warn" : "bg-border"
                }`}
              />
              <span className="min-w-0">
                <span className="block text-[14.5px] font-medium truncate">
                  {p.payee || p.category || "Без названия"}
                </span>
                <span className="block text-[12px] text-muted truncate">
                  {formatDate(p.date, "short")} ·{" "}
                  {inDays === 0 ? "сегодня" : inDays === 1 ? "завтра" : `через ${inDays} дн`}
                  {p.forecast ? " · прогноз" : ""}
                  {p.comment ? ` · ${p.comment}` : ""}
                </span>
              </span>
            </span>
            <span
              className={`block font-mono tabular-nums font-semibold text-[15px] shrink-0 ${
                p.kind === "income" ? "text-income" : "text-expense"
              }`}
            >
              {p.kind === "income" ? "+" : "−"}
              {formatMoney(p.amountBase, base)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

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

  // Значок наблюдения того же размера, что и кружок категории: мелкая точка
  // рядом с крупным значком читалась как две разные породы строк.
  const badge = {
    plan: { icon: Target, tone: "text-expense", bg: "bg-expense/12" },
    spike: { icon: TrendingUp, tone: "text-expense", bg: "bg-expense/12" },
    price: { icon: ArrowUpRight, tone: "text-warn", bg: "bg-warn/15" },
    missed: { icon: Clock, tone: "text-accent", bg: "bg-accent/12" },
    insight: { icon: Lightbulb, tone: "text-accent", bg: "bg-accent/12" },
  } as const;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex flex-col">
        {rows.map((r) => {
          const b = badge[r.kind];
          const Icon = b.icon;
          return (
            <div
              key={r.id}
              className="flex items-start justify-between gap-3 py-2.5 border-b border-border last:border-0"
            >
              <span className="flex items-start gap-3 min-w-0">
                {r.category ? (
                  <span className="mt-0.5 shrink-0">
                    <CategoryDot category={r.category} size="w-7 h-7" />
                  </span>
                ) : (
                  <span
                    className={`mt-0.5 w-7 h-7 rounded-full shrink-0 grid place-items-center ${b.bg} ${b.tone}`}
                  >
                    <Icon className="w-4 h-4" aria-hidden="true" />
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block text-[14.5px] font-medium truncate">{r.title}</span>
                  <span className="block text-[12.5px] text-muted leading-snug">{r.body}</span>
                </span>
              </span>
              {r.value !== undefined && (
                <span className="font-mono tabular-nums font-semibold text-[14px] shrink-0 pt-1">
                  {formatMoney(r.value, m.base)}
                </span>
              )}
            </div>
          );
        })}

        {excess > 0 && (
          <div className="flex items-start justify-between gap-3 py-2.5 border-b border-border last:border-0">
            <span className="flex items-start gap-3 min-w-0">
              <span className="mt-0.5 w-7 h-7 rounded-full shrink-0 grid place-items-center bg-expense/12 text-expense">
                <Sigma className="w-4 h-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-[14.5px] font-medium truncate">
                  Сверх обычного за месяц
                </span>
                <span className="block text-[12.5px] text-muted leading-snug">
                  Суммарно по разогнавшимся статьям
                </span>
              </span>
            </span>
            <span className="font-mono tabular-nums font-semibold text-[14px] shrink-0 pt-1 text-expense">
              +{formatMoney(excess, m.base)}
            </span>
          </div>
        )}
      </div>
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
  onDay,
}: {
  m: DashboardModel;
  /** Открыть операции конкретного дня. */
  onDay?: (date: string) => void;
}) {
  const year = Number(m.ym.slice(0, 4));
  const monthIdx = Number(m.ym.slice(5, 7)) - 1;
  const days = new Date(year, monthIdx + 1, 0).getDate();
  const todayKey = new Date().toISOString().slice(0, 10);

  const ymd = (d: number) =>
    `${m.ym}-${String(d).padStart(2, "0")}`;

  // Календарная сетка: столбец — день недели, строка — неделя месяца. Ведущие
  // пустые клетки нужны, чтобы первое число встало под свой день недели.
  const lead = (new Date(year, monthIdx, 1).getDay() + 6) % 7;
  const cells: { key: string; day: number | null }[] = [];
  for (let i = 0; i < lead; i++) cells.push({ key: `lead-${i}`, day: null });
  for (let d = 1; d <= days; d++) cells.push({ key: ymd(d), day: d });

  const spend = (d: number) => m.dayMap.get(ymd(d))?.expense ?? 0;
  const values = Array.from({ length: days }, (_, i) => spend(i + 1));
  // Шкала — по устойчивому максимуму: один крупный день иначе загонял все
  // остальные в самую бледную ступень.
  const { cap } = robustCeiling(values);
  const shade = (step: number) =>
    step === 0
      ? "rgb(var(--c-panel2))"
      : `color-mix(in srgb, rgb(var(--c-expense)) ${[0, 22, 44, 68, 100][step]}%, rgb(var(--c-panel2)))`;

  const past = Array.from({ length: days }, (_, i) => i + 1).filter((d) => ymd(d) <= todayKey);
  const quiet = past.filter((d) => spend(d) <= 0).length;
  const busiest = past.reduce((best, d) => (spend(d) > spend(best) ? d : best), past[0] ?? 1);

  const avgDay = past.length ? past.reduce((a, d) => a + spend(d), 0) / past.length : 0;
  const opsCount = past.reduce((a, d) => a + (m.dayMap.get(ymd(d))?.count ?? 0), 0);
  // «Обычный день» — медиана по дням, где траты были. Среднее задирает один
  // крупный день, и «в среднем 10 437 ₽» перестаёт описывать обычный день.
  const spentDays = past.map(spend).filter((v) => v > 0).sort((a, b) => a - b);
  const medianDay = spentDays.length
    ? spentDays.length % 2 === 0
      ? (spentDays[spentDays.length / 2 - 1] + spentDays[spentDays.length / 2]) / 2
      : spentDays[(spentDays.length - 1) / 2]
    : 0;
  const topDays = [...past]
    .filter((d) => spend(d) > 0)
    .sort((a, b) => spend(b) - spend(a))
    .slice(0, 5);

  return (
    <div className="flex flex-col gap-2 flex-1 min-h-0">
      <div className="flex flex-col xl:flex-row xl:items-start gap-5 flex-1 min-h-0">
      {/* Колонке календаря нужна своя ширина: без неё она ужималась под
          соседний список и клетка выходила по 25 px. */}
      <div className="flex flex-col gap-2 w-full xl:w-[26rem] xl:shrink-0">
      <div className="grid grid-cols-7 gap-2 text-[11.5px] text-muted text-center max-w-[26rem] w-full">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      <div
        className="grid grid-cols-7 gap-2 max-w-[26rem] w-full"
        role="img"
        aria-label={`Расходы по дням за ${monthLabel(m.ym)}. Самый крупный день — ${formatMoney(
          spend(busiest),
          m.base
        )}.`}
      >
        {cells.map((c) => {
          if (c.day === null) return <span key={c.key} />;
          const future = ymd(c.day) > todayKey;
          const value = future ? 0 : spend(c.day);
          const step = future ? 0 : heatStep(value, cap);
          // Цвет числа — по ступени, иначе оно тонет в собственной клетке.
          // Приглушённый серый годится только на пустой: на верхних ступенях он
          // давал полтора к одному по тёмной теме, на средних — два с небольшим
          // по светлой. Теперь на закрашенных клетках число полноцветное, а на
          // двух верхних, где клетка почти сплошь красная, — белое: на красном
          // оно читается в обеих темах (4,8:1 по светлой, 6,1:1 по тёмной).
          const hot = step >= 4;
          const dayTone = future
            ? "text-muted/50"
            : hot
              ? "text-white font-medium"
              : step > 0
                ? "text-text"
                : "text-muted";
          return (
            <button
              key={c.key}
              type="button"
              disabled={future || value <= 0}
              onClick={() => onDay?.(ymd(c.day as number))}
              className={`aspect-square rounded-md flex items-center justify-center text-[13px] tabular-nums
                          transition-shadow duration-150
                          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50
                          ${dayTone}
                          ${
                            !future && value > 0
                              ? "cursor-pointer hover:ring-2 hover:ring-accent/40"
                              : "cursor-default"
                          }`}
              style={{
                background: future ? "transparent" : shade(step),
                border: future ? "1px dashed rgb(var(--c-border))" : undefined,
              }}
            >
              {c.day}
            </button>
          );
        })}
      </div>

      </div>

      {/* Пустое поле справа от календаря забирают самые дорогие дни: месяц —
          это семь колонок, шире он не становится, а карточка широкая. */}
      {topDays.length > 0 && (
        <div className="flex-1 min-w-0 xl:border-l xl:border-border xl:pl-5">
          <div className="label mb-2">Самые дорогие дни</div>
          <div className="flex flex-col">
            {topDays.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => onDay?.(ymd(d))}
                className="flex items-center justify-between gap-3 py-1.5 border-b border-border last:border-0
                           text-left rounded-lg px-2 -mx-2 transition-colors duration-200
                           hover:bg-panel2/70 focus-visible:outline-none focus-visible:ring-2
                           focus-visible:ring-accent/40 group"
              >
                <span className="text-[13.5px] whitespace-nowrap">
                  {d} {MONTHS_SHORT[monthIdx]}
                  <span className="text-muted text-[12px]">
                    {" · "}
                    {WEEKDAYS[(new Date(year, monthIdx, d).getDay() + 6) % 7]}
                  </span>
                </span>
                <span className="font-mono tabular-nums font-semibold text-[13.5px] text-expense shrink-0">
                  {formatMoney(spend(d), m.base)}
                </span>
              </button>
            ))}
          </div>

          {/* Итоги месяца стоят здесь, а не полосой во всю карточку: там они
              добавляли карточке лишнюю высоту, а рядом со списком дней читаются
              как его продолжение. Строкой на каждый показатель — в две колонки
              подписи переносились. */}
          <div className="mt-4 pt-3 border-t border-border flex flex-col text-[12.5px]">
            {[
              {
                label: "Дней без трат",
                value: (
                  <>
                    {quiet}{" "}
                    <span className="text-muted font-normal text-[12px]">из {past.length}</span>
                  </>
                ),
              },
              { label: "Операций за месяц", value: opsCount },
              { label: "В среднем в день", value: formatMoney(avgDay, m.base) },
              { label: "Обычный день", value: formatMoney(medianDay, m.base) },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-baseline justify-between gap-3 py-1.5 border-b border-border/60 last:border-0"
              >
                <span className="text-muted">{row.label}</span>
                <span className="font-mono tabular-nums font-semibold text-[15px] shrink-0">
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      </div>


    </div>
  );
}



