import { describe, it, expect } from "vitest";
import {
  backupFileName,
  parseAndValidateBackup,
  safePushModeOnRestore,
} from "./backup";

describe("parseAndValidateBackup", () => {
  // issue #93: облачный снимок приносили в «Восстановить из бэкапа» и получали
  // «не похоже на бэкап DzenAnalytics» — про файл, который сам же и создал.
  it("узнаёт облачный снимок и говорит, куда его нести", () => {
    const snapshot = JSON.stringify({
      _meta: { app: "DzenAnalytics", schema: "cloud-snapshot/v1" },
      diff: { transaction: [], account: [] },
    });
    expect(() => parseAndValidateBackup(snapshot)).toThrow(/снимок аккаунта/i);
    // Текст ведёт к нужной кнопке, а не просто отказывает.
    expect(() => parseAndValidateBackup(snapshot)).toThrow(/Загрузить файл/);
  });

  it("узнаёт снимок и без пометки — по одному полю diff", () => {
    // Файл могли переименовать, обрезать или собрать руками; опознаётся форма.
    const bare = JSON.stringify({ diff: { transaction: [] } });
    expect(() => parseAndValidateBackup(bare)).toThrow(/снимок аккаунта/i);
  });

  it("не принимает за снимок бэкап с полем diff", () => {
    // `diff` — не зарезервированное слово: у настоящего бэкапа есть version,
    // и он должен проходить, что бы ещё в нём ни лежало.
    const backup = JSON.stringify({ version: 1, diff: { что: "нибудь" }, transactions: [] });
    expect(() => parseAndValidateBackup(backup)).not.toThrow();
  });

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

describe("backupFileName", () => {
  const at = new Date(2026, 8, 7, 13, 5, 9); // 7 сентября 2026, 13:05:09

  it("ставит дату и время в имя", () => {
    expect(backupFileName(at)).toBe("dzenanalytics-backup-2026-09-07_13-05-09.json");
  });

  it("сжатую копию называет .json.gz", () => {
    // Не просто «.gz»: в папке загрузок должно быть видно, что внутри json,
    // иначе это архив непонятно чего.
    expect(backupFileName(at, undefined, true)).toBe(
      "dzenanalytics-backup-2026-09-07_13-05-09.json.gz"
    );
  });

  it("скачанную по расписанию помечает «-auto»", () => {
    expect(backupFileName(at, "auto", true)).toBe(
      "dzenanalytics-backup-2026-09-07_13-05-09-auto.json.gz"
    );
  });

  it("однозначные числа дополняет нулём", () => {
    // Иначе имена сортируются в папке не по времени.
    const early = new Date(2026, 0, 2, 3, 4, 5);
    expect(backupFileName(early)).toBe("dzenanalytics-backup-2026-01-02_03-04-05.json");
  });
});
