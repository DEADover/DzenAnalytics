/**
 * Оболочка вариантов главной: считает модель один раз и отдаёт её выбранной
 * раскладке.
 *
 * Переходы (открыть операции месяца / категории / счёта) живут здесь, а не
 * внутри вариантов: раскладка не должна знать про хранилища — иначе четыре
 * варианта пришлось бы чинить в четырёх местах.
 */

import { useMemo } from "react";
import { useDashboardModel } from "../../hooks/useDashboardModel";
import { useAnalyticsTransactions } from "../../hooks/useAnalyticsTransactions";
import { useDrillStore } from "../../store/useDrillStore";
import { useReportPeriodStore } from "../../store/useReportPeriodStore";
import { periodKey } from "../../lib/period";
import { monthLabel } from "../../lib/format";
import { affectsExpense } from "../../lib/txKindStyle";
import type { DashboardVariant } from "../../store/useDashboardVariantStore";
import type { VariantProps } from "./types";
import { VariantSummary } from "./VariantSummary";
import { VariantBento } from "./VariantBento";
import { VariantClassic } from "./VariantClassic";
import { VariantPremium } from "./VariantPremium";

export function DashboardVariants({ variant }: { variant: Exclude<DashboardVariant, "current"> }) {
  const m = useDashboardModel();
  const transactions = useAnalyticsTransactions();
  const showDrill = useDrillStore((s) => s.show);
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);

  const handlers = useMemo<Omit<VariantProps, "m">>(
    () => ({
      onMonth: (ym: string) => {
        showDrill(
          monthLabel(ym),
          transactions.filter((t) => periodKey(t.date, monthStartDay) === ym),
          "Месяц"
        );
      },
      onCategory: (name: string) => {
        // Возвраты тоже берём: именно они уменьшили ту сумму, по которой кликнули.
        showDrill(
          name,
          transactions.filter((t) => affectsExpense(t.kind) && t.category === name),
          "Расходы по категории"
        );
      },
      onAccount: (title: string) => {
        showDrill(
          title,
          transactions.filter(
            (t) => t.account === title || t.outcomeAccount === title || t.incomeAccount === title
          ),
          "Операции по счёту"
        );
      },
    }),
    [transactions, showDrill, monthStartDay]
  );

  const props: VariantProps = { m, ...handlers };

  if (variant === "summary") return <VariantSummary {...props} />;
  if (variant === "bento") return <VariantBento {...props} />;
  if (variant === "classic") return <VariantClassic {...props} />;
  return <VariantPremium {...props} />;
}
