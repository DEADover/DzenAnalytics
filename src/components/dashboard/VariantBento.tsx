/**
 * Раскладка «Бенто» — плотная приборная панель.
 *
 * Отличие от остальных вариантов — три уровня поверхности вместо одного:
 * главная плитка с акцентной подложкой, обычные карточки и третичные блоки без
 * рамки. Глаз сразу видит, что читать первым, и не сканирует девять одинаковых
 * прямоугольников подряд.
 *
 * Широкий экран — основной сценарий, поэтому на 3xl/4xl плитки не растягиваются,
 * а перекладываются: три плитки по четыре колонки становятся четырьмя по три,
 * и вся панель умещается в два ряда без прокрутки.
 */

import {
  BlockTitle,
  IncomeExpenseLegend,
  FreeMoneyHero,
  CashflowBars,
  NetWorthArea,
  AccountsList,
  UpcomingList,
  CategoriesList,
  ActivityHeat,
  SpikesList,
} from "./blocks";
import { formatMoney, monthLabel } from "../../lib/format";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { VariantProps } from "./types";

/** Русское склонение: 1 счёт, 2 счёта, 5 счетов. */
function accountsWord(n: number): string {
  const rest100 = Math.abs(n) % 100;
  const rest10 = rest100 % 10;
  if (rest100 > 10 && rest100 < 20) return "счетов";
  if (rest10 === 1) return "счёт";
  if (rest10 > 1 && rest10 < 5) return "счёта";
  return "счетов";
}

export function VariantBento({ m, onMonth, onCategory, onAccount }: VariantProps) {
  const over = m.pace === null ? null : m.pace - 1;
  const paceText =
    over === null ? "—" : `${over >= 0 ? "+" : "−"}${Math.abs(over * 100).toFixed(0)} %`;
  const paceTone =
    over === null ? "text-muted" : over > 0 ? "text-warn" : over < 0 ? "text-income" : "text-muted";

  return (
    <div className="flex flex-col">
      {/* Полоса липкая, потому что на широком экране бенто занимает весь экран:
          без неё при прокрутке непонятно, к какому месяцу относятся числа. */}
      <div className="sticky top-[var(--app-header-h)] z-10 bg-bg border-b border-border flex items-center justify-between gap-4 py-3 mb-4">
        <div className="flex items-baseline gap-3 min-w-0">
          <h1 className="text-lg font-semibold truncate">{monthLabel(m.ym)}</h1>
          <span className="text-xs text-muted whitespace-nowrap">
            {m.month.day} из {m.month.days} дн
          </span>
        </div>
        {/* Макет будущего переключателя периода: обработчиков ещё нет. */}
        <div className="flex items-center gap-0.5 rounded-lg bg-panel2 p-0.5 text-xs shrink-0">
          <span className="px-2.5 py-1 rounded-md bg-panel font-medium">Месяц</span>
          <span className="px-2.5 py-1 rounded-md text-muted">Квартал</span>
          <span className="px-2.5 py-1 rounded-md text-muted">Год</span>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 3xl:gap-3">
        {/* ── Главная плитка: единственная с акцентной подложкой ── */}
        <section className="col-span-12 lg:col-span-5 3xl:col-span-4 4xl:col-span-3 card card-pad border-accent/30 bg-gradient-to-b from-accent/[0.07] to-transparent flex flex-col">
          <FreeMoneyHero m={m} size="lg" />
          <div className="mt-auto pt-4 border-t border-border grid grid-cols-3 gap-3">
            <div className="min-w-0">
              <div className="label">Доход</div>
              <div className="mt-1 font-mono tabular-nums font-semibold text-[15px] text-income">
                {formatMoney(m.factIncome, m.base, { compact: true })}
              </div>
              {m.planIncome !== null && (
                <div className="text-[11.5px] text-muted font-mono tabular-nums">
                  план {formatMoney(m.planIncome, m.base, { compact: true })}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="label">Расход</div>
              <div className="mt-1 font-mono tabular-nums font-semibold text-[15px] text-expense">
                {formatMoney(m.factExpense, m.base, { compact: true })}
              </div>
              {m.planExpense !== null && (
                <div className="text-[11.5px] text-muted font-mono tabular-nums">
                  план {formatMoney(m.planExpense, m.base, { compact: true })}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="label">Темп</div>
              <div className={`mt-1 font-mono tabular-nums font-semibold text-[15px] ${paceTone}`}>
                {paceText}
              </div>
            </div>
          </div>
        </section>

        {/* ── Денежный поток ── */}
        <section className="col-span-12 lg:col-span-7 3xl:col-span-5 4xl:col-span-4 card card-pad flex flex-col">
          <BlockTitle
            title="Доходы и расходы"
            sub="12 месяцев + прогноз"
            right={<IncomeExpenseLegend />}
            to="/cashflow"
            linkLabel="Cash-flow"
          />
          <div className="flex-1 min-h-0">
            <CashflowBars m={m} height={228} onMonth={onMonth} />
          </div>
        </section>

        {/* ── Совокупный баланс ── */}
        <section className="col-span-12 lg:col-span-4 3xl:col-span-3 4xl:col-span-2 card card-pad flex flex-col">
          <div className="flex items-start justify-between gap-3">
            <div className="label">Совокупный баланс</div>
            <Link
              to="/accounts"
              className="text-xs text-accent hover:underline flex items-center gap-1 shrink-0"
            >
              Счета <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="stat-num mt-1.5 3xl:text-3xl">{formatMoney(m.netWorth, m.base)}</div>
          <div className="mt-2 -mx-1">
            <NetWorthArea m={m} height={120} />
          </div>
          <div className="mt-auto pt-2 text-[11.5px] text-muted">
            Всего {m.accounts.length} {accountsWord(m.accounts.length)}
            {m.savings > 0 && (
              <> · Накопления {formatMoney(m.savings, m.base, { compact: true })}</>
            )}
          </div>
        </section>

        {/* ── Счета ── */}
        <section className="col-span-12 lg:col-span-4 3xl:col-span-3 4xl:col-span-3 card card-pad flex flex-col">
          <BlockTitle title="Где лежат деньги" to="/accounts"
            linkLabel="Счета"
          />
          <AccountsList m={m} limit={5} onAccount={onAccount} />
        </section>

        {/* ── Предстоящие списания ── */}
        <section className="col-span-12 lg:col-span-4 3xl:col-span-3 4xl:col-span-3 card card-pad flex flex-col">
          <BlockTitle
            title="Скоро спишется"
            right={
              <span className="font-mono tabular-nums text-[13px] font-semibold text-expense shrink-0">
                −{formatMoney(m.upcomingTotalBase, m.base)}
              </span>
            }
            to="/recurring"
            linkLabel="Регулярные"
          />
          <UpcomingList m={m} limit={5} />
        </section>

        {/* ── Категории ── */}
        <section className="col-span-12 lg:col-span-7 3xl:col-span-3 4xl:col-span-5 card card-pad flex flex-col">
          <BlockTitle title="На что уходит" sub={monthLabel(m.ym)} to="/categories"
            linkLabel="Категории"
          />
          <CategoriesList m={m} limit={8} onCategory={onCategory} />
        </section>

        {/* ── Активность + третичный блок «Что разогналось» ── */}
        <section className="col-span-12 lg:col-span-5 3xl:col-span-3 4xl:col-span-4 card card-pad flex flex-col">
          <BlockTitle title="Активность за 90 дней" to="/calendar"
            linkLabel="Календарь"
          />
          <div className="overflow-x-auto">
            <ActivityHeat m={m} />
          </div>
          <div className="mt-4 pt-4 border-t border-border">
            <div className="bg-panel2 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 mb-2.5">
                <div className="label">Что разогналось</div>
                <Link
                  to="/anomalies"
                  className="text-xs text-accent hover:underline flex items-center gap-1 shrink-0"
                >
                  Аномалии <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
              <SpikesList m={m} limit={3} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
