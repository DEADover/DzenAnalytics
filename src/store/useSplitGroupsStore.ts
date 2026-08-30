/**
 * Связи разделённых операций (issue #69).
 *
 * Разбивка превращает одну операцию в несколько настоящих: исходная ужимается
 * до первой части, остальные создаются рядом и уезжают в Дзен-мани обычными
 * операциями. Так суммы сходятся везде, включая мобильное приложение.
 *
 * Но сам Дзен-мани хранить связь между ними негде — для него это просто
 * несколько покупок в один день. Поэтому связь держим здесь: какая часть из
 * какой операции выросла и чем операция была до разбивки.
 *
 * Связь переживает синхронизацию: id частей мы генерируем САМИ (`newDraftId`),
 * и после отправки в облаке оказываются те же самые. Ничего сопоставлять по
 * дате и сумме — как это пришлось бы делать при серверных id — не нужно.
 *
 * Сейчас записи НИКТО не читает: пометки «часть 1 из 3» в ленте и отмена
 * разбивки сняты как преждевременные. Запись оставлена намеренно — это след
 * того, что из чего получилось, и без него у разбивок, сделанных за это
 * время, восстановить связь будет уже неоткуда.
 */

import { create } from "zustand";
import * as db from "../lib/db";

const KEY = "splitGroups";

/** Одна часть разбивки в её постоянном виде. */
export interface SplitPart {
  /** Id операции — для первой части это id исходной. */
  id: string;
  category: string;
  subcategory: string | null;
  amount: number;
}

/** Разбивка одной операции. */
export interface SplitGroup {
  /**
   * Ключ записи — свой, а не id исходной операции.
   *
   * Часть можно разделить ещё раз, и тогда исходной становится она сама.
   * По ключу-`sourceId` вторая разбивка затирала бы первую, и след «что из
   * чего получилось» терялся бы ровно там, где он интереснее всего.
   */
  id: string;
  sourceId: string;
  /** Когда разделили, ISO. */
  createdAt: string;
  /** Дата и контрагент исходной — чтобы группа читалась сама по себе, даже
   *  когда часть операций уже не загружена (обрезанная история). */
  date: string;
  payee: string;
  /** Чем операция была до разбивки — чтобы знать, из чего она получилась. */
  originalAmount: number;
  originalCategory: string;
  originalSubcategory: string | null;
  /** Части по порядку. Первая — сама исходная операция. */
  parts: SplitPart[];
}

interface SplitGroupsState {
  /** id записи → разбивка. */
  groups: Record<string, SplitGroup>;
  loaded: boolean;
  hydrate: () => Promise<void>;
  add: (group: SplitGroup) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useSplitGroupsStore = create<SplitGroupsState>((set, get) => ({
  groups: {},
  loaded: false,

  hydrate: async () => {
    const data = await db.loadJSON<Record<string, SplitGroup>>(KEY);
    set({ groups: data || {}, loaded: true });
  },

  add: async (group) => {
    const next = { ...get().groups, [group.id]: group };
    await db.saveJSON(KEY, next);
    set({ groups: next });
  },

  remove: async (id) => {
    const next = { ...get().groups };
    delete next[id];
    await db.saveJSON(KEY, next);
    set({ groups: next });
  },
}));

