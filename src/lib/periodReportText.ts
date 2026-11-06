/**
 * Слова «Отчёта за период», общие для листов отчёта (PDF и HTML) и для
 * Excel: фраза «Главное» и строка о том, с чем сравниваем. Одна функция на
 * оба файла — чтобы фразы в них не разошлись.
 */

import type { PeriodReport } from "../hooks/usePeriodReport";
import { digestHeadline } from "./digestHeadline";
import { formatDate } from "./format";
import { spanDays } from "./period";
import { rangeText } from "./periodReport";
import { pluralRu } from "./plural";

/** «Главное» одной фразой — та же, что в «Дайджесте». */
export function reportHeadline(report: PeriodReport): string {
  const t = report.totals;
  return digestHeadline(
    {
      expense: t.expense,
      income: t.income,
      net: t.net,
      savingsRate: t.rate ?? 0,
      typical: report.typical,
      movers: report.movers.map((m) => ({ category: m.category, current: m.now, previous: m.prev, delta: 0 })),
      running: report.running ? { day: report.days.lived, days: spanDays(report.range.from, report.range.to) } : undefined,
    },
    report.base,
    report.isMonth ? "месяца" : "периода"
  );
}

/** «Сравнение — с …; «обычно» — среднее за …» или пусто, если сравнивать не с чем. */
export function reportCompareNote(report: PeriodReport): string {
  const parts: string[] = [];
  if (report.prevRange) parts.push(`Сравнение — с ${rangeText(report.prevRange)}`);
  if (report.typical) {
    const n = report.typical.periods;
    parts.push(
      `«обычно» — среднее за ${n} ${pluralRu(n, ["прошлый такой же период", "прошлых таких же периода", "прошлых таких же периодов"])}${report.running ? " к этому дню" : ""}`
    );
  }
  return parts.join("; ");
}

/** Даты под заголовком: «01.10.2026 — 31.10.2026 · период идёт, данные по …». */
export function reportDatesNote(report: PeriodReport): string {
  const dates = report.title !== report.dates ? report.dates : "";
  const running = report.running ? `период идёт, данные по ${formatDate(report.lastDay, "full")}` : "";
  return [dates, running].filter(Boolean).join(" · ");
}
