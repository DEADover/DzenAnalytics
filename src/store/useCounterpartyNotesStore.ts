import { create } from "zustand";
import * as db from "../lib/db";
import { debtPayeeKey } from "../lib/debts";

/**
 * Заметка о контрагенте или должнике — себе на будущее (#119).
 *
 * В Дзен-мани у контрагента нет поля для текста, поэтому заметки живут у нас:
 * в хранилище аккаунта и в переносе настроек между устройствами (список
 * `notes`, сливается по элементам — заметка, написанная на одном компьютере,
 * не затирает другую, написанную на втором).
 *
 * Ключ — имя без различий в регистре и пробелах, как у разбивки долгов: один и
 * тот же человек в «Контрагентах» и в долгах — одна заметка.
 */
export interface CounterpartyNote {
  /** Ключ: `noteKey(name)`. */
  id: string;
  /** Имя, как его написали в последний раз, — для резервной копии и облака. */
  name: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

/** Длиннее — не заметка, а документ; поле обрезает ввод. */
export const NOTE_MAX_LENGTH = 2000;

export const noteKey = (name: string) => debtPayeeKey(name);

const KEY = "counterpartyNotes";

interface NotesState {
  notes: Record<string, CounterpartyNote>;
  loaded: boolean;
  hydrate: () => Promise<void>;
  /** Записать заметку; пустой текст её удаляет. */
  setNote: (name: string, text: string) => Promise<void>;
  /** Заменить список целиком — перенос настроек между устройствами. */
  replaceAll: (items: readonly CounterpartyNote[]) => Promise<void>;
}

function toMap(items: readonly CounterpartyNote[]): Record<string, CounterpartyNote> {
  const out: Record<string, CounterpartyNote> = {};
  for (const n of items) {
    if (!n || typeof n.id !== "string" || typeof n.text !== "string" || !n.text.trim()) continue;
    out[n.id] = {
      id: n.id,
      name: typeof n.name === "string" ? n.name : n.id,
      text: n.text.slice(0, NOTE_MAX_LENGTH),
      createdAt: typeof n.createdAt === "string" ? n.createdAt : new Date(0).toISOString(),
      updatedAt: typeof n.updatedAt === "string" ? n.updatedAt : new Date(0).toISOString(),
    };
  }
  return out;
}

export const useCounterpartyNotesStore = create<NotesState>((set, get) => ({
  notes: {},
  loaded: false,
  hydrate: async () => {
    const data = await db.loadJSON<CounterpartyNote[]>(KEY);
    set({ notes: toMap(data || []), loaded: true });
  },
  setNote: async (name, text) => {
    const id = noteKey(name);
    if (!id) return;
    const clean = text.replace(/\s+$/, "").slice(0, NOTE_MAX_LENGTH);
    const prev = get().notes[id];
    if ((prev?.text ?? "") === clean) return;
    const next = { ...get().notes };
    if (!clean.trim()) {
      delete next[id];
    } else {
      const now = new Date().toISOString();
      next[id] = { id, name: name.trim(), text: clean, createdAt: prev?.createdAt ?? now, updatedAt: now };
    }
    await db.saveJSON(KEY, Object.values(next));
    set({ notes: next });
  },
  replaceAll: async (items) => {
    const next = toMap(items);
    await db.saveJSON(KEY, Object.values(next));
    set({ notes: next });
  },
}));

/** Заметка о человеке или месте по имени — или `undefined`. */
export function useCounterpartyNote(name: string): CounterpartyNote | undefined {
  return useCounterpartyNotesStore((s) => s.notes[noteKey(name)]);
}
