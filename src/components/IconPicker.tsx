import { useMemo, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import clsx from "clsx";
import { ZEN_ICON_IDS, zenIconToLucide, FALLBACK_CATEGORY_ICON } from "../lib/zenIconLucide";

interface Props {
  /** Current Zenmoney icon id, or null. */
  value: string | null;
  /** Category colour (hex/css) — tints the selected glyph so the picker previews
   *  how the dot will look. */
  color?: string;
  onChange: (iconId: string) => void;
}

/**
 * Category icon picker — a trigger showing the current glyph, expanding to a
 * searchable grid over the known Zenmoney icon set (`ZEN_ICON_IDS`, each mapped
 * to a Lucide glyph). Stores the raw Zenmoney icon id string, so the choice
 * round-trips to the cloud unchanged.
 */
export function IconPicker({ value, color, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const Current = zenIconToLucide(value) || FALLBACK_CATEGORY_ICON;

  const ids = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ZEN_ICON_IDS;
    // Ids look like «5001_food» — strip the numeric prefix so a search for
    // "food"/"car" matches the human-readable slug part.
    return ZEN_ICON_IDS.filter((id) =>
      id.toLowerCase().replace(/^\d+_/, "").includes(q)
    );
  }, [query]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="input h-10 flex items-center justify-between gap-2 w-full text-left"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Current className="w-5 h-5 shrink-0" style={color ? { color } : undefined} />
          {/* Name the CHOSEN icon — a permanent «Выбрать иконку» reads as an
              empty field even after picking, since only the glyph changes. */}
          <span
            className={clsx(
              "text-sm truncate",
              value ? "text-text" : "text-muted"
            )}
          >
            {value ? value.replace(/^\d+_/, "").replace(/_/g, " ") : "Выбрать иконку"}
          </span>
        </span>
        <ChevronDown
          className={clsx("w-4 h-4 text-muted transition-transform shrink-0", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-30 mt-2 border border-border rounded-lg bg-panel p-2 shadow-xl">
          <div className="flex items-center gap-2 bg-panel2 rounded-lg px-2 py-1 border border-border mb-2">
            <Search className="w-3.5 h-3.5 text-muted shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск иконки (напр. car, food)…"
              className="bg-transparent text-sm flex-1 outline-none min-w-0"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-muted hover:text-text"
                aria-label="Очистить поиск"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="grid grid-cols-6 gap-1 max-h-56 overflow-y-auto">
            {ids.map((id) => {
              const Glyph = zenIconToLucide(id) || FALLBACK_CATEGORY_ICON;
              const active = id === value;
              return (
                <button
                  key={id}
                  type="button"
                  title={id.replace(/^\d+_/, "")}
                  aria-label={id}
                  aria-pressed={active}
                  onClick={() => {
                    onChange(id);
                    setOpen(false);
                  }}
                  className={clsx(
                    "aspect-square flex items-center justify-center rounded-md",
                    active
                      ? "bg-accent/15 ring-1 ring-accent"
                      : "hover:bg-panel2 text-text"
                  )}
                >
                  <Glyph
                    className="w-5 h-5"
                    style={active && color ? { color } : undefined}
                  />
                </button>
              );
            })}
            {ids.length === 0 && (
              <div className="col-span-6 text-center text-sm text-muted py-4">
                Ничего не найдено.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
