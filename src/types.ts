export type Currency = "RUB" | "USD" | "CNY" | "TRY" | string;

/**
 * Kinds of money movement we track.
 *
 *   • expense  — money out, classifies into expense KPIs and category totals.
 *   • income   — money in, classifies into income KPIs.
 *   • transfer — between two of the user's own accounts, neutral on net.
 *   • refund   — money back from a previous expense (returned purchase,
 *                cashback within an expense category, etc.). Renders as
 *                an inflow on the account, but aggregates as a *negative
 *                expense* on the original category — i.e. it shrinks the
 *                category's spend, never inflates income totals.
 *                Zenmoney encodes refunds as `income > 0` transactions
 *                tagged with an *expense* category (a tag whose
 *                `showOutcome` flag is on). See `zenmoneyMap.ts`.
 */
export type TxKind = "expense" | "income" | "transfer" | "refund";

export interface RawRow {
  date: string;
  categoryName: string;
  payee: string;
  comment: string;
  outcomeAccountName: string;
  outcome: string;
  outcomeCurrencyShortTitle: string;
  incomeAccountName: string;
  income: string;
  incomeCurrencyShortTitle: string;
  createdDate: string;
  changedDate: string;
  qrCode: string;
}

export interface Transaction {
  id: string;
  date: string;
  category: string;
  subcategory: string | null;
  categoryFull: string;
  categoryOriginal?: string;
  subcategoryOriginal?: string | null;
  categoryFullOriginal?: string;
  payee: string;
  payeeOriginal?: string;
  /**
   * Raw payee text exactly as the bank printed it
   * (`ZenTransaction.originalPayee` from the API). Immutable —
   * never modified by any pipeline. Useful as a "trust but verify"
   * hint in the Edit modal when the user wonders where a weird name
   * came from. Null on CSV imports (we only see one already-cleaned
   * column there) and on transactions that pre-date Zenmoney's
   * `originalPayee` field.
   */
  payeeRaw?: string | null;
  /**
   * Counterparty title from the user's OWN Zenmoney merchant dictionary
   * (`ZenTransaction.merchant` → `ZenMerchant.title`) — Дзен has no global
   * brand catalogue, so this is whatever the user accumulated. Different from
   * `payee` — payee is what's currently displayed (possibly cleaned
   * by Zenmoney auto-grouping or our local pipeline), brand is the
   * specific merchant entity the user / Zenmoney tagged the
   * transaction with. Null when there's no brand attached. CSV
   * imports always have null — only the API populates this field.
   */
  brand?: string | null;
  comment: string;
  outcomeAccount: string;
  outcomeAmount: number;
  outcomeCurrency: Currency;
  incomeAccount: string;
  incomeAmount: number;
  incomeCurrency: Currency;
  kind: TxKind;
  amount: number;
  currency: Currency;
  account: string;
  amountBase: number;
  /** Bank-original operation amount when the bank converted currencies
   *  (e.g. 5 000 TRY on a USD account). Null when op currency = account currency. */
  opAmount: number | null;
  /** ISO code of the bank-original operation currency. */
  opCurrency: string | null;
  createdAt: string;
}

export interface CurrencyRates {
  base: Currency;
  rates: Record<Currency, number>;
}

export type DataSource = "csv" | "api";

export interface ImportMeta {
  importedAt: string;
  fileName: string;
  totalRows: number;
  parsed: number;
  skipped: number;
  /** Where this data came from. CSV-imported and API-synced datasets are mutually exclusive. */
  source?: DataSource;
}
