import { create } from "zustand";
import {
  loadSnapshot,
  restoreSnapshotToCloud,
  type RestoreProgress,
  type RestoreResult,
} from "../lib/cloudSnapshots";
import {
  cleanupDictionaries,
  type CleanupProgress,
  type CleanupResult,
} from "../lib/accountCleanup";
import { restorePreflight, type RestorePreflight } from "../lib/restorePreflight";
import { loadZenCache } from "../lib/zenmoneyCache";
import { useZenmoneyStore } from "./useZenmoneyStore";

/**
 * Состояние мастера восстановления (#93) — одним явным автоматом.
 *
 * ПОЧЕМУ ОТДЕЛЬНО И ПОЧЕМУ АВТОМАТ. Раньше шаг выводился из смеси локальных
 * флагов окна и полей общего стора: `!entered ? pick : preflight.ready ?
 * confirm : prepare`. Из этого росли ошибки, которые поодиночке выглядели
 * мелочами, а вместе делали мастер ненадёжным:
 *
 *   • закрыли окно — половина состояния (выбор, согласие, время сверки)
 *     исчезала, вторая половина продолжала жить;
 *   • после первого отката признак «уже восстановили» не сбрасывался, и окно
 *     до конца сессии открывалось сразу на «Готово»;
 *   • заливка падала на середине — и мастер возвращался на «можно заливать» с
 *     активной кнопкой, а повтор задваивал уже залитое.
 *
 * Здесь фаза одна, живёт в сторе (значит переживает закрытие окна) и меняется
 * только явными переходами.
 *
 * ГЛАВНОЕ ПРАВИЛО: НЕ ВЕРИТЬ КЭШУ. Дзен-мани умеет ответить 200 и молча ничего
 * не сделать — на этом стоит вся задача. Поэтому и сверка, и проверка после
 * уборки сначала синхронизируются с облаком и только потом считают. Прежняя
 * версия читала локальный кэш: после «Начать всё сначала» он оставался полным,
 * и мастер вечно докладывал «в аккаунте 7 660 операций»; а после уборки —
 * наоборот, докладывал «пусто» при живых категориях в облаке.
 */

export type WizardPhase =
  /** Выбираем снимок и берём согласие на необратимость. */
  | "pick"
  /** Ждём, пока пользователь очистит аккаунт в Дзен-мани. */
  | "clear"
  /** Аккаунт пуст, остались справочники — их удаляем мы. */
  | "dictionaries"
  /** Всё готово, можно заливать. */
  | "ready"
  /** Заливка идёт. */
  | "restoring"
  /** Заливка упала на середине: часть данных уже в облаке. */
  | "partial"
  /** Заливка прошла. */
  | "done";

/** Сколько сверка считается свежей. Дальше — пересверить. */
export const CHECK_FRESH_MS = 60_000;

interface State {
  phase: WizardPhase;
  /** Снимок, с которым работаем. */
  snapshotId: string | null;
  /** Согласие с необратимостью. Сбрасывается при смене снимка. */
  accepted: boolean;
  /** Итог последней сверки и когда она сделана. */
  preflight: RestorePreflight | null;
  checkedAt: number | null;
  /** Что именно сейчас выполняется; null — ничего. */
  running: "check" | "cleanup" | "restore" | null;
  cleanupProgress: CleanupProgress | null;
  cleanupResult: CleanupResult | null;
  restoreProgress: RestoreProgress | null;
  restoreResult: RestoreResult | null;
  /** Сколько операций успело уйти до падения — для фазы `partial`. */
  error: string | null;

  /** Открыть мастер начисто. */
  open: (snapshotId: string | null) => void;
  pick: (snapshotId: string) => void;
  accept: (v: boolean) => void;
  /** Уйти с выбора к подготовке. */
  begin: () => void;
  /** Вернуться к выбору снимка. */
  back: () => void;
  /** Синхронизироваться и пересчитать готовность. */
  check: () => Promise<void>;
  /** Удалить справочники, затем пересверить. */
  cleanup: () => Promise<void>;
  /** Залить снимок. */
  restore: () => Promise<void>;
}

/** Фаза по итогу сверки. Единственное место, где результат превращается в шаг. */
function phaseFor(p: RestorePreflight): WizardPhase {
  if (p.blockers.some((b) => b.kind === "notEmpty")) return "clear";
  if (p.blockers.length > 0) return "dictionaries";
  return "ready";
}

export const useRestoreWizardStore = create<State>((set, get) => ({
  phase: "pick",
  snapshotId: null,
  accepted: false,
  preflight: null,
  checkedAt: null,
  running: null,
  cleanupProgress: null,
  cleanupResult: null,
  restoreProgress: null,
  restoreResult: null,
  error: null,

  open: (snapshotId) => {
    // Начисто — кроме случая, когда работа идёт прямо сейчас: закрыли окно во
    // время уборки, открыли снова — надо вернуться на живой прогресс, а не
    // сбросить его.
    if (get().running) return;
    set({
      phase: "pick",
      snapshotId,
      accepted: false,
      preflight: null,
      checkedAt: null,
      cleanupProgress: null,
      cleanupResult: null,
      restoreProgress: null,
      restoreResult: null,
      error: null,
    });
  },

  pick: (snapshotId) =>
    // Сменили снимок — согласие и сверка относятся уже не к нему.
    set({ snapshotId, accepted: false, preflight: null, checkedAt: null, error: null }),

  accept: (v) => set({ accepted: v }),

  begin: () => set({ phase: "clear", error: null }),

  back: () => set({ phase: "pick", preflight: null, checkedAt: null, error: null }),

  check: async () => {
    const { snapshotId, running } = get();
    if (!snapshotId || running) return;
    const token = useZenmoneyStore.getState().token;
    if (!token) {
      set({ error: "Подключите Дзен-мани — без него проверять нечего" });
      return;
    }
    set({ running: "check", error: null });
    try {
      // СНАЧАЛА синхронизация. Локальный кэш после «Начать всё сначала» ещё
      // полон, и без этого шага мастер докладывал бы старое состояние вечно.
      await useZenmoneyStore.getState().sync({ force: true });
      const snap = await loadSnapshot(snapshotId);
      if (!snap) throw new Error("Снимок не найден — возможно, его удалили");
      const cache = await loadZenCache();
      if (!cache) throw new Error("Нет данных Дзен-мани");
      const result = restorePreflight(snap.raw, {
        transactions: cache.transactions,
        accounts: cache.accounts,
        tags: cache.tags,
        merchants: cache.merchants,
      });
      set({
        running: null,
        preflight: result,
        checkedAt: Date.now(),
        phase: phaseFor(result),
      });
    } catch (e) {
      set({
        running: null,
        error: e instanceof Error ? e.message : "Не удалось проверить аккаунт",
      });
    }
  },

  cleanup: async () => {
    const { running } = get();
    if (running) return;
    const token = useZenmoneyStore.getState().token;
    if (!token) return;
    set({ running: "cleanup", error: null, cleanupResult: null, cleanupProgress: null });
    let result: CleanupResult;
    try {
      result = await cleanupDictionaries(token, { tags: true, merchants: true }, (p) =>
        set({ cleanupProgress: p })
      );
    } catch (e) {
      set({
        running: null,
        cleanupProgress: null,
        error: e instanceof Error ? e.message : "Не удалось удалить справочники",
      });
      return;
    }
    set({ running: null, cleanupProgress: null, cleanupResult: result });
    // Итог считает облако, а не мы: уборка знает только то, что запросы ушли
    // без ошибки, а это не доказательство удаления.
    await get().check();
  },

  restore: async () => {
    const { snapshotId, running, phase } = get();
    if (!snapshotId || running) return;
    // Заливать можно только из «готово». После неудачной попытки фаза
    // `partial`, и повтор запрещён: он залил бы всё заново поверх уже
    // залитого, под новыми номерами — то есть задвоил бы.
    if (phase !== "ready") return;
    const token = useZenmoneyStore.getState().token;
    if (!token) return;
    const cache = await loadZenCache();
    set({ running: "restore", phase: "restoring", error: null, restoreProgress: null });
    try {
      const result = await restoreSnapshotToCloud(
        snapshotId,
        token,
        {
          userId: cache?.user?.[0]?.id ?? null,
          currentAccounts: cache?.accounts ?? [],
          freshIds: true,
        },
        (p) => set({ restoreProgress: p })
      );
      set({ running: null, restoreProgress: null, restoreResult: result, phase: "done" });
    } catch (e) {
      set({
        running: null,
        restoreProgress: null,
        phase: "partial",
        error: e instanceof Error ? e.message : "Заливка прервалась",
      });
    }
  },
}));
