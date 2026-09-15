import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatReleaseDate, parseRelease } from "./releaseInfo";

const MD = `# Changelog

## v1.8.10 — Темы и единый вид · 2026-09-15

Текст.

## v1.8.9 — Теги-категории · 2026-09-13
`;

describe("сведения о выпуске", () => {
  it("название и дата из заголовка записи", () => {
    expect(parseRelease(MD, "1.8.10")).toEqual({ version: "1.8.10", name: "Темы и единый вид", date: "2026-09-15" });
    expect(parseRelease(MD, "1.8.9")?.name).toBe("Теги-категории");
  });

  it("версия без записи — null; точка в версии не совпадает с любым знаком", () => {
    expect(parseRelease(MD, "1.8.11")).toBeNull();
    expect(parseRelease(MD, "1.8.1")).toBeNull();
    expect(parseRelease("## v1x8x10 — Не то · 2026-01-01", "1.8.10")).toBeNull();
  });

  it("дата — словами, без «г.»", () => {
    expect(formatReleaseDate("2026-09-15")).toBe("15 сентября 2026");
    expect(formatReleaseDate("не дата")).toBe("не дата");
  });

  it("текущая версия из package.json описана в CHANGELOG.md", () => {
    const root = resolve(__dirname, "../..");
    const { version } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const info = parseRelease(readFileSync(resolve(root, "CHANGELOG.md"), "utf8"), version);
    expect(info?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(info?.name).toBeTruthy();
  });
});
