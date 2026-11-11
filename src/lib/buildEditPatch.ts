/**
 * Правка операции из окна: какие поля поменялись относительно операции.
 *
 * Чистая функция — вынесена из окна правки, чтобы её можно было проверить
 * тестами: от неё зависит, что уедет в Дзен-мани.
 *
 * Правка МИНИМАЛЬНАЯ — только поля, чьё новое значение отличается от
 * операции. Конвейер отправки (`buildPushItems`) смотрит на
 * `edit.<поле> !== undefined`, чтобы понять, трогал ли человек поле: правка
 * со всеми значениями подряд превратила бы смену получателя в смену типа или
 * счёта, и проверка её отвергла бы.
 */
import type { Transaction, TxKind } from "../types";
import { txAccountKey, txInKey, txOutKey } from "./accountKey";
import { parseAmountInput } from "./splitTransaction";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Local "HH:MM" time-of-day from an ISO timestamp (the operation's `created`).
 *  Empty string when the timestamp is missing/invalid (e.g. some CSV rows). */
export function isoToLocalTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Combine an accounting date (YYYY-MM-DD) + local "HH:MM" into a Date built in
 *  local time, so it round-trips with `isoToLocalTime`. */
export function dateTimeToDate(dateIso: string, time: string): Date {
  const [y, mo, d] = dateIso.split("-").map(Number);
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  return new Date(y, (mo || 1) - 1, d || 1, m ? +m[1] : 0, m ? +m[2] : 0, 0, 0);
}

/** Что сейчас в полях окна. Счета — ключами справочника. */
export interface EditForm {
  date: string;
  time: string;
  category: string;
  subcategory: string;
  extras: string[];
  payee: string;
  comment: string;
  amount: string;
  currency: string;
  kind: TxKind;
  isDebt: boolean;
  /** Ключ счёта «Долги»; `null` — его нет в кэше. */
  debtAccountTitle: string | null;
  /** Настоящий счёт долговой операции. */
  realAcc: string;
  /** Долг: деньги ушли со счёта (дали в долг / вернули). */
  debtOutgoing: boolean;
  outAcc: string;
  inAcc: string;
  account: string;
  isCrossCurrencyTransfer: boolean;
  inAmountValue: string;
  inAccCurrency: string | undefined;
}

/** Название и номер счёта по ключу. Номера нет, если счетов под ключом несколько. */
export type AccountRefOf = (key: string) => { title: string; id: string | undefined };

export function buildEditPatch(tx: Transaction, form: EditForm, accountOf: AccountRefOf): Record<string, unknown> {
  const {
    date, time, category, subcategory, extras, payee, comment, amount, currency, kind,
    isDebt, debtAccountTitle, realAcc, debtOutgoing, outAcc, inAcc, account,
    isCrossCurrencyTransfer, inAmountValue, inAccCurrency,
  } = form;
  const titleOf = (key: string) => accountOf(key).title;
  const idOf = (key: string) => accountOf(key).id;
  const outKey0 = tx.outcomeAccount ? txOutKey(tx) : txAccountKey(tx);
  const inKey0 = tx.incomeAccount ? txInKey(tx) : "";

  const amtNum = parseAmountInput(amount);
  const safeAmount =
    Number.isFinite(amtNum) && amtNum >= 0 ? amtNum : tx.amount;
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : tx.date;

  // Build a MINIMAL patch — only fields whose new value actually
  // differs from the original transaction. This matters for the
  // push pipeline: `buildPushItems` checks `edit.<field> !== undefined`
  // to decide whether the user touched a field, so stashing every
  // value here (even unchanged ones) would make a payee-only edit
  // look like a type-or-account change and get rejected by Phase 1
  // validation.
  const patch: Record<string, unknown> = {};

  // Helpers: trim both sides before comparing so a whitespace-only
  // delta still registers as "no change", but a real edit always
  // lands in the patch. Treating null/undefined as "" makes the
  // comparison total.
  const norm = (v: string | null | undefined) => (v ?? "").trim();
  const changed = (next: string, before: string | null | undefined) =>
    norm(next) !== norm(before);
  /** Ноги правки — ключами: в правку уходят и название, и номер, и ключ. */
  const setLegs = (p: Record<string, unknown>, out: string, inc: string, main: string) => {
    p.outcomeAccount = out ? titleOf(out) : "";
    p.outcomeAccountId = out ? idOf(out) ?? "" : "";
    p.outcomeAccountKey = out;
    p.incomeAccount = inc ? titleOf(inc) : "";
    p.incomeAccountId = inc ? idOf(inc) ?? "" : "";
    p.incomeAccountKey = inc;
    p.account = titleOf(main);
    p.accountId = idOf(main) ?? "";
    p.accountKey = main;
  };

  if (safeDate !== tx.date) patch.date = safeDate;

  // Time-of-day lives in `created`/`createdAt`. Only patch it when the user
  // actually changed the time — otherwise a no-op save (or a date-only
  // edit) would needlessly rewrite the original timestamp. The created date
  // follows the accounting date so what you see (Дата + Время) is stored.
  // NB: on push a `createdAt` change is NOT an in-place update — Zenmoney
  // ignores a changed `created` on an existing row, so the push pipeline
  // recreates the operation under a new id (see `buildPushItems`/`emit`).
  if (/^\d{2}:\d{2}$/.test(time) && time !== isoToLocalTime(tx.createdAt)) {
    patch.createdAt = dateTimeToDate(safeDate, time).toISOString();
  }

  const nextCategory = category.trim() || tx.category;
  if (changed(nextCategory, tx.category)) patch.category = nextCategory;

  const nextSubRaw = subcategory.trim();
  const nextSub = nextSubRaw || null;
  if (changed(nextSubRaw, tx.subcategory ?? "")) patch.subcategory = nextSub;

  // Вторые категории — только если список действительно поменялся: иначе
  // любая правка суммы пересобирала бы теги операции.
  const beforeExtras = tx.extraCategories ?? [];
  if (
    !isDebt &&
    kind !== "transfer" &&
    (extras.length !== beforeExtras.length || extras.some((e, i) => e !== beforeExtras[i]))
  ) {
    patch.extraCategories = extras;
  }

  // Brand — single "Получатель" UI field maps to the brand field
  // on the data model. Empty → null so display falls back to raw
  // payee. The raw `payee` (bank-statement text) is preserved
  // untouched as historical source-of-truth and never written here.
  const nextBrand = payee.trim() || null;
  if (norm(payee) !== norm(tx.brand ?? "")) patch.brand = nextBrand;

  const nextComment = comment.trim();
  if (changed(nextComment, tx.comment)) patch.comment = nextComment;

  if (safeAmount !== tx.amount) patch.amount = safeAmount;

  const nextCurrency = currency.trim() || tx.currency;
  if (changed(nextCurrency, tx.currency)) patch.currency = nextCurrency;

  if (kind !== tx.kind) patch.kind = kind;

  if (isDebt) {
    // Debt op: rebuild the two legs from direction + real account; the
    // debt account «Долги» stays on the other leg. The counterparty is
    // already carried by `patch.brand` above (the push debt-branch maps
    // it back onto the required `payee`).
    const debtT = debtAccountTitle ?? "";
    const real = realAcc.trim() || (tx.outcomeAccount ? outKey0 : inKey0);
    const src = debtOutgoing ? real : debtT;
    const dst = debtOutgoing ? debtT : real;
    if (changed(src, outKey0) || changed(dst, inKey0)) {
      setLegs(patch, src, dst, src);
    }
  } else if (kind === "transfer") {
    // For transfers we need both legs in sync. Whether or not the
    // user actually changed any account, write all three so the
    // pipeline never sees half-stale data. The push transformer
    // will compare against the original to decide if it's a real
    // change worth refusing.
    const src = outAcc.trim() || outKey0;
    const dst = inAcc.trim() || inKey0;
    const accountsChanged =
      changed(src, outKey0) ||
      changed(dst, inKey0) ||
      changed(src, tx.account ? txAccountKey(tx) : "");
    if (accountsChanged) {
      // mapper convention: transfer rows live under source
      setLegs(patch, src, dst, src);
    }
    // Cross-currency: carry the destination amount (in the destination
    // account's currency) so the push can build the second leg. Only
    // when it actually changed, or the row just became a transfer / its
    // accounts moved — a no-op edit must stay a no-op.
    if (isCrossCurrencyTransfer) {
      const inNum = parseAmountInput(inAmountValue);
      const safeIn =
        Number.isFinite(inNum) && inNum > 0 ? inNum : tx.incomeAmount;
      if (
        safeIn !== tx.incomeAmount ||
        kind !== tx.kind ||
        accountsChanged
      ) {
        patch.incomeAmount = safeIn;
        patch.incomeCurrency = inAccCurrency;
      }
    }
  } else {
    const origKey = tx.account ? txAccountKey(tx) : "";
    const nextAccount = account.trim() || origKey;
    if (changed(nextAccount, origKey)) {
      // Refund is an income-side flow too — the merchant returned
      // money TO the account — so the same convention as `income`
      // applies for which leg gets the account id.
      if (kind === "income" || kind === "refund") setLegs(patch, "", nextAccount, nextAccount);
      else setLegs(patch, nextAccount, "", nextAccount);
    }
  }
  return patch;
}
