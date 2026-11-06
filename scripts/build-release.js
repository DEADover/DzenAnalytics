#!/usr/bin/env node
// Build a single-file release archive: ZIP containing index.html, README.txt
// and THIRD-PARTY-LICENSES.txt.
// Usage: npm run release:zip  (runs build:standalone first if needed)

import { execSync } from "node:child_process";
import { mkdirSync, copyFileSync, writeFileSync, existsSync, rmSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// Read version + name from package.json
const pkg = JSON.parse(
  await import("node:fs/promises").then((m) => m.readFile(join(ROOT, "package.json"), "utf8"))
);
const version = pkg.version || "0.0.0";
const baseName = `DzenAnalytics-v${version}-standalone`;

const distDir = join(ROOT, "dist-standalone");
const releaseDir = join(ROOT, "release");
const stagingDir = join(releaseDir, baseName);
const zipPath = join(releaseDir, `${baseName}.zip`);

// 1. Build standalone bundle — ALWAYS from scratch.
//
// The previous "skip rebuild if file exists" heuristic looked like
// a nice cache but silently shipped stale binaries: if dist-standalone
// existed from a previous release, the script just rewrapped it under
// a new version label without actually rebuilding the source. As a
// result, v0.5.5 and v0.5.6 standalone zips both shipped v0.5.4-era
// code. Always rebuilding costs ~10s of vite, and is the only way to
// guarantee the binary matches the tag.
const indexHtml = join(distDir, "index.html");
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true });
}
console.log("→ running build:standalone (clean build)…");
execSync("npm run build:standalone", { cwd: ROOT, stdio: "inherit" });
if (!existsSync(indexHtml)) {
  console.error("✗ build:standalone did not produce dist-standalone/index.html");
  process.exit(1);
}

const sizeKb = Math.round(statSync(indexHtml).size / 1024);
console.log(`→ standalone bundle: ${sizeKb} KB`);

// 2. Stage: copy index.html and write README.txt
if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });
copyFileSync(indexHtml, join(stagingDir, "DzenAnalytics.html"));
// Тексты лицензий библиотек внутри сборки (scripts/thirdPartyLicenses.ts) —
// открытые лицензии просят класть их в каждую копию. Без файла архив не собираем.
const licenses = join(distDir, "THIRD-PARTY-LICENSES.txt");
if (!existsSync(licenses)) {
  console.error("✗ build:standalone did not produce dist-standalone/THIRD-PARTY-LICENSES.txt");
  process.exit(1);
}
copyFileSync(licenses, join(stagingDir, "THIRD-PARTY-LICENSES.txt"));

const readme = `DzenAnalytics ${version} — локальная финансовая аналитика
===========================================================

Как запустить
-------------
1. Распакуйте архив в любую папку (например, на рабочий стол).
2. Дважды кликните на файл DzenAnalytics.html.
3. Откроется ваш браузер по умолчанию с приложением.

Готово. Никаких установок, никаких серверов, никакого интернета.

Что внутри
----------
Один HTML-файл со всем приложением (HTML+CSS+JS+иконки).
Размер: ~${sizeKb} KB. Работает целиком в браузере.

Где хранятся данные
-------------------
В IndexedDB браузера, привязанной к этому HTML-файлу. То есть данные
остаются на вашем компьютере и не уходят никуда наружу. Чтобы перенести
данные на другой компьютер — экспортируйте CSV/JSON через интерфейс
приложения и импортируйте на новой машине.

ВАЖНО: если перенесёте файл DzenAnalytics.html в другую папку — браузер
сочтёт это новым «сайтом» и данных не увидит. Поэтому лучше один раз
выбрать постоянное место и не переносить файл.

Совместимость
-------------
Подходят все современные браузеры на Windows, macOS, Linux:
Chrome, Edge, Firefox, Safari, Brave, Opera, Arc и т.п.

В Safari на старых версиях macOS (до Big Sur) могут быть проблемы —
рекомендуется обновить браузер или использовать Chrome/Firefox.

Импорт данных из Дзен-мани
--------------------------
1. Откройте приложение Дзен-мани → Настройки → Экспорт данных → CSV.
2. В DzenAnalytics нажмите «Загрузить CSV» и выберите файл.
3. Все графики и дашборды появятся автоматически.

Безопасность
------------
Приложение работает 100% офлайн. Ни одна строка ваших финансовых данных
не покидает ваш компьютер. Никакой телеметрии, никаких внешних запросов,
никаких аналитических скриптов.

Исходный код: https://github.com/DEADover/DzenAnalytics
Лицензия: MIT
Сторонние библиотеки и шрифты и тексты их лицензий: THIRD-PARTY-LICENSES.txt
`;
writeFileSync(join(stagingDir, "README.txt"), readme, "utf8");

// 3. Zip the staging dir
if (existsSync(zipPath)) rmSync(zipPath);
console.log(`→ zipping → ${zipPath}`);
execSync(`cd "${releaseDir}" && zip -r -q "${baseName}.zip" "${baseName}"`, {
  stdio: "inherit",
  shell: "/bin/bash",
});

const zipKb = Math.round(statSync(zipPath).size / 1024);
console.log(`✓ Done: release/${baseName}.zip (${zipKb} KB)`);
