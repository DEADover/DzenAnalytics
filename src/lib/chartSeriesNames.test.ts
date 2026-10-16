import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Подсказка SeriesTooltip подписывает строку именем ряда, а без `name` —
 * его ключом данных: в «Трендах» так всплывали «avg» и «total». У каждого
 * ряда с ключом-строкой в файлах с такой подсказкой должно быть русское имя.
 */
function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? tsxFiles(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

describe("ряды графиков с подсказкой SeriesTooltip подписаны по-русски", () => {
  it("у Bar/Line/Area с ключом-строкой есть name", () => {
    const missing: string[] = [];
    for (const f of tsxFiles("src")) {
      const s = readFileSync(f, "utf-8");
      if (!s.includes("<SeriesTooltip")) continue;
      for (const m of s.matchAll(/<(Bar|Line|Area)\b([\s\S]*?)\/?>/g)) {
        const key = m[2].match(/dataKey="([^"]+)"/)?.[1];
        if (key && !/\bname=/.test(m[2])) missing.push(`${f}: ${m[1]} dataKey="${key}"`);
      }
    }
    expect(missing).toEqual([]);
  });
});
