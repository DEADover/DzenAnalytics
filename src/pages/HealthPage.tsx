import { useMemo, useState } from "react";
import { HeartPulse, SlidersHorizontal } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useAnalyticsTransactions } from "../hooks/useAnalyticsTransactions";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useHealthHistory, useHealthScore } from "../hooks/useHealthScore";
import { cushionForecast, healthNextStep } from "../lib/healthStep";
import { localToday } from "../lib/period";
import { useBenchmarksStore } from "../store/useBenchmarksStore";
import { useNetWorthSeries } from "../hooks/useNetWorthSeries";
import { useFireCapital, useFireExcluded } from "../hooks/useFireCapital";
import { accountKeyOf } from "../lib/accountKey";
import { useLiveAccounts } from "../hooks/useLiveAccounts";
import { fireSeries } from "../lib/aggregations";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { HealthSummary } from "../components/HealthSummary";
import { FireChart } from "../components/FireChart";
import { FireIndependence } from "../components/FireIndependence";
import { SectionDivider } from "../components/SectionDivider";
import { Tooltip } from "../components/Tooltip";
import { HealthBenchmarks } from "../components/HealthBenchmarks";
import { BenchmarkSettingsModal } from "../components/BenchmarkSettingsModal";
import { useBenchmarks } from "../hooks/useBenchmarks";

export function HealthPage() {
  const transactions = useDataStore((s) => s.transactions);
  // FIRE income/expense rates ignore turnover / off-balance flows (#14); the
  // net-worth series below stays on raw transactions (it's a balance).
  const analyticsTx = useAnalyticsTransactions();
  const base = useDataStore((s) => s.rates.base);
  const categoryMeta = useCategoryMetaStore((s) => s.meta);
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const score = useHealthScore();
  const history = useHealthHistory();
  const step = useMemo(() => (score ? healthNextStep(score) : null), [score]);
  const forecast = useMemo(() => (score ? cushionForecast(score, localToday()) : null), [score]);
  const cushionTarget = useBenchmarksStore((s) => s.cushionTarget);
  const updateSettings = useBenchmarksStore((s) => s.update);
  const benchmarks = useBenchmarks();
  const [benchmarkSetup, setBenchmarkSetup] = useState(false);
  const { capitalAccounts } = useFireCapital();
  const excluded = useFireExcluded();
  const liveAccounts = useLiveAccounts();

  /**
   * Счета капитала FIRE — те же, что в блоке независимости, плюс закрытые.
   *
   * Прежде кривая строилась по всем счетам «в балансе» и целиком сдвигалась
   * так, чтобы её конец совпал с капиталом: разница — исключённые счета —
   * ложилась на всю историю одной суммой. Теперь кривая — остатки ровно этих
   * счетов на каждый день. Закрытые идут в неё тоже: в блоке их нет, потому
   * что сегодня на них ноль, а в прошлом там лежали настоящие деньги, и без
   * них перевод с закрытого вклада выглядел бы ростом капитала.
   */
  const fireAccounts = useMemo(() => {
    if (!liveAccounts || capitalAccounts.length === 0) return null;
    return liveAccounts
      .filter((a) => a.archive || !excluded.includes(accountKeyOf(a)))
      .map(accountKeyOf);
  }, [liveAccounts, capitalAccounts.length, excluded]);
  // Последняя точка — по курсу синхронизации, как и капитал в блоке, так что
  // «месяцы жизни» на графике и «% до FIRE» считаются из одного числа.
  const fireNet = useNetWorthSeries(transactions, fireAccounts);

  const fire = useMemo(
    () => fireSeries(fireNet, analyticsTx, categoryMeta, 12, monthStartDay),
    [fireNet, analyticsTx, categoryMeta, monthStartDay]
  );
  const avgObligatoryMonthly = fire.length
    ? fire[fire.length - 1].avgObligatory
    : 0;

  if (transactions.length === 0 || !score) return <EmptyState />;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={HeartPulse}
        title="Финансовое здоровье"
      />

      <SectionDivider
        label="Общая оценка"
        description="Складывается из 5 показателей ниже. Чем выше балл (0–100), тем устойчивее ваши финансы."
      />

      <HealthSummary
        score={score}
        hideHeading
        history={history}
        step={step}
        cushion={{
          target: cushionTarget,
          onTarget: (t) => void updateSettings({ cushionTarget: t }),
          forecast,
        }}
      />

      <SectionDivider
        label="Ориентиры"
        description="Известные правила личных финансов и ваши цифры рядом с ними. Считаются по последним 12 полным месяцам, на общую оценку не влияют."
        right={
          <Tooltip content="Настроить ориентиры">
            <button
              type="button"
              className="btn-icon"
              aria-label="Настроить ориентиры"
              onClick={() => setBenchmarkSetup(true)}
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
          </Tooltip>
        }
      />

      <HealthBenchmarks model={benchmarks} />
      {benchmarkSetup && <BenchmarkSettingsModal onClose={() => setBenchmarkSetup(false)} />}

      <SectionDivider
        label="Финансовая независимость"
        description="Сколько уже накоплено, надолго ли хватит и когда капитал сможет вас содержать."
      />

      {/* Independence snapshot + rolling chart merged into one card */}
      <div className="card-tray card-pad">
        <FireIndependence avgObligatoryMonthly={avgObligatoryMonthly} bare />
        <div className="my-6 border-t border-border" />
        <FireChart data={fire} base={base} bare />
      </div>
    </div>
  );
}
