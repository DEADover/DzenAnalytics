import Papa from "papaparse";
import type { RawRow, Transaction, CurrencyRates } from "../types";
import { roundMoney } from "./money";

function makeId(row: RawRow, idx: number): string {
  return `${row.createdDate || row.date}-${idx}-${row.payee?.slice(0, 20) || ""}`;
}

function parseAmount(v: string): number {
  if (!v) return 0;
  const cleaned = v.replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function splitCategory(raw: string): { category: string; subcategory: string | null; full: string } {
  const full = (raw || "").trim();
  if (!full) return { category: "Без категории", subcategory: null, full: "Без категории" };
  const parts = full.split(/\s*\/\s*/);
  return {
    category: parts[0],
    subcategory: parts.slice(1).join(" / ") || null,
    full,
  };
}

export function toBase(amount: number, currency: string, rates: CurrencyRates): number {
  if (currency === rates.base) return amount;
  const rate = rates.rates[currency];
  return rate ? roundMoney(amount * rate) : amount;
}

export function buildTransaction(row: RawRow, idx: number, rates: CurrencyRates): Transaction {
  const outcome = parseAmount(row.outcome);
  const income = parseAmount(row.income);
  let cat = splitCategory(row.categoryName);
  // Mirror the Zenmoney mapper: transfers always get the "Перевод" label so
  // the category column reads sensibly regardless of how the source tags them.
  // (CSV has no account-type info, so we can't auto-label "Долг" here.)
  if (
    outcome > 0 &&
    income > 0 &&
    row.outcomeAccountName !== row.incomeAccountName
  ) {
    cat = { category: "Перевод", subcategory: null, full: "Перевод" };
  }

  let kind: Transaction["kind"];
  let amount: number;
  let currency: string;
  let account: string;

  if (outcome > 0 && income > 0 && row.outcomeAccountName !== row.incomeAccountName) {
    kind = "transfer";
    amount = outcome;
    currency = row.outcomeCurrencyShortTitle || "RUB";
    account = row.outcomeAccountName;
  } else if (outcome > 0) {
    kind = "expense";
    amount = outcome;
    currency = row.outcomeCurrencyShortTitle || "RUB";
    account = row.outcomeAccountName;
  } else if (income > 0) {
    kind = "income";
    amount = income;
    currency = row.incomeCurrencyShortTitle || "RUB";
    account = row.incomeAccountName;
  } else {
    kind = "expense";
    amount = 0;
    currency = row.outcomeCurrencyShortTitle || "RUB";
    account = row.outcomeAccountName || row.incomeAccountName;
  }

  return {
    id: makeId(row, idx),
    date: (row.date || "").slice(0, 10),
    category: cat.category,
    subcategory: cat.subcategory,
    categoryFull: cat.full,
    categoryOriginal: cat.category,
    subcategoryOriginal: cat.subcategory,
    categoryFullOriginal: cat.full,
    payee: (row.payee || "").trim(),
    payeeOriginal: (row.payee || "").trim(),
    comment: (row.comment || "").trim(),
    outcomeAccount: row.outcomeAccountName,
    outcomeAmount: outcome,
    outcomeCurrency: row.outcomeCurrencyShortTitle || "RUB",
    incomeAccount: row.incomeAccountName,
    incomeAmount: income,
    incomeCurrency: row.incomeCurrencyShortTitle || "RUB",
    kind,
    amount,
    currency,
    account,
    amountBase: toBase(amount, currency, rates),
    opAmount: null,
    opCurrency: null,
    createdAt: row.createdDate || row.date,
  };
}

export interface ParseResult {
  transactions: Transaction[];
  totalRows: number;
  parsed: number;
  skipped: number;
}

export function parseCsv(text: string, rates: CurrencyRates): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<RawRow>(text, {
      header: true,
      delimiter: ";",
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (results) => {
        const transactions: Transaction[] = [];
        let skipped = 0;
        results.data.forEach((row, i) => {
          if (!row || (!row.date && !row.outcome && !row.income)) {
            skipped++;
            return;
          }
          try {
            transactions.push(buildTransaction(row, i, rates));
          } catch {
            skipped++;
          }
        });
        resolve({
          transactions,
          totalRows: results.data.length,
          parsed: transactions.length,
          skipped,
        });
      },
      error: (err: Error) => reject(err),
    });
  });
}
