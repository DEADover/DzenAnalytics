// Dropdown multi-select used by the global filter bar and the accounts page.
//
// Lives on its own because a second copy would drift: the empty-set-means-ALL
// convention, the portal-based menu that floats over tables, and the flip-up
// placement are all easy to re-implement slightly differently — and then two
// filter rows in the same app behave differently on the same click.
//
// Set semantics (shared with useFiltersStore): empty = everything selected,
// {FILTER_NONE} = nothing selected, anything else = that exact subset.

import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search } from "lucide-react";
import clsx from "clsx";
import { FILTER_NONE } from "../store/useFiltersStore";
import { pluralRu } from "../lib/plural";

export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  renderIcon,
  unitForms,
  searchPlaceholder,
  archivedSet,
  groupOf,
  className,
  menuMinWidth,
  compactSummary,
  summaryMinWidth,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Optional leading icon per option (e.g. account logo / category dot). */
  renderIcon?: (opt: string) => ReactNode;
  /** Russian [one, few, many] noun for the count header (e.g. счёт/счёта/счетов). */
  unitForms?: [string, string, string];
  /** Override the search placeholder. */
  searchPlaceholder?: string;
  /** Options in this set are «archived» — rendered below an «Архивные»
   *  divider (the caller must place them last in `options`). */
  archivedSet?: Set<string>;
  /** Заголовок группы для варианта — над первым вариантом каждой группы
   *  рисуется разделитель. Список должен быть УЖЕ отсортирован по группам,
   *  иначе один заголовок появится несколько раз. `null` — вариант вне групп
   *  (такие держите в начале списка). */
  groupOf?: (opt: string) => string | null;
  /** Extra classes for the outer wrapper (e.g. `flex-1` to fill a row). */
  className?: string;
  /** Minimum dropdown width in px. Default 288; pass 0 to match the button. */
  menuMinWidth?: number;
  /** Quieter summary for dense toolbars: «все» instead of «Все (12)». The
   *  total only matters once you're choosing from it — before that it's a
   *  number the eye has to skip over on every control in the row. */
  compactSummary?: boolean;
  /** Ширина, зарезервированная под текст состояния (CSS-длина, напр. "4.5rem").
   *  Нужна в плотных панелях, где кнопка не должна менять размер при выборе. */
  summaryMinWidth?: string;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Search appears only for longer lists (currency etc. don't need it).
  const showSearch = options.length > 8;
  const q = query.trim().toLowerCase();
  const filteredOptions = q
    ? options.filter((o) => o.toLowerCase().includes(q))
    : options;

  // Set semantics: empty = ALL, {FILTER_NONE} = NONE, else a subset.
  const isAll = selected.size === 0;
  const isNone = selected.has(FILTER_NONE);
  const isChecked = (opt: string) => isAll || (!isNone && selected.has(opt));

  // Toggle one option, normalising the result back to the canonical empty
  // set (all) or the {FILTER_NONE} marker (none).
  const toggle = (opt: string) => {
    const eff = isNone
      ? new Set<string>()
      : isAll
        ? new Set(options)
        : new Set(selected);
    eff.delete(FILTER_NONE);
    if (eff.has(opt)) eff.delete(opt);
    else eff.add(opt);
    if (eff.size >= options.length) onChange(new Set()); // all → empty
    else if (eff.size === 0) onChange(new Set([FILTER_NONE])); // none
    else onChange(eff);
  };

  const summary = isNone
    ? "Ничего"
    : isAll
      ? compactSummary
        ? "Все"
        : `Все (${options.length})`
      : `${selected.size} из ${options.length}`;

  // The menu renders in a portal (position: fixed) so it floats above the
  // table below — `absolute` left it under a later stacking context. Its
  // left edge lines up with the button; it flips up if there's more room
  // above (and the menu fits there).
  type MenuPos = {
    left: number;
    width: number;
    top?: number;
    bottom?: number;
    maxHeight: number;
  };
  const [pos, setPos] = useState<MenuPos | null>(null);
  const MENU_W = menuMinWidth ?? 288;

  useLayoutEffect(() => {
    const el = btnRef.current;
    let next: MenuPos | null = null;
    if (open && el) {
      const r = el.getBoundingClientRect();
      const width = Math.max(r.width, MENU_W);
      const estH = Math.min(options.length * 32 + 44 + (showSearch ? 40 : 0), 360);
      const below = window.innerHeight - r.bottom - 8;
      const above = r.top - 8;
      const flipUp = above > below && above >= Math.min(estH, 48);
      next = flipUp
        ? {
            left: r.left,
            width,
            bottom: window.innerHeight - r.top + 4,
            maxHeight: Math.min(estH, above),
          }
        : {
            left: r.left,
            width,
            top: r.bottom + 4,
            maxHeight: Math.min(estH, below),
          };
    }
    setPos(next);
  }, [open, options.length, showSearch]);

  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      const t = e.target;
      if (menuRef.current && t instanceof Node && menuRef.current.contains(t)) {
        return;
      }
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return (
    <div className={clsx("relative", className)}>
      <button
        ref={btnRef}
        onClick={() => {
          setOpen((o) => !o);
          setQuery("");
        }}
        className={clsx(
          "btn-ghost text-xs py-1.5 h-[30px] w-full justify-between",
          selected.size > 0 && "border-accent text-accent"
        )}
      >
        <span className="truncate max-w-[180px]">
          {label}:{" "}
          {/* Ширина под самое длинное состояние: иначе кнопка прыгает, когда
              «Все» сменяется на «2 из 12», и вся строка отборов едет вбок. */}
          <span
            className="inline-block text-left"
            style={summaryMinWidth ? { minWidth: summaryMinWidth } : undefined}
          >
            {summary}
          </span>
        </span>
        <ChevronDown className="w-4 h-4 shrink-0" />
      </button>
      {open &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} />
            <div
              ref={menuRef}
              className="fixed z-[80] overflow-auto card p-2"
              style={{
                left: pos.left,
                width: pos.width,
                top: pos.top,
                bottom: pos.bottom,
                maxHeight: pos.maxHeight,
              }}
            >
              <div className="flex items-center justify-between gap-2 px-2 py-1 mb-1 border-b border-border/60">
                <span className="text-xs text-muted">
                  {options.length}{" "}
                  {pluralRu(
                    options.length,
                    unitForms ?? ["вариант", "варианта", "вариантов"]
                  )}
                </span>
                <button
                  onClick={() => onChange(isAll ? new Set([FILTER_NONE]) : new Set())}
                  className="text-xs text-accent hover:underline"
                >
                  {isAll ? "Снять все" : "Выбрать все"}
                </button>
              </div>
              {showSearch && (
                <div className="flex items-center gap-2 px-2 py-1.5 mb-1 border-b border-border/60">
                  <Search className="w-3.5 h-3.5 text-muted shrink-0" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={searchPlaceholder ?? `Поиск: ${label.toLowerCase()}`}
                    className="bg-transparent text-xs w-full outline-none"
                  />
                </div>
              )}
              {filteredOptions.length === 0 ? (
                <div className="px-2 py-2 text-xs text-muted">Ничего не найдено</div>
              ) : (
                filteredOptions.map((opt, i) => {
                  // First archived option → render an «Архивные» divider above it.
                  const showArchivedHeader =
                    !!archivedSet?.has(opt) &&
                    (i === 0 || !archivedSet.has(filteredOptions[i - 1]));
                  // Первый вариант группы → заголовок над ним. Считаем по
                  // ОТФИЛЬТРОВАННОМУ списку, иначе при поиске заголовок остался
                  // бы висеть над пустотой.
                  const group = groupOf?.(opt) ?? null;
                  const showGroupHeader =
                    group !== null &&
                    (i === 0 || (groupOf?.(filteredOptions[i - 1]) ?? null) !== group);
                  return (
                    <Fragment key={opt}>
                      {showArchivedHeader && (
                        <div className="mt-1 pt-1 border-t border-border px-2 pb-0.5 text-[11px] uppercase tracking-wide text-muted">
                          Архивные
                        </div>
                      )}
                      {showGroupHeader && (
                        <div
                          className={clsx(
                            "px-2 pb-0.5 text-[11px] uppercase tracking-wide text-muted",
                            i > 0 && "mt-1 pt-1 border-t border-border"
                          )}
                        >
                          {group}
                        </div>
                      )}
                      <label className="flex items-center gap-2 px-2 py-1.5 hover:bg-panel2 rounded cursor-pointer text-xs">
                        <input
                          type="checkbox"
                          checked={isChecked(opt)}
                          onChange={() => toggle(opt)}
                          className="accent-accent shrink-0"
                        />
                        {renderIcon && (
                          <span className="shrink-0">{renderIcon(opt)}</span>
                        )}
                        <span className="truncate">{opt}</span>
                      </label>
                    </Fragment>
                  );
                })
              )}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
