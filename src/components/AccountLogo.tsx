import { useMemo } from "react";
import { HandCoins } from "lucide-react";
import { resolveBrand, type BankBrand } from "../lib/bankRegistry";
import { hueFromString } from "../lib/colorHash";

// Vite auto-discovers any SVG file dropped into `src/assets/bank-logos/`.
// Filename (without extension) must match the `slug` of the registry
// entry — e.g. `sber.svg` is used for the Сбер brand. When a file is
// present, it overrides the coloured-monogram fallback below.
//
// `eager: true` inlines the URLs at build time, so resolution is O(1)
// and the standalone single-file release also picks them up.
const logoUrls = import.meta.glob("../assets/bank-logos/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function logoUrlForSlug(slug: string): string | null {
  return logoUrls[`../assets/bank-logos/${slug}.svg`] ?? null;
}

interface Props {
  /** Account title — used to resolve the brand by pattern matching. */
  title: string;
  /** Optional Zenmoney account type, e.g. "loan" / "credit" / "debt". */
  type?: string;
  /**
   * CSS size in px. Defaults to 24, matching the existing
   * `AccountAvatar` footprint inside dashboard tables.
   */
  size?: number;
  /** Optional className to tweak rounding / margins from the call site. */
  className?: string;
}

/**
 * Coloured monogram badge for a bank/payment account.
 *
 * Resolution priority:
 *   1. SVG file at `src/assets/bank-logos/<slug>.svg` (if present)
 *   2. Brand registry entry → coloured square with monogram
 *   3. Generic title-derived initial-on-colour avatar (fallback)
 *
 * Loans / credits get a muted grey treatment regardless of which path is
 * taken — the visual reads "не свои деньги" at a glance.
 */
export function AccountLogo({ title, type = "", size = 24, className = "" }: Props) {
  const brand: BankBrand | null = useMemo(() => resolveBrand(title), [title]);
  const overrideSvg = useMemo(
    () => (brand ? logoUrlForSlug(brand.slug) : null),
    [brand]
  );

  const isDebt = type === "loan" || type === "credit" || type === "debt";

  // 1) Real SVG provided — render it as-is. Debt accounts get reduced
  //    opacity to keep the "not-my-money" semantic visible.
  if (overrideSvg) {
    return (
      <img
        src={overrideSvg}
        alt={brand?.name || title}
        title={brand?.name || title}
        width={size}
        height={size}
        className={`rounded-md shrink-0 ${isDebt ? "opacity-60" : ""} ${className}`}
      />
    );
  }

  const dimStyle: React.CSSProperties = {
    width: size,
    height: size,
    // Use a tight clamp so the monogram never overflows the badge on
    // 2–3-character entries like "ВТБ" / "МКБ" / "БКС".
    fontSize: Math.max(9, Math.round(size * 0.42)),
  };

  // 2) Known brand — use the registry's colour + monogram.
  if (brand) {
    return (
      <span
        aria-label={brand.name}
        title={brand.name}
        className={`rounded-md shrink-0 inline-flex items-center justify-center font-semibold leading-none tracking-tight ${isDebt ? "opacity-60" : ""} ${className}`}
        style={{
          ...dimStyle,
          background: brand.color,
          color: brand.fg,
        }}
      >
        {brand.monogram}
      </span>
    );
  }

  // 2b) Debt / loan / credit accounts with no brand match: render a
  //     dedicated coins-in-hand glyph on a muted background so they don't
  //     fall through to a generic letter avatar. The title is preserved
  //     in the tooltip so the user can still tell debts apart.
  if (isDebt) {
    return (
      <span
        aria-label={title || "Долг"}
        title={title || "Долг"}
        className={`rounded-md shrink-0 inline-flex items-center justify-center bg-panel2 text-muted border border-border/60 ${className}`}
        style={{ width: size, height: size }}
      >
        <HandCoins
          style={{ width: Math.round(size * 0.6), height: Math.round(size * 0.6) }}
        />
      </span>
    );
  }

  // 3) Fallback: deterministic hue derived from the title so the same
  //    account always gets the same colour, but unrelated accounts look
  //    different from each other.
  const hue = hueFromString(title);
  const bg = isDebt ? "rgb(var(--c-panel2))" : `hsl(${hue} 70% 92%)`;
  const fg = isDebt ? "rgb(var(--c-muted))" : `hsl(${hue} 50% 35%)`;
  const first = (title.trim()[0] || "?").toUpperCase();
  return (
    <span
      aria-label={title}
      title={title}
      className={`rounded-full shrink-0 inline-flex items-center justify-center font-semibold leading-none ${className}`}
      style={{
        ...dimStyle,
        background: bg,
        color: fg,
      }}
    >
      {first}
    </span>
  );
}
