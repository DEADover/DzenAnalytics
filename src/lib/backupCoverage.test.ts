import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { BACKUP_META_KEYS, BACKUP_EXCLUDED_KEYS, BACKUP_LOCAL_KEYS } from "./backup";

/**
 * Сторож полноты бэкапа.
 *
 * Список ключей бэкапа отставал от приложения молча: сторы добавлялись, а
 * `BACKUP_META_KEYS` — нет, и при потере IndexedDB пользователь недосчитывался
 * правок счетов, контрагентов, настроек бюджета и разрезов данных. Ни один
 * тест этого не ловил, потому что каждый по отдельности работал.
 *
 * Поэтому тест смотрит не на поведение, а на ИСХОДНИКИ: собирает всё, что
 * приложение пишет в базу, и требует, чтобы каждый ключ был либо в бэкапе,
 * либо в списке исключений с причиной. Новый стор без такого решения уронит
 * тест — и это единственный способ не наступить на те же грабли.
 */

const SRC = new URL("..", import.meta.url).pathname;

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...tsFiles(full));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Ключи `localStorage` → файлы, которые их пишут. */
function localKeys(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of tsFiles(SRC)) {
    if (file.endsWith("/lib/backup.ts")) continue;
    const src = readFileSync(file, "utf8");
    const consts = new Map(
      [...src.matchAll(/const\s+(\w+)\s*=\s*"([^"]+)"\s*;/g)].map((m) => [m[1], m[2]])
    );
    for (const m of src.matchAll(/localStorage\.setItem\(\s*([A-Za-z_]\w*|"[^"]+")/g)) {
      const token = m[1];
      const key = token.startsWith('"') ? token.slice(1, -1) : consts.get(token);
      if (!key) continue;
      found.set(key, [...(found.get(key) ?? []), file.slice(SRC.length)]);
    }
  }
  return found;
}

/** Ключ → файлы, которые его пишут. */
function persistedKeys(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of tsFiles(SRC)) {
    // Сам модуль бэкапа и обёртка над базой ключей не «владеют».
    if (file.endsWith("/lib/backup.ts") || file.endsWith("/lib/db.ts")) continue;
    const src = readFileSync(file, "utf8");
    // Константы вида `const KEY = "budgetSettings";` — так объявлено
    // большинство сторов.
    const consts = new Map(
      [...src.matchAll(/const\s+(\w+)\s*=\s*"([^"]+)"\s*;/g)].map((m) => [m[1], m[2]])
    );
    for (const m of src.matchAll(/saveJSON\(\s*([A-Za-z_]\w*|"[^"]+")/g)) {
      const token = m[1];
      const key = token.startsWith('"') ? token.slice(1, -1) : consts.get(token);
      // Вычисляемый ключ (снимки облака кладутся под `cloudSnapshot:<id>`) —
      // разобрать его статически нельзя, и в бэкап он всё равно не идёт.
      if (!key) continue;
      found.set(key, [...(found.get(key) ?? []), file.slice(SRC.length)]);
    }
  }
  return found;
}

describe("полнота бэкапа", () => {
  it("каждый сохраняемый ключ либо в бэкапе, либо в исключениях с причиной", () => {
    const covered = new Set<string>([...BACKUP_META_KEYS, ...Object.keys(BACKUP_EXCLUDED_KEYS)]);
    const orphans = [...persistedKeys()]
      .filter(([key]) => !covered.has(key))
      .map(([key, files]) => `${key} (${files.join(", ")})`);
    expect(
      orphans,
      "Новый ключ в IndexedDB. Добавьте его в BACKUP_META_KEYS — или в " +
        "BACKUP_EXCLUDED_KEYS с объяснением, почему его не нужно восстанавливать"
    ).toEqual([]);
  });

  it("КЛЮЧЕВОЕ: то, что живёт мимо IndexedDB, тоже под присмотром", () => {
    // Тема лежит в localStorage, и первый сторож её не видел: бэкап молча
    // не восстанавливал светлую/тёмную, хотя обещал «оформление».
    const covered = new Set<string>([
      ...BACKUP_LOCAL_KEYS,
      ...Object.keys(BACKUP_EXCLUDED_KEYS),
    ]);
    const orphans = [...localKeys()]
      .filter(([key]) => !covered.has(key))
      .map(([key, files]) => `${key} (${files.join(", ")})`);
    expect(
      orphans,
      "Новый ключ в localStorage. Добавьте его в BACKUP_LOCAL_KEYS — или в " +
        "BACKUP_EXCLUDED_KEYS с объяснением"
    ).toEqual([]);
    expect([...localKeys().keys()], "разбор исходников сломался").toContain("dzen.theme");
  });

  it("ключ не может быть одновременно в бэкапе и в исключениях", () => {
    const both = BACKUP_META_KEYS.filter((k) => k in BACKUP_EXCLUDED_KEYS);
    expect(both).toEqual([]);
  });

  it("у каждого исключения есть внятная причина", () => {
    for (const [key, reason] of Object.entries(BACKUP_EXCLUDED_KEYS)) {
      expect(reason.length, `${key}: причина слишком короткая`).toBeGreaterThan(8);
    }
  });

  it("секреты в бэкап не попадают", () => {
    // Бэкап — открытый JSON, который пользователь кладёт куда угодно.
    for (const secret of ["zenmoneyToken", "zenmoneyCache"]) {
      expect(BACKUP_META_KEYS as readonly string[]).not.toContain(secret);
      expect(BACKUP_EXCLUDED_KEYS[secret]).toBeTruthy();
    }
  });

  it("сторож видит настоящие ключи, а не пустоту", () => {
    // Если бы разбор исходников сломался, предыдущие проверки прошли бы на
    // пустом списке и охраняли бы ничего.
    const keys = persistedKeys();
    expect(keys.size).toBeGreaterThan(20);
    expect([...keys.keys()]).toContain("budgetSettings");
    expect([...keys.keys()]).toContain("zenmoneyToken");
  });
});
