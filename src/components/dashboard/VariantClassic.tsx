/**
 * Раскладка «Эволюция» — привычный порядок блоков старой главной, но
 * вычищенный.
 *
 * Что именно чинится по сравнению со старой главной:
 *   • верхние плитки больше не сравнивают неполный месяц с полным («↓ 58 %»
 *     восемнадцатого числа) — вместо процента к прошлому месяцу показываем
 *     прогноз до конца текущего;
 *   • шесть плиток наблюдений схлопнуты в два блока — раньше они занимали
 *     целый экран ниже сгиба;
 *   • четыре плитки-ссылки внизу удалены: они дублировали верхнее меню.
 */

import { formatMoney, monthLabel } from "../../lib/format";
import { Stat } from "../Stat";
import {
  SectionLabel,
  BlockTitle,
  IncomeExpenseLegend,
  CashflowBars,
  NetWorthArea,
  AccountsList,
  CategoriesList,
  UpcomingList,
  SpikesList,
  ActivityHeat,
} from "./blocks";
import type { VariantProps } from "./types";

function accountsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "счёт";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "счёта";
  return "счетов";
}

export function VariantClassic({ m, onMonth, onCategory, onAccount }: VariantProps) {
  const ml = monthLabel(m.ym);
  const nw = m.needsWants;
  // «Обязательное и свободное» считается по последнему ЗАВЕРШЁННОМУ месяцу —
  // повторяем тот же отбор, что и модель, чтобы подписать блок его месяцем.
  const lastCompleteYM = m.months.filter((b) => b.ym < m.ym).slice(-1)[0]?.ym;

  // Доли считаются от дохода: при перерасходе их сумма выходит за 100 %,
  // поэтому вторую полосу обрезаем по остатку, иначе она вылезет из дорожки.
  const needsW = nw ? Math.max(0, Math.min(100, nw.needsPct * 100)) : 0;
  const wantsW = nw ? Math.max(0, Math.min(100 - needsW, nw.wantsPct * 100)) : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold">Главная</h1>
        <span className="text-sm text-muted">
          {ml} · {m.month.day}-й день из {m.month.days}
        </span>
      </div>

      {/* ── Сейчас ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <SectionLabel>Сейчас</SectionLabel>
        {/* На 4xl колонок остаётся четыре, но ширину ряда ограничиваем: иначе
            плитка растягивается на полэкрана, а число в ней остаётся прежним. */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 4xl:grid-cols-4 4xl:max-w-[1720px]">
          <Stat
            label="Совокупный баланс"
            value={formatMoney(m.netWorth, m.base)}
            hint={`${m.accounts.length} ${accountsWord(m.accounts.length)}`}
          />
          <Stat
            label={`Доход · ${ml}`}
            value={formatMoney(m.factIncome, m.base)}
            tone="income"
            hint={`Прогноз месяца ${formatMoney(m.projIncome, m.base)}`}
          />
          <Stat
            label={`Расход · ${ml}`}
            value={formatMoney(m.factExpense, m.base)}
            tone="expense"
            hint={`Прогноз месяца ${formatMoney(m.projExpense, m.base)}`}
          />
          <Stat
            label="Свободно до конца месяца"
            value={formatMoney(m.free.value, m.base)}
            tone={m.free.value < 0 ? "expense" : "default"}
            hint={`Обязательных впереди ${formatMoney(m.upcomingTotalBase, m.base)}`}
          />
        </div>
      </div>

      {/* ── Деньги ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <SectionLabel>Деньги</SectionLabel>
        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <div className="card card-pad min-w-0">
            <BlockTitle
              title="Доходы и расходы по месяцам"
              sub="12 месяцев · дальше прогноз по среднему"
              right={<IncomeExpenseLegend />}
            />
            <CashflowBars m={m} onMonth={onMonth} />
          </div>
          <div className="card card-pad min-w-0">
            <BlockTitle title="Как рос баланс" sub="Все счета" to="/accounts" />
            <NetWorthArea m={m} />
          </div>
        </div>
      </div>

      {/* ── Месяц ──────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <SectionLabel>Месяц</SectionLabel>
        {/* Четыре списка одной сеткой: на обычном экране это две привычные пары
            подряд, на 3xl они разворачиваются в один ряд из четырёх колонок —
            список «слева название, справа сумма» на 1200 px нечитаем. */}
        <div className="grid gap-4 lg:grid-cols-2 3xl:grid-cols-4">
          <div className="card card-pad min-w-0">
            <BlockTitle title="Где лежат деньги" to="/accounts" />
            <AccountsList m={m} onAccount={onAccount} />
          </div>
          <div className="card card-pad min-w-0">
            <BlockTitle
              title="На что уходит"
              sub="Доля от самой крупной статьи"
              to="/categories"
            />
            <CategoriesList m={m} onCategory={onCategory} />
          </div>
          <div className="card card-pad min-w-0">
            <BlockTitle
              title="Скоро спишется"
              right={
                <span className="font-mono tabular-nums text-[13px] font-semibold text-expense shrink-0">
                  −{formatMoney(m.upcomingTotalBase, m.base)}
                </span>
              }
            />
            <UpcomingList m={m} />
          </div>
          <div className="card card-pad min-w-0">
            <BlockTitle title="Активность за 90 дней" to="/calendar" />
            <ActivityHeat m={m} />
          </div>
        </div>
      </div>

      {/* ── Что заметно ────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <SectionLabel>Что заметно</SectionLabel>
        <div className={`grid gap-4 ${nw ? "lg:grid-cols-2 3xl:grid-cols-3" : ""}`}>
          <div className="bg-panel2 rounded-xl p-4 min-w-0">
            <BlockTitle title="Что разогналось" />
            <SpikesList m={m} />
          </div>
          {nw && (
            <div className="bg-panel2 rounded-xl p-4 min-w-0">
              <BlockTitle
                title="Обязательное и свободное"
                sub={
                  lastCompleteYM
                    ? `За ${monthLabel(lastCompleteYM)} — последний завершённый месяц`
                    : "За последний завершённый месяц"
                }
              />
              <div className="h-2.5 rounded-full bg-panel relative overflow-hidden">
                <i
                  className="absolute inset-y-0 left-0 bg-warn rounded-l-full"
                  style={{ width: `${needsW}%` }}
                />
                <i
                  className="absolute inset-y-0 bg-accent2"
                  style={{ left: `${needsW}%`, width: `${wantsW}%` }}
                />
              </div>
              <div className="grid grid-cols-3 gap-3 mt-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
                    <i className="w-2.5 h-2.5 rounded-sm bg-warn block shrink-0" />
                    <span className="truncate">Обязательное</span>
                  </div>
                  <div className="font-mono tabular-nums font-semibold text-[13px] mt-0.5">
                    {formatMoney(nw.needs, m.base)}
                  </div>
                  <div className="text-[11px] text-muted">
                    {Math.round(nw.needsPct * 100)} % дохода
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
                    <i className="w-2.5 h-2.5 rounded-sm bg-accent2 block shrink-0" />
                    <span className="truncate">Свободное</span>
                  </div>
                  <div className="font-mono tabular-nums font-semibold text-[13px] mt-0.5">
                    {formatMoney(nw.wants, m.base)}
                  </div>
                  <div className="text-[11px] text-muted">
                    {Math.round(nw.wantsPct * 100)} % дохода
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
                    <i className="w-2.5 h-2.5 rounded-sm bg-panel border border-border block shrink-0" />
                    <span className="truncate">Осталось</span>
                  </div>
                  <div
                    className={`font-mono tabular-nums font-semibold text-[13px] mt-0.5 ${
                      nw.savings < 0 ? "text-expense" : ""
                    }`}
                  >
                    {formatMoney(nw.savings, m.base)}
                  </div>
                  <div className="text-[11px] text-muted">
                    {Math.round(nw.savingsPct * 100)} % дохода
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
