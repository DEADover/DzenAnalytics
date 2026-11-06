/**
 * Тексты лицензий сторонних библиотек — файлом рядом со сборкой.
 *
 * Открытые лицензии библиотек (MIT, ISC, BSD) и шрифтов (OFL) просят класть
 * уведомление об авторских правах и текст лицензии в каждую копию программы,
 * а сжатие при сборке эти комментарии из кода убирает. Поэтому при каждой
 * сборке плагин берёт все модули из node_modules, которые попали в граф
 * сборки, находит их пакеты и собирает THIRD-PARTY-LICENSES.txt: название,
 * версия, лицензия, ссылка и полный текст файла лицензии из пакета.
 *
 * Файл попадает в dist/ (сайт и Docker-образ) и в архив standalone
 * (scripts/build-release.js). Ссылка на него — в справке, блок «О сервисе».
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { LICENSES_FILE } from "../src/lib/support";

type Pkg = {
  name: string;
  version: string;
  license: string;
  url: string;
  text: string;
};

const NM = "/node_modules/";

function licenseOf(meta: Record<string, unknown>): string {
  const l = meta.license ?? meta.licenses;
  if (typeof l === "string") return l;
  if (Array.isArray(l)) return l.map((x) => (typeof x === "string" ? x : (x as { type?: string }).type)).join(" OR ");
  if (l && typeof l === "object") return String((l as { type?: string }).type ?? "UNKNOWN");
  return "UNKNOWN";
}

function urlOf(meta: Record<string, unknown>): string {
  const repo = meta.repository;
  const raw = typeof repo === "string" ? repo : (repo as { url?: string } | undefined)?.url;
  const home = typeof meta.homepage === "string" ? meta.homepage : "";
  const url = (raw ?? home ?? "")
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^github:/, "https://github.com/")
    .replace(/\.git$/, "");
  return /^[\w.-]+\/[\w.-]+$/.test(url) ? `https://github.com/${url}` : url;
}

const LICENSE_NAME = /^(licen[cs]e|copying)([._-].*)?$/i;

/** Файлы лицензий во вложенных папках пакета (до трёх уровней, без node_modules). */
function nestedLicenses(dir: string, rel = "", depth = 0): string[] {
  if (depth > 3) return [];
  const out: string[] = [];
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory() && entry.name !== "node_modules") out.push(...nestedLicenses(dir, path, depth + 1));
    else if (rel && entry.isFile() && LICENSE_NAME.test(entry.name)) out.push(path);
  }
  return out.sort();
}

function readPackage(dir: string): Pkg | null {
  const file = join(dir, "package.json");
  if (!existsSync(file)) return null;
  const meta = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  if (typeof meta.name !== "string") return null;
  const licenseFile = readdirSync(dir).find((f) => LICENSE_NAME.test(f));
  let text = licenseFile ? readFileSync(join(dir, licenseFile), "utf8").trim() : "";
  // Своего файла нет, но внутри лежат чужие пакеты со своими лицензиями
  // (так victory-vendor везёт части d3) — их тексты по папкам.
  if (!text) {
    text = nestedLicenses(dir)
      .map((rel) => `--- ${rel} ---\n\n${readFileSync(join(dir, rel), "utf8").trim()}`)
      .join("\n\n");
  }
  return {
    name: meta.name,
    version: String(meta.version ?? ""),
    license: licenseOf(meta),
    url: urlOf(meta),
    text,
  };
}

/** Каталог пакета по пути модуля внутри node_modules (вложенные — по последнему). */
function packageDir(id: string): string | null {
  const clean = id.replace(/^\0/, "").split("?")[0].replace(/\\/g, "/");
  const at = clean.lastIndexOf(NM);
  if (at < 0) return null;
  const parts = clean.slice(at + NM.length).split("/");
  const name = parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
  return clean.slice(0, at + NM.length) + name;
}

export function render(pkgs: Pkg[], product: string): string {
  const line = "=".repeat(78);
  const head = [
    `${product} — third-party software`,
    "",
    "This build includes the open-source packages and fonts listed below.",
    "Each entry gives the package, its version, license, source, and the full",
    "license text as shipped with the package.",
    "",
    `Packages: ${pkgs.length}`,
    "",
  ];
  const body = pkgs.map((p) =>
    [
      line,
      `${p.name} ${p.version}`,
      `License: ${p.license}`,
      ...(p.url ? [`Source: ${p.url}`] : []),
      "",
      p.text || `(No license file in the package. License: ${p.license}.)`,
      "",
    ].join("\n"),
  );
  return head.join("\n") + body.join("\n");
}

/**
 * Собрать список пакетов по путям модулей. Сам проект (`self`) — не сторонний.
 */
export function collect(ids: Iterable<string>, self: string): Pkg[] {
  const seen = new Map<string, Pkg>();
  for (const id of ids) {
    const dir = packageDir(id);
    if (!dir || seen.has(dir)) continue;
    const pkg = readPackage(dir);
    if (pkg && pkg.name !== self) seen.set(dir, pkg);
  }
  // Один пакет в двух местах дерева с одной версией — одна запись.
  const unique = new Map<string, Pkg>();
  for (const p of seen.values()) unique.set(`${p.name}@${p.version}`, p);
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** Пути пакетов из dependencies проекта и всех их зависимостей (для сервера разработки). */
export function runtimeTree(root: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (from: string, deps: Record<string, string> | undefined) => {
    for (const name of Object.keys(deps ?? {})) {
      // Как Node: ищем пакет в node_modules от папки зависящего вверх.
      let dir = from;
      let found = "";
      for (;;) {
        const candidate = join(dir, "node_modules", name);
        if (existsSync(join(candidate, "package.json"))) {
          found = candidate;
          break;
        }
        const up = join(dir, "..");
        if (up === dir) break;
        dir = up;
      }
      if (!found || seen.has(found)) continue;
      seen.add(found);
      out.push(join(found, "package.json"));
      const meta = JSON.parse(readFileSync(join(found, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
      visit(found, meta.dependencies);
    }
  };
  const meta = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
  visit(root, meta.dependencies);
  return out;
}

export function thirdPartyLicenses(product: string, self: string): Plugin {
  return {
    name: "third-party-licenses",
    // Сервер разработки: библиотеки там склеены заранее (.vite/deps), и граф
    // модулей их не показывает — отдаём все пакеты из dependencies со всеми их
    // зависимостями (чуть шире сборки), чтобы ссылка из справки открывалась и
    // при `npm run dev`.
    configureServer(server) {
      server.middlewares.use(`/${LICENSES_FILE}`, (_req, res) => {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(render(collect(runtimeTree(server.config.root), self), `${product} (dev server)`));
      });
    },
    generateBundle() {
      const pkgs = collect(this.getModuleIds(), self);
      this.emitFile({ type: "asset", fileName: LICENSES_FILE, source: render(pkgs, product) });
    },
  };
}
