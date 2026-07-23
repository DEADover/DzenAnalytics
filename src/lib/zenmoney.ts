// Zenmoney API client.
//
// API docs: https://github.com/zenmoney/ZenPlugins/wiki/ZenMoney-API
// Single endpoint POST /v8/diff/ returns ALL data (transactions, accounts,
// tags, instruments, etc.) in one response. `serverTimestamp` enables
// incremental sync — for now we always do full sync (serverTimestamp=0).
//
// Token is the user's personal access token, stored in IndexedDB and sent
// as Bearer header. CORS is open (Access-Control-Allow-Origin: *), so this
// works directly from the browser, including file:// origins.

const API_BASE = "https://api.zenmoney.ru";

export interface ZenInstrument {
  id: number;
  title: string;
  shortTitle: string;
  symbol: string;
  rate: number; // 1 unit of this instrument = `rate` RUB
}

export interface ZenAccount {
  id: string;
  user: number;
  instrument: number;
  type: string;          // ccard / debit / cash / loan / deposit / checking / credit / ...
  role: number | null;
  private: boolean;
  savings: boolean;
  title: string;
  inBalance: boolean;
  archive: boolean;
  balance: number;
  startBalance: number;
  startDate: string | null;
  creditLimit: number;
  syncID: string[] | null;
  changed: number;
}

export interface ZenTag {
  id: string;
  user: number;
  title: string;
  parent: string | null;
  archive: boolean;
  showIncome: boolean;
  showOutcome: boolean;
  budgetIncome: boolean;
  budgetOutcome: boolean;
  /** «Обязательная» — are expenses in this category mandatory. Nullable
   *  (Zenmoney treats null as mandatory). Drives needs/wants in 50/30/20. */
  required: boolean | null;
  icon: string | null;
  picture: string | null;
  color: number | null;
  changed: number;
}

export interface ZenMerchant {
  id: string;
  user: number;
  title: string;
  changed: number;
}

export interface ZenTransaction {
  id: string;
  user: number;
  date: string;          // YYYY-MM-DD
  income: number;
  outcome: number;
  changed: number;
  incomeInstrument: number;
  outcomeInstrument: number;
  created: number;
  originalPayee: string | null;
  deleted: boolean;
  viewed: boolean;
  hold: boolean | null;
  qrCode: string | null;
  source: string | null;
  incomeAccount: string;
  outcomeAccount: string;
  tag: string[] | null;
  comment: string | null;
  payee: string | null;
  opIncome: number | null;
  opOutcome: number | null;
  opIncomeInstrument: number | null;
  opOutcomeInstrument: number | null;
  latitude: number | null;
  longitude: number | null;
  merchant: string | null;
  incomeBankID: string | null;
  outcomeBankID: string | null;
  reminderMarker: string | null;
}

export interface ZenDeletion {
  id: string;
  object: string;        // "transaction" | "account" | "tag" | ...
  user: number;
  stamp: number;
}

/**
 * A Zenmoney «План»/budget row. Natural key = (user, tag, date); there's no
 * surface `id`. `date` is the first day of the budgeted MONTH. `tag` is a tag
 * UUID, or `null` for the whole-month aggregate budget. `*Lock` distinguishes a
 * MANUAL plan (true) from an auto-forecast (false) — we only trust locked ones.
 */
export interface ZenBudget {
  user: number;
  changed: number;
  date: string; // "yyyy-MM-dd" (first of month)
  tag: string | null;
  income: number;
  incomeLock: boolean;
  outcome: number;
  outcomeLock: boolean;
  // Whether the value is Zenmoney's auto-forecast (true) vs a real user-set
  // plan (false). This — NOT `*Lock` — is what distinguishes a manual budget
  // from a predicted one. Optional for backward-compat with older caches.
  isIncomeForecast?: boolean;
  isOutcomeForecast?: boolean;
}

/**
 * A «планируемая операция» — one concrete dated instance generated from a
 * reminder. `state` is 'planned' until it's executed (→ 'processed', a real
 * Transaction is created) or removed ('deleted'). For BUDGETS we care only
 * about `state: 'planned'`: per the API, with `incomeLock`/`outcomeLock: false`
 * a budget's effective plan is its stored `income`/`outcome` PLUS every planned
 * marker's income/outcome that month for the tag. Amounts are in their own
 * instrument — convert to the user's base currency before summing.
 */
export interface ZenReminderMarker {
  id: string;
  user: number;
  changed: number;
  date: string; // yyyy-MM-dd — the planned operation's date
  income: number;
  incomeInstrument: number;
  outcome: number;
  outcomeInstrument: number;
  tag: string[] | null;
  reminder: string; // Reminder.id this instance was generated from
  state: "planned" | "processed" | "deleted";
  /** Account ids of the two legs — a marker carries the same leg structure as
   *  a transaction, so a planned transfer has two different accounts. */
  incomeAccount?: string;
  outcomeAccount?: string;
  payee?: string | null;
  comment?: string | null;
  merchant?: string | null;
  /** Zenmoney's own split: `false` = операция, которую пользователь запланировал
   *  сам; `true` = прогноз, достроенный Дзеном по регулярности. */
  isForecast?: boolean;
  notify?: boolean;
}

export interface ZenDiffResponse {
  serverTimestamp: number;
  instrument: ZenInstrument[];
  account: ZenAccount[];
  tag: ZenTag[];
  merchant: ZenMerchant[];
  transaction: ZenTransaction[];
  user: { id: number; currency: number; [k: string]: unknown }[];
  budget?: ZenBudget[];
  reminder?: unknown[];
  reminderMarker?: ZenReminderMarker[];
  country?: unknown[];
  company?: unknown[];
  deletion?: ZenDeletion[];
}

export class ZenApiError extends Error {
  status: number;
  code: string | null;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "ZenApiError";
  }
}

interface DiffRequest {
  currentClientTimestamp: number;
  serverTimestamp: number;
  /** Ask the server to return these entity types IN FULL, as if it were the
   *  first sync — used to back-fill a type we never pulled before (e.g.
   *  `reminderMarker`, whose existing planned instances an incremental diff
   *  would never re-send). Valid names: instrument, company, user, account,
   *  tag, merchant, budget, reminder, reminderMarker, transaction. */
  forceFetch?: string[];

  // ──────────────────────────────────────────────────────────────────────
  // Optional PUSH sections. Included in the body when the client wants the
  // server to also mutate state in addition to fetching the delta.
  // Zenmoney handles each section as an upsert by `id` with last-write-wins
  // on `changed` timestamp; the response echoes back the saved entities.
  // ──────────────────────────────────────────────────────────────────────
  transaction?: ZenTransaction[];
  account?: ZenAccount[];
  tag?: ZenTag[];
  merchant?: ZenMerchant[];
  /** Soft-delete: `{ id, object, stamp, user }` per item. */
  deletion?: ZenDeletion[];
}

/**
 * Calls POST /v8/diff/ with the given token and serverTimestamp.
 * Returns the full response (transactions + all reference entities).
 * Throws ZenApiError on non-2xx responses.
 */
export async function fetchDiff(
  token: string,
  serverTimestamp = 0,
  signal?: AbortSignal,
  forceFetch?: string[]
): Promise<ZenDiffResponse> {
  const body: DiffRequest = {
    currentClientTimestamp: Math.floor(Date.now() / 1000),
    serverTimestamp,
  };
  if (forceFetch && forceFetch.length > 0) body.forceFetch = forceFetch;
  const res = await fetch(`${API_BASE}/v8/diff/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    let code: string | null = null;
    try {
      const j = (await res.json()) as { error?: { message?: string; code?: string } };
      if (j.error?.message) msg = j.error.message;
      if (j.error?.code) code = j.error.code;
    } catch {
      // ignore parse errors — keep the HTTP-status fallback
    }
    throw new ZenApiError(msg, res.status, code);
  }
  return (await res.json()) as ZenDiffResponse;
}

/**
 * PUSH-aware variant of `/v8/diff/`. Same endpoint, same response shape —
 * but the request body carries entities the server should upsert (and
 * optionally a `deletion` list).
 *
 * Zenmoney's response includes the saved entities so the caller can merge
 * them straight back into the local cache via the usual `applyDiff` path.
 * The server's `changed` stamp on each returned entity is canonical and
 * MUST replace whatever the client sent (Zenmoney sometimes bumps it on
 * conflict resolution).
 */
export interface PushPayload {
  transaction?: ZenTransaction[];
  account?: ZenAccount[];
  tag?: ZenTag[];
  merchant?: ZenMerchant[];
  budget?: ZenBudget[];
  deletion?: ZenDeletion[];
}

export async function pushDiff(
  token: string,
  serverTimestamp: number,
  payload: PushPayload,
  signal?: AbortSignal
): Promise<ZenDiffResponse> {
  const body: DiffRequest = {
    currentClientTimestamp: Math.floor(Date.now() / 1000),
    serverTimestamp,
    ...payload,
  };
  const requestBodyJson = JSON.stringify(body);
  const res = await fetch(`${API_BASE}/v8/diff/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: requestBodyJson,
    signal,
  });
  if (!res.ok) {
    // Read the raw body once — we use it both for the structured error
    // parse and (in dev) for diagnostics. `res.text()` doesn't consume
    // a second-time-readable copy, so we save it first.
    let rawText = "";
    try {
      rawText = await res.text();
    } catch {
      /* network already closed — fall through */
    }
    let msg = `HTTP ${res.status}`;
    let code: string | null = null;
    try {
      const j = JSON.parse(rawText) as {
        error?: { message?: string; code?: string };
      };
      if (j.error?.message) msg = j.error.message;
      if (j.error?.code) code = j.error.code;
    } catch {
      // ignore parse errors — keep the HTTP-status fallback
    }
    // In dev, surface the full failure context to DevTools so we can
    // diagnose Zen-side errors (which are usually very terse). Logs:
    //   • outgoing request size + section counts
    //   • full server response body (not just the parsed `error.message`)
    //   • a tiny sample of the first/last transaction we sent, in case
    //     the failure is on a specific shape we sent.
    // Same context goes to `dev-logs/app.log` via `devLog` so it can
    // be inspected outside the browser.
    if (!import.meta.env.PROD) {
      const sections = {
        transaction: payload.transaction?.length ?? 0,
        account: payload.account?.length ?? 0,
        tag: payload.tag?.length ?? 0,
        merchant: payload.merchant?.length ?? 0,
        deletion: payload.deletion?.length ?? 0,
      };
      console.groupCollapsed(
        `[Zenmoney API error] HTTP ${res.status} — ${msg}`
      );
      console.log("request body size:", requestBodyJson.length, "bytes");
      console.log("sections:", sections);
      console.log("server response body:", rawText || "(empty)");
      if (payload.transaction && payload.transaction.length > 0) {
        console.log("first tx sample:", payload.transaction[0]);
        console.log(
          "last tx sample:",
          payload.transaction[payload.transaction.length - 1]
        );
      }
      console.groupEnd();

      // Mirror to dev-logs/app.log for outside-browser inspection.
      // Lazy import keeps prod bundle clean of this code path.
      void (async () => {
        const { devLog } = await import("./devLog");
        devLog(
          "zen-api",
          `HTTP ${res.status} ${msg} — body size ${requestBodyJson.length}b, ` +
            `sections=${JSON.stringify(sections)}, ` +
            `server-response=${rawText.slice(0, 1000) || "(empty)"}`,
          "error"
        );
        // Dump the EXACT outgoing request body so we can verify what
        // actually went over the wire — useful when investigating
        // "did we add a field we shouldn't have" suspicions. Cap at
        // 4 KB so the log file stays manageable.
        devLog(
          "zen-api",
          `outgoing body (first 4KB): ${requestBodyJson.slice(0, 4000)}`,
          "debug"
        );
        if (payload.transaction && payload.transaction.length > 0) {
          devLog(
            "zen-api",
            `first tx: ${JSON.stringify(payload.transaction[0]).slice(0, 800)}`,
            "debug"
          );
          devLog(
            "zen-api",
            `last tx: ${JSON.stringify(payload.transaction[payload.transaction.length - 1]).slice(0, 800)}`,
            "debug"
          );
        }
      })();
    }
    throw new ZenApiError(msg, res.status, code);
  }
  return (await res.json()) as ZenDiffResponse;
}

/**
 * Lightweight token check — sends a diff with serverTimestamp=now so the
 * response payload is small. Returns true on 2xx, false on 401, throws on
 * other errors.
 */
export async function checkToken(token: string): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  try {
    await fetchDiff(token, now);
    return true;
  } catch (e) {
    if (e instanceof ZenApiError && e.status === 401) return false;
    throw e;
  }
}
