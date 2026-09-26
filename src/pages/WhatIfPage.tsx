import { useEffect, useMemo } from "react";
import {
  Coins,
  FlaskConical,
  LineChart as LineChartIcon,
  RotateCcw,
  SlidersHorizontal,
  Table2,
  Wallet,
} from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useAnalyticsTransactions } from "../hooks/useAnalyticsTransactions";
import { useCalibrationStore } from "../store/useCalibrationStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import {
  avgMonthlyByCategory,
  computeWhatIfBase,
  NEUTRAL_LEVERS,
  project,
  realMonthlyRate,
  steadyFlows,
  autoHorizonYears,
  type Projection,
  type ScenarioLevers,
  type WhatIfBase,
} from "../lib/whatif";
import { netWorthSeries } from "../lib/aggregations";
import { currentPeriod } from "../lib/period";
import { pluralRu } from "../lib/plural";
import { useFireCapital } from "../hooks/useFireCapital";
import { useFireStore } from "../store/useFireStore";
import { isScenarioChanged, useWhatIfStore } from "../store/useWhatIfStore";
import { FILTER_NONE } from "../store/useFiltersStore";
import { MultiSelect } from "../components/MultiSelect";
import { AccountLogo } from "../components/AccountLogo";
import { SectionCard, StatCell, StatRow, type StatTone } from "../components/SectionCard";
import { Slider } from "../components/Slider";
import { Segmented } from "../components/Segmented";
import { HeadCell } from "../components/table/TableParts";
import { cellClass } from "../components/table/tableKit";
import { formatMoney, formatPct } from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { InfoPopover, InfoTerm } from "../components/InfoPopover";
import { ScenarioBar } from "../components/whatif/ScenarioBar";
import { WhatIfChart } from "../components/whatif/WhatIfChart";
import { WhatIfCategories } from "../components/whatif/WhatIfCategories";
import { WhatIfEvents } from "../components/whatif/WhatIfEvents";
import { MoneyField } from "../components/whatif/MoneyField";
import { SERIES_COLOR, durationText, monthYear, pctText } from "../lib/whatifView";

const NOW_NAME = "Как сейчас";

const yearsLabel = (y: number) => `${y} ${pluralRu(y, ["год", "года", "лет"])}`;

/**
 * Счета капитала ↔ выбор в `MultiSelect`. У списка соглашение фильтров:
 * пусто = все, {FILTER_NONE} = ничего; «ничего» здесь — своя сумма.
 */
function excludedToSet(excluded: readonly string[], all: readonly string[]): Set<string> {
  const on = all.filter((t) => !excluded.includes(t));
  if (on.length === 0) return new Set([FILTER_NONE]);
  if (on.length === all.length) return new Set();
  return new Set(on);
}

/**
 * Обратно из выбора в список исключённых. Хранится именно он (общий с FIRE):
 * новый счёт сам попадает в капитал. Исключённые счета, которых сейчас нет в
 * списке (архивные, переименованные), оставляем — FIRE их помнит.
 */
function setToExcluded(next: Set<string>, all: readonly string[], prev: readonly string[]): string[] {
  const foreign = prev.filter((t) => !all.includes(t));
  if (next.has(FILTER_NONE)) return [...foreign, ...all];
  if (next.size === 0) return foreign;
  return [...foreign, ...all.filter((t) => !next.has(t))];
}

/** «12 лет 5 мес», «Уже сейчас», «Не наступит». */
function fireWhen(p: Projection): string {
  if (p.fireYm === null) return "Не наступит";
  if (p.yearsToFire === 0) return "Уже сейчас";
  return durationText(Math.round(p.yearsToFire * 12));
}

/** Лучше или хуже «как сейчас»: денег больше — лучше, срок меньше — лучше. */
function toneOf(value: number, now: number, lowerIsBetter = false): StatTone {
  if (value === now) return "default";
  if (!Number.isFinite(value) || !Number.isFinite(now)) {
    // «Не наступит» против срока — хуже; срок против «не наступит» — лучше.
    const worse = lowerIsBetter ? !Number.isFinite(value) : !Number.isFinite(now);
    return worse ? "expense" : "income";
  }
  const d = lowerIsBetter ? now - value : value - now;
  if (Math.abs(d) < 0.5) return "default";
  return d > 0 ? "income" : "expense";
}

const mulText = (v: number) => `${v >= 1 ? "+" : ""}${formatPct(v - 1, 0)}`;

/**
 * Откуда «сейчас»: доход и расход каждого месяца базы и итог. Без этого
 * среднее не с чем сверить — а расходится оно с ожиданием чаще всего из-за
 * того, какие месяцы и какие операции в него вошли.
 */
function BaseBreakdown({
  base,
  currency,
  median,
}: {
  base: WhatIfBase;
  currency: string;
  median: boolean;
}) {
  return (
    <div className="space-y-2">
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-muted">
            <th className="text-left font-normal pb-1">Месяц</th>
            <th className="text-right font-normal pb-1">Доход</th>
            <th className="text-right font-normal pb-1">Расход</th>
          </tr>
        </thead>
        <tbody>
          {base.monthly.map((m) => (
            <tr key={m.ym}>
              <td className="py-0.5">{monthYear(m.ym)}</td>
              <td className="text-right py-0.5">{formatMoney(m.income, currency)}</td>
              <td className="text-right py-0.5">{formatMoney(m.expense, currency)}</td>
            </tr>
          ))}
          <tr className="font-semibold border-t border-border">
            <td className="pt-1">{median ? "Медиана" : "Среднее"}</td>
            <td className="text-right pt-1">{formatMoney(base.avgIncome, currency)}</td>
            <td className="text-right pt-1">{formatMoney(base.avgExpense, currency)}</td>
          </tr>
        </tbody>
      </table>
      <p className="text-muted">
        Считаются последние полностью прошедшие месяцы, текущий не входит. Переводы между
        своими счетами не учитываются, возвраты уменьшают расход. Не входят категории и
        счета, которые вы исключили в разрезе данных, и внебалансовые счета, если они
        выключены в настройках. Число месяцев меняется в «Допущениях».
      </p>
    </div>
  );
}

interface Row {
  label: string;
  value: (p: Projection) => string;
  num: (p: Projection) => number;
  lowerIsBetter?: boolean;
}

export function WhatIfPage() {
  const transactions = useDataStore((s) => s.transactions);
  // Доходы и расходы — без оборотов и внебалансовых движений (#14); капитал
  // по операциям — по всем, это остаток.
  const analyticsTx = useAnalyticsTransactions();
  const base = useDataStore((s) => s.rates.base);
  const calibration = useCalibrationStore((s) => s.calibration);
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const calibLoaded = useCalibrationStore((s) => s.loaded);
  const hydrateCalibration = useCalibrationStore((s) => s.hydrate);

  useEffect(() => {
    if (!calibLoaded) hydrateCalibration();
  }, [calibLoaded, hydrateCalibration]);

  const store = useWhatIfStore();
  const { assumptions } = store;
  const active = store.scenarios.find((s) => s.id === store.activeId) ?? store.scenarios[0];
  const compare = store.scenarios.find((s) => s.id === store.compareId) ?? null;

  const baseScenario = useMemo(
    () =>
      computeWhatIfBase(analyticsTx, {
        monthStartDay,
        months: assumptions.baseMonths,
        basis: assumptions.basis,
      }),
    [analyticsTx, monthStartDay, assumptions.baseMonths, assumptions.basis]
  );
  const categories = useMemo(
    () => avgMonthlyByCategory(analyticsTx, { monthStartDay, months: assumptions.baseMonths }),
    [analyticsTx, monthStartDay, assumptions.baseMonths]
  );

  const currentNetWorth = useMemo(() => {
    const series = netWorthSeries(transactions, calibration);
    return series.length > 0 ? series[series.length - 1].net : 0;
  }, [transactions, calibration]);

  // Счета капитала — общий с FIRE выбор: капитал везде считается одинаково.
  const { capital, capitalAccounts } = useFireCapital();
  const excluded = useFireStore((s) => s.excluded);
  const replaceExcluded = useFireStore((s) => s.replaceExcluded);
  const accountTitles = useMemo(() => capitalAccounts.map((a) => a.title), [capitalAccounts]);
  const pickedCount = accountTitles.filter((t) => !excluded.includes(t)).length;
  // Счета есть и хоть один выбран — капитал по их балансам; иначе своя сумма,
  // а без своей — остаток по всем операциям.
  const byAccounts = pickedCount > 0;
  const startingCapital = byAccounts
    ? Math.round(capital)
    : (store.manualCapital ?? Math.max(0, Math.round(currentNetWorth)));

  const startYm = currentPeriod(monthStartDay);
  const projections = useMemo(() => {
    const run = (levers: ScenarioLevers, horizonYears: number) =>
      project(baseScenario, levers, categories, { ...assumptions, horizonYears }, startingCapital, startYm);
    const all = [NEUTRAL_LEVERS, active, ...(compare ? [compare] : [])];
    // «До FIRE»: сначала узнаём, когда он наступает у каждого сценария (поиск
    // FIRE от горизонта не зависит), потом строим график ровно до него.
    const horizon =
      assumptions.horizonYears > 0
        ? assumptions.horizonYears
        : autoHorizonYears(all.map((l) => run(l, 1).yearsToFire));
    return {
      horizon,
      now: run(NEUTRAL_LEVERS, horizon),
      active: run(active, horizon),
      compare: compare ? run(compare, horizon) : null,
    };
  }, [baseScenario, categories, assumptions, startingCapital, startYm, active, compare]);

  if (transactions.length === 0) return <EmptyState />;

  const { now: nowProj, active: actProj, compare: cmpProj, horizon } = projections;
  const autoHorizon = assumptions.horizonYears === 0;
  // FIRE сценария за краем графика — скажем об этом прямо на графике и
  // предложим дотянуть его до FIRE.
  const fireBeyond = !autoHorizon && actProj.fireYm !== null && actProj.yearsToFire > horizon;
  const update = store.updateActive;
  const changed = isScenarioChanged(active);
  const realPct = (Math.pow(1 + realMonthlyRate(assumptions), 12) - 1) * 100;
  const months = baseScenario.months;
  const baseSpan =
    months.length === 0
      ? "нет законченных месяцев"
      : months.length === 1
        ? monthYear(months[0]).toLowerCase()
        : `${monthYear(months[0]).toLowerCase()} – ${monthYear(months[months.length - 1]).toLowerCase()} (${months.length} мес)`;

  const capitalAt = (p: Projection, years: number) =>
    p.points[Math.min(years * 12, p.points.length - 1)].capital;
  const checkpoints = [...new Set([1, 5, horizon].filter((y) => y <= horizon))];

  const columns = [
    { key: "now", name: NOW_NAME, color: SERIES_COLOR.now, p: nowProj },
    { key: "active", name: active.name, color: SERIES_COLOR.active, p: actProj },
    ...(cmpProj && compare
      ? [{ key: "compare", name: compare.name, color: SERIES_COLOR.compare, p: cmpProj }]
      : []),
  ];

  const rows: Row[] = [
    { label: "Доход / мес", value: (p) => formatMoney(p.income, base), num: (p) => p.income },
    {
      label: "Расход / мес",
      value: (p) => formatMoney(p.expense, base),
      num: (p) => p.expense,
      lowerIsBetter: true,
    },
    { label: "Откладываете / мес", value: (p) => formatMoney(p.savings, base), num: (p) => p.savings },
    { label: "Норма сбережений", value: (p) => formatPct(p.rate, 0), num: (p) => p.rate * 100 },
    ...checkpoints.map((y) => ({
      label: `Капитал через ${yearsLabel(y)}`,
      value: (p: Projection) => formatMoney(capitalAt(p, y), base),
      num: (p: Projection) => capitalAt(p, y),
    })),
    {
      label: "Цель FIRE",
      value: (p) => formatMoney(p.fireTarget, base),
      num: (p) => p.fireTarget,
      lowerIsBetter: true,
    },
    {
      label: "FIRE наступит",
      value: (p) => (p.fireYm ? monthYear(p.fireYm) : "Не наступит"),
      num: (p) => p.yearsToFire,
      lowerIsBetter: true,
    },
  ];

  // Расход сценария до общего множителя — с изменениями по категориям.
  const expenseBeforeMul = steadyFlows(baseScenario, { ...active, expenseMul: 1 }, categories).expense;
  const currencySign = formatMoney(0, base).replace(/[\d\s,.\u00a0-]/g, "") || base;

  const deltaHorizon = actProj.capitalAtHorizon - nowProj.capitalAtHorizon;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={FlaskConical}
        title="Что-если"
        info={
          <InfoPopover>
            <p>
              Расчёт начинается с ваших{" "}
              <InfoTerm>дохода и расхода за последние прошедшие месяцы</InfoTerm>. Сколько
              месяцев брать и считать среднее или медиану — выбирается в «Допущениях». Текущий
              месяц не учитывается: в нём ещё не все траты.
            </p>
            <p>
              В сценарии можно изменить доход, расход и траты по категориям, а также добавить{" "}
              <InfoTerm>события</InfoTerm> с датой: покупку, кредит, премию. Всё сравнивается с
              «Как сейчас» — тем же расчётом без изменений.
            </p>
            <p>
              Все суммы — в <InfoTerm>сегодняшних ценах</InfoTerm>: инфляция не увеличивает
              числа, а уменьшает доходность. <InfoTerm>FIRE</InfoTerm> — капитал, на доход с
              которого можно жить. При доле изъятия 4% это 25 годовых трат.
            </p>
          </InfoPopover>
        }
      />

      <ScenarioBar horizonLabel={yearsLabel} />

      <StatRow>
        <StatCell
          label="Откладываете в месяц"
          value={formatMoney(actProj.savings, base)}
          tone={toneOf(actProj.savings, nowProj.savings)}
          note={changed ? `Сейчас ${formatMoney(nowProj.savings, base)}` : "Как сейчас"}
        />
        <StatCell
          label="Норма сбережений"
          value={formatPct(actProj.rate, 0)}
          tone={toneOf(actProj.rate * 100, nowProj.rate * 100)}
          note={changed ? `Сейчас ${formatPct(nowProj.rate, 0)}` : "Доля дохода, что остаётся"}
        />
        <StatCell
          label={`Капитал через ${yearsLabel(horizon)}`}
          value={formatMoney(actProj.capitalAtHorizon, base)}
          tone={toneOf(actProj.capitalAtHorizon, nowProj.capitalAtHorizon)}
          note={
            Math.round(deltaHorizon) !== 0
              ? `${formatMoney(deltaHorizon, base, { signed: true })} к «Как сейчас»`
              : `Сейчас ${formatMoney(startingCapital, base)}`
          }
        />
        <StatCell
          label="До FIRE"
          value={fireWhen(actProj)}
          tone={toneOf(actProj.yearsToFire, nowProj.yearsToFire, true)}
          note={
            actProj.fireYm
              ? `${monthYear(actProj.fireYm)} · цель ${formatMoney(actProj.fireTarget, base, { compact: true })}`
              : `Цель ${formatMoney(actProj.fireTarget, base, { compact: true })}`
          }
        />
      </StatRow>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] items-start">
        {/* Рычаги сценария — боковой панелью высотой в окно, со своей
            прокруткой. Колонки здесь разные по природе: рычаги растут с
            каждым событием и категорией, результат — нет. Подогнать их по
            высоте нельзя, поэтому панель просто стоит рядом с тем, что вы
            смотрите, а под ней не остаётся пустоты. Отступы по краям — чтобы
            прокрутка не срезала тени карточек. */}
        <div className="space-y-4 lg:sticky lg:top-[calc(var(--app-header-h)+0.75rem)] lg:max-h-[calc(100vh-var(--app-header-h)-1.5rem)] lg:overflow-y-auto lg:-m-2 lg:p-2">
          {/* Капитал первым: от него считается всё остальное. */}
          <SectionCard icon={Wallet} title="Стартовый капитал">
            <div className="space-y-2">
              {accountTitles.length > 0 && (
                <MultiSelect
                  className="w-full"
                  variant="field"
                  label=""
                  options={accountTitles}
                  selected={excludedToSet(excluded, accountTitles)}
                  onChange={(next) =>
                    void replaceExcluded(setToExcluded(next, accountTitles, excluded))
                  }
                  renderIcon={(title) => <AccountLogo title={title} size={18} />}
                  unitForms={["счёт", "счёта", "счетов"]}
                  searchPlaceholder="Поиск счёта"
                  noneSummary="Сумма вручную"
                  namesInSummary
                />
              )}
              {byAccounts ? (
                <div className="input text-sm flex items-center text-muted bg-panel2/60 cursor-not-allowed tabular-nums">
                  {formatMoney(startingCapital, base)}
                </div>
              ) : (
                <MoneyField
                  ariaLabel="Стартовый капитал"
                  suffix={currencySign}
                  value={startingCapital}
                  onCommit={(v) => void store.setManualCapital(v)}
                  wide
                />
              )}
              <div className="text-xs text-muted">
                {accountTitles.length === 0
                  ? `По умолчанию — остаток по всем операциям (${formatMoney(currentNetWorth, base)}).`
                  : byAccounts
                    ? "Балансы выбранных счетов по текущему курсу. Выбор общий с FIRE в «Здоровье»."
                    : "Счета не выбраны — введите капитал сами."}
              </div>
            </div>
          </SectionCard>

          <SectionCard
            icon={Coins}
            title="Доход и расходы"
            subtitle={`«Сейчас» — ${assumptions.basis === "median" ? "медиана" : "среднее"} за ${baseSpan}`}
            info={<BaseBreakdown base={baseScenario} currency={base} median={assumptions.basis === "median"} />}
            right={
              changed && (
                <button
                  type="button"
                  onClick={() => void store.resetActive()}
                  className="btn-ghost text-xs"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Сбросить
                </button>
              )
            }
          >
            <div className="space-y-4">
              <Slider
                layout="stacked"
                label="Доход в месяц"
                value={active.incomeMul}
                min={0.5}
                max={2.0}
                step={0.05}
                format={mulText}
                control={
                  <MoneyField
                    ariaLabel="Доход в месяц по сценарию"
                    suffix={currencySign}
                    value={actProj.income}
                    disabled={baseScenario.avgIncome <= 0}
                    onCommit={(v) => void update({ incomeMul: v / baseScenario.avgIncome })}
                  />
                }
                hint={`Сейчас ${formatMoney(baseScenario.avgIncome, base)} · ${mulText(active.incomeMul)}`}
                onChange={(v) => void update({ incomeMul: v })}
              />
              <Slider
                layout="stacked"
                label="Расход в месяц"
                value={active.expenseMul}
                min={0.5}
                max={1.5}
                step={0.05}
                format={mulText}
                control={
                  <MoneyField
                    ariaLabel="Расход в месяц по сценарию"
                    suffix={currencySign}
                    value={actProj.expense}
                    disabled={expenseBeforeMul <= 0}
                    // Общий множитель ложится ПОСЛЕ категорий — вписанная
                    // сумма делится на расход уже с ними.
                    onCommit={(v) => void update({ expenseMul: v / expenseBeforeMul })}
                  />
                }
                hint={`Сейчас ${formatMoney(baseScenario.avgExpense, base)} · ${mulText(active.expenseMul)}`}
                onChange={(v) => void update({ expenseMul: v })}
              />
              <Slider
                layout="stacked"
                label="Откладывать сверх того"
                value={active.extraMonthlySave}
                min={0}
                max={Math.max(50000, Math.round((baseScenario.avgIncome * 0.5) / 1000) * 1000)}
                step={500}
                format={(v) => `+${formatMoney(v, base)}`}
                control={
                  <MoneyField
                    ariaLabel="Откладывать сверх того в месяц"
                    suffix={currencySign}
                    value={active.extraMonthlySave}
                    onCommit={(v) => void update({ extraMonthlySave: v })}
                  />
                }
                hint="Сверх того, что остаётся от дохода после расходов"
                onChange={(v) => void update({ extraMonthlySave: v })}
              />
            </div>
          </SectionCard>

          <WhatIfCategories
            categories={categories}
            categoryMul={active.categoryMul}
            base={base}
            onChange={(categoryMul) => void update({ categoryMul })}
          />

          <WhatIfEvents
            events={active.events}
            base={base}
            startYm={startYm}
            onChange={(events) => void update({ events })}
          />
        </div>

        {/* Результат и допущения — прокручиваются вместе со страницей. */}
        <div className="space-y-4">
          <SectionCard
            icon={LineChartIcon}
            title="Капитал"
            subtitle={
              fireBeyond ? (
                <>
                  FIRE — {monthYear(actProj.fireYm!).toLowerCase()}, за краем графика.{" "}
                  <button
                    type="button"
                    className="text-accent hover:underline"
                    onClick={() => void store.updateAssumptions({ horizonYears: 0 })}
                  >
                    Показать до FIRE
                  </button>
                </>
              ) : autoHorizon ? (
                `До FIRE — ${yearsLabel(horizon)}, в сегодняшних ценах`
              ) : (
                `На ${yearsLabel(horizon)} вперёд, в сегодняшних ценах`
              )
            }
            right={
              <div className="flex items-center gap-3 text-xs text-muted flex-wrap justify-end">
                {columns.map((c) => (
                  <span key={c.key} className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block w-3 h-0.5 rounded"
                      style={{ background: c.color }}
                      aria-hidden="true"
                    />
                    {c.name}
                  </span>
                ))}
              </div>
            }
          >
            <WhatIfChart
              now={{ name: NOW_NAME, projection: nowProj }}
              active={{ name: active.name, projection: actProj }}
              compare={compare && cmpProj ? { name: compare.name, projection: cmpProj } : null}
              base={base}
            />
          </SectionCard>

          <SectionCard icon={Table2} title="Сравнение">
            <table className="w-full table-fixed">
              <thead>
                <tr>
                  <HeadCell type="text" label="Показатель" />
                  {columns.map((c) => (
                    <HeadCell
                      key={c.key}
                      type={c.key === "active" ? "main" : "money"}
                      label={c.name}
                      width="9.5rem"
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const nowNum = r.num(nowProj);
                  return (
                    <tr key={r.label}>
                      <td className={cellClass("text")}>{r.label}</td>
                      {columns.map((c) => {
                        const t = c.key === "now" ? "default" : toneOf(r.num(c.p), nowNum, r.lowerIsBetter);
                        return (
                          <td
                            key={c.key}
                            className={cellClass(c.key === "active" ? "main" : "money", {
                              muted: c.key === "now",
                              tone: t === "income" ? "income" : t === "expense" ? "expense" : "neutral",
                            })}
                          >
                            {r.value(c.p)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </SectionCard>

          <SectionCard
            icon={SlidersHorizontal}
            title="Допущения"
            subtitle="Общие для всех сценариев"
          >
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <Slider
                layout="stacked"
                hintLines={2}
                label="Доходность капитала"
                value={assumptions.returnPct}
                min={0}
                max={20}
                step={0.5}
                format={(v) => `${pctText(v)}% в год`}
                hint="Сколько в год приносят накопления: вклад, облигации, акции. 0 — деньги просто лежат."
                onChange={(v) => void store.updateAssumptions({ returnPct: v })}
              />
              <Slider
                layout="stacked"
                hintLines={2}
                label="Инфляция"
                value={assumptions.inflationPct}
                min={0}
                max={15}
                step={0.5}
                format={(v) => `${pctText(v)}% в год`}
                hint={
                  assumptions.returnPct || assumptions.inflationPct
                    ? `Реальная доходность ${pctText(realPct)}% в год — столько капитал прибавляет в сегодняшних ценах.`
                    : "Суммы — в сегодняшних ценах: инфляция уменьшает доходность, а не увеличивает суммы."
                }
                onChange={(v) => void store.updateAssumptions({ inflationPct: v })}
              />
              <Slider
                layout="stacked"
                hintLines={2}
                label="Доля изъятия для FIRE"
                value={assumptions.withdrawalPct}
                min={2.5}
                max={6}
                step={0.25}
                format={(v) => `${pctText(v)}% в год`}
                hint={`Сколько капитала можно тратить в год. Цель FIRE — ${pctText(Math.round(1000 / assumptions.withdrawalPct) / 10)} годовых трат.`}
                onChange={(v) => void store.updateAssumptions({ withdrawalPct: v })}
              />
              <div className="space-y-2">
                <div className="text-sm">База расчёта</div>
                <div className="flex flex-wrap gap-2">
                  <Segmented
                    size="sm"
                    label="Сколько месяцев брать"
                    value={assumptions.baseMonths}
                    onChange={(v) => void store.updateAssumptions({ baseMonths: v })}
                    options={[3, 6, 12].map((m) => ({ value: m, label: `${m} мес` }))}
                  />
                  <Segmented
                    size="sm"
                    label="Как усреднять"
                    value={assumptions.basis}
                    onChange={(v) => void store.updateAssumptions({ basis: v })}
                    options={[
                      { value: "average", label: "Среднее", title: "Среднее арифметическое за месяцы" },
                      {
                        value: "median",
                        label: "Медиана",
                        title: "Типичный месяц: разовые крупные суммы на него не влияют",
                      },
                    ]}
                  />
                </div>
                <div className="text-xs text-muted min-h-8">
                  {baseSpan[0].toUpperCase() + baseSpan.slice(1)}: доход {formatMoney(baseScenario.avgIncome, base)}, расход{" "}
                  {formatMoney(baseScenario.avgExpense, base)} в месяц.
                </div>
              </div>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
