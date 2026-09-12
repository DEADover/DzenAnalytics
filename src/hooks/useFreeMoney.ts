/**
 * Данные виджета «Свободные деньги» (issue #96).
 *
 * Хук только СОБИРАЕТ; вся арифметика — в `lib/freeMoney`, под тестами. Собирать
 * приходится из сырого кэша Дзен-мани, а не из наших моделей: считаем мы по
 * правилам самого Дзен-мани (см. заголовок `lib/freeMoney`), и бюджетные строки,
 * назначенные операции и теги нужны ровно в том виде, в каком их прислал он.
 *
 * НАСТРОЙКИ ТОЖЕ ЕГО. `monthStartDay`, `planBalanceMode` и `isForecastEnabled`
 * приезжают в объекте `user` — заводить рядом свои значило бы позволить виджету
 * молча разойтись с приложением на телефоне. Своих у нас две: метод деления по
 * дням и неснижаемый остаток.
 */

import { useMemo, useSyncExternalStore } from "react";
import { peekZenCache, subscribeZenCache } from "../lib/zenCacheMemo";
import { useFreeMoneyStore } from "../store/useFreeMoneyStore";
import { useDataStore } from "../store/useDataStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { usePlannedDeletionsStore } from "../store/usePlannedDeletionsStore";
import { periodRange, spanDays } from "../lib/period";
import type { ZenCache } from "../lib/zenmoneyCache";
import type { CurrencyRates } from "../types";
import { fulfilledMarkerIds, plannedOpsByTagMonth } from "../lib/zenBudgets";
import {
  allowanceRatio,
  dailyAllowance,
  freeSpentToday,
  freeToSpend,
  moneyBreakdown,
  planRemainder,
  savedSoFar,
  spendableAccounts,
  type BalanceMode,
  type DailyAllowance,
  type DailyMethod,
  type MoneyBreakdown,
  type PlanLeft,
  type PlanRow,
  type SpendableAccount,
} from "../lib/freeMoney";

export interface FreeMoneyModel {
  /** Есть с чем работать: подключён Дзен-мани и счета известны. */
  ready: boolean;
  money: MoneyBreakdown;
  /** Остаток плана — всего и по строкам бюджета. */
  planLeft: number;
  planRows: PlanLeft[];
  /** Потрачено сверх плана: ровно на столько свободных денег стало меньше. */
  overspent: number;
  free: number;
  /** Сколько свободных было бы, если бы ни одна статья не вышла за бюджет. */
  freeTotal: number;
  allowance: DailyAllowance;
  /** Сколько положено на сегодня: лимит плюс накопленное. */
  today: number;
  /** Сколько свободных съел сегодняшний день. Минус — сегодня их прибавилось. */
  spentToday: number;
  /** Сколько из положенного на сегодня ещё цело. */
  todayLeft: number;
  /** Доля сегодняшних денег, которая ещё не потрачена, — для кольца. */
  ratio: number;
  method: DailyMethod;
  balanceMode: BalanceMode;
  daysTotal: number;
  daysLeft: number;
  periodEnd: string;
}

/** Пустая модель — виджету нечего показывать (нет Дзен-мани). */
const EMPTY: FreeMoneyModel = {
  ready: false,
  money: { balance: 0, stillToCome: 0, excluded: 0, total: 0 },
  planLeft: 0,
  planRows: [],
  overspent: 0,
  free: 0,
  freeTotal: 0,
  allowance: { perDay: 0, saved: null },
  today: 0,
  spentToday: 0,
  todayLeft: 0,
  ratio: 0,
  method: "cumulative",
  balanceMode: "excludeOpeningBalance",
  daysTotal: 1,
  daysLeft: 1,
  periodEnd: "",
};

export function useFreeMoney(
  accounts: SpendableAccount[],
  today: string
): FreeMoneyModel {
  const ownStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const method = useFreeMoneyStore((s) => s.method);
  const reserve = useFreeMoneyStore((s) => s.reserve);
  const rates = useDataStore((s) => s.rates);
  const histDayRates = useDataStore((s) => s.histDayRates);
  const plannedDeletions = usePlannedDeletionsStore((s) => s.deletions);
  const cache = useSyncExternalStore(subscribeZenCache, peekZenCache, peekZenCache);

  const mine = useMemo(() => spendableAccounts(accounts), [accounts]);

  return useMemo(() => {
    if (!cache || mine.length === 0) return EMPTY;
    const titles = new Set(mine.map((a) => a.title));
    const me = cache.user?.[0];
    // День начала месяца берём у Дзен-мани, свой — только пока его нет.
    const startDay =
      typeof me?.monthStartDay === "number" ? me.monthStartDay : ownStartDay;
    const balanceMode: BalanceMode =
      me?.planBalanceMode === "includeOpeningBalance"
        ? "includeOpeningBalance"
        : "excludeOpeningBalance";

    const ym = periodKeyOf(today, startDay);
    const range = periodRange(ym, startDay);
    const daysTotal = Math.max(1, spanDays(range.from, range.to));
    const dayIndex = Math.min(daysTotal, Math.max(1, spanDays(range.from, today)));
    const daysLeft = daysTotal - dayIndex + 1;

    const conv = converter(cache, rates);
    const ours = accountIds(cache, titles);
    const tagById = new Map((cache.tags ?? []).map((t) => [t.id, t]));
    const parents = parentLinks(tagById);

    // ── Баланс периода ────────────────────────────────────────────────────
    // «excludeOpeningBalance»: деньги, лежавшие на счетах к началу периода, в
    // расчёт не идут — только то, что пришло и ушло за него.
    let income = 0;
    let expense = 0;
    // Расход за сегодня — отдельно: по нему считается, сколько свободных денег
    // съел именно сегодняшний день (см. ниже про вчерашний срез).
    let expenseToday = 0;
    const factByTag = new Map<string, number>();
    const factYesterday = new Map<string, number>();
    for (const t of cache.transactions) {
      if (t.deleted) continue;
      if (t.date < range.from || t.date > today) continue;
      const out = t.outcome || 0;
      const inc = t.income || 0;
      if (out > 0 && inc > 0) continue; // перевод: деньги не появились и не ушли
      const isToday = t.date === today;
      if (out > 0 && ours.has(t.outcomeAccount)) {
        const v = conv(out, t.outcomeInstrument);
        expense += v;
        if (isToday) expenseToday += v;
        // Без категории — мимо плана: строки бюджета у такой траты нет, и
        // приписывать её чужой значило бы съесть чужой лимит.
        const tag = firstTag(t.tag);
        if (tag) {
          factByTag.set(tag, (factByTag.get(tag) ?? 0) + v);
          if (!isToday) factYesterday.set(tag, (factYesterday.get(tag) ?? 0) + v);
        }
      }
      if (inc > 0 && ours.has(t.incomeAccount)) {
        const v = conv(inc, t.incomeInstrument);
        income += v;
        // ВОЗВРАТ УМЕНЬШАЕТ ФАКТ КАТЕГОРИИ. Поступление с расходным тегом —
        // это вернувшиеся деньги, а не доход по статье: Дзен-мани вычитает их
        // из потраченного. У доходных категорий строки бюджета-расхода нет, и
        // вычитание там просто никуда не попадает. Проверено на «Еде дома»:
        // 6,36 ₽ возврата Ozon дают 40 909 ₽ остатка вместо 40 902.
        const tag = firstTag(t.tag);
        if (tag) {
          factByTag.set(tag, (factByTag.get(tag) ?? 0) - v);
          if (!isToday) factYesterday.set(tag, (factYesterday.get(tag) ?? 0) - v);
        }
      }
    }
    const balance =
      balanceMode === "includeOpeningBalance"
        ? mine.reduce((s, a) => s + a.balanceBase, 0)
        : income - expense;

    // ── Назначенные операции периода ──────────────────────────────────────
    // Считаем ровно тем же правилом, что и «Бюджеты», — своего здесь быть не
    // должно: план месяца один. Оттуда же и неочевидное: ИСПОЛНЕННЫЕ плановые
    // операции остаются в плане (план отвечает на «сколько собирались», а факт
    // вычитается отдельно), просроченные — нет, прогнозы Дзена — нет.
    // Проверено на живом аккаунте: «Квартира» — 21 000 ₽ бюджета плюс
    // исполненный платёж 4 000 минус 5 309 факта = 19 691 ₽, как на экране.
    const planned = plannedOpsByTagMonth(
      (cache.reminderMarkers ?? []).filter((m) => plannedDeletions[m.id] === undefined),
      cache.instruments,
      me?.currency,
      today,
      (dateIso, code) => histDayRates[dateIso]?.[code] ?? null,
      (id) => cache.instruments.find((i) => i.id === id)?.shortTitle,
      fulfilledMarkerIds(cache.transactions)
    );
    // СЧЁТ У ПЛАНОВОЙ ОПЕРАЦИИ НЕ СМОТРИМ. Проценты по вкладу приходят на
    // накопительный счёт, которого нет среди повседневных, — но деньги эти
    // ваши, и Дзен-мани их считает. Проверено: без них «ещё поступит» выходило
    // 173 100 ₽ вместо 174 600.
    const aheadOut = new Map<string, number>();
    const aheadIn = new Map<string, number>();
    for (const [key, ops] of planned) {
      const sep = key.lastIndexOf("|");
      if (key.slice(sep + 1) !== ym) continue;
      const tag = key.slice(0, sep);
      if (ops.outcome > 0) aheadOut.set(tag, (aheadOut.get(tag) ?? 0) + ops.outcome);
      if (ops.income > 0) aheadIn.set(tag, (aheadIn.get(tag) ?? 0) + ops.income);
    }

    // ── Бюджет месяца ─────────────────────────────────────────────────────
    const month = `${ym}-01`;
    const planRows: PlanRow[] = [];
    const incomePlan = new Map<string, number>();
    for (const b of cache.budgets ?? []) {
      if (b.date !== month) continue;
      // Строка без тега — это итог месяца целиком, а не категория. Дзен-мани её
      // в списке не показывает и в остаток плана не берёт; взяв, мы задваивали
      // бы весь бюджет (на живом аккаунте — лишние 120 252 ₽).
      const tag = b.tag;
      if (!tag || tag === NULL_TAG) continue;
      if ((b.outcome || 0) > 0) {
        planRows.push({
          tagId: tag,
          title: tagById.get(tag)?.title ?? "Без категории",
          plan: b.outcome,
          locked: b.outcomeLock === true,
        });
      }
      if ((b.income || 0) > 0) incomePlan.set(tag, b.income);
    }
    // Категории, у которых бюджета нет, но есть назначенные списания: без
    // строки их обязательства просто пропали бы из остатка плана.
    for (const tag of aheadOut.keys()) {
      if (planRows.some((r) => r.tagId === tag)) continue;
      planRows.push({
        tagId: tag,
        title: tagById.get(tag)?.title ?? "Без категории",
        plan: 0,
        locked: false,
      });
    }

    // «Ещё поступит» — по каждой доходной категории БОЛЬШЕЕ из назначенного и
    // запланированного, а не их сумма: назначенная зарплата и есть плановый
    // доход, а не добавка к нему. Сверено на живом аккаунте: 174 600 ₽.
    let stillToCome = 0;
    for (const tag of new Set([...incomePlan.keys(), ...aheadIn.keys()])) {
      stillToCome += Math.max(incomePlan.get(tag) ?? 0, aheadIn.get(tag) ?? 0);
    }

    const plan = planRemainder(planRows, aheadOut, factByTag, parents);
    const money = moneyBreakdown({ balance, stillToCome, excluded: reserve });
    const free = freeToSpend(money, plan.total);

    // ── Сколько свободных денег съел сегодняшний день ─────────────────────
    // Тот же остаток плана на вчерашний вечер показывает, сколько сегодняшних
    // трат план впитал; остальное ушло из свободных. Назначенные операции для
    // обоих срезов берём одни и те же: исполненная сегодня остаётся в плане и
    // разницы не создаёт — она и была запланирована.
    const planBefore = planRemainder(planRows, aheadOut, factYesterday, parents);
    const spentToday = freeSpentToday({
      expenseToday,
      planLeftBefore: planBefore.total,
      planLeftNow: plan.total,
    });

    // Лимит дня считается от свободных НА НАЧАЛО ДНЯ: сегодняшняя трата не
    // должна уменьшать сегодняшний же лимит, иначе превышение недостижимо.
    const freeAtDayStart = free + spentToday;
    const saved =
      method === "cumulative"
        ? savedSoFar({ free: freeAtDayStart, daysTotal, dayIndex })
        : 0;
    const allowance = dailyAllowance({ method, free: freeAtDayStart, daysLeft, saved });
    const todayTotal = allowance.perDay + (allowance.saved ?? 0);
    const todayLeft = todayTotal - spentToday;

    return {
      ready: true,
      money,
      planLeft: plan.total,
      planRows: plan.rows,
      overspent: plan.overspent,
      free,
      freeTotal: free + plan.overspent,
      allowance,
      // Положено на сегодня — лимит и всё накопленное: именно столько можно
      // потратить, не залезая в завтрашний день.
      today: todayTotal,
      spentToday,
      todayLeft,
      // Кольцо показывает ОДИН день: сколько из сегодняшних денег ещё цело.
      ratio: allowanceRatio(todayLeft, todayTotal),
      method,
      balanceMode,
      daysTotal,
      daysLeft,
      periodEnd: range.to,
    };
  }, [
    cache,
    mine,
    rates,
    histDayRates,
    reserve,
    method,
    ownStartDay,
    today,
    plannedDeletions,
  ]);
}

/** Период, в который попадает дата, при своём дне начала месяца. */
function periodKeyOf(iso: string, startDay: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (d >= startDay) return `${y}-${String(m).padStart(2, "0")}`;
  const prev = new Date(y, m - 2, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Итоговая строка бюджета «весь месяц» приходит с тегом из одних нулей — это не
 * категория, а сводка, и в список категорий она не идёт.
 */
const NULL_TAG = "00000000-0000-0000-0000-000000000000";

/**
 * Тег → его родитель, только по тем родителям, которые в дереве есть.
 *
 * По этим связям остаток плана и разносит траты: у под-категории своей строки
 * бюджета обычно нет, и её расход должен подняться до ближайшей строки выше.
 */
function parentLinks(
  tags: ReadonlyMap<string, { parent: string | null }>
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const [id, tag] of tags) {
    const parent = tag.parent;
    out.set(id, parent && tags.has(parent) ? parent : null);
  }
  return out;
}

/** Первый тег записи — по нему Дзен-мани и раскладывает суммы по категориям. */
function firstTag(tag: string[] | null | undefined): string {
  return tag && tag.length > 0 ? tag[0] : "";
}

/** Идентификаторы счетов, попавших в расчёт, — по названиям с главной. */
function accountIds(cache: ZenCache, titles: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const a of cache.accounts) if (titles.has(a.title)) out.add(a.id);
  return out;
}

/** Перевод суммы в базовую валюту по коду инструмента. */
function converter(cache: ZenCache, rates: CurrencyRates) {
  const code = new Map(cache.instruments.map((i) => [i.id, i.shortTitle]));
  return (amount: number, instrument: number) => {
    const cur = code.get(instrument);
    if (!cur || cur === rates.base) return amount;
    return amount * (rates.rates[cur] || 1);
  };
}
