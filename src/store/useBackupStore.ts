// Scheduled backup state. The user picks an interval; on every app load
// and roughly every 10 minutes thereafter the store checks whether a backup
// is "due" and, if so, triggers a JSON download.
//
// Browser-driven downloads cannot be 100% silent — most browsers show a
// brief notification — but with the default "Ask where to save each file"
// turned off they go straight to the Downloads folder without a dialog.

import { create } from "zustand";
import * as db from "../lib/db";
import { downloadBackup } from "../lib/backup";

export type BackupInterval = "hour" | "day" | "week" | "off";

const KEY_INTERVAL = "backupInterval";
const KEY_LAST_AT = "backupLastAt";

interface BackupState {
  interval: BackupInterval;
  lastBackupAt: string | null;
  loaded: boolean;
  hydrate: () => Promise<void>;
  setInterval: (i: BackupInterval) => Promise<void>;
  /**
   * Скачать бэкап сейчас и отметить время.
   *
   * `tag` попадает в имя файла: у скачанного по расписанию — «-auto», у
   * скачанного руками ничего. Отметка ставится в обоих случаях: расписание
   * считает срок от ПОСЛЕДНЕЙ копии, а не от последней автоматической, —
   * иначе через час после ручного бэкапа падал бы второй, точно такой же.
   */
  runNow: (tag?: string) => Promise<{ size: number; fileName: string }>;
  /** Returns true if a backup was performed, false otherwise. */
  runIfDue: () => Promise<boolean>;
}

function intervalToMs(interval: BackupInterval): number {
  switch (interval) {
    case "hour":
      return 60 * 60 * 1000;
    case "day":
      return 24 * 60 * 60 * 1000;
    case "week":
      return 7 * 24 * 60 * 60 * 1000;
    case "off":
      return Infinity;
  }
}

export const useBackupStore = create<BackupState>((set, get) => ({
  interval: "off",
  lastBackupAt: null,
  loaded: false,

  hydrate: async () => {
    const [interval, lastAt] = await Promise.all([
      db.loadJSON<BackupInterval>(KEY_INTERVAL),
      db.loadJSON<string>(KEY_LAST_AT),
    ]);
    set({
      interval: interval || "off",
      lastBackupAt: lastAt || null,
      loaded: true,
    });
  },

  setInterval: async (i) => {
    await db.saveJSON(KEY_INTERVAL, i);
    set({ interval: i });
  },

  runNow: async (tag) => {
    const res = await downloadBackup(tag);
    const now = new Date().toISOString();
    await db.saveJSON(KEY_LAST_AT, now);
    set({ lastBackupAt: now });
    return res;
  },

  runIfDue: async () => {
    const { interval, lastBackupAt } = get();
    if (interval === "off") return false;
    const dueAfter = intervalToMs(interval);
    const lastMs = lastBackupAt ? new Date(lastBackupAt).getTime() : 0;
    const sinceLast = Date.now() - lastMs;
    if (sinceLast < dueAfter) return false;
    try {
      await get().runNow("auto");
      return true;
    } catch {
      return false;
    }
  },
}));
