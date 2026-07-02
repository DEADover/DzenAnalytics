import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory IndexedDB stand-in so the loader's day-cache works without a real DB.
const store = new Map<string, unknown>();
vi.mock("./db", () => ({
  loadJSON: async (k: string) => (store.has(k) ? store.get(k) : null),
  saveJSON: async (k: string, v: unknown) => {
    store.set(k, v);
  },
}));

import { fetchHistoricalRubRates, isWeekendUTC } from "./historicalRates";

// Mock the CBR mirror: 200 + fake rates on business days; a weekend URL THROWS
// `TypeError: Failed to fetch` — exactly what the real mirror does (its 404 has
// no CORS header). If the loader ever requests a weekend, this records it.
let fetchCalls: string[] = [];
function dateFromUrl(url: string): string {
  const m = url.match(/archive\/(\d{4})\/(\d{2})\/(\d{2})\//);
  if (!m) throw new Error(`unexpected url ${url}`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}
function installFetch() {
  fetchCalls = [];
  globalThis.fetch = vi.fn(async (input: unknown) => {
    const url = String(input);
    fetchCalls.push(url);
    if (isWeekendUTC(dateFromUrl(url))) throw new TypeError("Failed to fetch");
    return {
      ok: true,
      status: 200,
      json: async () => ({ Valute: { USD: { Value: 90, Nominal: 1 } } }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  store.clear();
  installFetch();
});

describe("historicalRates — weekend skip & de-dup", () => {
  it("never requests a weekend URL (Sat/Sun are skipped, not fetched)", async () => {
    await fetchHistoricalRubRates(["2021-03-14"]); // a Sunday
    const days = fetchCalls.map(dateFromUrl);
    expect(days).not.toContain("2021-03-14"); // Sun
    expect(days).not.toContain("2021-03-13"); // Sat
    expect(days).toContain("2021-03-12"); // → resolves to Friday
    expect(fetchCalls.every((u) => !isWeekendUTC(dateFromUrl(u)))).toBe(true);
  });

  it("de-dups concurrent look-ups that resolve to the same business day", async () => {
    // Sat + Sun both roll back to Fri 2021-03-12 — it must be fetched once.
    await fetchHistoricalRubRates(["2021-03-13", "2021-03-14"]);
    const fridayHits = fetchCalls.filter((u) => u.includes("2021/03/12")).length;
    expect(fridayHits).toBe(1);
  });

  it("benchmark: 90 dates warm with requests bounded by business days only", async () => {
    const dates: string[] = [];
    for (let d = 1; d <= 90; d++) {
      dates.push(new Date(Date.UTC(2022, 0, d)).toISOString().slice(0, 10));
    }
    const businessDays = dates.filter((d) => !isWeekendUTC(d));
    const weekendDates = dates.length - businessDays.length;

    const t0 = performance.now();
    const out = await fetchHistoricalRubRates(dates);
    const ms = Math.round(performance.now() - t0);

    // Every date got a resolved entry (weekends map to the prior Friday).
    expect(Object.keys(out).length).toBe(dates.length);
    // Not one weekend URL was requested.
    expect(fetchCalls.every((u) => !isWeekendUTC(dateFromUrl(u)))).toBe(true);
    // No day is ever fetched twice (in-flight de-dup + IDB day-cache).
    expect(fetchCalls.length).toBe(new Set(fetchCalls).size);
    // Requests are bounded by the business days (+ at most a couple of Fridays
    // just before the range, reached by an early-in-range weekend). Weekends
    // themselves add ZERO network cost — before the fix each cost a doomed
    // request plus its walk-back.
    expect(new Set(fetchCalls).size).toBeLessThanOrEqual(businessDays.length + 2);
    expect(fetchCalls.length).toBeLessThan(dates.length);

    // eslint-disable-next-line no-console
    console.log(
      `[bench] ${dates.length} dates (${weekendDates} weekend) → ` +
        `${fetchCalls.length} requests, ${new Set(fetchCalls).size} unique, ${ms}ms`
    );
  });
});
