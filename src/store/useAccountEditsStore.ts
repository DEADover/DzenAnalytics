// Pending edits to accounts. Same shape and lifecycle as useTagEditsStore: the
// patch survives a re-sync (it's re-applied over the freshly-mapped account),
// goes to the cloud through the normal Push flow, and is cleared once accepted.
//
// What is NOT editable here, on purpose:
//   • `balance` — Zenmoney derives it from startBalance + operations, and its
//     own apps change it with a correction OPERATION. Writing the number
//     directly would desync the local and cloud figures.
//   • `instrument` (currency) — re-values the account's whole history.
//   • `syncID` — the bank-import matching keys; editing them breaks import.

import { create } from "zustand";
import * as db from "../lib/db";
import type { ZenTermUnit } from "../lib/zenmoney";

/**
 * A pending patch onto an account. Only touched fields are present — the push
 * builder starts from the ORIGINAL cached account and overrides exactly these,
 * so fields we don't model (deposit schedules, correction settings) survive the
 * round-trip untouched. `startDate` may be `null` (a real value), so absence of
 * a key — not `null` — means "unchanged".
 */
export interface AccountEdit {
  title?: string;
  /** ccard / debit / cash / loan / deposit / checking. */
  type?: string;
  /** Учитывать в совокупном балансе. */
  inBalance?: boolean;
  /** Накопительный счёт. */
  savings?: boolean;
  /** Личный счёт (скрыт из общего доступа в Дзен-мани). */
  private?: boolean;
  /** Архивный (закрытый) счёт. */
  archive?: boolean;
  /** Кредитный лимит в валюте счёта. */
  creditLimit?: number;
  /** Начальный остаток — сдвигает всю историю баланса счёта. */
  startBalance?: number;
  /** ISO-дата открытия счёта, либо null. */
  startDate?: string | null;
  /** Ставка по вкладу/кредиту в процентах, либо null. */
  percent?: number | null;
  /** Капитализация процентов. */
  capitalization?: boolean | null;
  /** Срок вклада/кредита: число единиц + единица. */
  endDateOffset?: number | null;
  endDateOffsetInterval?: ZenTermUnit | null;
  /** Периодичность начисления процентов. */
  payoffStep?: number | null;
  payoffInterval?: ZenTermUnit | null;
}

const KEY = "accountEdits";

interface State {
  edits: Record<string, AccountEdit>;
  loaded: boolean;
  hydrate: () => Promise<void>;
  /** Merge a partial patch into an account's pending edit. A field set to
   *  `undefined` is REMOVED from the patch (revert-to-cache); an empty patch
   *  drops the whole entry so it stops counting as pending. */
  patch: (accountId: string, partial: AccountEdit) => Promise<void>;
  /** Drop the whole pending patch for one account (построчный откат). */
  revert: (accountId: string) => Promise<void>;
  clearMany: (ids: string[]) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useAccountEditsStore = create<State>((set, get) => ({
  edits: {},
  loaded: false,

  hydrate: async () => {
    const data = await db.loadJSON<Record<string, AccountEdit>>(KEY);
    set({ edits: data || {}, loaded: true });
  },

  patch: async (accountId, partial) => {
    const cur: AccountEdit = { ...(get().edits[accountId] || {}) };
    for (const [k, v] of Object.entries(partial)) {
      if (v === undefined) delete cur[k as keyof AccountEdit];
      else (cur as Record<string, unknown>)[k] = v;
    }
    const next = { ...get().edits };
    if (Object.keys(cur).length === 0) delete next[accountId];
    else next[accountId] = cur;
    await db.saveJSON(KEY, next);
    set({ edits: next });
  },

  revert: async (accountId) => {
    if (!(accountId in get().edits)) return;
    const next = { ...get().edits };
    delete next[accountId];
    await db.saveJSON(KEY, next);
    set({ edits: next });
  },

  clearMany: async (ids) => {
    if (ids.length === 0) return;
    const next = { ...get().edits };
    let changed = false;
    for (const id of ids) {
      if (id in next) {
        delete next[id];
        changed = true;
      }
    }
    if (!changed) return;
    await db.saveJSON(KEY, next);
    set({ edits: next });
  },

  clearAll: async () => {
    await db.saveJSON(KEY, {});
    set({ edits: {} });
  },
}));

/** Read account edits without a hook — for the push builder. */
export async function loadAccountEdits(): Promise<Record<string, AccountEdit>> {
  const s = useAccountEditsStore.getState();
  if (s.loaded) return s.edits;
  const disk = await db.loadJSON<Record<string, AccountEdit>>(KEY);
  return disk || {};
}
