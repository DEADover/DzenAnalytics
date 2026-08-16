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
  labelOf,
  nestedOf,
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
  /**
   * Подпись варианта, если она не совпадает со значением.
   *
   * Нужна там, где значение — составной ключ: у долгового счёта варианты идут
   * парой «счёт → контрагент», а в списке человек ждёт увидеть имя, а не ключ.
   * По умолчанию подпись и есть значение.
   */
  labelOf?: (opt: string) => string;
  /**
   * Вариант — ветка предыдущего: рисуется с отступом и уголком.
   *
   * Так под долговым счётом идут его контрагенты: они не отдельная группа, а
   * его же разбивка, и отдельный заголовок над ними разрывал бы список там,
   * где нужна вложенность.
   */
  nestedOf?: (opt: string) => boolean;
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
  const text = (o: string) => labelOf?.(o) ?? o;
  // Ищем по ПОДПИСИ: у составного ключа в значении лежит ещё и имя счёта, и
  // поиск по «Иван» иначе находил бы всех контрагентов этого счёта.
  const filteredOptions = q
    ? options.filter((o) => text(o).toLowerCase().includes(q))
    : options;

  // Set semantics: empty = ALL, {FILTER_NONE} = NONE, else a subset.
  const isAll = selected.size === 0;
  const isNone = selected.has(FILTER_NONE);
  const isChecked = (opt: string) => isAll || (!isNone && selected.has(opt));

  /** Текущий выбор как обычное множество — без соглашений «пусто = все». */
  const effective = () =>
    isNone ? new Set<string>() : isAll ? new Set(options) : new Set(selected);

  /** Записать выбор, вернув его к каноническому виду: пусто = все,
   *  {FILTER_NONE} = ничего. */
  const commit = (eff: Set<string>) => {
    eff.delete(FILTER_NONE);
    if (eff.size >= options.length) onChange(new Set()); // all → empty
    else if (eff.size === 0) onChange(new Set([FILTER_NONE])); // none
    else onChange(eff);
  };

  /**
   * Ветки варианта — идущие сразу за ним вложенные строки.
   *
   * Вложенность в этом списке одноуровневая и НЕПРЕРЫВНАЯ (см. `nestedOf`),
   * поэтому детей можно не передавать отдельно: это все вложенные строки до
   * следующей невложенной.
   */
  const childrenOf = (opt: string): string[] => {
    if (!nestedOf) return [];
    const i = options.indexOf(opt);
    if (i < 0 || nestedOf(opt)) return [];
    const out: string[] = [];
    for (let j = i + 1; j < options.length && nestedOf(options[j]); j++) out.push(options[j]);
    return out;
  };

  /** Родитель варианта-ветки: ближайшая невложенная строка выше. */
  const parentOf = (opt: string): string | null => {
    if (!nestedOf?.(opt)) return null;
    const i = options.indexOf(opt);
    for (let j = i - 1; j >= 0; j--) if (!nestedOf(options[j])) return options[j];
    return null;
  };

  /**
   * Отметка варианта.
   *
   * Ветка — это ЧАСТЬ родителя, и состояния «родитель снят, а ветка отмечена»
   * быть не должно: оно читается как противоречие. Поэтому родитель тянет за
   * собой все свои ветки, а снятая ветка снимает отметку с родителя — он
   * больше не «весь счёт целиком», но остальные его ветки остаются.
   */
  const toggle = (opt: string) => {
    const eff = effective();
    const kids = childrenOf(opt);
    const on = !eff.has(opt);
    if (on) {
      eff.add(opt);
      for (const k of kids) eff.add(k);
    } else {
      eff.delete(opt);
      for (const k of kids) eff.delete(k);
      const parent = parentOf(opt);
      if (parent) eff.delete(parent);
    }
    commit(eff);
  };

  /** Родитель отмечен не целиком: часть веток снята или наоборот. */
  const isPartial = (opt: string) => {
    const kids = childrenOf(opt);
    if (kids.length === 0) return false;
    return isChecked(opt)
      ? !kids.every((k) => isChecked(k))
      : kids.some((k) => isChecked(k));
  };

  /** Отметить или снять сразу группу — по кнопке в её заголовке. */
  const setMany = (opts: string[], on: boolean) => {
    const eff = effective();
    for (const o of opts) {
      if (on) eff.add(o);
      else eff.delete(o);
    }
    commit(eff);
  };

  /**
   * Варианты группы среди ВИДИМЫХ.
   *
   * Именно видимых: при поиске список сужен, и кнопка в заголовке должна
   * делать ровно то, что под ней видно, а не трогать спрятанное.
   */
  const membersOf = (group: string | null, archived: boolean) =>
    filteredOptions.filter((o) =>
      archived
        ? !!archivedSet?.has(o)
        : !archivedSet?.has(o) && (groupOf?.(o) ?? null) === group
    );

  /** Заголовок группы с кнопкой «Выбрать все / Снять все» на её варианты. */
  const groupHeader = (
    title: string,
    members: string[],
    className?: string
  ) => {
    const allOn = members.length > 0 && members.every(isChecked);
    return (
      <div
        className={clsx(
          "flex items-center justify-between gap-2 px-2 pb-0.5",
          className
        )}
      >
        <span className="text-[11px] uppercase tracking-wide text-muted truncate">
          {title}
        </span>
        <button
          type="button"
          onClick={() => setMany(members, !allOn)}
          aria-label={`${allOn ? "Снять все" : "Выбрать все"}: ${title}`}
          className="text-[11px] text-accent hover:underline shrink-0"
        >
          {allOn ? "Снять все" : "Выбрать все"}
        </button>
      </div>
    );
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
                      {showArchivedHeader &&
                        groupHeader("Архивные", membersOf(null, true), "mt-1 pt-1 border-t border-border")}
                      {showGroupHeader &&
                        groupHeader(
                          group,
                          membersOf(group, false),
                          i > 0 ? "mt-1 pt-1 border-t border-border" : undefined
                        )}
                      <label
                        className={`flex items-center gap-2 px-2 py-1.5 hover:bg-panel2 rounded cursor-pointer text-xs ${
                          nestedOf?.(opt) ? "relative pl-7" : ""
                        }`}
                      >
                        {/* Уголок к строке выше — тот же приём, что и у
                            под-категорий на дашборде: видно, чья это ветка, и
                            заголовок группы для неё не нужен. */}
                        {nestedOf?.(opt) && (
                          <>
                            <span
                              className={`absolute left-3 -top-1 w-px bg-border ${
                                nestedOf(filteredOptions[i + 1] ?? "") ? "-bottom-1" : "bottom-1/2"
                              }`}
                            />
                            <span className="absolute left-3 top-1/2 w-2 h-px bg-border" />
                          </>
                        )}
                        {/* Родитель, у которого отмечена только часть веток,
                            показывается «частично» — иначе на экране стоял бы
                            снятый счёт с отмеченным контрагентом внутри. */}
                        <input
                          type="checkbox"
                          checked={isChecked(opt)}
                          ref={(el) => {
                            if (el) el.indeterminate = isPartial(opt);
                          }}
                          onChange={() => toggle(opt)}
                          className="accent-accent shrink-0"
                        />
                        {renderIcon && (
                          <span className="shrink-0">{renderIcon(opt)}</span>
                        )}
                        <span className="truncate">{text(opt)}</span>
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
