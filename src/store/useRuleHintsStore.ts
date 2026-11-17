import { create } from "zustand";
import * as db from "../lib/db";
import { serialQueue } from "../lib/serialQueue";
import { appendCorrections, type Correction } from "../lib/ruleSuggestions";

/**
 * Журнал ручных исправлений категории и контрагента — для подсказок правил
 * (`lib/ruleSuggestions`) — и список подсказок, которые человек спрятал.
 *
 * Живёт только на этом устройстве: это не настройка, а след того, что здесь
 * правили руками.
 */
const KEY = "ruleHints";

interface Saved {
  log: Correction[];
  dismissed: string[];
}

interface State extends Saved {
  loaded: boolean;
  hydrate: () => Promise<void>;
  record: (added: readonly Correction[]) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  restore: (id: string) => Promise<void>;
}

const queue = serialQueue();

function parse(raw: unknown): Saved {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Saved>;
  const log = Array.isArray(r.log)
    ? r.log.filter(
        (c): c is Correction =>
          !!c &&
          (c.field === "category" || c.field === "payee") &&
          typeof c.key === "string" &&
          typeof c.statement === "string" &&
          typeof c.to === "string" &&
          typeof c.txId === "string" &&
          typeof c.at === "number"
      )
    : [];
  const dismissed = Array.isArray(r.dismissed) ? r.dismissed.filter((x): x is string => typeof x === "string") : [];
  return { log, dismissed };
}

export const useRuleHintsStore = create<State>((set, get) => ({
  log: [],
  dismissed: [],
  loaded: false,

  hydrate: () =>
    queue(async () => {
      set({ ...parse(await db.loadJSON(KEY)), loaded: true });
    }),

  record: (added) =>
    queue(async () => {
      if (added.length === 0) return;
      // Журнал мог ещё не подняться с диска — тогда сначала читаем его, иначе
      // первая же правка затёрла бы всё накопленное.
      const base = get().loaded ? get() : parse(await db.loadJSON(KEY));
      const log = appendCorrections(base.log, added);
      await db.saveJSON(KEY, { log, dismissed: base.dismissed });
      set({ log, dismissed: base.dismissed, loaded: true });
    }),

  dismiss: (id) =>
    queue(async () => {
      if (get().dismissed.includes(id)) return;
      const dismissed = [...get().dismissed, id];
      await db.saveJSON(KEY, { log: get().log, dismissed });
      set({ dismissed });
    }),

  restore: (id) =>
    queue(async () => {
      const dismissed = get().dismissed.filter((x) => x !== id);
      await db.saveJSON(KEY, { log: get().log, dismissed });
      set({ dismissed });
    }),
}));
