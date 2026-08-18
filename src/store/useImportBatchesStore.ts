/**
 * Партии импорта: какие операции родились из какого файла.
 *
 * Нужны для двух вещей, и обе — про «безболезненно»:
 *
 *   • «Отменить импорт» одной кнопкой. Без партии единственная массовая отмена
 *     сносит ВСЕ черновики разом, включая созданные руками десять минут назад.
 *   • Узнавание повторной загрузки: у черновика всегда свежий id, поэтому один
 *     и тот же файл, загруженный дважды, создаёт вторые копии всего. Отпечаток
 *     файла в записи партии позволяет сказать об этом прямо.
 *
 * Храним последние десять записей: журнал импорта — не архив, а подсказка «что
 * я тут недавно наделал».
 */

import { create } from "zustand";
import * as db from "../lib/db";

const KEY = "importBatches";
const KEEP = 10;

export interface ImportBatch {
  /** Отпечаток файла — он же ключ: тот же файл даёт ту же запись. */
  id: string;
  fileName: string;
  importedAt: string;
  /** Id созданных черновиков — по ним партия и отменяется. */
  draftIds: string[];
  /**
   * Контрагенты, заведённые этой партией.
   *
   * Отмена импорта обязана убрать и их: иначе в справочнике оставались бы
   * записи под операции, которых уже нет. Поле необязательное — партии,
   * записанные до появления этой возможности, просто не знают о нём.
   */
  counterpartyIds?: string[];
  /** Когда партия уехала в облако; пусто — ещё лежит черновиками. */
  pushedAt?: string;
}

interface BatchesState {
  batches: ImportBatch[];
  loaded: boolean;
  hydrate: () => Promise<void>;
  add: (batch: ImportBatch) => Promise<void>;
  /** Забыть партию — после отмены импорта или когда она уехала и не нужна. */
  remove: (id: string) => Promise<void>;
  /** Отметить, что партия отправлена: отменять её уже нельзя, только удалять. */
  markPushed: (ids: string[], at: string) => Promise<void>;
  /**
   * Отметить партии, чьи операции уехали в облако.
   *
   * Зовётся после успешной отправки: с этого мгновения «Отменить импорт» лжёт
   * — черновиков нет, удалять нечего, а операции уже в Дзен-мани. Кнопка
   * должна исчезнуть, и решает это факт отправки, а не догадка интерфейса.
   */
  markPushedByDrafts: (draftIds: string[], at: string) => Promise<void>;
}

export const useImportBatchesStore = create<BatchesState>((set, get) => ({
  batches: [],
  loaded: false,

  hydrate: async () => {
    const data = await db.loadJSON<ImportBatch[]>(KEY);
    set({ batches: Array.isArray(data) ? data : [], loaded: true });
  },

  add: async (batch) => {
    // Повторная загрузка того же файла заменяет запись, а не плодит вторую:
    // отменять всё равно есть смысл только последнюю.
    const next = [batch, ...get().batches.filter((b) => b.id !== batch.id)].slice(0, KEEP);
    await db.saveJSON(KEY, next);
    set({ batches: next });
  },

  remove: async (id) => {
    const next = get().batches.filter((b) => b.id !== id);
    if (next.length === get().batches.length) return;
    await db.saveJSON(KEY, next);
    set({ batches: next });
  },

  markPushedByDrafts: async (draftIds, at) => {
    const sent = new Set(draftIds);
    const touched = get()
      .batches.filter((b) => !b.pushedAt && b.draftIds.some((id) => sent.has(id)))
      .map((b) => b.id);
    if (touched.length === 0) return;
    await get().markPushed(touched, at);
  },

  markPushed: async (ids, at) => {
    const set0 = new Set(ids);
    const next = get().batches.map((b) => (set0.has(b.id) ? { ...b, pushedAt: at } : b));
    await db.saveJSON(KEY, next);
    set({ batches: next });
  },
}));

/**
 * Отпечаток файла — по имени, размеру и содержимому.
 *
 * Простая сумма по байтам: криптостойкость тут не нужна, нужна дешёвая проверка
 * «этот же файл или другой», а `crypto.subtle` асинхронен и в офлайне ведёт
 * себя по-разному в разных браузерах.
 */
export function fileFingerprint(name: string, bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < view.length; i++) {
    h1 = (h1 ^ view[i]) >>> 0;
    h1 = (h1 * 16777619) >>> 0;
    // Вторая свёртка с другим шагом: у одного 32-битного хеша столкновения на
    // похожих таблицах слишком вероятны.
    if (i % 3 === 0) h2 = ((h2 << 5) - h2 + view[i]) >>> 0;
  }
  return `${name}:${view.length}:${h1.toString(36)}${h2.toString(36)}`;
}
