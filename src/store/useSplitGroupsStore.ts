/**
 * Связи разделённых операций (issue #69).
 *
 * Разбивка превращает одну операцию в несколько настоящих: исходная ужимается
 * до первой части, остальные создаются рядом и уезжают в Дзен-мани обычными
 * операциями. Так суммы сходятся везде, включая мобильное приложение.
 *
 * Но сам Дзен-мани хранить связь между ними негде — для него это просто
 * несколько покупок в один день. Поэтому связь держим здесь: какая часть из
 * какой операции выросла и чем операция была до разбивки. Отсюда же берётся
 * возможность откатить разбивку и показать, из чего операция состоит.
 *
 * Связь переживает синхронизацию: id частей мы генерируем САМИ (`newDraftId`),
 * и после отправки в облаке оказываются те же самые. Ничего сопоставлять по
 * дате и сумме — как это пришлось бы делать при серверных id — не нужно.
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

/** Разбивка одной операции. Ключ — id исходной операции. */
export interface SplitGroup {
  sourceId: string;
  /** Когда разделили, ISO. */
  createdAt: string;
  /** Дата и контрагент исходной — чтобы показать группу, даже когда часть
   *  операций уже не загружена (обрезанная история). */
  date: string;
  payee: string;
  /** Чем операция была до разбивки: нужно, чтобы откатить. */
  originalAmount: number;
  originalCategory: string;
  originalSubcategory: string | null;
  /** Части по порядку. Первая — сама исходная операция. */
  parts: SplitPart[];
}

interface SplitGroupsState {
  /** sourceId → разбивка. */
  groups: Record<string, SplitGroup>;
  loaded: boolean;
  hydrate: () => Promise<void>;
  add: (group: SplitGroup) => Promise<void>;
  remove: (sourceId: string) => Promise<void>;
}

export const useSplitGroupsStore = create<SplitGroupsState>((set, get) => ({
  groups: {},
  loaded: false,

  hydrate: async () => {
    const data = await db.loadJSON<Record<string, SplitGroup>>(KEY);
    set({ groups: data || {}, loaded: true });
  },

  add: async (group) => {
    const next = { ...get().groups, [group.sourceId]: group };
    await db.saveJSON(KEY, next);
    set({ groups: next });
  },

  remove: async (sourceId) => {
    const next = { ...get().groups };
    delete next[sourceId];
    await db.saveJSON(KEY, next);
    set({ groups: next });
  },
}));

/**
 * Обратный поиск: по id ЛЮБОЙ части найти её разбивку.
 *
 * Лента показывает части обычными строками, и каждой нужна пометка «часть
 * операции такой-то». Искать перебором групп на каждую строку — это N×M на
 * каждый рендер списка в тысячи строк; карта строится один раз на изменение
 * состава групп.
 */
export function indexPartsByGroup(
  groups: Record<string, SplitGroup>
): Map<string, SplitGroup> {
  const out = new Map<string, SplitGroup>();
  for (const group of Object.values(groups)) {
    for (const part of group.parts) out.set(part.id, group);
  }
  return out;
}

/** Номер части внутри своей разбивки, считая с единицы. 0 — не часть. */
export function partNumber(group: SplitGroup, id: string): number {
  return group.parts.findIndex((p) => p.id === id) + 1;
}
