// Backup helpers — gather the full IndexedDB snapshot into a JSON blob and
// trigger a browser download. Used by both manual «Backup» button on the
// /import page and the scheduled backup store.
//
// Token-like secrets are explicitly excluded. The Zenmoney access token and
// raw entity cache are intentionally NOT exported — those should never leave
// the device unencrypted.

import * as db from "./db";

// Версия 2 добавила настройки и правки, которых в списке не было: правки
// счетов, контрагентов и категорий, планы бюджета, разрезы данных, оформление.
// Старые бэкапы (version 1) читаются как раньше — недостающие ключи просто
// пропускаются при восстановлении.
export const BACKUP_VERSION = 2;

/**
 * Ключи, которые в бэкап НЕ идут, и почему.
 *
 * Список нужен не для кода, а для теста-сторожа: он сверяет всё, что
 * приложение пишет в базу, с суммой «в бэкапе» и «здесь». Появился новый
 * стор — тест упадёт и заставит принять решение. Раньше такого датчика не
 * было, и список бэкапа отстал на десяток ключей: пользователи теряли правки
 * счетов, контрагентов, настройки бюджета и разрезы данных.
 */
export const BACKUP_EXCLUDED_KEYS: Record<string, string> = {
  // Секреты — не должны покидать устройство в открытом JSON.
  zenmoneyToken: "токен доступа",
  zenmoneyCache: "сырой кэш сущностей Дзен-мани, тянет за собой весь объём",
  // Привязка к подключению. Без токена бесполезны, а восстановленный режим
  // «Авто» ещё и начал бы пушить в облако, когда токен появится.
  zenmoneyPushMode: "режим отправки — восстанавливать опасно",
  zenmoneyPushEnabled: "настройка подключения",
  zenmoneyAutoSyncEnabled: "настройка подключения",
  zenmoneyAutoSyncUnit: "настройка подключения",
  zenmoneyAutoSyncValue: "настройка подключения",
  zenmoneySnapshotPolicy: "настройка подключения",
  zenmoneyLastSyncAt: "метка времени, восстанавливать нечего",
  zenmoneyLastPushAt: "метка времени, восстанавливать нечего",
  zenmoneyServerTimestamp: "точка синхронизации, привязана к токену",
  // Производное: восстановится само.
  cloudSnapshotIndex: "снимки облака, их объём в бэкапе неуместен",
  syncLog: "журнал синхронизаций",
  backupLastAt: "метка времени последнего бэкапа",
};

/**
 * Every `meta`-store key that's part of a full local snapshot — the SINGLE
 * source of truth so backup (build) and restore never drift. Each is a
 * `db.loadJSON`/`db.saveJSON` blob; transactions / rates / importMeta have
 * their own stores and are handled explicitly.
 *
 * Includes the user's UN-PUSHED local changes (edits, drafts, deletions, tag
 * edits) so a restore brings back work not yet synced to the cloud — the whole
 * point of "restore if the browser dies". Secrets (Zenmoney token, raw entity
 * cache) are deliberately excluded — they must never leave the device in a
 * plain JSON backup.
 */
export const BACKUP_META_KEYS = [
  // settings / analytics config
  "budgets", // legacy flat budgets (Record<category, number>)
  "budgetsV2", // plan/fact budget lines (BudgetLine[])
  // Исторические курсы ЦБ по датам. Формально это кэш, и раньше он в бэкап не
  // шёл — «подтянется заново». Но тянется он теперь не быстрее одного запроса
  // в секунду (условия сервиса курсов), то есть три года валютной истории это
  // минут двенадцать ожидания, а при недоступном зеркале суммы не сойдутся
  // вовсе. Цена вопроса — 0,6 МБ на те же три года, и она того стоит.
  "histDayRates",
  "goals",
  "calibration",
  "fireExcludedAccounts",
  "includeOffBalance",
  "savedViews",
  "annotations", // legacy — feature archived (see archive/annotations); data preserved
  "categoryFlags", // legacy — kept so old backups round-trip
  "inflation", // legacy — feature removed; kept so old backups round-trip
  "payeeGrouping",
  "payeeAliases",
  "reportPeriod",
  "categoryRules",
  "duplicateExclusions",
  "budgetSettings", // периметр счетов, переводы, вид и прогноз бюджета
  "dataSlices", // разрезы данных
  "displaySettings", // оформление: размер текста в таблицах, копейки и т.п.
  "analyticsExcludedCategories", // категории, убранные из аналитики
  "categoryMeta", // иконки и цвета категорий
  "backupInterval", // как часто напоминать о бэкапе
  // un-pushed local changes
  "transactionEdits",
  "pendingTransactions", // drafts (new operations)
  "deletedTransactions",
  "deletedPayloads",
  "tagEdits",
  "tagDeletions",
  "accountEdits",
  "counterpartyEdits",
  "newCategories",
  "budgetEdits", // планы бюджета, ещё не уехавшие в Дзен-мани
  "plannedDeletions", // просроченные планы, снятые вручную (issue #71)
] as const;

export interface BackupPayload {
  version: number;
  exportedAt: string;
  transactions: unknown;
  rates: unknown;
  importMeta: unknown;
  /** All `BACKUP_META_KEYS` blobs (budgets, edits, drafts, rules, …). */
  [key: string]: unknown;
}

export async function buildBackupPayload(): Promise<BackupPayload> {
  const payload: BackupPayload = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    transactions: await db.loadTransactions(),
    rates: await db.loadRates(),
    importMeta: await db.loadImportMeta(),
  };
  for (const k of BACKUP_META_KEYS) {
    payload[k] = await db.loadJSON(k);
  }
  return payload;
}

/** Write a (validated) backup payload back into IndexedDB, restoring every
 *  section. Stores still need re-hydrating afterwards (caller's job) so the
 *  in-memory state matches the freshly-written disk state. */
export async function restoreBackupPayload(
  dump: Record<string, unknown>
): Promise<void> {
  if (dump.transactions) await db.saveTransactions(dump.transactions as never);
  if (dump.rates) await db.saveRates(dump.rates as never);
  if (dump.importMeta) await db.saveImportMeta(dump.importMeta as never);
  for (const k of BACKUP_META_KEYS) {
    if (dump[k] !== undefined) await db.saveJSON(k, dump[k]);
  }
}

// ── Import validation ──────────────────────────────────────────────────
//
// A restore reads an arbitrary user-supplied JSON file and writes it
// straight into IndexedDB. We harden that path:
//   • reject anything that isn't a versioned object;
//   • type-check the few sections we know the shape of;
//   • strip prototype-pollution keys (`__proto__` / `constructor` /
//     `prototype`) from every nested object, so a crafted file can't
//     poison Object.prototype when sections are later merged;
//   • bound nesting depth and array sizes against decompression-style
//     blow-ups.

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_DEPTH = 12;
const MAX_TRANSACTIONS = 1_000_000;

/** Recursively rebuild a JSON value, dropping dangerous keys and
 *  bounding nesting depth. Returns a clean copy (never the original). */
function deepSanitize(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return null;
  if (Array.isArray(value)) {
    return value.map((v) => deepSanitize(v, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (DANGEROUS_KEYS.has(k)) continue;
      out[k] = deepSanitize(v, depth + 1);
    }
    return out;
  }
  return value; // primitive
}

/**
 * Parse + validate + sanitize a backup file's text. Throws an Error
 * with a user-facing Russian message on anything malformed. On success
 * returns a sanitized object safe to write into IndexedDB.
 */
export function parseAndValidateBackup(text: string): BackupPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error("Файл не является корректным JSON", { cause: e });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Бэкап должен быть JSON-объектом");
  }
  const obj = parsed as Record<string, unknown>;
  if (!obj.version) {
    throw new Error("Не похоже на бэкап DzenAnalytics (нет поля version)");
  }
  // transactions, if present, must be an array of bounded length.
  if (obj.transactions !== undefined) {
    if (!Array.isArray(obj.transactions)) {
      throw new Error("Поле «transactions» повреждено (ожидался массив)");
    }
    if (obj.transactions.length > MAX_TRANSACTIONS) {
      throw new Error("Слишком много операций в бэкапе");
    }
  }
  // rates, if present, must be an object (base + rates map).
  if (
    obj.rates !== undefined &&
    obj.rates !== null &&
    (typeof obj.rates !== "object" || Array.isArray(obj.rates))
  ) {
    throw new Error("Поле «rates» повреждено");
  }
  return deepSanitize(obj) as BackupPayload;
}

export function backupFileName(now: Date = new Date(), tag?: string): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const suffix = tag ? `-${tag}` : "";
  return `dzenanalytics-backup-${stamp}${suffix}.json`;
}

/**
 * Build the backup payload and trigger a browser download.
 * Returns the byte size of the downloaded JSON.
 */
export async function downloadBackup(tag?: string): Promise<{
  size: number;
  fileName: string;
}> {
  const payload = await buildBackupPayload();
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const fileName = backupFileName(new Date(), tag);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Release the blob URL after the click had a chance to take effect.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { size: json.length, fileName };
}
