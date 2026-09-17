import { openDB, type IDBPDatabase } from "idb";
import type { Transaction, CurrencyRates, ImportMeta } from "../types";

const DB_NAME = "dzenanalytics";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("transactions")) {
          db.createObjectStore("transactions", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta");
        }
      },
    });
  }
  return dbPromise;
}

export async function saveTransactions(txs: Transaction[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("transactions", "readwrite");
  await tx.store.clear();
  for (const t of txs) await tx.store.put(t);
  await tx.done;
}

export async function loadTransactions(): Promise<Transaction[]> {
  const db = await getDB();
  return db.getAll("transactions");
}

export async function clearTransactions(): Promise<void> {
  const db = await getDB();
  await db.clear("transactions");
}

export async function saveRates(rates: CurrencyRates): Promise<void> {
  const db = await getDB();
  await db.put("meta", rates, "rates");
}

export async function loadRates(): Promise<CurrencyRates | null> {
  const db = await getDB();
  return (await db.get("meta", "rates")) || null;
}

export async function saveImportMeta(meta: ImportMeta): Promise<void> {
  const db = await getDB();
  await db.put("meta", meta, "import");
}

export async function loadImportMeta(): Promise<ImportMeta | null> {
  const db = await getDB();
  return (await db.get("meta", "import")) || null;
}

export async function saveJSON<T>(key: string, value: T): Promise<void> {
  const db = await getDB();
  await db.put("meta", value, key);
}

export async function loadJSON<T>(key: string): Promise<T | null> {
  const db = await getDB();
  return ((await db.get("meta", key)) as T) || null;
}

/**
 * Удалить все ключи meta, начинающиеся с `prefix`. Возвращает, сколько удалено.
 * Нужно для чисток вроде дневного кэша курсов, который больше не ведём.
 */
export async function deleteByPrefix(prefix: string): Promise<number> {
  const db = await getDB();
  const tx = db.transaction("meta", "readwrite");
  const keys = await tx.store.getAllKeys();
  let removed = 0;
  for (const k of keys) {
    if (typeof k === "string" && k.startsWith(prefix)) {
      await tx.store.delete(k);
      removed++;
    }
  }
  await tx.done;
  return removed;
}

/**
 * Full local wipe: clear the transactions store and EVERY meta key except the
 * given `keepKeys` (connection + preferences). This is the «удалить локальные
 * данные» path — it must remove everything derived from / tied to the imported
 * dataset (cache, server timestamp, duplicate exclusions, calibration, drafts,
 * edits, category meta, …) so nothing «resurrects» after a fresh re-sync.
 *
 * Allow-list (not block-list) on purpose: any store added later is wiped by
 * default, so this can't silently go stale the way the old per-store clear did.
 */
export async function clearAllExcept(keepKeys: string[]): Promise<void> {
  const db = await getDB();
  const keep = new Set(keepKeys);
  await db.clear("transactions");
  const tx = db.transaction("meta", "readwrite");
  const keys = await tx.store.getAllKeys();
  for (const k of keys) {
    if (!keep.has(k as string)) await tx.store.delete(k);
  }
  await tx.done;
}
