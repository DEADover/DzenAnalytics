import { describe, it, expect } from "vitest";
import { parseAndValidateBackup, safePushModeOnRestore } from "./backup";

describe("parseAndValidateBackup", () => {
  it("accepts a well-formed backup", () => {
    const out = parseAndValidateBackup(
      JSON.stringify({ version: 1, transactions: [{ id: "a" }], rates: { base: "RUB", rates: {} } })
    );
    expect(out.version).toBe(1);
    expect(Array.isArray(out.transactions)).toBe(true);
  });

  it("rejects non-JSON", () => {
    expect(() => parseAndValidateBackup("{not json")).toThrow();
  });

  it("rejects a non-object top level (array / primitive)", () => {
    expect(() => parseAndValidateBackup("[1,2,3]")).toThrow();
    expect(() => parseAndValidateBackup("42")).toThrow();
  });

  it("rejects a file without a version field", () => {
    expect(() => parseAndValidateBackup(JSON.stringify({ transactions: [] }))).toThrow();
  });

  it("rejects transactions that aren't an array", () => {
    expect(() =>
      parseAndValidateBackup(JSON.stringify({ version: 1, transactions: "oops" }))
    ).toThrow();
  });

  it("strips prototype-pollution keys from nested objects", () => {
    const out = parseAndValidateBackup(
      '{"version":1,"rates":{"base":"RUB","__proto__":{"polluted":true}}}'
    );
    // The dangerous key must not survive into the sanitized output...
    expect(Object.prototype.hasOwnProperty.call(out.rates, "__proto__")).toBe(false);
    // ...and global Object.prototype must remain unpolluted.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("safePushModeOnRestore", () => {
  it("автоматические режимы понижаются до ручного", () => {
    // Именно они отправляют в облако сами, без нажатия.
    expect(safePushModeOnRestore("auto")).toBe("manual");
    expect(safePushModeOnRestore("on-sync")).toBe("manual");
  });

  it("ручной остаётся ручным, а выключенный — выключенным", () => {
    expect(safePushModeOnRestore("manual")).toBe("manual");
    expect(safePushModeOnRestore("off")).toBe("off");
  });

  it("режима в файле нет — отправка выключена", () => {
    // Бэкап старого формата или испорченный файл: включать отправку по
    // умолчанию нельзя, это как раз тот случай, когда молчание безопаснее.
    expect(safePushModeOnRestore(null)).toBe("off");
    expect(safePushModeOnRestore(undefined)).toBe("off");
  });

  it("мусор вместо режима отправку не включает автоматически", () => {
    // Чужой json могли править руками. Что угодно непонятное — это «не off»,
    // и мы отдаём самый слабый из включённых режимов, а не самый сильный.
    expect(safePushModeOnRestore("АВТО")).toBe("manual");
    expect(safePushModeOnRestore(42)).toBe("manual");
  });
});
