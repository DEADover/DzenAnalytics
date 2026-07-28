// Pure mapper: turn a Zenmoney diff response into our internal model.
//
// Conventions in Zenmoney:
// - Currency rates are expressed as "1 unit of foreign currency = `rate` RUB",
//   which matches our `CurrencyRates` convention (`1 X = N base`, base=RUB).
// - Tag hierarchy is one level deep: a tag may have `parent` pointing to a
//   parent tag. We surface this as category + subcategory and a slash-joined
//   `categoryFull` so it lines up with our CSV mapping.
// - `transaction.tag` is an array of tag IDs (multi-tagging). We treat the
//   first entry as the primary category.

import type { Transaction, CurrencyRates } from "../types";
import type {
  ZenDiffResponse,
  ZenAccount,
  ZenTag,
  ZenInstrument,
} from "./zenmoney";
import { SYNTHETIC_CATEGORY_COLORS } from "./categoryColor";

/**
 * Label for an operation with NO category. Zenmoney has no «uncategorized» tag —
 * a tag-less transaction (`tag: null`) is simply shown as «Без категории». We
 * surface it under this exact title, and the reverse mapper treats a category
 * edit back to this title as «clear the tag» (`tag: null`), not a tag lookup.
 */
export const NO_CATEGORY = "Без категории";

export interface CategoryMeta {
  /** CSS rgb() string or null when the tag has no colour set. */
  color: string | null;
  /** Raw Zenmoney icon id (e.g. "5001_coat"). No public URL pattern yet, kept for future. */
  icon: string | null;
  /** Optional picture URL — set rarely. */
  picture: string | null;
  /** Tag is offered as a candidate for income transactions. */
  showIncome?: boolean;
  /** Tag is offered as a candidate for expense transactions. */
  showOutcome?: boolean;
  /** Zenmoney «обязательная» flag (`tag.required`). `true`/`null`/absent =
   *  mandatory (the default — Zenmoney treats null as mandatory), only an
   *  explicit `false` = optional. Drives needs/wants on the 50/30/20 page
   *  (need = `required !== false`). Used without manual marking. */
  required?: boolean | null;
}

export interface MappedDiff {
  transactions: Transaction[];
  rates: CurrencyRates;
  // Totals for status display
  accountsTotal: number;
  accountsActive: number;
  tagsTotal: number;
  baseCurrency: string;
  // For optional calibration helper (sum of startBalances of active accounts in base)
  startBalanceTotal: number;
  // Sum of *current* balances of active accounts in base — used for auto-calibration
  currentBalanceTotal: number;
  /** Tag title → meta (colour / icon / picture) for use in UI. */
  categoryMeta: Record<string, CategoryMeta>;
}

/**
 * Decode `tag.color` (a packed colour int) to a CSS rgb() string, or null when
 * no colour is set.
 *
 * The RGB lives in the LOW 24 bits; the top (alpha) byte is NOT reliable —
 * Zenmoney stores most colours as plain RGB with a zero alpha byte (a small
 * positive int like 4499017 → #44a649), and only some with full alpha 0xFF
 * (a large/negative int). So we mirror the reference client (Zerro): ignore
 * the alpha byte entirely and decode the low 24 bits for any non-null value.
 *
 * Previously we nulled out on `alpha === 0`, which silently dropped the real
 * colour of the majority of categories for such users — they fell back to the
 * synthetic hash palette and looked nothing like Zenmoney. Only `null`/absent
 * means "no colour".
 */
function colorIntToCss(c: number | null | undefined): string | null {
  if (c == null) return null;
  const r = (c >>> 16) & 0xff;
  const g = (c >>> 8) & 0xff;
  const b = c & 0xff;
  return `rgb(${r}, ${g}, ${b})`;
}

function buildCategory(
  tagIds: string[] | null,
  tagsById: Map<string, ZenTag>
): { category: string; subcategory: string | null; full: string } {
  if (!tagIds || tagIds.length === 0) {
    return { category: NO_CATEGORY, subcategory: null, full: NO_CATEGORY };
  }
  const tag = tagsById.get(tagIds[0]);
  if (!tag) {
    return { category: NO_CATEGORY, subcategory: null, full: NO_CATEGORY };
  }
  const parent = tag.parent ? tagsById.get(tag.parent) : null;
  if (parent) {
    return {
      category: parent.title,
      subcategory: tag.title,
      full: `${parent.title} / ${tag.title}`,
    };
  }
  return { category: tag.title, subcategory: null, full: tag.title };
}

export function mapZenmoneyDiff(diff: ZenDiffResponse): MappedDiff {
  // Defensive defaults — the API can omit whole sections (e.g. on a
  // brand-new account with no transactions yet, `transaction` simply
  // isn't in the response). Falling back to `[]` keeps the mapper
  // iterable instead of crashing with "X is not iterable".
  const txList = diff.transaction || [];
  const accountList = diff.account || [];
  const tagList = diff.tag || [];
  const instrumentList = diff.instrument || [];
  const merchantList = diff.merchant || [];
  const userList = diff.user || [];

  const accountsById = new Map<string, ZenAccount>(
    accountList.map((a) => [a.id, a])
  );
  const tagsById = new Map<string, ZenTag>(tagList.map((t) => [t.id, t]));
  const instrumentsById = new Map<number, ZenInstrument>(
    instrumentList.map((i) => [i.id, i])
  );
  // Merchant dictionary — the USER'S OWN контрагенты (`{id, user, title}`),
  // not a curated catalogue: Дзен has no global brand list. (Its only global
  // dictionary is `company`, a registry of banks behind `Account.company`.)
  // A transaction's `merchant` id points in here; we resolve it to the title
  // and store it on `Transaction.brand`.
  const merchantsById = new Map<string, string>(
    merchantList.map((m) => [m.id, m.title])
  );

  // Base currency comes from the user record (instrument id of their default).
  const userCurrencyId = userList[0]?.currency;
  const userInstrument = userCurrencyId
    ? instrumentsById.get(userCurrencyId)
    : null;
  const baseCurrency = userInstrument?.shortTitle || "RUB";

  // Build rates relative to base. In Zenmoney, `instrument.rate` is "1 X = rate RUB",
  // so we first normalise everything against RUB, then re-anchor to the user's base
  // if it isn't RUB.
  const ratesVsRub: Record<string, number> = {};
  for (const instr of instrumentList) {
    ratesVsRub[instr.shortTitle] = instr.rate;
  }
  const baseToRub = ratesVsRub[baseCurrency] || 1;
  const rates: CurrencyRates = {
    base: baseCurrency,
    rates: Object.fromEntries(
      Object.entries(ratesVsRub).map(([cur, r]) => [
        cur,
        cur === baseCurrency ? 1 : Math.round((r / baseToRub) * 1e6) / 1e6,
      ])
    ),
  };

  const toBase = (amount: number, currency: string): number => {
    if (currency === baseCurrency) return amount;
    const r = rates.rates[currency];
    return r ? amount * r : amount;
  };

  const txs: Transaction[] = [];
  for (const zt of txList) {
    if (zt.deleted) continue;

    const outcome = zt.outcome || 0;
    const income = zt.income || 0;
    if (outcome === 0 && income === 0) continue;

    const outAcc = accountsById.get(zt.outcomeAccount);
    const inAcc = accountsById.get(zt.incomeAccount);
    const outInstr = instrumentsById.get(zt.outcomeInstrument);
    const inInstr = instrumentsById.get(zt.incomeInstrument);

    const outCurrency = outInstr?.shortTitle || baseCurrency;
    const inCurrency = inInstr?.shortTitle || baseCurrency;

    let kind: Transaction["kind"];
    let amount: number;
    let currency: string;
    let account: string;

    const isTransfer =
      outcome > 0 && income > 0 && zt.outcomeAccount !== zt.incomeAccount;

    if (isTransfer) {
      kind = "transfer";
      amount = outcome;
      currency = outCurrency;
      account = outAcc?.title || "";
    } else if (outcome > 0) {
      kind = "expense";
      amount = outcome;
      currency = outCurrency;
      account = outAcc?.title || "";
    } else {
      kind = "income";
      amount = income;
      currency = inCurrency;
      account = inAcc?.title || "";

      // Refund detection: an income-side movement tagged with an
      // *expense* category (a tag whose `showOutcome` is on while
      // `showIncome` is off) is semantically a refund — money coming
      // back from a previous purchase, not new income. Zenmoney shows
      // these as "Возврат" and subtracts them from the category's
      // expense total. We mirror that by classifying as `kind=refund`
      // and letting the aggregations treat the amount as a negative
      // expense rather than positive income. Tags with both flags on
      // (rare, e.g. a custom dual-purpose tag) stay as `income`.
      const firstTag = zt.tag && zt.tag.length > 0 ? tagsById.get(zt.tag[0]) : null;
      if (firstTag && firstTag.showOutcome && !firstTag.showIncome) {
        kind = "refund";
      }
    }

    // Bank-original operation currency/amount — only when the bank converted
    // currencies for us (opOutcomeInstrument ≠ outcomeInstrument).
    // Expense / transfer: use the outcome leg; income: use the income leg.
    const opRawAmount = kind === "income" ? zt.opIncome : zt.opOutcome;
    const opRawInstrId = kind === "income" ? zt.opIncomeInstrument : zt.opOutcomeInstrument;
    const opRawInstr = opRawInstrId != null ? instrumentsById.get(opRawInstrId) : null;
    const opCurrencyResolved = opRawInstr?.shortTitle ?? null;
    const opAmountResolved =
      opRawAmount != null && opCurrencyResolved != null && opCurrencyResolved !== currency
        ? opRawAmount
        : null;

    const cat = buildCategory(zt.tag, tagsById);
    // Display-only overrides. The transaction's tag/category from Zenmoney is
    // preserved in `*Original` fields below (for category rules to match
    // against), but the visible `category` / `categoryFull` are forced to our
    // local-only labels for two systemically-miscategorised cases:
    //
    //   "Долг"    — anything touching a loan/credit/debt account, including
    //               transfers in or out of that account (paying off, taking
    //               on, paying interest, etc.). Takes priority over Перевод
    //               so loan payments don't look like generic transfers.
    //   "Перевод" — kind=transfer that doesn't involve a debt account.
    //
    // These never round-trip to Zenmoney — there's no push code path. The
    // original tag is kept in `*Original` for rules, search, and reset.
    const DEBT_TYPES = ["loan", "credit", "debt"];
    const involvesDebt =
      DEBT_TYPES.includes(outAcc?.type || "") ||
      DEBT_TYPES.includes(inAcc?.type || "");
    let display = cat;
    if (involvesDebt) {
      display = { category: "Долг", subcategory: null, full: "Долг" };
    } else if (isTransfer) {
      display = { category: "Перевод", subcategory: null, full: "Перевод" };
    }

    // `applyCategoryRules` later in the pipeline resets `category` to
    // `categoryOriginal` whenever no enabled rule matches, so to keep our
    // local "Перевод"/"Долг" labels visible we have to write them into the
    // original fields too. That's fine because in practice the source Zen
    // tag for these flows is empty/"Без категории" anyway — nothing of value
    // gets shadowed. None of this leaves the device: there's no push code.
    txs.push({
      id: zt.id,
      date: zt.date,
      category: display.category,
      subcategory: display.subcategory,
      categoryFull: display.full,
      categoryOriginal: display.category,
      subcategoryOriginal: display.subcategory,
      categoryFullOriginal: display.full,
      payee: zt.payee || "",
      payeeOriginal: zt.payee || "",
      // Raw bank-statement text — the unmodified value. Captured here
      // for info only (Edit-modal hint, debugging weird names). NOT
      // used by the payee-grouping pipeline; that still operates on
      // `payeeOriginal` so the user's Zenmoney-side fixes survive a
      // re-sync.
      payeeRaw: zt.originalPayee || null,
      // Resolve brand from the merchant dictionary. `zt.merchant` is
      // an id pointing into `merchantsById`; null when Zenmoney hasn't
      // attached a brand (older transactions, ones the user explicitly
      // un-branded, or pre-brand-feature data).
      brand: zt.merchant ? merchantsById.get(zt.merchant) || null : null,
      comment: zt.comment || "",
      outcomeAccount: outAcc?.title || "",
      outcomeAmount: outcome,
      outcomeCurrency: outCurrency,
      incomeAccount: inAcc?.title || "",
      incomeAmount: income,
      incomeCurrency: inCurrency,
      kind,
      amount,
      currency,
      account,
      amountBase: toBase(amount, currency),
      opAmount: opAmountResolved,
      opCurrency: opAmountResolved != null ? opCurrencyResolved : null,
      createdAt: zt.created
        ? new Date(zt.created * 1000).toISOString()
        : `${zt.date}T00:00:00Z`,
      // `viewed: false` — операция приехала из банка и её ещё не открывали.
      // Храним инверсию: «новая» читается лучше, чем «не просмотренная», и
      // отсутствие поля (CSV) не превращается в «новая».
      unseen: zt.viewed === false,
    });
  }

  // Sort by date for predictable ordering.
  txs.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt < b.createdAt ? -1 : 1
  );

  // Active accounts = !archive && inBalance (those a user would think of as "their money")
  const activeAccounts = accountList.filter((a) => !a.archive && a.inBalance);
  const startBalanceTotal = activeAccounts.reduce((s, a) => {
    const instr = instrumentsById.get(a.instrument);
    const cur = instr?.shortTitle || baseCurrency;
    return s + toBase(a.startBalance || 0, cur);
  }, 0);
  const currentBalanceTotal = activeAccounts.reduce((s, a) => {
    const instr = instrumentsById.get(a.instrument);
    const cur = instr?.shortTitle || baseCurrency;
    return s + toBase(a.balance || 0, cur);
  }, 0);

  // Build category meta keyed by tag title for UI lookups (dots, treemap, …).
  // Multiple sub-tags can share a parent title — we'd rather have at least
  // one colour set than none, so the first non-null wins.
  const categoryMeta: Record<string, CategoryMeta> = {};
  for (const tag of tagList) {
    if (tag.archive) continue;
    const cur = categoryMeta[tag.title];
    const color = colorIntToCss(tag.color);
    // Aggregate `showIncome` / `showOutcome` across sub-tags with the
    // same title — if any sibling is allowed for income (or expense),
    // the parent name should be too. This matters when a "Прочее" tag
    // exists under both an income and an expense parent.
    const nextShowIncome = (cur?.showIncome ?? false) || !!tag.showIncome;
    const nextShowOutcome = (cur?.showOutcome ?? false) || !!tag.showOutcome;
    // `required` belongs to the category: the top-level (no-parent) tag is
    // authoritative; a child only fills it if nothing's set yet.
    const nextRequired = !tag.parent ? tag.required : cur?.required ?? tag.required;
    if (!cur || (!cur.color && color)) {
      categoryMeta[tag.title] = {
        color,
        icon: tag.icon || null,
        picture: tag.picture || null,
        showIncome: nextShowIncome,
        showOutcome: nextShowOutcome,
        required: nextRequired,
      };
    } else {
      // Keep existing colour/icon but update the show-flags + required.
      cur.showIncome = nextShowIncome;
      cur.showOutcome = nextShowOutcome;
      if (!tag.parent) cur.required = tag.required;
      else if (cur.required == null) cur.required = tag.required;
    }
    // Sub-categories also get a FULL-PATH entry («Родитель / Тег») so that two
    // subs with the same title under different parents keep their own icon /
    // colour (the title-keyed entry above collides — first one wins).
    if (tag.parent) {
      const parent = tagsById.get(tag.parent);
      if (parent) {
        categoryMeta[`${parent.title} / ${tag.title}`] = {
          color,
          icon: tag.icon || null,
          picture: tag.picture || null,
          showIncome: !!tag.showIncome,
          showOutcome: !!tag.showOutcome,
          required: tag.required,
        };
      }
    }
  }
  // Our local-only labels — seed from the shared synthetic palette so charts
  // (which read `categoryMeta`) and CategoryDot agree on their colour.
  if (!categoryMeta["Перевод"]) {
    categoryMeta["Перевод"] = { color: SYNTHETIC_CATEGORY_COLORS["Перевод"], icon: null, picture: null };
  }
  if (!categoryMeta["Долг"]) {
    categoryMeta["Долг"] = { color: SYNTHETIC_CATEGORY_COLORS["Долг"], icon: null, picture: null };
  }

  return {
    transactions: txs,
    rates,
    accountsTotal: accountList.length,
    accountsActive: activeAccounts.length,
    tagsTotal: tagList.length,
    baseCurrency,
    startBalanceTotal,
    currentBalanceTotal,
    categoryMeta,
  };
}
