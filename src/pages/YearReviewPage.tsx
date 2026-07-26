import { useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  Trophy,
  Calendar,
  Award,
} from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useAnalyticsTransactions } from "../hooks/useAnalyticsTransactions";
import { useDrillStore } from "../store/useDrillStore";
import {
  buildYearReview,
  availableYears,
  type YearReview,
} from "../lib/yearReview";
import { formatMoney, formatNum, formatPct, monthLabel } from "../lib/format";
import { EmptyState } from "../components/EmptyState";

function deltaPill(value: number, invertColor = false): {
  text: string;
  cls: string;
} {
  if (Math.abs(value) < 0.01) return { text: "≈ как в прошлом", cls: "text-muted" };
  const positive = value > 0;
  const isGood = invertColor ? !positive : positive;
  const cls = isGood ? "text-income" : "text-expense";
  const sign = positive ? "+" : "";
  return { text: `${sign}${(value * 100).toFixed(0)}%`, cls };
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
  // (e.g. after a data reload). Keeps the <select> on a valid value.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (years.length && !years.includes(year)) setYear(years[0]);
  }, [years, year]);

  const review = useMemo<YearReview>(
    () => buildYearReview(analyticsTx, year),
    [analyticsTx, year]
  );

  if (transactions.length === 0) return <EmptyState />;
  if (!review.hasData) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-accent" />
          Год в цифрах
        </h1>
        <div className="card card-pad text-center text-muted py-12">
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3" data-export-skip="1">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-accent" />
            Год в цифрах: {year}
          </h1>
          <p className="text-muted text-sm mt-1">
            Итоги, рекорды и забавная статистика за выбранный год.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <YearSwitcher year={year} years={years} onChange={setYear} />
        </div>
      </div>

      <div className="space-y-6">
        {/* Hero */}
        <div className="card card-pad bg-gradient-to-br from-accent/10 to-accent2/10 border-accent/30">
          <div className="text-xs uppercase tracking-wider text-muted mb-2">
            {year} год · {formatNum(review.txCount)} операций
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            <Hero
              label="Доход"
              value={formatMoney(review.totalIncome, baseCurrency)}
              delta={review.prev.available ? incomeDelta.text : undefined}
              deltaCls={review.prev.available ? incomeDelta.cls : undefined}
              icon={<TrendingUp className="w-5 h-5 text-income" />}
            />
            <Hero
              label="Расход"
              value={formatMoney(review.totalExpense, baseCurrency)}
              delta={review.prev.available ? expenseDelta.text : undefined}
              deltaCls={review.prev.available ? expenseDelta.cls : undefined}
              icon={<TrendingDown className="w-5 h-5 text-expense" />}
            />
            <Hero
              label="Чистый поток"
              value={formatMoney(review.netFlow, baseCurrency, {
                signed: true,
              })}
              delta={review.prev.available ? netDelta.text : undefined}
              deltaCls={review.prev.available ? netDelta.cls : undefined}
              icon={<Trophy className="w-5 h-5 text-accent" />}
              hint={`Норма сбережений ${formatPct(review.savingsRate, 0)}`}
            />
          </div>
        </div>

        {/* Records */}
        <div className="grid md:grid-cols-3 gap-4">
          <Record
            label="Лучший месяц"
            value={
              review.recordMonths.bestSaving
                ? `${monthLabel(review.recordMonths.bestSaving.ym)}`
                : "—"
            }
            sub={
              review.recordMonths.bestSaving
                ? `${formatMoney(review.recordMonths.bestSaving.net, baseCurrency, { signed: true })} чистого потока`
                : ""
            }
            color="text-income"
          />
          <Record
            label="Самый расходный"
            value={
              review.recordMonths.biggestExpense
                ? `${monthLabel(review.recordMonths.biggestExpense.ym)}`
                : "—"
            }
            sub={
              review.recordMonths.biggestExpense
                ? formatMoney(review.recordMonths.biggestExpense.expense, baseCurrency)
                : ""
            }
            color="text-expense"
          />
          <Record
            label="Рекорд по доходу"
            value={
              review.recordMonths.biggestIncome
                ? `${monthLabel(review.recordMonths.biggestIncome.ym)}`
                : "—"
            }
            sub={
              review.recordMonths.biggestIncome
                ? formatMoney(review.recordMonths.biggestIncome.income, baseCurrency)
                : ""
            }
            color="text-accent"
          />
        </div>

        {/* Top categories & payees */}
        <div className="grid md:grid-cols-2 gap-4">
          <TopList
            title="Куда уходили деньги"
            icon={<Award className="w-4 h-4 text-accent" />}
            items={review.topCategories}
            baseCurrency={baseCurrency}
            total={review.totalExpense}
          />
          <TopList
            title="Любимые получатели"
            icon={<Award className="w-4 h-4 text-accent2" />}
            items={review.topPayees}
            baseCurrency={baseCurrency}
            total={review.totalExpense}
          />
        </div>

        {/* Biggest single transactions */}
        {review.topTransactions.length > 0 && (
          <div className="card card-pad">
            <div className="font-semibold mb-3 flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-expense" />
              Самые дорогие покупки
            </div>
            <div className="space-y-2">
              {review.topTransactions.map((t, i) => (
                <button
                  key={t.id}
                  onClick={() => showDrill(`Операция #${i + 1}`, [t], "Topowiec")}
                  className="w-full flex items-center gap-3 text-sm hover:bg-panel2/40 p-2 -mx-2 rounded text-left"
                >
                  <div className="text-2xl font-bold text-muted tabular-nums w-8">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{t.payee || t.categoryFull}</div>
                    <div className="text-xs text-muted truncate">
                      {t.categoryFull} · {t.date}
                    </div>
                  </div>
                  <div className="text-expense font-semibold tabular-nums">
                    {formatMoney(t.amountBase, baseCurrency)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Fun facts */}
        <div className="card card-pad">
          <div className="font-semibold mb-3 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-accent2" />
            Любопытные факты
          </div>
          <div className="grid md:grid-cols-2 gap-3 text-sm">
            <FunFact
              text={
                <>
                  В среднем тратили{" "}
                  <strong>
                    {formatMoney(review.avgPerDay, baseCurrency)}
                  </strong>{" "}
                  в день
                </>
              }
            />
            <FunFact
              text={
                <>
                  Любимый день недели для трат —{" "}
                  <strong>{review.favoriteWeekday.name}</strong> (
                  {formatMoney(review.favoriteWeekday.total, baseCurrency)}
                  )
                </>
              }
            />
            {review.longestStreak > 0 && (
              <FunFact
                text={
                  <>
                    Самая длинная серия без трат —{" "}
                    <strong>{review.longestStreak}</strong>{" "}
                    {review.longestStreak === 1 ? "день" : review.longestStreak < 5 ? "дня" : "дней"}
                  </>
                }
              />
            )}
            <FunFact
              text={
                <>
                  Уникальных получателей — <strong>{formatNum(review.uniqueMerchants)}</strong>
                </>
              }
            />
            <FunFact
              text={
                <>
                  Уникальных категорий — <strong>{formatNum(review.uniqueCategories)}</strong>
                </>
              }
            />
            {review.savingsRate > 0 && (
              <FunFact
                text={
                  <>
                    Норма сбережений за год —{" "}
                    <strong className="text-income">
                      {formatPct(review.savingsRate, 0)}
                    </strong>
                  </>
                }
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

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
    <select
      value={year}
      onChange={(e) => onChange(Number(e.target.value))}
      className="input text-sm"
    >
      {years.map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </select>
  );
}

function Hero({
  label,
  value,
  delta,
  deltaCls,
  icon,
  hint,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaCls?: string;
  icon: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <div className="label">{label}</div>
      </div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {delta && (
        <div className={`text-xs mt-1 ${deltaCls || ""}`}>
          {delta} к прошлому году
        </div>
      )}
      {hint && <div className="text-xs text-muted mt-1">{hint}</div>}
    </div>
  );
}

function Record({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div className="card card-pad">
      <div className="flex items-center gap-2 mb-1">
        <Calendar className={`w-4 h-4 ${color}`} />
        <div className="label">{label}</div>
      </div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
      <div className="text-xs text-muted">{sub}</div>
    </div>
  );
}

function TopList({
  title,
  icon,
  items,
  baseCurrency,
  total,
}: {
  title: string;
  icon: React.ReactNode;
  items: { name: string; amount: number; count: number }[];
  baseCurrency: string;
  total: number;
}) {
  return (
    <div className="card card-pad">
      <div className="font-semibold mb-3 flex items-center gap-2">
        {icon}
        {title}
      </div>
      <div className="space-y-2">
        {items.map((item, i) => {
          const pct = total > 0 ? item.amount / total : 0;
          return (
            <div key={item.name} className="flex items-center gap-3 text-sm">
              <div className="text-muted tabular-nums w-5">{i + 1}.</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <div className="truncate">{item.name}</div>
                  <div className="tabular-nums whitespace-nowrap text-muted text-xs ml-3">
                    {formatMoney(item.amount, baseCurrency)}
                  </div>
                </div>
                <div className="h-1 rounded-full overflow-hidden bg-panel2 mt-1">
                  <div
                    className="h-full bg-accent"
                    style={{ width: `${pct * 100}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FunFact({ text }: { text: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <Sparkles className="w-3.5 h-3.5 text-accent2 shrink-0 mt-1" />
      <div>{text}</div>
    </div>
  );
}
