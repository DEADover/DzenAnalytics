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
              delta={
                review.totalIncome > 0
                  ? `${formatMoney(review.netFlow, baseCurrency, { signed: true })} остаётся`
                  : undefined
              }
              deltaCls="text-muted"
              icon={<PiggyBank className="w-4 h-4 text-income" />}
              pad
            />
          </div>
        </div>
      </div>

      {/* Год по месяцам */}
      <YearBars review={review} base={baseCurrency} onMonth={drillMonth} />

      {/* Профиль недели и кварталы */}
      <div className="grid lg:grid-cols-2 gap-4">
        <WeekProfile review={review} base={baseCurrency} />
        <Quarters review={review} base={baseCurrency} onMonth={drillMonth} />
      </div>

      {/* Рекорды месяцев */}
      <div className="grid md:grid-cols-3 gap-3">
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
      <div className="grid md:grid-cols-2 gap-3">
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

      {/* Самые дорогие покупки */}
      {review.topTransactions.length > 0 && (
        <div className="card-tray px-4 py-3">
          <div className="font-semibold mb-2 flex items-center gap-2">
            <Coins className="w-4 h-4 text-expense" />
            Самые дорогие покупки
          </div>
          {/* Статья и дата встали в ту же строку серым, а не второй строчкой:
              пять покупок занимали десять строк ради двух слов на каждой. */}
          <div className="space-y-0.5">
            {review.topTransactions.map((t, i) => (
              <button
                key={t.id}
                onClick={() => showDrill(counterpartyOf(t) || t.categoryFull, [t], `${year} год`)}
                className="w-full flex items-baseline gap-2 text-sm rounded-md px-2 py-1.5 text-left hover:bg-panel2/50"
              >
                <span className="text-[11px] text-muted tabular-nums w-5 shrink-0">
                  {i + 1}
                </span>
                <span className="font-medium truncate shrink-0 max-w-[45%]">
                  {counterpartyOf(t) || t.categoryFull}
                </span>
                <span className="text-xs text-muted truncate flex-1 min-w-0">
                  {t.categoryFull} · {dayLabel(t.date)}
                </span>
                <span className="text-expense font-semibold tabular-nums shrink-0">
                  {formatMoney(t.amountBase, baseCurrency)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Любопытные факты */}
      <div className="card-tray px-4 py-3">
        <div className="font-semibold mb-1 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent2" />
          Любопытные факты
        </div>
        {/* Одной строкой снимаем главный вопрос к этому блоку: «за какой,
            собственно, срок». Без него «серия без трат» и «в среднем в день»
            читаются как утверждения про весь год. */}
        <div className="text-xs text-muted mb-2">
          Считаем по дням с данными: {dayLabel(review.window.from)} —{" "}
          {dayLabel(review.window.to)}, это {formatNum(review.window.days)}{" "}
          {pluralRu(review.window.days, ["день", "дня", "дней"])}.
        </div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2">
          <Fact
            icon={<Coins className="w-4 h-4" />}
            label="В среднем в день"
            value={formatMoney(review.avgPerDay, baseCurrency)}
          />
          <Fact
            icon={<Coins className="w-4 h-4" />}
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
            label="Самый долгий перерыв в тратах"
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
            icon={<Tags className="w-4 h-4" />}
            label="Статей в ходу"
            value={formatNum(review.uniqueCategories)}
            sub="по скольким ходили деньги"
          />
          <Fact
            icon={<Trophy className="w-4 h-4" />}
            label="Первая пятёрка статей"
            value={formatPct(review.topFiveShare, 0)}
            sub="столько занимает в расходах"
          />
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────  Год по месяцам  ─────────────────────────── */

/**
 * Двенадцать месяцев года двумя полосами.
 *
 * Помесячные суммы страница считала и раньше, но нигде не показывала: итоги
 * года стояли одним числом, и из чего они сложились, видно не было. Месяцы без
 * операций рисуем нулями — пропуск в ряду читался бы как «данных нет», а это
 * тоже ответ: в этом месяце не было ничего.
 */
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

/**
 * Профиль недели: во что расход укладывается по дням.
 *
 * Раньше от этих данных на странице оставался один факт — «любимый день
 * недели». Он отвечал, где пик, но не показывал формы: будни ровные или
 * ползут вверх к пятнице, выходные вдвое дороже или как все. Семь полос
 * занимают одну строку и отвечают на всё сразу.
 */
function WeekProfile({ review, base }: { review: YearReview; base: string }) {
  const max = Math.max(...review.weekdays.map((d) => d.total), 1);
  const sum = review.weekdays.reduce((n, d) => n + d.total, 0);
  return (
    <div className="card-tray px-4 py-3">
      <div className="font-semibold flex items-center gap-2">
        <CalendarDays className="w-4 h-4 text-accent" />
        Расходы по дням недели
      </div>
      <div className="text-xs text-muted mb-3">
        Больше всего тратили по {review.favoriteWeekday.dative}
      </div>
      <div className="flex items-end gap-1.5 h-24">
        {review.weekdays.map((d) => {
          const share = sum > 0 ? d.total / sum : 0;
          const peak = d.total > 0 && d.total === max;
          return (
            <div key={d.name} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <div className="text-[10px] text-muted tabular-nums whitespace-nowrap">
                {formatPct(share, 0)}
              </div>
              <div
                className={`w-full rounded-t ${peak ? "bg-accent" : "bg-accent/35"}`}
                style={{ height: `${Math.max(2, (d.total / max) * 100)}%` }}
                title={`${d.name}: ${formatMoney(d.total, base)}`}
              />
              <div
                className={`text-[11px] ${peak ? "text-text font-medium" : "text-muted"}`}
              >
                {d.name}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Кварталы: год четырьмя числами.
 *
 * Двенадцать столбцов графика отвечают «когда именно», но чтобы понять, какая
 * половина года вышла дороже, их приходится складывать глазами. Четыре
 * квартала с чистым потоком отвечают на это сразу.
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
  const busiest = Math.max(...review.quarters.map((q) => q.expense), 1);
  return (
    <div className="card-tray px-4 py-3">
      <div className="font-semibold flex items-center gap-2">
        <CalendarRange className="w-4 h-4 text-accent2" />
        По кварталам
      </div>
      <div className="text-xs text-muted mb-3">Доход, расход и что осталось</div>
      <div className="grid grid-cols-4 gap-2">
        {review.quarters.map((q) => {
          const empty = q.income === 0 && q.expense === 0;
          const firstMonth = `${review.year}-${String((q.q - 1) * 3 + 1).padStart(2, "0")}`;
          return (
            <button
              key={q.q}
              type="button"
              disabled={empty}
              onClick={() => onMonth(firstMonth)}
              title={empty ? "В этом квартале операций нет" : "Показать операции первого месяца"}
              className="card-sunken px-2.5 py-2 text-left disabled:opacity-45"
            >
              <div className="text-[11px] text-muted">
                {q.q} квартал
                {q.expense === busiest && !empty ? " · пик" : ""}
              </div>
              {/* Квартал, который ещё не наступил, — это не «ноль рублей».
                  Три нуля в столбик читались как настоящий результат. */}
              {empty ? (
                <div className="text-xs text-muted mt-1">ещё не было</div>
              ) : (
                <>
                  <div className="text-xs text-income tabular-nums truncate">
                    {formatMoney(q.income, base, { compact: true })}
                  </div>
                  <div className="text-xs text-expense tabular-nums truncate">
                    {formatMoney(q.expense, base, { compact: true })}
                  </div>
                  <div
                    className={`text-sm font-semibold tabular-nums truncate ${
                      q.net >= 0 ? "text-income" : "text-expense"
                    }`}
                  >
                    {formatMoney(q.net, base, { compact: true, signed: true })}
                  </div>
                </>
              )}
            </button>
          );
        })}
      </div>
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
    <>
      <div className="flex items-center gap-2">
        {icon}
        <div className="label">{label}</div>
      </div>
      <div className={`text-lg font-semibold leading-tight ${color}`}>
        {month ? monthLabelFull(month) : "—"}
      </div>
      <div className="text-xs text-muted leading-tight">{sub}</div>
    </>
  );
  if (!month) return <div className="card-tray px-4 py-3">{body}</div>;
  return (
    <button
      type="button"
      onClick={() => onOpen(month)}
      title="Показать операции месяца"
      className="card-tray px-4 py-3 text-left hover:bg-panel2/40"
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
    <div className="card-tray px-4 py-3">
      <div className="font-semibold flex items-center gap-2">
        {icon}
        {title}
      </div>
      <div className="text-xs text-muted mb-2">{hint}</div>
      {items.length === 0 ? (
        <div className="text-sm text-muted py-6 text-center">Расходов за год нет.</div>
      ) : (
        <div className="space-y-0.5">
          {items.map((item, i) => {
            const pct = total > 0 ? item.amount / total : 0;
            return (
              /* Полоса ушла ПОД строку заливкой, а не отдельной линией под
                 ней: раньше каждый пункт занимал три строки — имя, полоса,
                 проценты, — и восемь статей растягивались на пол-экрана, а
                 между именем и суммой зияла пустота во всю ширину монитора.
                 Теперь пустота и есть полоса. */
              <button
                key={item.name}
                type="button"
                onClick={() => onOpen(item.name)}
                title="Показать операции"
                className="relative w-full flex items-center gap-2 text-sm text-left rounded-md px-2 py-1.5 overflow-hidden hover:ring-1 hover:ring-border"
              >
                <span
                  aria-hidden
                  className={`absolute inset-y-0 left-0 ${barCls} opacity-[0.18] rounded-md`}
                  style={{ width: `${Math.max(1.5, Math.min(100, pct * 100))}%` }}
                />
                <span className="relative text-muted tabular-nums w-5 shrink-0 text-[11px]">
                  {i + 1}
                </span>
                <span className="relative truncate flex-1 min-w-0">{item.name}</span>
                <span className="relative text-[11px] text-muted tabular-nums whitespace-nowrap shrink-0">
                  {formatPct(pct, 0)} · {formatNum(item.count)}
                </span>
                <span className="relative tabular-nums whitespace-nowrap shrink-0 font-medium w-28 text-right">
                  {formatMoney(item.amount, baseCurrency)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
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
        {sub && <div className="text-[11px] text-muted leading-tight">{sub}</div>}
      </div>
    </div>
  );
}
