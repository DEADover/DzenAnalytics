/**
 * Справочник счетов: кто есть, как его различать и как подписать.
 *
 * Один на сервис — фильтры, выбор счёта в формах, списки и подписи берут
 * счета отсюда, иначе один и тот же счёт назывался бы в разных местах
 * по-разному. Ключ — `lib/accountKey`. Подпись — название, а у тёзок к нему
 * добавляется уточнение: «Т-Банк · Альфа-Банк», «Наличные · USD».
 */

import { accountKeyOf, txAccountKey, txInKey, txOutKey, type KeyedAccounts } from "./accountKey";
import { accountKindLabel } from "./accountType";

/** Что справочнику нужно от живого счёта (`LiveAccount` подходит). */
export interface DirAccount {
  id: string;
  title: string;
  type: string;
  currency: string;
  bank: string | null;
  archive: boolean;
  inBalance: boolean;
  savings: boolean;
  creditLimit?: number;
}

export interface AccountEntry {
  key: string;
  title: string;
  /** Название, а у тёзок — с уточнением. */
  label: string;
  /** Номера счетов Дзен-мани под этим ключом: у долгов их несколько (по
   *  валюте), у обычного счёта один, у счёта из CSV — ни одного. */
  ids: string[];
  /** Счёт есть в справочнике Дзен-мани (а не только в операциях). */
  live: boolean;
  type?: string;
  currency?: string;
  bank?: string | null;
  archive: boolean;
  inBalance: boolean;
  savings: boolean;
  creditLimit: number;
}

export interface AccountDirectory {
  list: AccountEntry[];
  byKey: Map<string, AccountEntry>;
  /** Подпись по ключу; неизвестный ключ — как есть. */
  label: (key: string) => string;
  /** Ключи всех счетов с таким названием — для старых записей, где счёт
   *  запомнен названием. */
  keysByTitle: (title: string) => string[];
}

/**
 * Уточнения для тёзок: первое из «банк, валюта, вид счёта», которое у всех
 * одноимённых разное. Не нашлось — порядковый номер.
 */
function disambiguate(group: AccountEntry[]): void {
  const pick = (f: (e: AccountEntry) => string | null | undefined) => {
    const vals = group.map((e) => (f(e) || "").trim());
    if (vals.some((v) => !v)) return null;
    return new Set(vals).size === vals.length ? vals : null;
  };
  const parts =
    pick((e) => e.bank) ??
    pick((e) => e.currency) ??
    pick((e) => (e.type ? accountKindLabel(e.type, e.savings) : "")) ??
    group.map((_, i) => String(i + 1));
  group.forEach((e, i) => {
    e.label = `${e.title} · ${parts[i]}`;
  });
}

export function buildAccountDirectory(
  live: readonly DirAccount[] | null | undefined,
  txs: readonly KeyedAccounts[] = []
): AccountDirectory {
  const byKey = new Map<string, AccountEntry>();
  for (const a of live ?? []) {
    const key = accountKeyOf(a);
    const prev = byKey.get(key);
    if (prev) {
      // Долги по валютам — одна строка.
      prev.ids.push(a.id);
      prev.archive = prev.archive && a.archive;
      prev.inBalance = prev.inBalance || a.inBalance;
      continue;
    }
    byKey.set(key, {
      key,
      title: a.title,
      label: a.title,
      ids: [a.id],
      live: true,
      type: a.type,
      currency: a.currency,
      bank: a.bank,
      archive: a.archive,
      inBalance: a.inBalance,
      savings: a.savings,
      creditLimit: a.creditLimit ?? 0,
    });
  }
  // Счета, известные только по операциям: CSV или счёт, которого в
  // справочнике уже нет.
  const addTx = (key: string, title: string) => {
    if (!key || byKey.has(key)) return;
    byKey.set(key, {
      key,
      title,
      label: title,
      ids: [],
      live: false,
      archive: false,
      inBalance: true,
      savings: false,
      creditLimit: 0,
    });
  };
  for (const t of txs) {
    addTx(txAccountKey(t), t.account);
    if (t.outcomeAccount) addTx(txOutKey(t), t.outcomeAccount);
    if (t.incomeAccount) addTx(txInKey(t), t.incomeAccount);
  }
  const byTitle = new Map<string, AccountEntry[]>();
  for (const e of byKey.values()) {
    const g = byTitle.get(e.title) ?? [];
    g.push(e);
    byTitle.set(e.title, g);
  }
  for (const g of byTitle.values()) if (g.length > 1) disambiguate(g);
  const list = [...byKey.values()];
  return {
    list,
    byKey,
    label: (key) => byKey.get(key)?.label ?? key,
    keysByTitle: (title) => (byTitle.get(title) ?? []).map((e) => e.key),
  };
}
