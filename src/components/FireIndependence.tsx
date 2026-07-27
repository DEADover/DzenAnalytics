import { useMemo, useState } from "react";
import { Flame, Wallet, ChevronDown, Check, Info } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useFireStore } from "../store/useFireStore";
import { useFireCapital } from "../hooks/useFireCapital";
import { useAnalyticsTransactions } from "../hooks/useAnalyticsTransactions";
import { groupByMonth } from "../lib/aggregations";
import { formatMoney } from "../lib/format";
import { Tooltip } from "./Tooltip";
import { TooltipFacts } from "./TooltipFacts";

/** FIRE goal on the 4%-rule: 25 годовых расходов = 300 месяцев. */
const FIRE_MONTHS = 300;

// Пустая строка = абзац: бабл рендерит текст с `whitespace-pre-line`, так что
// три коротких мысли читаются лучше, чем один плотный блок на пять строк.
const INTRO = [
  "FIRE — это когда накоплений столько, что на доход с них можно жить, не завися от зарплаты.",
  "Нужная сумма — обязательные расходы за год × 25 (правило 4%): снимая около 4% в год, вы покрываете обязательные траты, а накопления не иссякают.",
  "Цель считается от обязательных расходов — это порог финансовой безопасности. Чтобы сохранить весь текущий уровень жизни, ориентир будет выше.",
].join("\n\n");

/** Correct Russian plural for «год» (1 год · 2 года · 5 лет). */
function yearsWord(n: number): string {
  const a = Math.abs(n) % 100;
  const b = Math.abs(n) % 10;
  if (a > 10 && a < 20) return "лет";
  if (b === 1) return "год";
  if (b >= 2 && b <= 4) return "года";
  return "лет";
}

function yearsFmt(n: number): string {
  const r = Math.round(n);
  return `${r} ${yearsWord(r)}`;
}

/** KPI caption that advertises a formula tooltip on hover (issue #35). */
const kpiLabelCls =
  "text-xs text-muted cursor-help border-b border-dotted border-muted/60 inline-block";

/**
 * FIRE «financial independence» snapshot — compact «Вариант 5» layout: a slim
 * progress bar (capital → target), a 4-cell KPI band, and an interactive
 * savings-rate slider showing the resulting years-to-goal live. The long
 * explanation hides behind an ⓘ tooltip; capital comes from `useFireCapital`
 * and the target from the SAME rolling obligatory expense as the chart.
 */
export function FireIndependence({
  avgObligatoryMonthly,
  bare = false,
}: {
  avgObligatoryMonthly: number;
  /** Render content only (no card wrapper) — for merging with the chart. */
  bare?: boolean;
}) {
  // Turnover / off-balance flows the user excluded (#14) must NOT inflate the
  // spending here: the FIRE TARGET already comes in filtered (via
  // `avgObligatoryMonthly`, computed from the chart's analytics dataset), so
  // reading the raw feed made one block quote two different realities — the
  // savings rate and «лет до цели» counted turnover the user had switched off.
  const transactions = useAnalyticsTransactions();
  const base = useDataStore((s) => s.rates.base);
  const excluded = useFireStore((s) => s.excluded);
  const toggleExcluded = useFireStore((s) => s.toggle);
  const { capital, capitalAccounts } = useFireCapital();

  // Savings pace (income − all expense, last 6 mo) drives «лет до цели».
  const months = useMemo(() => groupByMonth(transactions), [transactions]);
  const recent = months.slice(-6);
  const avgIncome = recent.length
    ? recent.reduce((s, m) => s + m.income, 0) / recent.length
    : 0;
  const avgExpense = recent.length
    ? recent.reduce((s, m) => s + m.expense, 0) / recent.length
    : 0;
  const avgSavings = avgIncome - avgExpense;
  const savingsRate = avgIncome > 0 ? avgSavings / avgIncome : 0;
  const currentRatePct = Math.round(savingsRate * 100);

  const [showAccounts, setShowAccounts] = useState(false);
  const [scenarioRate, setScenarioRate] = useState(() =>
    Math.min(Math.max(currentRatePct, 1), 99)
  );

  // Target = 25 годовых ОБЯЗАТЕЛЬНЫХ расходов, та же база, что и на графике.
  const annualObligatory = avgObligatoryMonthly * 12;
  const fireTarget = avgObligatoryMonthly * FIRE_MONTHS;

  const capitalProgress = fireTarget > 0 ? capital / fireTarget : 0;
  const fireAchieved = fireTarget > 0 && capital >= fireTarget;
  const remainingToFire = Math.max(fireTarget - capital, 0);
  const yearsToFire = fireAchieved
    ? 0
    : avgSavings > 0
      ? remainingToFire / (avgSavings * 12)
      : Infinity;

  const yearsHeader = fireAchieved
    ? "цель достигнута 🎉"
    : Number.isFinite(yearsToFire)
      ? `${yearsFmt(yearsToFire)} до цели`
      : "расходы больше доходов";

  // Interactive scenario: drag the savings rate → live years-to-goal.
  const scenMonthly = avgIncome * (scenarioRate / 100);
  const scenYears = fireAchieved
    ? 0
    : scenMonthly > 0
      ? remainingToFire / (scenMonthly * 12)
      : Infinity;

  return (
    <div className={bare ? "" : "card card-pad"}>
      <div className="flex items-center gap-2 mb-4">
        <Flame className="w-4 h-4 text-accent" />
        <span className="font-semibold">FIRE — финансовая независимость</span>
        <Tooltip content={INTRO}>
          <span className="cursor-help text-muted hover:text-text">
            <Info className="w-3.5 h-3.5" />
          </span>
        </Tooltip>
      </div>

      {/* Progress: % пути + лет до цели */}
      <div className="flex items-baseline justify-between flex-wrap gap-2 text-sm mb-1.5">
        <Tooltip
          content={
            <TooltipFacts
              title="Капитал ÷ цель × 100"
              facts={[
                { label: "Капитал", value: formatMoney(capital, base) },
                { label: "Цель", value: formatMoney(fireTarget, base) },
              ]}
            />
          }
        >
          <span className="tabular-nums cursor-help">
            <span className={`font-semibold ${fireAchieved ? "text-income" : "text-accent"}`}>
              {(capitalProgress * 100).toFixed(capitalProgress >= 1 ? 0 : 1)}%
            </span>{" "}
            <span className="text-muted border-b border-dotted border-muted/60">пути</span>
          </span>
        </Tooltip>
        <Tooltip
          content={
            fireAchieved ? (
              "Капитал уже больше цели — снимая ~4% в год, вы покрываете обязательные траты."
            ) : Number.isFinite(yearsToFire) ? (
              <TooltipFacts
                title="(цель − капитал) ÷ сбережения за год"
                facts={[
                  { label: "Осталось накопить", value: formatMoney(remainingToFire, base) },
                  { label: "Откладываете в месяц", value: formatMoney(avgSavings, base) },
                  { label: "За год", value: formatMoney(avgSavings * 12, base) },
                ]}
                note="Сбережения — средние за последние 6 месяцев."
              />
            ) : (
              <TooltipFacts
                title="Срок не считается: расход больше дохода"
                facts={[
                  { label: "Доход", value: formatMoney(avgIncome, base) },
                  { label: "Расход", value: formatMoney(avgExpense, base) },
                ]}
                note="Средние за последние 6 месяцев."
              />
            )
          }
        >
          <span
            className={`tabular-nums cursor-help border-b border-dotted border-muted/60 ${fireAchieved ? "text-income" : Number.isFinite(yearsToFire) ? "text-muted" : "text-expense"}`}
          >
            {yearsHeader}
          </span>
        </Tooltip>
      </div>
      <div className="h-2 rounded-full bg-panel2 overflow-hidden">
        <div
          className={`h-full rounded-full ${fireAchieved ? "bg-income" : "bg-accent"}`}
          style={{ width: `${Math.min(Math.max(capitalProgress, 0), 1) * 100}%` }}
        />
      </div>

      {/* Accounts expander (functional — which accounts count as capital) */}
      {capitalAccounts.length > 0 ? (
        <button
          type="button"
          onClick={() => setShowAccounts((v) => !v)}
          className="mt-2 text-xs text-muted hover:text-text flex items-center gap-1"
        >
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform ${showAccounts ? "rotate-180" : ""}`}
          />
          Счета в капитале:{" "}
          {capitalAccounts.filter((a) => !excluded.includes(a.title)).length}
          {" / "}
          {capitalAccounts.length}
        </button>
      ) : (
        <div className="mt-2 text-xs text-muted">
          Подключите Дзен-мани, чтобы капитал считался автоматически по балансам счетов.
        </div>
      )}
      {showAccounts && capitalAccounts.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border space-y-1">
          {capitalAccounts.map((a) => {
            const on = !excluded.includes(a.title);
            return (
              <button
                key={a.title}
                type="button"
                onClick={() => toggleExcluded(a.title)}
                className="w-full flex items-center gap-2 py-1 text-left text-sm hover:bg-bg/50 rounded px-1"
              >
                <span
                  className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                    on ? "bg-accent border-accent" : "border-border"
                  }`}
                >
                  {on && <Check className="w-3 h-3 text-white" />}
                </span>
                <span className={`flex-1 truncate ${on ? "" : "text-muted line-through"}`}>
                  {a.title}
                  {a.savings && (
                    <span className="ml-1.5 text-[10px] pill align-middle">накопит.</span>
                  )}
                  {!a.inBalance && (
                    <span className="ml-1.5 text-[10px] pill align-middle">вне баланса</span>
                  )}
                </span>
                <span className="tabular-nums text-muted shrink-0">
                  {formatMoney(a.balanceBase, base)}
                </span>
              </button>
            );
          })}
          <p className="text-[11px] text-muted pt-1">
            По умолчанию учитываются все активные счета, включая помеченные в Дзен-мани как
            «вне баланса» (накопительные, брокерские и т.п.). Снимите галочку, чтобы
            исключить счёт из капитала FIRE.
          </p>
        </div>
      )}

      {/* KPI band — every metric carries its formula WITH the actual numbers,
          so the figure can be checked by hand (issue #35). */}
      <div className="rounded-lg border border-border overflow-hidden mt-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border">
          <div className="bg-panel2 p-3 flex items-center">
            <Wallet className="w-4 h-4 text-accent shrink-0 mr-2" />
            <div className="min-w-0">
              <Tooltip
                content={
                  <TooltipFacts
                    title="Сумма балансов выбранных счетов"
                    facts={[
                      {
                        label: "Счетов учтено",
                        value: `${capitalAccounts.filter((a) => !excluded.includes(a.title)).length} из ${capitalAccounts.length}`,
                      },
                      { label: "Итого", value: formatMoney(capital, base) },
                    ]}
                    note={`Выбрать счета — в списке «Счета в капитале» выше. Балансы пересчитаны в ${base} по текущему курсу.`}
                  />
                }
              >
                <div className={kpiLabelCls}>Капитал</div>
              </Tooltip>
              <div className="text-base font-semibold tabular-nums leading-tight">
                {formatMoney(capital, base)}
              </div>
            </div>
          </div>
          <div className="bg-panel2 p-3">
            <Tooltip
              content={
                <TooltipFacts
                  title="(доход − расход) ÷ доход × 100"
                  facts={[
                    { label: "Доход", value: formatMoney(avgIncome, base) },
                    { label: "Расход", value: formatMoney(avgExpense, base) },
                    { label: "Остаётся в месяц", value: formatMoney(avgSavings, base) },
                  ]}
                  note="Средние за последние 6 месяцев."
                />
              }
            >
              <div className={kpiLabelCls}>Норма сбережений</div>
            </Tooltip>
            <div className={`text-base font-semibold tabular-nums leading-tight ${savingsRate > 0 ? "text-income" : "text-expense"}`}>
              {currentRatePct}%
            </div>
          </div>
          <div className="bg-panel2 p-3">
            <Tooltip
              content={
                <TooltipFacts
                  title="Обязательные расходы в месяц × 12"
                  facts={[
                    { label: "В месяц", value: formatMoney(avgObligatoryMonthly, base) },
                    { label: "За год", value: formatMoney(annualObligatory, base) },
                  ]}
                  note="Среднее скользящее за 12 месяцев — та же база, что и на графике ниже. Обязательность категории задаётся в Настройках → Справочники."
                />
              }
            >
              <div className={kpiLabelCls}>Обязательные траты в год</div>
            </Tooltip>
            <div className="text-base font-semibold tabular-nums leading-tight">
              {formatMoney(annualObligatory, base)}
            </div>
          </div>
          <div className="bg-panel2 p-3">
            <Tooltip
              content={
                <TooltipFacts
                  title="Обязательные за год × 25 — правило 4%"
                  facts={[
                    { label: "Обязательные за год", value: formatMoney(annualObligatory, base) },
                    { label: "Цель", value: formatMoney(fireTarget, base) },
                  ]}
                  note="То же самое: среднемесячные обязательные × 300 месяцев."
                />
              }
            >
              <div className={kpiLabelCls}>Цель · ×25</div>
            </Tooltip>
            <div className="text-base font-semibold tabular-nums leading-tight text-accent">
              {formatMoney(fireTarget, base)}
            </div>
          </div>
        </div>
      </div>

      {/* Interactive scenario slider */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-3 text-sm mb-1.5">
          <span className="text-muted">Если откладывать долю дохода</span>
          <span className="tabular-nums">
            <span className="font-semibold">{scenarioRate}%</span>
            <span className="text-muted"> → </span>
            <span className={`font-semibold ${Number.isFinite(scenYears) ? "text-warn" : "text-muted"}`}>
              {Number.isFinite(scenYears) ? yearsFmt(scenYears) : "—"}
            </span>
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={99}
          step={1}
          value={scenarioRate}
          onChange={(e) => setScenarioRate(Number(e.target.value))}
          className="w-full"
          style={{ accentColor: "rgb(var(--c-accent))" }}
          aria-label="Доля дохода, которую откладывать"
        />
        <div className="text-[11px] text-muted mt-1">
          Сейчас вы откладываете {currentRatePct}%. С учётом уже накопленного.
        </div>
      </div>
    </div>
  );
}
