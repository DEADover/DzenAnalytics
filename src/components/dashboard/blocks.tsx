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
import { heatStep } from "../../lib/dashboardModel";
import type { DashboardModel } from "../../hooks/useDashboardModel";

/* ─────────────────────────────  мелочи  ───────────────────────────── */

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] uppercase tracking-[0.12em] text-muted font-medium">
        {children}
      </span>
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
        <div className="font-semibold text-[14.5px]">{title}</div>
        {sub && <div className="text-xs text-muted mt-0.5">{sub}</div>}
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
  const aheadPct =
    m.projIncome > 0 ? Math.min(100 - spentPct, (m.upcomingTotalBase / m.projIncome) * 100) : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="label">Свободно до конца месяца</div>
      <div
        className={`font-mono font-semibold tabular-nums tracking-tight leading-none ${numClass} ${
          m.free.value >= 0 ? "" : "text-expense"
        }`}
        style={{ wordSpacing: "-0.22em" }}
      >
        {formatMoney(m.free.value, m.base, { signed: m.free.value < 0 })}
      </div>
      <div className="text-[13px] text-muted leading-relaxed max-w-[54ch]">
        Ожидаемый доход{" "}
        <span className="font-mono tabular-nums text-text">
          {formatMoney(m.free.income, m.base)}
        </span>{" "}
        − потрачено{" "}
        <span className="font-mono tabular-nums text-text">
          {formatMoney(m.free.spent, m.base)}
        </span>
        {m.free.ahead > 0 && (
          <>
            {" "}
            − впереди{" "}
            <span className="font-mono tabular-nums text-text">
              {formatMoney(m.free.ahead, m.base)}
            </span>
          </>
        )}
      </div>
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
        <div className="flex items-center justify-between pt-1.5 text-[11px] text-muted">
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

/**
 * Доходы и расходы по месяцам.
 *
 * Показываем последние `window` месяцев, а не всю историю: на сорока месяцах
 * столбцы выходили по два пикселя. Прогнозные месяцы — теми же столбцами, но
 * приглушённые и с пунктирной обводкой.
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
  const data = tail.map((p) => ({
    ym: p.ym,
    month: monthLabel(p.ym),
    income: p.isForecast ? null : Math.round(p.income),
    expense: p.isForecast ? null : Math.round(p.expense),
    incomeF: p.isForecast ? Math.round(p.income) : null,
    expenseF: p.isForecast ? Math.round(p.expense) : null,
  }));

  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <ComposedChart
          data={data}
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
            tickFormatter={(v) => formatNum(v, { compact: true })}
          />
          <Tooltip
            {...chartTooltipProps}
            formatter={(v: unknown, name: unknown) => [
              formatMoney(toNum(v), m.base),
              String(name),
            ]}
          />
          <Bar dataKey="income" name="Доход +" fill="rgb(var(--c-income))" radius={[3, 3, 0, 0]} activeBar={false} />
          <Bar dataKey="expense" name="Расход −" fill="rgb(var(--c-expense))" radius={[3, 3, 0, 0]} activeBar={false} />
          <Bar
            dataKey="incomeF"
            name="Прогноз дохода +"
            fill="rgb(var(--c-income))"
            fillOpacity={0.3}
            stroke="rgb(var(--c-income))"
            strokeDasharray="3 3"
            radius={[3, 3, 0, 0]}
            activeBar={false}
          />
          <Bar
            dataKey="expenseF"
            name="Прогноз расхода −"
            fill="rgb(var(--c-expense))"
            fillOpacity={0.3}
            stroke="rgb(var(--c-expense))"
            strokeDasharray="3 3"
            radius={[3, 3, 0, 0]}
            activeBar={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Как рос совокупный баланс. */
export function NetWorthArea({ m, height = 240 }: { m: DashboardModel; height?: number }) {
  return (
    <div style={{ height }}>
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
  limit = 6,
  onAccount,
}: {
  m: DashboardModel;
  limit?: number;
  onAccount?: (title: string) => void;
}) {
  const shown = m.accounts.slice(0, limit);
  const restCount = m.accounts.length - shown.length;
  const restSum = m.accounts.slice(limit).reduce((s, a) => s + a.balanceBase, 0);

  if (m.accounts.length === 0) {
    return <div className="text-sm text-muted text-center py-6">Счетов пока нет</div>;
  }
  return (
    <div className="flex flex-col">
      {shown.map((a) => (
        <button
          key={a.title}
          type="button"
          onClick={() => onAccount?.(a.title)}
          className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0 text-left group"
        >
          <span className="flex items-center gap-2.5 min-w-0">
            <AccountLogo title={a.title} type={a.type} />
            <span className="truncate text-[13.5px] group-hover:text-accent">{a.title}</span>
            {a.savings && <span className="text-[10px] text-muted shrink-0">· Накопительный</span>}
          </span>
          <span className="text-right shrink-0">
            <span
              className={`block font-mono tabular-nums font-semibold text-[13.5px] ${
                a.balanceBase < 0 ? "text-expense" : ""
              }`}
            >
              {formatMoney(a.balanceBase, m.base)}
            </span>
            {a.nativeCurrency !== m.base && (
              <span className="block font-mono tabular-nums text-[11px] text-muted">
                {formatMoney(a.nativeBalance, a.nativeCurrency)}
              </span>
            )}
          </span>
        </button>
      ))}
      {restCount > 0 && (
        <div className="flex items-center justify-between pt-2 text-[11.5px] text-muted">
          <span>Ещё {restCount}</span>
          <span className="font-mono tabular-nums">{formatMoney(restSum, m.base)}</span>
        </div>
      )}
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
  limit = 8,
  onCategory,
}: {
  m: DashboardModel;
  limit?: number;
  onCategory?: (name: string) => void;
}) {
  const rows = m.categories.slice(0, limit);
  if (rows.length === 0) {
    return (
      <div className="text-sm text-muted text-center py-6">
        За {monthLabel(m.ym)} расходов ещё не было
      </div>
    );
  }
  const top = rows[0].expense || 1;
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((c) => {
        const frac = c.expense / top;
        return (
          <button
            key={c.category}
            type="button"
            onClick={() => onCategory?.(c.category)}
            className="w-full text-left group"
          >
            <div className="flex items-center gap-2 mb-1">
              <CategoryDot category={c.category} size="w-4 h-4" />
              <span className="truncate text-[13.5px] flex-1 group-hover:text-accent">
                {c.category}
              </span>
              <span className="font-mono tabular-nums text-[11px] text-muted">
                {Math.round(frac * 100)} %
              </span>
              <span className="font-mono tabular-nums text-[12.5px] shrink-0">
                {formatMoney(c.expense, m.base)}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-panel2 overflow-hidden">
              <div
                className="h-full rounded-full bg-expense"
                style={{ width: `${frac * 100}%`, opacity: 0.35 + 0.65 * frac }}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Что ещё спишется до конца месяца. Итог — в базовой валюте. */
export function UpcomingList({ m, limit = 6 }: { m: DashboardModel; limit?: number }) {
  if (m.upcoming.length === 0) {
    return (
      <div className="text-sm text-muted text-center py-6">
        До конца месяца регулярных платежей не ждём
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {m.upcoming.slice(0, limit).map((p) => (
        <div
          key={p.payee + p.currency + p.date}
          className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0"
        >
          <span className="flex items-center gap-2.5 min-w-0">
            <i
              className={`w-[3px] h-6 rounded-sm shrink-0 block ${
                p.inDays <= 1 ? "bg-warn" : "bg-border"
              }`}
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium truncate">{p.payee}</span>
              <span className="block text-[11px] text-muted">
                {formatDate(p.date, "short")} ·{" "}
                {p.inDays === 0 ? "сегодня" : p.inDays === 1 ? "завтра" : `через ${p.inDays} дн`}
              </span>
            </span>
          </span>
          <span className="text-right shrink-0">
            <span className="block font-mono tabular-nums font-semibold text-[13px] text-expense">
              −{formatMoney(p.amount, p.currency)}
            </span>
            {p.currency !== m.base && (
              <span className="block font-mono tabular-nums text-[11px] text-muted">
                {formatMoney(p.amountBase, m.base)}
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Категории, которые в этом месяце заметно разогнались. */
export function SpikesList({ m, limit = 3 }: { m: DashboardModel; limit?: number }) {
  const rows = m.spikes.filter((s) => s.ym === m.ym).slice(0, limit);
  if (rows.length === 0) {
    return (
      <div className="text-sm text-muted py-3">
        Ничего не разогналось — все статьи в своих обычных пределах
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {rows.map((s) => (
        <div key={s.category} className="flex items-center justify-between gap-3 text-[13px]">
          <span className="flex items-center gap-2 min-w-0">
            <CategoryDot category={s.category} size="w-3.5 h-3.5" />
            <span className="truncate">{s.category}</span>
          </span>
          <span className="shrink-0 text-right">
            <span className="font-mono tabular-nums font-semibold">
              {formatMoney(s.current, m.base)}
            </span>
            <span className="text-muted text-[11.5px]">
              {" "}
              обычно {formatMoney(s.baseline, m.base)} · ×{s.ratio.toFixed(1)}
            </span>
          </span>
        </div>
      ))}
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
  days = 91,
  cell = 11,
}: {
  m: DashboardModel;
  days?: number;
  cell?: number;
}) {
  const today = new Date();
  const cells: { date: string; expense: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
    cells.push({ date: key, expense: m.dayMap.get(key)?.expense ?? 0 });
  }
  const max = Math.max(...cells.map((c) => c.expense), 0);
  const shade = (step: number) =>
    step === 0
      ? "rgb(var(--c-panel2))"
      : `color-mix(in srgb, rgb(var(--c-expense)) ${[0, 22, 44, 68, 100][step]}%, rgb(var(--c-panel2)))`;

  return (
    <div className="flex flex-col gap-2">
      <div
        className="grid grid-flow-col gap-[2px]"
        style={{ gridTemplateRows: `repeat(7, ${cell}px)` }}
      >
        {cells.map((c) => (
          <i
            key={c.date}
            className="block rounded-[2px]"
            style={{ width: cell, height: cell, background: shade(heatStep(c.expense, max)) }}
          />
        ))}
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted">
        <span>Пустой день — трат не было</span>
        <span className="flex items-center gap-1.5">
          0
          {[0, 1, 2, 3, 4].map((s) => (
            <i
              key={s}
              className="block rounded-[2px]"
              style={{ width: 9, height: 9, background: shade(s) }}
            />
          ))}
          {formatMoney(max, m.base)}
        </span>
      </div>
    </div>
  );
}
