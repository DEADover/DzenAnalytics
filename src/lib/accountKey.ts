/**
 * Ключ счёта — тождество счёта во всём сервисе.
 *
 * Названия счетов в Дзен-мани не уникальны: два «Т-Банка», «Наличные» в
 * рублях и в долларах. Всё, что отбирает, группирует или запоминает счёт по
 * названию, склеивало такие счета в один. Ключ различает их:
 *
 *   • обычный счёт — его номер в Дзен-мани (`ZenAccount.id`);
 *   • долговые счета — общее название («Долги»): Дзен-мани держит по счёту
 *     на каждую валюту, а для человека это один счёт долгов (#89);
 *   • операции из CSV — название: номеров там нет.
 *
 * Ключ вычисляется при разборе операции (`zenmoneyMap`) и лежит в операции
 * рядом с названием. Название остаётся подписью; показать счёт — через
 * `accountLabel` из справочника, где у тёзок есть уточнение.
 */

/** Ключ живого счёта. */
export function accountKeyOf(a: { id: string; title: string; type?: string }): string {
  return a.type === "debt" ? a.title : a.id;
}

/** Что из операции нужно, чтобы получить ключи её счетов. */
export interface KeyedAccounts {
  account: string;
  outcomeAccount: string;
  incomeAccount: string;
  accountKey?: string;
  outcomeAccountKey?: string;
  incomeAccountKey?: string;
}

/** Ключ счёта операции. Без ключа (CSV, старые записи) — название. */
export function txAccountKey(t: Pick<KeyedAccounts, "account" | "accountKey">): string {
  return t.accountKey ?? t.account;
}

/** Ключ счёта списания. */
export function txOutKey(t: Pick<KeyedAccounts, "outcomeAccount" | "outcomeAccountKey">): string {
  return t.outcomeAccountKey ?? t.outcomeAccount;
}

/** Ключ счёта зачисления. */
export function txInKey(t: Pick<KeyedAccounts, "incomeAccount" | "incomeAccountKey">): string {
  return t.incomeAccountKey ?? t.incomeAccount;
}
