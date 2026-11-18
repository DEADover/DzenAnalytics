/**
 * Перемещение виджетов главной под случайными последовательностями действий.
 *
 * Отдельные случаи проверяет `dashboardLayout.test.ts`; здесь — то, что должно
 * держаться ВСЕГДА, какую бы раскладку человек ни собрал: шаг стрелкой в
 * пустую клетку не трогает остальных и обратим, обмен равных по ширине
 * виджетов двигает только их двоих, бросок в клетку, которая зовёт, ставит
 * виджет именно в неё, ключи не теряются и не двоятся.
 *
 * Последовательности случайные, но зерно закреплено: прогон повторяем.
 */
import { expect, it } from "vitest";
import {
  DEFAULT_LAYOUT, WIDGETS, packLayout, shiftWidget, swapWidgets, dropIntoGap, setWidgetHidden, addWidget,
  canShiftWidget, canDropIntoGap, widgetMeta, normalizeLayout, type WidgetPlacement,
} from "./dashboardLayout";

type Pos = { row: number; col: number };
function positions(layout: readonly WidgetPlacement[]) {
  const pos = new Map<string, Pos>();
  const gaps: { before: string | null; row: number; col: number; span: number }[] = [];
  let col = 0, row = 0;
  for (const c of packLayout(layout.filter((p) => !p.hidden))) {
    const span = c.type === "gap" ? c.span : widgetMeta(c.placement.kind).span;
    if (c.type === "widget") pos.set(c.placement.key, { row, col });
    else gaps.push({ before: c.before, row, col, span });
    col += span;
    if (col >= 3) { col = 0; row++; }
  }
  return { pos, gaps };
}
function rows(layout: readonly WidgetPlacement[]): string {
  const out: string[] = []; let row: string[] = []; let col = 0;
  for (const c of packLayout(layout.filter((p) => !p.hidden))) {
    const span = c.type === "gap" ? c.span : widgetMeta(c.placement.kind).span;
    row.push(c.type === "gap" ? `·${span}` : `${c.placement.key}${span > 1 ? `(${span})` : ""}`);
    col += span; if (col >= 3) { out.push(row.join(" | ")); row = []; col = 0; }
  }
  if (row.length) out.push(row.join(" | "));
  return out.join("  /  ");
}
let seed = 12345;
const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };

it("перемещения держат инварианты на случайных раскладках", () => {
  const issues = new Map<string, string[]>();
  const note = (kind: string, text: string) => { const l = issues.get(kind) ?? []; if (l.length < 4) l.push(text); issues.set(kind, l); };
  const count = new Map<string, number>();
  const bump = (k: string) => count.set(k, (count.get(k) ?? 0) + 1);
  for (let run = 0; run < 400; run++) {
    let l: WidgetPlacement[] = DEFAULT_LAYOUT.map((p) => ({ ...p }));
    // случайный состав
    for (const w of WIDGETS) if (!w.multi && rnd(2) === 0) l = setWidgetHidden(l, w.kind, rnd(2) === 0);
    if (rnd(3) === 0) l = addWidget(l, "watch");
    for (let step = 0; step < 25; step++) {
      const vis = l.filter((p) => !p.hidden);
      if (vis.length < 2) break;
      const k = vis[rnd(vis.length)].key;
      const before = positions(l);
      const op = rnd(3);
      if (op === 0) {
        const dir = rnd(2) === 0 ? 1 : -1;
        if (!canShiftWidget(l, k, dir)) continue;
        const next = shiftWidget(l, k, dir);
        // туда-обратно
        const back = shiftWidget(next, k, -dir as 1 | -1);
        bump("shift");
        if (rows(back) !== rows(l) && !(next.find((p) => p.key === k)!.offset)) note("shift не обратим", `${rows(l)}\n   ${k} ${dir} → ${rows(next)}\n   обратно → ${rows(back)}`);
        // шаг в клетку: остальные на месте
        const after = positions(next);
        const moved = [...before.pos.keys()].filter((x) => x !== k && (after.pos.get(x)!.row !== before.pos.get(x)!.row || after.pos.get(x)!.col !== before.pos.get(x)!.col));
        const selfSameRow = after.pos.get(k)!.row === before.pos.get(k)!.row;
        const offsetStep = next.findIndex((p) => p.key === k) === l.findIndex((p) => p.key === k);
        if (offsetStep && moved.length > 0) note("шаг в клетку сдвинул других", `${rows(l)}\n   ${k} ${dir} → ${rows(next)}  [${moved}]`);
        if (offsetStep && !selfSameRow) note("шаг в клетку сменил ряд", `${rows(l)}\n   ${k} ${dir} → ${rows(next)}`);
        if (rows(next) === rows(l)) note("шаг ничего не изменил на экране", `${rows(l)}  ${k} ${dir}`);
        l = next;
      } else if (op === 1) {
        const o = vis[rnd(vis.length)].key;
        if (o === k) continue;
        const next = swapWidgets(l, k, o);
        bump("swap");
        const a = positions(next);
        const sameSpan = widgetMeta(l.find((p) => p.key === k)!.kind).span === widgetMeta(l.find((p) => p.key === o)!.kind).span;
        if (sameSpan) {
          const moved = [...before.pos.keys()].filter((x) => x !== k && x !== o && (a.pos.get(x)!.row !== before.pos.get(x)!.row || a.pos.get(x)!.col !== before.pos.get(x)!.col));
          if (moved.length) note("обмен равных сдвинул других", `${rows(l)}\n   ${k}↔${o} → ${rows(next)}`);
          const pk = a.pos.get(k)!, po = before.pos.get(o)!;
          if (pk.row !== po.row || pk.col !== po.col) note("обмен равных: не на месте цели", `${rows(l)}\n   ${k}↔${o} → ${rows(next)}`);
        }
        l = next;
      } else {
        const span = widgetMeta(l.find((p) => p.key === k)!.kind).span;
        const ok = before.gaps.filter((g) => g.col + span <= 3 && canDropIntoGap(l, k, g.before, g.col));
        if (!ok.length) continue;
        const g = ok[rnd(ok.length)];
        const next = dropIntoGap(l, k, g.before, g.col);
        bump("drop");
        const a = positions(next);
        const pk = a.pos.get(k)!;
        if (pk.col !== g.col) note("бросок: не та колонка", `${rows(l)}\n   ${k} → дырка r${g.row}c${g.col} (перед ${g.before}) → ${rows(next)}`);
        else if (rows(next) === rows(l)) note("бросок ничего не изменил", `${rows(l)}\n   ${k} → дырка r${g.row}c${g.col} (перед ${g.before})`);
        else {
          const sameRow = before.pos.get(k)!.row === g.row;
          const moved = [...before.pos.keys()].filter((x) => x !== k && (sameRow ? before.pos.get(x)!.row === g.row : x === g.before) && a.pos.get(x)!.col !== before.pos.get(x)!.col);
          if (moved.length) note("бросок сдвинул других по колонке", `${rows(l)}\n   ${k} → дырка r${g.row}c${g.col} (перед ${g.before}) → ${rows(next)}  [${moved}]`);
        }
        l = next;
      }
      // ключи целы и нормализация ничего не меняет
      const ks = l.map((p) => p.key);
      if (new Set(ks).size !== ks.length) note("дубли ключей", ks.join(","));
      if (JSON.stringify(normalizeLayout(l)) !== JSON.stringify(l)) note("нормализация меняет раскладку", rows(l));
    }
  }
  // Прогон не вырожденный: каждого действия набралось достаточно.
  expect(count.get("shift") ?? 0).toBeGreaterThan(500);
  expect(count.get("drop") ?? 0).toBeGreaterThan(300);
  expect(count.get("swap") ?? 0).toBeGreaterThan(30);
  const report = [...issues].map(([k, list]) => `### ${k}\n - ${list.join("\n - ")}`).join("\n\n");
  expect(report).toBe("");
});
