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

const MAX_LOOKBACK_DAYS = 5; // CBR has no weekend/holiday rates — walk back to the last published day.
const CACHE_PREFIX = "fxRateCbr:";
const WARM_CONCURRENCY = 12; // parallel CBR fetches when warming many dates.
const FETCH_TIMEOUT_MS = 8000; // abort a stalled CBR request so warming stays responsive.

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
    // 5xx / 429 / other — transient. Don't cache; allow a retry later.
    return { rates: {}, authoritative: false };
  } catch {
    // Network failure / timeout / abort — transient. Don't cache.
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
    const tryDate = shiftDate(date, -back);
    // Sat/Sun have no CBR rate — don't waste a (CORS-failing) request; the
    // loop rolls back to the preceding business day on the next iteration.
    if (isWeekendUTC(tryDate)) continue;
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
  const unique = Array.from(new Set(dates));
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
