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

/** Счёт справочника — то, что нужно для дозаполнения ключей. */
interface KeySource {
  id: string;
  title: string;
  type?: string;
}

type LegFields = {
  account: string;
  outcomeAccount: string;
  incomeAccount: string;
  accountId?: string;
  outcomeAccountId?: string;
  incomeAccountId?: string;
  accountKey?: string;
  outcomeAccountKey?: string;
  incomeAccountKey?: string;
};

/**
 * Проставить ключи счетов там, где их нет или они разошлись с названием.
 *
 * Ключ кладётся в операцию при разборе (`zenmoneyMap`), но операции,
 * сохранённые до его появления, лежат без ключа до следующей синхронизации —
 * и каждый счёт выглядел бы двумя: по номеру (справочник) и по названию
 * (операции). А неотправленная правка прежних версий меняет только название
 * счёта, и старый номер в операции указывал бы на прежний счёт.
 *
 * Правило: номер, совпадающий с названием, — его ключ; иначе ключ по
 * названию, если счёт с таким названием один (или это долги — у них ключ и
 * есть название). У тёзок без номера угадывать нечем — остаётся название.
 *
 * Тот же массив, если менять нечего.
 */
export function fillAccountKeys<T extends LegFields>(txs: T[], accounts: readonly KeySource[] | null | undefined): T[] {
  if (!accounts || accounts.length === 0 || txs.length === 0) return txs;
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const keysByTitle = new Map<string, Set<string>>();
  for (const a of accounts) {
    const set = keysByTitle.get(a.title) ?? new Set<string>();
    set.add(accountKeyOf(a));
    keysByTitle.set(a.title, set);
  }
  /** Ключ стороны операции или `undefined`, если он уже верный. */
  const fix = (title: string, id: string | undefined, key: string | undefined): string | undefined => {
    if (!title) return undefined;
    const byNumber = id ? byId.get(id) : undefined;
    const want =
      byNumber && byNumber.title === title
        ? accountKeyOf(byNumber)
        : (() => {
            const keys = keysByTitle.get(title);
            if (keys && keys.size === 1) return [...keys][0];
            // Тёзки: верен ли уже стоящий ключ — по названию его счёта.
            if (key && keys?.has(key)) return key;
            return title;
          })();
    return want === key ? undefined : want;
  };
  let out: T[] | null = null;
  for (let i = 0; i < txs.length; i++) {
    const t = txs[i];
    const main = fix(t.account, t.accountId, t.accountKey);
    const out_ = fix(t.outcomeAccount, t.outcomeAccountId, t.outcomeAccountKey);
    const in_ = fix(t.incomeAccount, t.incomeAccountId, t.incomeAccountKey);
    if (main === undefined && out_ === undefined && in_ === undefined) continue;
    if (!out) out = txs.slice();
    out[i] = {
      ...t,
      ...(main !== undefined ? { accountKey: main } : {}),
      ...(out_ !== undefined ? { outcomeAccountKey: out_ } : {}),
      ...(in_ !== undefined ? { incomeAccountKey: in_ } : {}),
    };
  }
  return out ?? txs;
}
