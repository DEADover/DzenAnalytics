import { useMemo } from "react";
import { queryMatcher } from "../lib/keyboardLayout";
import { periodKey, periodRange } from "../lib/period";
import { useZenPlanned } from "./useZenPlanned";
import { useFiltersStore } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { usePlannedDeletionsStore } from "../store/usePlannedDeletionsStore";

const pad2 = (n: number) => String(n).padStart(2, "0");
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export interface PlannedFeedCounts {
  /** Просроченные (не прогнозы) — раньше сегодняшнего дня. */
  overdue: number;
  /** С сегодня до конца отчётного месяца. */
  month: number;
  /** С сегодня до 31 декабря. */
  year: number;
  /** Все будущие. */
  total: number;
}

/** Все планы, которые показывает лента: свои, не удалённые, под фильтром счетов и поиском. */
export function usePlannedFeed(query = "") {
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const accounts = useFiltersStore((s) => s.accounts);
  const deletions = usePlannedDeletionsStore((s) => s.deletions);
  const today = localToday();
  // Все даты, какие есть: Дзен-мани строит их примерно на год вперёд, и
  // «Будущие» в приложении показывают их все.
  const planned = useZenPlanned(today, "9999-12-31", true);
  const ops = useMemo(() => {
    if (!planned) return [];
    const q = query.trim();
    const match = q ? queryMatcher(q) : null;
    return planned.filter(
      (p) =>
        deletions[p.id] === undefined &&
        (accounts.size === 0 ||
          accounts.has(p.account) ||
          (p.toAccount != null && accounts.has(p.toAccount))) &&
        (!match || match(`${p.payee} ${p.comment} ${p.category} ${p.account} ${p.toAccount ?? ""}`))
    );
  }, [planned, deletions, accounts, query]);
  const monthEnd = periodRange(periodKey(today, monthStartDay), monthStartDay).to;
  const yearEnd = `${today.slice(0, 4)}-12-31`;
  const counts = useMemo(() => {
    const upcoming = ops.filter((p) => p.date >= today);
    return {
      overdue: ops.length - upcoming.length,
      month: upcoming.filter((p) => p.date <= monthEnd).length,
      year: upcoming.filter((p) => p.date <= yearEnd).length,
      total: upcoming.length,
    };
  }, [ops, today, monthEnd, yearEnd]) satisfies PlannedFeedCounts;
  return { ops, today, counts };
}

