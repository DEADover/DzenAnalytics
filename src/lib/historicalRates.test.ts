import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory IndexedDB stand-in so the loader's day-cache works without a real DB.
const store = new Map<string, unknown>();
vi.mock("./db", () => ({
  loadJSON: async (k: string) => (store.has(k) ? store.get(k) : null),
  saveJSON: async (k: string, v: unknown) => {
    store.set(k, v);
  },
}));

import {
  fetchHistoricalRubRates,
  isWeekendUTC,
  isNoQuoteDayUTC,
  resetMirrorProbe,
} from "./historicalRates";

const LATEST_URL = "https://www.cbr-xml-daily.ru/daily_json.js";

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

/**
 * Mirror where a set of dates is simply MISSING from the archive — the real
 * failure mode behind issue #53. A missing day 404s without a CORS header, so
 * in a browser it surfaces as `TypeError: Failed to fetch`, exactly like a dead
 * network. `mirrorUp` decides what the reachability probe answers.
 */
function installFetchWithGaps(missing: string[], mirrorUp = true) {
  fetchCalls = [];
  const gap = new Set(missing);
  globalThis.fetch = vi.fn(async (input: unknown) => {
    const url = String(input);
    fetchCalls.push(url);
    if (url === LATEST_URL) {
      if (!mirrorUp) throw new TypeError("Failed to fetch");
      return { ok: true, status: 200 } as unknown as Response;
    }
    const date = dateFromUrl(url);
    if (gap.has(date) || isWeekendUTC(date)) throw new TypeError("Failed to fetch");
    return {
      ok: true,
      status: 200,
      json: async () => ({ Valute: { USD: { Value: 90, Nominal: 1 } } }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

const archiveCalls = () => fetchCalls.filter((u) => u !== LATEST_URL);

beforeEach(() => {
  store.clear();
  resetMirrorProbe();
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

describe("historicalRates — пропуски в архиве ЦБ (issue #53)", () => {
  it("не запрашивает праздники: 8 января не уходит в сеть", async () => {
    expect(isNoQuoteDayUTC("2026-01-08")).toBe(true); // Thu, но праздник
    installFetchWithGaps([]);
    await fetchHistoricalRubRates(["2026-01-08"]);
    expect(archiveCalls().map(dateFromUrl)).not.toContain("2026-01-08");
  });

  it("новогодний провал в архиве перекрывается окном отката", async () => {
    // В 2026-м архив прыгает с 31 декабря сразу на 13 января.
    const gap: string[] = [];
    for (let d = 1; d <= 12; d++) {
      gap.push(`2026-01-${String(d).padStart(2, "0")}`);
    }
    installFetchWithGaps(gap);
    const out = await fetchHistoricalRubRates(["2026-01-09"]);
    // Курс нашёлся — по последней публикации перед праздниками.
    expect(out["2026-01-09"]?.USD).toBe(90);
    expect(archiveCalls().map(dateFromUrl)).toContain("2025-12-31");
  });

  it("отсутствующая дата запоминается как пропуск и не перезапрашивается", async () => {
    // Понедельник, которого просто нет в архиве зеркала.
    installFetchWithGaps(["2026-07-20"]);
    await fetchHistoricalRubRates(["2026-07-20"]);
    expect(archiveCalls().map(dateFromUrl)).toContain("2026-07-20");

    // Второй прогрев (новая сессия страницы: кэш дат в IDB остаётся).
    installFetchWithGaps(["2026-07-20"]);
    resetMirrorProbe();
    await fetchHistoricalRubRates(["2026-07-20"]);
    expect(archiveCalls().map(dateFromUrl)).not.toContain("2026-07-20");
  });

  it("когда сервис курсов лежит, дата НЕ считается пропуском и будет перезапрошена", async () => {
    // Полный обрыв: не отвечает ни архив, ни проверочный документ.
    const allDates = ["2026-07-20", "2026-07-17", "2026-07-16", "2026-07-15",
      "2026-07-14", "2026-07-13", "2026-07-10", "2026-07-09", "2026-07-08",
      "2026-07-07", "2026-07-06", "2026-07-03", "2026-07-02", "2026-07-01"];
    installFetchWithGaps(allDates, /* mirrorUp */ false);
    const out = await fetchHistoricalRubRates(["2026-07-20"]);
    // Ничего достоверного — дата остаётся «неизвестной», а не «курса нет».
    expect(out["2026-07-20"]).toBeUndefined();

    // Сервис поднялся — дата запрашивается снова и разрешается.
    installFetchWithGaps([]);
    resetMirrorProbe();
    const retry = await fetchHistoricalRubRates(["2026-07-20"]);
    expect(retry["2026-07-20"]?.USD).toBe(90);
  });

  it("при недоступном сервисе не перебирает всё окно отката на каждую дату", async () => {
    // Полный офлайн: любой адрес падает.
    fetchCalls = [];
    globalThis.fetch = vi.fn(async (input: unknown) => {
      fetchCalls.push(String(input));
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;

    const dates = ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"];
    const out = await fetchHistoricalRubRates(dates);
    // Ничего не разрешилось и — главное — ничего не записалось как «курса нет».
    expect(Object.keys(out)).toHaveLength(0);
    // Без короткого замыкания это было бы ~11 рабочих дней окна на каждую дату.
    expect(archiveCalls().length).toBeLessThan(dates.length * 4);
  });
});
