import { describe, it, expect, vi, beforeEach } from "vitest";

// Курсы на диск больше не пишутся: дневной кэш живёт в памяти модуля, а
// постоянное хранилище одно — сводный индекс в useDataStore. Заглушка нужна
// только чтобы модуль вообще импортировался.
const store = new Map<string, unknown>();
vi.mock("./db", () => ({
  loadJSON: async (k: string) => (store.has(k) ? store.get(k) : null),
  saveJSON: async (k: string, v: unknown) => {
    store.set(k, v);
  },
  deleteByPrefix: async () => 0,
}));

import {
  fetchHistoricalRubRates,
  getHistoricalRubRate,
  resetDayCache,
  seedDayRates,
  isNoQuoteDayUTC,
  rateDateMayBeStale,
  resetMirrorProbe,
  retryAfterMs,
  setRateRequestIntervalMs,
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
    if (isNoQuoteDayUTC(dateFromUrl(url))) throw new TypeError("Failed to fetch");
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
    if (gap.has(date) || isNoQuoteDayUTC(date)) throw new TypeError("Failed to fetch");
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
  resetDayCache();
  resetMirrorProbe();
  // Боевой темп — один запрос в секунду; прогон девяноста дат с ним занял бы
  // полторы минуты. Сам темп проверяется отдельным блоком ниже.
  setRateRequestIntervalMs(0);
  installFetch();
});

describe("historicalRates — выходные: курс субботы действует до вторника", () => {
  it("воскресенье и понедельник берут субботний файл, в сеть за ними не ходят", async () => {
    await fetchHistoricalRubRates(["2026-08-16", "2026-08-17"]); // вс и пн
    const days = fetchCalls.map(dateFromUrl);
    expect(days).not.toContain("2026-08-16");
    expect(days).not.toContain("2026-08-17");
    expect(days).toContain("2026-08-15"); // суббота — курс, установленный в пятницу
    expect(days).not.toContain("2026-08-14");
  });

  it("суббота запрашивается сама: у неё свой курс", async () => {
    await fetchHistoricalRubRates(["2026-10-17"]);
    expect(fetchCalls.map(dateFromUrl)).toEqual(["2026-10-17"]);
  });

  it("de-dups concurrent look-ups that resolve to the same day", async () => {
    // Вс и пн откатываются к одной субботе — запрос к ней один.
    await fetchHistoricalRubRates(["2021-03-14", "2021-03-15"]);
    const saturdayHits = fetchCalls.filter((u) => u.includes("2021/03/13")).length;
    expect(saturdayHits).toBe(1);
  });

  it("benchmark: 90 dates warm with requests bounded by business days only", async () => {
    const dates: string[] = [];
    for (let d = 1; d <= 90; d++) {
      dates.push(new Date(Date.UTC(2022, 0, d)).toISOString().slice(0, 10));
    }
    const businessDays = dates.filter((d) => !isNoQuoteDayUTC(d));
    const weekendDates = dates.length - businessDays.length;

    const t0 = performance.now();
    const out = await fetchHistoricalRubRates(dates);
    const ms = Math.round(performance.now() - t0);

    // Every date got a resolved entry (Sun/Mon map to the Saturday).
    expect(Object.keys(out).length).toBe(dates.length);
    // Not one Sun/Mon URL was requested.
    expect(fetchCalls.every((u) => !isNoQuoteDayUTC(dateFromUrl(u)))).toBe(true);
    // No day is ever fetched twice (in-flight de-dup + IDB day-cache).
    expect(fetchCalls.length).toBe(new Set(fetchCalls).size);
    // Requests are bounded by the business days (+ at most a couple of Fridays
    // just before the range, reached by an early-in-range weekend). Weekends
    // themselves add ZERO network cost — before the fix each cost a doomed
    // request plus its walk-back.
    expect(new Set(fetchCalls).size).toBeLessThanOrEqual(businessDays.length + 2);
    expect(fetchCalls.length).toBeLessThan(dates.length);

     
    console.log(
      `[bench] ${dates.length} dates (${weekendDates} weekend) → ` +
        `${fetchCalls.length} requests, ${new Set(fetchCalls).size} unique, ${ms}ms`
    );
  });
});

describe("historicalRates — темп запросов", () => {
  it("запросы идут по одному и с паузой, а не залпом", async () => {
    // Условия зеркала: не более 1 запроса в секунду. Раньше прогрев шёл
    // двенадцатью параллельными потоками без пауз — под сотню запросов в
    // секунду, и сервис отвечал отлупом, который приложение показывало как
    // «зеркало недоступно».
    setRateRequestIntervalMs(30);
    const at: number[] = [];
    fetchCalls = [];
    globalThis.fetch = vi.fn(async (input: unknown) => {
      fetchCalls.push(String(input));
      at.push(performance.now());
      return {
        ok: true,
        status: 200,
        json: async () => ({ Valute: { USD: { Value: 90, Nominal: 1 } } }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    // Пять будних дней подряд — пять сетевых запросов.
    await fetchHistoricalRubRates([
      "2026-03-16",
      "2026-03-17",
      "2026-03-18",
      "2026-03-19",
      "2026-03-20",
    ]);
    expect(at).toHaveLength(5);
    for (let i = 1; i < at.length; i++) {
      // С запасом на таймер: важно, что пауза ЕСТЬ, а не что она ровно 30 мс.
      expect(at[i] - at[i - 1], `запрос ${i}`).toBeGreaterThanOrEqual(20);
    }
  });

  it("даты идут от свежих к старым", async () => {
    // Прогрев большой истории занимает минуты — пусть сначала уточнится то, на
    // что человек смотрит.
    setRateRequestIntervalMs(0);
    installFetch();
    await fetchHistoricalRubRates(["2026-03-17", "2026-03-20", "2026-03-18"]);
    expect(archiveCalls().map(dateFromUrl)).toEqual([
      "2026-03-20",
      "2026-03-18",
      "2026-03-17",
    ]);
  });

  it("кэшированные даты сети не трогают вовсе", async () => {
    // Иначе секундный темп растянул бы ПОВТОРНЫЙ прогрев на пустом месте.
    setRateRequestIntervalMs(0);
    installFetch();
    await fetchHistoricalRubRates(["2026-03-17", "2026-03-18"]);
    expect(archiveCalls()).toHaveLength(2);

    installFetch();
    const t0 = performance.now();
    await fetchHistoricalRubRates(["2026-03-17", "2026-03-18"]);
    expect(archiveCalls()).toHaveLength(0);
    expect(performance.now() - t0).toBeLessThan(200);
  });

  // Дневного кэша на диске больше нет: после перезапуска даты берутся из
  // сводного индекса, и сеть для них не нужна.
  it("даты из индекса после перезапуска не перезапрашиваются", async () => {
    const first = await fetchHistoricalRubRates(["2026-03-17", "2026-03-18"]);
    expect(archiveCalls()).toHaveLength(2);

    // Перезапуск: память пуста, на диске — только индекс.
    resetDayCache();
    installFetch();
    seedDayRates(first);
    const again = await fetchHistoricalRubRates(["2026-03-17", "2026-03-18"]);
    expect(archiveCalls()).toHaveLength(0);
    expect(again).toEqual(first);
  });

  it("воскресенье из индекса помнит, что курс — субботний", async () => {
    // 14.03.2021 — воскресенье, действует курс, установленный на субботу 13-го.
    const warmed = await fetchHistoricalRubRates(["2021-03-14"]);
    resetDayCache();
    installFetch();
    seedDayRates(warmed);
    const hit = await getHistoricalRubRate("2021-03-14", "USD");
    expect(archiveCalls()).toHaveLength(0);
    expect(hit).toEqual({ rate: 90, rateDate: "2021-03-13" });
  });
});

describe("retryAfterMs", () => {
  it("понимает секунды", () => {
    expect(retryAfterMs("5")).toBe(5000);
    expect(retryAfterMs("0")).toBe(0);
  });

  it("понимает HTTP-дату", () => {
    const at = new Date(Date.now() + 3000).toUTCString();
    expect(retryAfterMs(at)).toBeGreaterThan(1500);
    expect(retryAfterMs(at)).toBeLessThanOrEqual(4000);
  });

  it("без заголовка и на мусоре берёт запасное значение", () => {
    expect(retryAfterMs(null)).toBe(5000);
    expect(retryAfterMs("скоро")).toBe(5000);
  });

  it("не даёт увести паузу за разумный предел", () => {
    // Сервис (или прокси) может прислать сутки — вставать на сутки мы не будем.
    expect(retryAfterMs("86400")).toBe(60_000);
  });
});

describe("historicalRates — пропуски в архиве ЦБ (issue #53)", () => {
  it("праздник запрашивается: курс на него ЦБ иногда устанавливает", async () => {
    installFetchWithGaps([]);
    await fetchHistoricalRubRates(["2026-05-09"]); // суббота и праздник — файл есть
    expect(archiveCalls().map(dateFromUrl)).toContain("2026-05-09");
  });

  it("rateDateMayBeStale: выходные, понедельник и неделя после праздника", () => {
    expect(rateDateMayBeStale("2026-08-15")).toBe(true); // сб
    expect(rateDateMayBeStale("2026-08-16")).toBe(true); // вс
    expect(rateDateMayBeStale("2026-08-17")).toBe(true); // пн
    expect(rateDateMayBeStale("2026-08-18")).toBe(false); // вт
    expect(rateDateMayBeStale("2026-05-12")).toBe(true); // вт после 9 мая
    expect(rateDateMayBeStale("2026-10-14")).toBe(false); // ср
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
    // Вторник, которого просто нет в архиве зеркала (так бывает после праздника).
    installFetchWithGaps(["2026-07-21"]);
    await fetchHistoricalRubRates(["2026-07-21"]);
    expect(archiveCalls().map(dateFromUrl)).toContain("2026-07-21");

    // Второй прогрев (новая сессия страницы: кэш дат в IDB остаётся).
    installFetchWithGaps(["2026-07-21"]);
    resetMirrorProbe();
    await fetchHistoricalRubRates(["2026-07-21"]);
    expect(archiveCalls().map(dateFromUrl)).not.toContain("2026-07-21");
  });

  it("когда сервис курсов лежит, дата НЕ считается пропуском и будет перезапрошена", async () => {
    // Полный обрыв: не отвечает ни архив, ни проверочный документ.
    const allDates: string[] = [];
    for (let d = 0; d <= 20; d++)
      allDates.push(new Date(Date.UTC(2026, 6, 20 - d)).toISOString().slice(0, 10));
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
