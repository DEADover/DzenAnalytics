// Диагностика синхронизации с Дзен-мани.
//
// Зачем: когда синхронизация ломается у отдельных людей, раньше от неё
// оставались тост на 5 секунд и строка журнала без подробностей — ни шага, на
// котором упало, ни кода ответа сервера, ни версии. Понять причину по
// скриншоту было нельзя. Здесь — запись об ошибке (что, где, когда, на какой
// версии), понятный человеку текст, пауза перед автоповтором и отчёт, который
// пользователь копирует одной кнопкой. Ни токена, ни сумм, ни названий в
// отчёт не попадает.

import { ZenApiError, ZenTimeoutError } from "./zenmoney";

/** Шаг, на котором синхронизация или отправка остановилась. */
export type SyncStage =
  | "request"
  | "plans"
  | "cloud"
  | "save"
  | "apply"
  | "calibrate"
  | "budgets"
  | "finish"
  | "push-prepare"
  | "push-send"
  | "push-apply";

export const STAGE_LABEL: Record<SyncStage, string> = {
  request: "Запрос изменений у Дзен-мани",
  plans: "Запрос планов",
  cloud: "Перенос настроек",
  save: "Сохранение в браузере",
  apply: "Разбор операций и правил",
  calibrate: "Балансы счетов",
  budgets: "Бюджеты и планы",
  finish: "Завершение",
  "push-prepare": "Подготовка правок",
  "push-send": "Отправка правок в Дзен-мани",
  "push-apply": "Приём ответа Дзен-мани",
};

export interface SyncFailure {
  /** Когда случилось, ISO. */
  at: string;
  kind: "pull" | "push";
  stage: SyncStage;
  /** HTTP-статус ответа Дзен-мани; null — до ответа дело не дошло. */
  status: number | null;
  /** Код ошибки из ответа сервера, если он его прислал. */
  code: string | null;
  /** Тип ошибки: ZenApiError, TypeError, QuotaExceededError… */
  name: string;
  message: string;
  /** Первые строки стека — где именно в коде. Без данных пользователя. */
  stack: string | null;
  /** Версия панели, на которой случилось. */
  version: string;
  /** Сколько синхронизаций подряд закончились ошибкой (включая эту). */
  streak: number;
}

/** Разобрать пойманное исключение в запись об ошибке. */
export function describeFailure(
  e: unknown,
  ctx: { kind: SyncFailure["kind"]; stage: SyncStage; streak: number; version: string; now?: Date }
): SyncFailure {
  const err = e instanceof Error ? e : new Error(typeof e === "string" ? e : "Неизвестная ошибка");
  const status = e instanceof ZenApiError ? e.status : null;
  const code = e instanceof ZenApiError ? e.code : null;
  // DOMException (QuotaExceededError и т.п.) — тоже Error, имя берём как есть.
  const stack = err.stack
    ? err.stack
        .split("\n")
        .slice(0, 6)
        .map((l) => l.trim())
        .join("\n")
    : null;
  return {
    at: (ctx.now ?? new Date()).toISOString(),
    kind: ctx.kind,
    stage: ctx.stage,
    status,
    code,
    name: err.name || "Error",
    message: err.message || String(e),
    stack,
    version: ctx.version,
    streak: ctx.streak,
  };
}

/** Похоже на обрыв сети: браузер не получил ответа вовсе. */
function isNetworkError(f: Pick<SyncFailure, "name" | "message" | "status">): boolean {
  if (f.status !== null) return false;
  return (
    f.name === "TypeError" &&
    /failed to fetch|load failed|networkerror|network request failed/i.test(f.message)
  );
}

/**
 * Что сказать человеку: причина простыми словами и что сделать. Технические
 * подробности (шаг, код, текст ошибки) — в журнале и отчёте, не здесь.
 */
export function friendlyFailure(f: SyncFailure): string {
  if (f.status === 401)
    return "Дзен-мани больше не принимает токен (401). Войдите заново — данные и неотправленные правки сохранятся.";
  if (f.status === 429) return "Дзен-мани просит реже обращаться к нему (429). Повторим автоматически позже.";
  if (f.status !== null && f.status >= 500)
    return `Сервер Дзен-мани ответил ошибкой (${f.status}). Обычно это временно — повторим позже.`;
  if (f.name === ZenTimeoutError.name) return `${f.message}. Проверьте интернет и попробуйте ещё раз.`;
  if (isNetworkError(f))
    return "Нет связи с Дзен-мани: запрос не дошёл. Проверьте интернет, VPN, блокировщик рекламы или антивирус.";
  if (f.name === "QuotaExceededError")
    return "В браузере кончилось место для данных сайта. Удалите старые снимки во вкладке «Бэкапы» или освободите место на диске.";
  if (f.status !== null) return `Дзен-мани ответил ошибкой ${f.status}: ${f.message}`;
  return `Не удалось на шаге «${STAGE_LABEL[f.stage]}»: ${f.message}`;
}

/** Одна строка для журнала: шаг, код ответа и текст ошибки как есть. */
export function failureDetails(f: SyncFailure): string {
  const parts = [`Шаг: ${STAGE_LABEL[f.stage]}`];
  if (f.status !== null) parts.push(`HTTP ${f.status}${f.code ? ` (${f.code})` : ""}`);
  parts.push(`${f.name}: ${f.message}`);
  parts.push(`Версия ${f.version}`);
  return parts.join(" · ");
}

/**
 * Пауза перед следующей автоматической попыткой после N ошибок подряд:
 * 1 → 2 → 5 → 15 → 30 минут. Без неё автосинхронизация при сбое стучалась
 * каждые 30 секунд: за час затирала журнал (а с ним — момент первого сбоя) и
 * могла сама нарваться на ограничение частоты запросов. Ручная синхронизация
 * паузу не ждёт.
 */
const BACKOFF_MIN = [1, 2, 5, 15, 30];
export function backoffMs(streak: number): number {
  if (streak <= 0) return 0;
  return BACKOFF_MIN[Math.min(streak, BACKOFF_MIN.length) - 1] * 60_000;
}

/** Когда можно следующую автопопытку; null — паузы нет. */
export function nextAutoRetryAt(f: SyncFailure | null): number | null {
  if (!f || f.streak <= 0) return null;
  return new Date(f.at).getTime() + backoffMs(f.streak);
}

/**
 * Сбой ещё продолжается: после него не было удачной попытки того же рода.
 * Удача обнуляет `streak`, поэтому судим по нему, а не по времени: время
 * удачи и ошибки может совпасть до миллисекунды (часы, подменённые в тестах,
 * или ошибка в ту же секунду), и «новее» на равных отметках ломалось.
 */
export function isFailureActive(f: SyncFailure | null): boolean {
  return !!f && f.streak > 0;
}

/** Токен перестал приниматься и с тех пор ни синхронизация, ни отправка не прошли. */
export function isAuthExpired(f: SyncFailure | null): boolean {
  return isFailureActive(f) && f!.status === 401;
}

/**
 * В консоль браузера — и в рабочей сборке: человек, которого попросили
 * «открыть консоль», должен увидеть там причину. Без токена и данных.
 */
export function logFailure(f: SyncFailure): void {
  console.error(
    `[DzenAnalytics] ${f.kind === "push" ? "Отправка правок" : "Синхронизация"} не удалась — ${failureDetails(f)}`,
    f.stack ? `\n${f.stack}` : ""
  );
}

// ───────────────────────── отчёт ─────────────────────────

export interface SyncReportInput {
  version: string;
  origin: string;
  userAgent: string;
  now: Date;
  loginMethod: "oauth" | "token" | null;
  pushMode: string;
  autoSync: string;
  cloudSettings: string;
  lastSyncAt: string | null;
  serverTimestamp: number;
  pullFailure: SyncFailure | null;
  pushFailure: SyncFailure | null;
  cache: { transactions: number; accounts: number; tags: number; bytes: number | null } | null;
  pending: Record<string, number>;
  storage: { usage: number; quota: number } | null;
  profiles: number;
  log: { ts: number; kind: string; status: string; title: string; error?: string; repeat?: number }[];
}

const fmtDate = (iso: string | number | null) =>
  iso === null || iso === 0 ? "—" : new Date(iso).toLocaleString("ru-RU");
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} МБ`;

/** Текст отчёта: только состояние и счётчики, без токена, сумм и названий. */
export function formatSyncReport(r: SyncReportInput): string {
  const lines: string[] = [];
  lines.push("DzenAnalytics — отчёт о синхронизации");
  lines.push(`Составлен: ${r.now.toLocaleString("ru-RU")}`);
  lines.push(`Версия: ${r.version}`);
  lines.push(`Адрес: ${r.origin}`);
  lines.push(`Браузер: ${r.userAgent}`);
  lines.push("");
  lines.push(
    `Вход: ${r.loginMethod === "oauth" ? "кнопкой «Войти через Дзен-мани»" : r.loginMethod === "token" ? "токен вставлен вручную" : "неизвестно (подключено до версии с отчётом)"}`
  );
  lines.push(`Отправка правок: ${r.pushMode}`);
  lines.push(`Автосинхронизация: ${r.autoSync}`);
  lines.push(`Перенос настроек: ${r.cloudSettings}`);
  lines.push(`Последняя удачная синхронизация: ${fmtDate(r.lastSyncAt)}`);
  lines.push(`Метка сервера: ${r.serverTimestamp ? fmtDate(r.serverTimestamp * 1000) : "—"}`);
  lines.push("");
  for (const [label, f] of [
    ["синхронизации", r.pullFailure],
    ["отправки правок", r.pushFailure],
  ] as const) {
    if (!f) {
      lines.push(`Последняя ошибка ${label}: нет`);
      continue;
    }
    const past = isFailureActive(f) ? "" : ", уже прошла";
    lines.push(`Последняя ошибка ${label}: ${fmtDate(f.at)} (подряд: ${f.streak}${past})`);
    lines.push(`  ${failureDetails(f)}`);
    if (f.stack) lines.push(...f.stack.split("\n").map((l) => `  ${l}`));
  }
  lines.push("");
  lines.push(
    r.cache
      ? `Данные Дзен-мани в браузере: операций ${r.cache.transactions}, счетов ${r.cache.accounts}, категорий ${r.cache.tags}${r.cache.bytes !== null ? `, ${mb(r.cache.bytes)}` : ""}`
      : "Данные Дзен-мани в браузере: нет"
  );
  const pend = Object.entries(r.pending).filter(([, n]) => n > 0);
  lines.push(`Очередь правок: ${pend.length ? pend.map(([k, n]) => `${k} ${n}`).join(", ") : "пусто"}`);
  lines.push(
    r.storage ? `Место сайта в браузере: занято ${mb(r.storage.usage)} из ${mb(r.storage.quota)}` : "Место сайта в браузере: неизвестно"
  );
  lines.push(`Профилей (аккаунтов) в панели: ${r.profiles}`);
  lines.push("");
  lines.push("Журнал (последние записи):");
  for (const e of r.log.slice(0, 15)) {
    const rep = e.repeat && e.repeat > 1 ? ` ×${e.repeat}` : "";
    lines.push(`  ${fmtDate(e.ts)} · ${e.title} · ${e.status}${rep}${e.error ? ` · ${e.error}` : ""}`);
  }
  if (r.log.length === 0) lines.push("  пусто");
  return lines.join("\n");
}
