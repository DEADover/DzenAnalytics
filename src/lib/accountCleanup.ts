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
 * ПОЧЕМУ КАТЕГОРИИ — ПО ОДНОЙ. Стоимость запроса на удаление растёт КАК КВАДРАТ
 * числа категорий в нём. Замерено на живом аккаунте (7 662 операции):
 *
 *     1 категория  —   1,5 с
 *     5 категорий  —  48,2 с   (9,6 с на штуку)
 *    10 категорий  — 176,7 с   (17,7 с на штуку)
 *
 * Отсюда и прежняя загадка «партия из 25 висит больше пяти минут»: она не
 * висла, а честно считала свои ~18 минут. И отсюда же прежний неверный вывод
 * «около пяти секунд на категорию, ускорить нечем» — эта цифра была свойством
 * выбранного размера партии, а не сервера.
 *
 * Поэтому категории уходят ПО ОДНОЙ: полсотни занимают около минуты вместо
 * восьми. Контрагенты так не дорожают — их по-прежнему шлём пачками.
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
export const TAG_BATCH = 1;
export const MERCHANT_BATCH = 50;

export interface CleanupProgress {
  phase: "tags" | "merchants" | "done";
  /** Сколько ОТПРАВЛЕНО без ошибки; итог всё равно перепроверяется облаком. */
  sent: number;
  total: number;
  /**
   * Сколько строк прямо сейчас в работе.
   *
   * Без этого числа счётчик стоял на месте всё время, пока идёт запрос, — а
   * партия категорий уходит больше чем на минуту. Человек видел неподвижные
   * «0 из 48» и решал, что всё зависло. Теперь видно, что работа идёт и над
   * чем именно.
   */
  inFlight: number;
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

  const run = async (
    kind: "tag" | "merchant",
    deletions: ZenDeletion[],
    size: number,
    phase: "tags" | "merchants"
  ): Promise<number> => {
    let sent = 0;
    const total = deletions.length;
    for (const batch of chunk(deletions, size)) {
      if (signal?.aborted) break;
      onProgress?.({ phase, sent, total, inFlight: batch.length });
      if (await send(batch)) {
        sent += batch.length;
        onProgress?.({ phase, sent, total, inFlight: 0 });
        continue;
      }
      // Партия упала — пробуем поштучно, чтобы одна непроходимая строка не
      // утаскивала за собой соседние.
      for (const one of batch) {
        if (signal?.aborted) break;
        onProgress?.({ phase, sent, total, inFlight: 1 });
        if (await send([one])) sent += 1;
        else result.rejected.push({ kind, id: one.id, reason: "сервер отклонил удаление" });
        onProgress?.({ phase, sent, total, inFlight: 0 });
      }
    }
    onProgress?.({ phase, sent, total, inFlight: 0 });
    return sent;
  };

  if (opts.tags) {
    // Снизу вверх: сначала подкатегории, потом их родители — иначе родитель
    // уходит первым и оставляет ребёнка без ветки.
    const ordered = [...cache.tags].sort((a, b) => (b.parent ? 1 : 0) - (a.parent ? 1 : 0));
    result.sentTags = await run(
      "tag",
      ordered.map((t) => ({ id: t.id, object: "tag", user: t.user, stamp })),
      TAG_BATCH,
      "tags"
    );
  }

  if (opts.merchants) {
    result.sentMerchants = await run(
      "merchant",
      cache.merchants.map((m) => ({ id: m.id, object: "merchant", user: m.user, stamp })),
      MERCHANT_BATCH,
      "merchants"
    );
  }

  onProgress?.({ phase: "done", sent: 0, total: 0, inFlight: 0 });
  devLog(
    "zen-cleanup",
    `отправлено: категорий ${result.sentTags}, контрагентов ${result.sentMerchants}, ` +
      `отклонено ${result.rejected.length}`
  );
  return result;
}
