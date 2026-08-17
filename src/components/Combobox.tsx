import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";

/**
 * Optional grouped variant of the dropdown — items split into named
 * sections with sticky-style headers. When `groups` is provided it
 * takes precedence over `options`. Use for combo lists that mix
 * meaningfully different sources (e.g. curated brand catalogue vs.
 * historical payee strings) so the user can tell at a glance which
 * bucket a given suggestion comes from.
 */
export interface ComboboxGroup {
  label: string;
  items: string[];
}

export interface ComboboxProps {
  value: string;
  options: string[];
  /** Grouped variant — when present, supersedes `options`. */
  groups?: ComboboxGroup[];
  onChange: (v: string) => void;
  placeholder?: string;
  /** Max popup height in CSS — defaults to "min(50vh, 320px)". */
  maxHeight?: string;
  /** If false, free-form typing is disabled (only listed options allowed). */
  allowCustom?: boolean;
  /**
   * When true, an X button appears next to the chevron whenever a
   * non-empty value is set; clicking it clears the field via
   * `onChange("")`. Useful for picker-only Comboboxes that need to
   * support an optional/empty state (e.g. subcategory) without
   * letting the user type a free-form clear.
   */
  clearable?: boolean;
  /**
   * Рисовать список в портале, позиционируя его по месту поля.
   *
   * Нужно там, где Combobox стоит внутри прокручиваемой области: обычный
   * абсолютный список обрезается контейнером с `overflow`, и из десятка
   * вариантов видно полтора. По умолчанию выключено — остальным местам портал
   * не нужен, а он всё-таки отвязывает список от потока документа.
   */
  portal?: boolean;
  /**
   * Значок слева от пункта — логотип счёта, точка категории и подобное.
   * Тот же приём, что в панели фильтров: без значка список названий читается
   * заметно хуже.
   */
  renderIcon?: (option: string) => ReactNode;
  /**
   * Разрешить НАБОР для поиска, оставив выбор только из списка.
   *
   * Отличается от `allowCustom`: там введённый текст сразу становится
   * значением, здесь он лишь сужает список, а значением становится выбранный
   * пункт. Нужно спискам на десятки строк — крутить их до нужного дольше, чем
   * набрать три буквы. Незакрытый набор при уходе из поля откатывается.
   */
  searchable?: boolean;
  /**
   * Неизменяемый знак в начале поля — например «#» у хэштега.
   *
   * Рисуется поверх поля и не участвует в значении: в `value` и в списке
   * вариантов лежит чистое имя. Так поле выглядит одинаково с обычным вводом,
   * где такой же префикс стоит слева от текста.
   */
  prefix?: string;
}

/**
 * Text input + filterable dropdown. Replaces native <select>/<datalist>
 * because neither gives us:
 *   - Clicking the chevron OR clicking on a populated field opens the list
 *     (user doesn't need to clear the field to pick a different option).
 *   - A bounded popup height: list caps at ~50vh by default, never the
 *     whole viewport.
 *   - Free-form input (configurable via `allowCustom`).
 */
export function Combobox({
  value,
  options,
  groups,
  onChange,
  placeholder,
  maxHeight = "min(50vh, 320px)",
  allowCustom = true,
  clearable = false,
  portal = false,
  prefix,
  searchable = false,
  renderIcon,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  // Filter only when the user has actively typed *after* opening (clicking the
  // chevron on a populated field should reveal ALL options, not just matches
  // for the current value).
  const [filtering, setFiltering] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  /** Координаты списка в режиме портала: он вне потока и позиционируется сам. */
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  // Sync the editable input text when the controlled `value` changes
  // externally. This is the canonical "mirror a prop into local input
  // state" pattern — the input must stay editable, so it can't be a
  // pure derived value. The extra render is intentional and harmless.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery(value);
  }, [value]);

  // Close when the user clicks outside.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      // В режиме портала список — не потомок контейнера, иначе выбор варианта
      // закрывал бы список раньше, чем срабатывал сам выбор.
      if (popupRef.current?.contains(target)) return;
      setOpen(false);
      // Недонабранный запрос — не значение. Ушли из поля, ничего не выбрав —
      // возвращаем то, что выбрано на самом деле, иначе в поле остался бы
      // обрывок вроде «нал», которого нет ни в списке, ни в данных.
      if (searchable && !allowCustom) {
        setQuery(value);
        setFiltering(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open, searchable, allowCustom, value]);

  useLayoutEffect(() => {
    if (!open || !portal) {
      setPos(null);
      return;
    }
    const place = () => {
      const r = containerRef.current?.getBoundingClientRect();
      if (!r) return;
      const gap = 4;
      const below = window.innerHeight - r.bottom - gap - 8;
      const above = r.top - gap - 8;
      // Разворачиваем вверх, если снизу теснее: у поля в нижней половине окна
      // список иначе уходит за край экрана.
      const dropUp = below < 160 && above > below;
      const maxHeight = Math.max(120, Math.min(320, dropUp ? above : below));
      setPos({
        left: r.left,
        top: dropUp ? r.top - gap - maxHeight : r.bottom + gap,
        width: r.width,
        maxHeight,
      });
    };
    place();
    // `true` — ловим прокрутку любого предка, а не только окна: поле как раз и
    // живёт внутри прокручиваемой области.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, portal]);

  const filtered = useMemo(() => {
    if (!filtering) return options;
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [filtering, query, options]);

  // Grouped variant: filter each group's items individually, then drop
  // empty groups so the header doesn't render for sections with no
  // matches. The total result is what we use for the empty-state check.
  const filteredGroups = useMemo(() => {
    if (!groups) return null;
    const q = filtering ? query.trim().toLowerCase() : "";
    return groups
      .map((g) => ({
        label: g.label,
        items: q ? g.items.filter((i) => i.toLowerCase().includes(q)) : g.items,
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, filtering, query]);

  const popupHasItems = filteredGroups
    ? filteredGroups.length > 0
    : filtered.length > 0;

  function commit(next: string) {
    setQuery(next);
    onChange(next);
    setFiltering(false);
    setOpen(false);
  }

  /** В режиме портала список уезжает в body, иначе остаётся на месте. */
  const renderPopup = (node: React.ReactElement) =>
    portal ? (pos ? createPortal(node, document.body) : null) : node;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          value={query}
          onChange={(e) => {
            if (!allowCustom && !searchable) return;
            setQuery(e.target.value);
            // В режиме поиска набранное — это запрос, а не значение: наружу
            // уходит только выбранный из списка пункт.
            if (allowCustom) onChange(e.target.value);
            setFiltering(true);
            if (!open) setOpen(true);
          }}
          readOnly={!allowCustom && !searchable}
          onFocus={() => {
            setFiltering(false);
            setOpen(true);
          }}
          onClick={() => {
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && open) {
              e.stopPropagation();
              setOpen(false);
              if (searchable && !allowCustom) {
                setQuery(value);
                setFiltering(false);
              }
            }
          }}
          placeholder={placeholder}
          // Extra right-padding when the clear-X is showing, otherwise
          // the typed value collides with two stacked icons.
          // `h-10` — та же высота, что задаёт себе `Select`: в строке действия
          // они стоят рядом, и разница в пиксель читается как перекос.
          className={`input h-10 text-sm w-full ${clearable && value ? "pr-12" : "pr-7"} ${!allowCustom && !searchable ? "cursor-pointer" : ""} ${prefix ? "pl-7" : ""}`}
        />
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
            {prefix}
          </span>
        )}
        {clearable && value && (
          <button
            type="button"
            onMouseDown={(e) => {
              // mouseDown so the click wins over input blur.
              e.preventDefault();
              setQuery("");
              setFiltering(false);
              setOpen(false);
              onChange("");
            }}
            title="Очистить"
            className="absolute right-7 top-1/2 -translate-y-1/2 text-muted hover:text-expense"
            tabIndex={-1}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          onMouseDown={(e) => {
            // mouseDown so the toggle wins over input blur.
            e.preventDefault();
            setFiltering(false);
            setOpen((v) => !v);
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"
          tabIndex={-1}
        >
          <ChevronDown
            className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>
      {open && popupHasItems && renderPopup(
        <div
          ref={popupRef}
          className={
            portal
              ? // Тот же слой, что у `Select`: список обязан быть выше окна,
                // из которого его открыли (см. комментарий там).
                "fixed z-[96] bg-panel border border-border rounded-lg shadow-lg overflow-y-auto"
              : "absolute z-10 mt-1 w-full bg-panel border border-border rounded-lg shadow-lg overflow-y-auto"
          }
          style={
            portal && pos
              ? { left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight }
              : { maxHeight }
          }
        >
          {filteredGroups
            ? filteredGroups.map((g) => (
                <div key={g.label}>
                  {/* Sticky-ish group header — distinct from list items
                      so the user can tell at a glance "this section is
                      brands from Дзен" vs "this section is what you've
                      typed before". */}
                  <div className="sticky top-0 px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted bg-panel border-b border-border/40">
                    {g.label}
                    <span className="ml-1.5 opacity-60">{g.items.length}</span>
                  </div>
                  {g.items.map((opt) => {
                    const isCurrent = opt === value;
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => commit(opt)}
                        className={`w-full text-left px-3 py-1.5 text-sm hover:bg-panel2 flex items-center gap-2 ${
                          isCurrent ? "bg-panel2/60 text-accent" : ""
                        }`}
                      >
                        {renderIcon && <span className="shrink-0">{renderIcon(opt)}</span>}
                        <span className="truncate">{opt}</span>
                      </button>
                    );
                  })}
                </div>
              ))
            : filtered.map((opt) => {
                const isCurrent = opt === value;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => commit(opt)}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-panel2 flex items-center gap-2 ${
                      isCurrent ? "bg-panel2/60 text-accent" : ""
                    }`}
                  >
                    {renderIcon && <span className="shrink-0">{renderIcon(opt)}</span>}
                    <span className="truncate">{opt}</span>
                  </button>
                );
              })}
        </div>
      )}
    </div>
  );
}
