/**
 * Главная страница.
 *
 * Экран собран из виджетов, и собирает его сам человек: порядок, ширина и
 * состав хранятся в `useDashboardLayoutStore`, а страница их только
 * раскладывает. Отсюда и устройство файла — сначала содержимое каждого виджета,
 * потом одна сетка, которая проходит по сохранённой раскладке.
 *
 * Сетка одна на всю страницу, в три колонки; виджет занимает треть, две трети
 * или всю ширину. Других размеров нет намеренно: при любых трёх размерах
 * перестановка складывается в ровные ряды, а при произвольных пропорциях
 * остаются дыры.
 *
 * Модель считается здесь один раз и раздаётся блокам; переходы (открыть
 * операции месяца, категории, счёта) тоже живут здесь — сами блоки не должны
 * знать ни про хранилища, ни про то, как открывается drawer.
 */

import { MONTHS_IN } from "../../lib/months";
import { useMemo, type ReactNode } from "react";
import { BlockTitle } from "./blocks/shared";
import { MonthHero } from "./blocks/monthHero";
import { CashflowBars } from "./blocks/cashflow";
import { CapitalBlock } from "./blocks/capital";
import { AccountsBlock, CategoriesList, ObservationsList, UpcomingList, ZenPlannedList } from "./blocks/lists";
import { ActivityHeat } from "./blocks/activity";
import { MonthOverMonthBlock } from "./blocks/monthOverMonth";
import { FreeMoneyBlock, FreeMoneyCompactBlock } from "./blocks/freeMoney";
import { LinksRow } from "./LinksRow";
import { WidgetBoard } from "./WidgetBoard";
import {
  widgetMeta,
  widgetView,
  type WidgetPlacement,
} from "../../lib/dashboardLayout";
import { useDashboardLayoutStore } from "../../store/useDashboardLayoutStore";
import {
  formatMoney,
  monthTitle,
  dayTitle,
} from "../../lib/format";
import { localToday } from "../../lib/period";
import { useDashboardModel } from "../../hooks/useDashboardModel";
import { useAnalyticsTransactions } from "../../hooks/useAnalyticsTransactions";
import { useZenPlanned } from "../../hooks/useZenPlanned";
import { useFreeMoney } from "../../hooks/useFreeMoney";
import { usePlannedDeletionsStore } from "../../store/usePlannedDeletionsStore";
import { useDrillStore } from "../../store/useDrillStore";
import { useCategoryMetaStore } from "../../store/useCategoryMetaStore";
import { CategorySunburst } from "../CategorySunburst";
import { buildHierarchy } from "../../lib/aggregations";
import { useReportPeriodStore } from "../../store/useReportPeriodStore";
import { periodKey, shiftPeriod } from "../../lib/period";
import { monthOverMonth } from "../../lib/monthOverMonth";
import { monthEnd } from "../../lib/dashboardModel";
import { affectsExpense } from "../../lib/txKindStyle";
import { txAccountKey, txInKey, txOutKey } from "../../lib/accountKey";

/**
 * Итог «Запланированных операций»: расход и приход одной строкой.
 *
 * Два числа рядом, а не одно: складывать их значило бы придумать «чистый
 * остаток», а каждое здесь отвечает за свои строки списка. Знак и цвет
 * повторяют строки, поэтому разбираться, что есть что, не нужно.
 *
 * Разделитель ставится только между двумя числами. Если ожидается что-то одно,
 * точка посреди пустоты читалась бы как потерянное второе слагаемое.
 */
function PlannedTotals({ out, income, base }: { out: number; income: number; base: string }) {
  const hasOut = out > 0;
  const hasIn = income > 0;
  const big = "font-mono tabular-nums font-semibold text-2xl 3xl:text-3xl leading-none";
  return (
    <div
      className="flex items-baseline gap-2 flex-wrap pb-3 mb-1 border-b border-border"
      style={{ wordSpacing: "-0.22em" }}
    >
      {/* Ничего не ожидается — показываем ноль без знака: подписывать плюсом
          или минусом нечего. */}
      {!hasOut && !hasIn && <span className={`${big} text-muted`}>{formatMoney(0, base)}</span>}
      {hasOut && <span className={`${big} text-expense`}>−{formatMoney(out, base)}</span>}
      {hasOut && hasIn && (
        <span className="w-px h-5 bg-border shrink-0 self-center" aria-hidden="true" />
      )}
      {hasIn && <span className={`${big} text-income`}>+{formatMoney(income, base)}</span>}
    </div>
  );
}

/** Месяцы в предложном падеже: «в январе», «в марте», «в августе». */

export function DashboardView() {
  const m = useDashboardModel();
  const transactions = useAnalyticsTransactions();
  const showDrill = useDrillStore((s) => s.show);
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const categoryMeta = useCategoryMetaStore((s) => s.meta);

  // «Сегодня» — последняя дата С ДАННЫМИ, а не системная: по обрезанной
  // истории часы дали бы пустой хвост окна и заниженное сравнение.
  const lastDate = useMemo(
    () => transactions.reduce((mx, t) => (t.date > mx ? t.date : mx), ""),
    [transactions]
  );
  const mom = useMemo(
    () => monthOverMonth(transactions, m.ym, monthStartDay, lastDate || monthEnd(m.ym, monthStartDay)),
    [transactions, m.ym, monthStartDay, lastDate]
  );
  /**
   * «в июле» — название прошлого месяца в ПРЕДЛОЖНОМ падеже.
   *
   * Своим списком, а не через `toLocaleDateString`: тот отдаёт именительный
   * («июль»), и подпись читалась «В июль за те же 28 дней».
   */
  const prevMonthLabel = useMemo(() => {
    const mo = Number(shiftPeriod(m.ym, -1).slice(5, 7));
    return MONTHS_IN[mo - 1] ?? "";
  }, [m.ym]);

  const editing = useDashboardLayoutStore((s) => s.editing);
  const setLinks = useDashboardLayoutStore((s) => s.setLinks);
  const setOffBalance = useDashboardLayoutStore((s) => s.setOffBalance);

  // Планы Дзен-мани — второй вид «Запланированных платежей». Отрезок тот же,
  // что у своих регулярных: от сегодня до конца отчётного месяца.
  const todayIso = localToday();
  // С просроченными: платёж, который прошляпили, — главное, что виджет обязан
  // показать (issue #87).
  const zenPlannedAll = useZenPlanned(todayIso, monthEnd(m.ym, m.monthStartDay), true);
  // Просроченные, снятые вручную и ещё не уехавшие в облако, на главной не
  // показываем вовсе: на «Регулярных» они висят зачёркнутыми, чтобы правку
  // можно было откатить, а здесь это был бы шум.
  const plannedDeletions = usePlannedDeletionsStore((st) => st.deletions);
  // Переводы не показываем: перекладывание между своими счетами ни спишется, ни
  // придёт. Расход и доход считаем врозь — складывать их в одно число значило
  // бы придумать «чистый остаток», которого в этом виджете никто не просил.
  const zenPlanned = useMemo(
    () =>
      zenPlannedAll?.filter(
        (p) => p.kind !== "transfer" && plannedDeletions[p.id] === undefined
      ) ?? null,
    [zenPlannedAll, plannedDeletions]
  );
  const zenPlannedOut = useMemo(
    () =>
      (zenPlanned ?? [])
        .filter((p) => p.kind === "expense")
        .reduce((sum, p) => sum + p.amountBase, 0),
    [zenPlanned]
  );
  const zenPlannedIn = useMemo(
    () =>
      (zenPlanned ?? [])
        .filter((p) => p.kind === "income")
        .reduce((sum, p) => sum + p.amountBase, 0),
    [zenPlanned]
  );

  // Свободные деньги (#96). Счета отдаём из модели — они там уже приведены к
  // базовой валюте и помечены архивом/внебалансом; остальное хук берёт сам.
  const freeMoney = useFreeMoney(m.accounts, todayIso);

  // Кольца статей: те же деревья, что на «Категориях», только за текущий месяц.
  const monthTx = useMemo(
    () => transactions.filter((t) => periodKey(t.date, monthStartDay) === m.ym),
    [transactions, monthStartDay, m.ym]
  );
  const donutExpense = useMemo(() => buildHierarchy(monthTx, "expense"), [monthTx]);
  const donutIncome = useMemo(() => buildHierarchy(monthTx, "income"), [monthTx]);

  /**
   * Открыть список операций статьи или подстатьи — за ТЕКУЩИЙ месяц.
   *
   * Виджеты главной все про этот месяц: и доли в кольце, и суммы в списке
   * статей посчитаны по нему. Открывать по ним сквозную историю значило бы
   * показать другие числа, чем те, по которым кликнули.
   */
  const drillCategory = useMemo(() => {
    const match = (kind: "expense" | "income", t: (typeof transactions)[number]) =>
      kind === "expense" ? affectsExpense(t.kind) : t.kind === "income";
    return (kind: "expense" | "income", name: string, full = false) =>
      showDrill(
        `${name} · ${monthTitle(m.ym)}`,
        monthTx.filter(
          (t) => match(kind, t) && (full ? t.categoryFull === name : t.category === name)
        ),
        kind === "expense" ? "Расходы по статье" : "Доходы по статье"
      );
  }, [monthTx, showDrill, m.ym]);

  const { onMonth, onCategory, onAccount, onDay } = useMemo(
    () => ({
      // По столбцу — только доходы или только расходы месяца (расходы — с
      // возвратами: они уменьшили высоту столбца); мимо столбцов — весь месяц.
      onMonth: (ym: string, kind?: "income" | "expense") => {
        const inMonth = transactions.filter((t) => periodKey(t.date, monthStartDay) === ym);
        if (!kind) return showDrill(monthTitle(ym), inMonth, "Месяц");
        return kind === "income"
          ? showDrill(`Доходы · ${monthTitle(ym)}`, inMonth.filter((t) => t.kind === "income"), "Доходы месяца")
          : showDrill(`Расходы · ${monthTitle(ym)}`, inMonth.filter((t) => affectsExpense(t.kind)), "Расходы месяца");
      },
      // Возвраты тоже берём: именно они уменьшили ту сумму, по которой кликнули.
      // Тоже за текущий месяц: проценты в виджете считаны по нему.
      onCategory: (name: string) =>
        showDrill(
          `${name} · ${monthTitle(m.ym)}`,
          monthTx.filter((t) => affectsExpense(t.kind) && t.category === name),
          "Расходы по категории"
        ),
      onDay: (date: string) =>
        showDrill(
          dayTitle(date),
          transactions.filter((t) => t.date.slice(0, 10) === date),
          "Операции за день"
        ),
      onAccount: (key: string, label: string) =>
        showDrill(
          label,
          transactions.filter(
            (t) => txAccountKey(t) === key || txOutKey(t) === key || txInKey(t) === key
          ),
          "Операции по счёту"
        ),
    }),
    [transactions, monthTx, showDrill, monthStartDay, m.ym]
  );

  /** Содержимое виджета. Обойму, ширину и ручки надевает `WidgetShell`. */
  function widgetBody(p: WidgetPlacement): ReactNode {
    switch (p.kind) {
      case "month": {
        // «В рамке» — тот же «Открытый», только в поддоне и на серой
        // подложке: содержание одно, разная подача.
        const view = widgetView(widgetMeta("month"), p.view)?.id;
        return <MonthHero m={m} view={view} />;
      }

      case "freeMoney":
        return <FreeMoneyBlock f={freeMoney} base={m.base} />;
      case "freeMoneyCompact":
        return <FreeMoneyCompactBlock f={freeMoney} base={m.base} />;

      case "accounts":
        return (
          <AccountsBlock
            m={m}
            offBalance={p.offBalance}
            onOffBalanceChange={(v) => void setOffBalance(p.key, v)}
            onAccount={onAccount}
          />
        );

      case "upcoming": {
        // Два ответа на один вопрос: наш расчёт по истории и планы, заведённые
        // в самом Дзен-мани. Итог считается по тем же строкам, что показаны,
        // иначе сумма над списком не сошлась бы с ним.
        const zen = widgetView(widgetMeta("upcoming"), p.view)?.id === "zen";
        return (
          <>
            <BlockTitle title="Запланированные операции" to="/recurring" linkLabel="Запланированные" />
            {/* Итог подан так же, как совокупный баланс у соседней карточки:
                крупным числом под заголовком. Мелкой строчкой в шапке он
                выбивался из ряда. */}
            <PlannedTotals
              out={zen ? zenPlannedOut : m.upcomingTotalBase}
              income={zen ? zenPlannedIn : 0}
              base={m.base}
            />
            {zen ? (
              <ZenPlannedList
                rows={zenPlanned}
                base={m.base}
                today={todayIso}
                until={monthEnd(m.ym, m.monthStartDay)}
              />
            ) : (
              <UpcomingList m={m} />
            )}
          </>
        );
      }

      case "links":
        return (
          <LinksRow
            links={p.links ?? []}
            editing={editing}
            onChange={(links) => void setLinks(p.key, links)}
          />
        );

      case "cashflow":
        return (
          <>
            <BlockTitle
              title="Доходы и расходы"
              info={
                <>
                  <p>
                    Последние 12 месяцев, дальше — прогноз. Зелёный столбец слева в паре —
                    доход, красный справа — расход; прогнозные месяцы бледнее и обведены
                    пунктиром.
                  </p>
                  <p>
                    Прогноз считается по типичному месяцу за последние полгода — по
                    медиане, а не по среднему, чтобы одна крупная покупка не поднимала
                    всю линию. Текущий, неполный месяц в расчёт не берётся. Если история
                    позволяет, к каждому месяцу применяется поправка на сезон: декабрь
                    обычно дороже июля, и три прогнозных столбца тогда различаются.
                  </p>
                  <p>
                    Шкала срезана по обычному размаху: один месяц с крупной покупкой
                    прижимал бы остальные ко дну. Срезанный столбец несёт зубчатую
                    кромку и подписан настоящей суммой.
                  </p>
                </>
              }
              to="/cashflow"
              linkLabel="Cash-flow"
            />
            <CashflowBars m={m} onMonth={onMonth} height={260} />
          </>
        );

      case "capital":
        return <CapitalBlock series={m.netWorthSeries} base={m.base} today={todayIso} accounts={m.accounts} />;

      case "monthOverMonth":
        return (
          <>
            <BlockTitle
              title="Месяц к месяцу"
              info={
                <p>
                  Пока месяц идёт, от прошлого берётся <b>столько же дней</b>:
                  третьего числа любой месяц выглядел бы провалом рядом с целым
                  прошлым. Сколько дней взято, написано в шапке и под числом.
                  Норма сбережений — доля дохода, которая осталась.
                </p>
              }
              to="/compare"
              linkLabel="Сравнение"
            />
            <MonthOverMonthBlock mom={mom} base={m.base} prevLabel={prevMonthLabel} />
          </>
        );

      case "categories":
        return (
          <>
            <BlockTitle
              title="Расходы по категориям"
              info={
                <p>
                  Процент — доля статьи во всех расходах месяца, как на
                  «Категориях». Полоса меряется от самой крупной статьи: так видно
                  соотношение между ними.
                </p>
              }
              to="/categories"
              linkLabel="Категории"
            />
            <CategoriesList m={m} onCategory={onCategory} />
          </>
        );

      case "donutExpense":
        return (
          <>
            <BlockTitle title="Кольцо расходов" to="/categories?kind=expense" linkLabel="Категории" />
            <CategorySunburst
              compact
              data={donutExpense}
              meta={categoryMeta}
              base={m.base}
              kind="expense"
              onOpenCategory={(name) => drillCategory("expense", name)}
              onOpenSubcategory={(full) => drillCategory("expense", full, true)}
            />
          </>
        );

      case "donutIncome":
        return (
          <>
            <BlockTitle title="Кольцо доходов" to="/categories?kind=income" linkLabel="Категории" />
            <CategorySunburst
              compact
              data={donutIncome}
              meta={categoryMeta}
              base={m.base}
              kind="income"
              onOpenCategory={(name) => drillCategory("income", name)}
              onOpenSubcategory={(full) => drillCategory("income", full, true)}
            />
          </>
        );

      case "activity":
        return (
          <>
            <BlockTitle
              title="Активность в этом месяце"
              info={
                <p>
                  Чем темнее клетка, тем больше потрачено в этот день. Шкала строится по
                  обычному размаху, а не по рекордному дню — иначе одна крупная покупка
                  делала бы весь месяц бледным. Клик по дню открывает его операции.
                </p>
              }
              to="/calendar"
              linkLabel="Календарь"
            />
            <ActivityHeat m={m} onDay={onDay} />
          </>
        );

      case "observations":
        return (
          <>
            <BlockTitle
              title="Автонаблюдения"
              info={
                <p>
                  Статьи, пробившие план или разогнавшиеся против обычного, подорожавшие
                  подписки и пропущенные регулярные платежи. Не больше двух наблюдений
                  одного вида, чтобы список оставался разным.
                </p>
              }
              to="/anomalies"
              linkLabel="Аномалии"
            />
            <ObservationsList m={m} />
          </>
        );
    }
  }

  return <WidgetBoard body={widgetBody} />;
}
