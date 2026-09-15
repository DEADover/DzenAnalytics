import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALL_SCHEMES,
  DARK_SCHEMES,
  DEFAULT_DARK_SCHEME,
  DEFAULT_LIGHT_SCHEME,
  LIGHT_SCHEMES,
  isDarkSchemeId,
  isLightSchemeId,
  schemeById,
} from "./themeSchemes";

const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");

/** Токены, без которых тема выглядела бы чужими цветами. */
const TOKENS = [
  "--c-bg",
  "--c-panel",
  "--c-panel2",
  "--c-border",
  "--c-muted",
  "--c-text",
  "--c-accent",
  "--c-accent-fg",
  "--c-accent2",
  "--c-income",
  "--c-expense",
  "--c-warn",
  "--c-on-tone",
  "--shadow-tray",
  "--grid",
  "--tooltip-bg",
  "--tooltip-border",
];

function block(id: string): string | null {
  const m = css.match(new RegExp(`\\[data-scheme="${id}"\\]\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
}

describe("цветовые темы", () => {
  it("по шесть на светлый и тёмный вид, имена и id не повторяются", () => {
    expect(LIGHT_SCHEMES).toHaveLength(6);
    expect(DARK_SCHEMES).toHaveLength(6);
    expect(new Set(ALL_SCHEMES.map((s) => s.id)).size).toBe(12);
    expect(new Set(ALL_SCHEMES.map((s) => s.name)).size).toBe(12);
  });

  it("темы по умолчанию — первые в списках и своего вида", () => {
    expect(LIGHT_SCHEMES[0].id).toBe(DEFAULT_LIGHT_SCHEME);
    expect(DARK_SCHEMES[0].id).toBe(DEFAULT_DARK_SCHEME);
    expect(isLightSchemeId(DEFAULT_LIGHT_SCHEME)).toBe(true);
    expect(isDarkSchemeId(DEFAULT_DARK_SCHEME)).toBe(true);
    expect(isLightSchemeId(DEFAULT_DARK_SCHEME)).toBe(false);
    expect(isDarkSchemeId("neutral")).toBe(false);
    expect(schemeById("coal")?.name).toBe("Уголь");
  });

  it("у каждой темы в index.css полный набор токенов", () => {
    for (const s of ALL_SCHEMES) {
      const body = block(s.id);
      expect(body, `нет блока [data-scheme="${s.id}"]`).not.toBeNull();
      for (const t of TOKENS) {
        expect(body, `${s.id}: нет ${t}`).toMatch(new RegExp(`${t}\\s*:`));
      }
    }
  });

  it("в index.css нет блоков тем, которых нет в списке", () => {
    const ids = [...css.matchAll(/\[data-scheme="([a-z0-9-]+)"\]/g)].map((m) => m[1]);
    expect(ids.filter((id) => !schemeById(id))).toEqual([]);
  });
});
