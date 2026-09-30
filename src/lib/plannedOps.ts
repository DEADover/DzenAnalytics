import type { ZenCache } from "./zenmoneyCache";
import type { CurrencyRates, Transaction } from "../types";

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
  /** id самого плана (`reminder`), из которого порождена эта дата. */
  reminder: string;
  /** Повторяющийся план (есть `interval`) или разовый. `null` — сам план не
   *  найден в кэше: он ещё не подтянут или уже удалён. */
  repeating: boolean | null;
  date: string;
  kind: PlannedKind;
  /** Amount in the BASE currency (like `Transaction.amountBase`). */
  amountBase: number;
  /** Сумма в валюте счёта (списания у расхода и перевода, зачисления у дохода). */
  amount: number;
  currency: string;
  /** Зачисление у перевода — в валюте счёта зачисления. */
  toAmount: number | null;
  toCurrency: string | null;
  account: string;
  toAccount: string | null;
  payee: string;
  comment: string;
  category: string;
  /** true = прогноз Дзена, false = запланировано вручную. */
  forecast: boolean;
  /**
   * Чей счёт, на котором стоит план, — участник общего аккаунта (#92, #95).
   *
   * НЕ `ZenReminderMarker.user`: тот у всех записей одинаков — это владелец
   * подписки. Различает участников `role` СЧЁТА: `null` — общий, номер —
   * личный счёт участника. Мобильное приложение планы на чужих личных счетах
   * не показывает, а по API они приезжают.
   */
  member?: number | null;
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
  // Сами планы нужны ровно для одного: отличить разовый от повторяющегося,
  // когда просроченную операцию удаляют (issue #71).
  const reminderById = new Map((cache.reminders || []).map((r) => [r.id, r]));

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
    const code = (id: number) => instrumentById.get(id)?.shortTitle || rates.base;
    let amount: number;
    let currency: string;
    if (isTransfer) {
      kind = "transfer";
      amountBase = toBase(m.outcome, m.outcomeInstrument);
      account = outAcc?.title || "";
      amount = m.outcome;
      currency = code(m.outcomeInstrument);
    } else if (m.outcome > 0) {
      kind = "expense";
      amountBase = toBase(m.outcome, m.outcomeInstrument);
      account = outAcc?.title || "";
      amount = m.outcome;
      currency = code(m.outcomeInstrument);
    } else {
      kind = "income";
      amountBase = toBase(m.income, m.incomeInstrument);
      account = inAcc?.title || "";
      amount = m.income;
      currency = code(m.incomeInstrument);
    }

    const plan = reminderById.get(m.reminder);
    out.push({
      id: m.id,
      reminder: m.reminder,
      repeating: plan ? plan.interval != null : null,
      date: m.date,
      kind,
      amountBase,
      amount,
      currency,
      toAmount: isTransfer ? m.income : null,
      toCurrency: isTransfer ? code(m.incomeInstrument) : null,
      account,
      toAccount: isTransfer ? inAcc?.title || "" : null,
      payee: (m.payee || "").trim(),
      comment: (m.comment || "").trim(),
      category: involvesDebt ? "Долг" : categoryOf(m.tag),
      forecast: m.isForecast === true,
      member: outAcc?.role ?? inAcc?.role ?? null,
    });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

/**
 * Sums of the planned / forecast operations of one kind in a year, as the
 * label-value pairs shown under a year total on the Календарь (issue #48).
 *
 * Only non-zero sides appear: an account with nothing scheduled shows no note
 * at all rather than a row of zeroes. Zero and negative sums are both treated
 * as "nothing" — these are unsigned totals of one direction, so a negative
 * value would mean the caller summed the wrong thing.
 */
export function plannedBreakdown(
  plan: number,
  forecast: number
): { label: string; amount: number }[] {
  const out: { label: string; amount: number }[] = [];
  if (plan > 0) out.push({ label: "План", amount: plan });
  if (forecast > 0) out.push({ label: "Прогноз", amount: forecast });
  return out;
}

/**
 * Убрать планы на ЧУЖИХ личных счетах.
 *
 * Мобильное приложение Дзен-мани их не показывает, а мы показывали все: на
 * общем аккаунте виджет на главной и «Регулярные» выдавали вперемешку планы
 * всех участников, и понять, почему в списке чужая аренда, было нельзя (#92).
 *
 * Планы на ОБЩИХ счетах остаются: они на то и общие. `ownerId === null` —
 * человек ещё не сказал, кто он, и прятать наугад нельзя (см. `zenUsers`).
 */
export function ownPlannedOps(ops: PlannedOp[], ownerId: number | null): PlannedOp[] {
  if (ownerId == null) return ops;
  return ops.filter((p) => p.member == null || p.member === ownerId);
}

/**
 * Запланированная операция в виде строки ленты — чтобы рисовать её теми же
 * ячейками, что и настоящие операции, и открывать «Сохранить как факт» той же
 * карточкой, что и копию операции (`template`).
 *
 * `id` — id даты плана: по нему строка находит своё действие в очереди.
 */
export function plannedAsTransaction(p: PlannedOp): Transaction {
  const [category, ...rest] = p.category.split(" / ");
  const subcategory = rest.length ? rest.join(" / ") : null;
  const transfer = p.kind === "transfer";
  return {
    id: p.id,
    date: p.date,
    category: transfer && p.category !== "Долг" ? "Перевод" : category || "",
    subcategory: transfer ? null : subcategory,
    categoryFull: transfer && p.category !== "Долг" ? "Перевод" : p.category,
    payee: p.payee,
    brand: p.payee || null,
    comment: p.comment,
    outcomeAccount: p.kind === "income" ? "" : p.account,
    outcomeAmount: p.kind === "income" ? 0 : p.amount,
    outcomeCurrency: p.currency,
    incomeAccount: transfer ? p.toAccount ?? "" : p.kind === "income" ? p.account : "",
    incomeAmount: transfer ? p.toAmount ?? p.amount : p.kind === "income" ? p.amount : 0,
    incomeCurrency: transfer ? p.toCurrency ?? p.currency : p.currency,
    kind: p.kind,
    amount: p.amount,
    currency: p.currency,
    account: p.account,
    amountBase: p.amountBase,
    opAmount: null,
    opCurrency: null,
    createdAt: `${p.date}T12:00:00Z`,
  };
}
