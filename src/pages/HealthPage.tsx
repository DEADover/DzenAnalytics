import { useMemo } from "react";
import { HeartPulse } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useAnalyticsTransactions } from "../hooks/useAnalyticsTransactions";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useHealthScore } from "../hooks/useHealthScore";
import { useNetWorthSeries } from "../hooks/useNetWorthSeries";
import { useFireCapital } from "../hooks/useFireCapital";
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
  const netWorth = useNetWorthSeries(transactions);
  const { capital, capitalAccounts } = useFireCapital();

  // Anchor the net-worth series so its LAST point equals the curated FIRE
  // capital — then «месяцы жизни» on the chart use the same capital the
  // independence block does, and the two headline numbers agree. The offset
  // shifts the whole history (we have no per-account balance history), which
  // preserves the shape while making today's point exact. Skipped in CSV mode
  // (no live accounts) where the net-worth series already carries calibration.
  const anchoredNet = useMemo(() => {
    if (capitalAccounts.length === 0 || netWorth.length === 0) return netWorth;
    const offset = capital - netWorth[netWorth.length - 1].net;
    return netWorth.map((p) => ({ date: p.date, net: p.net + offset }));
  }, [netWorth, capital, capitalAccounts.length]);

  const fire = useMemo(
    () => fireSeries(anchoredNet, analyticsTx, categoryMeta, 12, monthStartDay),
    [anchoredNet, analyticsTx, categoryMeta, monthStartDay]
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
        hint="Насколько устойчивы ваши финансы сейчас и как близко до финансовой независимости"
        hintWrap
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
