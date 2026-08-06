// Historical RUB exchange rates (CBR). Two consumers:
//  1. The EditTransactionModal tooltip — "what this op was worth on its date".
//  2. `amountBase` itself — the whole app reprices foreign-currency operations
//     at the CBR rate of their OWN date (matching how Zenmoney values them),
//     instead of a single sync-time snapshot. See useDataStore.recalcBase.
//
// Rates are "1 unit of foreign currency = N RUB" (Value / Nominal). Cached per
// day in IndexedDB; CBR's archive is immutable for past dates so a day fetched
// once never needs refetching.

import * as db from "./db";
import { toBase } from "./csv";
import type { CurrencyRates } from "../types";

interface CbrResponse {
  Valute: Record<string, { Value: number; Nominal: number }>;
}

// CBR has no weekend/holiday rates — walk back to the last published day. The
// window has to clear the New Year holidays, the longest gap in the year: in
// 2026 the archive jumps straight from 31 December to 13 January (12 days with
// no quote). A shorter window left every foreign-currency operation in the first
// half of January without a historical rate at all.
const MAX_LOOKBACK_DAYS = 16;
const CACHE_PREFIX = "fxRateCbr:";
/**
 * Сколько дат обрабатываем параллельно.
 *
 * К СЕТИ это отношения не имеет — все запросы идут через очередь `throttle()`
 * по одному в секунду. Параллельность нужна только чтобы быстро пролетать даты,
 * которые уже лежат в кэше: их обработка сети не требует вовсе, и гнать их
 * строго по одной значило бы растянуть повторный прогрев на пустом месте.
 */
const WARM_CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 8000; // abort a stalled CBR request so warming stays responsive.

// ── Темп запросов ────────────────────────────────────────────────────────────
//
// Условия зеркала: не более 1 запроса в секунду, 30 в минуту, 10 000 в сутки.
// Раньше прогрев шёл двенадцатью параллельными потоками без пауз — это под сотню
// запросов в секунду, то есть превышение примерно в сто раз. Сервис на такое
// отвечает отлупом, а приложение видело его как «зеркало недоступно»: мы сами
// себе и делали ту недоступность, на которую жаловались.
//
// Число запросов сократить нельзя — пакетного эндпоинта у зеркала нет, только
// по дню. Поэтому ограничиваем ТЕМП. Суточный лимит и так не грозит: каждая
// дата запрашивается раз в жизни (кэш дня вечен, архив ЦБ неизменен), а
// выходные и праздники не запрашиваются вовсе.

/** Минимальный промежуток между запросами. Меняется только тестами. */
let requestIntervalMs = 1000;

/** Для тестов: без этого прогон с реальной секундной паузой длился бы минуты. */
export function setRateRequestIntervalMs(ms: number): void {
  requestIntervalMs = ms;
}

let lastRequestAt = 0;
/** Цепочка промисов: каждый следующий запрос ждёт своей очереди. */
let requestGate: Promise<void> = Promise.resolve();

// ── Часы очереди ─────────────────────────────────────────────────────────────
//
// Пауза отсчитывается таймером В ВОРКЕРЕ, а не в странице. Причина замерена:
// в скрытой вкладке браузер душит таймеры главного потока — `setInterval(1000)`
// дал 6 срабатываний за 40 секунд, тогда как тот же таймер в Web Worker выдал
// 33 ровно по 1000 мс. На таймере страницы фоновый прогрев курсов практически
// останавливался: паузы между запросами доходили до минуты.
//
// Воркер собирается из строки через Blob — отдельным файлом он не пережил бы
// standalone-сборку, где всё приложение это один HTML.

const TIMER_WORKER_SRC =
  "onmessage=(e)=>{const{id,ms}=e.data;setTimeout(()=>postMessage(id),ms)}";

/** `undefined` — ещё не пробовали, `null` — воркеры недоступны. */
let timerWorker: Worker | null | undefined;
let timerSeq = 0;
const timerWaiters = new Map<number, () => void>();

function getTimerWorker(): Worker | null {
  if (timerWorker !== undefined) return timerWorker;
  try {
    const url = URL.createObjectURL(
      new Blob([TIMER_WORKER_SRC], { type: "text/javascript" })
    );
    const w = new Worker(url);
    URL.revokeObjectURL(url);
    w.onmessage = (e: MessageEvent<number>) => {
      const done = timerWaiters.get(e.data);
      if (done) {
        timerWaiters.delete(e.data);
        done();
      }
    };
    timerWorker = w;
  } catch {
    // Нет Worker/Blob (тесты в node, редкий браузер, запрет CSP) — падаем на
    // таймер страницы: медленнее в фоне, но работает.
    timerWorker = null;
  }
  return timerWorker;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  const w = getTimerWorker();
  if (!w) return new Promise((resolve) => setTimeout(resolve, ms));
  return new Promise((resolve) => {
    const id = ++timerSeq;
    timerWaiters.set(id, resolve);
    w.postMessage({ id, ms });
  });
}

/**
 * Дождаться своей очереди на сетевой запрос.
 *
 * Темп держится и в свёрнутой вкладке — паузу отсчитывает воркер (см. `sleep`),
 * а его таймеры браузер не душит.
 */
function throttle(): Promise<void> {
  const turn = requestGate.then(async () => {
    const wait = requestIntervalMs - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
  });
  // Ошибку в цепочке гасим: одна упавшая очередь не должна заблокировать все
  // последующие запросы навсегда.
  requestGate = turn.catch(() => {});
  return turn;
}

/**
 * Притормозить очередь: сервис попросил подождать (429) или ответил ошибкой.
 * Двигаем метку последнего запроса вперёд — ждать будет вся очередь, а не
 * только тот, кто получил отлуп.
 */
function backoff(ms: number): void {
  lastRequestAt = Math.max(lastRequestAt, Date.now() + ms - requestIntervalMs);
}

/** `Retry-After` в миллисекундах: секунды или HTTP-дата. */
export function retryAfterMs(header: string | null, fallback = 5000): number {
  if (!header) return fallback;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
  const at = Date.parse(header);
  if (Number.isFinite(at)) return Math.min(Math.max(at - Date.now(), 0), 60_000);
  return fallback;
}
/** Always present and CORS-enabled — used only to tell «зеркало лежит» from
 *  «на эту дату курса нет». See `mirrorIsUp()`. */
const CBR_LATEST_URL = "https://www.cbr-xml-daily.ru/daily_json.js";

/** Day → { currency: rubPerUnit }. The applied historical-rate index. */
export type HistDayRates = Record<string, Record<string, number>>;

function cbrUrl(date: string): string {
  const [y, m, d] = date.split("-");
  return `https://www.cbr-xml-daily.ru/archive/${y}/${m}/${d}/daily_json.js`;
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Sat/Sun — CBR NEVER publishes a rate on these, so we skip the request
 *  entirely and let the look-back fall through to the previous business day.
 *  This matters because the mirror's 404 for a missing day carries no CORS
 *  header, so a browser fetch of a weekend URL doesn't return status 404 — it
 *  THROWS `TypeError: Failed to fetch`, costing a doomed request (and a red
 *  console/network entry) for every weekend op date. */
export function isWeekendUTC(date: string): boolean {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/** Федеральные нерабочие дни (ММ-ДД) — ЦБ в них курс не публикует. Список
 *  фиксированный: переносы выходных сюда не входят, такой день просто получит
 *  один запрос-мимо и запомнится как пропуск. */
const RU_HOLIDAYS_MMDD = new Set([
  "01-01", "01-02", "01-03", "01-04", "01-05", "01-06", "01-07", "01-08",
  "02-23", "03-08", "05-01", "05-09", "06-12", "11-04",
]);

/** День, на который курса заведомо не будет: выходной или праздник. Такие даты
 *  мы не запрашиваем вовсе — и потому, что запрос обречён, и потому, что 404 с
 *  этого зеркала приходит БЕЗ CORS-заголовка: в браузере он превращается в
 *  красный `TypeError: Failed to fetch` в консоли. */
export function isNoQuoteDayUTC(date: string): boolean {
  return isWeekendUTC(date) || RU_HOLIDAYS_MMDD.has(date.slice(5, 10));
}

/**
 * Жив ли сервис курсов.
 *
 * Отличить «зеркало недоступно» от «на эту дату курса нет» из браузера нельзя:
 * 404 на отсутствующий день приходит без CORS-заголовков, поэтому `fetch`
 * бросает `TypeError: Failed to fetch` — ровно как при обрыве сети. Спрашиваем
 * у зеркала документ с последним курсом (он есть всегда и CORS отдаёт): ответил
 * — значит зеркало живо и ошибка относится к конкретной дате, её можно записать
 * как настоящий пропуск. Без этой проверки каждый праздник переспрашивался при
 * КАЖДОМ прогреве — вечно, с новой ошибкой в консоли (issue #53).
 *
 * Ответ живёт недолго (MIRROR_PROBE_TTL_MS): «зеркало живо» — это разрешение
 * записать дату как пропуск НАВСЕГДА, поэтому проверка не должна устаревать.
 * Иначе сеть, отвалившаяся посреди долгого прогрева, тихо превратила бы весь
 * остаток дат в «курса нет». Неудачу не кэшируем вовсе.
 */
const MIRROR_PROBE_TTL_MS = 60_000;
let mirrorUpProbe: Promise<boolean> | null = null;
let mirrorUpProbeAt = 0;
let mirrorDownAt = 0;

/** Сервис только что не ответил на проверку — обречённые запросы можно не
 *  делать вовсе. Без этого прогрев в офлайне честно перебирал всё окно отката
 *  на КАЖДУЮ дату: сотня операций в валюте превращалась в тысячу мёртвых
 *  запросов и в такую же гору ошибок в консоли. */
function mirrorKnownDown(): boolean {
  return mirrorDownAt > 0 && Date.now() - mirrorDownAt < MIRROR_PROBE_TTL_MS;
}
function mirrorIsUp(): Promise<boolean> {
  if (mirrorUpProbe && Date.now() - mirrorUpProbeAt < MIRROR_PROBE_TTL_MS) {
    return mirrorUpProbe;
  }
  mirrorUpProbeAt = Date.now();
  const probe = (async () => {
    try {
      await throttle();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(CBR_LATEST_URL, { signal: controller.signal });
        return res.ok;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    }
  })();
  mirrorUpProbe = probe;
  void probe.then((up) => {
    if (up) {
      mirrorDownAt = 0;
    } else {
      // Неудачу не кэшируем как обещание — сеть могла моргнуть; но помним
      // момент, чтобы не долбиться в мёртвый сервис весь прогрев.
      mirrorUpProbe = null;
      mirrorDownAt = Date.now();
    }
  });
  return probe;
}

/** Сбросить память о доступности зеркала — для повторной попытки по кнопке. */
export function resetMirrorProbe(): void {
  mirrorUpProbe = null;
  mirrorUpProbeAt = 0;
  mirrorDownAt = 0;
}

/** A day's rates plus whether the result is AUTHORITATIVE — i.e. we know for
 *  sure (data, or a real 404 «no rate for this date»), versus a transient
 *  failure (timeout / network error / 5xx) where we simply couldn't reach CBR.
 *  Only authoritative results are cached / recorded; transient ones are left
 *  «missing» so a later run retries them instead of poisoning the cache with an
 *  empty entry that would never be refetched. */
interface DayFetch {
  rates: Record<string, number>;
  authoritative: boolean;
}

// De-dup concurrent look-ups of the SAME day. When many weekend/holiday dates
// walk back to the same Friday, the parallel warm workers would otherwise all
// fetch that Friday at once; sharing one in-flight promise collapses them into
// a single request. Cleared as soon as it settles (the IDB cache takes over).
const inFlight = new Map<string, Promise<DayFetch>>();

function fetchRatesForDate(date: string): Promise<DayFetch> {
  const running = inFlight.get(date);
  if (running) return running;
  const p = fetchRatesForDateUncached(date);
  inFlight.set(date, p);
  return p.finally(() => inFlight.delete(date));
}

async function fetchRatesForDateUncached(date: string): Promise<DayFetch> {
  const cacheKey = `${CACHE_PREFIX}${date}`;
  const cached = await db.loadJSON<Record<string, number>>(cacheKey);
  if (cached) return { rates: cached, authoritative: true };

  try {
    await throttle();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(cbrUrl(date), { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) {
      const data: CbrResponse = await res.json();
      const rates = Object.fromEntries(
        Object.entries(data.Valute).map(([code, v]) => [code, v.Value / v.Nominal])
      );
      await db.saveJSON(cacheKey, rates);
      return { rates, authoritative: true };
    }
    if (res.status === 404) {
      // Genuinely no rate for this date (weekend / holiday / future). Cache the
      // empty result so it isn't requested again.
      await db.saveJSON(cacheKey, {});
      return { rates: {}, authoritative: true };
    }
    // 429 — мы всё-таки перебрали темп: тормозим ВСЮ очередь на столько, на
    // сколько просит сервис. Немедленный повтор тем же залпом только продлил бы
    // отлуп — ровно так и выглядела «недоступность» раньше.
    if (res.status === 429) backoff(retryAfterMs(res.headers?.get?.("Retry-After") ?? null));
    // 5xx / 429 / other — transient. Don't cache; allow a retry later.
    return { rates: {}, authoritative: false };
  } catch {
    // Либо зеркало недоступно, либо этого дня просто нет в архиве: 404 оттуда
    // приходит без CORS-заголовка, и браузер в обоих случаях даёт TypeError.
    // Спрашиваем у зеркала, живо ли оно, — и только тогда решаем, можно ли
    // запомнить дату как пропуск.
    if (await mirrorIsUp()) {
      await db.saveJSON(cacheKey, {});
      return { rates: {}, authoritative: true };
    }
    return { rates: {}, authoritative: false };
  }
}

/** The CBR rate map for `date`, or the nearest earlier business day. The result
 *  is authoritative when we actually found rates, or when every probe in the
 *  lookback window returned a real 404 (a genuine gap). If any probe failed
 *  transiently and no rates were found, it's NOT authoritative — retry later. */
async function resolveDayRates(
  date: string
): Promise<{ rates: Record<string, number>; rateDate: string; authoritative: boolean }> {
  let allAuthoritative = true;
  for (let back = 0; back <= MAX_LOOKBACK_DAYS; back++) {
    // Сервис лежит — откатываться дальше некуда, все запросы всё равно упадут.
    if (mirrorKnownDown()) return { rates: {}, rateDate: date, authoritative: false };
    const tryDate = shiftDate(date, -back);
    // Выходные и праздники ЦБ не котирует — не тратим обречённый запрос (он
    // ещё и падает по CORS, засоряя консоль); цикл сам откатится к ближайшему
    // рабочему дню на следующей итерации.
    if (isNoQuoteDayUTC(tryDate)) continue;
    const { rates, authoritative } = await fetchRatesForDate(tryDate);
    if (Object.keys(rates).length > 0) {
      return { rates, rateDate: tryDate, authoritative: true };
    }
    if (!authoritative) allAuthoritative = false;
  }
  return { rates: {}, rateDate: date, authoritative: allAuthoritative };
}

export interface HistoricalRate {
  rate: number;
  /** The date the rate was actually published for — may be earlier than the
   *  requested date if it fell on a weekend/holiday. */
  rateDate: string;
}

/**
 * 1 unit of `currency` in RUB, on the CBR rate published for `date` (or the
 * nearest earlier business day). Returns null if unavailable (currency not
 * tracked by CBR, or no network/cache data within the lookback window).
 */
export async function getHistoricalRubRate(
  date: string,
  currency: string
): Promise<HistoricalRate | null> {
  if (currency === "RUB") return { rate: 1, rateDate: date };
  const day = await resolveDayRates(date);
  if (day.rates[currency] != null) {
    return { rate: day.rates[currency], rateDate: day.rateDate };
  }
  return null;
}

/**
 * Warm the CBR rates for a batch of operation dates. Returns a day→currency-map
 * index (RUB per unit), resolving weekends/holidays to the nearest business
 * day. A genuine gap (real 404) is recorded as `{}` so it isn't refetched; a
 * date that failed transiently (timeout / network) is OMITTED entirely so the
 * caller retries it later. Runs with bounded concurrency; `onProgress(done,
 * total)` fires per unique date.
 */
export async function fetchHistoricalRubRates(
  dates: string[],
  onProgress?: (done: number, total: number) => void
): Promise<HistDayRates> {
  // От свежих к старым: темп ограничен секундой на запрос, и прогрев большой
  // истории идёт минутами — пусть сначала уточнятся те месяцы, на которые
  // человек смотрит, а не операции трёхлетней давности.
  const unique = Array.from(new Set(dates)).sort((a, b) => b.localeCompare(a));
  const out: HistDayRates = {};
  let done = 0;
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= unique.length) break;
      const date = unique[i];
      const day = await resolveDayRates(date);
      // Record ONLY authoritative results (real data or a genuine 404 gap).
      // Transient failures are omitted so the store keeps the date «missing»
      // and retries it next time — instead of caching an empty entry forever.
      if (day.authoritative) out[date] = day.rates;
      done++;
      onProgress?.(done, unique.length);
    }
  }

  const workers = Array.from(
    { length: Math.min(WARM_CONCURRENCY, unique.length) },
    () => worker()
  );
  await Promise.all(workers);
  return out;
}

/**
 * Base-currency value of an operation, preferring the CBR rate on its OWN date
 * over the sync-time snapshot. Only exact for a RUB base (CBR is RUB-centric);
 * any other base, or a date/currency CBR doesn't cover, falls back to the
 * standard sync-time conversion so nothing ever shows a blank.
 */
export function baseWithHistory(
  amount: number,
  currency: string,
  date: string,
  rates: CurrencyRates,
  hist: HistDayRates
): number {
  if (currency === rates.base) return amount;
  if (rates.base === "RUB") {
    const r = hist[date]?.[currency];
    if (r != null) return amount * r;
  }
  return toBase(amount, currency, rates);
}
