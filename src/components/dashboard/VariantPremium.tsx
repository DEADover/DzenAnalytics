/**
 * Раскладка «Премиум».
 *
 * Тот же ответ, что даёт «Сводка», но другим голосом: первый экран — разворот,
 * слева крупная типографика и одно действие, справа стопка карточек с данными.
 */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import {
  BlockTitle,
  IncomeExpenseLegend,
  CashflowBars,
  AccountsList,
  CategoriesList,
  UpcomingList,
  SpikesList,
  ActivityHeat,
} from "./blocks";
import { formatMoney } from "../../lib/format";
import type { VariantProps } from "./types";

/**
 * Поддон с двойным кантом.
 *
 * Радиус ядра — 16, а не 22: у вложенных скруглений центры дуг должны
 * совпадать, иначе на просвете в 6 px внешняя и внутренняя кривые расходятся и
 * кант выглядит кривым. 22 − 6 = 16.
 */
function Tray({ children }: { children: ReactNode }) {
  return (
    <div className="h-full flex flex-col rounded-[22px] p-1.5 bg-panel2/70 border border-border/70 shadow-tray">
      <div className="flex-1 min-h-0 flex flex-col rounded-[16px] bg-panel p-5">{children}</div>
    </div>
  );
}

/** Название месяца отдельно от года: в пилюле год только шумит. */
function monthName(ym: string): string {
  const [y, mo] = ym.split("-");
  const s = new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("ru-RU", {
    month: "long",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function daysWord(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "дней";
  switch (n % 10) {
    case 1:
      return "день";
    case 2:
    case 3:
    case 4:
      return "дня";
    default:
      return "дней";
  }
}

/**
 * Строка «ярлык — число» в колонке героя.
 *
 * Именно строкой, а не плиткой в три колонки: колонка узкая, и в трёх колонках
 * «Расход прогноз» переносился на две строки, а число рядом обрезалось.
 */
function StatRow({
  label,
  value,
  plan,
  tone,
}: {
  label: string;
  value: string;
  /** Плановая сумма месяца из «Бюджета». Стоит под фактом и не смешивается с ним. */
  plan?: string;
  tone?: "income" | "expense";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-border/60 last:border-0">
      <span className="text-[12px] uppercase tracking-[0.1em] text-muted">{label}</span>
      <span className="shrink-0 text-right">
        <span
          className={`block font-mono tabular-nums font-semibold text-[18px] ${
            tone === "income" ? "text-income" : tone === "expense" ? "text-expense" : ""
          }`}
        >
          {value}
        </span>
        {plan && (
          <span className="block text-[11.5px] text-muted font-mono tabular-nums">
            план {plan}
          </span>
        )}
      </span>
    </div>
  );
}

export function VariantPremium({ m, onMonth, onCategory, onAccount }: VariantProps) {
  const over = m.pace === null ? null : m.pace - 1;

  return (
    <div className="flex flex-col gap-5 3xl:gap-6">
      {/* ── Первый экран: разворот ── */}
      {/* Колонка героя намеренно узкая и с фиксированной шириной: её содержимое
          — короткий текст и одно число, и на широком экране растянутая половина
          экрана превращалась в пустое поле. Всё, что шире, отдано данным. */}
      <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] 3xl:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] gap-5 3xl:gap-6">
        <div className="flex flex-col gap-5 pt-2 lg:pt-4">
          {/* Пилюля — она же заголовок страницы: другого h1 на экране нет, а
              оставлять главную вовсе без заголовка нельзя. */}
          <h1 className="self-start rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] bg-panel2/80 border border-border/60 text-muted font-medium">
            {monthName(m.ym)} · осталось {m.month.left} {daysWord(m.month.left)}
          </h1>

          <div
            className={`font-mono font-semibold tabular-nums text-5xl 3xl:text-6xl leading-none tracking-tight ${
              m.free.value < 0 ? "text-expense" : ""
            }`}
            style={{ wordSpacing: "-0.22em" }}
          >
            {formatMoney(Math.abs(m.free.value), m.base)}
          </div>

          <p className="text-[16px] leading-relaxed text-muted max-w-[30ch]">
            {m.free.value < 0
              ? "Столько не хватает: расход месяца уже обогнал доход."
              : "Столько остаётся после уже потраченного и того, что ещё спишется."}
            {over !== null && (
              <>
                {" "}
                Темп на{" "}
                <span
                  className={`font-mono tabular-nums ${over >= 0 ? "text-warn" : "text-income"}`}
                >
                  {Math.abs(over * 100).toFixed(0)} %
                </span>{" "}
                {over >= 0 ? "выше" : "ниже"} обычного.
              </>
            )}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/transactions"
              className="group inline-flex items-center gap-3 rounded-full pl-6 pr-2.5 py-2.5 bg-text text-panel text-[14px] font-medium"
            >
              Разобрать месяц
              <span className="w-8 h-8 rounded-full bg-panel/20 grid place-items-center transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none">
                <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
              </span>
            </Link>
            <Link
              to="/report"
              className="rounded-full px-5 py-2.5 border border-border/70 text-muted text-[14px]"
            >
              Отчёт
            </Link>
          </div>

          <div className="mt-auto border-t border-border pt-2">
            <StatRow
              label="Доход"
              value={formatMoney(m.factIncome, m.base, { compact: true })}
              plan={
                m.planIncome !== null
                  ? formatMoney(m.planIncome, m.base, { compact: true })
                  : undefined
              }
              tone="income"
            />
            <StatRow
              label="Расход"
              value={formatMoney(m.factExpense, m.base, { compact: true })}
              plan={
                m.planExpense !== null
                  ? formatMoney(m.planExpense, m.base, { compact: true })
                  : undefined
              }
              tone="expense"
            />
            <StatRow
              label="Впереди спишется"
              value={formatMoney(m.upcomingTotalBase, m.base, { compact: true })}
            />
          </div>
        </div>

        {/* Справа стопка карточек; на широком экране она встаёт в два столбца,
            а не растягивается. */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Tray>
            <BlockTitle title="Где лежат деньги" to="/accounts"
            linkLabel="Счета"
          />
            <div
              className={`font-mono tabular-nums font-semibold text-2xl 3xl:text-3xl leading-none mb-3 ${
                m.netWorth < 0 ? "text-expense" : ""
              }`}
              style={{ wordSpacing: "-0.22em" }}
            >
              {formatMoney(m.netWorth, m.base)}
            </div>
            <AccountsList m={m} limit={6} onAccount={onAccount} />
          </Tray>

          <Tray>
            <BlockTitle
              title="Скоро спишется"
              right={
                <span className="font-mono tabular-nums font-semibold text-[15px] text-expense shrink-0">
                  {m.upcomingTotalBase > 0 ? "−" : ""}
                  {formatMoney(m.upcomingTotalBase, m.base)}
                </span>
              }
              to="/recurring"
              linkLabel="Регулярные"
            />
            <UpcomingList m={m} limit={5} />
          </Tray>
        </div>
      </section>

      {/* ── Второй экран: график и статьи ── */}
      <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-5 3xl:gap-6">
        <Tray>
          <BlockTitle
            title="Доходы и расходы"
            sub="12 месяцев · дальше прогноз"
            right={<IncomeExpenseLegend />}
            to="/cashflow"
            linkLabel="Cash-flow"
          />
          <CashflowBars m={m} onMonth={onMonth} height={260} />
        </Tray>

        <Tray>
          <BlockTitle
            title="На что уходит"
            sub="Доля от самой крупной статьи"
            to="/categories"
            linkLabel="Категории"
          />
          <CategoriesList m={m} limit={7} onCategory={onCategory} />
        </Tray>
      </section>

      {/* ── Третий ряд ── */}
      {/* Тепловая карта выигрывает от ширины — в ней 13 недель клеток, и на
          широком экране они становятся крупнее. Список всплесков наоборот:
          три строки на 1600 px превращаются в название слева и число где-то
          у другого края. Поэтому ширину забирает карта, а не список. */}
      <section className="grid grid-cols-1 lg:grid-cols-2 3xl:grid-cols-3 gap-5 3xl:gap-6">
        <div className="3xl:col-span-2">
          <Tray>
            <BlockTitle title="Активность по дням" to="/calendar"
            linkLabel="Календарь"
          />
            <ActivityHeat m={m} />
          </Tray>
        </div>

        <Tray>
          <BlockTitle title="Что разогналось" sub="Против обычного"
            to="/anomalies"
            linkLabel="Аномалии"
          />
          <SpikesList m={m} limit={5} />
        </Tray>
      </section>
    </div>
  );
}
