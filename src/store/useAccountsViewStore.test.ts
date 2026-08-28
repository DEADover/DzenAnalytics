import { describe, it, expect } from "vitest";
import {
  __test,
  ACCOUNTS_VIEW_DEFAULTS,
  type AccountsViewPrefs,
} from "./useAccountsViewStore";

const { normalize, persisted } = __test;

describe("настройки страницы «Счета» — чтение из хранилища", () => {
  it("пусто — значения по умолчанию", () => {
    expect(normalize(null)).toEqual(ACCOUNTS_VIEW_DEFAULTS);
  });

  it("сохранённое читается как есть", () => {
    const saved: AccountsViewPrefs = {
      tab: "flow",
      chartView: "single",
      chartAccounts: ["Карта", "Наличные"],
      listView: "cards",
      typeFilter: ["Карта"],
      bankFilter: ["Т-Банк"],
      balanceScope: "in",
      onlySavings: true,
      hideArchived: true,
      sortBy: "alpha",
      sortDir: "asc",
      groupBy: "bank",
    };
    expect(normalize(saved)).toEqual(saved);
  });

  it("мусор из старой версии заменяется значением по умолчанию", () => {
    // Записи переживают обновления сервиса: в IDB может лежать порядок по
    // колонке, которой больше нет, или вид списка из будущей версии.
    const raw = {
      tab: "прошлое",
      chartView: 42,
      listView: "плитка",
      sortBy: "цвет",
      sortDir: "вверх",
      groupBy: "по луне",
      balanceScope: "иногда",
    } as unknown as Partial<AccountsViewPrefs>;
    expect(normalize(raw)).toEqual(ACCOUNTS_VIEW_DEFAULTS);
  });

  it("в массивах фильтров остаются только строки", () => {
    const raw = {
      typeFilter: ["Карта", 7, null, "Вклад"],
      bankFilter: "не массив",
      chartAccounts: [{ a: 1 }, "Наличные"],
    } as unknown as Partial<AccountsViewPrefs>;
    const r = normalize(raw);
    expect(r.typeFilter).toEqual(["Карта", "Вклад"]);
    expect(r.bankFilter).toEqual([]);
    expect(r.chartAccounts).toEqual(["Наличные"]);
  });

  it("порядок «по банку» в таблице сбрасывается: такой колонки там нет", () => {
    // Иначе после возврата на страницу список стоял бы в порядке, который
    // ничем в шапке не подсвечен, — и выглядел бы случайным.
    expect(normalize({ listView: "table", sortBy: "bank" }).sortBy).toBe("balance");
    expect(normalize({ listView: "cards", sortBy: "bank" }).sortBy).toBe("bank");
  });

  it("в хранилище уходит ровно набор настроек, без служебных полей", () => {
    const withExtras = {
      ...ACCOUNTS_VIEW_DEFAULTS,
      loaded: true,
      hydrate: () => Promise.resolve(),
      patch: () => Promise.resolve(),
    };
    expect(Object.keys(persisted(withExtras)).sort()).toEqual(
      Object.keys(ACCOUNTS_VIEW_DEFAULTS).sort()
    );
  });
});
