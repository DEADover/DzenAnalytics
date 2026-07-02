import { describe, it, expect } from "vitest";
import {
  whatSignature,
  periodSignature,
  matchesView,
  hasWhatFilters,
  type SavedView,
} from "./useSavedViewsStore";
import type { DatePreset } from "./useFiltersStore";

const view = (v: Partial<SavedView>): SavedView => ({
  id: "v1",
  name: "F",
  preset: "month",
  from: null,
  to: null,
  monthYM: "2026-07",
  accounts: [],
  categories: [],
  currencies: [],
  search: "",
  excludeTransfers: false,
  includePeriod: false,
  createdAt: "",
  ...v,
});

const live = (v: Partial<ReturnType<typeof baseLive>> = {}) => ({ ...baseLive(), ...v });
function baseLive() {
  return {
    accounts: [] as string[],
    categories: [] as string[],
    currencies: [] as string[],
    search: "",
    excludeTransfers: false,
    preset: "month" as DatePreset,
    from: null as string | null,
    to: null as string | null,
    monthYM: "2026-07" as string | null,
  };
}

describe("whatSignature", () => {
  it("is order-independent for the multi-selects and trims search", () => {
    expect(whatSignature({ accounts: ["b", "a"], categories: [], currencies: [], search: " x ", excludeTransfers: false }))
      .toBe(whatSignature({ accounts: ["a", "b"], categories: [], currencies: [], search: "x", excludeTransfers: false }));
  });
  it("differs when a dimension differs", () => {
    expect(whatSignature({ accounts: ["a"], categories: [], currencies: [], search: "", excludeTransfers: false }))
      .not.toBe(whatSignature({ accounts: ["a"], categories: [], currencies: [], search: "", excludeTransfers: true }));
  });
});

describe("hasWhatFilters", () => {
  it("false for the empty default, true once any dimension is set", () => {
    expect(hasWhatFilters(baseLive())).toBe(false);
    expect(hasWhatFilters({ ...baseLive(), accounts: ["a"] })).toBe(true);
    expect(hasWhatFilters({ ...baseLive(), search: "hi" })).toBe(true);
    expect(hasWhatFilters({ ...baseLive(), excludeTransfers: true })).toBe(true);
  });
});

describe("matchesView — period-less filter", () => {
  const v = view({ includePeriod: false, accounts: ["Ozon"] });
  it("matches regardless of the current period (month change ≠ dirty)", () => {
    expect(matchesView(v, live({ accounts: ["Ozon"], monthYM: "2026-07" }))).toBe(true);
    expect(matchesView(v, live({ accounts: ["Ozon"], monthYM: "2020-01" }))).toBe(true);
    expect(matchesView(v, live({ accounts: ["Ozon"], preset: "all", monthYM: null }))).toBe(true);
  });
  it("does NOT match when a «what» dimension differs", () => {
    expect(matchesView(v, live({ accounts: ["Tinkoff"] }))).toBe(false);
  });
});

describe("matchesView — period-bearing filter", () => {
  const v = view({ includePeriod: true, accounts: ["Ozon"], preset: "month", monthYM: "2026-07" });
  it("matches only when the period also matches", () => {
    expect(matchesView(v, live({ accounts: ["Ozon"], monthYM: "2026-07" }))).toBe(true);
    expect(matchesView(v, live({ accounts: ["Ozon"], monthYM: "2026-06" }))).toBe(false);
  });
});

describe("periodSignature", () => {
  it("accepts an optional monthYM (undefined == null == empty)", () => {
    expect(periodSignature({ preset: "all", from: null, to: null })).toBe(
      periodSignature({ preset: "all", from: null, to: null, monthYM: null })
    );
  });
});
