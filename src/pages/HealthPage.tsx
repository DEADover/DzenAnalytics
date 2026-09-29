import { useMemo } from "react";
import { HeartPulse } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useAnalyticsTransactions } from "../hooks/useAnalyticsTransactions";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useHealthScore } from "../hooks/useHealthScore";
import { useNetWorthSeries } from "../hooks/useNetWorthSeries";
import { useFireCapital } from "../hooks/useFireCapital";
import { useLiveAccounts } from "../hooks/useLiveAccounts";
import { useFireStore } from "../store/useFireStore";
import { fireSeries } from "../lib/aggregations";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { HealthSummary } from "../components/HealthSummary";
import { FireChart } from "../components/FireChart";
import { FireIndependence } from "../components/FireIndependence";
import { SectionDivider } from "../components/SectionDivider";

export function HealthPage() {
  const transactions = useDataStore((s) => s.transactions);
  // FIRE income/expense rates ignore turnover / off-balance flows (#14); the
  // net-worth series below stays on raw transactions (it's a balance).
  const analyticsTx = useAnalyticsTransactions();
  const base = useDataStore((s) => s.rates.base);
  const categoryMeta = useCategoryMetaStore((s) => s.meta);
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const score = useHealthScore();
  const { capitalAccounts } = useFireCapital();
  const excluded = useFireStore((s) => s.excluded);
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
      .filter((a) => a.archive || !excluded.includes(a.title))
      .map((a) => a.title);
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

      <HealthSummary score={score} hideHeading />

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
