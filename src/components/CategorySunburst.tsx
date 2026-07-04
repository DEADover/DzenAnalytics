import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ArrowLeft, ChartPie, type LucideIcon } from "lucide-react";
import { formatMoney, formatPct } from "../lib/format";
import { colorForCategory, subcategoryColor } from "../lib/categoryColor";
import { zenIconToLucide } from "../lib/zenIconLucide";
import { pluralOps } from "../lib/plural";
import { useDrillStore } from "../store/useDrillStore";
import { CategoryDot } from "./CategoryDot";
import { KindSwitcher } from "./KindSwitcher";

// A Budgera-style two-ring category donut: the inner ring is the top-level
// categories (each with its glyph), the outer thin ring breaks every category
// into its subcategories. Hovering focuses one slice (the rest dims); clicking
// a category drills the donut INTO it (one category split into its subs) with a
// «Назад» step. A rich legend on the right mirrors the rings — category rows
// expand inline to their subcategories, and hovering a row lights up its slice.
//
// Pure SVG (Recharts can't host glyphs inside sectors or two interactive rings
// cleanly). Colours and glyphs come from the same `categoryMeta` every other
// chart reads, so a slice here always matches its dot elsewhere.

export interface SunburstSub {
  name: string;
  fullName: string;
  total: number;
  count: number;
}
export interface SunburstCat {
  name: string;
  total: number;
  count: number;
  subs: SunburstSub[];
}

type Meta = Record<string, { color?: string | null; icon?: string | null } | undefined>;

interface Props {
  data: SunburstCat[];
  meta: Meta;
  base: string;
  kind: "expense" | "income";
  /** Toggle expense/income — drives the in-header «Расходы/Доходы» slider. */
  onKindChange: (k: "expense" | "income") => void;
  /** Open the transactions list for a whole category. */
  onOpenCategory: (name: string) => void;
  /** Open the transactions list for a subcategory (full «Parent / Sub» path). */
  onOpenSubcategory: (fullName: string) => void;
}

// ── SVG geometry (viewBox 0 0 320 320, scaled by CSS) ──────────────────────
const CX = 160;
const CY = 160;
const TAU = Math.PI * 2;
const GAP = 0.012; // radians of breathing room between category slices

// Inner ring = categories, outer thin ring = subcategories.
const CAT_R0 = 74;
const CAT_R1 = 120;
const SUB_R0 = 123;
const SUB_R1 = 139;
const ICON_R = (CAT_R0 + CAT_R1) / 2;

function pt(r: number, a: number): [number, number] {
  // angle measured clockwise from 12 o'clock
  return [CX + r * Math.sin(a), CY - r * Math.cos(a)];
}

/** Ring-segment path from angle a0→a1 (clockwise) between radii ri..ro. */
function arc(a0: number, a1: number, ri: number, ro: number): string {
  const [x0, y0] = pt(ro, a0);
  const [x1, y1] = pt(ro, a1);
  const [x2, y2] = pt(ri, a1);
  const [x3, y3] = pt(ri, a0);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0} ${y0}A${ro} ${ro} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${ri} ${ri} 0 ${large} 0 ${x3} ${y3}Z`;
}

export function CategorySunburst({
  data,
  meta,
  base,
  kind,
  onKindChange,
  onOpenCategory,
  onOpenSubcategory,
}: Props) {
  const [drill, setDrill] = useState<string | null>(null);
  // Which direction the ring last moved — drives the zoom-in / zoom-out
  // animation (replayed by re-keying the <svg> on every level change).
  const [anim, setAnim] = useState<"in" | "out">("in");
  const drillInto = (name: string) => {
    setAnim("in");
    setDrill(name);
  };
  const drillOut = () => {
    setAnim("out");
    setDrill(null);
  };
  // Esc pops back up one level — but only while drilled, and only when nothing
  // else owns Esc: an open drawer closes itself, and a focused input (command
  // palette, filter search) keeps its own Escape.
  useEffect(() => {
    if (!drill) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (useDrillStore.getState().open) return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable))
        return;
      e.preventDefault();
      setAnim("out");
      setDrill(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drill]);
  // What the pointer is over: a category, or a specific subcategory.
  const [hover, setHover] = useState<{ cat: string; sub?: string } | null>(null);
  // Pointer over the centre hole (while drilled it's the «back» target).
  const [hoverCenter, setHoverCenter] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const cats = useMemo(() => data.filter((c) => c.total > 0), [data]);
  const total = useMemo(() => cats.reduce((s, c) => s + c.total, 0), [cats]);
  const totalCount = useMemo(() => cats.reduce((s, c) => s + c.count, 0), [cats]);

  const kindWord = kind === "expense" ? "Расходы" : "Доходы";

  // The drilled category, only while it still exists in the data.
  const drillNode = drill ? cats.find((c) => c.name === drill) ?? null : null;
  const effectiveDrill = drillNode ? drill : null;

  const color = (name: string) => colorForCategory(name, meta);

  // ── Slice geometry ────────────────────────────────────────────────────
  interface Slice {
    key: string;
    cat: string;
    sub?: string;
    fullName?: string;
    label: string;
    value: number;
    fill: string;
    opacity: number;
    ri: number;
    ro: number;
    a0: number;
    a1: number;
    Icon?: LucideIcon | null;
  }

  const slices = useMemo<Slice[]>(() => {
    const out: Slice[] = [];
    if (total <= 0) return out;

    if (effectiveDrill && drillNode) {
      // Drilled: outer solid band = the category itself, inner ring = its subs.
      const c = color(drillNode.name);
      out.push({
        key: `__cat`,
        cat: drillNode.name,
        label: drillNode.name,
        value: drillNode.total,
        fill: c,
        opacity: 1,
        ri: SUB_R0,
        ro: SUB_R1,
        a0: 0,
        a1: TAU,
        Icon: zenIconToLucide(meta[drillNode.name]?.icon),
      });
      const posSubs = drillNode.subs.filter((s) => s.total > 0);
      const subSum = posSubs.reduce((s, x) => s + x.total, 0);
      let a = 0;
      posSubs.forEach((sub, idx) => {
        const span = (sub.total / drillNode.total) * TAU;
        const own = subcategoryColor(sub.fullName, meta);
        out.push({
          key: sub.fullName,
          cat: drillNode.name,
          sub: sub.name,
          fullName: sub.fullName,
          label: sub.name,
          value: sub.total,
          fill: own || c,
          opacity: own ? 1 : Math.max(0.4, 1 - idx * 0.13),
          ri: CAT_R0,
          ro: CAT_R1,
          a0: a + GAP / 2,
          a1: a + span - GAP / 2,
          Icon: zenIconToLucide(meta[sub.fullName]?.icon),
        });
        a += span;
      });
      const rem = drillNode.total - subSum;
      if (rem > 0.0001) {
        const span = (rem / drillNode.total) * TAU;
        out.push({
          key: "__rem",
          cat: drillNode.name,
          label: "Без подкатегории",
          value: rem,
          fill: c,
          opacity: 0.28,
          ri: CAT_R0,
          ro: CAT_R1,
          a0: a + GAP / 2,
          a1: a + span - GAP / 2,
        });
      }
      return out;
    }

    // Top level: inner ring = categories, outer ring = their subcategories.
    let a = 0;
    for (const c of cats) {
      const span = (c.total / total) * TAU;
      const ca = color(c.name);
      out.push({
        key: c.name,
        cat: c.name,
        label: c.name,
        value: c.total,
        fill: ca,
        opacity: 1,
        ri: CAT_R0,
        ro: CAT_R1,
        a0: a + GAP / 2,
        a1: a + span - GAP / 2,
        Icon: zenIconToLucide(meta[c.name]?.icon),
      });
      // Outer subcategory band, subdivided within this category's own span.
      const posSubs = c.subs.filter((s) => s.total > 0);
      let sa = a;
      posSubs.forEach((sub, idx) => {
        const sspan = (sub.total / c.total) * span;
        const own = subcategoryColor(sub.fullName, meta);
        out.push({
          key: `${c.name}/${sub.name}`,
          cat: c.name,
          sub: sub.name,
          fullName: sub.fullName,
          label: sub.name,
          value: sub.total,
          fill: own || ca,
          opacity: own ? 1 : Math.max(0.4, 1 - idx * 0.12),
          ri: SUB_R0,
          ro: SUB_R1,
          a0: sa + GAP / 4,
          a1: sa + sspan - GAP / 4,
        });
        sa += sspan;
      });
      a += span;
    }
    return out;
  }, [cats, total, effectiveDrill, drillNode, meta]); // eslint-disable-line react-hooks/exhaustive-deps

  const isDim = (s: Slice) => {
    if (!hover) return false;
    if (hover.sub) return !(s.cat === hover.cat && s.sub === hover.sub);
    return s.cat !== hover.cat;
  };

  function clickSlice(s: Slice) {
    if (s.fullName) {
      onOpenSubcategory(s.fullName);
    } else if (effectiveDrill) {
      onOpenCategory(s.cat);
    } else {
      const node = cats.find((c) => c.name === s.cat);
      if (node && node.subs.some((x) => x.total > 0)) drillInto(s.cat);
      else onOpenCategory(s.cat);
    }
  }

  // Centre label reflects what's hovered, else the drilled category, else all.
  // Always carries the count + share-of-total so the hole shows both.
  const centre = (() => {
    if (hover) {
      const cat = cats.find((c) => c.name === hover.cat);
      if (cat) {
        if (hover.sub) {
          const sub = cat.subs.find((s) => s.name === hover.sub);
          if (sub)
            return { name: sub.name, value: sub.total, count: sub.count, pct: sub.total / total };
        }
        return { name: cat.name, value: cat.total, count: cat.count, pct: cat.total / total };
      }
    }
    if (drillNode)
      return {
        name: drillNode.name,
        value: drillNode.total,
        count: drillNode.count,
        pct: drillNode.total / total,
      };
    return { name: `Все ${kindWord.toLowerCase()}`, value: total, count: totalCount, pct: 1 };
  })();

  // No data for the current period / filters — a calm, friendly placeholder
  // instead of an empty ring.
  if (cats.length === 0) {
    return (
      <div>
        {/* Keep the slider reachable with no data, so the user can switch back
            to the kind that DOES have operations. */}
        <KindSwitcher kind={kind} onChange={onKindChange} />
        <div className="flex flex-col items-center justify-center text-center gap-3 py-16 text-muted">
          <span className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-panel2">
            <ChartPie className="w-8 h-8 opacity-50" />
          </span>
          <div className="text-base font-medium text-text">
            Нет {kind === "expense" ? "расходов" : "доходов"} за выбранный период
          </div>
          <div className="text-sm max-w-sm">
            Измените период или фильтры сверху — и здесь появится разбивка по
            категориям.
          </div>
        </div>
      </div>
    );
  }

  // «Развернуть все» (top level only): expand / collapse every category that
  // has subcategories at once — mirrors the Bars view.
  const expandableCats = cats.filter((c) => c.subs.some((s) => s.total > 0));
  const allCatsOpen =
    expandableCats.length > 0 && expandableCats.every((c) => expanded.has(c.name));

  return (
    <div className="flex flex-col md:flex-row-reverse gap-8 items-start">
      {/* ── Donut (right on desktop, on top when stacked) ──────────────── */}
      {/* Grows to fill the space freed by the narrow table; the ring itself is
          capped and centred so it stays a sensible size on very wide screens.
          On desktop it's STICKY and vertically centred in the viewport, so it
          stays on screen while the (now un-scrolled, full) legend scrolls past
          — issue #34. `top`/height leave room for the sticky top nav. */}
      <div className="w-full md:flex-1 md:min-w-0 md:self-stretch">
        {/* Donut is STICKY just under the top nav (73px + gap), so it stays on
            screen while the full (un-scrolled) legend scrolls past — issue #34.
            The column stretches to the legend's height, which is what gives the
            sticky element its scroll range; kept at the donut's natural height
            (not viewport-tall) so it adds no empty space and the range isn't
            eaten up. It engages once the category list is taller than the donut. */}
        <div className="flex justify-center md:mt-2 md:sticky md:top-[88px]">
          <div
            className="relative w-full mx-auto"
            style={{ maxWidth: 620 }}
          >
        <svg
          key={effectiveDrill ?? "__top"}
          viewBox="0 0 320 320"
          className={`w-full h-auto select-none ${
            anim === "in" ? "animate-donut-in" : "animate-donut-out"
          }`}
        >
          {/* Centre hit area — drilled: pops back to all categories. */}
          {effectiveDrill && (
            <circle
              cx={CX}
              cy={CY}
              r={CAT_R0 - 4}
              fill="transparent"
              style={{ cursor: "pointer" }}
              onClick={() => drillOut()}
              onMouseEnter={() => setHoverCenter(true)}
              onMouseLeave={() => setHoverCenter(false)}
            >
              <title>Назад</title>
            </circle>
          )}
          {slices.map((s) => {
            const dim = isDim(s);
            const mid = (s.a0 + s.a1) / 2;
            const big = s.a1 - s.a0 > 0.34;
            const [gx, gy] = pt(ICON_R, mid);
            const isInnerCat = s.ri === CAT_R0 && !s.sub;
            return (
              <g
                key={s.key}
                onMouseEnter={() => setHover({ cat: s.cat, sub: s.sub })}
                onMouseLeave={() => setHover(null)}
                onClick={() => clickSlice(s)}
                style={{ cursor: "pointer" }}
              >
                <path
                  d={arc(s.a0, s.a1, s.ri, s.ro)}
                  fill={s.fill}
                  fillOpacity={(dim ? 0.18 : 1) * s.opacity}
                  stroke="rgb(var(--c-bg))"
                  strokeWidth={1}
                  style={{ transition: "fill-opacity 120ms" }}
                />
                {isInnerCat && big && !effectiveDrill && s.Icon && (
                  <s.Icon
                    x={gx - 9}
                    y={gy - 9}
                    size={18}
                    color="#fff"
                    strokeWidth={2.25}
                    opacity={dim ? 0.25 : 1}
                    style={{ pointerEvents: "none" }}
                  />
                )}
              </g>
            );
          })}
        </svg>
        {/* Centre hole label (non-interactive — the clickable hit area is the
            transparent circle inside the SVG above). Always shows the
            name / sum / count. */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center px-14">
            <div className="text-xs text-muted leading-tight line-clamp-2">{centre.name}</div>
            <div className="font-semibold tabular-nums text-lg mt-0.5">
              {formatMoney(centre.value, base)}
            </div>
            <div className="text-xs text-muted tabular-nums mt-0.5">
              {centre.count} {pluralOps(centre.count)} · {formatPct(centre.pct, 1)}
            </div>
          </div>
        </div>
        {/* «Назад» hint near the top of the hole — just the arrow (no label),
            shown while hovering the centre of a drilled ring; sits above the
            figures without covering them. */}
        {effectiveDrill && (
          <div
            className={`absolute left-1/2 -translate-x-1/2 top-[32%] pointer-events-none text-accent transition-opacity ${
              hoverCenter ? "opacity-100" : "opacity-70"
            }`}
          >
            <ArrowLeft className="w-6 h-6" strokeWidth={2.5} />
          </div>
        )}
          </div>
        </div>
      </div>

      {/* Vertical divider between the table and the donut — full-height via
          self-stretch, desktop only (hidden when the columns stack). */}
      <div className="hidden md:block md:self-stretch w-px bg-border" aria-hidden />

      {/* ── Legend ────────────────────────────────────────────────────── */}
      {/* Fixed, capped width pinned to the left — it does NOT grow, so all the
          freed horizontal space goes to the donut rather than to empty
          margins. */}
      <div className="w-full md:w-[576px] md:shrink-0 min-w-0 flex flex-col">
        {/* Just the «Расходы/Доходы» slider — no scope label. The donut centre
            already shows «Все расходы» / the drilled category name + total, so a
            breadcrumb here only repeats it. */}
        <div className="mb-4">
          <KindSwitcher kind={kind} onChange={onKindChange} />
        </div>
        <div className="mb-3">
          <span
            className={`inline-flex px-4 py-1 rounded-full text-3xl font-bold tabular-nums ${
              kind === "expense" ? "bg-expense/15 text-expense" : "bg-income/15 text-income"
            }`}
          >
            {formatMoney(drillNode ? drillNode.total : total, base)}
          </span>
        </div>

        {/* Every category is listed — no inner scrollbar, the page scrolls
            instead (issue #34). The donut on the other side is sticky-centred,
            so it stays in view while this long list scrolls. */}
        <div
          className="pr-1 flex flex-col"
          // Obeys the «Размер текста в таблицах» slider (rows inherit; sub-text
          // is em-relative), matching the Bars view and operation tables.
          style={{ fontSize: "var(--tbl-font)" }}
        >
          <div className="shrink-0 bg-panel flex items-center gap-2 px-1.5 pb-1 mb-1 border-b border-border text-[0.85em] text-muted uppercase tracking-wide">
            <span className="flex-1 min-w-0">Категория</span>
            <span className="w-14 text-left shrink-0">%</span>
            <span className="w-20 text-left shrink-0">Операции</span>
            <span className="w-28 text-left shrink-0">Сумма</span>
            <span className="w-8 shrink-0 flex items-center justify-center">
              {!effectiveDrill && expandableCats.length > 0 && (
                <button
                  onClick={() =>
                    setExpanded(
                      allCatsOpen ? new Set() : new Set(expandableCats.map((c) => c.name))
                    )
                  }
                  title={allCatsOpen ? "Свернуть все" : "Развернуть все"}
                  aria-label={allCatsOpen ? "Свернуть все" : "Развернуть все"}
                  className="-m-1 p-1 rounded-md text-muted hover:text-accent hover:bg-panel2"
                >
                  <ChevronDown
                    className={`w-4 h-4 transition-transform duration-300 ${
                      allCatsOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
              )}
            </span>
          </div>
          <div className="shrink-0 space-y-0.5 animate-fade" key={effectiveDrill ?? "__top"}>
          {(effectiveDrill && drillNode ? [drillNode] : cats).map((c) => {
            const posSubs = c.subs.filter((s) => s.total > 0);
            const open = effectiveDrill ? true : expanded.has(c.name);
            const cc = color(c.name);
            return (
              <div key={c.name}>
                <div
                  className={`flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-panel2/50 cursor-pointer ${
                    hover?.cat === c.name ? "bg-panel2/50" : ""
                  }`}
                  onMouseEnter={() => setHover({ cat: c.name })}
                  onMouseLeave={() => setHover(null)}
                  onClick={() =>
                    effectiveDrill
                      ? onOpenCategory(c.name)
                      : posSubs.length
                        ? drillInto(c.name)
                        : onOpenCategory(c.name)
                  }
                >
                  <CategoryDot category={c.name} size="w-7 h-7" />
                  <span className="flex-1 min-w-0 truncate">{c.name}</span>
                  <span className="w-14 text-left tabular-nums shrink-0">
                    {formatPct(c.total / total, 1)}
                  </span>
                  <span className="w-20 text-left tabular-nums shrink-0">
                    {c.count}
                  </span>
                  <span className="w-28 text-left tabular-nums shrink-0">
                    {formatMoney(c.total, base)}
                  </span>
                  {/* Chevron column — always reserved (invisible without subs)
                      so the amounts above stay aligned. */}
                  <span className="w-8 shrink-0 flex items-center justify-center">
                    {!effectiveDrill && posSubs.length > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpanded((prev) => {
                            const n = new Set(prev);
                            if (n.has(c.name)) n.delete(c.name);
                            else n.add(c.name);
                            return n;
                          });
                        }}
                        className="p-1 rounded-md text-muted hover:text-accent hover:bg-panel2"
                        title={open ? "Свернуть" : "Подкатегории"}
                      >
                        {open ? (
                          <ChevronDown className="w-5 h-5" />
                        ) : (
                          <ChevronRight className="w-5 h-5" />
                        )}
                      </button>
                    )}
                  </span>
                </div>
                {open && posSubs.length > 0 && (
                  <div
                    className="mb-2 space-y-0.5"
                    style={{ marginLeft: "19px", borderLeft: `3px solid ${cc}` }}
                  >
                    {posSubs.map((sub) => (
                      <div
                        key={sub.fullName}
                        className={`flex items-center gap-2 rounded-md pl-2 pr-1.5 py-1.5 hover:bg-panel2/50 cursor-pointer ${
                          hover?.cat === c.name && hover?.sub === sub.name
                            ? "bg-panel2/50"
                            : ""
                        }`}
                        onMouseEnter={() => setHover({ cat: c.name, sub: sub.name })}
                        onMouseLeave={() => setHover(null)}
                        onClick={() => onOpenSubcategory(sub.fullName)}
                      >
                        {/* Icon badge (own icon/colour, else the parent's). The
                            coloured rail on the left already groups these rows as
                            the category's children. */}
                        <span className="shrink-0">
                          <CategoryDot
                            category={sub.name}
                            parent={c.name}
                            fallback={cc}
                            size="w-6 h-6"
                          />
                        </span>
                        <span className="flex-1 min-w-0 truncate text-muted">
                          {sub.name}
                        </span>
                        <span className="w-14 text-left text-muted tabular-nums shrink-0">
                          {formatPct(sub.total / total, 1)}
                        </span>
                        <span className="w-20 text-left text-muted tabular-nums shrink-0">
                          {sub.count}
                        </span>
                        <span className="w-28 text-left text-muted tabular-nums shrink-0">
                          {formatMoney(sub.total, base)}
                        </span>
                        <span className="w-8 shrink-0" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          </div>
          {/* Empty area below the (often short) drilled list is a silent
              «back» target — clicking it pops up one level (mirrors Esc, the
              donut centre and the «Все категории» button below). No tooltip or
              hover tint: just a convenient extra hit area that grows to push the
              explicit button to the bottom. */}
          {effectiveDrill && (
            <button
              type="button"
              onClick={() => drillOut()}
              aria-label="Назад ко всем категориям"
              className="flex-1 min-h-[44px] w-full"
            />
          )}
          {/* Explicit «up one level» control — wide and understated, pinned to
              the bottom of the drilled list. Esc and the empty-area click above
              do the same thing. */}
          {effectiveDrill && (
            <button
              type="button"
              onClick={() => drillOut()}
              className="shrink-0 w-full flex items-center justify-center gap-1.5 py-2 rounded-md border border-border/50 text-[0.85em] text-muted hover:text-text hover:bg-panel2/50 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Все категории
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
