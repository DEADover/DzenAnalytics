/**
 * Предполётная сверка перед восстановлением из облачного снимка (issue #93).
 *
 * ПОЧЕМУ ОТКАТ ЗАЛИВАЕТСЯ НОВЫМИ id. Проверено на живом API: если строку
 * удалили, повторная отправка её же id — хоть со свежей меткой `changed`, хоть
 * со старой — возвращает 200 без ошибки и НЕ возвращает строку. Сервер молча
 * оставляет её удалённой. Отсюда и родилась задача: восстановление «проходило»,
 * отчёт рапортовал успех, а в Дзен-мани не менялось ничего. Копия под новым id
 * заводится нормально — этим же приёмом пользуется обычный пуш
 * (`buildResurrections`), и на нём построен откат.
 *
 * ЧТО ИЗ ЭТОГО СЛЕДУЕТ ДЛЯ СВЕРКИ. Новые id ни с чем не сталкиваются: снимок
 * не перезаписывает аккаунт, а ЛОЖИТСЯ РЯДОМ. Значит вопрос «чья версия
 * победит» отпадает, а вместо него встаёт единственный настоящий:
 * ПУСТ ЛИ АККАУНТ. Заливка в непустой удвоит всё, что в нём есть.
 *
 * Поэтому здесь не осталось счётчиков про «кто новее» и «что не вернётся» —
 * при новых id они не значат ничего, а показывать число, которое ни на что не
 * влияет, хуже, чем не показывать.
 */

import type {
  ZenAccount,
  ZenDiffResponse,
  ZenMerchant,
  ZenTag,
  ZenTransaction,
} from "./zenmoney";
import { formatNum } from "./format";
import { pluralRu } from "./plural";

/** Сколько живых сущностей одного вида сейчас в аккаунте и сколько в снимке. */
export interface EntityDelta {
  inAccount: number;
  inSnapshot: number;
}

export type BlockerKind = "notEmpty" | "leftoverTags" | "leftoverMerchants";

export interface PreflightBlocker {
  kind: BlockerKind;
  count: number;
  /**
   * Что нашли — одной фразой и без объяснений.
   *
   * Раньше здесь же лежало и «почему так» (поле `fix`), но мастер объясняет
   * это до проверки, своими словами и один раз. Дублировать объяснение в
   * каждой строке результата значило повторять человеку то, что он только что
   * прочитал.
   */
  text: string;
}

export interface RestorePreflight {
  transactions: EntityDelta;
  accounts: EntityDelta;
  tags: EntityDelta;
  merchants: EntityDelta;
  /** Аккаунт пуст: снимок ляжет начисто, без задвоения. */
  ready: boolean;
  blockers: PreflightBlocker[];
  /**
   * То, что стоит знать, но что заливке не мешает.
   *
   * Отдельно от `blockers` намеренно: попав в препятствия, оставшиеся счета
   * навсегда делали бы аккаунт «неготовым» — а убрать их нельзя (см. ниже).
   */
  notes: string[];
}

/** Минимум, который нужен от сущности, чтобы её сосчитать. */
interface Countable {
  id: string;
  deleted?: boolean;
}

/**
 * Сосчитать живых с обеих сторон.
 *
 * Удалённые не в счёт ни там, ни там: в аккаунте они заливке не мешают, а из
 * снимка мы их всё равно не воскрешаем.
 */
export function countLive<T extends Countable>(
  snapshot: T[],
  account: T[]
): EntityDelta {
  return {
    inAccount: account.filter((e) => !e.deleted).length,
    inSnapshot: snapshot.filter((e) => !e.deleted).length,
  };
}

/**
 * Сверить снимок с тем, что сейчас в облаке.
 *
 * `account` — разобранный кэш последней синхронизации: то, что мы знаем об
 * облаке. Сверка тем честнее, чем свежее кэш, поэтому вызывающий код должен
 * синхронизироваться перед ней.
 */
export function restorePreflight(
  snapshot: ZenDiffResponse,
  account: {
    transactions: ZenTransaction[];
    accounts: ZenAccount[];
    tags: ZenTag[];
    merchants: ZenMerchant[];
  }
): RestorePreflight {
  const transactions = countLive(snapshot.transaction || [], account.transactions);
  const accounts = countLive(snapshot.account || [], account.accounts);
  const tags = countLive(snapshot.tag || [], account.tags);
  const merchants = countLive(snapshot.merchant || [], account.merchants);

  const blockers: PreflightBlocker[] = [];

  // Препятствие — ОПЕРАЦИИ. Снимок заливается новыми номерами и потому ничего
  // не перезаписывает: на живые операции он ляжет сверху, и они удвоятся.
  if (transactions.inAccount > 0) {
    blockers.push({
      kind: "notEmpty",
      count: transactions.inAccount,
      text:
        `В аккаунте ${formatNum(transactions.inAccount)} ` +
        `${pluralRu(transactions.inAccount, ["операция", "операции", "операций"])}.`,
    });
  }

  // Справочники «Начать всё сначала» не уносит — их сносят отдельно.
  if (tags.inAccount > 0) {
    blockers.push({
      kind: "leftoverTags",
      count: tags.inAccount,
      text:
        `${formatNum(tags.inAccount)} ` +
        `${pluralRu(tags.inAccount, ["категория", "категории", "категорий"])}.`,
    });
  }
  if (merchants.inAccount > 0) {
    blockers.push({
      kind: "leftoverMerchants",
      count: merchants.inAccount,
      text:
        `${formatNum(merchants.inAccount)} ` +
        `${pluralRu(merchants.inAccount, ["контрагент", "контрагента", "контрагентов"])}.`,
    });
  }

  // Счета в препятствия НЕ идут. После «Начать всё сначала» Дзен-мани сама
  // заводит пару служебных — «Долги» (он у пользователя ровно один) и
  // «Наличные» взамен унесённых. Убрать их нельзя, и считай мы их помехой,
  // аккаунт после честной очистки навсегда оставался бы «неготовым», а совет
  // предлагал бы сделать то, что уже сделано. Пустой счёт заливке не мешает:
  // задваиваются операции, а не строки в списке счетов.
  const notes: string[] = [];
  if (accounts.inAccount > 0) {
    notes.push(
      `Сейчас ${formatNum(accounts.inAccount)} ` +
        `${pluralRu(accounts.inAccount, ["счёт", "счёта", "счетов"])}, из снимка ` +
        `добавятся ещё ${formatNum(accounts.inSnapshot)}. Лишние можно убрать в архив.`
    );
  }

  return {
    transactions,
    accounts,
    tags,
    merchants,
    ready: blockers.length === 0,
    blockers,
    notes,
  };
}
