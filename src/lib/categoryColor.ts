// Single source of truth for category colours, so the SAME category looks the
// same everywhere (donut, treemap, bars, stream, trends, sankey, dots, drawer).
//
// Priority:
//   1. Zenmoney API tag colour (from `categoryMeta`, decoded in zenmoneyMap.ts);
//   2. a fixed colour for the two synthetic categories (Перевод / Долг);
//   3. a DETERMINISTIC palette colour hashed from the name — stable across
//      sessions and filter changes (unlike the old by-position colouring).

/** Shared fallback palette (also fine as a generic chart palette). */
export const CATEGORY_PALETTE = [
  "#22D3EE", "#A78BFA", "#F59E0B", "#10B981", "#EF4444",
  "#EC4899", "#3B82F6", "#84CC16", "#F97316", "#14B8A6",
  "#8B5CF6", "#06B6D4", "#FBBF24", "#34D399", "#F472B6",
];

/** Local-only synthetic categories the mapper mints (no real Zenmoney tag).
 *  «Без категории» / «Прочие» get a neutral grey so «нет категории» doesn't
 *  read as a real, vivid category. */
export const SYNTHETIC_CATEGORY_COLORS: Record<string, string> = {
  // Переводы между своими счетами — не доход/расход, поэтому нейтральный серый.
  Перевод: "#64748B",
  Долг: "#64748B",
  "Без категории": "#94A3B8",
  Прочие: "#94A3B8",
};

function hashIndex(s: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % mod;
}

/** Deterministic colour from the name alone — used when there's no API colour.
 *  Stable: the same name always maps to the same palette entry. */
export function fallbackColorForName(name: string): string {
  return SYNTHETIC_CATEGORY_COLORS[name] ?? CATEGORY_PALETTE[hashIndex(name, CATEGORY_PALETTE.length)];
}

/** Resolve a category's colour: API colour first, then the deterministic
 *  fallback. `meta` is the `categoryMeta` map (title → { color }). */
export function colorForCategory(
  name: string,
  meta: Record<string, { color?: string | null } | undefined>
): string {
  return meta[name]?.color || fallbackColorForName(name);
}

/** A subcategory's OWN Zenmoney colour, looked up by its full path
 *  «Родитель / Подкатегория» — or `null` when the sub has no explicit colour.
 *  Charts use this so a subcategory with its own colour in Дзен-мани shows it,
 *  and only sub-categories WITHOUT one fall back to a tint of the parent
 *  (issue #17 — don't flatten everything to the parent colour, but also don't
 *  invent a rainbow for subs that never got a colour). */
export function subcategoryColor(
  fullName: string | undefined,
  meta: Record<string, { color?: string | null } | undefined>
): string | null {
  return (fullName && meta[fullName]?.color) || null;
}

// ── Color codec for the category editor ──────────────────────────────────────
// Zenmoney stores a tag's colour as a packed RGB integer in the low 24 bits
// (see `colorIntToCss` in zenmoneyMap.ts). Its own tags commonly carry an alpha
// byte of 0, so a plain `0xRRGGBB` positive int matches Zenmoney's format and
// round-trips through the decoder. These are the encode/decode helpers the
// editor uses to translate between a `#RRGGBB` hex and that int.

/** Swatch palette for the color picker (roughly the Zenmoney/Budgera set). */
export const CATEGORY_EDIT_PALETTE = [
  "#EF4444", "#F97316", "#FBBF24", "#86EFAC", "#22C55E", "#166534",
  "#0D9488", "#2DD4BF", "#38BDF8", "#0EA5E9", "#2563EB", "#818CF8",
  "#6D28D9", "#A21CAF", "#DB2777", "#F472B6", "#94A3B8", "#3F3F46",
];

/** `#RRGGBB` (or `RRGGBB`) → Zenmoney packed RGB int, or null if malformed. */
export function hexToColorInt(hex: string): number | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  // 0xRRGGBB, alpha byte 0 — the format the majority of Zenmoney tags use.
  return parseInt(m[1], 16);
}

/** Zenmoney packed colour int → `#RRGGBB`, or null when there's no colour. */
export function colorIntToHex(c: number | null | undefined): string | null {
  if (c == null) return null;
  const r = (c >>> 16) & 0xff;
  const g = (c >>> 8) & 0xff;
  const b = c & 0xff;
  return (
    "#" +
    [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase()
  );
}

/** CSS `rgb(r, g, b)` (as produced by `colorIntToCss`) → `#RRGGBB`, for
 *  seeding the picker from an already-decoded `categoryMeta.color`. */
export function cssRgbToHex(css: string | null | undefined): string | null {
  if (!css) return null;
  const m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(css.trim());
  if (!m) return /^#[0-9a-fA-F]{6}$/.test(css.trim()) ? css.trim().toUpperCase() : null;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => Number(x));
  return (
    "#" +
    [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase()
  );
}
