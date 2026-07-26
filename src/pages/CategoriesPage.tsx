import { useMemo, useState } from "react";
import { ResponsiveContainer, Tooltip, Treemap } from "recharts";
import { ChevronRight, ChevronDown, Maximize2, X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useDataStore } from "../store/useDataStore";
import { useThemeStore } from "../store/useThemeStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { useFiltersStore, applyFilters, presetToRange } from "../store/useFiltersStore";
import { periodRange, shiftPeriod } from "../lib/period";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useDrillStore } from "../store/useDrillStore";
import { affectsExpense, expenseDelta } from "../lib/txKindStyle";
import { colorForCategory, subcategoryColor } from "../lib/categoryColor";
import { formatMoney, formatPct } from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";
import { CategorySunburst } from "../components/CategorySunburst";
import { CategoryDot } from "../components/CategoryDot";
import { KindSwitcher } from "../components/KindSwitcher";
import { PieChart as PieChartIcon } from "lucide-react";
import type { Transaction } from "../types";

const COLORS = [
  "#22D3EE", "#A78BFA", "#F59E0B", "#10B981", "#EF4444",
  "#EC4899", "#3B82F6", "#84CC16", "#F97316", "#14B8A6",
  "#8B5CF6", "#06B6D4", "#FBBF24", "#34D399", "#F472B6",
];

/**
 * Treemap text colour — uniform across all cells in both themes.
 *
 * We used to flip between black/white per-cell based on the fill's
 * perceived brightness (YIQ), which gave a confused, "patchwork" look.
 * Then we settled on dark-text-on-light / white-text-on-dark, but the
 * dark text on saturated cells (deep blue, pink) was hard to read and
 * felt heavy. Final rule: white text everywhere — the treemap fills
 * are already mid-to-saturated category colours that take a white
 * label cleanly in both themes.
 */
function readableTextOn(_color: string, _theme: "light" | "dark"): string {
  return "#FFFFFF";
}

function truncateToWidth(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return "…";
  return text.slice(0, Math.max(1, maxChars - 1)) + "…";
}

/** Mix a hex colour toward `target` by `t` (0..1). Used to derive opaque
 *  subcategory shades from the parent category colour (so white labels stay
 *  readable, unlike a low fill-opacity). */
function mixHex(hex: string, target: string, t: number): string {
  const parse = (h: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(h);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const a = parse(hex);
  const b = parse(target);
  if (!a || !b) return hex;
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `#${((1 << 24) + (c[0] << 16) + (c[1] << 8) + c[2]).toString(16).slice(1)}`;
}

const TREEMAP_CATS = 24;

interface TreemapLeaf {
  name: string;
  cat: string;
  fullName?: string;
  value: number;
  color: string;
  /** "sub" = a subcategory, "rem" = the category's «без подкатегории» part,
   *  "cat" = a category that has no subcategories at all. Drives the tooltip. */
  level: "sub" | "rem" | "cat";
  // Recharts' TreemapDataType requires an index signature.
  [key: string]: unknown;
}
interface TreemapDatum extends TreemapLeaf {
  children?: TreemapLeaf[];
}

/** Build one nested Treemap node from a category: a leaf when it has no
 *  subcategories, otherwise a container whose children are its subcategory
 *  cells (opaque shades of the parent colour) plus a «без подкатегории»
 *  remainder. Module-level so the data memo stays trivially preservable. */
function buildTreemapNode(
  n: CategoryNode,
  color: string,
  meta: Record<string, { color?: string | null } | undefined>
): TreemapDatum {
  const posSubs = n.subs.filter((s) => s.total > 0);
  if (!posSubs.length) {
    return { name: n.name, cat: n.name, value: n.total, color, level: "cat" };
  }
  const subSum = posSubs.reduce((s, x) => s + x.total, 0);
  const children: TreemapLeaf[] = posSubs.map((sub, idx) => ({
    name: sub.name,
    cat: n.name,
    fullName: sub.fullName,
    value: sub.total,
    // Subcategory's own Zenmoney colour when set; otherwise a shade of the
    // parent so unstyled subs still tile cleanly (issue #17).
    color: subcategoryColor(sub.fullName, meta) || mixHex(color, "#111827", Math.min(0.5, idx * 0.12)),
    level: "sub",
  }));
  const rem = n.total - subSum;
  if (rem > 0.0001) {
    // The «no subcategory» slice is spending tagged to the category itself —
    // label it with the CATEGORY name (not «без подкатегории»).
    children.push({
      name: n.name,
      cat: n.name,
      value: rem,
      color: mixHex(color, "#9ca3af", 0.55),
      level: "rem",
    });
  }
  return { name: n.name, cat: n.name, value: n.total, color, level: "cat", children };
}

/** A computed Treemap node (Recharts spreads the data fields onto it). */
interface TreemapNodeView {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  depth?: number;
  index?: number;
  name?: string;
  value?: number;
  color?: string;
  cat?: string;
  fullName?: string;
  children?: unknown;
}

function TreemapCell({
  node,
  base,
  theme,
}: {
  node: TreemapNodeView;
  base: string;
  theme: "light" | "dark";
}) {
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const width = node.width ?? 0;
  const height = node.height ?? 0;
  const name = node.name ?? "";
  const value = node.value ?? 0;
  if (width < 1 || height < 1) return <g />;

  // A node with children is a CATEGORY container: its subcategory cells tile
  // it completely, so we only draw a thicker frame to group them visually.
  const kids = node.children;
  if (Array.isArray(kids) && kids.length > 0) {
    return (
      <rect
        x={Math.round(x)}
        y={Math.round(y)}
        width={Math.round(width)}
        height={Math.round(height)}
        rx={5}
        fill="none"
        stroke="rgb(var(--c-bg))"
        strokeWidth={3.5}
      />
    );
  }

  // Leaf cell — a subcategory, or a category without subcategories.
  const fill = node.color || "#22D3EE";
  const textColor = readableTextOn(fill, theme);
  const subColor =
    textColor === "#FFFFFF" ? "rgba(255,255,255,0.78)" : "rgba(11,17,32,0.72)";

  // Compact, more uniform tiering. Earlier 13/12/11 sizes made bigger
  // cells feel "shouty" and inconsistent with neighbours; this scheme
  // keeps the spread inside a tight 11/10/9 band so the label visually
  // anchors the cell without dominating it.
  const tier =
    width >= 140 && height >= 60
      ? "lg"
      : width >= 80 && height >= 40
        ? "md"
        : width >= 40 && height >= 24
          ? "sm"
          : "xs";

  const titleSize = tier === "lg" ? 11 : tier === "md" ? 11 : tier === "sm" ? 10 : 9;
  const charPx = titleSize * 0.55;
  const padX = tier === "xs" ? 4 : 6;
  const maxChars = Math.max(1, Math.floor((width - padX * 2) / charPx));
  const label = truncateToWidth(name, maxChars);

  const showAmount = tier !== "xs" && height >= titleSize * 2 + 6;
  const amountText = formatMoney(value, base, { compact: true });
  const amountSize = tier === "lg" ? 10 : 10;
  const amountChars = Math.max(1, Math.floor((width - padX * 2) / (amountSize * 0.55)));
  const amount = truncateToWidth(amountText, amountChars);

  // Round all SVG coordinates to whole pixels. Recharts gives us floats
  // from its layout pass; combined with the body-level
  // `text-rendering: optimizeLegibility`, sub-pixel anchors produce a
  // ghosted / haloed look on `<text>` elements ("each glyph rendered with
  // a faint outline"). Snapping to integer pixels makes glyphs land on
  // exact device pixels and removes the artefact.
  const rx = Math.round(x);
  const ry = Math.round(y);
  const rw = Math.round(width);
  const rh = Math.round(height);
  const titleX = Math.round(rx + padX);
  const titleY = Math.round(ry + titleSize + 4);
  const amountX = titleX;
  const amountY = Math.round(ry + titleSize + amountSize + 8);

  // Common SVG-text props that:
  //   • disable inherited `stroke` (Recharts can propagate the parent
  //     <Treemap stroke> to children — would draw a 2px outline AROUND
  //     each glyph, the second source of the "double-rendered" look);
  //   • switch text-rendering to `geometricPrecision` so SVG ignores the
  //     body's `optimizeLegibility` that triggers fractional-pixel
  //     anti-aliasing inside <text>.
  const textBase = {
    stroke: "none",
    style: {
      pointerEvents: "none" as const,
      textRendering: "geometricPrecision" as const,
    },
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  };

  return (
    <g style={{ cursor: "pointer" }}>
      <rect
        x={rx}
        y={ry}
        width={rw}
        height={rh}
        rx={3}
        fill={fill}
        stroke="rgb(var(--c-bg))"
        strokeWidth={2}
      />
      <text
        x={titleX}
        y={titleY}
        fill={textColor}
        fontSize={titleSize}
        fontWeight={500}
        {...textBase}
      >
        {label}
      </text>
      {showAmount && (
        <text
          x={amountX}
          y={amountY}
          fill={subColor}
          fontSize={amountSize}
          {...textBase}
        >
          {amount}
        </text>
      )}
    </g>
  );
}

type View = "rings" | "treemap" | "bars";

interface SubNode {
  name: string;
  fullName: string;
  total: number;
  count: number;
}
interface CategoryNode {
  name: string;
  total: number;
  count: number;
  subs: SubNode[];
}

function buildHierarchy(txs: Transaction[], kind: "expense" | "income"): CategoryNode[] {
  const map = new Map<string, CategoryNode>();
  for (const t of txs) {
    // For the expense view, include refunds (signed negative) so a
    // returned purchase shrinks the category's bar in the hierarchy.
    // Income view stays strict — refunds are not income.
    const include = kind === "expense" ? affectsExpense(t.kind) : t.kind === kind;
    if (!include) continue;
    const delta = kind === "expense" ? expenseDelta(t) : t.amountBase;
    let node = map.get(t.category);
    if (!node) {
      node = { name: t.category, total: 0, count: 0, subs: [] };
      map.set(t.category, node);
    }
    node.total += delta;
    node.count++;
    if (t.subcategory) {
      let sub = node.subs.find((s) => s.name === t.subcategory);
      if (!sub) {
        sub = { name: t.subcategory, fullName: t.categoryFull, total: 0, count: 0 };
        node.subs.push(sub);
      }
      sub.total += delta;
      sub.count++;
    }
  }
  for (const node of map.values()) {
    node.subs.sort((a, b) => b.total - a.total);
  }
  // Drop categories that fully cancel out (sum exactly 0); but keep
  // negative ones — those are a useful flag that "категория ушла
  // в минус из-за возвратов" and the user might want to look.
  return Array.from(map.values())
    .filter((n) => n.total !== 0)
    .sort((a, b) => b.total - a.total);
}

export function CategoriesPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const theme = useThemeStore((s) => s.resolved);
  const categoryMeta = useCategoryMetaStore((s) => s.meta);
  const metaLoaded = useCategoryMetaStore((s) => s.loaded);
  const hydrateMeta = useCategoryMetaStore((s) => s.hydrate);
  useEffect(() => {
    if (!metaLoaded) hydrateMeta();
  }, [metaLoaded, hydrateMeta]);
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);

  const [view, setView] = useState<View>("rings");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Bars view: how many previous periods feed the «среднее» baseline (Zenmoney
  // «Среднее за N месяцев»). Default 3.
  const [avgMonths, setAvgMonths] = useState<3 | 6 | 12>(3);

  const showDrill = useDrillStore((s) => s.show);

  const filtered = useMemo(() => applyFilters(transactions, filters, monthStartDay), [transactions, filters, monthStartDay]);
  const tree = useMemo(() => buildHierarchy(filtered, kind), [filtered, kind]);

  // Single source of truth for "what colour belongs to this category".
  // Donut / Treemap / Bars all consult this map. Zenmoney's
  // `tag.color` wins; otherwise a DETERMINISTIC colour from the name (shared
  // `colorForCategory`), so the same category matches every other page.
  const resolvedCategoryColors = useMemo(() => {
    const m: Record<string, string> = {};
    for (const node of tree) m[node.name] = colorForCategory(node.name, categoryMeta);
    return m;
  }, [tree, categoryMeta]);

  const totalAll = tree.reduce((s, n) => s + n.total, 0);

  // «Среднее за N мес» baseline (Bars view) — Zenmoney-style. Averages each
  // category's spend over the N periods immediately BEFORE the current window
  // (excluding the current one), so it reads as "your usual". Every other
  // filter (accounts / categories / currencies / search) is preserved.
  //
  // For the «month» preset the N periods are the N preceding report-months
  // (respecting monthStartDay). For other bounded presets they're the N
  // preceding windows of the same length. Open ranges («Всё» / open custom)
  // have no baseline → `comparable: false`.
  const avgComp = useMemo(() => {
    const maxDate = transactions.reduce((m, t) => (t.date > m ? t.date : m), "");
    const curRange =
      filters.preset === "custom"
        ? { from: filters.from, to: filters.to }
        : presetToRange(filters.preset, maxDate, filters.monthYM, monthStartDay);
    const empty = {
      comparable: false,
      cat: new Map<string, number>(),
      sub: new Map<string, number>(),
    };
    if (!curRange.from || !curRange.to) return empty;

    // Build the N previous windows.
    const windows: { from: string; to: string }[] = [];
    if (filters.preset === "month" && filters.monthYM) {
      for (let k = 1; k <= avgMonths; k++) {
        windows.push(periodRange(shiftPeriod(filters.monthYM, -k), monthStartDay));
      }
    } else {
      const fromD = new Date(curRange.from);
      const toD = new Date(curRange.to);
      const lenDays =
        Math.round((toD.getTime() - fromD.getTime()) / 86_400_000) + 1;
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      for (let k = 1; k <= avgMonths; k++) {
        const f = new Date(fromD);
        f.setDate(f.getDate() - lenDays * k);
        const t = new Date(toD);
        t.setDate(t.getDate() - lenDays * k);
        windows.push({ from: iso(f), to: iso(t) });
      }
    }

    // Sum each category/subcategory across all windows, then divide by N.
    const catSum = new Map<string, number>();
    const subSum = new Map<string, number>();
    for (const w of windows) {
      const wt = applyFilters(
        transactions,
        { ...filters, preset: "custom", from: w.from, to: w.to },
        monthStartDay
      );
      for (const n of buildHierarchy(wt, kind)) {
        catSum.set(n.name, (catSum.get(n.name) || 0) + n.total);
        for (const s of n.subs) {
          subSum.set(s.fullName, (subSum.get(s.fullName) || 0) + s.total);
        }
      }
    }
    const cat = new Map<string, number>();
    const sub = new Map<string, number>();
    for (const [k, v] of catSum) cat.set(k, v / avgMonths);
    for (const [k, v] of subSum) sub.set(k, v / avgMonths);
    return { comparable: true, cat, sub };
  }, [transactions, filters, monthStartDay, kind, avgMonths]);

  // «Отклонение» — ₽ or % of the N-month average (quick toggle in the header).
  const [devPct, setDevPct] = useState(false);

  // «Отклонение» pill — difference of the current period from the N-month
  // average (Zenmoney «выше/ниже среднего на N ₽»), shown either in ₽ or as a
  // percentage of the average. Colour is semantic: for expenses spending MORE
  // than usual is «bad» (red), less is «good» (green); income is the other way
  // round. A category with no baseline (brand-new, nothing in the prior
  // windows) reads as fully above average → «∞» in percent mode.
  function devPill(cur: number, avg: number | undefined) {
    if (!avgComp.comparable) return <span className="text-muted">—</span>;
    const base0 = avg ?? 0;
    const diff = cur - base0;
    if (Math.abs(diff) < 0.5) {
      return <span className="text-[0.85em] text-muted tabular-nums">≈ среднее</span>;
    }
    const up = diff > 0;
    const good = kind === "expense" ? !up : up;
    const cls = good ? "text-income bg-income/10" : "text-expense bg-expense/10";
    const label = devPct
      ? base0 >= 0.5
        ? formatPct(Math.abs(diff) / base0, 0)
        : "∞"
      : formatMoney(Math.abs(diff), base);
    return (
      <span
        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[0.85em] tabular-nums ${cls}`}
        title={up ? "Выше среднего" : "Ниже среднего"}
      >
        {up ? "▲" : "▼"} {label}
      </span>
    );
  }

  // Category lookup by name — shared by the «Все категории» bar tooltip and
  // the treemap tooltip below.
  const catByName = useMemo(() => {
    const m = new Map<string, CategoryNode>();
    for (const n of tree) m.set(n.name, n);
    return m;
  }, [tree]);

  // Treemap tooltip — info about the HOVERED cell itself: a subcategory shows
  // its share of the category; a category-level cell its share of the total.
  function renderTreemapTooltip(props: {
    active?: boolean;
    payload?: readonly {
      payload?: { name?: string; cat?: string; value?: number; level?: string };
    }[];
  }) {
    if (!props.active || !props.payload?.length) return null;
    const p = props.payload[0]?.payload;
    if (!p?.name) return null;
    const value = p.value ?? 0;
    const ofCategory = p.level === "sub" || p.level === "rem";
    const denom = ofCategory ? catByName.get(p.cat ?? "")?.total ?? 0 : totalAll;
    const share = denom ? value / denom : 0;
    return (
      <div className="rounded-lg border border-border bg-panel shadow-lg px-3 py-2 text-sm max-w-[260px]">
        <div className="font-medium">{p.name}</div>
        <div className="text-muted">
          {formatMoney(value, base)} ({formatPct(share, 1)}
          {ofCategory && p.level === "sub" ? ` от «${p.cat}»` : ""})
        </div>
      </div>
    );
  }

  // Fullscreen treemap (the «Карта категорий» can be cramped in the card).
  const [treemapFull, setTreemapFull] = useState(false);
  useEffect(() => {
    if (!treemapFull) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTreemapFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [treemapFull]);

  function onTreemapClick(node: { fullName?: string; cat?: string; name?: string } | undefined) {
    if (node?.fullName) openSubcategory(node.fullName);
    else if (node?.cat) openCategory(node.cat);
    else if (node?.name) openCategory(node.name);
  }

  function renderTreemap() {
    return (
      <ResponsiveContainer>
        <Treemap
          data={treemapData}
          dataKey="value"
          stroke="rgb(var(--c-bg))"
          isAnimationActive={false}
          onClick={(node: { fullName?: string; cat?: string; name?: string }) =>
            onTreemapClick(node)
          }
          content={(node: TreemapNodeView) => (
            <TreemapCell node={node} base={base} theme={theme} />
          )}
        >
          <Tooltip
            content={renderTreemapTooltip}
            isAnimationActive={false}
            wrapperStyle={{ zIndex: 50 }}
          />
        </Treemap>
      </ResponsiveContainer>
    );
  }

  // Treemap «Карта категорий»: nested — categories subdivided into their
  // subcategory cells (opaque shades of the parent colour) + a «без
  // подкатегории» remainder. Categories without subs stay single cells.
  // Plain computation (no useMemo) — the React Compiler auto-memoizes it, and
  // a manual memo around the helper call can't be statically preserved.
  const treemapData = tree
    .filter((n) => n.total > 0)
    .slice(0, TREEMAP_CATS)
    .map((n) => buildTreemapNode(n, resolvedCategoryColors[n.name] || COLORS[0], categoryMeta));

  function openCategory(name: string) {
    // When drilling into an expense category, also show refunds tagged
    // with that category — they're what shrank the total the user just
    // clicked on, so it'd be confusing to hide them.
    const matches = (t: Transaction) =>
      (kind === "expense" ? affectsExpense(t.kind) : t.kind === kind) && t.category === name;
    const txs = filtered.filter(matches);
    showDrill(name, txs, kind === "expense" ? "Расходы по категории" : "Доходы по категории");
  }
  function openSubcategory(fullName: string) {
    const matches = (t: Transaction) =>
      (kind === "expense" ? affectsExpense(t.kind) : t.kind === kind) &&
      t.categoryFull === fullName;
    const txs = filtered.filter(matches);
    showDrill(
      fullName,
      txs,
      kind === "expense" ? "Расходы по подкатегории" : "Доходы по подкатегории"
    );
  }
  function toggleExpand(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }
  function expandAll() {
    setExpanded(new Set(tree.filter((n) => n.subs.length > 0).map((n) => n.name)));
  }
  function collapseAll() {
    setExpanded(new Set());
  }

  if (transactions.length === 0) return <EmptyState />;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={PieChartIcon}
        title="Категории"
        hint="Данные и аналитика с разбивкой по категориям и подкатегориям. Клик по элементу — список операций."
        right={
          <div className="flex flex-wrap gap-2">
            <div className="flex bg-panel2 rounded-lg p-1 border border-border">
              <button
                onClick={() => setView("rings")}
                className={`px-3 py-1 text-xs rounded-md ${view === "rings" ? "bg-accent text-accent-fg" : "text-muted"}`}
              >
                Donut
              </button>
              <button
                onClick={() => setView("bars")}
                className={`px-3 py-1 text-xs rounded-md ${view === "bars" ? "bg-accent text-accent-fg" : "text-muted"}`}
              >
                Bars
              </button>
              <button
                onClick={() => setView("treemap")}
                className={`px-3 py-1 text-xs rounded-md ${view === "treemap" ? "bg-accent text-accent-fg" : "text-muted"}`}
              >
                Treemap
              </button>
            </div>
          </div>
        }
      />
      <GlobalFilters />

      <div>
        <div className="card card-pad">
          {/* Shared header for the Treemap / Bars views — mirrors the Donut's
              own header (kind badge + scope + big total) so all three read as
              one family. Donut carries its own header, so this is hidden there. */}
          {view !== "rings" && (
            <div className="mb-4 flex items-start justify-between gap-2">
              <div>
                <div className="mb-4">
                  <KindSwitcher kind={kind} onChange={setKind} />
                </div>
                <div>
                  <span
                    className={`inline-flex px-4 py-1 rounded-full text-3xl font-bold tabular-nums ${
                      kind === "expense" ? "bg-expense/15 text-expense" : "bg-income/15 text-income"
                    }`}
                  >
                    {formatMoney(totalAll, base)}
                  </span>
                </div>
              </div>
              {view === "treemap" && (
                <button
                  onClick={() => setTreemapFull(true)}
                  className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent shrink-0 mt-1"
                  title="Открыть на весь экран"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  На весь экран
                </button>
              )}
              {view === "bars" && (
                <label className="shrink-0 mt-1 inline-flex items-center gap-2 text-xs text-muted">
                  Сравнить со средним за
                  <select
                    value={avgMonths}
                    onChange={(e) =>
                      setAvgMonths(Number(e.target.value) as 3 | 6 | 12)
                    }
                    className="input text-xs py-1 px-2 w-auto"
                    title="Сколько предыдущих месяцев усреднять для базовой линии"
                  >
                    <option value={3}>3 мес</option>
                    <option value={6}>6 мес</option>
                    <option value={12}>12 мес</option>
                  </select>
                </label>
              )}
            </div>
          )}
          {view === "rings" && (
            <CategorySunburst
              data={tree}
              meta={categoryMeta}
              base={base}
              kind={kind}
              onKindChange={setKind}
              onOpenCategory={openCategory}
              onOpenSubcategory={openSubcategory}
            />
          )}
          {view === "treemap" && (
            <div className="h-[450px] relative">{renderTreemap()}</div>
          )}
          {view === "bars" && (
            <div
              className="pr-1"
              // Show EVERY category with spend/income — no inner scrollbar, the
              // page scrolls instead (issue #34). Obeys the «Размер текста в
              // таблицах» slider like the operation tables.
              style={{ fontSize: "var(--tbl-font)" }}
            >
              {/* Column header — same shape & widths as the Donut legend so the
                  two views feel identical. */}
              <div className="bg-panel flex items-center gap-2 px-1.5 pb-1 mb-1 border-b border-border text-[0.85em] text-muted uppercase tracking-wide">
                <span className="flex-1 min-w-0">Категория</span>
                <span className="w-14 text-left shrink-0">%</span>
                <span className="w-20 text-left shrink-0">Операции</span>
                <span className="w-28 text-left shrink-0">Сумма</span>
                <span
                  className="w-28 text-left shrink-0"
                  title={`Средний расход по категории за ${avgMonths} предыдущих ${avgMonths === 3 ? "месяца" : "месяцев"} (без текущего)`}
                >
                  Среднее
                </span>
                <button
                  onClick={() => setDevPct((v) => !v)}
                  className="w-28 text-left shrink-0 uppercase tracking-wide text-muted hover:text-accent inline-flex items-center gap-1"
                  title="Насколько текущий период выше/ниже среднего. Клик — переключить ₽ / %"
                >
                  Отклонение
                  <span className="normal-case rounded bg-panel2 px-1 text-[0.9em] leading-none text-text">
                    {devPct ? "%" : "₽"}
                  </span>
                </button>
                <span className="w-8 shrink-0 flex items-center justify-center">
                  {(() => {
                    const expandable = tree.filter((n) => n.subs.some((s) => s.total > 0));
                    if (expandable.length === 0) return null;
                    const allExpanded = expandable.every((n) => expanded.has(n.name));
                    return (
                      <button
                        onClick={() => (allExpanded ? collapseAll() : expandAll())}
                        title={allExpanded ? "Свернуть все" : "Развернуть все"}
                        aria-label={allExpanded ? "Свернуть все" : "Развернуть все"}
                        className="-m-1 p-1 rounded-md text-muted hover:text-accent hover:bg-panel2"
                      >
                        <ChevronDown
                          className={`w-4 h-4 transition-transform duration-300 ${
                            allExpanded ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                    );
                  })()}
                </span>
              </div>
              <div className="space-y-0.5">
                {tree.map((node) => {
                  const color = resolvedCategoryColors[node.name] || COLORS[0];
                  const isOpen = expanded.has(node.name);
                  const hasSubs = node.subs.some((s) => s.total > 0);
                  // Bars are scaled to the largest CURRENT category, so the top
                  // bar fills the track and lengths read as proportional. The
                  // average marker clamps to the right edge when it's off-scale
                  // (its exact value stays in the tooltip) — otherwise a single
                  // big average value would squash every bar.
                  const maxTotal = tree[0]?.total || 1;
                  const barPct = Math.max(0, (node.total / maxTotal) * 100);
                  const avgCat = avgComp.cat.get(node.name);
                  return (
                    <div key={node.name}>
                      <div
                        className="flex items-center gap-2 px-1.5 py-1.5 rounded-md hover:bg-panel2/50 cursor-pointer"
                        onClick={() => openCategory(node.name)}
                      >
                        <CategoryDot category={node.name} size="w-7 h-7" />
                        <div className="flex-1 min-w-0">
                          <div className="truncate" title={node.name}>
                            {node.name}
                          </div>
                          <div className="relative h-2 mt-1 mr-3">
                            <div className="absolute inset-0 bg-panel2 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${barPct}%`, background: color }}
                              />
                            </div>
                            {avgComp.comparable && avgCat !== undefined && avgCat > 0 && (
                              <div
                                className="absolute top-1/2 -translate-y-1/2 w-0 border-l-2 border-solid border-text/80"
                                style={{
                                  left: `${Math.min(100, (avgCat / maxTotal) * 100)}%`,
                                  height: "200%",
                                }}
                                title={`Среднее за ${avgMonths} мес: ${formatMoney(avgCat, base)}`}
                              />
                            )}
                          </div>
                        </div>
                        <span className="w-14 text-left tabular-nums shrink-0">
                          {formatPct(node.total / totalAll, 1)}
                        </span>
                        <span className="w-20 text-left tabular-nums shrink-0">
                          {node.count}
                        </span>
                        <span className="w-28 text-left tabular-nums shrink-0">
                          {formatMoney(node.total, base)}
                        </span>
                        <span className="w-28 text-left text-muted tabular-nums shrink-0">
                          {avgComp.comparable && avgCat !== undefined
                            ? formatMoney(avgCat, base)
                            : "—"}
                        </span>
                        <span className="w-28 text-left shrink-0">
                          {devPill(node.total, avgCat)}
                        </span>
                        <span className="w-8 shrink-0 flex items-center justify-center">
                          {hasSubs && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpand(node.name);
                              }}
                              className="p-1 rounded-md text-muted hover:text-accent hover:bg-panel2"
                              title={isOpen ? "Свернуть" : "Подкатегории"}
                            >
                              {isOpen ? (
                                <ChevronDown className="w-5 h-5" />
                              ) : (
                                <ChevronRight className="w-5 h-5" />
                              )}
                            </button>
                          )}
                        </span>
                      </div>

                      {isOpen && hasSubs && (
                        <div
                          className="mb-2 space-y-0.5"
                          style={{ marginLeft: "19px", borderLeft: `3px solid ${color}` }}
                        >
                          {node.subs
                            .filter((s) => s.total > 0)
                            .map((sub, idx) => {
                              const own = subcategoryColor(sub.fullName, categoryMeta);
                              const subColor = own || color;
                              const subOpacity = own ? 1 : Math.max(0.4, 1 - idx * 0.12);
                              return (
                                <div
                                  key={sub.fullName}
                                  className="flex items-center gap-2 pl-2 pr-1.5 py-1.5 rounded-md hover:bg-panel2/50 cursor-pointer"
                                  onClick={() => openSubcategory(sub.fullName)}
                                >
                                  {/* Icon badge (own icon/colour, else the parent's);
                                      the coloured rail groups these rows as children. */}
                                  <span className="shrink-0">
                                    <CategoryDot
                                      category={sub.name}
                                      parent={node.name}
                                      fallback={subColor}
                                      size="w-6 h-6"
                                    />
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <div className="truncate text-muted">{sub.name}</div>
                                    <div className="relative h-1.5 mt-1 mr-3">
                                      <div className="absolute inset-0 bg-panel2 rounded-full overflow-hidden">
                                        <div
                                          className="h-full rounded-full"
                                          style={{
                                            width: `${Math.max(0, (sub.total / maxTotal) * 100)}%`,
                                            background: subColor,
                                            opacity: subOpacity,
                                          }}
                                        />
                                      </div>
                                      {(() => {
                                        const avgSub = avgComp.sub.get(sub.fullName);
                                        if (!avgComp.comparable || avgSub === undefined || avgSub <= 0)
                                          return null;
                                        return (
                                          <div
                                            className="absolute top-1/2 -translate-y-1/2 w-0 border-l-2 border-solid border-text/70"
                                            style={{
                                              left: `${Math.min(100, (avgSub / maxTotal) * 100)}%`,
                                              height: "200%",
                                            }}
                                            title={`Среднее за ${avgMonths} мес: ${formatMoney(avgSub, base)}`}
                                          />
                                        );
                                      })()}
                                    </div>
                                  </div>
                                  <span className="w-14 text-left text-muted tabular-nums shrink-0">
                                    {formatPct(sub.total / totalAll, 1)}
                                  </span>
                                  <span className="w-20 text-left text-muted tabular-nums shrink-0">
                                    {sub.count}
                                  </span>
                                  <span className="w-28 text-left text-muted tabular-nums shrink-0">
                                    {formatMoney(sub.total, base)}
                                  </span>
                                  <span className="w-28 text-left text-muted tabular-nums shrink-0">
                                    {avgComp.comparable && avgComp.sub.has(sub.fullName)
                                      ? formatMoney(avgComp.sub.get(sub.fullName)!, base)
                                      : "—"}
                                  </span>
                                  <span className="w-28 text-left shrink-0">
                                    {devPill(sub.total, avgComp.sub.get(sub.fullName))}
                                  </span>
                                  <span className="w-8 shrink-0" />
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {treemapFull &&
        createPortal(
          <div className="fixed inset-0 z-[90] bg-panel flex flex-col p-4">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <div className="font-semibold">
                Карта категорий
                <span className="text-muted font-normal text-sm ml-2">
                  {kind === "expense" ? "расходы" : "доходы"} · {formatMoney(totalAll, base)}
                </span>
              </div>
              <button
                onClick={() => setTreemapFull(false)}
                className="btn-ghost text-sm"
                title="Закрыть (Esc)"
              >
                <X className="w-4 h-4" />
                Закрыть
              </button>
            </div>
            <div className="flex-1 min-h-0">{renderTreemap()}</div>
          </div>,
          document.body
        )}
    </div>
  );
}
