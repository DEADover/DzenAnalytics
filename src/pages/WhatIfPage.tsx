import { useEffect, useMemo, useState } from "react";
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
import {
  computeWhatIfBase,
  computeWhatIf,
  avgMonthlyByCategory,
  type WhatIfInputs,
} from "../lib/whatif";
import { netWorthSeries } from "../lib/aggregations";
import { CardHeader } from "../components/CardHeader";
import { Slider } from "../components/Slider";
import { HeadCell } from "../components/table/TableParts";
import { cellClass } from "../components/table/tableKit";
import { formatMoney, formatPct, formatFixed } from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { InfoPopover, InfoTerm } from "../components/InfoPopover";
import { Callout } from "../components/Callout";

const INITIAL: WhatIfInputs = {
  incomeMul: 1,
  expenseMul: 1,
  extraMonthlySave: 0,
  startingCapital: 0,
  categoryMul: {},
};

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
  const calibLoaded = useCalibrationStore((s) => s.loaded);
  const hydrateCalibration = useCalibrationStore((s) => s.hydrate);

  useEffect(() => {
    if (!calibLoaded) hydrateCalibration();
  }, [calibLoaded, hydrateCalibration]);

  const baseScenario = useMemo(() => computeWhatIfBase(analyticsTx), [analyticsTx]);
  const categories = useMemo(() => avgMonthlyByCategory(analyticsTx, 8), [analyticsTx]);

  const currentNetWorth = useMemo(() => {
    const series = netWorthSeries(transactions, calibration);
    return series.length > 0 ? series[series.length - 1].net : 0;
  }, [transactions, calibration]);

  const [inputs, setInputs] = useState<WhatIfInputs>(() => ({
    ...INITIAL,
    startingCapital: Math.max(0, Math.round(currentNetWorth)),
  }));

  // Sync starting capital when calibration changes — but only until the
  // user edits it (capitalTouched). This is a deliberate "seed an
  // editable field from external data" effect, not derivable in render.
  const [capitalTouched, setCapitalTouched] = useState(false);
  useEffect(() => {
    if (!capitalTouched) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInputs((prev) => ({
        ...prev,
        startingCapital: Math.max(0, Math.round(currentNetWorth)),
      }));
    }
  }, [currentNetWorth, capitalTouched]);

  const out = useMemo(
    () => computeWhatIf(baseScenario, inputs, categories),
    [baseScenario, inputs, categories]
  );

  function reset() {
    setInputs({ ...INITIAL, startingCapital: Math.max(0, Math.round(currentNetWorth)) });
    setCapitalTouched(false);
  }

  if (transactions.length === 0) return <EmptyState />;

  const dirty =
    inputs.incomeMul !== 1 ||
    inputs.expenseMul !== 1 ||
    inputs.extraMonthlySave !== 0 ||
    Object.values(inputs.categoryMul || {}).some((v) => v !== 1);

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
                  <button onClick={reset} className="btn-ghost text-xs">
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
                onChange={(v) => setInputs((prev) => ({ ...prev, incomeMul: v }))}
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
                onChange={(v) => setInputs((prev) => ({ ...prev, expenseMul: v }))}
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
                onChange={(v) => setInputs((prev) => ({ ...prev, extraMonthlySave: v }))}
              />
            </div>
            <div className="mt-4">
              <label className="label block mb-1">Стартовый капитал</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="1000"
                  value={inputs.startingCapital}
                  onChange={(e) => {
                    setCapitalTouched(true);
                    setInputs((prev) => ({
                      ...prev,
                      startingCapital: Number(e.target.value) || 0,
                    }));
                  }}
                  className="input text-sm flex-1"
                />
                <span className="text-xs text-muted">{base}</span>
              </div>
              <div className="text-[11px] text-muted mt-1">
                По умолчанию — текущий совокупный баланс (
                {formatMoney(currentNetWorth, base)}).
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
                        setInputs((prev) => ({
                          ...prev,
                          categoryMul: { ...prev.categoryMul, [c.category]: v },
                        }))
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
