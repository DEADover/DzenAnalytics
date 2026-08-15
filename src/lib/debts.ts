import type { Transaction } from "../types";

/**
 * Долги по людям — то, чего нет в самом Дзен-мани.
 *
 * Дзен держит ОДИН счёт «Долги» на пользователя: сколько всего должны вам и
 * сколько должны вы, свалено в один остаток. Кто именно за этим стоит, лежит в
 * самой операции — в поле «Контрагент» (`payee`); сервер Дзен-мани без него
 * долговую операцию не принимает вовсе. Значит разложить остаток по людям
 * можно, и это ровно то, чего от списка счетов ждут: «кому я должен и кто мне».
 *
 * Знак — со стороны пользователя:
 *   • деньги ушли НА долговой счёт  → вы дали в долг (или закрыли свой долг);
 *   • деньги ушли СО долгового счёта → вам вернули (или вы взяли в долг).
 * Сумма по контрагенту больше нуля — должны вам, меньше — должны вы. Итог по
 * всем контрагентам сходится с остатком долгового счёта.
 */

/** Свод по одному контрагенту. Суммы — в базовой валюте. */
export interface DebtCounterparty {
  /** Имя контрагента; пусто — операция без него (в Дзен-мани так не бывает,
   *  но данные приезжают и из CSV). */
  payee: string;
  /** Итог: больше нуля — должны вам, меньше — должны вы. */
  amount: number;
  /** Сколько всего ушло в долг (или на погашение своего долга). */
  out: number;
  /** Сколько всего вернулось (или пришло в долг вам). */
  back: number;
  count: number;
  /** Дата последней операции — по ней видно, насколько долг «живой». */
  last: string;
  /** Рассчитались: итог нулевой (с точностью до копейки). */
  settled: boolean;
}

export interface DebtBreakdown {
  rows: DebtCounterparty[];
  /** Сумма по всем контрагентам — должна совпасть с остатком счёта «Долги». */
  total: number;
  /** Сколько всего должны вам и сколько должны вы (по модулю). */
  owedToYou: number;
  owedByYou: number;
}

/** Меньше половины копейки — это ноль: после пересчёта по курсу дня в суммах
 *  остаются хвосты, и «рассчитались» не должно зависеть от них. */
const EPS = 0.005;

/** Название контрагента для показа, когда его нет. */
export const NO_COUNTERPARTY = "Без контрагента";

/**
 * Разложить долговые операции по контрагентам.
 *
 * `debtAccounts` — названия счетов типа «Долги»: в Дзен-мани он один, но
 * ограничивать себя одним нельзя — счёт можно переименовать, а в CSV их может
 * оказаться несколько.
 */
export function debtsByCounterparty(
  transactions: Transaction[],
  debtAccounts: Set<string>
): DebtBreakdown {
  const acc = new Map<string, DebtCounterparty>();

  for (const t of transactions) {
    const into = !!t.incomeAccount && debtAccounts.has(t.incomeAccount);
    const from = !!t.outcomeAccount && debtAccounts.has(t.outcomeAccount);
    // Перевод внутри долговых счетов сам себе не долг: он ничего не меняет ни
    // для вас, ни для контрагента.
    if (into === from) continue;
    const amount = into ? t.amountBase : -t.amountBase;
    const payee = (t.payee || "").trim() || NO_COUNTERPARTY;

    let row = acc.get(payee);
    if (!row) {
      row = { payee, amount: 0, out: 0, back: 0, count: 0, last: "", settled: true };
      acc.set(payee, row);
    }
    row.amount += amount;
    if (into) row.out += t.amountBase;
    else row.back += t.amountBase;
    row.count++;
    if (t.date > row.last) row.last = t.date;
  }

  let total = 0;
  let owedToYou = 0;
  let owedByYou = 0;
  for (const row of acc.values()) {
    row.settled = Math.abs(row.amount) < EPS;
    total += row.amount;
    if (row.amount >= EPS) owedToYou += row.amount;
    else if (row.amount <= -EPS) owedByYou += -row.amount;
  }

  // Сначала непогашенные — по величине, потом рассчитавшиеся по дате: список
  // отвечает на вопрос «с кем сейчас не рассчитались», а история идёт следом.
  const rows = [...acc.values()].sort(
    (a, b) =>
      Number(a.settled) - Number(b.settled) ||
      Math.abs(b.amount) - Math.abs(a.amount) ||
      b.last.localeCompare(a.last)
  );

  return { rows, total, owedToYou, owedByYou };
}
