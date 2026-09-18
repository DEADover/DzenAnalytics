/**
 * Какие СПИСКИ переносятся между устройствами через Дзен-мани.
 *
 * Отдельно от полей (`cloudSettingsFields`), потому что сливаются иначе: у
 * списка каждый элемент сам по себе, и правки на двух устройствах не затирают
 * друг друга — добавленная здесь цель и переименованный там разрез доедут оба.
 * У полей же побеждает более поздняя правка целиком.
 *
 * Ссылки внутри — на счета и категории по названию, как во всех фильтрах
 * сервиса. Названия живут в самом Дзен-мани и на всех устройствах одинаковы,
 * поэтому переносить их можно как есть; правила — исключение, там ссылки
 * приводятся к объектам Дзен-мани при замене (см. `reconcileRefsFromCache`).
 */

import type { StoreApi, UseBoundStore } from "zustand";
import type { CloudCollectionType } from "../lib/cloudSettings";
import { useCategoryRulesStore } from "./useCategoryRulesStore";
import { useGoalsStore } from "./useGoalsStore";
import { useSavedViewsStore } from "./useSavedViewsStore";
import { useSlicesStore } from "./useSlicesStore";

/** Элемент списка: своё устойчивое имя и, по возможности, время создания. */
export interface CloudItem {
  id: string;
  createdAt?: string;
}

export interface SyncedCollection {
  type: CloudCollectionType;
  /** Хранилище уже прочитало своё с диска — до этого список не настоящий. */
  ready: () => boolean;
  read: () => readonly CloudItem[];
  /** Применить пришедшее из облака. */
  replace: (items: readonly CloudItem[]) => Promise<void>;
  subscribe: (listener: () => void) => () => void;
}

type AnyStore<S> = UseBoundStore<StoreApi<S>>;

function collection<S, T extends CloudItem>(
  store: AnyStore<S>,
  type: CloudCollectionType,
  read: (s: S) => readonly T[],
  replace: (items: readonly T[], s: S) => Promise<void>
): SyncedCollection {
  return {
    type,
    ready: () => (store.getState() as { loaded?: boolean }).loaded !== false,
    read: () => read(store.getState()),
    replace: (items) => replace(items as readonly T[], store.getState()),
    subscribe: (listener) => store.subscribe(listener),
  };
}

export const SYNCED_COLLECTIONS: readonly SyncedCollection[] = [
  collection(useCategoryRulesStore, "rules", (s) => s.rules, (items, s) => s.replaceAll(items)),
  collection(useGoalsStore, "goals", (s) => s.goals, (items, s) => s.replaceAll(items)),
  collection(useSavedViewsStore, "views", (s) => s.views, (items, s) => s.replaceAll(items)),
  collection(useSlicesStore, "slices", (s) => s.slices, (items, s) => s.replaceAll(items)),
];

export function syncedCollection(type: string): SyncedCollection | undefined {
  return SYNCED_COLLECTIONS.find((c) => c.type === type);
}
