import { useEffect, type ComponentType } from "react";
import { HandCoins, ArrowLeftRight } from "lucide-react";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { zenIconToLucide } from "../lib/zenIconLucide";
import { SYNTHETIC_CATEGORY_COLORS, fallbackColorForName } from "../lib/categoryColor";

interface Props {
  category: string;
  /** Parent category — when set, the icon/colour is resolved by the full path
   *  «Parent / category» first, so two same-named sub-categories under
   *  different parents keep their own Zenmoney icon. */
  parent?: string;
  /** Tailwind size for the round wrapper. Default w-5 h-5. */
  size?: string;
  /** Fallback colour when the category has no meta — defaults to muted. */
  fallback?: string | null;
  /** Hide the dot/badge entirely when there is no colour AND no icon. */
  hideEmpty?: boolean;
}

/**
 * Synthetic categories the mapper produces locally — never present in
 * `categoryMeta` from Zenmoney, so without an explicit fallback they'd
 * render as nothing. Each entry: an icon component + the badge colour.
 *
 * (See `lib/zenmoneyMap.ts` — categories "Долг" and "Перевод" are
 * forced for transfer / debt-related transactions.)
 */
const SYNTHETIC_CATEGORIES: Record<
  string,
  { icon: ComponentType<{ className?: string }>; color: string }
> = {
  Долг: { icon: HandCoins, color: SYNTHETIC_CATEGORY_COLORS["Долг"] },
  Перевод: { icon: ArrowLeftRight, color: SYNTHETIC_CATEGORY_COLORS["Перевод"] },
  // Статья бюджета — во множественном числе; значок и цвет те же.
  Переводы: { icon: ArrowLeftRight, color: SYNTHETIC_CATEGORY_COLORS["Переводы"] },
};

/**
 * Small coloured badge next to a category label. When the Zenmoney sync has
 * populated `categoryMeta` (icon + colour from the API tag), it renders a
 * coloured circle with the emoji glyph for the icon. With colour only — a
 * plain coloured disc. With nothing — null (or a muted fallback dot).
 *
 * For our two synthetic categories (Долг, Перевод) — where the API doesn't
 * supply meta — we fall back to a Lucide glyph on a brand-coloured circle.
 */
export function CategoryDot({
  category,
  parent,
  size = "w-5 h-5",
  fallback = null,
  hideEmpty = false,
}: Props) {
  // Resolve by full path «Parent / category» when a parent is given (distinct
  // icon per sub), falling back to the bare title.
  const fullKey = parent ? `${parent} / ${category}` : category;
  const meta = useCategoryMetaStore((s) => s.meta[fullKey] ?? s.meta[category]);
  // A sub-tag without its own colour inherits the parent's, so a category and
  // its children read as one family (matches the legend's explicit fallback).
  const parentColor = useCategoryMetaStore((s) =>
    parent ? s.meta[parent]?.color ?? null : null
  );
  const loaded = useCategoryMetaStore((s) => s.loaded);
  const hydrate = useCategoryMetaStore((s) => s.hydrate);
  useEffect(() => {
    if (!loaded) hydrate();
  }, [loaded, hydrate]);

  // Synthetic category fallback (Долг / Перевод).
  //
  // We don't gate on `meta.color` here — the mapper deliberately seeds
  // `categoryMeta` with neutral grey for both names so legacy code that
  // expects a colour doesn't see undefined, but that meant the
  // "color-only" branch would beat our icon. We *do* defer to a real
  // `meta.icon` (an emoji set by the user on a Zenmoney tag of the same
  // name would win), but if there isn't one, render the Lucide glyph.
  const synthetic = parent ? undefined : SYNTHETIC_CATEGORIES[category];
  if (synthetic && !meta?.icon) {
    const Icon = synthetic.icon;
    return (
      <span
        aria-hidden
        className={`inline-flex items-center justify-center rounded-full shrink-0 text-white ${size}`}
        style={{ background: synthetic.color }}
      >
        <Icon className="w-3/5 h-3/5" />
      </span>
    );
  }

  // API colour first, then any explicit fallback, then a DETERMINISTIC colour
  // from the name — so every category gets a stable, consistent swatch even
  // when Zenmoney didn't assign one (or in CSV mode). `hideEmpty` still wins
  // for callers that genuinely want nothing when there's no real meta.
  // A stable module-level lookup (always the same component for a given icon
  // id), not a component created per render.
  const Icon = zenIconToLucide(meta?.icon);
  const color =
    meta?.color ?? fallback ?? parentColor ?? (hideEmpty ? null : fallbackColorForName(fullKey));

  if (!color && !Icon) {
    return null;
  }

  // With an icon → coloured circle + white Lucide glyph inside (zerro-style).
  // Without an icon → just a plain coloured dot.
  if (Icon) {
    return (
      <span
        aria-hidden
        className={`inline-flex items-center justify-center rounded-full shrink-0 text-white ${size}`}
        style={{ background: color || "rgb(148, 163, 184)" }}
      >
        {/* eslint-disable-next-line react-hooks/static-components -- stable lookup */}
        <Icon className="w-3/5 h-3/5" strokeWidth={2.25} />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className={`inline-block rounded-full shrink-0 ${size}`}
      style={{ background: color! }}
    />
  );
}
