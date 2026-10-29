import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { CategoryDot } from "./CategoryDot";
import { SearchInput } from "./SearchInput";
import { textMatches } from "../lib/keyboardLayout";
import { useListNav } from "./useListNav";
import { popSurfaceProps, usePresence } from "../hooks/usePresence";

export interface CategoryNode {
  name: string;
  /** Sub-category titles, already sorted. Empty → leaf category. */
  subs: string[];
}

interface Props {
  category: string;
  /** "" = no sub-category. */
  subcategory: string;
  categories: CategoryNode[];
  onChange: (category: string, subcategory: string) => void;
  placeholder?: string;
  maxHeight?: string;
  /** Hide the «Без подкатегории» (parent-only) option for these categories —
   *  used when the parent itself is already taken (e.g. already budgeted). */
  hideParentOption?: (category: string) => boolean;
  /**
   * Рисовать выпадающую часть в портале, позиционируя её по месту поля.
   *
   * Нужно внутри прокручиваемых областей — в теле модального окна обычный
   * абсолютный список обрезается контейнером с `overflow`, и до нижних
   * категорий приходится прокручивать само окно.
   */
  portal?: boolean;
  /** Крестик «Очистить» у выбранной категории — где пустое поле что-то значит
   *  («Категория без изменений» в массовом изменении). */
  clearable?: boolean;
}

/**
 * Single full-width category field with a two-column dropdown: parent
 * categories on the left, the active parent's sub-categories on the right.
 * Picking a leaf category (no subs) commits immediately; clicking a category
 * that HAS sub-categories toggles them open/closed on the right (explicit
 * click, no hover), where «Без подкатегории» picks the parent alone. This keeps
 * the first level to real top-level categories only and makes a category +
 * sub-category an unambiguous single choice (see issue #12).
 */
export function CategoryCascadePicker({
  category,
  subcategory,
  categories,
  onChange,
  placeholder = "Выберите категорию",
  maxHeight = "min(46vh, 280px)",
  hideParentOption,
  portal = false,
  clearable = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Which parent's sub-categories are shown on the right.
  const [activeParent, setActiveParent] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  /** В какой колонке ходят стрелки: категории слева или подкатегории справа. */
  const [column, setColumn] = useState<"cats" | "subs">("cats");
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    width: number;
    listHeight: number;
    up: boolean;
  } | null>(null);
  const { mounted, closing, openKey } = usePresence(open);

  useLayoutEffect(() => {
    // Сбрасывать `pos` не нужно: список живёт только при `open`, а при
    // следующем открытии `useLayoutEffect` пересчитает координаты ДО того,
    // как браузер нарисует кадр, — старое значение показать некому. Лишний
    // сброс стоил перерисовки на каждом закрытии.
    if (!open || !portal) return;
    const place = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const gap = 4;
      // Поле поиска и рамки съедают часть высоты — их закладываем, иначе
      // список вылезает за край экрана ровно на эту величину.
      const CHROME = 52;
      const below = window.innerHeight - r.bottom - gap - 8;
      const above = r.top - gap - 8;
      // Разворачиваем вверх, если снизу теснее: у поля в нижней части окна
      // нижние категории иначе оказывались за краем экрана и не прокручивались
      // — сам список `fixed`, а страница под ним никуда не едет.
      const dropUp = below < 220 && above > below;
      const space = Math.max(160, (dropUp ? above : below) - CHROME);
      const listHeight = Math.min(280, space);
      setPos({
        left: r.left,
        top: dropUp ? r.top - gap - (listHeight + CHROME) : r.bottom + gap,
        width: r.width,
        listHeight,
        up: dropUp,
      });
    };
    place();
    // `true` — ловим прокрутку любого предка, а не только окна.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, portal]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      // В портале выпадающая часть — не потомок поля, иначе выбор категории
      // закрывал бы список раньше, чем срабатывал сам выбор.
      if (popupRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return categories;
    return categories.filter(
      (c) =>
        textMatches(c.name, q) ||
        c.subs.some((s) => textMatches(s, q))
    );
  }, [categories, q]);

  const active = useMemo(
    () => categories.find((c) => c.name === activeParent) ?? null,
    [categories, activeParent]
  );
  const activeSubs = useMemo(() => {
    if (!active) return [];
    // If the query matched the parent name, show all its subs; otherwise narrow
    // to subs that match so search inside a big category still works.
    if (!q || textMatches(active.name, q)) return active.subs;
    return active.subs.filter((s) => textMatches(s, q));
  }, [active, q]);

  // While searching, collapse the cascade into ONE flat, directly-selectable
  // list of matching leaves — both categories and sub-categories — so a
  // sub-category can be picked in a single click instead of drilling in
  // (issue #21). Null when not searching (then the two-column cascade shows).
  type SearchLeaf =
    | { kind: "cat"; cat: string }
    | { kind: "sub"; cat: string; sub: string };
  const searchLeaves = useMemo<SearchLeaf[] | null>(() => {
    if (!q) return null;
    const items: SearchLeaf[] = [];
    for (const c of categories) {
      if (textMatches(c.name, q) && !hideParentOption?.(c.name))
        items.push({ kind: "cat", cat: c.name });
      for (const s of c.subs) {
        if (textMatches(s, q)) items.push({ kind: "sub", cat: c.name, sub: s });
      }
    }
    return items;
  }, [categories, q, hideParentOption]);

  /** Правая колонка: «Без подкатегории» (если не скрыта) и подкатегории. */
  const rightItems = useMemo<string[]>(() => {
    if (!active || active.subs.length === 0) return [];
    return [...(hideParentOption?.(active.name) ? [] : [""]), ...activeSubs];
  }, [active, activeSubs, hideParentOption]);

  // Подсветка — своя у каждого списка: колонки категорий, колонки
  // подкатегорий и плоского списка результатов поиска.
  const catNav = useListNav(filtered.length, open && !searchLeaves);
  const subNav = useListNav(rightItems.length, open && !searchLeaves);
  const searchNav = useListNav(searchLeaves?.length ?? 0, open && !!searchLeaves);

  function toggle() {
    if (!open) {
      setQuery("");
      setActiveParent(category || null);
      setColumn("cats");
      // Подсветка начинается с выбранной категории.
      catNav.set(categories.findIndex((c) => c.name === category), true);
    }
    setOpen((o) => !o);
  }

  function commit(cat: string, sub: string) {
    onChange(cat, sub);
    setOpen(false);
    setQuery("");
    // Поле поиска внутри списка исчезает вместе с ним — фокус возвращаем на
    // поле категории, чтобы Tab с клавиатуры шёл дальше по форме.
    triggerRef.current?.focus({ preventScroll: true });
  }

  /** Перейти в колонку подкатегорий — на выбранную, если она в этой категории. */
  function enterSubs(parent: CategoryNode) {
    setActiveParent(parent.name);
    setColumn("subs");
    const items = [...(hideParentOption?.(parent.name) ? [] : [""]), ...parent.subs];
    const cur = parent.name === category ? items.indexOf(subcategory) : -1;
    subNav.set(Math.max(0, cur), true);
  }

  /** Щелчок по пункту не уводит фокус из поиска — стрелки работают и дальше. */
  const keepSearchFocus = (e: React.MouseEvent) => e.preventDefault();

  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      // Закрывает список, а не окно, в котором стоит поле.
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
      return;
    }
    if (e.key === "Tab") {
      // Уходим к следующему полю без выбора. Фокус — на поле категории, и Tab
      // по умолчанию продолжит обход уже от него (в портале поиск лежит в
      // конце страницы, и обход ушёл бы туда).
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
      return;
    }
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const down = e.key === "ArrowDown";
    const up = e.key === "ArrowUp";

    // Поиск — один плоский список результатов.
    if (searchLeaves) {
      if (down || up) {
        e.preventDefault();
        searchNav.move(down ? 1 : -1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const it = searchLeaves[searchNav.active];
        if (it) commit(it.cat, it.kind === "sub" ? it.sub : "");
      }
      return;
    }

    if (column === "subs" && active && rightItems.length > 0) {
      if (down || up) {
        e.preventDefault();
        subNav.move(down ? 1 : -1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setColumn("cats");
        catNav.set(filtered.findIndex((c) => c.name === active.name), true);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const sub = rightItems[subNav.active];
        if (sub !== undefined) commit(active.name, sub);
      }
      return;
    }

    if (down || up) {
      e.preventDefault();
      const i = catNav.move(down ? 1 : -1);
      // Справа сразу видно, что внутри подсвеченной категории.
      if (i >= 0) setActiveParent(filtered[i].name);
      return;
    }
    const cat = filtered[catNav.active];
    if (!cat) return;
    if (e.key === "ArrowRight" && cat.subs.length > 0) {
      e.preventDefault();
      enterSubs(cat);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (cat.subs.length > 0) enterSubs(cat);
      else commit(cat.name, "");
    }
  }

  const label = category
    ? subcategory
      ? `${category} / ${subcategory}`
      : category
    : "";

  /** Сколько отдать под колонки: в портале — по свободному месту на экране. */
  const listMaxHeight = portal && pos ? `${pos.listHeight}px` : maxHeight;

  /** В режиме портала выпадающая часть уезжает в body, иначе остаётся на месте. */
  const renderPopup = (node: React.ReactElement) =>
    portal ? (pos ? createPortal(node, document.body) : null) : node;
  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        onKeyDown={(e) => {
          // ↓ на закрытом поле открывает список, как у остальных списков.
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp") && !e.altKey && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            toggle();
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="input text-sm w-full flex items-center justify-between gap-2 text-left"
      >
        {/* Место под крестик «Очистить» — он стоит поверх, перед стрелкой. */}
        <span className={`flex items-center gap-2 min-w-0 ${clearable && category ? "mr-5" : ""}`}>
          {category && <CategoryDot category={category} size="w-5 h-5" />}
          <span className={`truncate ${label ? "" : "text-muted"}`}>
            {label || placeholder}
          </span>
        </span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {clearable && category && (
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setQuery("");
            onChange("", "");
          }}
          title="Очистить"
          aria-label="Очистить категорию"
          className="absolute right-8 top-1/2 -translate-y-1/2 text-muted hover:text-expense"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
      {mounted && renderPopup(
        <div
          ref={popupRef}
          key={openKey}
          {...popSurfaceProps(closing, portal && pos?.up ? "up" : "down")}
          className={
            portal
              ? "fixed z-[70] bg-panel border border-border rounded-lg shadow-lg overflow-hidden"
              : "absolute z-10 mt-1 w-full bg-panel border border-border rounded-lg shadow-lg overflow-hidden"
          }
          style={portal && pos ? { left: pos.left, top: pos.top, width: pos.width } : undefined}
        >
          <SearchInput
            variant="menu"
            value={query}
            onChange={(next) => {
              setQuery(next);
              // Набрали — подсветка на первом найденном, Enter его и выберет.
              searchNav.set(0, true);
            }}
            placeholder="Поиск категории"
            autoFocus
            inputProps={{
              role: "combobox",
              "aria-expanded": true,
              "aria-autocomplete": "list",
              "aria-controls": searchLeaves
                ? searchNav.listId
                : column === "subs"
                  ? subNav.listId
                  : catNav.listId,
              "aria-activedescendant": searchLeaves
                ? searchNav.active >= 0
                  ? searchNav.optionId(searchNav.active)
                  : undefined
                : column === "subs"
                  ? subNav.active >= 0
                    ? subNav.optionId(subNav.active)
                    : undefined
                  : catNav.active >= 0
                    ? catNav.optionId(catNav.active)
                    : undefined,
              onKeyDown: onSearchKey,
            }}
          />
          {searchLeaves ? (
            /* Search mode — one flat list with directly-selectable leaves,
               sub-categories included (issue #21). */
            <div
              id={searchNav.listId}
              role="listbox"
              aria-label="Найденные категории"
              className="overflow-y-auto"
              style={{ maxHeight: listMaxHeight }}
            >
              {searchLeaves.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted">Ничего не найдено</div>
              ) : (
                searchLeaves.map((it, i) =>
                  it.kind === "cat" ? (
                    <button
                      key={`c:${it.cat}`}
                      id={searchNav.optionId(i)}
                      type="button"
                      role="option"
                      aria-selected={category === it.cat && !subcategory}
                      tabIndex={-1}
                      onMouseDown={keepSearchFocus}
                      onClick={() => commit(it.cat, "")}
                      onMouseMove={(e) => searchNav.hover(i, e)}
                      className={`w-full text-left px-2.5 py-1.5 text-sm flex items-center gap-2 hover:bg-panel2 ${
                        i === searchNav.active ? "bg-panel2" : ""
                      } ${category === it.cat && !subcategory ? "text-accent" : ""}`}
                    >
                      <CategoryDot category={it.cat} size="w-4 h-4" />
                      <span className="truncate">{it.cat}</span>
                    </button>
                  ) : (
                    <button
                      key={`s:${it.cat}/${it.sub}`}
                      id={searchNav.optionId(i)}
                      type="button"
                      role="option"
                      aria-selected={category === it.cat && subcategory === it.sub}
                      tabIndex={-1}
                      onMouseDown={keepSearchFocus}
                      onClick={() => commit(it.cat, it.sub)}
                      onMouseMove={(e) => searchNav.hover(i, e)}
                      className={`w-full text-left px-2.5 py-1.5 text-sm flex items-center gap-2 hover:bg-panel2 ${
                        i === searchNav.active ? "bg-panel2" : ""
                      } ${category === it.cat && subcategory === it.sub ? "text-accent" : ""}`}
                    >
                      <CategoryDot category={it.sub} parent={it.cat} size="w-4 h-4" />
                      <span className="truncate">
                        <span className="text-muted">{it.cat} / </span>
                        {it.sub}
                      </span>
                    </button>
                  )
                )
              )}
            </div>
          ) : (
          <div className="flex" style={{ maxHeight: listMaxHeight }}>
            {/* Left — top-level categories */}
            <div
              id={catNav.listId}
              role="listbox"
              aria-label="Категории"
              className="w-1/2 overflow-y-auto border-r border-border/60"
            >
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted">Ничего не найдено</div>
              ) : (
                filtered.map((c, i) => {
                  const isSel = c.name === category;
                  const isActive = c.name === activeParent;
                  const hasSubs = c.subs.length > 0;
                  // Подсветка стрелок/курсора — пока ходят по этой колонке.
                  const isHi = column === "cats" && i === catNav.active;
                  return (
                    <button
                      key={c.name}
                      id={catNav.optionId(i)}
                      type="button"
                      role="option"
                      aria-selected={isSel}
                      tabIndex={-1}
                      onMouseDown={keepSearchFocus}
                      onMouseMove={(e) => {
                        if (column !== "cats") setColumn("cats");
                        catNav.hover(i, e);
                      }}
                      // A category WITH sub-categories toggles them open/closed
                      // on click (explicit — no hover); a leaf category commits.
                      onClick={() =>
                        hasSubs
                          ? setActiveParent(isActive ? null : c.name)
                          : commit(c.name, "")
                      }
                      aria-expanded={hasSubs ? isActive : undefined}
                      className={`w-full text-left px-2.5 py-1.5 text-sm flex items-center gap-2 hover:bg-panel2 ${
                        isActive || isHi ? "bg-panel2" : ""
                      } ${isSel ? "text-accent" : ""}`}
                    >
                      <CategoryDot category={c.name} size="w-4 h-4" />
                      <span className="truncate flex-1">{c.name}</span>
                      {hasSubs &&
                        (isActive ? (
                          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted" />
                        ))}
                    </button>
                  );
                })
              )}
            </div>
            {/* Right — sub-categories of the active parent */}
            <div
              id={subNav.listId}
              role="listbox"
              aria-label="Подкатегории"
              className="w-1/2 overflow-y-auto"
            >
              {active && rightItems.length > 0 ? (
                // Первым — сама категория без подкатегории (скрыт, если она
                // уже занята), дальше подкатегории.
                rightItems.map((s, i) => {
                  const isParent = s === "";
                  const isSel =
                    category === active.name && (isParent ? !subcategory : subcategory === s);
                  const isHi = column === "subs" && i === subNav.active;
                  return (
                    <button
                      key={isParent ? "parent" : `s:${s}`}
                      id={subNav.optionId(i)}
                      type="button"
                      role="option"
                      aria-selected={isSel}
                      tabIndex={-1}
                      onMouseDown={keepSearchFocus}
                      onClick={() => commit(active.name, s)}
                      onMouseMove={(e) => {
                        if (column !== "subs") setColumn("subs");
                        subNav.hover(i, e);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 text-sm flex items-center gap-2 hover:bg-panel2 ${
                        isHi ? "bg-panel2" : ""
                      } ${isSel ? "text-accent" : isParent ? "text-muted" : ""}`}
                    >
                      {isParent ? (
                        <CategoryDot category={active.name} size="w-4 h-4" />
                      ) : (
                        <CategoryDot category={s} parent={active.name} size="w-4 h-4" />
                      )}
                      <span className="truncate">{isParent ? "Без подкатегории" : s}</span>
                    </button>
                  );
                })
              ) : (
                <div className="px-3 py-2 text-xs text-muted">
                  {active ? "Нет подкатегорий" : "Выберите категорию"}
                </div>
              )}
            </div>
          </div>
          )}
        </div>
      )}
    </div>
  );
}
