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
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { SURFACE_ATTR } from "./Popover";
import { ChevronDown, Search } from "lucide-react";
import clsx from "clsx";
import { FILTER_NONE } from "../store/useFiltersStore";
import { pluralRu } from "../lib/plural";
import { nestedBranches, visibleOptions } from "../lib/nestedOptions";

export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  renderIcon,
  labelOf,
  nestedOf,
  nestedUnitForms,
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
  /**
   * Чем называть ветки в подсказке переключателя: [1, 2–4, 5+].
   *
   * Ветки свёрнуты, и число на кнопке само по себе ни о чём не говорит:
   * «Показать 12 контрагентов» объясняет, что под счётом спрятано.
   */
  nestedUnitForms?: [string, string, string];
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
  /**
   * Раскрытые ветки — по умолчанию ни одной.
   *
   * Контрагентов у долгового счёта набирается больше, чем всех остальных
   * счетов вместе: раскрытыми они топят список, и фильтр счетов читается как
   * список должников. Под свёрнутым счётом остаётся переключатель с их числом.
   */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const branches = useMemo(() => nestedBranches(options, nestedOf), [options, nestedOf]);
  // Search appears only for longer lists (currency etc. don't need it).
  const showSearch = options.length > 8;
  const q = query.trim().toLowerCase();
  const text = (o: string) => labelOf?.(o) ?? o;
  // Ищем по ПОДПИСИ: у составного ключа в значении лежит ещё и имя счёта, и
  // поиск по «Иван» иначе находил бы всех контрагентов этого счёта.
  const filteredOptions = q
    ? options.filter((o) => text(o).toLowerCase().includes(q))
    : options;
  // Рисуем не всё найденное: у свёрнутого счёта ветки спрятаны. При поиске
  // свёрнутость отменяется — ищут как раз то, что внутри, и прятать найденное
  // значит не найти ничего.
  const visible = q
    ? filteredOptions
    : visibleOptions(filteredOptions, branches, expanded);

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
   * следующей невложенной (см. `nestedBranches`).
   */
  const childrenOf = (opt: string): string[] => branches.children.get(opt) ?? [];

  /** Родитель варианта-ветки: ближайшая невложенная строка выше. */
  const parentOf = (opt: string): string | null => branches.parent.get(opt) ?? null;

  /** Раскрыть или свернуть ветки счёта. */
  const toggleBranch = (opt: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(opt)) next.add(opt);
      return next;
    });

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

  /**
   * Ветки, где выбор разошёлся с родителем, — их раскрываем при открытии.
   *
   * Свёрнуть такую ветку значит спрятать сам выбор: на кнопке стоит «3 из 20»,
   * на экране — ни одной отмеченной строки, и снять отметку нечем. Дальше
   * свернуть её человек волен сам.
   */
  const pickedBranches = () =>
    new Set([...branches.children.keys()].filter(isPartial));

  /** Подпись переключателя ветки: сколько под ним и что сделает щелчок. */
  const branchHint = (count: number, shown: boolean) =>
    `${shown ? "Скрыть" : "Показать"} ${count} ` +
    pluralRu(count, nestedUnitForms ?? ["вариант", "варианта", "вариантов"]);

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
   * Варианты группы среди НАЙДЕННЫХ.
   *
   * Именно найденных: при поиске список сужен, и кнопка в заголовке должна
   * делать ровно то, что под ней видно, а не трогать спрятанное. Свёрнутые
   * ветки при этом считаются наравне с остальными: «Выбрать все» про группу
   * счетов, а не про то, какие из них сейчас развёрнуты.
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

  /**
   * Сколько вариантов считать своими в подписи и в шапке меню.
   *
   * Вложенные строки — не отдельные варианты, а разбивка одного: у долгового
   * счёта это его контрагенты. Считая их наравне, кнопка сообщала «Счета: Все
   * (318)» там, где счетов восемнадцать, — число говорило о чём угодно, кроме
   * счетов.
   */
  const totalCount = useMemo(
    () => (nestedOf ? options.filter((o) => !nestedOf(o)).length : options.length),
    [options, nestedOf]
  );
  const selectedCount = useMemo(() => {
    if (!nestedOf) return selected.size;
    let n = 0;
    for (const key of selected) if (!nestedOf(key)) n++;
    return n;
  }, [selected, nestedOf]);

  const summary = isNone
    ? "Ничего"
    : isAll
      ? compactSummary
        ? "Все"
        : `Все (${totalCount})`
      : `${selectedCount} из ${totalCount}`;

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
      // Высоту прикидываем по СТРОКАМ НА ЭКРАНЕ: со свёрнутыми ветками список
      // короче, и резервировать под них место — значит открыть меню с пустым
      // хвостом. Раскрыли ветку — прикидка пересчитается, и меню подрастёт.
      const estH = Math.min(visible.length * 32 + 44 + (showSearch ? 40 : 0), 360);
      const below = window.innerHeight - r.bottom - 8;
      const above = r.top - 8;
      const flipUp = above > below && above >= Math.min(estH, 48);
      // Меню шире кнопки, и по левому краю кнопки оно уезжало за правый край
      // экрана — например у кнопки счетов в настройках бюджета: то окно само
      // прижато к правому краю. Прижимаем меню в видимую область, оставляя
      // восемь пикселей поля, как это делает `Popover`.
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      next = flipUp
        ? {
            left,
            width,
            bottom: window.innerHeight - r.top + 4,
            maxHeight: Math.min(estH, above),
          }
        : {
            left,
            width,
            top: r.bottom + 4,
            maxHeight: Math.min(estH, below),
          };
    }
    setPos(next);
  }, [open, visible.length, showSearch]);

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
          // Открываем — раскрываем ветки, в которых что-то уже отмечено:
          // спрятанный выбор ни увидеть, ни снять.
          if (!open) setExpanded(pickedBranches());
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
              «Все» сменяется на «2 из 12», и вся строка фильтров едет вбок. */}
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
              {...{ [SURFACE_ATTR]: "" }}
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
                  {totalCount}{" "}
                  {pluralRu(totalCount, unitForms ?? ["вариант", "варианта", "вариантов"])}
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
              {visible.length === 0 ? (
                <div className="px-2 py-2 text-xs text-muted">Ничего не найдено</div>
              ) : (
                visible.map((opt, i) => {
                  // First archived option → render an «Архивные» divider above it.
                  const showArchivedHeader =
                    !!archivedSet?.has(opt) &&
                    (i === 0 || !archivedSet.has(visible[i - 1]));
                  // Первый вариант группы → заголовок над ним. Считаем по
                  // ПОКАЗАННОМУ списку, иначе при поиске заголовок остался
                  // бы висеть над пустотой.
                  const group = groupOf?.(opt) ?? null;
                  const showGroupHeader =
                    group !== null &&
                    (i === 0 || (groupOf?.(visible[i - 1]) ?? null) !== group);
                  // Ветки счёта: пока они свёрнуты, на строке стоит их число.
                  const kids = childrenOf(opt);
                  const branchOpen = expanded.has(opt);
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
                                nestedOf(visible[i + 1] ?? "") ? "-bottom-1" : "bottom-1/2"
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
                        {/* Переключатель веток. Во время поиска его нет: там
                            найденное показано целиком, и сворачивать нечего.
                            `preventDefault` держит его отдельно от галочки —
                            щелчок по кнопке внутри `<label>` иначе отобрал бы
                            весь счёт заодно. */}
                        {kids.length > 0 && !q && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              toggleBranch(opt);
                            }}
                            aria-expanded={branchOpen}
                            aria-label={branchHint(kids.length, branchOpen)}
                            title={branchHint(kids.length, branchOpen)}
                            className="ml-auto shrink-0 -my-1 flex items-center gap-1 px-1 py-1 rounded text-[11px] text-muted hover:text-accent hover:bg-panel2"
                          >
                            {kids.length}
                            <ChevronDown
                              className={`w-3.5 h-3.5 transition-transform ${
                                branchOpen ? "" : "-rotate-90"
                              }`}
                            />
                          </button>
                        )}
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
