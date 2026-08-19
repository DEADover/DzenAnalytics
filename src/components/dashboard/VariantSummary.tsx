/**
 * Главная в раскладке «Сводка месяца».
 *
 * Страница отвечает на один вопрос — «как я иду в этом месяце». Поэтому она
 * читается сверху вниз одной колонкой смысла: сколько свободно → чем это
 * обеспечено → куда уходит → что впереди. Разделы отбиты воздухом и
 * `SectionLabel`, а не рамками: карточка вокруг каждого блока превращает
 * связный рассказ в набор непохожих плиток.
 *
 * На широких мониторах колонок становится БОЛЬШЕ, а не шире: строка
 * «счёт слева — баланс справа» на 1200 px заставляет глаз ехать через полэкрана
 * и места при этом не экономит.
 */

import {
  SectionLabel,
  BlockTitle,
  IncomeExpenseLegend,
  FreeMoneyHero,
  PaceRing,
  CashflowBars,
  NetWorthArea,
  AccountsList,
  CategoriesList,
  UpcomingList,
  ObservationsList,
  ActivityHeat,
} from "./blocks";
import { formatMoney, monthLabel } from "../../lib/format";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { VariantProps } from "./types";

/** Русская форма слова по числу: «1 счёт», «2 счёта», «5 счетов». */
function plural(n: number, forms: [string, string, string]): string {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

export function VariantSummary({ m, onMonth, onCategory, onAccount }: VariantProps) {
  const label = monthLabel(m.ym);
  const progressPct = Math.round(m.month.progress * 100);

  return (
    <div className="flex flex-col gap-8 3xl:gap-10">
      {/* ── Контекст: какой это месяц и насколько он прожит ── */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border pb-4">
        <h1 className="text-2xl 3xl:text-3xl font-semibold tracking-tight">{label}</h1>
        <span className="text-[13px] text-muted">
          {m.month.day}-й день из {m.month.days} · месяц пройден на {progressPct} %
        </span>
      </div>

      {/* ── Герой: свободные деньги и темп, которым мы к ним идём ── */}
      <div className="grid gap-5 items-start lg:grid-cols-[minmax(0,1fr)_260px]">
        <FreeMoneyHero m={m} size="xl" />
        {/* Правой колонке задана фикс. ширина: кольцу лишние пиксели не нужны,
            на широком экране всё место должно доставаться герою. */}
        <div className="card card-pad">
          <PaceRing m={m} />
        </div>
      </div>

      {/* ── Три опорных числа месяца: без карточек, отбиты линиями ──
          Каждое — ссылка в раздел, где то же число можно разобрать. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 border-t border-b border-border">
        <Link
          to="/accounts"
          className="group py-4 sm:pr-6 transition-colors hover:bg-panel2/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-lg"
        >
          <div className="flex items-center justify-between gap-2 pr-1">
            <span className="label">Совокупный баланс</span>
            <ArrowRight className="w-3.5 h-3.5 text-muted group-hover:text-accent shrink-0" />
          </div>
          <div className="stat-num mt-1.5">{formatMoney(m.netWorth, m.base)}</div>
          <div className="text-[11.5px] text-muted mt-1">
            {m.accounts.length} {plural(m.accounts.length, ["счёт", "счёта", "счетов"])}
          </div>
        </Link>

        <Link
          to="/cashflow"
          className="group py-4 border-t border-border sm:border-t-0 sm:border-l sm:px-6 transition-colors hover:bg-panel2/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="label">Доход</span>
            <ArrowRight className="w-3.5 h-3.5 text-muted group-hover:text-accent shrink-0" />
          </div>
          <div className="stat-num mt-1.5 text-income">{formatMoney(m.factIncome, m.base)}</div>
          <div className="text-[11.5px] text-muted mt-1">
            {m.planIncome !== null ? (
              <>
                План{" "}
                <span className="font-mono tabular-nums">{formatMoney(m.planIncome, m.base)}</span>
              </>
            ) : (
              "Факт с начала месяца"
            )}
          </div>
        </Link>

        <Link
          to="/cashflow"
          className="group py-4 border-t border-border sm:border-t-0 sm:border-l sm:px-6 transition-colors hover:bg-panel2/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="label">Расход</span>
            <ArrowRight className="w-3.5 h-3.5 text-muted group-hover:text-accent shrink-0" />
          </div>
          <div className="stat-num mt-1.5 text-expense">{formatMoney(m.factExpense, m.base)}</div>
          <div className="text-[11.5px] text-muted mt-1">
            {m.planExpense !== null ? (
              <>
                План{" "}
                <span className="font-mono tabular-nums">{formatMoney(m.planExpense, m.base)}</span>
              </>
            ) : m.month.running ? (
              <>
                К концу месяца{" "}
                <span className="font-mono tabular-nums">{formatMoney(m.projExpense, m.base)}</span>
              </>
            ) : (
              "Месяц закрыт"
            )}
          </div>
        </Link>
      </div>

      {/* ── Деньги: откуда приходят, где лежат, как копятся ── */}
      <section className="flex flex-col gap-5">
        <SectionLabel>Деньги</SectionLabel>
        <div className="grid gap-6 3xl:gap-8 items-start lg:grid-cols-[1.6fr_1fr] 3xl:grid-cols-[1.6fr_1fr_1.2fr]">
          <div className="min-w-0">
            <BlockTitle
              title="Доходы и расходы по месяцам"
              sub="12 месяцев · дальше прогноз по среднему"
              right={<IncomeExpenseLegend />}
              to="/cashflow"
              linkLabel="Cash-flow"
            />
            <CashflowBars m={m} onMonth={onMonth} />
          </div>
          <div className="min-w-0">
            <BlockTitle title="Где лежат деньги" to="/accounts"
            linkLabel="Счета"
          />
            <AccountsList m={m} onAccount={onAccount} />
          </div>
          {/* Третья колонка появляется только там, где под неё есть ширина:
              ужатый до 300 px график баланса не читается вовсе. */}
          <div className="min-w-0 hidden 3xl:block">
            <BlockTitle title="Как рос баланс"
            to="/accounts"
            linkLabel="Счета"
          />
            <NetWorthArea m={m} />
          </div>
        </div>
      </section>

      {/* ── Месяц: на что уходит и что ещё спишется ── */}
      <section className="flex flex-col gap-5">
        <SectionLabel>Месяц</SectionLabel>
        <div className="grid gap-6 3xl:gap-8 items-start md:grid-cols-2 3xl:grid-cols-3">
          {/* min-h держит ряд цельным, когда список пуст: пустое состояние
              занимает пару строк, и без опоры соседний блок повисал бы один. */}
          <div className="min-w-0">
            <BlockTitle
              title="На что уходит"
              sub="Доля от самой крупной статьи"
              to="/categories"
            linkLabel="Категории"
          />
            <div className="min-h-[200px]">
              <CategoriesList m={m} onCategory={onCategory} />
            </div>
          </div>
          <div className="min-w-0">
            <BlockTitle
              title="Что предстоит"
              sub="Регулярные до конца месяца"
              right={
                m.upcomingTotalBase > 0 ? (
                  <span className="font-mono tabular-nums font-semibold text-[15px] text-expense shrink-0">
                    −{formatMoney(m.upcomingTotalBase, m.base)}
                  </span>
                ) : undefined
              }
              to="/recurring"
              linkLabel="Регулярные"
            />
            <div className="min-h-[200px]">
              <UpcomingList m={m} />
            </div>
          </div>
          <div className="min-w-0 hidden 3xl:block">
            <BlockTitle title="Активность по дням" to="/calendar"
            linkLabel="Календарь"
          />
            <div className="min-h-[200px]">
              <ActivityHeat m={m} />
            </div>
          </div>
        </div>
      </section>

      {/* ── Что заметно: единственный блок с выводом, а не с данными ── */}
      <section className="flex flex-col gap-5">
        <SectionLabel>Что заметно</SectionLabel>
        <div className="max-w-[92ch]">
          <BlockTitle
            title="Что заметно"
            sub="Против обычного за последние месяцы"
            to="/anomalies"
            linkLabel="Аномалии"
          />
          <ObservationsList m={m} />
        </div>
      </section>
    </div>
  );
}
