// Map Zenmoney «Планы» (the raw `budget` entities from the diff — historically
// named `budget` in the API) into per-(kind, category, subcategory, month)
// planned amounts, so the Budgets page can show «план из Дзена» and sync.
//
// Per-tag, 1:1: each Zenmoney budget sits on exactly ONE tag and we keep it that
// way — a top-level tag → (category, subcategory=null); a sub-tag → (parent
// title, sub title). We DON'T roll sub-tags up to their parent and DON'T sum
// siblings, so the mapping stays reversible (needed for push-back).
//
// Only MANUAL plans are trusted: a budget counts only when it is NOT an
// auto-forecast (`isOutcomeForecast`/`isIncomeForecast` false).
//
// EFFECTIVE PLAN vs stored amount: per the API, `income`/`outcome` is the exact
// budget ONLY when the matching `*Lock` is true. When it's false, Zenmoney adds
// every PLANNED operation (reminder marker) of that month/tag on top — so the
// number the app shows = stored amount + planned ops. We fold that in here
// (see `plannedOpsByTagMonth`), otherwise a category with scheduled income (e.g.
// «Работа» with a planned salary) reads far too low (or even negative).

import type {
  ZenBudget,
  ZenInstrument,
  ZenReminderMarker,
  ZenTag,
} from "./zenmoney";

export type BudgetKind = "expense" | "income";

/** A single Zenmoney plan, resolved to our category model, for one month. */
export interface ZenPlanEntry {
  kind: BudgetKind;
  category: string;
  /** Sub-category title, or null when the plan is on the parent tag itself. */
  subcategory: string | null;
  ym: string; // "YYYY-MM"
  amount: number;
}

// NUL separator — safe because tag titles never contain it, unlike ":".
const SEP = "\u0000";

/** Lookup key for a planned amount (per tag, per month). */
export function zenPlanKey(
  kind: BudgetKind,
  category: string,
  subcategory: string | null,
  ym: string
): string {
  return [kind, category, subcategory ?? "", ym].join(SEP);
}

// The whole-month aggregate carries no category: `tag: null` OR the all-zeros
// UUID. Both must be skipped.
const NULL_TAG = "00000000-0000-0000-0000-000000000000";

/** Planned income/outcome for one (tag, month), in base currency. */
export interface PlannedOps {
  income: number;
  outcome: number;
}

/** Key into a {@link plannedOpsByTagMonth} map: raw `tagId|yyyy-MM`. */
function plannedKey(tagId: string, ym: string): string {
  return `${tagId}|${ym}`;
}

/**
 * Sum PLANNED reminder markers into per-(tag, month) income/outcome totals in
 * the user's base currency — the amount Zenmoney adds to an UNLOCKED budget to
 * form its effective plan. Only `state: 'planned'` markers count; each marker's
 * amount is converted from its own instrument to base (`amount * rate / base
 * rate`). A marker with several tags contributes to each (Zenmoney attributes
 * a planned op to every tag it carries).
 */
export function plannedOpsByTagMonth(
  markers: ZenReminderMarker[] | undefined,
  instruments: ZenInstrument[] | undefined,
  baseCurrencyId: number | undefined
): Map<string, PlannedOps> {
  const out = new Map<string, PlannedOps>();
  if (!markers || markers.length === 0) return out;
  const rateById = new Map((instruments || []).map((i) => [i.id, i.rate]));
  const baseRate =
    (baseCurrencyId != null ? rateById.get(baseCurrencyId) : undefined) || 1;
  const toBase = (amt: number, instr: number) =>
    (amt * (rateById.get(instr) ?? baseRate)) / baseRate;
  for (const m of markers) {
    if (m.state !== "planned") continue;
    const ym = (m.date || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    if (!m.tag || m.tag.length === 0) continue;
    const inc = m.income > 0 ? toBase(m.income, m.incomeInstrument) : 0;
    const outc = m.outcome > 0 ? toBase(m.outcome, m.outcomeInstrument) : 0;
    if (inc === 0 && outc === 0) continue;
    for (const tagId of m.tag) {
      const cur = out.get(plannedKey(tagId, ym)) || { income: 0, outcome: 0 };
      cur.income += inc;
      cur.outcome += outc;
      out.set(plannedKey(tagId, ym), cur);
    }
  }
  return out;
}

/**
 * Resolve a tag id to `{category, subcategory}`: a sub-tag → its parent's title
 * + own title; a top-level tag → own title + null. `null` when tag is unknown.
 */
function resolveTag(
  tagId: string,
  byId: Map<string, ZenTag>
): { category: string; subcategory: string | null } | null {
  const t = byId.get(tagId);
  if (!t) return null;
  if (t.parent) {
    const p = byId.get(t.parent);
    // Orphan sub-tag (parent missing) → treat as its own top-level category.
    return p
      ? { category: p.title, subcategory: t.title }
      : { category: t.title, subcategory: null };
  }
  return { category: t.title, subcategory: null };
}

/**
 * Flatten the cached budgets + tags into a list of per-tag plan entries.
 * Unknown tags, the whole-month aggregate, auto-forecast values and
 * zero/negative amounts are skipped.
 */
function collect(
  budgets: ZenBudget[] | undefined,
  tags: ZenTag[] | undefined,
  wantForecast: boolean,
  planned?: Map<string, PlannedOps>
): ZenPlanEntry[] {
  const out: ZenPlanEntry[] = [];
  if (!budgets || budgets.length === 0) return out;
  const byId = new Map((tags || []).map((t) => [t.id, t]));

  for (const b of budgets) {
    if (!b.tag || b.tag === NULL_TAG) continue;
    const r = resolveTag(b.tag, byId);
    if (!r) continue;
    const ym = (b.date || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    // A REAL (user-set) plan is one Zenmoney did NOT auto-forecast; a forecast
    // is one it DID — `wantForecast` picks which side we return.
    const outFc = !!b.isOutcomeForecast;
    const incFc = !!b.isIncomeForecast;
    // Effective plan: an UNLOCKED side combines the stored amount with that
    // month's planned operations; a LOCKED side is exact. Only fold into the
    // real-plan side (forecasts are already Zenmoney's own «из X» estimate).
    const p = wantForecast ? undefined : planned?.get(plannedKey(b.tag, ym));
    const outVal = b.outcomeLock ? b.outcome : b.outcome + (p?.outcome ?? 0);
    const incVal = b.incomeLock ? b.income : b.income + (p?.income ?? 0);
    if (outFc === wantForecast && outVal > 0)
      out.push({ kind: "expense", ...r, ym, amount: p ? Math.round(outVal) : outVal });
    if (incFc === wantForecast && incVal > 0)
      out.push({ kind: "income", ...r, ym, amount: p ? Math.round(incVal) : incVal });
  }
  return out;
}

export function zenPlanList(
  budgets: ZenBudget[] | undefined,
  tags: ZenTag[] | undefined,
  planned?: Map<string, PlannedOps>
): ZenPlanEntry[] {
  return collect(budgets, tags, false, planned);
}

/** Zenmoney's OWN auto-forecast amounts (the «из X» values) — used to show
 *  «≈»-планы that match Дзен, instead of computing our own median. */
export function zenForecastList(
  budgets: ZenBudget[] | undefined,
  tags: ZenTag[] | undefined
): ZenPlanEntry[] {
  return collect(budgets, tags, true);
}

/**
 * Build a `Map<key, amount>` of Zenmoney-planned amounts for quick lookup on
 * the Budgets page. Key = {@link zenPlanKey}.
 */
export function zenPlansFromBudgets(
  budgets: ZenBudget[] | undefined,
  tags: ZenTag[] | undefined,
  planned?: Map<string, PlannedOps>
): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of zenPlanList(budgets, tags, planned)) {
    out.set(zenPlanKey(e.kind, e.category, e.subcategory, e.ym), e.amount);
  }
  return out;
}

/** `Map<key, amount>` of Zenmoney's own auto-forecasts. Key = {@link zenPlanKey}. */
export function zenForecastsFromBudgets(
  budgets: ZenBudget[] | undefined,
  tags: ZenTag[] | undefined
): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of zenForecastList(budgets, tags)) {
    out.set(zenPlanKey(e.kind, e.category, e.subcategory, e.ym), e.amount);
  }
  return out;
}
