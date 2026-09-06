/**
 * Предполётная сверка перед восстановлением из облачного снимка (issue #93).
 *
 * ЗАЧЕМ ОНА ВООБЩЕ НУЖНА. Восстановление — это не откат, а upsert: снимок
 * отправляется обратно в Дзен-мани, и по каждой сущности сервер оставляет ту
 * версию, у которой свежее `changed`. Отсюда две вещи, которые человек никак
 * не мог увидеть заранее и которые делали кнопку «якобы сработавшей»:
 *
 *   • То, что правилось в облаке ПОСЛЕ снимка, побеждает снимок. Заливка
 *     проходит, отчёт говорит «восстановлено N», а в облаке ничего не меняется.
 *   • Удалённое не воскресает: тумбстоуны в Дзен-мани липкие — повторная
 *     отправка удалённого id отвергается, даже с `deleted: false` (это
 *     проверено на API и записано в `buildResurrections`). Вернуть строку
 *     можно только копией под новым id.
 *
 * Поэтому восстановление работает по-настоящему только в ПОДГОТОВЛЕННЫЙ
 * аккаунт: «Ещё → Настройки аккаунта → Начать всё сначала» в приложении (или
 * то же в профиле на сайте), плюс отдельно снести оставшихся контрагентов и
 * теги — их «Начать сначала» не уносит.
 *
 * Эта сверка считает всё то же самое ЗАРАНЕЕ и молча, ничего не отправляя:
 * сколько сущностей встретится, сколько из них проиграет по дате, сколько
 * лежит тумбстоунами и что останется лишним. Пустой список препятствий значит,
 * что заливка ляжет начисто.
 *
 * ПРО `changed` — важное и неочевидное. Дзен-мани отдаёт эту метку НЕ такой,
 * какой хранит: он пересчитывает её в часы клиента на момент запроса, по
 * формуле `отданное = хранимое + (currentClientTimestamp − часы сервера)`.
 * Проверено запросами: тот же самый diff, отправленный с
 * `currentClientTimestamp` на час вперёд, вернул `changed` ровно на 3599
 * секунд больше; два обычных запроса подряд разошлись на пару секунд — ровно
 * на столько, на сколько сдвинулись часы между ними.
 *
 * Отсюда правило: сравнивать сырые `changed` из РАЗНЫХ ответов нельзя. На
 * живом аккаунте наивное сравнение объявило «изменёнными после снимка» все
 * 7660 операций — при том, что снимок был снят минуту назад и не изменилось
 * ничего. Поэтому ниже стоит допуск: расхождение меньше него — это дрейф
 * часов между двумя запросами, а не правка.
 */

import { pluralRu } from "./plural";
import type {
  ZenAccount,
  ZenDiffResponse,
  ZenMerchant,
  ZenTag,
  ZenTransaction,
} from "./zenmoney";

/** Расхождение по одному виду сущностей. */
export interface EntityDelta {
  /** Живых сейчас в облаке. */
  inAccount: number;
  /** Живых в снимке — столько мы собираемся вернуть. */
  inSnapshot: number;
  /**
   * Есть в снимке живой, а в облаке та же строка удалена. Такие НЕ вернутся:
   * тумбстоун сильнее любой повторной отправки под тем же id.
   */
  tombstoned: number;
  /**
   * Есть и там, и там, но в облаке версия свежее. Снимок проиграет ей по
   * `changed`, и строка останется в нынешнем виде.
   */
  newerInCloud: number;
  /** Есть в облаке, но нет в снимке. Заливка их не тронет — останутся лишними. */
  extra: number;
}

export type BlockerKind = "tombstones" | "newerInCloud" | "extraTags" | "extraMerchants";

export interface PreflightBlocker {
  kind: BlockerKind;
  /** Сколько строк задето. */
  count: number;
  /** Что это значит для человека — одной фразой. */
  text: string;
  /** Что с этим делать. */
  fix: string;
}

export interface RestorePreflight {
  transactions: EntityDelta;
  accounts: EntityDelta;
  tags: EntityDelta;
  merchants: EntityDelta;
  /**
   * Аккаунт готов: в нём нет ничего, что помешает снимку лечь целиком.
   * Ровно `blockers.length === 0` — отдельное поле, чтобы вызывающему коду
   * не приходилось это выводить.
   */
  ready: boolean;
  blockers: PreflightBlocker[];
}

/** Минимум, который нужен от сущности, чтобы её сверить. */
interface Comparable {
  id: string;
  changed: number;
  deleted?: boolean;
}

/**
 * Насколько разойтись меткам позволено, прежде чем считать это правкой.
 *
 * Дзен-мани переводит `changed` в часы клиента на момент запроса, поэтому
 * между двумя ответами одна и та же нетронутая строка гуляет на столько
 * секунд, сколько прошло между запросами (см. шапку модуля). Две минуты с
 * запасом покрывают этот дрейф и заведомо меньше любого промежутка, за
 * который человек успевает что-то поправить.
 */
export const CLOCK_SKEW_SEC = 120;

/**
 * Сверить один вид сущностей.
 *
 * `deleted` есть только у операций; у счетов, тегов и контрагентов удаление
 * приезжает отдельным списком `deletion`, и в кэше их просто нет. Поэтому
 * `tombstoned` для них всегда ноль — и это не упущение, а форма данных.
 */
export function compareEntities<T extends Comparable>(
  snapshot: T[],
  account: T[]
): EntityDelta {
  const liveSnap = snapshot.filter((e) => !e.deleted);
  const cloudById = new Map(account.map((e) => [String(e.id), e]));
  const liveCloud = account.filter((e) => !e.deleted);

  let tombstoned = 0;
  let newerInCloud = 0;
  for (const s of liveSnap) {
    const c = cloudById.get(String(s.id));
    if (!c) continue; // в облаке такой строки нет — ляжет как новая
    if (c.deleted) {
      tombstoned += 1;
      continue; // удалённое не воскресает, дату сравнивать уже незачем
    }
    if (c.changed > s.changed + CLOCK_SKEW_SEC) newerInCloud += 1;
  }

  const snapIds = new Set(liveSnap.map((e) => String(e.id)));
  const extra = liveCloud.filter((e) => !snapIds.has(String(e.id))).length;

  return {
    inAccount: liveCloud.length,
    inSnapshot: liveSnap.length,
    tombstoned,
    newerInCloud,
    extra,
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
  const transactions = compareEntities(snapshot.transaction || [], account.transactions);
  const accounts = compareEntities(snapshot.account || [], account.accounts);
  const tags = compareEntities(snapshot.tag || [], account.tags);
  const merchants = compareEntities(snapshot.merchant || [], account.merchants);

  const blockers: PreflightBlocker[] = [];

  if (transactions.tombstoned > 0) {
    const n = transactions.tombstoned;
    blockers.push({
      kind: "tombstones",
      count: n,
      text:
        `${n} ${pluralRu(n, ["операция", "операции", "операций"])} из снимка ` +
        `${pluralRu(n, ["удалена", "удалены", "удалены"])} в Дзен-мани — ` +
        `${pluralRu(n, ["она не вернётся", "они не вернутся", "они не вернутся"])}.`,
      fix:
        "Удалённое нельзя вернуть под тем же номером: Дзен-мани помнит удаление " +
        "и отвергает повторную отправку. Помогает только «Начать всё сначала» " +
        "(в приложении — «Ещё → Настройки аккаунта», на сайте — в профиле): " +
        "после неё аккаунт пуст, и снимок ляжет целиком.",
    });
  }

  if (transactions.newerInCloud > 0) {
    const n = transactions.newerInCloud;
    blockers.push({
      kind: "newerInCloud",
      count: n,
      text:
        `${n} ${pluralRu(n, ["операция", "операции", "операций"])} ` +
        `${pluralRu(n, ["правилась", "правились", "правились"])} после снимка — ` +
        `${pluralRu(n, ["останется", "останутся", "останутся"])} в нынешнем виде.`,
      fix:
        "Дзен-мани оставляет ту версию, что изменена позже. Если нужен именно " +
        "снимок, аккаунт надо сначала очистить.",
    });
  }

  if (tags.extra > 0) {
    blockers.push({
      kind: "extraTags",
      count: tags.extra,
      text: `${tags.extra} ${pluralRu(tags.extra, ["категория", "категории", "категорий"])} есть в аккаунте, но нет в снимке.`,
      fix: "«Начать всё сначала» категории не удаляет — их нужно снести отдельно, иначе после восстановления они останутся лишними.",
    });
  }

  if (merchants.extra > 0) {
    blockers.push({
      kind: "extraMerchants",
      count: merchants.extra,
      text: `${merchants.extra} ${pluralRu(merchants.extra, ["контрагент", "контрагента", "контрагентов"])} есть в аккаунте, но нет в снимке.`,
      fix: "Контрагентов «Начать всё сначала» тоже не трогает — удалите их отдельно.",
    });
  }

  return { transactions, accounts, tags, merchants, ready: blockers.length === 0, blockers };
}
