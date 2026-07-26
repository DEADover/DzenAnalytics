// Pending edits to category tags. Started life as the «обязательная»
// (`required`) flag only; now carries the full editable set — title, parent
// (hierarchy), type (showIncome/showOutcome), icon and color. Keyed by Zenmoney
// tag id. Works like useEditsStore but for tags: the overlay survives a re-sync
// (re-applied onto categoryMeta / the tag list) and is flushed to the cloud
// through the normal Push flow, then cleared.

import { create } from "zustand";
import * as db from "../lib/db";

/**
 * A pending patch onto a tag. Only the touched fields are present — the push
 * builder starts from the ORIGINAL cached tag and overrides exactly these, so we
 * never blank out fields we don't model. `required`/`color`/`parent` may be
 * `null` (a real value: not-set / no-colour / top-level), so absence of a key —
 * not `null` — means "unchanged".
 */
export interface TagEdit {
  title?: string;
  /** Parent tag id, or null for a top-level category. */
  parent?: string | null;
  showIncome?: boolean;
  showOutcome?: boolean;
  /** Raw Zenmoney icon id, e.g. "5001_coat". */
  icon?: string | null;
  /** Packed RGB int (Zenmoney's own format), or null for no colour. */
  color?: number | null;
  /** «обязательная» flag (true / false / null). */
  required?: boolean | null;
}

const KEY = "tagEdits";

interface State {
  edits: Record<string, TagEdit>;
  loaded: boolean;
  hydrate: () => Promise<void>;
  /** Merge a partial patch into a tag's pending edit. A field set to `undefined`
   *  is REMOVED from the patch (revert-to-cache); if the patch becomes empty the
   *  whole tag entry is dropped so it stops counting as pending. */
  patch: (tagId: string, partial: TagEdit) => Promise<void>;
  /** Convenience wrapper kept for the inline obligation toggle. Passing
   *  `undefined` clears just the required field, leaving other pending edits. */
  setRequired: (tagId: string, required: boolean | null | undefined) => Promise<void>;
  clearMany: (ids: string[]) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useTagEditsStore = create<State>((set, get) => ({
  edits: {},
  loaded: false,

  hydrate: async () => {
    const data = await db.loadJSON<Record<string, TagEdit>>(KEY);
    set({ edits: data || {}, loaded: true });
  },

  patch: async (tagId, partial) => {
    const cur: TagEdit = { ...(get().edits[tagId] || {}) };
    for (const [k, v] of Object.entries(partial)) {
      if (v === undefined) delete cur[k as keyof TagEdit];
      else (cur as Record<string, unknown>)[k] = v;
    }
    const next = { ...get().edits };
    if (Object.keys(cur).length === 0) delete next[tagId];
    else next[tagId] = cur;
    await db.saveJSON(KEY, next);
    set({ edits: next });
  },

  setRequired: async (tagId, required) => {
    await get().patch(tagId, { required });
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

/** Read tag edits without a hook — for the push builder. */
export async function loadTagEdits(): Promise<Record<string, TagEdit>> {
  const s = useTagEditsStore.getState();
  if (s.loaded) return s.edits;
  const disk = await db.loadJSON<Record<string, TagEdit>>(KEY);
  return disk || {};
}
