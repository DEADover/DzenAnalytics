import { describe, it, expect } from "vitest";
import { plannedOps, plannedBreakdown } from "./plannedOps";
import { backfillEntities, cacheVersionOf, CACHE_SCHEMA_VERSION, type ZenCache } from "./zenmoneyCache";
import type {
  ZenAccount,
  ZenInstrument,
  ZenReminderMarker,
  ZenTag,
} from "./zenmoney";
import type { CurrencyRates } from "../types";

const rub: ZenInstrument = { id: 2, title: "RUB", shortTitle: "RUB", symbol: "₽", rate: 1 };
const usd: ZenInstrument = { id: 1, title: "USD", shortTitle: "USD", symbol: "$", rate: 90 };

const acc = (id: string, title: string, type = "ccard"): ZenAccount =>
  ({ id, title, type, instrument: 2, archive: false, inBalance: true, savings: false } as ZenAccount);

const tag = (id: string, title: string, parent: string | null = null): ZenTag =>
  ({ id, title, parent } as ZenTag);

const marker = (m: Partial<ZenReminderMarker>): ZenReminderMarker => ({
  id: "m1",
  user: 1,
  changed: 0,
  date: "2026-07-25",
  income: 0,
  incomeInstrument: 2,
  outcome: 0,
  outcomeInstrument: 2,
  tag: null,
  reminder: "r1",
  state: "planned",
  incomeAccount: "card",
  outcomeAccount: "card",
  ...m,
});

const rates: CurrencyRates = { base: "RUB", rates: { RUB: 1, USD: 90 } } as CurrencyRates;

function cache(markers: ZenReminderMarker[], extraAccounts: ZenAccount[] = []): ZenCache {
  return {
    serverTimestamp: 0,
    instruments: [rub, usd],
    accounts: [acc("card", "Карта"), acc("sav", "Копилка"), ...extraAccounts],
    tags: [tag("food", "Еда"), tag("cafe", "Кафе", "food")],
    merchants: [],
    transactions: [],
    user: [],
    reminderMarkers: markers,
  } as ZenCache;
}

describe("plannedOps — маппинг планируемых операций", () => {
  it("расход: сумма в базовой валюте, счёт и категория с родителем", () => {
    const out = plannedOps(cache([marker({ outcome: 500, tag: ["cafe"] })]), rates);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "expense",
      amountBase: 500,
      account: "Карта",
      category: "Еда / Кафе",
      forecast: false,
    });
  });

  it("перевод: две разные ноги, обе стороны в результате", () => {
    const out = plannedOps(
      cache([marker({ outcome: 1000, income: 1000, outcomeAccount: "card", incomeAccount: "sav" })]),
      rates
    );
    expect(out[0]).toMatchObject({ kind: "transfer", account: "Карта", toAccount: "Копилка" });
  });

  it("иностранная валюта пересчитывается по своей ноге (10 USD → 900 ₽)", () => {
    const out = plannedOps(
      cache([marker({ outcome: 10, outcomeInstrument: 1 })]),
      rates
    );
    expect(out[0].amountBase).toBe(900);
  });

  it("доход берёт incomeInstrument, а не outcomeInstrument", () => {
    const out = plannedOps(
      cache([marker({ income: 10, incomeInstrument: 1, outcomeInstrument: 2 })]),
      rates
    );
    expect(out[0]).toMatchObject({ kind: "income", amountBase: 900 });
  });

  it("нога по кредиту/займу помечается как «Долг», а не как перевод", () => {
    const out = plannedOps(
      cache(
        [marker({ outcome: 5000, income: 5000, outcomeAccount: "card", incomeAccount: "loan" })],
        [acc("loan", "Ипотека", "loan")]
      ),
      rates
    );
    expect(out[0].category).toBe("Долг");
  });

  it("маркер с нулевыми суммами пропускается (не «доход 0 ₽»)", () => {
    expect(plannedOps(cache([marker({ income: 0, outcome: 0 })]), rates)).toHaveLength(0);
  });

  it("берутся только state=planned", () => {
    const out = plannedOps(
      cache([
        marker({ id: "a", outcome: 100 }),
        marker({ id: "b", outcome: 100, state: "processed" }),
        marker({ id: "c", outcome: 100, state: "deleted" }),
      ]),
      rates
    );
    expect(out.map((p) => p.id)).toEqual(["a"]);
  });

  it("isForecast различает план и прогноз", () => {
    const out = plannedOps(
      cache([
        marker({ id: "plan", outcome: 1 }),
        marker({ id: "fc", outcome: 1, isForecast: true }),
      ]),
      rates
    );
    expect(out.find((p) => p.id === "plan")!.forecast).toBe(false);
    expect(out.find((p) => p.id === "fc")!.forecast).toBe(true);
  });

  it("сортировка по дате", () => {
    const out = plannedOps(
      cache([
        marker({ id: "late", outcome: 1, date: "2026-09-01" }),
        marker({ id: "early", outcome: 1, date: "2026-08-01" }),
      ]),
      rates
    );
    expect(out.map((p) => p.id)).toEqual(["early", "late"]);
  });

  it("пустой/отсутствующий кэш не падает", () => {
    expect(plannedOps(null, rates)).toEqual([]);
    expect(plannedOps({ ...cache([]), reminderMarkers: undefined }, rates)).toEqual([]);
  });

  it("видно, разовый план или повторяющийся (#71)", () => {
    // От этого зависит, что удалять: у разового — сам план, у повторяющегося —
    // только просроченную дату.
    const c = {
      ...cache([
        marker({ id: "разовая", reminder: "r1", outcome: 100 }),
        marker({ id: "ежемесячная", reminder: "r2", outcome: 100 }),
        marker({ id: "ничья", reminder: "нет-такого", outcome: 100 }),
      ]),
      reminders: [
        { id: "r1", user: 1, changed: 0, interval: null, step: null, startDate: "2022-04-14" },
        { id: "r2", user: 1, changed: 0, interval: "month", step: 1, startDate: "2022-04-14" },
      ],
    };
    const byId = new Map(plannedOps(c, rates).map((p) => [p.id, p.repeating]));
    expect(byId.get("разовая")).toBe(false);
    expect(byId.get("ежемесячная")).toBe(true);
    // План не подтянут — не знаем, и врать не будем.
    expect(byId.get("ничья")).toBe(null);
  });
});

describe("backfillEntities — одноразовые доливки по версии кэша", () => {
  const base = cache([]);

  it("нет кэша → ничего доливать не нужно (полный синк и так всё заберёт)", () => {
    expect(backfillEntities(null)).toEqual([]);
  });

  it("совсем старый кэш (без версии и без маркеров) → доливаем всё, чего в нём нет", () => {
    const old = { ...base, reminderMarkers: undefined, cacheSchemaVersion: undefined };
    expect(backfillEntities(old).sort()).toEqual([
      "budget",
      "company",
      "reminder",
      "reminderMarker",
    ]);
  });

  it("КЛЮЧЕВОЕ: кэш уже с маркерами, но без версии → маркеры повторно не тянем", () => {
    // Именно эти пользователи не получили бы ничего при наивном гейте
    // `!cache.reminderMarkers` — ради них и введена версия схемы.
    const afterOldBackfill = { ...base, reminderMarkers: [], cacheSchemaVersion: undefined };
    expect(cacheVersionOf(afterOldBackfill)).toBe(1);
    // Маркеры в списке снова есть — но уже по другой причине: в схеме 4 это
    // разовый ПОЛНЫЙ перезабор, вычищающий операции удалённых планов (#71).
    expect(backfillEntities(afterOldBackfill).sort()).toEqual([
      "budget",
      "company",
      "reminder",
      "reminderMarker",
    ]);
  });

  it("кэш с бюджетами (v2) → справочник банков, перезабор операций и сами планы", () => {
    // Инкрементальный дифф статический справочник не присылает никогда, так
    // что без явной доливки такой кэш остался бы без названий банков навсегда.
    const v2 = { ...base, cacheSchemaVersion: 2 };
    expect(backfillEntities(v2).sort()).toEqual([
      "company",
      "reminder",
      "reminderMarker",
    ]);
  });

  it("кэш текущей версии → доливать нечего", () => {
    const current = { ...base, cacheSchemaVersion: CACHE_SCHEMA_VERSION };
    expect(backfillEntities(current)).toEqual([]);
  });
});

describe("plannedBreakdown", () => {
  it("returns both sides when the year has plan and forecast", () => {
    expect(plannedBreakdown(1200, 340)).toEqual([
      { label: "План", amount: 1200 },
      { label: "Прогноз", amount: 340 },
    ]);
  });

  it("keeps only the side that has something", () => {
    expect(plannedBreakdown(1200, 0)).toEqual([{ label: "План", amount: 1200 }]);
    expect(plannedBreakdown(0, 340)).toEqual([{ label: "Прогноз", amount: 340 }]);
  });

  it("returns nothing when there is nothing scheduled — the note stays hidden", () => {
    expect(plannedBreakdown(0, 0)).toEqual([]);
  });

  it("treats a negative sum as nothing (these totals are unsigned)", () => {
    expect(plannedBreakdown(-5, -1)).toEqual([]);
  });
});
