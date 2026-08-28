import { describe, it, expect } from "vitest";
import {
  isEmptySnapshot,
  restoreFilters,
  snapshotFilters,
  type FilterValues,
} from "./useFilterMemoryStore";

const values = (over: Partial<FilterValues> = {}): FilterValues => ({
  accounts: new Set<string>(),
  categories: new Set<string>(),
  currencies: new Set<string>(),
  search: "",
  excludeTransfers: false,
  minAmount: null,
  maxAmount: null,
  types: new Set<string>(),
  onlyUncategorized: false,
  hideZero: false,
  onlyWithComment: false,
  onlyNew: false,
  excludeOffBalance: false,
  ...over,
});

describe("snapshotFilters / restoreFilters", () => {
  it("фильтр переживает круг через JSON без потерь", () => {
    const before = values({
      accounts: new Set(["Карта", "Наличные"]),
      categories: new Set(["Еда / Кафе"]),
      currencies: new Set(["RUB"]),
      search: "пятёрочка",
      excludeTransfers: true,
      minAmount: 100,
      maxAmount: 5000,
      types: new Set(["expense"]),
      onlyWithComment: true,
      excludeOffBalance: true,
    });
    const after = restoreFilters(JSON.parse(JSON.stringify(snapshotFilters(before))));
    expect(after).toEqual(before);
  });

  it("множества превращаются в массивы, а не в пустые объекты", () => {
    // `JSON.stringify(new Set())` даёт `{}` — без этого шага фильтр по счетам
    // молча терялся бы при первой же записи на диск.
    const snap = snapshotFilters(values({ accounts: new Set(["Карта"]) }));
    expect(snap.accounts).toEqual(["Карта"]);
    expect(JSON.parse(JSON.stringify(snap)).accounts).toEqual(["Карта"]);
  });

  it("период в снимок не попадает", () => {
    // Приложение сбрасывает период к текущему месяцу при каждом запуске, и
    // память фильтра не должна с этим спорить.
    const snap = snapshotFilters(values({ accounts: new Set(["Карта"]) }));
    for (const k of ["preset", "from", "to", "monthYM"]) {
      expect(snap).not.toHaveProperty(k);
    }
  });

  it("справочные счета вне баланса не сохраняются", () => {
    // Это загруженные данные, а не выбор человека: сохранив их, мы бы
    // восстановили вчерашний список счетов поверх сегодняшнего.
    const snap = snapshotFilters(values({ excludeOffBalance: true }));
    expect(snap).not.toHaveProperty("offBalanceAccounts");
  });
});

describe("restoreFilters — чужой файл", () => {
  it("снимка нет — ничего не применяем", () => {
    expect(restoreFilters(null)).toBeNull();
    expect(restoreFilters(undefined)).toBeNull();
    expect(restoreFilters("фильтр")).toBeNull();
  });

  it("мусор в полях не ломает фильтр", () => {
    // Файл бэкапа человек мог править руками: строка в `minAmount` сломала бы
    // сравнение сумм, а число в множестве счетов — спрятало бы все операции.
    const out = restoreFilters({
      accounts: ["Карта", 42, null],
      categories: "Еда",
      minAmount: "сто",
      maxAmount: Number.NaN,
      types: ["expense", { kind: "income" }],
      hideZero: "да",
      onlyNew: true,
    })!;
    expect([...out.accounts]).toEqual(["Карта"]);
    expect([...out.categories]).toEqual([]);
    expect(out.minAmount).toBeNull();
    expect(out.maxAmount).toBeNull();
    expect([...out.types]).toEqual(["expense"]);
    // Строка «да» — не булево: включать по ней фильтр нельзя.
    expect(out.hideZero).toBe(false);
    expect(out.onlyNew).toBe(true);
  });

  it("пустой объект даёт пустой фильтр, а не поломанный", () => {
    const out = restoreFilters({})!;
    expect(isEmptySnapshot(snapshotFilters(out))).toBe(true);
  });
});

describe("isEmptySnapshot", () => {
  it("нетронутый фильтр — пустой", () => {
    expect(isEmptySnapshot(snapshotFilters(values()))).toBe(true);
  });

  it("любой выбранный признак делает снимок непустым", () => {
    const cases: Partial<FilterValues>[] = [
      { accounts: new Set(["Карта"]) },
      { categories: new Set(["Еда"]) },
      { currencies: new Set(["USD"]) },
      { search: "кофе" },
      { excludeTransfers: true },
      { minAmount: 1 },
      { maxAmount: 1 },
      { types: new Set(["income"]) },
      { onlyUncategorized: true },
      { hideZero: true },
      { onlyWithComment: true },
      { onlyNew: true },
      { excludeOffBalance: true },
    ];
    for (const c of cases) {
      expect(isEmptySnapshot(snapshotFilters(values(c)))).toBe(false);
    }
  });

  it("поиск из одних пробелов — это не фильтр", () => {
    expect(isEmptySnapshot(snapshotFilters(values({ search: "   " })))).toBe(true);
  });
});
