import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ChartTooltip,
} from "recharts";
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  Trophy,
  CalendarDays,
  CalendarRange,
  CalendarCheck,
  CalendarOff,
  Users,
  Tags,
  PiggyBank,
  Coins,
  Receipt,
} from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useAnalyticsTransactions } from "../hooks/useAnalyticsTransactions";
import { useDrillStore } from "../store/useDrillStore";
import {
  buildYearReview,
  availableYears,
  counterpartyOf,
  type YearReview,
} from "../lib/yearReview";
import { affectsExpense } from "../lib/txKindStyle";
import {
  formatMoney,
  formatNum,
  formatPct,
  monthLabel,
  monthLabelFull,
  toNum,
  chartTooltipProps,
  chartGridStroke,
  chartAxisStroke,
} from "../lib/format";
import { pluralRu } from "../lib/plural";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { Select } from "../components/Select";
import { InfoPopover, InfoTerm } from "../components/InfoPopover";
import { ChartTooltipCard, TooltipFacts, type TooltipFact } from "../components/TooltipFacts";

const INCOME = "#10B981";
const EXPENSE = "#EF4444";

/** «14 марта» — дата без года: год и так в заголовке страницы. */
function dayLabel(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  });
}

function deltaPill(value: number, invertColor = false): { text: string; cls: string } {
  if (Math.abs(value) < 0.01) return { text: "≈ как в прошлом году", cls: "text-muted" };
  const positive = value > 0;
  const isGood = invertColor ? !positive : positive;
  const cls = isGood ? "text-income" : "text-expense";
  const sign = positive ? "+" : "";
  return { text: `${sign}${(value * 100).toFixed(0)}% к прошлому году`, cls };
}

export function YearReviewPage() {
  const transactions = useDataStore((s) => s.transactions);
  // The year's income/expense/net/biggest excludes turnover + off-balance flows
  // (#14); the year SELECTOR still lists every year that has any data.
  const analyticsTx = useAnalyticsTransactions();
  const baseCurrency = useDataStore((s) => s.rates.base);
  const showDrill = useDrillStore((s) => s.show);

  const years = useMemo(() => availableYears(transactions), [transactions]);
  const [year, setYear] = useState<number>(() => years[0] || new Date().getFullYear());

  // Clamp the selected year to the available list when it changes
  // (e.g. after a data reload). Keeps the picker on a valid value.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (years.length && !years.includes(year)) setYear(years[0]);
  }, [years, year]);

  const review = useMemo<YearReview>(
    () => buildYearReview(analyticsTx, year),
    [analyticsTx, year]
  );

  /** Операции года — основа всех проваливаний со страницы. */
  const yearTx = useMemo(
    () => analyticsTx.filter((t) => t.date.startsWith(`${year}-`)),
    [analyticsTx, year]
  );

  function drillMonth(ym: string) {
    showDrill(monthLabelFull(ym), yearTx.filter((t) => t.date.startsWith(ym)), "Год в цифрах");
  }

  function drillCategory(name: string) {
    showDrill(name, yearTx.filter((t) => t.category === name), `${year} год`);
  }

  function drillCounterparty(name: string) {
    showDrill(
      name,
      yearTx.filter((t) => affectsExpense(t.kind) && (counterpartyOf(t) || "—") === name),
      `${year} год`
    );
  }

  if (transactions.length === 0) return <EmptyState />;
  if (!review.hasData) {
    return (
      <div className="space-y-4">
        <PageHeader icon={Sparkles} title="Год в цифрах" />
        <div className="card-tray card-pad text-center text-muted py-12">
          В данных нет операций за {year} год.
        </div>
        {years.length > 0 && (
          <YearSwitcher year={year} years={years} onChange={setYear} />
        )}
      </div>
    );
  }

  const incomeDelta = deltaPill(review.prev.incomeDelta);
  const expenseDelta = deltaPill(review.prev.expenseDelta, true);
  const netDelta = deltaPill(review.prev.netDelta);
  const partial = review.window.to < `${year}-12-31`;

  return (
    <div className="space-y-3">
      <PageHeader
        icon={Sparkles}
        title={`Год в цифрах: ${year}`}
        hint="Итоги, рекорды и любопытные факты за выбранный год"
        right={
          <div className="flex items-center gap-2">
            <YearSwitcher year={year} years={years} onChange={setYear} />
            <InfoPopover>
              <p>
                Всё на странице считается за <InfoTerm>календарный год</InfoTerm> —
                с 1 января по 31 декабря, независимо от того, с какого числа у вас
                начинается месяц в других отчётах. Проценты рядом с суммами —
                сравнение с тем же периодом прошлого года; если данных за прошлый
                год нет, их и не показываем.
              </p>
              <p>
                Переводы между своими счетами в доход и расход не идут. Операции,
                исключённые из аналитики на странице «Категории» (обороты,
                взаимозачёты), сюда тоже не попадают — иначе рекорды набирались бы
                из перекладываний между своими же счетами.
              </p>
              <p>
                Всё, что считается «по дням» — средний расход, перерывы без трат, —
                мерится по <InfoTerm>отрезку с данными</InfoTerm>: от первой
                операции в вашей истории до сегодняшнего дня, а не по календарю.
                Иначе у идущего года будущее засчитывалось бы за долгий перерыв в
                тратах, а средний расход делился бы на дни, которых ещё не было.
              </p>
              <p>
                Имя контрагента берётся из справочника, а не из банковской строки:
                «DOSTAVKA PYATEROCHKA» и «DOSTAVKA IZ PYATEROCHK» — это одна
                «Пятёрочка». Строка банка остаётся только там, где контрагент к
                операции не привязан; такие можно разобрать в{" "}
                <InfoTerm>Настройки → Справочники → Контрагенты</InfoTerm>.
              </p>
            </InfoPopover>
          </div>
        }
      />

      {/* Итоги года */}
      <div className="tray">
        <div className="tray-core px-5 py-4">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted mb-3">
            <span className="uppercase tracking-wider">
              {formatNum(review.txCount)}{" "}
              {pluralRu(review.txCount, ["операция", "операции", "операций"])}
            </span>
            <span aria-hidden>·</span>
            {/* Честная граница данных: иначе «за 2026 год» читается как «за весь
                2026», а год ещё идёт и итоги неизбежно скромнее. */}
            <span>
              {partial ? `данные по ${dayLabel(review.window.to)}` : "год целиком"}
            </span>
          </div>
          {/* Четыре числа в ряд с разделителями: три на всю ширину монитора
              разъезжались так, что между ними оставались ладони пустоты. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-4 divide-border lg:divide-x">
            <Hero
              label="Доход"
              value={formatMoney(review.totalIncome, baseCurrency)}
              delta={review.prev.available ? incomeDelta.text : undefined}
              deltaCls={review.prev.available ? incomeDelta.cls : undefined}
              icon={<TrendingUp className="w-4 h-4 text-income" />}
            />
            <Hero
              label="Расход"
              value={formatMoney(review.totalExpense, baseCurrency)}
              delta={review.prev.available ? expenseDelta.text : undefined}
              deltaCls={review.prev.available ? expenseDelta.cls : undefined}
              icon={<TrendingDown className="w-4 h-4 text-expense" />}
              pad
            />
            <Hero
              label="Чистый поток"
              value={formatMoney(review.netFlow, baseCurrency, { signed: true })}
              delta={review.prev.available ? netDelta.text : undefined}
              deltaCls={review.prev.available ? netDelta.cls : undefined}
              icon={<Trophy className="w-4 h-4 text-accent" />}
              pad
            />
            <Hero
              label="Норма сбережений"
              value={review.totalIncome > 0 ? formatPct(review.savingsRate, 0) : "—"}
              // «−290 800 ₽ остаётся» — не по-русски и не по смыслу: при
              // отрицательном потоке ничего не остаётся, его не хватило.
              delta={
                review.totalIncome > 0
                  ? review.netFlow >= 0
                    ? `${formatMoney(review.netFlow, baseCurrency)} осталось`
                    : `${formatMoney(-review.netFlow, baseCurrency)} не хватило`
                  : undefined
              }
              deltaCls="text-muted"
              icon={
                <PiggyBank
                  className={`w-4 h-4 ${review.netFlow >= 0 ? "text-income" : "text-expense"}`}
                />
              }
              pad
            />
          </div>
        </div>
      </div>

      {/* Год по месяцам и профиль недели — половина ширины каждому: на широком
          мониторе двенадцать столбцов растягивались в пустое поле. */}
      <div className="grid lg:grid-cols-2 gap-3">
        <YearBars review={review} base={baseCurrency} onMonth={drillMonth} />
        <WeekProfile review={review} base={baseCurrency} />
      </div>

      {/* Кварталы */}
      <Quarters review={review} base={baseCurrency} onMonth={drillMonth} />

      {/* Рекорды месяцев */}
      <div className="grid sm:grid-cols-3 gap-3">
        <Record
          label="Лучший месяц"
          icon={<PiggyBank className="w-4 h-4 text-income" />}
          month={review.recordMonths.bestSaving?.ym}
          sub={
            review.recordMonths.bestSaving
              ? `${formatMoney(review.recordMonths.bestSaving.net, baseCurrency, { signed: true })} чистого потока`
              : ""
          }
          color="text-income"
          onOpen={drillMonth}
        />
        <Record
          label="Самый расходный"
          icon={<TrendingDown className="w-4 h-4 text-expense" />}
          month={review.recordMonths.biggestExpense?.ym}
          sub={
            review.recordMonths.biggestExpense
              ? `${formatMoney(review.recordMonths.biggestExpense.expense, baseCurrency)} расхода`
              : ""
          }
          color="text-expense"
          onOpen={drillMonth}
        />
        <Record
          label="Рекорд по доходу"
          icon={<TrendingUp className="w-4 h-4 text-accent" />}
          month={review.recordMonths.biggestIncome?.ym}
          sub={
            review.recordMonths.biggestIncome
              ? `${formatMoney(review.recordMonths.biggestIncome.income, baseCurrency)} дохода`
              : ""
          }
          color="text-accent"
          onOpen={drillMonth}
        />
      </div>

      {/* Куда уходили деньги */}
      <div className="grid lg:grid-cols-2 gap-3">
        <TopList
          title="Куда уходили деньги"
          hint="Статьи по сумме расхода за год"
          icon={<Tags className="w-4 h-4 text-accent" />}
          items={review.topCategories}
          baseCurrency={baseCurrency}
          total={review.totalExpense}
          barCls="bg-accent"
          onOpen={drillCategory}
        />
        <TopList
          title="Любимые контрагенты"
          hint="Имена из справочника, а не строки из выписки"
          icon={<Users className="w-4 h-4 text-accent2" />}
          items={review.topPayees}
          baseCurrency={baseCurrency}
          total={review.totalExpense}
          barCls="bg-accent2"
          onOpen={drillCounterparty}
        />
      </div>

      {/* Покупки и факты — пара в одном ряду */}
      <div className="grid lg:grid-cols-2 gap-3 items-start">
        <SectionCard
          icon={<Coins className="w-4 h-4 text-expense" />}
          title="Самые дорогие покупки"
          hint="Пять крупнейших операций года"
        >
          {review.topTransactions.length === 0 ? (
            <div className="text-sm text-muted py-6 text-center">Покупок за год нет.</div>
          ) : (
            <div className="space-y-0.5">
              {review.topTransactions.map((t, i) => (
                <button
                  key={t.id}
                  onClick={() =>
                    showDrill(counterpartyOf(t) || t.categoryFull, [t], `${year} год`)
                  }
                  title="Показать операцию"
                  className="w-full text-sm rounded-md px-2 py-1.5 text-left hover:bg-panel2/50"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-[11px] text-muted tabular-nums w-4 shrink-0">
                      {i + 1}
                    </span>
                    <span className="font-medium truncate flex-1 min-w-0">
                      {counterpartyOf(t) || t.categoryFull}
                    </span>
                    <span className="text-expense font-semibold tabular-nums shrink-0">
                      {formatMoney(t.amountBase, baseCurrency)}
                    </span>
                  </div>
                  {/* Комментарий к операции: часто именно в нём написано, ЧТО
                      это было, — «Отпуск · 3 января» само по себе не отвечает. */}
                  <div className="pl-6 text-xs text-muted truncate">
                    {t.categoryFull} · {dayLabel(t.date)}
                    {t.comment?.trim() ? ` · ${t.comment.trim()}` : ""}
                  </div>
                </button>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          icon={<Sparkles className="w-4 h-4 text-accent2" />}
          title="Любопытные факты"
          hint={`Считаем по дням с данными: ${dayLabel(review.window.from)} — ${dayLabel(
            review.window.to
          )}, это ${formatNum(review.window.days)} ${pluralRu(review.window.days, [
            "день",
            "дня",
            "дней",
          ])}`}
        >
          <div className="grid sm:grid-cols-2 gap-2">
            <Fact
              icon={<Coins className="w-4 h-4" />}
              label="В среднем в день"
              value={formatMoney(review.avgPerDay, baseCurrency)}
              sub="расхода"
            />
            <Fact
              icon={<Receipt className="w-4 h-4" />}
              label="Средний расход на операцию"
              value={formatMoney(review.avgCheck, baseCurrency)}
              sub={`по ${formatNum(review.expenseCount)} ${pluralRu(review.expenseCount, ["операции", "операциям", "операциям"])}`}
            />
            <Fact
              icon={<CalendarCheck className="w-4 h-4" />}
              label="Дней с тратами"
              value={`${formatNum(review.daysWithExpense)} из ${formatNum(review.window.days)}`}
              sub={
                review.window.days > 0
                  ? `это ${formatPct(review.daysWithExpense / review.window.days, 0)} дней`
                  : undefined
              }
            />
            <Fact
              icon={<CalendarOff className="w-4 h-4" />}
              label="Самый долгий перерыв"
              value={
                review.longestStreak.days > 0
                  ? `${formatNum(review.longestStreak.days)} ${pluralRu(review.longestStreak.days, ["день", "дня", "дней"])}`
                  : "ни одного дня"
              }
              sub={
                review.longestStreak.days > 0
                  ? review.longestStreak.days === 1
                    ? dayLabel(review.longestStreak.from)
                    : `${dayLabel(review.longestStreak.from)} — ${dayLabel(review.longestStreak.to)}`
                  : "тратили каждый день"
              }
            />
            <Fact
              icon={<Users className="w-4 h-4" />}
              label="Контрагентов за год"
              value={formatNum(review.uniqueMerchants)}
              sub="разных мест и людей"
            />
            <Fact
              icon={<Trophy className="w-4 h-4" />}
              label="Первая пятёрка статей"
              value={formatPct(review.topFiveShare, 0)}
              sub={`из ${formatNum(review.uniqueCategories)} статей в ходу`}
            />
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function YearBars({
  review,
  base,
  onMonth,
}: {
  review: YearReview;
  base: string;
  onMonth: (ym: string) => void;
}) {
  const data = useMemo(() => {
    const byYm = new Map(review.monthly.map((m) => [m.ym, m]));
    const lastMonth = Number(review.window.to.slice(5, 7));
    const upTo = review.window.to.startsWith(`${review.year}-`) ? lastMonth : 12;
    const out: { ym: string; label: string; income: number; expense: number }[] = [];
    for (let m = 1; m <= upTo; m++) {
      const ym = `${review.year}-${String(m).padStart(2, "0")}`;
      const point = byYm.get(ym);
      out.push({
        ym,
        label: monthLabel(ym).replace(/\s*\d+\s*г?\.?$/, ""),
        income: point?.income ?? 0,
        expense: point?.expense ?? 0,
      });
    }
    return out;
  }, [review]);

  if (data.length === 0) return null;

  return (
    <div className="card-tray px-4 py-3">
      <div className="font-semibold mb-2 flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-accent" />
        Год по месяцам
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
            barCategoryGap="28%"
            barGap={2}
            maxBarSize={22}
            style={{ cursor: "pointer" }}
            onClick={(e) => {
              const ev = e as { activePayload?: { payload?: { ym?: string } }[] } | undefined;
              const ym = ev?.activePayload?.[0]?.payload?.ym;
              if (ym) onMonth(ym);
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: chartAxisStroke }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: chartAxisStroke }}
              axisLine={false}
              tickLine={false}
              width={64}
              // Без знака валюты, как на «Денежном потоке»: «300 тыс. ₽» в
              // колонку оси не влезает и ломается на две строки.
              tickFormatter={(v) => formatNum(toNum(v), { compact: true })}
            />
            <ChartTooltip
              {...chartTooltipProps}
              content={({ active, payload, label }) => {
                const rows = (payload ?? []) as unknown as {
                  dataKey?: string | number;
                  value?: number | null;
                }[];
                if (!active || rows.length === 0) return null;
                const income = toNum(rows.find((r) => r.dataKey === "income")?.value);
                const expense = toNum(rows.find((r) => r.dataKey === "expense")?.value);
                const facts: TooltipFact[] = [
                  {
                    label: "Доход",
                    value: formatMoney(income, base),
                    swatch: "bg-income",
                    strong: true,
                  },
                  {
                    label: "Расход",
                    value: formatMoney(expense, base),
                    swatch: "bg-expense",
                    strong: true,
                  },
                  {
                    label: "Разница",
                    value: formatMoney(income - expense, base, { signed: true }),
                    tone: income - expense >= 0 ? "income" : "expense",
                  },
                ];
                return (
                  <ChartTooltipCard>
                    <TooltipFacts
                      title={String(label)}
                      facts={facts}
                      note="Нажмите на месяц — откроются его операции"
                    />
                  </ChartTooltipCard>
                );
              }}
            />
            {/* Анимацию гасим, как и на всех остальных графиках продукта: в
                recharts 3 столбцы, отрисованные в ещё не измеренном
                контейнере, так и остаются высотой в пиксель. */}
            <Bar
              dataKey="income"
              name="Доход"
              fill={INCOME}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
            <Bar
              dataKey="expense"
              name="Расход"
              fill={EXPENSE}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ─────────────────────  Общие примитивы страницы  ───────────────────── */

/**
 * Карточка раздела: значок, заголовок, поясняющая строка и содержимое.
 *
 * Семь блоков страницы верстали одну и ту же шапку каждый по-своему — где-то
 * `mb-2`, где-то `mb-3`, где-то пояснение было, где-то нет. Один компонент
 * держит их в строю и делает добавление восьмого блока вопросом одной строки.
 */
function SectionCard({
  icon,
  title,
  hint,
  right,
  children,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  /** Правый угол шапки: подпись-легенда или счётчик. */
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`card-tray px-4 py-3 flex flex-col ${className ?? ""}`}>
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="min-w-0">
          <div className="font-semibold flex items-center gap-2">
            {icon}
            <span className="truncate">{title}</span>
          </div>
          {hint && <div className="text-xs text-muted mt-0.5">{hint}</div>}
        </div>
        {right && <div className="shrink-0 text-[11px] text-muted">{right}</div>}
      </div>
      {children}
    </div>
  );
}

/**
 * Строка-мера: подпись, доля полосой и число справа.
 *
 * Полоса лежит ПОД строкой заливкой, а не отдельной линией под ней. Так пункт
 * занимает одну строку вместо трёх, а пустота между коротким именем и суммой —
 * та самая, что зияла во всю ширину монитора, — превращается в саму меру.
 *
 * Один и тот же примитив у статей, контрагентов и дней недели: это один и тот
 * же вопрос «какая доля у кого», и отвечать на него тремя разными способами на
 * одной странице незачем.
 */
function MeterRow({
  rank,
  label,
  share,
  value,
  note,
  barCls,
  strong,
  onClick,
  title,
}: {
  /** Номер в списке. Пусто — там, где порядок не про рейтинг (дни недели). */
  rank?: number;
  label: string;
  /** Доля от 0 до 1 — ширина полосы. */
  share: number;
  value: string;
  /** Мелким серым перед суммой: проценты, число операций. */
  note?: string;
  barCls: string;
  /** Выделить как лидера: полоса плотнее, подпись контрастнее. */
  strong?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const inner = (
    <>
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 rounded-md ${barCls} ${
          strong ? "opacity-30" : "opacity-[0.16]"
        }`}
        style={{ width: `${Math.max(1.5, Math.min(100, share * 100))}%` }}
      />
      {rank !== undefined && (
        <span className="relative text-[11px] text-muted tabular-nums w-4 shrink-0">
          {rank}
        </span>
      )}
      <span
        className={`relative truncate flex-1 min-w-0 ${strong ? "font-medium" : ""}`}
      >
        {label}
      </span>
      {note && (
        <span className="relative text-[11px] text-muted tabular-nums whitespace-nowrap shrink-0">
          {note}
        </span>
      )}
      <span className="relative tabular-nums whitespace-nowrap shrink-0 font-medium text-right">
        {value}
      </span>
    </>
  );
  const cls =
    "relative w-full flex items-center gap-2 text-sm text-left rounded-md px-2 py-1.5 overflow-hidden";
  if (!onClick) return <div className={cls}>{inner}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`${cls} hover:ring-1 hover:ring-border`}
    >
      {inner}
    </button>
  );
}

/**
 * Профиль недели: во что расход укладывается по дням.
 *
 * Раньше от этих данных на странице оставался один факт — «любимый день
 * недели». Он отвечал, где пик, но не показывал формы: будни ровные или ползут
 * вверх к пятнице, выходные вдвое дороже или как все.
 *
 * Столбиками это уже пробовали, и получился пустой виджет: доля и подпись дня
 * были, а самих столбиков — нет. Процентная высота внутри колонки без заданной
 * высоты не разрешается ни во что, и полоса схлопывалась в ноль. Горизонтальные
 * строки от этого свободны, читаются с суммами и совпадают с тем, как на этой
 * же странице устроены статьи и контрагенты.
 */
function WeekProfile({ review, base }: { review: YearReview; base: string }) {
  const max = Math.max(...review.weekdays.map((d) => d.total), 1);
  const sum = review.weekdays.reduce((n, d) => n + d.total, 0);
  return (
    <SectionCard
      icon={<CalendarDays className="w-4 h-4 text-accent" />}
      title="Расходы по дням недели"
      hint={
        sum > 0
          ? `Больше всего тратили по ${review.favoriteWeekday.dative}`
          : "Расходов за год нет"
      }
    >
      <div className="space-y-0.5">
        {review.weekdays.map((d) => (
          <MeterRow
            key={d.name}
            label={d.name}
            share={d.total / max}
            strong={d.total > 0 && d.total === max}
            note={sum > 0 ? formatPct(d.total / sum, 0) : undefined}
            value={formatMoney(d.total, base, { compact: true })}
            barCls="bg-accent"
          />
        ))}
      </div>
    </SectionCard>
  );
}

/**
 * Кварталы: год четырьмя числами и одной полосой на каждое.
 *
 * Двенадцать столбцов графика отвечают «когда именно», но чтобы понять, какая
 * половина года вышла дороже, их приходится складывать глазами.
 *
 * Три числа в столбик этого не давали: чтобы сравнить кварталы, снова надо
 * читать. Поэтому у каждого своя двухцветная полоса в общем масштабе — доход
 * слева, расход справа, — и кварталы сравниваются одним взглядом, а числа
 * остаются для точности.
 */
function Quarters({
  review,
  base,
  onMonth,
}: {
  review: YearReview;
  base: string;
  onMonth: (ym: string) => void;
}) {
  const scale = Math.max(
    ...review.quarters.map((q) => Math.max(q.income, q.expense)),
    1
  );
  const peak = Math.max(...review.quarters.map((q) => q.expense), 0);
  const ROMAN = ["I", "II", "III", "IV"];
  return (
    <SectionCard
      icon={<CalendarRange className="w-4 h-4 text-accent2" />}
      title="По кварталам"
      hint="Доход, расход и что осталось"
      right={
        <span className="flex items-center gap-2.5">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-income" /> доход
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-expense" /> расход
          </span>
        </span>
      }
    >
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
        {review.quarters.map((q) => {
          const empty = q.income === 0 && q.expense === 0;
          const firstMonth = `${review.year}-${String((q.q - 1) * 3 + 1).padStart(2, "0")}`;
          return (
            <button
              key={q.q}
              type="button"
              disabled={empty}
              onClick={() => onMonth(firstMonth)}
              title={
                empty ? "В этом квартале операций нет" : "Показать операции первого месяца"
              }
              className="card-sunken px-3 py-2.5 text-left disabled:opacity-45 enabled:hover:ring-1 enabled:hover:ring-border"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-muted">
                  <span className="font-semibold text-text">{ROMAN[q.q - 1]}</span> квартал
                </span>
                {!empty && q.expense === peak && (
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-expense/10 text-expense">
                    пик
                  </span>
                )}
              </div>
              {/* Квартал, который ещё не наступил, — это не «ноль рублей».
                  Три нуля в столбик читались как настоящий результат. */}
              {empty ? (
                <div className="text-sm text-muted mt-2">ещё не было</div>
              ) : (
                <>
                  <div
                    className={`stat-num text-xl font-bold tabular-nums leading-tight mt-0.5 ${
                      q.net >= 0 ? "text-income" : "text-expense"
                    }`}
                  >
                    {formatMoney(q.net, base, { compact: true, signed: true })}
                  </div>
                  <div className="mt-2 space-y-1">
                    <QuarterBar value={q.income} scale={scale} cls="bg-income" />
                    <QuarterBar value={q.expense} scale={scale} cls="bg-expense" />
                  </div>
                  <div className="mt-1.5 flex items-baseline justify-between gap-2 text-[11px] tabular-nums">
                    <span className="text-income">
                      {formatMoney(q.income, base, { compact: true })}
                    </span>
                    <span className="text-expense">
                      {formatMoney(q.expense, base, { compact: true })}
                    </span>
                  </div>
                </>
              )}
            </button>
          );
        })}
      </div>
    </SectionCard>
  );
}

/** Одна полоса квартала. Масштаб общий на все четыре — иначе не сравнить. */
function QuarterBar({ value, scale, cls }: { value: number; scale: number; cls: string }) {
  return (
    <div className="h-1.5 rounded-full bg-panel2 overflow-hidden">
      <div
        className={`h-full rounded-full ${cls}`}
        style={{ width: `${Math.max(1.5, Math.min(100, (value / scale) * 100))}%` }}
      />
    </div>
  );
}

/* ─────────────────────────────  Мелочи  ───────────────────────────────── */

function YearSwitcher({
  year,
  years,
  onChange,
}: {
  year: number;
  years: number[];
  onChange: (y: number) => void;
}) {
  return (
    <Select
      value={String(year)}
      options={years.map((y) => ({ value: String(y), label: String(y) }))}
      onChange={(v) => onChange(Number(v))}
      ariaLabel="Год"
      size="sm"
      className="w-24"
    />
  );
}

function Hero({
  label,
  value,
  delta,
  deltaCls,
  icon,
  /** Отступ слева от вертикальной черты — у всех ячеек, кроме первой. */
  pad,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaCls?: string;
  icon: React.ReactNode;
  pad?: boolean;
}) {
  return (
    <div className={pad ? "lg:pl-4" : undefined}>
      <div className="flex items-center gap-2 mb-0.5">
        {icon}
        <div className="label">{label}</div>
      </div>
      <div className="stat-num text-2xl xl:text-[28px] font-bold tabular-nums leading-tight">
        {value}
      </div>
      {delta && <div className={`text-xs mt-0.5 ${deltaCls || ""}`}>{delta}</div>}
    </div>
  );
}

/** Месяц-рекордсмен: подпись, месяц и одна поясняющая строка. */
function Record({
  label,
  icon,
  month,
  sub,
  color,
  onOpen,
}: {
  label: string;
  icon: React.ReactNode;
  month?: string;
  sub: string;
  color: string;
  onOpen: (ym: string) => void;
}) {
  const body = (
    <div className="flex items-center gap-3 min-w-0">
      <span className="shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className="label">{label}</div>
        <div className={`font-semibold leading-tight truncate ${color}`}>
          {month ? monthLabelFull(month) : "—"}
        </div>
        <div className="text-[11px] text-muted leading-tight truncate">{sub}</div>
      </div>
    </div>
  );
  if (!month) return <div className="card-tray px-4 py-2.5">{body}</div>;
  return (
    <button
      type="button"
      onClick={() => onOpen(month)}
      title="Показать операции месяца"
      className="card-tray px-4 py-2.5 text-left hover:bg-panel2/40"
    >
      {body}
    </button>
  );
}

function TopList({
  title,
  hint,
  icon,
  items,
  baseCurrency,
  total,
  barCls,
  onOpen,
}: {
  title: string;
  hint: string;
  icon: React.ReactNode;
  items: { name: string; amount: number; count: number }[];
  baseCurrency: string;
  total: number;
  barCls: string;
  onOpen: (name: string) => void;
}) {
  return (
    <SectionCard icon={icon} title={title} hint={hint}>
      {items.length === 0 ? (
        <div className="text-sm text-muted py-6 text-center">Расходов за год нет.</div>
      ) : (
        <div className="space-y-0.5">
          {items.map((item, i) => (
            <MeterRow
              key={item.name}
              rank={i + 1}
              label={item.name}
              share={total > 0 ? item.amount / total : 0}
              strong={i === 0}
              note={`${formatPct(total > 0 ? item.amount / total : 0, 0)} · ${formatNum(item.count)}`}
              value={formatMoney(item.amount, baseCurrency)}
              barCls={barCls}
              onClick={() => onOpen(item.name)}
              title="Показать операции"
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/**
 * Факт с подписью, а не фразой.
 *
 * Раньше факты были предложениями со вставленным числом — «Уникальных
 * категорий — 32», — и приходилось гадать, что это значит. Подпись отвечает
 * «что меряем», число стоит отдельно и крупно, а вторая строчка договаривает
 * то, что в подпись не влезло.
 */
function Fact({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="card-sunken px-3 py-2 flex items-start gap-2.5">
      <span className="text-accent2 shrink-0 mt-0.5">{icon}</span>
      <div className="min-w-0">
        <div className="text-[11px] text-muted leading-tight">{label}</div>
        <div className="font-semibold tabular-nums leading-tight">{value}</div>
        {sub && <div className="text-[11px] text-muted leading-tight truncate">{sub}</div>}
      </div>
    </div>
  );
}
