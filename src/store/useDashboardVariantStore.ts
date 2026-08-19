import { create } from "zustand";
import * as db from "../lib/db";

/**
 * Какой вариант главной страницы показывать.
 *
 * Пока идёт выбор оформления, все варианты живут в приложении одновременно и
 * переключаются на месте: сравнивать раскладки по картинкам бесполезно —
 * решает то, как они выглядят на своих двенадцати счетах и сорока месяцах
 * истории. Выбор запоминается, чтобы не сбрасывался при каждой перезагрузке.
 *
 * `current` — нынешняя главная, оставлена намеренно: без неё не с чем
 * сравнивать.
 */
export type DashboardVariant = "current" | "summary" | "bento" | "classic" | "premium";

export const DASHBOARD_VARIANTS: { value: DashboardVariant; label: string; hint: string }[] = [
  { value: "current", label: "Как сейчас", hint: "Нынешняя главная, без изменений" },
  { value: "summary", label: "Сводка", hint: "Один вывод крупно, разделы без рамок" },
  { value: "bento", label: "Бенто", hint: "Плотная панель из плиток разного размера" },
  { value: "classic", label: "Эволюция", hint: "Тот же порядок блоков, вычищенный" },
  { value: "premium", label: "Премиум", hint: "Разворот на первом экране, двойной кант" },
];

interface VariantState {
  variant: DashboardVariant;
  loaded: boolean;
  hydrate: () => Promise<void>;
  setVariant: (value: DashboardVariant) => Promise<void>;
}

const KEY = "dashboardVariant";

const KNOWN = new Set(DASHBOARD_VARIANTS.map((v) => v.value));

export const useDashboardVariantStore = create<VariantState>((set) => ({
  // По умолчанию — «Премиум»: ради него редизайн и делался. Нынешняя главная
  // осталась в переключателе, чтобы было с чем сравнить, но открываться должна
  // новая, иначе изменения не видит никто.
  variant: "premium",
  loaded: false,
  hydrate: async () => {
    const data = await db.loadJSON<DashboardVariant>(KEY);
    // Незнакомое значение может остаться от версии, где вариант убрали:
    // молча откатываемся к умолчанию, а не падаем на пустом экране.
    set({ variant: data && KNOWN.has(data) ? data : "premium", loaded: true });
  },
  setVariant: async (value) => {
    await db.saveJSON(KEY, value);
    set({ variant: value });
  },
}));
