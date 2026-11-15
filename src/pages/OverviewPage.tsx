/**
 * «Обзор месяца» — главная за любой выбранный месяц и по общим фильтрам.
 *
 * Главная всегда про идущий месяц и про все счета. Здесь те же виджеты, но
 * месяц выбирают — кликом по графику или в шапке, — а общие фильтры решают,
 * какие операции и счета считать: так личный бюджет отделяется от семейного.
 *
 * Раскладку собирает сам человек, как на главной (`WidgetBoard`), только
 * хранится она отдельно. Стандартная — `OVERVIEW_BOARD`: сверху график месяцев
 * и статьи выбранного — пара, с которой разбор и начинается; ниже то, что про
 * сам месяц; в конце капитал и счета — они к месяцу не привязаны, но слушают
 * фильтр счетов.
 *
 * Считает всё `useDashboardModel` — та же модель, что у главной, поэтому без
 * фильтров и на идущем месяце числа совпадают с ней.
 */

import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Filter, PanelsTopLeft } from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { InfoPopover, InfoTerm } from "../components/InfoPopover";
import { SectionControls } from "../components/SectionControls";
import { SectionEmpty } from "../components/SectionEmpty";
import { GlobalFilters } from "../components/GlobalFilters";
import { PeriodStepper } from "../components/PeriodStepper";
import { KindSwitcher } from "../components/KindSwitcher";
import { CategorySunburst } from "../components/CategorySunburst";
import { DashboardSkeleton } from "../components/dashboard/DashboardSkeleton";
import { WidgetBoard } from "../components/dashboard/WidgetBoard";
import { LinksRow } from "../components/dashboard/LinksRow";
import { LayoutSurfaceContext, OVERVIEW_SURFACE } from "../components/dashboard/layoutSurface";
import { useOverviewLayoutStore } from "../store/useDashboardLayoutStore";
import { widgetMeta, widgetView, type WidgetPlacement } from "../lib/dashboardLayout";
import { BlockTitle } from "../components/dashboard/blocks/shared";
import { HeroOpen, HeroSplit, MonthPill } from "../components/dashboard/blocks/monthHero";
import { CashflowBars } from "../components/dashboard/blocks/cashflow";
import { CapitalBlock } from "../components/dashboard/blocks/capital";
import { AccountsBlock, CategoriesList, ObservationsList } from "../components/dashboard/blocks/lists";
import { ActivityHeat } from "../components/dashboard/blocks/activity";
import { MonthOverMonthBlock } from "../components/dashboard/blocks/monthOverMonth";
import { useDashboardModel } from "../hooks/useDashboardModel";
import { useAnalyticsTransactions } from "../hooks/useAnalyticsTransactions";
import { useLiveAccounts } from "../hooks/useLiveAccounts";
import { useBalanceValuation } from "../hooks/useBalanceValuation";
import { useDataStore } from "../store/useDataStore";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { useDrillStore } from "../store/useDrillStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useFiltersStore, applyFilters, isNarrowed } from "../store/useFiltersStore";
import { buildHierarchy } from "../lib/aggregations";
import { monthOverMonth } from "../lib/monthOverMonth";
import { monthEnd } from "../lib/dashboardModel";
import { capitalAccountKeys } from "../lib/monthReview";
import { accountKeyOf, txAccountKey, txInKey, txOutKey } from "../lib/accountKey";
import { affectsExpense } from "../lib/txKindStyle";
import { currentPeriod, localToday, periodKey, periodRange, shiftPeriod } from "../lib/period";
import { dayTitle, formatDate, monthTitle } from "../lib/format";
import { MONTHS_IN } from "../lib/months";

type Kind = "expense" | "income";

/** Капитал на конец дня `date` — последняя точка кривой не позже него. */
function netWorthAt(series: readonly { date: string; net: number }[], date: string): number {
  let net = 0;
  for (const p of series) {
    if (p.date > date) break;
    net = p.net;
  }
  return net;
}

export function OverviewPage() {
  const analytics = useAnalyticsTransactions();
  const allTransactions = useDataStore((s) => s.transactions);
  const dataLoaded = useDataStore((s) => s.loaded);
  const syncStatus = useZenmoneyStore((s) => s.status);
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const categoryMeta = useCategoryMetaStore((s) => s.meta);
  const showDrill = useDrillStore((s) => s.show);

  // Общие фильтры действуют все, кроме периода: месяц здесь выбирают на самой
  // странице, и «текущий месяц» из фильтра оставил бы от графика один столбец.
  const filters = useFiltersStore();
  const pageFilters = useMemo(
    () => ({ ...filters, preset: "all" as const, from: null, to: null }),
    [filters]
  );
  const transactions = useMemo(
    () => applyFilters(analytics, pageFilters, monthStartDay),
    [analytics, pageFilters, monthStartDay]
  );
  const narrowed = isNarrowed(filters);

  // Капитал и остатки — по счетам из фильтра; без фильтра — как на главной.
  const liveAccounts = useLiveAccounts();
  const valuation = useBalanceValuation();
  const capitalKeys = useMemo(
    () =>
      liveAccounts && valuation?.universe
        ? capitalAccountKeys({
            accounts: liveAccounts.map((a) => ({ key: accountKeyOf(a), member: a.member })),
            universe: valuation.universe,
            pickedAccounts: filters.accounts,
            pickedUsers: filters.users,
          })
        : null,
    [liveAccounts, valuation, filters.accounts, filters.users]
  );
  // Без Дзен-мани остатков по счетам нет — с фильтром счетов капитал не посчитать.
  const capitalKnown = !!liveAccounts || (filters.accounts.size === 0 && filters.users.size === 0);

  // Выбранный месяц живёт в ссылке: её можно открыть с главной, переслать и
  // вернуться к ней кнопкой «назад». Идущий месяц — без параметра.
  const nowYm = useMemo(() => currentPeriod(monthStartDay), [monthStartDay]);
  const firstYm = useMemo(() => {
    let min = "";
    for (const t of analytics) if (!min || t.date < min) min = t.date;
    return min ? periodKey(min, monthStartDay) : nowYm;
  }, [analytics, monthStartDay, nowYm]);
  const [searchParams, setSearchParams] = useSearchParams();
  const param = searchParams.get("month");
  const ym = param && /^\d{4}-\d{2}$/.test(param) && param >= firstYm && param <= nowYm ? param : nowYm;
  const setYm = (next: string) => {
    const clamped = next < firstYm ? firstYm : next > nowYm ? nowYm : next;
    setSearchParams(clamped === nowYm ? {} : { month: clamped }, { replace: true });
  };

  const m = useDashboardModel({
    ym,
    transactions,
    accountKeys: capitalKeys,
    // Остаток счёта не зависит от того, какие статьи отмечены: по счетам из
    // фильтра кривая считается по всем их операциям. Без фильтра — тем же
    // рядом, что на главной, чтобы числа совпадали.
    capitalTransactions: capitalKeys ? allTransactions : analytics,
  });

  const [kind, setKind] = useState<Kind>("expense");
  const layoutLoaded = useOverviewLayoutStore((s) => s.loaded);
  const editing = useOverviewLayoutStore((s) => s.editing);
  const setLinks = useOverviewLayoutStore((s) => s.setLinks);
  const setOffBalance = useOverviewLayoutStore((s) => s.setOffBalance);

  const monthTx = useMemo(
    () => transactions.filter((t) => periodKey(t.date, monthStartDay) === ym),
    [transactions, monthStartDay, ym]
  );
  const ringExpense = useMemo(() => buildHierarchy(monthTx, "expense"), [monthTx]);
  const ringIncome = useMemo(() => buildHierarchy(monthTx, "income"), [monthTx]);

  // «Сегодня» для сравнения — последняя дата с данными, как на главной.
  const lastDate = useMemo(
    () => transactions.reduce((mx, t) => (t.date > mx ? t.date : mx), ""),
    [transactions]
  );
  const mom = useMemo(
    () => monthOverMonth(transactions, ym, monthStartDay, lastDate || monthEnd(ym, monthStartDay)),
    [transactions, ym, monthStartDay, lastDate]
  );
  const prevMonthLabel = MONTHS_IN[Number(shiftPeriod(ym, -1).slice(5, 7)) - 1] ?? "";

  if (analytics.length === 0) {
    const busy = !dataLoaded || syncStatus === "checking" || syncStatus === "syncing";
    return busy ? <DashboardSkeleton /> : <EmptyState />;
  }
  // Своя раскладка поднимается из базы: до этого на экране была бы
  // стандартная, и страница на кадр перескакивала бы из чужой в свою.
  if (!layoutLoaded) return <DashboardSkeleton />;

  const matches = (t: (typeof monthTx)[number], k: Kind) =>
    k === "expense" ? affectsExpense(t.kind) : t.kind === "income";
  /** Операции статьи или подстатьи за выбранный месяц — тот же отрезок, что в виджетах. */
  const drillCategory = (k: Kind, name: string, full = false) =>
    showDrill(
      `${name} · ${monthTitle(ym)}`,
      monthTx.filter((t) => matches(t, k) && (full ? t.categoryFull === name : t.category === name)),
      k === "expense" ? "Расходы по статье" : "Доходы по статье"
    );

  const range = periodRange(ym, monthStartDay);
  // План бюджета считается по всем счетам и статьям — с отфильтрованным
  // фактом рядом он бы врал, поэтому под фильтрами его не показываем.
  // Нулевой план — это «плана на месяц нет», а не «запланирован ноль». Остаток
  // на счетах у прошедшего месяца — на его последний день, а не сегодняшний.
  const hero = {
    ...m,
    netWorth: ym === nowYm ? m.netWorth : netWorthAt(m.netWorthSeries, range.to),
    planIncome: narrowed ? null : m.planIncome || null,
    planExpense: narrowed ? null : m.planExpense || null,
  };
  const today = localToday();

  /** Содержимое виджета — те же блоки, что на главной, за выбранный месяц. */
  function widgetBody(p: WidgetPlacement): ReactNode {
    switch (p.kind) {
      case "month": {
        const view = widgetView(widgetMeta("month"), p.view)?.id;
        if (view === "split") return <HeroSplit m={hero} titleTag="h2" pill={<MonthPill m={m} size="sm" />} />;
        return (
          <HeroOpen m={hero} sunken={view === "framed"} titleTag="h2" pill={<MonthPill m={m} size="md" />} />
        );
      }

      case "cashflow":
        return (
          <>
            <BlockTitle
              title="Доходы и расходы"
              info={
                <>
                  <p>
                    Клик по месяцу выбирает его — вся страница пересчитывается.
                    Клик по зелёному или красному столбцу заодно показывает
                    доходы или расходы этого месяца по категориям. Выбранный
                    месяц яркий, остальные приглушены.
                  </p>
                  <p>
                    Бледные столбцы с пунктиром — прогноз по типичному месяцу
                    за последние полгода. Срезанный столбец несёт зубчатую
                    кромку и подписан настоящей суммой.
                  </p>
                </>
              }
              to="/cashflow"
              linkLabel="Cash-flow"
            />
            <CashflowBars
              m={m}
              height={260}
              selectedYm={ym}
              onMonth={(next, k) => {
                setYm(next);
                if (k) setKind(k);
              }}
            />
          </>
        );

      case "categories":
        return (
          <>
            <BlockTitle
              title={kind === "expense" ? "Расходы по категориям" : "Доходы по категориям"}
              info={
                <p>
                  Процент — доля статьи во всех {kind === "expense" ? "расходах" : "доходах"}{" "}
                  месяца. Полоса меряется от самой крупной статьи. Клик открывает
                  операции статьи за этот месяц.
                </p>
              }
              right={<KindSwitcher kind={kind} onChange={setKind} />}
            />
            <CategoriesList m={m} kind={kind} onCategory={(name) => drillCategory(kind, name)} />
          </>
        );

      case "monthOverMonth":
        return (
          <>
            <BlockTitle
              title="Месяц к месяцу"
              info={
                <p>
                  Пока месяц идёт, от прошлого берётся <b>столько же дней</b>.
                  У завершённого месяца сравнение полное. Норма сбережений —
                  доля дохода, которая осталась.
                </p>
              }
              to="/compare"
              linkLabel="Сравнение"
            />
            <MonthOverMonthBlock mom={mom} base={m.base} prevLabel={prevMonthLabel} />
          </>
        );

      case "observations":
        return (
          <>
            <BlockTitle
              title="Автонаблюдения"
              info={
                <p>
                  Статьи, пробившие план или разогнавшиеся против обычного. У
                  идущего месяца сюда же попадают подорожавшие подписки и
                  пропущенные регулярные платежи.
                </p>
              }
              to="/anomalies"
              linkLabel="Аномалии"
            />
            <ObservationsList m={m} />
          </>
        );

      case "activity":
        return (
          <>
            <BlockTitle
              title="Активность за месяц"
              info={
                <p>
                  Чем темнее клетка, тем больше потрачено в этот день. Клик по
                  дню открывает его операции.
                </p>
              }
              to="/calendar"
              linkLabel="Календарь"
            />
            <ActivityHeat
              m={m}
              onDay={(date) =>
                showDrill(
                  dayTitle(date),
                  transactions.filter((t) => t.date.slice(0, 10) === date),
                  "Операции за день"
                )
              }
            />
          </>
        );

      case "donutExpense":
      case "donutIncome": {
        const k: Kind = p.kind === "donutExpense" ? "expense" : "income";
        return (
          <>
            <BlockTitle
              title={k === "expense" ? "Кольцо расходов" : "Кольцо доходов"}
              to={`/categories?kind=${k}`}
              linkLabel="Категории"
            />
            <CategorySunburst
              compact
              data={k === "expense" ? ringExpense : ringIncome}
              meta={categoryMeta}
              base={m.base}
              kind={k}
              onOpenCategory={(name) => drillCategory(k, name)}
              onOpenSubcategory={(full) => drillCategory(k, full, true)}
            />
          </>
        );
      }

      case "capital":
        return capitalKnown ? (
          <CapitalBlock series={m.netWorthSeries} base={m.base} today={today} accounts={m.accounts} />
        ) : (
          <>
            <BlockTitle title="Капитал" />
            {capitalUnknown}
          </>
        );

      case "accounts":
        return capitalKnown ? (
          <AccountsBlock
            m={m}
            picked={capitalKeys !== null}
            offBalance={p.offBalance}
            onOffBalanceChange={(v) => void setOffBalance(p.key, v)}
            onAccount={(key, label) =>
              showDrill(
                label,
                transactions.filter(
                  (t) => txAccountKey(t) === key || txOutKey(t) === key || txInKey(t) === key
                ),
                "Операции по счёту"
              )
            }
          />
        ) : (
          <>
            <BlockTitle title="Балансы счетов" />
            {capitalUnknown}
          </>
        );

      case "links":
        return (
          <LinksRow
            links={p.links ?? []}
            editing={editing}
            onChange={(links) => void setLinks(p.key, links)}
          />
        );

      // «Свободных денег» и «Запланированных операций» на этой странице нет:
      // они про идущий месяц, а здесь месяц выбирают (см. `OVERVIEW_BOARD`).
      default:
        return null;
    }
  }

  // Без Дзен-мани остатков по счетам нет — под фильтром счетов считать нечего.
  const capitalUnknown = (
    <SectionEmpty variant="compact">
      Остатки по выбранным счетам известны только при подключении к Дзен-мани
    </SectionEmpty>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={PanelsTopLeft}
        title="Обзор месяца"
        info={
          <InfoPopover>
            <p>
              Те же виджеты, что на главной, но за <InfoTerm>любой месяц</InfoTerm>:
              выберите его кликом по графику или в шапке справа. Клик по зелёному
              или красному столбцу заодно показывает рядом доходы или расходы
              этого месяца по категориям.
            </p>
            <p>
              <InfoTerm>Общие фильтры</InfoTerm> действуют все, кроме периода.
              Отметьте свои счета или участника — и страница покажет только
              ваш бюджет: график, статьи, итоги, а капитал и остатки — по этим
              же счетам. Без фильтров и на идущем месяце числа совпадают с
              главной.
            </p>
            <p>
              План из «Бюджета» стоит под доходом и расходом, пока фильтры не
              заданы: он считается по всем счетам и статьям, и сравнивать с ним
              часть операций нельзя.
            </p>
          </InfoPopover>
        }
      />
      <SectionControls>
        <PeriodStepper
          size="md"
          monthYM={ym}
          minYM={firstYm}
          maxYM={nowYm}
          hint={`${formatDate(range.from, "full")} — ${formatDate(range.to, "full")}`}
          onStep={(dir) => setYm(shiftPeriod(ym, dir))}
          onCurrent={() => setYm(nowYm)}
          atCurrent={ym === nowYm}
          onSelectMonth={setYm}
          onSelectYear={(y) => setYm(`${y}-${ym.slice(5, 7)}`)}
        />
      </SectionControls>
      <GlobalFilters
        showDateRange={false}
        dateRangeHint="Месяц выбирается на графике или в шапке раздела"
      />

      {transactions.length === 0 ? (
        <SectionEmpty icon={Filter} title="Под фильтры не попала ни одна операция" />
      ) : (
        <LayoutSurfaceContext.Provider value={OVERVIEW_SURFACE}>
          <WidgetBoard body={widgetBody} />
        </LayoutSurfaceContext.Provider>
      )}
    </div>
  );
}
