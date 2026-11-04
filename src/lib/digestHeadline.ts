import type { DigestEntry } from "./digest";
import { formatMoney, formatPct } from "./format";
import { pluralRu } from "./plural";

export type HeadlineInput = Pick<DigestEntry, "expense" | "income" | "net" | "savingsRate" | "movers" | "running"> & {
  typical: { expense: number } | null;
};

/**
 * Главное о периоде одной фразой: сколько потратили против обычного, сколько
 * отложили и что выросло сильнее всего.
 *
 * Общая для «Дайджеста» и «Отчёта за период». `prevName` — каким периодом
 * идущий сравнивается «к тем же дням»: у «Дайджеста» это месяц, у отчёта —
 * «период» (год, квартал, свои даты).
 */
export function digestHeadline(entry: HeadlineInput, base: string, prevName = "месяца"): string {
  const parts: string[] = [];
  // Период — в заголовке карточки, фраза начинается сразу с дела. У идущего
  // месяца — «к этому дню»: сравниваем с тем же числом дней, а не с целым.
  const day = entry.running?.day;
  const spent = day
    ? `За ${day} ${pluralRu(day, ["день", "дня", "дней"])} потратили ${formatMoney(entry.expense, base)}`
    : `Потратили ${formatMoney(entry.expense, base)}`;
  const typ = entry.typical?.expense;
  if (typ && Math.abs(typ) > 0.01) {
    const rel = (entry.expense - typ) / typ;
    parts.push(
      Math.abs(rel) <= 0.03
        ? `${spent} — как обычно${day ? " к этому дню" : ""}`
        : `${spent} — на ${formatPct(Math.abs(rel), 0)} ${rel > 0 ? "больше" : "меньше"}${day ? ", чем обычно к этому дню" : " обычного"}`
    );
  } else parts.push(spent);
  if (entry.income > 0) {
    parts.push(
      entry.net >= 0
        ? `${day ? "Пока отложили" : "Отложили"} ${formatPct(entry.savingsRate, 0)} ${day ? "пришедшего " : ""}дохода`
        : `${day ? "Пока расходы превышают" : "Расходы превысили"} доход на ${formatMoney(-entry.net, base)}`
    );
  }
  const up = entry.movers.find((m) => m.current > m.previous);
  if (up)
    parts.push(
      `Сильнее всего выросли траты в категории «${up.category}»: +${formatMoney(up.current - up.previous, base)}${
        day ? ` к тем же дням прошлого ${prevName}` : ""
      }`
    );
  return parts.join(". ") + ".";
}
