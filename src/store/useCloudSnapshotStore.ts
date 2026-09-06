import { create } from "zustand";
import {
  loadSnapshotIndex,
  takeSnapshot as takeSnapshotImpl,
  deleteSnapshot as deleteSnapshotImpl,
  clearAllSnapshots as clearAllImpl,
  pruneForeignSnapshots,
  downloadSnapshot as downloadSnapshotImpl,
  importSnapshotFromJson as importSnapshotImpl,
  restoreSnapshotToCloud as restoreSnapshotImpl,
  type CloudSnapshotSummary,
  type RestoreResult,
  type RestoreProgress,
} from "../lib/cloudSnapshots";
import { loadSnapshot } from "../lib/cloudSnapshots";
import {
  cleanupDictionaries,
  type CleanupOptions,
  type CleanupProgress,
  type CleanupResult,
} from "../lib/accountCleanup";
import { restorePreflight, type RestorePreflight } from "../lib/restorePreflight";
import { loadZenCache } from "../lib/zenmoneyCache";
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
  /** Last successful restore result (counts of accepted entities). */
  lastRestoreResult: RestoreResult | null;
  /** Live progress signal during an in-flight restore. UI consumes
   *  it to render a status bar like "Восстановление: Счета 5 / 31".
   *  Reset to null when restore finishes (success or failure). */
  restoreProgress: RestoreProgress | null;
  /**
   * Итог предполётной сверки — по какому снимку она считана и что вышло.
   *
   * Живёт рядом с id снимка, а не сам по себе: снимков до пяти, и показать
   * итог сверки под чужой строкой — худший вид вранья, чем не показать его
   * вовсе.
   */
  preflight: { id: string; result: RestorePreflight } | null;
  /** Ход уборки справочников; null — не идёт. */
  cleanupProgress: CleanupProgress | null;
  /** Чем кончилась последняя уборка — в том числе неудачные партии. */
  lastCleanupResult: CleanupResult | null;

  hydrate: () => Promise<void>;
  takeSnapshot: () => Promise<void>;
  deleteSnapshot: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  download: (id: string) => Promise<void>;
  /** Import a previously-downloaded snapshot file into the local
   *  IndexedDB. Validated; throws via `error` state on bad input. */
  importFromFile: (file: File) => Promise<void>;
  /** Push the snapshot's contents back to the cloud via `pushDiff`.
   *  Returns the per-entity acceptance counts. Caller is expected
   *  to surface a confirmation dialog before invoking — restore is
   *  potentially destructive (overwrites cloud state). */
  restore: (id: string) => Promise<RestoreResult>;
  /**
   * Сверить снимок с тем, что сейчас в облаке. Ничего не отправляет —
   * только считает по локальному кэшу последней синхронизации.
   */
  checkReadiness: (id: string) => Promise<RestorePreflight>;
  /** Убрать итог сверки (снимок удалили, кэш обновился). */
  clearPreflight: () => void;
  /**
   * Выбросить снимки чужого аккаунта. Зовётся, когда становится известен
   * пользователь текущего токена: слотов пять, и занимать их копиями от
   * прежнего аккаунта незачем.
   */
  pruneForeign: (currentUserId: number) => Promise<number>;
  /**
   * Снести из аккаунта категории и/или контрагентов — то, что «Начать всё
   * сначала» в Дзен-мани не уносит. ПИШЕТ В ОБЛАКО: вызывающий обязан
   * спросить подтверждение.
   */
  cleanup: (opts: CleanupOptions) => Promise<CleanupResult>;
}

export const useCloudSnapshotStore = create<State>((set) => ({
  snapshots: [],
  loaded: false,
  busy: false,
  busyOp: null,
  error: null,
  lastRestoreResult: null,
  restoreProgress: null,
  preflight: null,
  cleanupProgress: null,
  lastCleanupResult: null,

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

  /**
   * Ничего не отправляет: берёт снимок из локальной базы и сверяет его с
   * кэшем последней синхронизации. Кэш обновляем сами — иначе сверка
   * рассказала бы про облако недельной давности.
   */
  checkReadiness: async (id) => {
    set({ busy: true, busyOp: "check", error: null });
    try {
      const snap = await loadSnapshot(id);
      if (!snap) throw new Error("Снимок не найден в локальной базе");
      const cache = await loadZenCache();
      if (!cache) throw new Error("Нет кэша Дзен-мани — сначала синхронизируйтесь");
      const result = restorePreflight(snap.raw, {
        transactions: cache.transactions,
        accounts: cache.accounts,
        tags: cache.tags,
        merchants: cache.merchants,
      });
      set({ busy: false, busyOp: null, preflight: { id, result } });
      return result;
    } catch (e) {
      set({
        busy: false, busyOp: null,
        error: e instanceof Error ? e.message : "Не удалось сверить снимок",
      });
      throw e;
    }
  },

  clearPreflight: () => set({ preflight: null }),

  pruneForeign: async (currentUserId) => {
    const removed = await pruneForeignSnapshots(currentUserId);
    if (removed > 0) set({ snapshots: await loadSnapshotIndex() });
    return removed;
  },

  cleanup: async (opts) => {
    const token = useZenmoneyStore.getState().token;
    if (!token) {
      const msg = "Сначала подключите токен Дзен-мани API";
      set({ error: msg });
      throw new Error(msg);
    }
    set({ busy: true, busyOp: "cleanup", error: null, cleanupProgress: null, lastCleanupResult: null });
    try {
      const result = await cleanupDictionaries(token, opts, (p) =>
        set({ cleanupProgress: p })
      );
      set({ busy: false, busyOp: null, cleanupProgress: null, lastCleanupResult: result });
      return result;
    } catch (e) {
      set({
        busy: false, busyOp: null,
        cleanupProgress: null,
        error: e instanceof Error ? e.message : "Не удалось убрать справочники",
      });
      throw e;
    }
  },

  restore: async (id) => {
    const token = useZenmoneyStore.getState().token;
    if (!token) {
      const msg = "Сначала подключите токен Дзен-мани API";
      set({ error: msg });
      throw new Error(msg);
    }
    // Pull current user id + accounts from the local cache. The
    // restore impl uses these to (a) detect cross-account restores
    // and rewrite `user` fields accordingly, and (b) special-case
    // singular system accounts like the per-user debt account.
    const cache = await loadZenCache();
    const currentUserId = cache?.user?.[0]?.id ?? null;
    const currentAccounts = cache?.accounts ?? [];

    set({ busy: true, busyOp: "restore", error: null, restoreProgress: null });
    try {
      // freshIds: откат заливается НОВЫМИ номерами. Под прежними Дзен-мани
      // не пускает обратно удалённые строки — молча, с ответом 200 и без
      // ошибки (проверено на живом API). Ценой становится потеря привязки к
      // банковским выпискам, зато откат перестаёт зависеть от того, стирает
      // «Начать всё сначала» записи или помечает их удалёнными.
      const result = await restoreSnapshotImpl(
        id,
        token,
        { userId: currentUserId, currentAccounts, freshIds: true },
        (progress) => set({ restoreProgress: progress })
      );
      set({ busy: false, busyOp: null, lastRestoreResult: result, restoreProgress: null });
      return result;
    } catch (e) {
      set({
        busy: false, busyOp: null,
        restoreProgress: null,
        error:
          e instanceof Error
            ? e.message
            : "Не удалось восстановить снимок (см. консоль)",
      });
      throw e;
    }
  },
}));
