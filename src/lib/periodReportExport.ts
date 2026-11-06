/**
 * Выгрузка «Отчёта за период»: PDF и самостоятельный HTML-файл.
 *
 * Оба берут уже нарисованные листы превью (`.pr-page` внутри `.pr-doc`), а не
 * собирают документ заново — что на экране, то и в файле.
 *
 * PDF — тем же путём, что у бюджета (`budgetPdf`): снимок каждого листа и
 * листы картинками в файле. Кириллица и шрифт поэтому всегда на месте.
 *
 * HTML — разметка листов как есть, со стилями отчёта, шрифтом и логотипом
 * внутри файла: он открывается без сервиса и без интернета, текст в нём
 * выделяется и ищется, подсказки у столбцов графика работают наведением, а
 * печать раскладывает листы по страницам A4.
 */

import geistCyrillic from "@fontsource-variable/geist/files/geist-cyrillic-wght-normal.woff2?url";
import geistLatin from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url";
import { downloadDashboardPdf } from "./budgetPdf";
import { downloadBlob } from "./downloadBlob";
import { stripAmountMarks } from "./format";
import { PERIOD_REPORT_CSS, PERIOD_REPORT_FILE_CSS } from "./periodReportCss";

export async function downloadReportPdf(root: HTMLElement, fileName: string, title: string): Promise<void> {
  await downloadDashboardPdf(root, fileName, title);
}

async function dataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Текст для HTML: экранировать то, что ломает разметку. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Собрать самостоятельный HTML-документ из листов отчёта. */
export async function buildReportHtml(root: HTMLElement, title: string): Promise<string> {
  const doc = root.cloneNode(true) as HTMLElement;
  // Картинки (логотип) — внутрь файла: адрес сборки вне сервиса не откроется.
  const cache = new Map<string, string>();
  for (const img of doc.querySelectorAll("img")) {
    const src = img.getAttribute("src");
    if (!src || src.startsWith("data:")) continue;
    if (!cache.has(src)) cache.set(src, await dataUrl(new URL(src, location.href).href));
    img.setAttribute("src", cache.get(src)!);
  }
  const [cyr, lat] = await Promise.all([dataUrl(geistCyrillic), dataUrl(geistLatin)]);
  const fonts = `
@font-face { font-family: "Geist Variable"; font-style: normal; font-display: swap; font-weight: 100 900; src: url(${cyr}) format("woff2-variations"); unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116; }
@font-face { font-family: "Geist Variable"; font-style: normal; font-display: swap; font-weight: 100 900; src: url(${lat}) format("woff2-variations"); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }`;
  // Метки сумм нужны только режиму «Скрыть суммы» в самом сервисе.
  const body = stripAmountMarks(doc.outerHTML);
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${fonts}
${PERIOD_REPORT_CSS}
${PERIOD_REPORT_FILE_CSS}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

export async function downloadReportHtml(root: HTMLElement, fileName: string, title: string): Promise<void> {
  const html = await buildReportHtml(root, title);
  downloadBlob(new Blob([html], { type: "text/html;charset=utf-8" }), fileName);
}

/** Имя файла: «DzenAnalytics — отчёт 01.10.2026–31.10.2026.pdf». */
export function reportFileName(from: string, to: string, ext: "pdf" | "html" | "xlsx"): string {
  const d = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
  return `DzenAnalytics — отчёт ${d(from)}–${d(to)}.${ext}`;
}
