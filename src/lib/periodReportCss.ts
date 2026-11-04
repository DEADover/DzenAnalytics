/**
 * Стили «Отчёта за период» — одним набором для превью, PDF и HTML-файла.
 *
 * Отдельно от Tailwind и тем интерфейса нарочно: отчёт — документ, а не экран.
 * Он должен выглядеть одинаково в любой теме и в файле, открытом без сервиса,
 * поэтому цвета здесь постоянные, а все классы начинаются с `pr-` и не
 * пересекаются со стилями приложения. HTML-файл получает этот же текст
 * целиком (`periodReportExport`), превью — тегом <style> на странице.
 *
 * Лист — A4 книжный при 96 точках на дюйм: 794 × 1123. Тот же размер снимает
 * выгрузка в PDF (`budgetPdf`, класс `print-portrait`).
 */

export const SHEET_W = 794;
export const SHEET_H = 1123;

export const PERIOD_REPORT_CSS = `
.pr-doc {
  --pr-ink: #12161d;
  --pr-ink2: #3a4150;
  --pr-muted: #6b7280;
  --pr-faint: #9aa1ad;
  --pr-line: #e5e7eb;
  --pr-soft: #f4f6f8;
  --pr-accent: #0891b2;
  --pr-accent-soft: #e6f6f9;
  --pr-income: #16a34a;
  --pr-expense: #dc2626;
  --pr-warn: #d97706;
  font-family: "Geist Variable", "Geist", Inter, -apple-system, "Segoe UI", system-ui, sans-serif;
  color: var(--pr-ink);
  font-feature-settings: "tnum" 1;
  -webkit-font-smoothing: antialiased;
  line-height: 1.35;
}
.pr-doc *, .pr-doc *::before, .pr-doc *::after { box-sizing: border-box; }
.pr-doc h1, .pr-doc h2, .pr-doc h3, .pr-doc p { margin: 0; }
.pr-page {
  position: relative;
  width: ${SHEET_W}px;
  height: ${SHEET_H}px;
  background: #fff;
  padding: 44px 48px 40px;
  display: flex;
  flex-direction: column;
  gap: 22px;
  overflow: hidden;
}
.pr-head { display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: var(--pr-muted); letter-spacing: .02em; }
.pr-brand { display: flex; align-items: center; gap: 8px; font-weight: 600; color: var(--pr-ink2); font-size: 12px; }
.pr-brand img { height: 15px; width: auto; display: block; }
.pr-foot { margin-top: auto; display: flex; justify-content: space-between; font-size: 10px; color: var(--pr-faint); padding-top: 10px; border-top: 1px solid var(--pr-line); }

.pr-eyebrow { font-size: 11px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--pr-accent); }
.pr-title { font-size: 46px; font-weight: 700; letter-spacing: -.035em; line-height: 1.02; margin-top: 8px; }
.pr-dates { font-size: 14px; color: var(--pr-muted); margin-top: 8px; }
.pr-filters { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.pr-chip { font-size: 11px; color: var(--pr-ink2); background: var(--pr-soft); border-radius: 999px; padding: 3px 10px; }

.pr-h2 { font-size: 20px; font-weight: 700; letter-spacing: -.02em; }
.pr-h3 { font-size: 15px; font-weight: 700; letter-spacing: -.01em; margin-bottom: 10px; }
.pr-sub { font-size: 11.5px; color: var(--pr-muted); margin-top: 3px; }
.pr-section { display: flex; flex-direction: column; gap: 12px; }

.pr-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.pr-kpi { background: var(--pr-soft); border-radius: 14px; padding: 14px 14px 12px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.pr-kpi-label { font-size: 11px; color: var(--pr-muted); font-weight: 550; }
.pr-kpi-value { font-size: 21px; font-weight: 700; letter-spacing: -.02em; white-space: nowrap; }
.pr-kpi-value.pr-income { color: var(--pr-income); }
.pr-kpi-value.pr-expense { color: var(--pr-expense); }
.pr-delta { font-size: 11px; color: var(--pr-muted); line-height: 1.3; }
.pr-delta b { font-weight: 650; }
.pr-good { color: var(--pr-income); }
.pr-bad { color: var(--pr-expense); }

.pr-capital { display: grid; grid-template-columns: 1fr auto 1fr auto; align-items: center; gap: 16px; border: 1px solid var(--pr-line); border-radius: 14px; padding: 14px 18px; }
.pr-capital-cell { display: flex; flex-direction: column; gap: 3px; }
.pr-capital-cell span { font-size: 11px; color: var(--pr-muted); }
.pr-capital-cell b { font-size: 18px; font-weight: 700; letter-spacing: -.015em; white-space: nowrap; }
.pr-arrow { color: var(--pr-faint); font-size: 18px; }
.pr-capital-delta { text-align: right; }

.pr-chart { width: 100%; display: block; overflow: visible; }
.pr-chart text { font-family: inherit; }
.pr-axis { font-size: 9.5px; fill: var(--pr-faint); }
.pr-grid { stroke: var(--pr-line); stroke-width: 1; }
.pr-zero { stroke: #cfd4dc; stroke-width: 1; }
.pr-col .pr-tip { opacity: 0; pointer-events: none; transition: opacity .12s; }
.pr-col:hover .pr-tip { opacity: 1; }
.pr-col:hover .pr-hit { fill: rgba(8, 145, 178, .06); }
.pr-tip rect { fill: var(--pr-ink); }
.pr-tip text { fill: #fff; font-size: 10px; font-weight: 600; }
.pr-legend { display: flex; gap: 16px; font-size: 11px; color: var(--pr-muted); }
.pr-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
.pr-legend i.pr-line-mark { height: 2px; border-radius: 1px; vertical-align: 3px; }

.pr-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
.pr-table th { font-size: 10px; font-weight: 600; color: var(--pr-muted); text-align: left; padding: 0 0 6px; border-bottom: 1px solid var(--pr-line); text-transform: uppercase; letter-spacing: .06em; }
.pr-table td { padding: 6px 0; border-bottom: 1px solid #f0f1f3; vertical-align: middle; }
.pr-table th.pr-num, .pr-table td.pr-num { text-align: right; white-space: nowrap; padding-left: 12px; }
.pr-table td.pr-name { max-width: 0; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 8px; }
.pr-table td.pr-date { white-space: nowrap; color: var(--pr-muted); padding-right: 12px; }
.pr-table tfoot td { font-weight: 650; border-bottom: none; padding-top: 8px; }
.pr-muted { color: var(--pr-muted); }

.pr-bars { display: flex; flex-direction: column; gap: 9px; }
.pr-bar-row { display: grid; grid-template-columns: 158px minmax(0, 1fr) 96px 46px 58px; align-items: center; gap: 10px; font-size: 12px; }
.pr-bar-name { display: flex; align-items: center; gap: 8px; min-width: 0; }
.pr-bar-name span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pr-dot { width: 9px; height: 9px; border-radius: 3px; flex: none; }
.pr-track { height: 10px; border-radius: 999px; background: var(--pr-soft); overflow: hidden; }
.pr-fill { height: 100%; border-radius: 999px; }
.pr-bar-num { text-align: right; white-space: nowrap; font-weight: 600; }
.pr-bar-share { text-align: right; color: var(--pr-muted); }
.pr-bar-delta { text-align: right; font-size: 11px; white-space: nowrap; }

.pr-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 28px; }

.pr-budget-sum { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 10px; }
.pr-plan { display: grid; grid-template-columns: 158px minmax(0, 1fr) 150px; align-items: center; gap: 10px; font-size: 12px; }
.pr-plan-track { position: relative; height: 10px; border-radius: 999px; background: var(--pr-soft); }
.pr-plan-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; background: var(--pr-accent); }
.pr-plan-fill.pr-over { background: var(--pr-expense); }
.pr-plan-mark { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--pr-ink2); border-radius: 1px; }
.pr-plan-num { text-align: right; white-space: nowrap; }

.pr-obs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.pr-ob { background: var(--pr-soft); border-radius: 14px; padding: 13px 15px; display: flex; flex-direction: column; gap: 5px; }
.pr-ob-label { display: flex; align-items: center; gap: 7px; font-size: 11px; color: var(--pr-muted); }
.pr-ob-label svg { width: 13px; height: 13px; color: var(--pr-accent); flex: none; }
.pr-ob-value { font-size: 19px; font-weight: 700; letter-spacing: -.015em; }
.pr-ob-text { font-size: 11.5px; color: var(--pr-ink2); }
.pr-empty { font-size: 12px; color: var(--pr-muted); background: var(--pr-soft); border-radius: 12px; padding: 14px 16px; }
`;

/**
 * Стили самостоятельного HTML-файла поверх `PERIOD_REPORT_CSS`: листы стопкой
 * по центру серого фона, как в просмотрщике, и печать по листу на страницу.
 */
export const PERIOD_REPORT_FILE_CSS = `
html, body { margin: 0; background: #e9ecef; overflow-x: auto; }
body { padding: 32px 16px 48px; }
.pr-doc { display: flex; flex-direction: column; align-items: center; gap: 24px; }
.pr-page { box-shadow: 0 1px 3px rgba(16, 24, 40, .08), 0 12px 32px rgba(16, 24, 40, .08); border-radius: 4px; }
@page { size: A4 portrait; margin: 0; }
@media print {
  html, body { background: #fff; padding: 0; }
  .pr-doc { gap: 0; }
  .pr-page { box-shadow: none; border-radius: 0; break-after: page; }
}
`;
