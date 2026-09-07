/**
 * Удаление категорий и контрагентов перед восстановлением из снимка (#93).
 *
 * ЗАЧЕМ. Команда «Начать всё сначала» в Дзен-мани уносит операции и счета, но
 * не трогает справочники. Если их не удалить, снимок приведёт свои — и рядом
 * окажутся два набора одинаковых по названию, но разных для Дзен-мани.
 *
 * ПОЧЕМУ МЫ НЕ ВЕРИМ ОТВЕТУ СЕРВЕРА. Дзен-мани умеет ответить 200 и молча
 * ничего не сделать — на этом и построена вся задача. Поэтому здесь НЕТ
 * подсчёта «удалено N» по факту отсутствия ошибки и НЕТ правки локального
 * кэша: раньше уборка вычёркивала строки из кэша сама, и следующая сверка,
 * читая тот же кэш, докладывала «аккаунт пуст» при живых категориях в облаке.
 * Единственный честный ответ на вопрос «удалилось ли» даёт синхронизация,
 * поэтому здесь мы только отправляем запросы, а итог считает тот, кто потом
 * заново спросит облако.
 *
 * СКОЛЬКО ЭТО СТОИТ. Замерено на живом аккаунте (7 662 операции) одноразовыми
 * категориями, при боевом `serverTimestamp`:
 *
 *    последовательно, по одной   — 357 с на 20 категорий (18,0 с на штуку)
 *    последовательно, пятёрками  — 341 с на 20 категорий (17,0 с на штуку)
 *    СЕМЬ ПЯТЁРОК ОДНОВРЕМЕННО   — 128 с на 35 категорий (3,7 с на штуку)
 *
 * То есть размер партии не решает ничего (разница 5%, шум), а вот
 * ПАРАЛЛЕЛЬНОСТЬ решает: в 4,6 раза. Все семь запросов уходят разом и
 * возвращаются за 103–128 с. Подсказал приём партнёрский ZenTable — у него в
 * интерфейсе так и написано: размер партии 5, одновременно до 7.
 *
 * ОСТОРОЖНО С ЗАМЕРАМИ. По этому вопросу я ошибся трижды. Сначала «около пяти
 * секунд на категорию» — цифра была свойством размера партии. Потом «цена
 * растёт как квадрат партии» — тот замер шёл с `serverTimestamp: 0`, при
 * котором сервер работает иначе, чем при боевой инкрементальной метке. Потом
 * «сервер всё равно выполняет запросы по очереди» — не выполняет. Мерить надо
 * ровно так, как ходит боевой код, и проверять параллельность отдельно.
 *
 * ПОЧЕМУ ДВУМЯ ВОЛНАМИ. Родителя нельзя удалять одновременно с его
 * подкатегорией: порядок «снизу вверх» ради того и заведён. Поэтому сначала
 * параллельно уходят все подкатегории, и только потом — все родители.
 *
 * ПОЧЕМУ ПОВТОР ПО ОДНОМУ. Если одну категорию сервер удалять отказывается,
 * с ней падает вся партия — и при следующем запуске те же пятеро снова
 * соберутся вместе. Получался вечный тупик: «нажмите ещё раз» не сбывалось
 * никогда. Поэтому упавшую партию сразу переотправляем поштучно: тогда
 * непроходимой остаётся ровно одна строка, а не пять.
 */

import { pushDiff, type ZenDeletion } from "./zenmoney";
import { loadZenCache } from "./zenmoneyCache";
import { devLog } from "./devLog";

/** Размер партии. Разный, и это не вкусовщина — см. шапку модуля. */
export const TAG_BATCH = 5;
export const MERCHANT_BATCH = 50;
/**
 * Сколько запросов держим в воздухе одновременно.
 *
 * Семь — не наугад: столько же ставит партнёрский ZenTable, и на замере семь
 * пятёрок дали 3,7 с на категорию против 17 с последовательно. Гнаться за
 * бо́льшим числом не стали: выигрыш уже основной, а лишние соединения — риск
 * упереться в ограничения сервера.
 */
export const PARALLEL = 7;

export interface CleanupProgress {
  phase: "tags" | "merchants" | "done";
  /** Сколько ОТПРАВЛЕНО без ошибки; итог всё равно перепроверяется облаком. */
  sent: number;
  total: number;
}

export interface CleanupResult {
  /** Отправлено без ошибки. Не «удалено»: это знает только облако. */
  sentTags: number;
  sentMerchants: number;
  /** Строки, которые сервер отказался удалять даже поштучно. */
  rejected: { kind: "tag" | "merchant"; id: string; reason: string }[];
}

export interface CleanupOptions {
  tags: boolean;
  merchants: boolean;
}

/**
 * Выполнить задачи, держа в воздухе не больше `limit` штук.
 *
 * `Promise.all` по всем партиям сразу открыл бы столько соединений, сколько
 * партий, — а браузер и сервер этому не рады. Пул берёт следующую задачу, как
 * только освобождается место.
 */
export async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(lanes);
}

/** Нарезать на партии фиксированного размера. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Отправить удаление всех категорий и/или всех контрагентов.
 *
 * Удаляем ВСЁ, а не разницу со снимком: снимок приведёт свои справочники
 * целиком, а половинчатая уборка оставила бы ровно ту путаницу, ради которой
 * всё и затевается.
 */
export async function cleanupDictionaries(
  token: string,
  opts: CleanupOptions,
  onProgress?: (p: CleanupProgress) => void,
  signal?: AbortSignal
): Promise<CleanupResult> {
  if (!token) throw new Error("Нет токена Дзен-мани");
  const cache = await loadZenCache();
  if (!cache) throw new Error("Нет данных Дзен-мани — сначала синхронизируйтесь");

  const stamp = Math.floor(Date.now() / 1000);
  const result: CleanupResult = { sentTags: 0, sentMerchants: 0, rejected: [] };
  // Указатель времени НЕ трогаем и в кэш ничего не пишем: сдвинутый указатель
  // заставил бы следующую инкрементальную синхронизацию пропустить всё, что
  // случилось в этом промежутке.
  const serverTs = cache.serverTimestamp || 0;

  /** Отправить партию. Успех — только отсутствие ошибки, не доказательство. */
  const send = async (deletions: ZenDeletion[]): Promise<boolean> => {
    try {
      await pushDiff(token, serverTs, { deletion: deletions }, signal);
      return true;
    } catch (e) {
      devLog(
        "zen-cleanup",
        `партия из ${deletions.length} не прошла: ${e instanceof Error ? e.message : String(e)}`,
        "error"
      );
      return false;
    }
  };

  /**
   * Прогнать удаление по группам.
   *
   * Группы идут ПО ОЧЕРЕДИ, партии внутри группы — ПАРАЛЛЕЛЬНО. У категорий
   * групп две (сначала подкатегории, потом родители), у контрагентов одна.
   */
  const run = async (
    kind: "tag" | "merchant",
    groups: ZenDeletion[][],
    size: number,
    phase: "tags" | "merchants"
  ): Promise<number> => {
    const total = groups.reduce((n, g) => n + g.length, 0);
    let sent = 0;
    const report = () => onProgress?.({ phase, sent, total });
    report();
    for (const group of groups) {
      await runPool(chunk(group, size), PARALLEL, async (batch) => {
        if (signal?.aborted) return;
        const ok = await send(batch);
        if (ok) {
          sent += batch.length;
          report();
          return;
        }
        // Партия упала — пробуем поштучно, чтобы одна непроходимая строка не
        // утаскивала за собой соседние.
        for (const one of batch) {
          if (signal?.aborted) break;
          const okOne = await send([one]);
          if (okOne) sent += 1;
          else result.rejected.push({ kind, id: one.id, reason: "сервер отклонил удаление" });
          report();
        }
      });
    }
    report();
    return sent;
  };

  if (opts.tags) {
    // Снизу вверх ДВУМЯ ВОЛНАМИ: сначала все подкатегории, потом все родители.
    // Внутри волны запросы идут одновременно, а вот родителя с его ребёнком
    // одновременно удалять нельзя — родитель уйдёт первым и оставит ребёнка
    // без ветки.
    const del = (t: (typeof cache.tags)[number]): ZenDeletion => ({
      id: t.id,
      object: "tag",
      user: t.user,
      stamp,
    });
    const children = cache.tags.filter((t) => t.parent).map(del);
    const parents = cache.tags.filter((t) => !t.parent).map(del);
    result.sentTags = await run("tag", [children, parents], TAG_BATCH, "tags");
  }

  if (opts.merchants) {
    result.sentMerchants = await run(
      "merchant",
      [cache.merchants.map((m) => ({ id: m.id, object: "merchant", user: m.user, stamp }))],
      MERCHANT_BATCH,
      "merchants"
    );
  }

  onProgress?.({ phase: "done", sent: 0, total: 0 });
  devLog(
    "zen-cleanup",
    `отправлено: категорий ${result.sentTags}, контрагентов ${result.sentMerchants}, ` +
      `отклонено ${result.rejected.length}`
  );
  return result;
}
