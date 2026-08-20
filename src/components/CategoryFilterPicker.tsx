import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { SURFACE_ATTR } from "./Popover";
import { ChevronDown, ChevronRight, Search } from "lucide-react";

// Narrow by default (just the categories + the one-line header); widens by
// SUB_W to the right when a category is expanded.
const MENU_BASE = 300;

/** Подписи разделителей в списке категорий. */
const KIND_LABELS = {
  expense: "Расходные",
  income: "Доходные",
  both: "И расход, и доход",
} as const;
const SUB_W = 190;
import clsx from "clsx";
import { FILTER_NONE } from "../store/useFiltersStore";
import { pluralRu } from "../lib/plural";
import { CategoryDot } from "./CategoryDot";

export interface CategoryNode {
  name: string;
  /** Тип категории в терминах Дзен-мани: расходная, доходная или обе сразу.
   *  Задаёт разделители в списке; `undefined` — тип неизвестен (режим CSV),
   *  такие категории идут без заголовка. */
  kind?: "expense" | "income" | "both";
  /** True when the category has «bare» transactions (tagged with just the
   *  parent, no sub) — a distinct leaf, toggled only via the parent checkbox. */
  hasBare: boolean;
  /** Sub-category titles (sorted). */
  subs: string[];
}

/**
 * Cascade MULTI-select for the global category filter: parent categories on the
 * left, the active parent's sub-categories on the right — same shape as the
 * edit-modal picker, with checkboxes (issue #9).
 *
 * Pure leaf model — selection keys equal `categoryFull` (empty = ALL,
 * `{FILTER_NONE}` = NONE):
 *   - the bare category «Еда» (its no-sub transactions) — a leaf only when the
 *     category actually has such transactions (`hasBare`);
 *   - each «Еда / Кафе».
 * Category and sub-category are independent: ticking a sub never selects the
 * parent's bare leaf, and vice-versa. The parent checkbox just bulk-toggles all
 * of the category's leaves.
 */
export function CategoryFilterPicker({
  nodes,
  selected,
  onChange,
  className,
}: {
  nodes: CategoryNode[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Extra classes for the outer wrapper (e.g. `flex-1` to fill a row). */
  className?: string;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // The expanded category (non-search): its subs slide out to the right.
  const [active, setActive] = useState<string | null>(null);
  const toggleActive = (name: string) =>
    setActive((prev) => (prev === name ? null : name));

  const isAll = selected.size === 0;
  const isNone = selected.has(FILTER_NONE);
  const subKey = (cat: string, sub: string) => `${cat} / ${sub}`;

  // Leaf keys of a category = its bare leaf (if any) + its sub leaves.
  const leavesOf = (n: CategoryNode) => [
    ...(n.hasBare ? [n.name] : []),
    ...n.subs.map((s) => subKey(n.name, s)),
  ];
  // eslint-disable-next-line react-hooks/exhaustive-deps -- leavesOf is pure of nodes
  const allLeaves = useMemo(() => nodes.flatMap(leavesOf), [nodes]);

  const leafChecked = (leaf: string) =>
    isAll || (!isNone && selected.has(leaf));
  // Resolve the ALL / NONE markers into a concrete leaf set.
  const effective = () =>
    isAll
      ? new Set(allLeaves)
      : isNone
        ? new Set<string>()
        : new Set([...selected].filter((x) => x !== FILTER_NONE));
  const commit = (eff: Set<string>) => {
    if (eff.size >= allLeaves.length) onChange(new Set()); // everything → ALL
    else if (eff.size === 0) onChange(new Set([FILTER_NONE]));
    else onChange(eff);
  };
  const toggleLeaf = (leaf: string) => {
    const eff = effective();
    if (eff.has(leaf)) eff.delete(leaf);
    else eff.add(leaf);
    commit(eff);
  };
  const toggleParent = (n: CategoryNode) => {
    const eff = effective();
    const leaves = leavesOf(n);
    const allOn = leaves.every((l) => eff.has(l));
    for (const l of leaves) {
      if (allOn) eff.delete(l);
      else eff.add(l);
    }
    commit(eff);
  };
  /** Отметить или снять сразу все листья — кнопка в заголовке типа. */
  const setMany = (leaves: string[], on: boolean) => {
    const eff = effective();
    for (const l of leaves) {
      if (on) eff.add(l);
      else eff.delete(l);
    }
    commit(eff);
  };

  const catState = (n: CategoryNode): "all" | "some" | "none" => {
    const leaves = leavesOf(n);
    const on = leaves.filter(leafChecked).length;
    return on === 0 ? "none" : on === leaves.length ? "all" : "some";
  };
  const subChecked = (n: CategoryNode, sub: string) =>
    leafChecked(subKey(n.name, sub));

  const subCount = nodes.reduce((s, n) => s + n.subs.length, 0);
  const total = nodes.length + subCount; // categories + sub-categories

  const summary = isNone
    ? "Ничего"
    : isAll
      ? `Все (${total})` // total incl. sub-categories
      : `${selected.size} из ${total}`;

  // Dropdown header — break it down: «N категорий и M подкатегорий».
  const totalLabel =
    `${nodes.length} ${pluralRu(nodes.length, ["категория", "категории", "категорий"])}` +
    ` и ${subCount} ${pluralRu(subCount, ["подкатегория", "подкатегории", "подкатегорий"])}`;

  const q = query.trim().toLowerCase();

  // While searching, a FLAT list of every matching leaf with its full path —
  // so identically-named subs in different parents («Животные / Кот»,
  // «Тест / Кот») are each directly toggleable, no hover/cascade needed.
  type SearchItem =
    | { key: string; kind: "cat"; node: CategoryNode }
    | { key: string; kind: "sub"; node: CategoryNode; sub: string };
  const searchResults = useMemo<SearchItem[] | null>(() => {
    if (!q) return null;
    const items: SearchItem[] = [];
    for (const n of nodes) {
      if (n.name.toLowerCase().includes(q))
        items.push({ key: `c:${n.name}`, kind: "cat", node: n });
      for (const s of n.subs) {
        if (s.toLowerCase().includes(q))
          items.push({ key: `s:${n.name}/${s}`, kind: "sub", node: n, sub: s });
      }
    }
    return items;
  }, [q, nodes]);

  const activeNode = useMemo(
    () => nodes.find((n) => n.name === active) ?? null,
    [nodes, active]
  );

  // Portal positioning — anchored to the button. Recomputed on scroll/resize so
  // the dropdown FOLLOWS the button instead of floating away (and closes only
  // when the button scrolls out of view). Repositioning rather than closing also
  // means a checkbox-focus scroll never dismisses the picker mid-selection.
  type MenuPos = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };
  const [pos, setPos] = useState<MenuPos | null>(null);
  const computePos = useCallback(() => {
    const el = btnRef.current;
    if (!open || !el) {
      setPos(null);
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) {
      setOpen(false);
      return;
    }
    // Grows to the right (by SUB_W) when a category is expanded.
    const wantW = MENU_BASE + (active ? SUB_W : 0);
    const width = Math.min(Math.max(r.width, wantW), window.innerWidth - 16);
    const estH = 400;
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const flipUp = above > below && above >= Math.min(estH, 48);
    let left = r.left;
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    if (left < 8) left = 8;
    setPos(
      flipUp
        ? { left, width, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(estH, above) }
        : { left, width, top: r.bottom + 4, maxHeight: Math.min(estH, below) }
    );
  }, [open, active]);
  useLayoutEffect(() => {
    computePos();
  }, [computePos]);
  useEffect(() => {
    if (!open) return;
    // Anchored to the button like the account/currency selects: a page scroll
    // closes the picker (so it never floats away). A scroll INSIDE the menu
    // (its own lists) is ignored, so selecting a checkbox never dismisses it.
    const onScroll = (e: Event) => {
      const t = e.target;
      if (menuRef.current && t instanceof Node && menuRef.current.contains(t)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={clsx("relative", className)}>
      <button
        ref={btnRef}
        onClick={() => {
          if (!open) setQuery("");
          setOpen((o) => !o);
        }}
        className={clsx(
          "btn-ghost text-xs py-1.5 h-[30px] w-full justify-between",
          !isAll && "border-accent text-accent"
        )}
      >
        <span className="truncate max-w-[180px]">Категории: {summary}</span>
        <ChevronDown className="w-4 h-4 shrink-0" />
      </button>
      {open &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} />
            <div
              ref={menuRef}
              {...{ [SURFACE_ATTR]: "" }}
              className="fixed z-[80] card p-0 overflow-hidden flex flex-col transition-[width,left] duration-200 ease-out"
              style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
            >
              <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border/60">
                <span className="text-xs text-muted whitespace-nowrap truncate">{totalLabel}</span>
                <button
                  onClick={() => onChange(isAll ? new Set([FILTER_NONE]) : new Set())}
                  className="text-xs text-accent hover:underline whitespace-nowrap shrink-0"
                >
                  {isAll ? "Снять все" : "Выбрать все"}
                </button>
              </div>
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60">
                <Search className="w-3.5 h-3.5 text-muted shrink-0" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Поиск категории и подкатегории"
                  className="bg-transparent text-xs w-full outline-none"
                />
              </div>
              {searchResults ? (
                /* Search — flat, directly-toggleable list with full paths. */
                <div className="overflow-y-auto min-h-0 flex-1">
                  {searchResults.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted">Ничего не найдено</div>
                  ) : (
                    searchResults.map((item) =>
                      item.kind === "cat" ? (
                        (() => {
                          const st = catState(item.node);
                          return (
                            <label
                              key={item.key}
                              className="flex items-center gap-2 px-3 py-1.5 hover:bg-panel2 cursor-pointer text-xs"
                            >
                              <input
                                type="checkbox"
                                checked={st === "all"}
                                ref={(el) => {
                                  if (el) el.indeterminate = st === "some";
                                }}
                                onChange={() => toggleParent(item.node)}
                                className="accent-accent shrink-0"
                              />
                              <CategoryDot category={item.node.name} size="w-4 h-4" />
                              <span className="truncate">{item.node.name}</span>
                            </label>
                          );
                        })()
                      ) : (
                        <label
                          key={item.key}
                          className="flex items-center gap-2 px-3 py-1.5 hover:bg-panel2 cursor-pointer text-xs"
                        >
                          <input
                            type="checkbox"
                            checked={leafChecked(subKey(item.node.name, item.sub))}
                            onChange={() => toggleLeaf(subKey(item.node.name, item.sub))}
                            className="accent-accent shrink-0"
                          />
                          <CategoryDot category={item.sub} parent={item.node.name} size="w-4 h-4" />
                          <span className="truncate">
                            <span className="text-muted">{item.node.name} / </span>
                            {item.sub}
                          </span>
                        </label>
                      )
                    )
                  )}
                </div>
              ) : (
                /* Sideways accordion — click a category, its subs slide out to
                   the right (animated width); click again to collapse. */
                <div className="flex min-h-0 flex-1">
                  <div
                    className="shrink-0 overflow-y-auto"
                    style={{ width: pos.width - (active ? SUB_W : 0) }}
                  >
                    {nodes.map((n, i) => {
                      const st = catState(n);
                      const isActive = n.name === active;
                      // Заголовок над первой категорией каждого типа. Список уже
                      // отсортирован по типу, поэтому достаточно сравнить с
                      // предыдущей строкой.
                      const groupLabel =
                        n.kind && n.kind !== nodes[i - 1]?.kind
                          ? KIND_LABELS[n.kind]
                          : null;
                      // Листья всего типа — на них действует кнопка в его
                      // заголовке. Считаем один раз на заголовок, а не на
                      // каждую строку списка.
                      const kindLeaves = groupLabel
                        ? nodes.filter((x) => x.kind === n.kind).flatMap(leavesOf)
                        : [];
                      const kindAllOn =
                        kindLeaves.length > 0 && kindLeaves.every(leafChecked);
                      return (
                        <Fragment key={n.name}>
                        {groupLabel && (
                          <div
                            className={clsx(
                              "flex items-center justify-between gap-2 px-2 pb-0.5",
                              i > 0 && "mt-1 pt-1 border-t border-border"
                            )}
                          >
                            <span className="text-[11px] uppercase tracking-wide text-muted truncate">
                              {groupLabel}
                            </span>
                            {/* Весь тип разом — иначе расходных категорий три
                                десятка, и «оставить только доходы» это тридцать
                                щелчков. */}
                            <button
                              type="button"
                              onClick={() => setMany(kindLeaves, !kindAllOn)}
                              aria-label={`${kindAllOn ? "Снять все" : "Выбрать все"}: ${groupLabel}`}
                              className="text-[11px] text-accent hover:underline shrink-0"
                            >
                              {kindAllOn ? "Снять все" : "Выбрать все"}
                            </button>
                          </div>
                        )}
                        <div
                          className={clsx("flex items-center gap-1 pr-1", isActive && "bg-panel2")}
                        >
                          <input
                            type="checkbox"
                            checked={st === "all"}
                            ref={(el) => {
                              if (el) el.indeterminate = st === "some";
                            }}
                            onChange={() => toggleParent(n)}
                            className="accent-accent shrink-0 ml-2"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              n.subs.length > 0 ? toggleActive(n.name) : toggleParent(n)
                            }
                            className="flex-1 min-w-0 text-left px-1.5 py-1.5 text-xs flex items-center gap-2"
                          >
                            <CategoryDot category={n.name} size="w-4 h-4" />
                            <span className="truncate flex-1">{n.name}</span>
                            {n.subs.length > 0 && (
                              <span className="text-[10px] text-muted shrink-0">
                                {n.subs.length}
                              </span>
                            )}
                            {n.subs.length > 0 && (
                              <ChevronRight
                                className={`w-3.5 h-3.5 shrink-0 text-muted transition-transform ${isActive ? "rotate-90" : ""}`}
                              />
                            )}
                          </button>
                        </div>
                        </Fragment>
                      );
                    })}
                  </div>
                  {/* Right panel — slides out (to the right) when a category is
                      expanded; click the category again to collapse. */}
                  {activeNode && (
                    <div
                      key={activeNode.name}
                      className="w-[190px] shrink-0 overflow-y-auto border-l border-border/60 animate-cat-subs"
                    >
                      {activeNode.subs.map((s) => (
                        <label
                          key={s}
                          className="flex items-center gap-2 px-2 py-1.5 hover:bg-panel2 cursor-pointer text-xs"
                        >
                          <input
                            type="checkbox"
                            checked={subChecked(activeNode, s)}
                            onChange={() => toggleLeaf(subKey(activeNode.name, s))}
                            className="accent-accent shrink-0"
                          />
                          <CategoryDot category={s} parent={activeNode.name} size="w-4 h-4" />
                          <span className="truncate">{s}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
