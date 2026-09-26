import { useEffect, useMemo } from "react";
import {
  FlaskConical,
  TrendingUp,
  TrendingDown,
  Flame,
  RotateCcw,
  Coins,
  PiggyBank,
} from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useAnalyticsTransactions } from "../hooks/useAnalyticsTransactions";
import { useCalibrationStore } from "../store/useCalibrationStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import {
  computeWhatIfBase,
  computeWhatIf,
  avgMonthlyByCategory,
  type WhatIfInputs,
} from "../lib/whatif";
import { netWorthSeries } from "../lib/aggregations";
import { useFireCapital } from "../hooks/useFireCapital";
import { useFireStore } from "../store/useFireStore";
import { isScenarioChanged, useWhatIfStore } from "../store/useWhatIfStore";
import { FILTER_NONE } from "../store/useFiltersStore";
import { MultiSelect } from "../components/MultiSelect";
import { AccountLogo } from "../components/AccountLogo";
import { CardHeader } from "../components/CardHeader";
import { Slider } from "../components/Slider";
import { HeadCell } from "../components/table/TableParts";
import { cellClass } from "../components/table/tableKit";
import { formatMoney, formatPct, formatFixed } from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { InfoPopover, InfoTerm } from "../components/InfoPopover";
import { Callout } from "../components/Callout";

/**
 * Счета капитала ↔ выбор в `MultiSelect`. Хранится список ИСКЛЮЧЁННЫХ (общий с
 * FIRE: новый счёт сам попадает в капитал), а у списка соглашение фильтров:
 * пусто = все, {FILTER_NONE} = ничего. «Ничего» здесь — своя сумма.
 */
function excludedToSet(excluded: readonly string[], all: readonly string[]): Set<string> {
  const on = all.filter((t) => !excluded.includes(t));
  if (on.length === 0) return new Set([FILTER_NONE]);
  if (on.length === all.length) return new Set();
  return new Set(on);
}

function setToExcluded(next: Set<string>, all: readonly string[], prev: readonly string[]): string[] {
  // Исключённые счета, которых сейчас нет в списке (архивные, переименованные),
  // оставляем как были — выбор общий с FIRE, и терять его там нельзя.
  const foreign = prev.filter((t) => !all.includes(t));
  if (next.has(FILTER_NONE)) return [...foreign, ...all];
  if (next.size === 0) return foreign;
  return [...foreign, ...all.filter((t) => !next.has(t))];
}

function years(v: number): string {
  if (!Number.isFinite(v)) return "∞";
  if (v < 0) return "0";
  if (v < 1) return `${(v * 12).toFixed(0)} мес`;
  if (v >= 100) return "100+";
  return formatFixed(v);
}

export function WhatIfPage() {
  const transactions = useDataStore((s) => s.transactions);
  // Income/expense scenario base excludes turnover / off-balance flows (#14);
  // the net-worth baseline below stays on raw transactions (it's a balance, and
  // excluded reimbursements are still real money that moved).
  const analyticsTx = useAnalyticsTransactions();
  const base = useDataStore((s) => s.rates.base);
  const calibration = useCalibrationStore((s) => s.calibration);
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const calibLoaded = useCalibrationStore((s) => s.loaded);
  const hydrateCalibration = useCalibrationStore((s) => s.hydrate);

  useEffect(() => {
    if (!calibLoaded) hydrateCalibration();
  }, [calibLoaded, hydrateCalibration]);

  const baseScenario = useMemo(
    () => computeWhatIfBase(analyticsTx, monthStartDay),
    [analyticsTx, monthStartDay]
  );
  const categories = useMemo(
    () => avgMonthlyByCategory(analyticsTx, 8, monthStartDay),
    [analyticsTx, monthStartDay]
  );

  const currentNetWorth = useMemo(() => {
    const series = netWorthSeries(transactions, calibration);
    return series.length > 0 ? series[series.length - 1].net : 0;
  }, [transactions, calibration]);

  // Сценарий сохраняется и переносится между устройствами (#107).
  const scenario = useWhatIfStore();
  const update = scenario.update;

  // Счета капитала — общий с FIRE выбор: капитал везде считается одинаково.
  const { capital, capitalAccounts } = useFireCapital();
  const excluded = useFireStore((s) => s.excluded);
  const replaceExcluded = useFireStore((s) => s.replaceExcluded);
  const accountTitles = useMemo(() => capitalAccounts.map((a) => a.title), [capitalAccounts]);
  const pickedCount = accountTitles.filter((t) => !excluded.includes(t)).length;
  // Счета есть и хоть один выбран — капитал по их балансам; иначе своя сумма,
  // а без своей — чистый капитал по операциям, как было до выбора счетов.
  const byAccounts = pickedCount > 0;
  const autoCapital = Math.max(0, Math.round(currentNetWorth));
  const startingCapital = byAccounts
    ? Math.max(0, Math.round(capital))
    : (scenario.manualCapital ?? autoCapital);

  const inputs: WhatIfInputs = useMemo(
    () => ({
      incomeMul: scenario.incomeMul,
      expenseMul: scenario.expenseMul,
      extraMonthlySave: scenario.extraMonthlySave,
      categoryMul: scenario.categoryMul,
      startingCapital,
    }),
    [scenario.incomeMul, scenario.expenseMul, scenario.extraMonthlySave, scenario.categoryMul, startingCapital]
  );

  const out = useMemo(
    () => computeWhatIf(baseScenario, inputs, categories),
    [baseScenario, inputs, categories]
  );

  if (transactions.length === 0) return <EmptyState />;

  // Своя сумма капитала — тоже часть сценария: «Сбросить» возвращает и её.
  const dirty =
    isScenarioChanged(scenario) || (!byAccounts && scenario.manualCapital !== null);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={FlaskConical}
        title="Что-если — сценарии"
        info={
          <InfoPopover>
            <p>
              За точку отсчёта берём ваши{" "}
              <InfoTerm>средние доход и расход за 6 месяцев</InfoTerm>.
              Слайдеры меняют именно их: «расходы −10%» — это десять процентов
              от среднего месячного расхода, а не от какой-то одной покупки.
            </p>
            <p>
              Дальше всё считается в лоб, без процентов на остаток:{" "}
              <InfoTerm>откладываете в месяц = доход − расход + «отложить
              дополнительно»</InfoTerm>, а капитал через год — это стартовый
              капитал плюс двенадцать таких месяцев. Инвестиционной доходности
              здесь нет намеренно: это прикидка «что будет, если жить так же»,
              а не прогноз портфеля.
            </p>
            <p>
              <InfoTerm>Срок до FIRE</InfoTerm> — сколько лет копить до суммы,
              на проценты с которой можно жить: годовые расходы{" "}
              <InfoTerm>× 25</InfoTerm> (это правило 4%). Обратите внимание:
              цель считается от НОВЫХ расходов, поэтому урезание трат
              приближает FIRE дважды — и копится больше, и цель становится
              меньше.
            </p>
          </InfoPopover>
        }
      />

      <div className="grid md:grid-cols-2 gap-4">
        {/* Inputs */}
        <div className="card-tray card-pad space-y-5">
          <div>
            {/* «Сбросить» — в шапке карточки с бегунками, которые он
                возвращает: в шапке раздела он появлялся через экран от них. */}
            <CardHeader
              icon={Coins}
              title="Основные параметры"
              right={
                dirty && (
                  <button onClick={() => void scenario.reset()} className="btn-ghost text-xs">
                    <RotateCcw className="w-3.5 h-3.5" />
                    Сбросить
                  </button>
                )
              }
            />
            <div className="space-y-4">
              <Slider
                layout="stacked"
                label="Изменение дохода"
                value={inputs.incomeMul}
                min={0.5}
                max={2.0}
                step={0.05}
                format={(v) => `${v >= 1 ? "+" : ""}${formatPct(v - 1, 0)}`}
                hint={`Текущий: ${formatMoney(baseScenario.avgIncome, base)}/мес → ${formatMoney(out.newIncome, base)}/мес`}
                onChange={(v) => void update({ incomeMul: v })}
              />
              <Slider
                layout="stacked"
                label="Изменение расхода"
                value={inputs.expenseMul}
                min={0.5}
                max={1.5}
                step={0.05}
                format={(v) => `${v >= 1 ? "+" : ""}${formatPct(v - 1, 0)}`}
                hint={`Текущий: ${formatMoney(baseScenario.avgExpense, base)}/мес → ${formatMoney(out.newExpense, base)}/мес`}
                onChange={(v) => void update({ expenseMul: v })}
              />
              <Slider
                layout="stacked"
                label="Дополнительно отложить в месяц"
                value={inputs.extraMonthlySave}
                min={0}
                max={Math.max(50000, baseScenario.avgIncome * 0.5)}
                step={500}
                format={(v) => `+${formatMoney(v, base)}`}
                hint="Фиксированная сумма поверх нынешнего баланса доход−расход"
                onChange={(v) => void update({ extraMonthlySave: v })}
              />
            </div>
            <div className="mt-4 space-y-2">
              <label className="label block">Стартовый капитал</label>
              {accountTitles.length > 0 && (
                <MultiSelect
                  className="w-full"
                  variant="field"
                  label=""
                  options={accountTitles}
                  selected={excludedToSet(excluded, accountTitles)}
                  onChange={(next) => void replaceExcluded(setToExcluded(next, accountTitles, excluded))}
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
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="1000"
                    value={startingCapital}
                    onChange={(e) => void update({ manualCapital: Number(e.target.value) || 0 })}
                    className="input text-sm flex-1 tabular-nums"
                  />
                  <span className="text-xs text-muted">{base}</span>
                </div>
              )}
              <div className="text-[11px] text-muted">
                {accountTitles.length === 0
                  ? `По умолчанию — текущий совокупный баланс (${formatMoney(currentNetWorth, base)}).`
                  : byAccounts
                    ? `Сумма балансов выбранных счетов по текущему курсу. Выбор общий с FIRE в «Здоровье».`
                    : `Счета не выбраны — введите капитал сами.`}
              </div>
            </div>
          </div>

          {categories.length > 0 && (
            <div>
              <CardHeader icon={TrendingDown} title={`Категории расходов (топ-${categories.length})`} />
              <div className="space-y-3">
                {categories.map((c) => {
                  const mul = inputs.categoryMul?.[c.category] ?? 1;
                  return (
                    <Slider
                      key={c.category}
                      layout="stacked"
                      label={c.category}
                      value={mul}
                      min={0}
                      max={2}
                      step={0.05}
                      format={(v) => (v === 0 ? "−100%" : `${v >= 1 ? "+" : ""}${formatPct(v - 1, 0)}`)}
                      hint={`Сейчас ${formatMoney(c.monthly, base)}/мес → ${formatMoney(c.monthly * mul, base)}/мес`}
                      onChange={(v) =>
                        void update({ categoryMul: { ...scenario.categoryMul, [c.category]: v } })
                      }
                    />
                  );
                })}
              </div>
              <div className="text-[11px] text-muted mt-2">
                Категории применяются ПЕРЕД общим множителем расхода.
              </div>
            </div>
          )}
        </div>

        {/* Outputs */}
        <div className="space-y-4">
          {/* Compare scenarios */}
          <div className="card-tray px-4 py-3">
            <CardHeader title="Сравнение" />
            {/* Две строки сценария — порядок метрик и есть смысл, сортировать нечего. */}
            <table className="w-full table-fixed">
              <thead>
                <tr>
                  <HeadCell type="text" label="Метрика" />
                  <HeadCell type="money" label="Сейчас" width="9.5rem" />
                  <HeadCell type="main" label="Если так" width="9.5rem" />
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className={cellClass("text")}>Доход / мес</td>
                  <td className={cellClass("money", { muted: true })}>
                    {formatMoney(baseScenario.avgIncome, base)}
                  </td>
                  <td className={cellClass("main")}>{formatMoney(out.newIncome, base)}</td>
                </tr>
                <tr>
                  <td className={cellClass("text")}>Расход / мес</td>
                  <td className={cellClass("money", { muted: true })}>
                    {formatMoney(baseScenario.avgExpense, base)}
                  </td>
                  <td className={cellClass("main")}>{formatMoney(out.newExpense, base)}</td>
                </tr>
                <tr>
                  <td className={cellClass("text")}>Сбережения / мес</td>
                  <td className={cellClass("money", { muted: true })}>
                    {formatMoney(baseScenario.avgSavings, base)}
                  </td>
                  {/* Цвет — только у итога сценария: стало лучше или хуже, чем сейчас. */}
                  <td
                    className={cellClass("main", {
                      tone:
                        out.newSavings > baseScenario.avgSavings
                          ? "income"
                          : out.newSavings < baseScenario.avgSavings
                            ? "expense"
                            : "neutral",
                    })}
                  >
                    {formatMoney(out.newSavings, base)}
                  </td>
                </tr>
                <tr>
                  <td className={cellClass("text")}>Норма сбережений</td>
                  {/* Процент в колонке сумм — тем же выравниванием, что суммы над ним. */}
                  <td className={cellClass("money", { muted: true })}>{formatPct(baseScenario.savingsRate, 0)}</td>
                  <td className={cellClass("main")}>{formatPct(out.newRate, 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* FIRE */}
          <div className="card-tray card-pad">
            <CardHeader icon={Flame} tone="warn" title="FIRE" />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="label">Лет до FIRE сейчас</div>
                <div className="stat-num">{years(baseScenario.yearsToFireBase)}</div>
              </div>
              <div>
                <div className="label">При этом сценарии</div>
                <div
                  className={`stat-num ${out.yearsToFire < baseScenario.yearsToFireBase ? "text-income" : out.yearsToFire > baseScenario.yearsToFireBase ? "text-expense" : ""}`}
                >
                  {years(out.yearsToFire)}
                </div>
              </div>
            </div>
            {Math.abs(out.yearsSavedOnFire) > 0.1 && Number.isFinite(out.yearsSavedOnFire) && (
              <div className="mt-3 text-sm">
                {out.yearsSavedOnFire > 0 ? (
                  <span className="text-income">
                    Сэкономлено {formatFixed(out.yearsSavedOnFire)} лет до финансовой
                    свободы
                  </span>
                ) : (
                  <span className="text-expense">
                    Срок отодвинется на {formatFixed(Math.abs(out.yearsSavedOnFire))} лет
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Projected capital */}
          <div className="card-tray card-pad">
            <CardHeader icon={PiggyBank} tone="accent2" title="Прогноз капитала" />
            <div className="grid grid-cols-3 gap-3">
              <MoneyStat label="Через 1 год" value={out.projected1y} base={base} />
              <MoneyStat label="Через 5 лет" value={out.projected5y} base={base} />
              <MoneyStat label="Через 10 лет" value={out.projected10y} base={base} />
            </div>
            <div className="text-[11px] text-muted mt-3">
              Линейный прогноз без учёта доходности инвестиций. Реальные суммы при
              разумной доходности будут больше за счёт сложного процента.
            </div>
          </div>

          {/* Annual delta */}
          {Math.abs(out.annualSavingsDelta) > 100 && (
            <Callout
              size="banner"
              tone={out.annualSavingsDelta > 0 ? "income" : "expense"}
              icon={out.annualSavingsDelta > 0 ? TrendingUp : TrendingDown}
            >
              За год это{" "}
              <strong className={out.annualSavingsDelta > 0 ? "text-income" : "text-expense"}>
                {out.annualSavingsDelta > 0 ? "+" : ""}
                {formatMoney(out.annualSavingsDelta, base)}
              </strong>{" "}
              к текущей траектории.
            </Callout>
          )}
        </div>
      </div>
    </div>
  );
}

// Inline label/value pair used INSIDE a card, so it deliberately is not a
// `StatRow` cell (the row renders its own card).
function MoneyStat({ label, value, base }: { label: string; value: number; base: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="stat-num text-base">{formatMoney(value, base)}</div>
    </div>
  );
}
