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
  CalendarClock,
  CalendarDays,
  CalendarRange,
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
  truncateWords,
  toNum,
  chartTooltipProps,
  chartGridStroke,
  chartAxisStroke,
} from "../lib/format";
import { pluralRu } from "../lib/plural";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { MonthPicker } from "../components/MonthPicker";
import { InfoPopover, InfoTerm } from "../components/InfoPopover";
import { ChartTooltipCard, TooltipFacts, type TooltipFact } from "../components/TooltipFacts";
import { SectionCard, StatCell } from "../components/SectionCard";
import { MeterRow, MeterHead, type MeterCell } from "../components/MeterRow";

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
    // Только расходные: в списке «Куда уходили деньги» у статьи стоит сумма
    // расхода, и открывшийся список обязан складываться в неё же.
    showDrill(
      name,
      yearTx.filter((t) => affectsExpense(t.kind) && t.category === name),
      `Расходы за ${year} год`
    );
  }

  /** Квартал целиком — три месяца, а не первый из них. */
  function drillQuarter(q: number) {
    const from = `${year}-${String((q - 1) * 3 + 1).padStart(2, "0")}`;
    const to = `${year}-${String(q * 3).padStart(2, "0")}`;
    showDrill(
      `${q} квартал ${year}`,
      yearTx.filter((t) => {
        const ym = t.date.slice(0, 7);
        return ym >= from && ym <= to;
      }),
      "Год в цифрах"
    );
  }

  /** Все траты одного дня недели за год. */
  function drillWeekday(index: number, dative: string) {
    showDrill(
      `Расходы по ${dative}`,
      yearTx.filter((t) => {
        if (!affectsExpense(t.kind)) return false;
        const d = new Date(t.date);
        return !Number.isNaN(d.getTime()) && (d.getDay() + 6) % 7 === index;
      }),
      `${year} год`
    );
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
          {/* Пять чисел в ряд с разделителями. Число операций стояло мелкой
              служебной строчкой над ними, хотя это такой же итог года, как
              доход и расход, — просто не в рублях. */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-x-4 gap-y-4 divide-border lg:divide-x">
            <StatCell
              label="Доход"
              value={formatMoney(review.totalIncome, baseCurrency)}
              note={review.prev.available ? incomeDelta.text : undefined}
              noteCls={review.prev.available ? incomeDelta.cls : undefined}
              icon={<TrendingUp className="w-4 h-4" />}
              tone="income"
            />
            <StatCell
              label="Расход"
              value={formatMoney(review.totalExpense, baseCurrency)}
              note={review.prev.available ? expenseDelta.text : undefined}
              noteCls={review.prev.available ? expenseDelta.cls : undefined}
              icon={<TrendingDown className="w-4 h-4" />}
              tone="expense"
              pad
            />
            <StatCell
              label="Чистый поток"
              value={formatMoney(review.netFlow, baseCurrency, { signed: true })}
              note={review.prev.available ? netDelta.text : undefined}
              noteCls={review.prev.available ? netDelta.cls : undefined}
              icon={<Trophy className="w-4 h-4" />}
              tone={review.netFlow >= 0 ? "income" : "expense"}
              pad
            />
            <StatCell
              label="Норма сбережений"
              value={review.totalIncome > 0 ? formatPct(review.savingsRate, 0) : "—"}
              // «−290 800 ₽ остаётся» — не по-русски и не по смыслу: при
              // отрицательном потоке ничего не остаётся, его не хватило.
              note={
                review.totalIncome > 0
                  ? review.netFlow >= 0
                    ? `${formatMoney(review.netFlow, baseCurrency)} осталось`
                    : `${formatMoney(-review.netFlow, baseCurrency)} не хватило`
                  : undefined
              }
              icon={<PiggyBank className="w-4 h-4" />}
              tone={review.netFlow >= 0 ? "income" : "expense"}
              pad
            />
            <StatCell
              label="Операций"
              value={formatNum(review.txCount)}
              // Честная граница данных: иначе «за 2026 год» читается как «за
              // весь 2026», а год ещё идёт и итоги неизбежно скромнее.
              note={partial ? `данные по ${dayLabel(review.window.to)}` : "год целиком"}
              icon={<Receipt className="w-4 h-4" />}
              pad
            />
          </div>
        </div>
      </div>

      {/* Год по месяцам и профиль недели — половина ширины каждому: на широком
          мониторе двенадцать столбцов растягивались в пустое поле. */}
      <div className="grid lg:grid-cols-2 gap-3">
        <YearBars review={review} base={baseCurrency} onMonth={drillMonth} />
        <WeekProfile review={review} base={baseCurrency} onDay={drillWeekday} />
      </div>

      {/* Кварталы */}
      <Quarters review={review} base={baseCurrency} onQuarter={drillQuarter} />

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
          info={
            <p>
              Восемь статей с наибольшим расходом за год. Процент — доля во всех
              расходах, рядом число операций. Нажмите на статью — откроются её
              расходные операции за год.
            </p>
          }
          icon={<Tags className="w-4 h-4 text-accent" />}
          items={review.topCategories}
          baseCurrency={baseCurrency}
          total={review.totalExpense}
          barCls="bg-accent"
          onOpen={drillCategory}
        />
        <TopList
          title="Любимые контрагенты"
          info={
            <p>
              Имя берётся из справочника контрагентов, а не из банковской строки:
              «DOSTAVKA PYATEROCHKA» и «DOSTAVKA IZ PYATEROCHK» — это одна
              «Пятёрочка», и стоит она одной строкой с общей суммой. Строка банка
              остаётся там, где контрагент к операции не привязан.
            </p>
          }
          icon={<Users className="w-4 h-4 text-accent2" />}
          items={review.topPayees}
          baseCurrency={baseCurrency}
          total={review.totalExpense}
          barCls="bg-accent2"
          onOpen={drillCounterparty}
        />
      </div>

      {/* Покупки и факты — пара в одном ряду */}
      {/* Карточки ряда одной высоты. Плитки при этом НЕ растягиваются: лишняя
          высота уходит в промежутки между рядами плиток, а их три — прибавка
          расходится по двум зазорам и не превращается в дыру, как это было у
          сетки из двух рядов с `content-between`. */}
      <div className="grid lg:grid-cols-2 gap-3">
        <SectionCard
          icon={<Coins className="w-4 h-4 text-expense" />}
          title="Самые дорогие покупки"
          info={
            <p>
              Пять самых крупных расходных операций года. Второй строчкой —
              статья, дата и комментарий к операции, если он есть.
            </p>
          }
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
                  className="w-full flex items-start gap-2 text-sm rounded-md px-2 py-1.5 text-left hover:bg-panel2/50"
                >
                  <span className="text-[11px] text-muted tabular-nums w-4 shrink-0 leading-5">
                    {i + 1}
                  </span>
                  {/* Имя и комментарий — одной колонкой, сумма соседней: раньше
                      комментарий шёл отдельной строкой во всю ширину и заезжал
                      под сумму, обрываясь у самого края карточки. Теперь обе
                      строки кончаются там же, где начинается сумма. */}
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium truncate">
                      {counterpartyOf(t) || t.categoryFull}
                    </span>
                    {/* Часто именно в комментарии написано, ЧТО это было, —
                        «Отпуск · 3 января» само по себе не отвечает. Предел в
                        140 знаков остаётся сторожем на комментарий в три
                        абзаца, обрезает же ширина колонки. */}
                    <span className="block text-xs text-muted truncate">
                      {t.categoryFull} · {dayLabel(t.date)}
                      {truncateWords(t.comment, 140)
                        ? ` · ${truncateWords(t.comment, 140)}`
                        : ""}
                    </span>
                  </span>
                  <span className="text-expense font-semibold tabular-nums shrink-0 leading-5">
                    {formatMoney(t.amountBase, baseCurrency)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          icon={<Sparkles className="w-4 h-4 text-accent2" />}
          title="Любопытные факты"
          info={
            <p>
              Всё «подневное» считается по отрезку с данными:{" "}
              <InfoTerm>
                {dayLabel(review.window.from)} — {dayLabel(review.window.to)}
              </InfoTerm>
              , это {formatNum(review.window.days)}{" "}
              {pluralRu(review.window.days, ["день", "дня", "дней"])}. Слева от
              первой операции в вашей истории учёта ещё не было, справа у идущего
              года — будущее, и ни то ни другое не перерыв в тратах.
            </p>
          }
        >
          <div className="flex-1 grid grid-cols-2 sm:grid-cols-2 auto-rows-min content-between gap-2">
            {/* Подпись — короткое имя показателя, а не фраза: шесть разных по
                длине предложений («В среднем в день», «Средний расход на
                операцию», «Первая пятёрка статей») читались как случайный
                набор, а не как один ряд. Уточнение под числом отвечает «от
                чего» и нигде не повторяет саму подпись. */}
            <Fact
              label="Расход в день"
              value={formatMoney(review.avgPerDay, baseCurrency)}
              sub="в среднем"
            />
            <Fact
              label="Расход на операцию"
              value={formatMoney(review.avgCheck, baseCurrency)}
              sub={`в среднем по ${formatNum(review.expenseCount)}`}
            />
            <Fact
              label="Дни с тратами"
              value={`${formatNum(review.daysWithExpense)} из ${formatNum(review.window.days)}`}
              sub={
                review.window.days > 0
                  ? `${formatPct(review.daysWithExpense / review.window.days, 0)} дней с данными`
                  : undefined
              }
            />
            <Fact
              label="Перерыв без трат"
              value={
                review.longestStreak.days > 0
                  ? `${formatNum(review.longestStreak.days)} ${pluralRu(review.longestStreak.days, ["день", "дня", "дней"])}`
                  : "не было"
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
              label="Контрагенты"
              value={formatNum(review.uniqueMerchants)}
              sub="мест и людей за год"
            />
            <Fact
              label="Категории"
              value={formatNum(review.uniqueCategories)}
              sub={`первая пятёрка — ${formatPct(review.topFiveShare, 0)} расхода`}
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
    <SectionCard
      icon={<TrendingUp className="w-4 h-4 text-accent" />}
      title="Год по месяцам"
      info={
        <p>
          Доход и расход по каждому месяцу года. Нажмите на месяц — откроются
          его операции.
        </p>
      }
    >
      {/* Тянется во всю оставшуюся высоту карточки: при фиксированных 14rem
          под графиком оставалась полоса пустоты, когда соседняя карточка в
          ряду выходила выше. */}
      <div className="flex-1 min-h-[13rem]">
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
    </SectionCard>
  );
}

/* ─────────────────────  Общие примитивы страницы  ───────────────────── */



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
/** Колонки профиля недели: у дня нет числа операций, только доля и сумма. */
const WEEK_COLUMNS: MeterCell[] = [
  { text: "Доля", width: "w-11" },
  // Полной суммой, а не «490,3 тыс. ₽»: сокращение экономило десяток пикселей
  // и отнимало у числа точность там, где место под него есть.
  { text: "Расход", width: "w-28" },
];

function WeekProfile({
  review,
  base,
  onDay,
}: {
  review: YearReview;
  base: string;
  onDay: (index: number, dative: string) => void;
}) {
  const max = Math.max(...review.weekdays.map((d) => d.total), 1);
  const sum = review.weekdays.reduce((n, d) => n + d.total, 0);
  return (
    <SectionCard
      icon={<CalendarDays className="w-4 h-4 text-accent" />}
      title="Расходы по дням недели"
      info={
        <p>
          Сумма расходов за год по каждому дню недели: сразу видно, ровные у вас
          будни или всё уходит в выходные.{" "}
          {sum > 0 && <>Больше всего тратили по {review.favoriteWeekday.dative}.</>}{" "}
          Нажмите на день — откроются все траты этого дня недели за год.
        </p>
      }
    >
      <MeterHead columns={WEEK_COLUMNS} />
      <div className="flex-1 flex flex-col justify-between gap-0.5">
        {review.weekdays.map((d, i) => (
          <MeterRow
            key={d.name}
            label={d.name}
            share={d.total / max}
            strong={d.total > 0 && d.total === max}
            cells={[
              { text: sum > 0 ? formatPct(d.total / sum, 0) : "—", width: "w-11", muted: true },
              { text: formatMoney(d.total, base), width: "w-28" },
            ]}
            barCls="bg-accent"
            onClick={d.total > 0 ? () => onDay(i, d.dative) : undefined}
            title="Показать траты этого дня недели"
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
  onQuarter,
}: {
  review: YearReview;
  base: string;
  onQuarter: (q: number) => void;
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
      info={
        <p>
          Крупное число — чистый поток квартала, доход минус расход. Под ним две
          полосы: зелёная — доход, красная — расход, обе в общем на все четыре
          квартала масштабе, поэтому кварталы сравниваются взглядом. Нажмите на
          квартал — откроются его операции.
        </p>
      }
    >
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
        {review.quarters.map((q) => {
          const empty = q.income === 0 && q.expense === 0;
          return (
            <button
              key={q.q}
              type="button"
              disabled={empty}
              onClick={() => onQuarter(q.q)}
              title={empty ? "В этом квартале операций нет" : "Показать операции квартала"}
              className="card-sunken px-3 py-2.5 text-left flex flex-col enabled:hover:ring-1 enabled:hover:ring-border"
            >
              <div className="flex items-center justify-between gap-2 h-5">
                <span className="text-xs text-muted">
                  <span className="font-semibold text-text">{ROMAN[q.q - 1]}</span> квартал
                </span>
                {!empty && q.expense === peak && (
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-expense/10 text-expense">
                    пик
                  </span>
                )}
              </div>
              {/* Квартал, который ещё не наступил, — это не «ноль рублей». Три
                  нуля в столбик читались как настоящий результат, а голая
                  строчка «ещё не было» рядом с соседями смотрелась обрывом. */}
              {empty ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-1 py-3 text-muted">
                  <CalendarClock className="w-5 h-5 opacity-60" />
                  <span className="text-xs">Ещё не наступил</span>
                </div>
              ) : (
                <>
                  <div
                    className={`stat-num text-xl font-bold tabular-nums leading-tight mt-1 ${
                      q.net >= 0 ? "text-income" : "text-expense"
                    }`}
                  >
                    {formatMoney(q.net, base, { compact: true, signed: true })}
                  </div>
                  {/* Легенды сверху больше нет: у каждой полосы своя сумма тем
                      же цветом, и что зелёное, а что красное, объяснять не
                      надо. Суммы в своей колонке — цифры стоят друг под другом
                      у всех четырёх кварталов. */}
                  <div className="mt-2 space-y-1.5">
                    <QuarterBar
                      value={q.income}
                      scale={scale}
                      cls="bg-income"
                      label={formatMoney(q.income, base, { compact: true })}
                      tone="text-income"
                    />
                    <QuarterBar
                      value={q.expense}
                      scale={scale}
                      cls="bg-expense"
                      label={formatMoney(q.expense, base, { compact: true })}
                      tone="text-expense"
                    />
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

/** Одна полоса квартала с суммой. Масштаб общий на все четыре — иначе не сравнить. */
function QuarterBar({
  value,
  scale,
  cls,
  label,
  tone,
}: {
  value: number;
  scale: number;
  cls: string;
  label: string;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-panel2 overflow-hidden">
        <div
          className={`h-full rounded-full ${cls}`}
          style={{ width: `${Math.max(1.5, Math.min(100, (value / scale) * 100))}%` }}
        />
      </div>
      <span className={`text-[11px] tabular-nums whitespace-nowrap w-16 text-right ${tone}`}>
        {label}
      </span>
    </div>
  );
}

/* ─────────────────────────────  Мелочи  ───────────────────────────────── */

/**
 * Выбор года — тем же контролом, что и выбор месяца во всём остальном продукте.
 *
 * Был `Select`: год прижат влево, шеврон справа, и цифра в поле стояла не по
 * центру. У `MonthPicker` в режиме года ровно то, что нужно, — стрелки
 * перелистывания по бокам и год посередине, — и он уже знаком по другим
 * разделам. Своего контрола заводить незачем.
 */
function YearSwitcher({
  year,
  years,
  onChange,
}: {
  year: number;
  years: number[];
  onChange: (y: number) => void;
}) {
  // `years` отсортированы по убыванию: первый — самый свежий.
  const maxY = years[0] ?? year;
  const minY = years[years.length - 1] ?? year;
  return (
    <MonthPicker
      value={`${year}-01`}
      minYM={`${minY}-01`}
      maxYM={`${maxY}-12`}
      active
      mode="year"
      onSelect={(ym) => onChange(Number(ym.slice(0, 4)))}
      onSelectYear={onChange}
      onStep={(dir) => {
        const next = year + dir;
        if (next >= minY && next <= maxY) onChange(next);
      }}
    />
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

/** Колонки топов: доля, операции, сумма — ширины общие у шапки и строк. */
const TOP_COLUMNS: MeterCell[] = [
  { text: "Доля", width: "w-11" },
  { text: "Опер.", width: "w-10" },
  { text: "Сумма", width: "w-24" },
];

function TopList({
  title,
  info,
  icon,
  items,
  baseCurrency,
  total,
  barCls,
  onOpen,
}: {
  title: string;
  info: React.ReactNode;
  icon: React.ReactNode;
  items: { name: string; amount: number; count: number }[];
  baseCurrency: string;
  total: number;
  barCls: string;
  onOpen: (name: string) => void;
}) {
  return (
    <SectionCard icon={icon} title={title} info={info}>
      {items.length === 0 ? (
        <div className="text-sm text-muted py-6 text-center">Расходов за год нет.</div>
      ) : (
        <>
          <MeterHead columns={TOP_COLUMNS} />
          <div className="space-y-0.5">
            {items.map((item, i) => {
              const share = total > 0 ? item.amount / total : 0;
              return (
                <MeterRow
                  key={item.name}
                  rank={i + 1}
                  label={item.name}
                  share={share}
                  strong={i === 0}
                  cells={[
                    { text: formatPct(share, 1), width: TOP_COLUMNS[0].width, muted: true },
                    { text: formatNum(item.count), width: TOP_COLUMNS[1].width, muted: true },
                    {
                      text: formatMoney(item.amount, baseCurrency),
                      width: TOP_COLUMNS[2].width,
                    },
                  ]}
                  barCls={barCls}
                  onClick={() => onOpen(item.name)}
                  title="Показать операции"
                />
              );
            })}
          </div>
        </>
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
/**
 * Факт: плитка «имя показателя, число, уточнение».
 *
 * Пустота в этом блоке оказалась не свойством плиток, а следствием растяжки.
 * Карточка тянулась по высоте соседней, лишняя высота уходила в плитки, и они
 * распухали: содержимого на две строки, плитка на четыре. Стоило прижать
 * содержимое к ширине — пустота переезжала вниз, и наоборот.
 *
 * Поэтому карточка больше не тянется, а плиток три в ряд, а не две: при ширине
 * в треть карточки подпись, число и уточнение занимают плитку целиком в обе
 * стороны, и добирать высоту нечем — её ровно столько, сколько нужно тексту.
 */
function Fact({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="card-sunken px-3 py-2.5 min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-muted leading-tight truncate">
        {label}
      </div>
      <div className="stat-num text-xl font-bold tabular-nums leading-tight mt-1 truncate">
        {value}
      </div>
      {sub && (
        <div className="text-[11px] text-muted leading-tight truncate mt-0.5">{sub}</div>
      )}
    </div>
  );
}
