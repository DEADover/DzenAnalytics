// Sync log — a persistent rolling list of recent sync/push/snapshot events.
//
// Why this exists:
//   • The header toast / inline flash only show the *last* result and
//     auto-dismiss after a few seconds. If the user wasn't looking,
//     they have no way to find out what happened.
//   • When two-way sync errors out, we need an "open the log" hand-off
//     so the user can see *why* a push failed (skipped reasons, server
//     error messages, etc.) without digging through devtools.
//   • A persistent history also makes "is sync working today?" easy
//     to answer at a glance.
//
// Lives in IDB (key "syncLog") with a hard cap of MAX_ENTRIES; older
// entries are dropped on append. Cheap to read on hydrate (single
// JSON blob), cheap to write (one debounced save per operation).
//
// Non-React paths can call `useSyncLogStore.getState().append(...)` —
// the store is intentionally non-hook-only so push/snapshot helpers
// in `lib/` can write to it without going through React.

import { create } from "zustand";
import * as db from "../lib/db";

export type SyncLogKind = "pull" | "push" | "snapshot" | "restore";
export type SyncLogStatus = "ok" | "error" | "partial";

export interface SyncLogEntry {
  id: string;
  ts: number;
  kind: SyncLogKind;
  status: SyncLogStatus;
  title: string;
  summary?: string;
  /** Optional structured detail payload. Rendered in expanded view. */
  details?: {
    counts?: {
      transactions?: number;
      deletions?: number;
      accepted?: number;
      skipped?: number;
      chunks?: number;
      total?: number;
    };
    skipped?: { id: string; reason: string }[];
  };
  /** Full error message (server text or thrown Error.message). */
  error?: string;
  durationMs?: number;
  /** Та же ошибка подряд N раз — одной строкой, а не N строками. */
  repeat?: number;
  /** Когда эта серия повторов началась (`ts` — последний раз). */
  firstTs?: number;
}

/**
 * Добавить запись в голову журнала. Ошибка, совпадающая с предыдущей записью
 * (тот же вид и тот же текст), не плодит новую строку: увеличивает счётчик
 * повторов у прежней. Иначе автосинхронизация при сбое затирала журнал на 100
 * записей за час — и с ним момент, когда всё началось.
 */
export function mergeLogEntry(
  entries: SyncLogEntry[],
  entry: SyncLogEntry,
  max: number
): SyncLogEntry[] {
  const head = entries[0];
  if (
    head &&
    entry.status === "error" &&
    head.status === "error" &&
    head.kind === entry.kind &&
    head.title === entry.title &&
    head.error === entry.error
  ) {
    const merged: SyncLogEntry = {
      ...head,
      ts: entry.ts,
      durationMs: entry.durationMs,
      repeat: (head.repeat ?? 1) + 1,
      firstTs: head.firstTs ?? head.ts,
    };
    return [merged, ...entries.slice(1)];
  }
  return [entry, ...entries].slice(0, max);
}

const KEY = "syncLog";
const MAX_ENTRIES = 100;

interface State {
  entries: SyncLogEntry[];
  loaded: boolean;
  hydrate: () => Promise<void>;
  /** Append a new entry to the head of the log. Returns the persisted
   *  entry (with id + ts populated) so the caller can show a
   *  "перейти к логу" toast that scrolls to this exact row. */
  append: (entry: Omit<SyncLogEntry, "id" | "ts">) => Promise<SyncLogEntry>;
  clear: () => Promise<void>;
}

export const useSyncLogStore = create<State>((set, get) => ({
  entries: [],
  loaded: false,

  hydrate: async () => {
    const stored = await db.loadJSON<SyncLogEntry[]>(KEY);
    // Значение из хранилища может оказаться не тем, чего мы ждём — после сбоя
    // записи или отката на другую версию. Строку, например, React честно
    // разложит на символы и уронит таблицу. Берём только массив объектов.
    const entries = Array.isArray(stored)
      ? stored.filter((e): e is SyncLogEntry => !!e && typeof e === "object")
      : [];
    set({ entries, loaded: true });
  },

  append: async (entry) => {
    const full: SyncLogEntry = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      ...entry,
    };
    const next = mergeLogEntry(get().entries, full, MAX_ENTRIES);
    set({ entries: next });
    // Fire-and-forget; if the write fails (storage full, etc.) we
    // still have the entry in memory for this session.
    await db.saveJSON(KEY, next);
    return next[0];
  },

  clear: async () => {
    set({ entries: [] });
    await db.saveJSON(KEY, []);
  },
}));
