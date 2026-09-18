import { describe, it, expect } from "vitest";
import { SYNCED_FIELDS } from "./cloudSettingsFields";
import { SYNCED_COLLECTIONS } from "./cloudSettingsCollections";
import { COLLECTION_TYPES } from "../lib/cloudSettings";

/**
 * Реестры переносимых настроек: имена — это ключи в облаке, и совпасть они не
 * должны ни при какой правке. Два поля с одним ключом молча затирали бы друг
 * друга на другом устройстве, а список с чужим типом не нашёл бы там своих
 * записей.
 */
describe("реестр переносимых настроек", () => {
  it("ключи полей уникальны", () => {
    const keys = SYNCED_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("типы списков уникальны и объявлены в формате облака", () => {
    const types = SYNCED_COLLECTIONS.map((c) => c.type);
    expect(new Set(types).size).toBe(types.length);
    for (const type of types) expect(COLLECTION_TYPES).toContain(type);
  });

  it("переносятся списки, которых нет в Дзен-мани", () => {
    expect(SYNCED_COLLECTIONS.map((c) => c.type).sort()).toEqual([
      "goals",
      "rules",
      "slices",
      "views",
    ]);
  });

  it("настройки бюджета переносятся все до одной", () => {
    const budget = SYNCED_FIELDS.map((f) => f.key).filter((k) => k.startsWith("budget."));
    expect(budget.sort()).toEqual([
      "budget.accounts",
      "budget.defaultView",
      "budget.forecastBasis",
      "budget.forecastMonths",
      "budget.hideEmptyRows",
      "budget.perimeterTransfers",
      "budget.rowOrder",
    ]);
  });
});
