import type { ZenCache } from "./zenmoneyCache";
import type { CurrencyRates } from "../types";

/**
 * Planned / forecast operations (issue #47).
 *
 * Zenmoney keeps a «reminder» template plus one `reminderMarker` per upcoming
 * occurrence. We already cache the PLANNED markers (see `ZenCache`), and they
 * carry everything needed to show a row — legs, payee, comment, tag — so no
 * extra sync is required.
 *
 * Two flavours, exactly as Zenmoney splits them:
 *   • `plan`     — the user scheduled it explicitly (`isForecast: false`);
 *   • `forecast` — Zenmoney projected it from a regular payment.
 */
export type PlannedKind = "expense" | "income" | "transfer";

export interface PlannedOp {
  id: string;
  date: string;
  kind: PlannedKind;
  /** Amount in the BASE currency (like `Transaction.amountBase`). */
  amountBase: number;
  account: string;
  toAccount: string | null;
  payee: string;
  comment: string;
  category: string;
  /** true = прогноз Дзена, false = запланировано вручную. */
  forecast: boolean;
}

/**
 * Map cached planned markers into display rows. Pure — resolves account /
 * instrument / tag ids against the same cache the transactions come from, so
 * names and currencies match the rest of the app.
 */
export function plannedOps(
  cache: ZenCache | null | undefined,
  rates: CurrencyRates
): PlannedOp[] {
  const markers = cache?.reminderMarkers;
  if (!cache || !markers || markers.length === 0) return [];

  const accountById = new Map(cache.accounts.map((a) => [a.id, a]));
  const instrumentById = new Map(cache.instruments.map((i) => [i.id, i]));
  const tagById = new Map(cache.tags.map((t) => [t.id, t]));

  const toBase = (amount: number, instrumentId: number) => {
    const code = instrumentById.get(instrumentId)?.shortTitle || rates.base;
    return code === rates.base ? amount : amount * (rates.rates[code] || 1);
  };
  /** «Категория / Подкатегория» from the marker's first tag. NB: unlike the
   *  transaction mapper we do NOT relabel transfers as «Перевод» — a planned
   *  transfer already reads as one from its two accounts — but a debt leg DOES
   *  get the «Долг» label, so a planned loan payment isn't shown as a plain
   *  «Карта → Кредит» transfer. */
  const categoryOf = (tags: string[] | null): string => {
    const id = tags && tags.length ? tags[0] : null;
    const tag = id ? tagById.get(id) : null;
    if (!tag) return "";
    const parent = tag.parent ? tagById.get(tag.parent) : null;
    return parent ? `${parent.title} / ${tag.title}` : tag.title;
  };

  /** Loan / credit / debt legs — same set the transaction mapper uses. */
  const DEBT_TYPES = ["loan", "credit", "debt"];

  const out: PlannedOp[] = [];
  for (const m of markers) {
    if (m.state !== "planned") continue;
    // A zero/zero marker carries no money — it would render as a phantom
    // «доход 0 ₽». The transaction mapper and the budget aggregator skip these
    // too; do the same so the three stay consistent.
    if (!(m.outcome > 0) && !(m.income > 0)) continue;
    const outAcc = m.outcomeAccount ? accountById.get(m.outcomeAccount) : undefined;
    const inAcc = m.incomeAccount ? accountById.get(m.incomeAccount) : undefined;
    const involvesDebt =
      DEBT_TYPES.includes(outAcc?.type || "") || DEBT_TYPES.includes(inAcc?.type || "");
    const isTransfer =
      m.outcome > 0 && m.income > 0 && m.outcomeAccount !== m.incomeAccount;

    let kind: PlannedKind;
    let amountBase: number;
    let account: string;
    if (isTransfer) {
      kind = "transfer";
      amountBase = toBase(m.outcome, m.outcomeInstrument);
      account = outAcc?.title || "";
    } else if (m.outcome > 0) {
      kind = "expense";
      amountBase = toBase(m.outcome, m.outcomeInstrument);
      account = outAcc?.title || "";
    } else {
      kind = "income";
      amountBase = toBase(m.income, m.incomeInstrument);
      account = inAcc?.title || "";
    }

    out.push({
      id: m.id,
      date: m.date,
      kind,
      amountBase,
      account,
      toAccount: isTransfer ? inAcc?.title || "" : null,
      payee: (m.payee || "").trim(),
      comment: (m.comment || "").trim(),
      category: involvesDebt ? "Долг" : categoryOf(m.tag),
      forecast: m.isForecast === true,
    });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}
