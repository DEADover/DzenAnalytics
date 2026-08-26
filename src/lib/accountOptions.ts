/**
 * Список счетов для отбора в панели фильтров.
 *
 * Собирается из ДВУХ источников: счетов, встреченных в операциях, и справочника
 * счетов Дзен-мани. Только по операциям нельзя: счёт без единой операции в
 * загруженных данных — новый, пустой, закрытый или отсечённый разрезом — на
 * странице «Счета» есть, а в отборе не находился, и выглядело это как пропажа
 * (issue #67). Страница «Счета» ровно так же берёт объединение, и два списка
 * обязаны совпадать.
 *
 * В режиме CSV справочника нет вовсе — тогда остаются одни операции, и это
 * единственное, что там вообще известно.
 */

export interface AccountOptionsMeta {
  /** Названия архивных счетов — уходят вниз списка под свой разделитель. */
  archived: Set<string>;
  /** Название счёта → его вид («Карта», «Депозит», …). Пусто в режиме CSV. */
  kinds: Map<string, string>;
}

/**
 * Отсортированный список названий счетов.
 *
 * Порядок повторяет страницу «Счета»: активные перед архивными, внутри —
 * группами по виду счёта, внутри вида по алфавиту. Иначе один и тот же набор
 * счетов читался бы на двух экранах по-разному.
 */
export function accountOptions(
  txAccounts: Iterable<string | null | undefined>,
  known: Iterable<string>,
  meta: AccountOptionsMeta
): string[] {
  const set = new Set<string>();
  for (const a of txAccounts) if (a) set.add(a);
  for (const a of known) if (a) set.add(a);
  return Array.from(set).sort((a, b) => {
    const aa = meta.archived.has(a);
    const ba = meta.archived.has(b);
    if (aa !== ba) return aa ? 1 : -1;
    const ka = meta.kinds.get(a) ?? "";
    const kb = meta.kinds.get(b) ?? "";
    if (ka !== kb) return ka.localeCompare(kb, "ru");
    return a.localeCompare(b, "ru");
  });
}

/**
 * Доля счёта в капитале, 0…1.
 *
 * Считается ТОЛЬКО от положительных остатков: с долгами в знаменателе доля
 * теряет смысл — при активах 1 млн и долге 900 тыс. сумма всех остатков
 * 100 тыс., и счёт на 500 тыс. получил бы «долю» в 500 %. Поэтому знаменатель
 * — сколько всего денег ЕСТЬ, а долги в него не входят и своей доли не имеют.
 *
 * `null` — доли нет: у счёта долг или ноль, либо считать не от чего.
 */
export function capitalShare(
  balance: number | null,
  positiveTotal: number
): number | null {
  if (balance == null || balance <= 0) return null;
  if (!(positiveTotal > 0)) return null;
  return balance / positiveTotal;
}

/** Сумма положительных остатков — знаменатель для {@link capitalShare}. */
export function positiveBalanceTotal(
  balances: Iterable<number | null>
): number {
  let sum = 0;
  for (const b of balances) if (b != null && b > 0) sum += b;
  return sum;
}

/** Что нужно от живого счёта, чтобы свести одноимённые в одну строку. */
export interface TitledBalance {
  title: string;
  balance: number;
  currency: string;
}

/** Свод одноимённых счетов: представитель, общий остаток и одна ли валюта. */
export interface MergedTitle<T> {
  /** Счёт, от которого берутся вид, банк, архивность и правки: самый крупный
   *  по модулю остатка — он и есть «этот счёт» в глазах человека. */
  lead: T;
  /** Сумма остатков всех одноимённых, в базовой валюте. */
  base: number;
  /** Сколько счетов слилось в эту строку. */
  count: number;
  /** Родная сумма и валюта — только когда счёт ровно один: у слитых из разных
   *  валют «родной» суммы не существует. */
  native: { balance: number; currency: string } | null;
}

/**
 * Свести живые счета по НАЗВАНИЮ, складывая остатки.
 *
 * Дзен-мани держит по одному долговому счёту НА ВАЛЮТУ, и называются они все
 * одинаково — «Долги». Обычная карта `title → счёт` оставляла из них
 * последний, и в списке вместо суммы долгов стоял остаток случайной валюты,
 * чаще всего нулевой (issue #89). Операции ссылаются на счёт по названию, так
 * что строка в списке одна на название — значит и остаток у неё должен быть
 * общий, а не одного из счетов.
 */
export function mergeLiveByTitle<T extends TitledBalance>(
  accounts: readonly T[],
  toBase: (amount: number, currency: string) => number
): Map<string, MergedTitle<T>> {
  const out = new Map<string, MergedTitle<T>>();
  for (const a of accounts) {
    const prev = out.get(a.title);
    if (!prev) {
      out.set(a.title, {
        lead: a,
        base: toBase(a.balance, a.currency),
        count: 1,
        native: { balance: a.balance, currency: a.currency },
      });
      continue;
    }
    prev.base += toBase(a.balance, a.currency);
    prev.count++;
    if (Math.abs(a.balance) > Math.abs(prev.lead.balance)) prev.lead = a;
    // Валюты разошлись — родной суммы у строки больше нет. Совпали (два счёта
    // в одной валюте) — складываем, она по-прежнему осмысленна.
    if (prev.native && prev.native.currency === a.currency) {
      prev.native = { balance: prev.native.balance + a.balance, currency: a.currency };
    } else {
      prev.native = null;
    }
  }
  return out;
}
