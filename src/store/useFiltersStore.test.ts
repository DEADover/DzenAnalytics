import { describe, it, expect, beforeEach } from "vitest";
import { applyFilters, presetToRange, useFiltersStore, FILTER_NONE } from "./useFiltersStore";
import { periodRange } from "../lib/period";
import { NO_CATEGORY } from "../lib/zenmoneyMap";
import { tx } from "../test/fixtures";

// applyFilters wants a full FiltersState (with action methods). We only
// exercise the data fields, so start from the real store (gives us valid
// no-op methods) and override every data field to a clean default, then
// apply the per-test overrides on top.
type FiltersState = Parameters<typeof applyFilters>[1];
function filt(p: Partial<FiltersState> = {}): FiltersState {
  return {
    ...useFiltersStore.getState(),
    preset: "all",
    from: null,
    to: null,
    monthYM: null,
    accounts: new Set<string>(),
    categories: new Set<string>(),
    currencies: new Set<string>(),
    search: "",
    excludeTransfers: false,
    ...p,
  };
}

const ids = (txs: { id: string }[]) => txs.map((t) => t.id).sort();

describe("applyFilters — category leaf matching (issue #9)", () => {
  const txs = [
    tx({ id: "kafe", category: "Еда", subcategory: "Кафе", categoryFull: "Еда / Кафе" }),
    tx({ id: "prod", category: "Еда", subcategory: "Продукты", categoryFull: "Еда / Продукты" }),
    tx({ id: "bareEda", category: "Еда", subcategory: null, categoryFull: "Еда" }),
    tx({ id: "taxi", category: "Транспорт", subcategory: null, categoryFull: "Транспорт" }),
  ];

  it("a sub leaf matches only that sub-category (parent's bare is NOT pulled in)", () => {
    const out = applyFilters(txs, filt({ categories: new Set(["Еда / Кафе"]) }));
    expect(ids(out)).toEqual(["kafe"]);
  });

  it("the bare-category leaf matches ONLY no-sub transactions, not the subs", () => {
    // Category and sub-category are distinct in Zenmoney — «Еда» ≠ «Еда / Кафе».
    const out = applyFilters(txs, filt({ categories: new Set(["Еда"]) }));
    expect(ids(out)).toEqual(["bareEda"]);
  });

  it("selecting all of a parent's leaves keeps the whole category", () => {
    const out = applyFilters(
      txs,
      filt({ categories: new Set(["Еда", "Еда / Кафе", "Еда / Продукты"]) })
    );
    expect(ids(out)).toEqual(["bareEda", "kafe", "prod"]);
  });

  it("FILTER_NONE excludes everything; empty set keeps everything", () => {
    expect(applyFilters(txs, filt({ categories: new Set([FILTER_NONE]) }))).toHaveLength(0);
    expect(applyFilters(txs, filt({ categories: new Set() }))).toHaveLength(4);
  });
});

describe("applyFilters — date window", () => {
  it("preset 'all' keeps every transaction regardless of date", () => {
    const txs = [
      tx({ id: "a", date: "2020-01-01" }),
      tx({ id: "b", date: "2026-06-15" }),
    ];
    expect(applyFilters(txs, filt({ preset: "all" }))).toHaveLength(2);
  });

  it("preset 'custom' filters to [from, to] inclusive on both ends", () => {
    const txs = [
      tx({ id: "before", date: "2026-02-28" }),
      tx({ id: "from-edge", date: "2026-03-01" }),
      tx({ id: "mid", date: "2026-03-15" }),
      tx({ id: "to-edge", date: "2026-03-31" }),
      tx({ id: "after", date: "2026-04-01" }),
    ];
    const out = applyFilters(
      txs,
      filt({ preset: "custom", from: "2026-03-01", to: "2026-03-31" })
    );
    expect(ids(out)).toEqual(["from-edge", "mid", "to-edge"]);
  });

  it("preset 'custom' with only `from` is an open-ended lower bound", () => {
    const txs = [
      tx({ id: "old", date: "2026-02-01" }),
      tx({ id: "new", date: "2026-05-01" }),
    ];
    const out = applyFilters(txs, filt({ preset: "custom", from: "2026-03-01", to: null }));
    expect(ids(out)).toEqual(["new"]);
  });

  it("preset 'month' (startDay=1) keeps only that calendar month", () => {
    const txs = [
      tx({ id: "feb", date: "2026-02-20" }),
      tx({ id: "mar1", date: "2026-03-01" }),
      tx({ id: "mar31", date: "2026-03-31" }),
      tx({ id: "apr", date: "2026-04-02" }),
    ];
    const out = applyFilters(txs, filt({ preset: "month", monthYM: "2026-03" }), 1);
    expect(ids(out)).toEqual(["mar1", "mar31"]);
  });

  it("preset 'month' respects a custom reporting startDay (e.g. 11)", () => {
    // period 2026-03 with startDay 11 spans 2026-03-11 → 2026-04-10
    const txs = [
      tx({ id: "early-mar", date: "2026-03-05" }), // before the 11th → prev period
      tx({ id: "mid-mar", date: "2026-03-15" }), // in
      tx({ id: "early-apr", date: "2026-04-05" }), // in (≤ 10 Apr)
      tx({ id: "mid-apr", date: "2026-04-15" }), // next period
    ];
    const out = applyFilters(txs, filt({ preset: "month", monthYM: "2026-03" }), 11);
    expect(ids(out)).toEqual(["early-apr", "mid-mar"]);
  });

  it("relative presets anchor to the latest transaction date, not wall-clock", () => {
    // maxDate = 2026-06-15 → a 30-day window ends there. Use wide margins
    // so the assertion is robust to the runner's timezone.
    const txs = [
      tx({ id: "latest", date: "2026-06-15" }), // defines maxDate, in window
      tx({ id: "inside", date: "2026-06-10" }), // ~5 days back, inside 30d
      tx({ id: "outside", date: "2026-03-01" }), // months back, outside 30d
    ];
    const out = applyFilters(txs, filt({ preset: "30d" }));
    expect(ids(out)).toEqual(["inside", "latest"]);
  });

  it("returns nothing for an empty transaction list", () => {
    expect(applyFilters([], filt({ preset: "all" }))).toEqual([]);
  });
});

describe("applyFilters — dimension filters", () => {
  const txs = [
    tx({ id: "eda-karta", category: "Еда", account: "Карта", currency: "RUB" }),
    tx({ id: "eda-cash", category: "Еда", account: "Наличные", currency: "RUB" }),
    tx({ id: "transport-karta", category: "Транспорт", account: "Карта", currency: "USD" }),
  ];

  it("filters by category set", () => {
    const out = applyFilters(txs, filt({ categories: new Set(["Еда"]) }));
    expect(ids(out)).toEqual(["eda-cash", "eda-karta"]);
  });

  it("filters by account set", () => {
    const out = applyFilters(txs, filt({ accounts: new Set(["Карта"]) }));
    expect(ids(out)).toEqual(["eda-karta", "transport-karta"]);
  });

  it("filters by currency set", () => {
    const out = applyFilters(txs, filt({ currencies: new Set(["USD"]) }));
    expect(ids(out)).toEqual(["transport-karta"]);
  });

  it("an empty set means 'no filter on that dimension'", () => {
    expect(applyFilters(txs, filt({ categories: new Set() }))).toHaveLength(3);
  });

  it("combines dimensions with AND (category ∩ account)", () => {
    const out = applyFilters(
      txs,
      filt({ categories: new Set(["Еда"]), accounts: new Set(["Карта"]) })
    );
    expect(ids(out)).toEqual(["eda-karta"]);
  });

  it("a set with no matches yields an empty result", () => {
    expect(applyFilters(txs, filt({ accounts: new Set(["Депозит"]) }))).toEqual([]);
  });

  it("the FILTER_NONE sentinel means 'none included' → empty result", () => {
    expect(applyFilters(txs, filt({ accounts: new Set([FILTER_NONE]) }))).toEqual([]);
    expect(applyFilters(txs, filt({ categories: new Set([FILTER_NONE]) }))).toEqual([]);
  });

  it("empty set (all) and FILTER_NONE (none) are opposite extremes", () => {
    expect(applyFilters(txs, filt({ accounts: new Set() }))).toHaveLength(3);
    expect(applyFilters(txs, filt({ accounts: new Set([FILTER_NONE]) }))).toHaveLength(0);
  });
});

describe("applyFilters — search", () => {
  const txs = [
    tx({ id: "payee", payee: "Пятёрочка", comment: "", categoryFull: "Еда" }),
    tx({ id: "comment", payee: "X", comment: "обед с Катей", categoryFull: "Еда" }),
    tx({ id: "cat", payee: "Y", comment: "", categoryFull: "Транспорт / Такси" }),
  ];

  it("matches against payee, comment and categoryFull", () => {
    expect(ids(applyFilters(txs, filt({ search: "пятёрочка" })))).toEqual(["payee"]);
    expect(ids(applyFilters(txs, filt({ search: "катей" })))).toEqual(["comment"]);
    expect(ids(applyFilters(txs, filt({ search: "такси" })))).toEqual(["cat"]);
  });

  it("is case-insensitive and trims surrounding whitespace", () => {
    expect(ids(applyFilters(txs, filt({ search: "  ПЯТЁРОЧКА  " })))).toEqual(["payee"]);
  });

  it("an all-whitespace query is treated as no search", () => {
    expect(applyFilters(txs, filt({ search: "   " }))).toHaveLength(3);
  });
});

describe("applyFilters — excludeTransfers", () => {
  const txs = [
    tx({ id: "spend", kind: "expense" }),
    tx({ id: "move", kind: "transfer" }),
  ];

  it("drops transfer rows when excludeTransfers is true", () => {
    expect(ids(applyFilters(txs, filt({ excludeTransfers: true })))).toEqual(["spend"]);
  });

  it("keeps transfer rows when excludeTransfers is false", () => {
    expect(applyFilters(txs, filt({ excludeTransfers: false }))).toHaveLength(2);
  });
});

describe("presetToRange", () => {
  it("'all' and 'custom' impose no range", () => {
    expect(presetToRange("all", "2026-06-15")).toEqual({ from: null, to: null });
    expect(presetToRange("custom", "2026-06-15")).toEqual({ from: null, to: null });
  });

  it("'month' delegates to periodRange for the given monthYM + startDay", () => {
    expect(presetToRange("month", null, "2026-03", 11)).toEqual(
      periodRange("2026-03", 11)
    );
  });

  it("'month' without a monthYM imposes no range", () => {
    expect(presetToRange("month", "2026-06-15", null)).toEqual({ from: null, to: null });
  });

  it("relative presets end at the anchor date and start earlier", () => {
    const r = presetToRange("12m", "2026-06-15");
    expect(r.to).toBe("2026-06-15");
    expect(r.from).not.toBeNull();
    expect(r.from! < r.to!).toBe(true);
    expect(r.from!.startsWith("2025-06")).toBe(true);
  });
});

describe("useFiltersStore reducers", () => {
  beforeEach(() => useFiltersStore.getState().reset());

  it("setRange switches the preset to 'custom'", () => {
    useFiltersStore.getState().setRange("2026-01-01", "2026-02-01");
    const s = useFiltersStore.getState();
    expect(s.preset).toBe("custom");
    expect(s.from).toBe("2026-01-01");
    expect(s.to).toBe("2026-02-01");
  });

  it("setMonth switches to the 'month' preset with that monthYM", () => {
    useFiltersStore.getState().setMonth("2026-04");
    expect(useFiltersStore.getState().preset).toBe("month");
    expect(useFiltersStore.getState().monthYM).toBe("2026-04");
  });

  it("toggleSet adds then removes a value", () => {
    useFiltersStore.getState().toggleSet("categories", "Еда");
    expect(useFiltersStore.getState().categories.has("Еда")).toBe(true);
    useFiltersStore.getState().toggleSet("categories", "Еда");
    expect(useFiltersStore.getState().categories.has("Еда")).toBe(false);
  });

  it("resetSet clears a whole dimension", () => {
    useFiltersStore.getState().toggleSet("accounts", "Карта");
    useFiltersStore.getState().toggleSet("accounts", "Наличные");
    useFiltersStore.getState().resetSet("accounts");
    expect(useFiltersStore.getState().accounts.size).toBe(0);
  });

  it("reset restores the default 'month' preset and clears filters", () => {
    const s = useFiltersStore.getState();
    s.setRange("2026-01-01", "2026-02-01");
    s.toggleSet("categories", "Еда");
    s.setSearch("foo");
    s.reset();
    const after = useFiltersStore.getState();
    expect(after.preset).toBe("month");
    expect(after.categories.size).toBe(0);
    expect(after.search).toBe("");
  });
});

describe("applyFilters — «Дополнительно»", () => {
  const txs = [
    tx({ id: "a", amountBase: 100, kind: "expense", category: "Еда", comment: "" }),
    tx({ id: "b", amountBase: 1000, kind: "expense", category: "Еда", comment: "чек" }),
    tx({ id: "c", amountBase: 5000, kind: "income", category: "Зарплата" }),
    tx({ id: "d", amountBase: 0, kind: "transfer", category: NO_CATEGORY }),
  ];

  it("amount range filters by |amountBase|", () => {
    expect(ids(applyFilters(txs, filt({ minAmount: 1000 })))).toEqual(["b", "c"]);
    expect(ids(applyFilters(txs, filt({ maxAmount: 1000 })))).toEqual(["a", "b", "d"]);
    expect(ids(applyFilters(txs, filt({ minAmount: 1000, maxAmount: 1000 })))).toEqual(["b"]);
  });

  it("type filter keeps only the chosen kinds (refund buckets as expense)", () => {
    expect(ids(applyFilters(txs, filt({ types: new Set(["income"]) })))).toEqual(["c"]);
    expect(ids(applyFilters(txs, filt({ types: new Set(["expense", "transfer"]) })))).toEqual(["a", "b", "d"]);
    const withRefund = [...txs, tx({ id: "r", kind: "refund", amountBase: 50 })];
    expect(ids(applyFilters(withRefund, filt({ types: new Set(["expense"]) })))).toEqual(["a", "b", "r"]);
  });

  it("onlyUncategorized keeps «Без категории» / empty only", () => {
    expect(ids(applyFilters(txs, filt({ onlyUncategorized: true })))).toEqual(["d"]);
  });

  it("hideZero drops zero-amount ops", () => {
    expect(ids(applyFilters(txs, filt({ hideZero: true })))).toEqual(["a", "b", "c"]);
  });

  it("onlyWithComment keeps commented ops only", () => {
    expect(ids(applyFilters(txs, filt({ onlyWithComment: true })))).toEqual(["b"]);
  });
});

describe("applyFilters — исключить внебалансовые счета", () => {
  const txs = [
    tx({ id: "card", account: "Карта", outcomeAccount: "Карта", incomeAccount: "Карта" }),
    tx({ id: "broker", account: "Брокер", outcomeAccount: "Брокер", incomeAccount: "Брокер" }),
    // Transfer touching an off-balance account (one leg is «Брокер»).
    tx({ id: "toBroker", kind: "transfer", account: "Карта", outcomeAccount: "Карта", incomeAccount: "Брокер" }),
  ];
  const off = new Set(["Брокер"]);

  it("off by default — all ops pass", () => {
    expect(ids(applyFilters(txs, filt({ offBalanceAccounts: off })))).toEqual(["broker", "card", "toBroker"]);
  });

  it("drops ops whose account (or a transfer leg) is off-balance", () => {
    const out = applyFilters(txs, filt({ excludeOffBalance: true, offBalanceAccounts: off }));
    expect(ids(out)).toEqual(["card"]); // broker + the transfer leg into broker are gone
  });

  it("no-op when the off-balance set is empty", () => {
    expect(ids(applyFilters(txs, filt({ excludeOffBalance: true, offBalanceAccounts: new Set() })))).toEqual([
      "broker",
      "card",
      "toBroker",
    ]);
  });
});

describe("applyFilters — переводы в фильтре по счёту (issue #41)", () => {
  const txs = [
    // Transfer Карта → Копилка: `account` holds only the SOURCE leg.
    tx({ id: "move", kind: "transfer", account: "Карта", outcomeAccount: "Карта", incomeAccount: "Копилка" }),
    tx({ id: "spend", kind: "expense", account: "Карта", outcomeAccount: "Карта", incomeAccount: "Карта" }),
    tx({ id: "other", kind: "expense", account: "Наличные", outcomeAccount: "Наличные", incomeAccount: "Наличные" }),
  ];

  it("показывает перевод при выборе счёта-ИСТОЧНИКА", () => {
    expect(ids(applyFilters(txs, filt({ accounts: new Set(["Карта"]) })))).toEqual(["move", "spend"]);
  });

  it("показывает перевод и при выборе счёта-ПОЛУЧАТЕЛЯ", () => {
    expect(ids(applyFilters(txs, filt({ accounts: new Set(["Копилка"]) })))).toEqual(["move"]);
  });

  it("не притягивает чужие одноногие операции", () => {
    expect(ids(applyFilters(txs, filt({ accounts: new Set(["Наличные"]) })))).toEqual(["other"]);
  });
});

describe("applyFilters — поиск по контрагенту (brand + payee)", () => {
  // The dictionary name and the bank's raw line routinely differ: «STOLICHKI»
  // vs «Аптека Столички». The Операции table shows the FORMER, so a search for
  // it must find the row — before the fix only `payee` was searched and most of
  // a counterparty's operations were unreachable.
  const txs = [
    tx({ id: "brandOnly", payee: "APTEKA 4423 MOSCOW", brand: "STOLICHKI" }),
    tx({ id: "payeeOnly", payee: "STOLICHKI", brand: null }),
    tx({ id: "both", payee: "STOLICHKI", brand: "STOLICHKI" }),
    tx({ id: "other", payee: "Пятёрочка", brand: "Пятёрочка" }),
  ];

  it("finds a row by the counterparty shown in the column, not just the bank text", () => {
    expect(ids(applyFilters(txs, filt({ search: "STOLICHKI" })))).toEqual([
      "both",
      "brandOnly",
      "payeeOnly",
    ]);
  });

  it("still finds a row by its raw bank text", () => {
    expect(ids(applyFilters(txs, filt({ search: "APTEKA 4423" })))).toEqual(["brandOnly"]);
  });

  it("does not widen the match to unrelated counterparties", () => {
    expect(ids(applyFilters(txs, filt({ search: "Пятёрочка" })))).toEqual(["other"]);
  });
});

describe("пресет «Год»", () => {
  it("год — двенадцать отчётных месяцев подряд, а не «1 января — 31 декабря»", () => {
    // При отчётном периоде с 11-го числа год идёт так же, как считается каждый
    // его месяц, — иначе январь попал бы в отчёт дважды: началом и хвостом.
    expect(presetToRange("year", null, "2025-06", 11)).toEqual({
      from: "2025-01-11",
      to: "2026-01-10",
    });
  });

  it("при обычном отчётном периоде это календарный год", () => {
    expect(presetToRange("year", null, "2025-06", 1)).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
    });
  });

  it("месяц якоря на отрезок не влияет — важен только год", () => {
    const a = presetToRange("year", null, "2025-01", 1);
    const b = presetToRange("year", null, "2025-12", 1);
    expect(a).toEqual(b);
  });

  it("«Год» и «12 мес» — разные вещи", () => {
    // «12 мес» отсчитывается от последней операции, а не от границ года.
    const year = presetToRange("year", "2026-08-07", "2026-08", 1);
    const rolling = presetToRange("12m", "2026-08-07", "2026-08", 1);
    expect(year).not.toEqual(rolling);
    expect(year.from).toBe("2026-01-01");
    expect(rolling.from).toBe("2025-08-07");
  });

  it("без якоря отрезка нет — а не «весь период»", () => {
    expect(presetToRange("year", "2026-08-07", null, 1)).toEqual({
      from: null,
      to: null,
    });
  });
});

describe("stepPeriod", () => {
  it("в режиме года шагает на год, сохраняя месяц якоря", () => {
    const s = useFiltersStore.getState();
    s.setYear(2025);
    useFiltersStore.getState().stepPeriod(-1, "2026-08");
    expect(useFiltersStore.getState().preset).toBe("year");
    expect(useFiltersStore.getState().monthYM?.slice(0, 4)).toBe("2024");
  });

  it("в режиме месяца шагает на месяц", () => {
    useFiltersStore.getState().setMonth("2026-03");
    useFiltersStore.getState().stepPeriod(1, "2026-08");
    expect(useFiltersStore.getState().preset).toBe("month");
    expect(useFiltersStore.getState().monthYM).toBe("2026-04");
  });

  it("переключение «Месяц ↔ Год» оставляет там же, где был", () => {
    useFiltersStore.getState().setMonth("2024-07");
    useFiltersStore.getState().setPreset("year");
    // Год берётся из якоря — 2024, а не текущий.
    expect(
      presetToRange("year", null, useFiltersStore.getState().monthYM, 1).from
    ).toBe("2024-01-01");
    useFiltersStore.getState().setYear(2022);
    // Месяц якоря сохранён: вернувшись в «Месяц», попадаешь в июль.
    expect(useFiltersStore.getState().monthYM).toBe("2022-07");
  });
});
