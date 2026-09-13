import type { Transaction, TxKind } from "../types";

/**
 * Tailwind text-colour class for an amount cell, by kind.
 *
 * Refunds get the accent-2 (violet) palette so they read as visually
 * distinct from income (green). Important — a refund is a cash inflow
 * on the account but logically a *reversal* of an earlier expense; the
 * user shouldn't mistake it for new revenue at a glance.
 */
export function kindColorClass(kind: TxKind): string {
  switch (kind) {
    case "income":
      return "text-income";
    case "expense":
      return "text-expense";
    case "refund":
      return "text-accent2";
    default:
      // Перевод — ни доход, ни расход: приглушённым серым, а не цветом
      // стороны и не основным текстом. Токен `muted`, а не `slate-400` из
      // палитры Tailwind: палитра не знает о теме.
      return "text-muted";
  }
}

/**
 * Цвет суммы операции для таблиц (`Tone` из табличного стандарта): тот же
 * смысл, что у `kindColorClass`, но словом, а не классом — класс таблица
 * подставит сама.
 */
export function kindTone(kind: TxKind): "income" | "expense" | "accent2" | "muted" {
  switch (kind) {
    case "income":
      return "income";
    case "expense":
      return "expense";
    case "refund":
      return "accent2";
    default:
      return "muted";
  }
}

/**
 * Prefix glyph for the amount column.
 *   +  income, −  expense, ↔  transfer, ↩  refund
 */
export function kindSignGlyph(kind: TxKind): string {
  switch (kind) {
    case "income":
      return "+";
    case "expense":
      return "−";
    case "refund":
      return "↩";
    default:
      return "↔"; // transfer
  }
}

/**
 * Extra classes for the prefix glyph span. Needed because the `↩`
 * Unicode arrow renders with its baseline near the top of the
 * cap-height in most fonts — i.e. it sits visually too high next to
 * the digits. We nudge it down a couple of pixels so it reads as
 * centred on the amount text. The other glyphs (+ − ↔) sit fine on
 * their own baseline, so they get no offset.
 */
export function kindGlyphClass(kind: TxKind): string {
  return kind === "refund" ? "inline-block relative top-[2px]" : "";
}

/**
 * Цвет суммы операции в ленте и таблицах: долг — жёлтым, как в редакторе
 * операции; остальное — по виду операции.
 */
export function operationTone(
  tx: Pick<Transaction, "kind" | "category">
): "income" | "expense" | "accent2" | "muted" | "warn" {
  return tx.category === "Долг" ? "warn" : kindTone(tx.kind);
}

// ─── refund-aware math helpers ────────────────────────────────────────────────

/**
 * True when a transaction's kind affects an expense category total —
 * either as a positive spend (`expense`) or as a negative reversal
 * (`refund`). Use this instead of `kind === "expense"` whenever you
 * want refunds to flow through the same aggregation as the original
 * expense (drill-down lists, category totals, hashtag/day buckets,
 * budgets, etc.).
 */
export function affectsExpense(kind: TxKind): boolean {
  return kind === "expense" || kind === "refund";
}

/**
 * Signed contribution to an expense bucket: `+amountBase` for an
 * expense, `-amountBase` for a refund, `0` for anything else.
 * Lets `sum += expenseDelta(t)` replace the
 * `if (expense) sum += a; else if (refund) sum -= a;` pattern.
 */
export function expenseDelta(t: Transaction): number {
  if (t.kind === "expense") return t.amountBase;
  if (t.kind === "refund") return -t.amountBase;
  return 0;
}

/**
 * Signed contribution to an account balance: positive for inflows
 * (`income`, `refund`), negative for `expense`, `0` for transfer
 * (transfers are zero-sum across accounts; if you need per-account
 * deltas use `outcomeAccount`/`incomeAccount` directly).
 */
export function cashDelta(t: Transaction): number {
  if (t.kind === "income" || t.kind === "refund") return t.amountBase;
  if (t.kind === "expense") return -t.amountBase;
  return 0;
}

/** Short human-readable name for the kind (used in tooltips, etc.). */
export function kindLabel(kind: TxKind): string {
  switch (kind) {
    case "income":
      return "доход";
    case "expense":
      return "расход";
    case "refund":
      return "возврат";
    default:
      return "перевод";
  }
}
