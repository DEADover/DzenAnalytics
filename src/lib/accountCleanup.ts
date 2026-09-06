/**
 * Уборка справочников перед восстановлением из снимка (issue #93).
 *
 * ЗАЧЕМ. «Начать всё сначала» в Дзен-мани уносит операции и счета, но НЕ
 * трогает категории и контрагентов — они остаются в аккаунте как были. Если
 * после этого залить снимок, справочники сойдутся не полностью: всё, что
 * человек успел завести после снимка, останется лишним, а часть строк снимка
 * ляжет рядом с уже существующими одноимёнными. Поэтому справочники сносят
 * отдельно, и только потом заливают снимок — он приведёт свои.
 *
 * ПОЧЕМУ ПАРТИЯМИ И ПОСЛЕДОВАТЕЛЬНО. Удаление тега на стороне Дзен-мани —
 * дорогая операция: сервер обходит операции, которые на него ссылаются. На
 * больших аккаунтах одна партия занимает заметное время, а слишком крупный
 * запрос отваливается целиком. Поэтому шлём небольшими партиями, по очереди,
 * и после каждой сообщаем прогресс — чтобы человек видел, что процесс идёт, и
 * чтобы упавшая партия не уносила с собой уже удалённое.
 *
 * ЧАСТИЧНЫЙ УСПЕХ — ШТАТНЫЙ ИСХОД. Партия может не пройти (таймаут, отказ
 * сервера). Мы не откатываем сделанное и не бросаем всё: собираем ошибки,
 * доводим остальные партии до конца и возвращаем список неудач. Повторный
 * запуск доснесёт остаток — операция идемпотентна, уже удалённого в кэше
 * просто не будет.
 */

import { pushDiff, type ZenDeletion } from "./zenmoney";
import { loadZenCache, saveZenCache } from "./zenmoneyCache";
import { buildMerchantDeletions } from "./zenmoneyPush";
import { devLog } from "./devLog";

/**
 * Размер партии — РАЗНЫЙ для тегов и контрагентов, и это не вкусовщина.
 *
 * Удаление тега на стороне Дзен-мани дорогое: сервер обходит операции, которые
 * на него ссылаются. Замерено на живом аккаунте (48 тегов): партия из 25 висела
 * больше пяти минут и не завершилась — ни один тег за это время не удалился.
 * Сторонний сервис для восстановления по той же причине предлагает по 5.
 *
 * Контрагент такой обвязки не тянет, его удаление дешёвое, и дробить по пять
 * значило бы растянуть три сотни строк на шесть десятков запросов.
 */
export const TAG_BATCH = 5;
export const MERCHANT_BATCH = 50;

export interface CleanupProgress {
  phase: "tags" | "merchants" | "done";
  current: number;
  total: number;
}

export interface CleanupResult {
  /** Сколько удалено фактически (партии, прошедшие без ошибки). */
  tags: number;
  merchants: number;
  /** Партии, которые не прошли. Пусто — убралось всё. */
  failures: { phase: "tags" | "merchants"; size: number; reason: string }[];
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
 * Снести из аккаунта все категории и/или всех контрагентов.
 *
 * Удаляем ВСЁ, а не разницу со снимком: восстановление приведёт свои
 * справочники целиком, а половинчатая уборка оставила бы ровно ту путаницу,
 * ради устранения которой всё и затевается.
 */
export async function cleanupDictionaries(
  token: string,
  opts: CleanupOptions,
  onProgress?: (p: CleanupProgress) => void
): Promise<CleanupResult> {
  if (!token) throw new Error("Нет токена Дзен-мани");
  const cache = await loadZenCache();
  if (!cache) throw new Error("Нет кэша Дзен-мани — сначала синхронизируйтесь");

  const stamp = Math.floor(Date.now() / 1000);
  const result: CleanupResult = { tags: 0, merchants: 0, failures: [] };
  let serverTs = cache.serverTimestamp || 0;
  // Что реально удалилось — чтобы вычеркнуть это из локального кэша.
  const goneTags = new Set<string>();
  const goneMerchants = new Set<string>();

  const send = async (
    phase: "tags" | "merchants",
    deletions: ZenDeletion[]
  ): Promise<boolean> => {
    try {
      const resp = await pushDiff(token, serverTs, { deletion: deletions });
      serverTs = resp.serverTimestamp;
      return true;
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      result.failures.push({ phase, size: deletions.length, reason });
      devLog("zen-cleanup", `партия ${phase} (${deletions.length}) не прошла: ${reason}`, "error");
      return false;
    }
  };

  if (opts.tags) {
    // Теги удаляем СНИЗУ ВВЕРХ: сначала подкатегории, потом их родители.
    // Иначе родитель уходит первым и оставляет ребёнка без ветки — на
    // стороне Дзен-мани это осиротевшая строка, а не удаление.
    const byDepth = [...cache.tags].sort(
      (a, b) => (b.parent ? 1 : 0) - (a.parent ? 1 : 0)
    );
    const deletions: ZenDeletion[] = byDepth.map((t) => ({
      id: t.id,
      object: "tag",
      user: t.user,
      stamp,
    }));
    const batches = chunk(deletions, TAG_BATCH);
    let done = 0;
    for (const batch of batches) {
      onProgress?.({ phase: "tags", current: done, total: deletions.length });
      if (await send("tags", batch)) {
        result.tags += batch.length;
        for (const d of batch) goneTags.add(d.id);
      }
      done += batch.length;
    }
    onProgress?.({ phase: "tags", current: done, total: deletions.length });
  }

  if (opts.merchants) {
    const ids = cache.merchants.map((m) => m.id);
    const deletions = buildMerchantDeletions(ids, cache.merchants, stamp);
    const batches = chunk(deletions, MERCHANT_BATCH);
    let done = 0;
    for (const batch of batches) {
      onProgress?.({ phase: "merchants", current: done, total: deletions.length });
      if (await send("merchants", batch)) {
        result.merchants += batch.length;
        for (const d of batch) goneMerchants.add(d.id);
      }
      done += batch.length;
    }
    onProgress?.({ phase: "merchants", current: done, total: deletions.length });
  }

  // Вычёркиваем удалённое из локального кэша.
  //
  // Без этого следующая проверка готовности видела снесённые категории и
  // контрагентов как живых, показывала то же препятствие — и дальше пройти
  // было нельзя, хотя в облаке уже чисто. Полная синхронизация это чинила, но
  // требовать её после каждой уборки значит перекладывать на человека работу,
  // которую мы и так знаем как сделать: что удалено, известно точно.
  if (goneTags.size > 0 || goneMerchants.size > 0) {
    await saveZenCache({
      ...cache,
      tags: cache.tags.filter((t) => !goneTags.has(t.id)),
      merchants: cache.merchants.filter((m) => !goneMerchants.has(m.id)),
      serverTimestamp: serverTs,
    });
  }

  onProgress?.({ phase: "done", current: 0, total: 0 });
  devLog(
    "zen-cleanup",
    `удалено тегов ${result.tags}, контрагентов ${result.merchants}, ` +
      `неудачных партий ${result.failures.length}`
  );
  return result;
}
