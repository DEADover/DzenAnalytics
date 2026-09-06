import { create } from "zustand";
import {
  loadSnapshotIndex,
  takeSnapshot as takeSnapshotImpl,
  deleteSnapshot as deleteSnapshotImpl,
  clearAllSnapshots as clearAllImpl,
  pruneForeignSnapshots,
  downloadSnapshot as downloadSnapshotImpl,
  importSnapshotFromJson as importSnapshotImpl,
  type CloudSnapshotSummary,
} from "../lib/cloudSnapshots";
import { useZenmoneyStore } from "./useZenmoneyStore";

/**
 * Thin reactive wrapper over `lib/cloudSnapshots`. The UI consumes this
 * store; the actual IDB / network work lives in the lib module so it can
 * also be called from non-React code paths (e.g. the future auto-
 * snapshot hook that fires before any push-to-Zenmoney operation).
 *
 * Only summaries are kept in memory — the full raw blob per snapshot is
 * lazy-loaded on demand (download / restore-preview).
 */
interface State {
  snapshots: CloudSnapshotSummary[];
  loaded: boolean;
  /** Set while a network/IO operation is in flight — UI greys out the buttons. */
  busy: boolean;
  /**
   * КАКАЯ именно работа идёт. Один флаг `busy` на всё врал в подписях: пока шла
   * уборка справочников, кнопка снимка бодро сообщала «Делаю снимок…».
   */
  busyOp: "snapshot" | "import" | "check" | "restore" | "cleanup" | null;
  /** Last error message from `takeSnapshot` for inline display. Cleared on next call. */
  error: string | null;
  hydrate: () => Promise<void>;
  takeSnapshot: () => Promise<void>;
  deleteSnapshot: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  download: (id: string) => Promise<void>;
  /** Import a previously-downloaded snapshot file into the local
   *  IndexedDB. Validated; throws via `error` state on bad input. */
  importFromFile: (file: File) => Promise<void>;
  /**
   * Выбросить снимки чужого аккаунта. Зовётся, когда становится известен
   * пользователь текущего токена: слотов пять, и занимать их копиями от
   * прежнего аккаунта незачем.
   */
  pruneForeign: (currentUserId: number) => Promise<number>;
}

export const useCloudSnapshotStore = create<State>((set) => ({
  snapshots: [],
  loaded: false,
  busy: false,
  busyOp: null,
  error: null,
  hydrate: async () => {
    const list = await loadSnapshotIndex();
    set({ snapshots: list, loaded: true });
  },

  takeSnapshot: async () => {
    // We deliberately read the token from the Zenmoney store at call
    // time (not via a hook) so this method works from non-React paths
    // too — e.g. the future "auto-snapshot before push" hook.
    const token = useZenmoneyStore.getState().token;
    if (!token) {
      set({ error: "Сначала подключите токен Дзен-мани API" });
      return;
    }
    set({ busy: true, busyOp: "snapshot", error: null });
    try {
      await takeSnapshotImpl(token);
      const list = await loadSnapshotIndex();
      set({ snapshots: list, busy: false, busyOp: null });
    } catch (e) {
      set({
        busy: false, busyOp: null,
        error:
          e instanceof Error
            ? e.message
            : "Не удалось сделать снимок (см. консоль браузера)",
      });
    }
  },

  deleteSnapshot: async (id) => {
    set({ busy: true, busyOp: null });
    try {
      await deleteSnapshotImpl(id);
      const list = await loadSnapshotIndex();
      set({ snapshots: list, busy: false, busyOp: null });
    } catch {
      set({ busy: false, busyOp: null });
    }
  },

  clearAll: async () => {
    set({ busy: true, busyOp: null });
    try {
      await clearAllImpl();
      set({ snapshots: [], busy: false, busyOp: null });
    } catch {
      set({ busy: false, busyOp: null });
    }
  },

  download: async (id) => {
    await downloadSnapshotImpl(id);
  },

  importFromFile: async (file) => {
    set({ busy: true, busyOp: "import", error: null });
    try {
      const text = await file.text();
      await importSnapshotImpl(text);
      const list = await loadSnapshotIndex();
      set({ snapshots: list, busy: false, busyOp: null });
    } catch (e) {
      set({
        busy: false, busyOp: null,
        error:
          e instanceof Error
            ? e.message
            : "Не удалось импортировать снимок",
      });
    }
  },

  pruneForeign: async (currentUserId) => {
    const removed = await pruneForeignSnapshots(currentUserId);
    if (removed > 0) set({ snapshots: await loadSnapshotIndex() });
    return removed;
  },

}));
