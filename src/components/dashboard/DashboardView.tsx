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

import { ChoiceMenu } from "../ChoiceMenu";
import { MONTHS_IN } from "../../lib/months";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import { BlockTitle } from "./blocks/shared";
import { MonthHero } from "./blocks/monthHero";
import { PageHeader } from "../PageHeader";
import { InfoPopover, InfoTerm } from "../InfoPopover";
import { SectionControls } from "../SectionControls";
import { SectionEmpty } from "../SectionEmpty";
import { GlobalFilters } from "../GlobalFilters";
import { PeriodStepper } from "../PeriodStepper";
import { CalendarClock, CloudUpload, Filter, LayoutDashboard, Sparkles, Tag } from "lucide-react";
import { useHomeScope } from "../../hooks/useHomeScope";
import { CashflowBars } from "./blocks/cashflow";
import { CapitalBlock } from "./blocks/capital";
import { AccountsBlock, CategoriesList, ObservationsList, UpcomingList, ZenPlannedList } from "./blocks/lists";
import { ActivityHeat } from "./blocks/activity";
import { MonthOverMonthBlock } from "./blocks/monthOverMonth";
import { PaceBlock } from "./blocks/pace";
import { BudgetWidget } from "./BudgetWidget";
import { BigExpensesWidget } from "./BigExpensesWidget";
import { CushionWidget } from "./CushionWidget";
import { GoalsWidget } from "./GoalsWidget";
import { WatchWidget } from "./WatchWidget";
import { TagWatchWidget } from "./TagWatchWidget";
import { TriageBlock, type TriageItem } from "./blocks/triage";
import { buildSpendingPace, paceCategories } from "../../lib/spendingPace";
import { useTriage } from "../../hooks/useTriage";
import { useSmoothNavigate } from "../../hooks/useSmoothNavigate";
import { MONTHS } from "../../lib/months";
import { FreeMoneyBlock, FreeMoneyCompactBlock } from "./blocks/freeMoney";
import { LinksRow } from "./LinksRow";
import {
  EmptyDashboard,
  LayoutToolbar,
  WidgetGap,
  WidgetShell,
} from "./WidgetLayout";
import { useWidgetDrag } from "../../hooks/useWidgetDrag";
import {
  canDropIntoGap,
  canShiftWidget,
  isBareWidget,
  packLayout,
  type LayoutCell,
  widgetMeta,
  widgetView,
  type WidgetPlacement,
} from "../../lib/dashboardLayout";
import { useDashboardLayoutStore } from "../../store/useDashboardLayoutStore";
import {
  formatMoney,
  formatDate,
  monthTitle,
  dayTitle,
} from "../../lib/format";
import { localToday, periodRange } from "../../lib/period";
import { useDashboardModel } from "../../hooks/useDashboardModel";
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

/** Капитал на конец дня `date` — последняя точка кривой не позже него. */
function netWorthAt(series: readonly { date: string; net: number }[], date: string): number {
  let net = 0;
  for (const p of series) {
    if (p.date > date) break;
    net = p.net;
  }
  return net;
}

export function DashboardView() {
  // «Фильтры и выбор месяца»: когда настройка включена, главная считает за
  // выбранный месяц и по общим фильтрам; выключена — `scope` ничего не меняет.
  const scope = useHomeScope();
  const m = useDashboardModel(scope.options);
  const transactions = scope.transactions;
  const [catKind, setCatKind] = useState<"expense" | "income">("expense");
  const showDrill = useDrillStore((s) => s.show);
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const categoryMeta = useCategoryMetaStore((s) => s.meta);

  // «Сегодня» — последняя дата С ДАННЫМИ, а не системная: по обрезанной
  // истории часы дали бы пустой хвост окна и заниженное сравнение.
  const lastDate = useMemo(
    () => transactions.reduce((mx, t) => (t.date > mx ? t.date : mx), ""),
    [transactions]
  );
  // С чем сравнивать выбранный прошедший месяц: с предыдущим или с идущим.
  // У идущего месяца выбора нет — сравнивать его с самим собой незачем.
  const [momAgainst, setMomAgainst] = useState<"prev" | "now">("prev");
  const momVsNow = scope.on && m.ym !== m.nowYm && momAgainst === "now";
  const momAgainstYm = momVsNow ? m.nowYm : shiftPeriod(m.ym, -1);
  const mom = useMemo(
    () =>
      monthOverMonth(
        transactions,
        m.ym,
        monthStartDay,
        lastDate || monthEnd(m.ym, monthStartDay),
        momAgainstYm
      ),
    [transactions, m.ym, monthStartDay, lastDate, momAgainstYm]
  );
  /**
   * «в июле» — название прошлого месяца в ПРЕДЛОЖНОМ падеже.
   *
   * Своим списком, а не через `toLocaleDateString`: тот отдаёт именительный
   * («июль»), и подпись читалась «В июль за те же 28 дней».
   */
  const prevMonthLabel = useMemo(() => {
    const mo = Number(momAgainstYm.slice(5, 7));
    return MONTHS_IN[mo - 1] ?? "";
  }, [momAgainstYm]);

  // «Темп трат»: идущий месяц обрывается на сегодня, прошедший берётся целиком.
  const paceToday = localToday();
  const pace = useMemo(
    () => buildSpendingPace(transactions, m.ym, monthStartDay, paceToday),
    [transactions, m.ym, monthStartDay, paceToday]
  );
  const paceCats = useMemo(
    () => paceCategories(transactions, m.ym, monthStartDay, paceToday),
    [transactions, m.ym, monthStartDay, paceToday]
  );
  const paceLabels = useMemo(() => {
    const mo = Number(m.ym.slice(5, 7));
    const prevMo = Number(shiftPeriod(m.ym, -1).slice(5, 7));
    return {
      month: MONTHS[mo - 1] ?? "",
      prev: MONTHS[prevMo - 1] ?? "",
      prevIn: MONTHS_IN[prevMo - 1] ?? "",
    };
  }, [m.ym]);

  const triage = useTriage();
  const smoothNavigate = useSmoothNavigate();

  const layout = useDashboardLayoutStore((s) => s.layout);
  const editing = useDashboardLayoutStore((s) => s.editing);
  const setEditing = useDashboardLayoutStore((s) => s.setEditing);
  const move = useDashboardLayoutStore((s) => s.move);
  const shift = useDashboardLayoutStore((s) => s.shift);
  const setLinks = useDashboardLayoutStore((s) => s.setLinks);
  const setBalancesMode = useDashboardLayoutStore((s) => s.setBalancesMode);
  const dropInGap = useDashboardLayoutStore((s) => s.dropInGap);
  const setCategory = useDashboardLayoutStore((s) => s.setCategory);
  const setTag = useDashboardLayoutStore((s) => s.setTag);

  // Планы Дзен-мани — второй вид «Запланированных платежей». Отрезок тот же,
  // что у своих регулярных: от сегодня до конца отчётного месяца.
  const todayIso = localToday();
  // С просроченными: платёж, который прошляпили, — главное, что виджет обязан
  // показать (issue #87).
  // Планы — всегда до конца ИДУЩЕГО месяца, какой бы месяц ни был выбран.
  const zenPlannedAll = useZenPlanned(todayIso, monthEnd(m.nowYm, m.monthStartDay), true);
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
  // Просроченные — для «Разобрать». С переводами: пропущенный перевод на
  // вклад такой же просроченный платёж.
  const overduePlanned = useMemo(
    () =>
      (zenPlannedAll ?? []).filter(
        (p) => p.date < todayIso && plannedDeletions[p.id] === undefined
      ).length,
    [zenPlannedAll, plannedDeletions, todayIso]
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
  // «Свободные деньги» — про идущий месяц и про весь бюджет: общие фильтры
  // их не касаются, поэтому счета берём обычным набором, а не из фильтра.
  const freeAccounts = useMemo(
    () => (m.includeOffBalance ? m.accountsAll : m.accountsAll.filter((a) => !a.offBalance)),
    [m.accountsAll, m.includeOffBalance]
  );
  const freeMoney = useFreeMoney(freeAccounts, todayIso);

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

  const drag = useWidgetDrag(
    (dragKey, overKey) => void move(dragKey, overKey),
    (dragKey, beforeKey, gapCol) => void dropInGap(dragKey, beforeKey, gapCol)
  );

  // Режим настройки не переживает уход со страницы: вернувшись на главную,
  // человек ждёт готовый экран, а не разложенные ручки.
  useEffect(() => () => setEditing(false), [setEditing]);

  // Escape — выход из режима, как из любого другого временного состояния.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector('[role="dialog"]')) return;
      setEditing(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, setEditing]);

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

  /**
   * Виджет, только что поставленный из пустой клетки, — его и подсвечиваем
   * появлением. Ключ сбрасывается сам: анимация одноразовая, и держать её
   * включённой после того, как она отыграла, значит повторять её на каждой
   * следующей перерисовке.
   */
  const [justAdded, setJustAdded] = useState<string | null>(null);
  useEffect(() => {
    if (!justAdded) return;
    const t = setTimeout(() => setJustAdded(null), 600);
    return () => clearTimeout(t);
  }, [justAdded]);

  /** Ширина того, что сейчас везут: дырка уже не примет виджет шире себя. */
  const dragSpan = useMemo(() => {
    if (!drag.dragKey) return 0;
    const p = layout.find((x) => x.key === drag.dragKey);
    return p ? widgetMeta(p.kind)?.span ?? 1 : 0;
  }, [drag.dragKey, layout]);

  // Без Дзен-мани остатков по счетам нет — под фильтром счетов считать нечего.
  const capitalUnknown = (
    <SectionEmpty variant="compact">
      Остатки по выбранным счетам известны только при подключении к Дзен-мани
    </SectionEmpty>
  );

  /** Содержимое виджета. Обойму, ширину и ручки надевает `WidgetShell`. */
  function widgetBody(p: WidgetPlacement): ReactNode {
    switch (p.kind) {
      case "month": {
        // «В рамке» — тот же «Открытый», только в поддоне и на серой
        // подложке: содержание одно, разная подача.
        const view = widgetView(widgetMeta("month"), p.view)?.id;
        if (!scope.on) return <MonthHero m={m} view={view} />;
        // План бюджета считается по всем счетам и статьям — с отфильтрованным
        // фактом рядом он бы врал. Остаток на счетах у прошедшего месяца — на
        // его последний день, а не сегодняшний.
        const hero = {
          ...m,
          planIncome: scope.narrowed ? null : m.planIncome,
          planExpense: scope.narrowed ? null : m.planExpense,
          netWorth:
            m.ym === m.nowYm
              ? m.netWorth
              : netWorthAt(m.netWorthSeries, periodRange(m.ym, m.monthStartDay).to),
        };
        // Строка плана держит место, пока планы в «Бюджете» вообще есть: иначе
        // под фильтром колонки итогов становились ниже и текст над ними съезжал.
        return (
          <MonthHero
            m={hero}
            view={view}
            fixed
            reservePlan={m.planIncome !== null || m.planExpense !== null}
          />
        );
      }

      case "freeMoney":
        return <FreeMoneyBlock f={freeMoney} base={m.base} />;
      case "freeMoneyCompact":
        return <FreeMoneyCompactBlock f={freeMoney} base={m.base} />;

      case "accounts":
        if (!scope.capitalKnown) {
          return (
            <>
              <BlockTitle title="Балансы счетов" to="/accounts" linkLabel="Счета" />
              {capitalUnknown}
            </>
          );
        }
        return (
          <AccountsBlock
            m={m}
            picked={scope.capitalKeys !== null}
            offBalance={p.offBalance}
            free={p.free}
            planLeft={freeMoney.ready ? freeMoney.planLeft : null}
            onModeChange={(v) => void setBalancesMode(p.key, v)}
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
                until={monthEnd(m.nowYm, m.monthStartDay)}
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
            {scope.on ? (
              // Клик выбирает месяц — вся главная пересчитывается; по столбцу
              // заодно переключаются статьи: доходы или расходы.
              <CashflowBars
                m={m}
                height={260}
                selectedYm={m.ym}
                onMonth={(ym, kind) => {
                  scope.setYm(ym);
                  if (kind) setCatKind(kind);
                }}
              />
            ) : (
              <CashflowBars m={m} onMonth={onMonth} height={260} />
            )}
          </>
        );

      case "capital":
        if (!scope.capitalKnown) {
          return (
            <>
              <BlockTitle title="Капитал" to="/accounts" linkLabel="Счета" />
              {capitalUnknown}
            </>
          );
        }
        return <CapitalBlock series={m.netWorthSeries} base={m.base} today={todayIso} accounts={m.accounts} current={m.netWorth} />;

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
                  {scope.on && (
                    <>
                      {" "}
                      Прошедший месяц можно сравнить и с идущим: от него тогда
                      берётся столько же дней, сколько в идущем уже прошло.
                    </>
                  )}
                </p>
              }
              right={
                scope.on && m.ym !== m.nowYm ? (
                  <ChoiceMenu
                    label="С каким месяцем сравнивать"
                    value={momAgainst}
                    onChange={setMomAgainst}
                    options={[
                      { value: "prev", label: "С прошлым", title: "С месяцем перед выбранным" },
                      { value: "now", label: "С текущим", title: "С идущим месяцем — за столько же дней" },
                    ]}
                    className="ml-auto"
                  />
                ) : undefined
              }
              rightSmall
              to="/compare"
              linkLabel="Сравнение"
            />
            <MonthOverMonthBlock
              mom={mom}
              base={m.base}
              prevLabel={prevMonthLabel}
              baselineWord={momVsNow ? "Сейчас" : "Было"}
            />
          </>
        );

      case "categories":
        // С выбором месяца у статей свой переключатель: клик по зелёному
        // столбцу графика показывает здесь доходы месяца.
        if (scope.on) {
          return (
            <>
              <BlockTitle
                title={catKind === "expense" ? "Расходы по категориям" : "Доходы по категориям"}
                info={
                  <p>
                    Процент — доля статьи во всех {catKind === "expense" ? "расходах" : "доходах"}{" "}
                    месяца. Полоса меряется от самой крупной статьи. Клик открывает
                    операции статьи за этот месяц.
                  </p>
                }
                right={
                  <ChoiceMenu
                    label="Что показывать"
                    value={catKind}
                    onChange={setCatKind}
                    options={[
                      { value: "expense", label: "Расходы" },
                      { value: "income", label: "Доходы" },
                    ]}
                    className="ml-auto"
                  />
                }
                rightSmall
              />
              <CategoriesList
                m={m}
                kind={catKind}
                onCategory={(name) => drillCategory(catKind, name)}
              />
            </>
          );
        }
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
              title={m.ym === m.nowYm ? "Активность в этом месяце" : "Активность за месяц"}
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

      case "pace":
        return (
          <>
            <BlockTitle
              title="Темп трат"
              info={
                <p>
                  Сколько потрачено с начала месяца к каждому дню. Пока месяц идёт,
                  от прошлого берётся <b>столько же дней</b> — и для числа, и для
                  статей. Возвраты уменьшают расход, переводы не считаются. Среднее
                  считается по полным месяцам, не больше трёх. Клик по статье
                  открывает её операции за этот месяц.
                </p>
              }
              to="/compare"
              linkLabel="Сравнение"
            />
            <PaceBlock
              pace={pace}
              categories={paceCats}
              base={m.base}
              labels={paceLabels}
              view={widgetView(widgetMeta("pace"), p.view)?.id === "chart" ? "chart" : "categories"}
              onCategory={(name) => drillCategory("expense", name)}
            />
          </>
        );

      case "budget":
        return (
          <BudgetWidget
            ym={m.ym}
            base={m.base}
            progress={m.month.running ? m.month.progress : null}
            onOpen={showDrill}
          />
        );

      case "goals":
        return <GoalsWidget base={m.base} />;

      case "bigExpenses":
        return <BigExpensesWidget transactions={monthTx} ym={m.ym} base={m.base} onOpen={showDrill} />;

      case "cushion":
        return <CushionWidget base={m.base} />;

      case "watch":
        return (
          <WatchWidget
            category={p.category}
            subcategory={p.subcategory}
            transactions={transactions}
            ym={m.ym}
            monthStartDay={monthStartDay}
            today={paceToday}
            base={m.base}
            income={p.income === true}
            onPick={(category, subcategory, income) =>
              void setCategory(p.key, category, subcategory, income)
            }
            onOpen={showDrill}
          />
        );

      case "watchTag":
        return (
          <TagWatchWidget
            tag={p.tag}
            tagMode={p.tagMode}
            transactions={transactions}
            ym={m.ym}
            monthStartDay={monthStartDay}
            today={paceToday}
            base={m.base}
            onPick={(tag, mode) => void setTag(p.key, tag, mode)}
            onOpen={showDrill}
          />
        );

      case "triage": {
        const items: TriageItem[] = [
          {
            key: "unseen",
            icon: Sparkles,
            label: "Новые операции",
            hint: "Ещё не просмотрены",
            count: triage.unseen.length,
            onOpen: () => showDrill("Новые операции", triage.unseen, "Ещё не просмотрены"),
          },
          {
            key: "uncategorized",
            icon: Tag,
            label: "Без категории",
            hint: "Отчёты по категориям без них неполные",
            count: triage.uncategorized.length,
            onOpen: () => showDrill("Без категории", triage.uncategorized, "За всё время"),
          },
        ];
        if (triage.connected) {
          items.push({
            key: "unsent",
            icon: CloudUpload,
            label: "Не отправлено в Дзен-мани",
            hint: "Правки есть только на этом устройстве",
            count: triage.unsent.length,
            onOpen: () =>
              showDrill("Не отправлено в Дзен-мани", triage.unsent, "Операции с правками"),
          });
        }
        if (zenPlannedAll) {
          items.push({
            key: "overdue",
            icon: CalendarClock,
            label: "Просроченные платежи",
            hint: "Запланированы, но не проведены",
            count: overduePlanned,
            onOpen: () => smoothNavigate("/recurring"),
          });
        }
        return (
          <>
            <BlockTitle
              title="Разобрать"
              info={
                <p>
                  Что в данных ждёт внимания. Считается по всем операциям, а не по
                  выбранному месяцу и фильтрам. Клик по строке открывает ровно те
                  операции, которые в ней посчитаны; их можно править прямо в
                  открывшемся списке.
                </p>
              }
              to="/transactions"
              linkLabel="Операции"
            />
            <TriageBlock items={items} />
          </>
        );
      }

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

  const visible = layout.filter((p) => !p.hidden);
  // Дырки в рядах считаем сами: сетка их оставляет, но в разметке их нет, а
  // значит и уронить в них виджет нельзя. Считаем ВСЕГДА, а не только в режиме
  // настройки: пустая клетка слева от виджета — часть раскладки, и без неё
  // сдвинутый виджет возвращался бы к левому краю, стоило выйти из настройки.
  const cells = useMemo(() => {
    const packed = packLayout(visible);
    // В режиме настройки в конце всегда есть куда поставить: если ряды сошлись
    // ровно, пустой клетки не остаётся вовсе — и «плюсу» негде жить. Полоса во
    // всю ширину заодно принимает бросок любого виджета, даже самого широкого.
    if (!editing || packed[packed.length - 1]?.type === "gap") return packed;
    return [...packed, { type: "gap" as const, span: 3, before: null }];
  }, [visible, editing]);

  /**
   * Номер ряда для каждой ячейки раскладки.
   *
   * Нужен ровно для одного: дырку нельзя закрыть виджетом ИЗ ЭТОГО ЖЕ РЯДА. Он
   * не встанет на её место, а поменяется местами с соседом, и дырка останется
   * там же — со стороны это выглядит как «перетаскивание не работает».
   */
  /**
   * С какой колонки ряда начинается каждая ячейка.
   *
   * Нужна дыркам: бросок ставит виджет ровно в ту клетку, куда целились, а для
   * этого надо знать её номер в ряду (см. `dropIntoGap`).
   */
  const colOf = (() => {
    const out = new Map<LayoutCell, number>();
    let col = 0;
    for (const cell of cells) {
      const span =
        cell.type === "gap" ? cell.span : widgetMeta(cell.placement.kind).span;
      out.set(cell, col);
      col = (col + span) % 3;
    }
    return out;
  })();

  const scopeRange = periodRange(m.ym, m.monthStartDay);

  return (
    <div className="flex flex-col gap-5 3xl:gap-6">
      {scope.on && (
        // Шапка и фильтры — с тем же зазором, что на остальных разделах
        // (`space-y-6`): у виджетов главной свой, на ширинах до 3xl он меньше,
        // и панель фильтров стояла здесь на 4 пикселя выше, чем везде.
        <div className="flex flex-col gap-6">
          <PageHeader
            icon={LayoutDashboard}
            title="Главная"
            info={
              <InfoPopover>
                <p>
                  Включены <InfoTerm>фильтры и выбор месяца</InfoTerm>: главная
                  считает за месяц, выбранный справа или кликом по графику
                  доходов и расходов, и по общим фильтрам — всем, кроме
                  периода. Отметьте свои счета или участника, и виджеты
                  покажут только ваш бюджет, а капитал и остатки — эти счета.
                </p>
                <p>
                  План из «Бюджета» стоит под доходом и расходом, пока фильтры
                  не заданы: он считается по всем счетам и статьям. «Свободные
                  деньги» и «Запланированные операции» всегда про идущий месяц.
                </p>
                <p>
                  Выключается там же, где включалось: значок «Настроить
                  главную» в шапке.
                </p>
              </InfoPopover>
            }
          />
          <SectionControls>
            <PeriodStepper
              size="md"
              monthYM={m.ym}
              minYM={scope.firstYm}
              maxYM={scope.nowYm}
              hint={`${formatDate(scopeRange.from, "full")} — ${formatDate(scopeRange.to, "full")}`}
              onStep={(dir) => scope.setYm(shiftPeriod(m.ym, dir))}
              onCurrent={() => scope.setYm(scope.nowYm)}
              atCurrent={m.ym === scope.nowYm}
              onSelectMonth={scope.setYm}
              onSelectYear={(y) => scope.setYm(`${y}-${m.ym.slice(5, 7)}`)}
            />
          </SectionControls>
          <GlobalFilters
            showDateRange={false}
            dateRangeHint="Месяц выбирается на графике или в шапке главной"
          />
        </div>
      )}
      <LayoutToolbar layout={layout} />

      {scope.filteredOut ? (
        <SectionEmpty icon={Filter} title="Под фильтры не попала ни одна операция" />
      ) : visible.length === 0 ? (
        <EmptyDashboard />
      ) : (
        <section data-tour="widgets" className="grid grid-cols-1 lg:grid-cols-3 gap-5 3xl:gap-6">
          {cells.map((cell, ci) => {
            if (cell.type === "gap") {
              // В ряду дырок бывает две: перенос на новый ряд и отступ слева от
              // виджета. Ключ по одному лишь соседу их бы склеил — подсвечивались
              // бы обе разом.
              const gapKey = `gap:${ci}:${cell.before ?? "end"}`;
              // Помещается ли виджет, если начать его с этой клетки. Считаем
              // до конца РЯДА, а не по ширине самой дырки: виджет, который
              // бросают в собственный отступ, занимает и то место, где стоял.
              const gapCol = colOf.get(cell) ?? 0;
              const fits = drag.dragKey !== null && gapCol + dragSpan <= 3;
              // Клетка зовёт, только если бросок что-то изменит и виджет
              // встанет именно в неё (см. `canDropIntoGap`).
              const accepts =
                drag.dragKey !== null &&
                canDropIntoGap(layout, drag.dragKey, cell.before, gapCol);
              const refusal =
                drag.dragKey !== null && !fits ? "Не поместится — двигайте стрелками" : null;
              // Вне настройки дырка — просто пустое место: ни рамки, ни
              // приглашения, ни обработчиков.
              if (!editing) {
                return (
                  <div
                    key={gapKey}
                    aria-hidden
                    className={clsx("hidden lg:block", cell.span === 2 && "lg:col-span-2")}
                  />
                );
              }
              return (
                <WidgetGap
                  key={gapKey}
                  span={cell.span}
                  dragging={drag.dragKey !== null}
                  accepts={accepts}
                  refusal={refusal}
                  highlight={drag.overKey === gapKey}
                  layout={layout}
                  beforeKey={cell.before}
                  onEnter={() => drag.enter(gapKey)}
                  onDrop={(sourceKey) => drag.dropBefore(sourceKey, cell.before, gapCol)}
                  onAdded={setJustAdded}
                />
              );
            }
            const p = cell.placement;
            return (
            <WidgetShell
              key={p.key}
              placement={p}
              meta={widgetMeta(p.kind)}
              bare={isBareWidget(widgetMeta(p.kind), p.view)}
              sunken={widgetView(widgetMeta(p.kind), p.view)?.sunken === true}
              editing={editing}
              appearing={justAdded === p.key}
              dragging={drag.dragKey === p.key}
              dropTarget={
                drag.overKey === p.key && drag.dragKey !== null && drag.dragKey !== p.key
              }
              onDragStart={() => drag.start(p.key)}
              onDragEnter={() => drag.enter(p.key)}
              onDragEnd={drag.end}
              onDrop={(sourceKey) => drag.drop(sourceKey, p.key)}
              onShift={(dir) => void shift(p.key, dir)}
              // Шаг есть, пока рядом сосед или пустая клетка своего ряда.
              canBack={canShiftWidget(layout, p.key, -1)}
              canForward={canShiftWidget(layout, p.key, 1)}
            >
              {widgetBody(p)}
            </WidgetShell>
            );
          })}
        </section>
      )}


    </div>
  );
}
