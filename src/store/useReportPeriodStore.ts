import { create } from "zustand";
import * as db from "../lib/db";

/**
 * "Отчётный период" — the day of the calendar month on which the user's
 * personal accounting month begins. Default 1 (calendar month). Значения
 * 1–31, как и в приложении Дзен-мани: в месяце, где такого числа нет, период
 * начинается в его последний день (см. `startDayIn` в lib/period).
 *
 * This store is consulted by:
 *   - useFiltersStore — "Месяц" preset range + month-step chevrons
 *   - DashboardPage — hero KPI "Доход / Расход" for "last period",
 *     Top-10 категорий за текущий период
 *   - CashflowPage — monthly bars / table / drill-down
 *   - groupByMonth in aggregations.ts (via opts)
 *
 * ДВА ИСТОЧНИКА. День задаёт человек (`ownDay`, ключ `reportPeriod` в
 * IndexedDB) — это главное значение. При подключённом Дзен-мани мы знаем его
 * день (`zenDay`) и подставляем его тем, кто свой ещё не выбирал: так отчёты
 * из коробки сходятся с приложением. Как только день выбран здесь (`ownSet`),
 * действует он, а расхождение с Дзен-мани показывается предупреждением в
 * настройках (решение 17.09.2026: возможность выбрать день вернули).
 * Потребители смотрят только на `monthStartDay` — действующее значение.
 */
interface ReportPeriodState {
  /** Действующий день: свой, если он выбран, иначе день из Дзен-мани. */
  monthStartDay: number;
  /** Свой день. Хранится на диске. */
  ownDay: number;
  /** Свой день выбран человеком, а не подставлен из Дзен-мани. */
  ownSet: boolean;
  /** День из настроек Дзен-мани; `null` — Дзен-мани не подключён. */
  zenDay: number | null;
  loaded: boolean;
  hydrate: () => Promise<void>;
  setMonthStartDay: (day: number) => Promise<void>;
  /** Принять день из настроек Дзен-мани (`null` — отключился). */
  adoptZenDay: (day: number | null | undefined) => void;
  /** Снова следовать за Дзен-мани: свой выбор забывается. */
  followZenDay: () => Promise<void>;
}

export const useReportPeriodStore = create<ReportPeriodState>((set) => ({
  monthStartDay: 1,
  ownDay: 1,
  ownSet: false,
  zenDay: null,
  loaded: false,
  hydrate: async () => {
    const data = await db.loadJSON<{ monthStartDay: number }>("reportPeriod");
    // Запись есть только у того, кто день выбирал: пишем мы её лишь в setMonthStartDay.
    const own = data && typeof data.monthStartDay === "number" ? clamp(data.monthStartDay) : null;
    const ownSet = own !== null;
    // День из Дзен-мани мог приехать раньше, чем прочитался свой: не затираем.
    set((s) => ({
      ownDay: own ?? s.zenDay ?? 1,
      ownSet,
      monthStartDay: own ?? s.zenDay ?? 1,
      loaded: true,
    }));
  },
  setMonthStartDay: async (day) => {
    const value = clamp(day);
    await db.saveJSON("reportPeriod", { monthStartDay: value });
    set({ ownDay: value, ownSet: true, monthStartDay: value });
  },
  followZenDay: async () => {
    await db.saveJSON("reportPeriod", null);
    set((s) => ({ ownSet: false, ownDay: s.zenDay ?? s.ownDay, monthStartDay: s.zenDay ?? s.ownDay }));
  },
  adoptZenDay: (day) => {
    const zenDay = typeof day === "number" && Number.isFinite(day) ? clamp(day) : null;
    set((s) => {
      // Свой день выбран — он и действует, день Дзен-мани только для сверки.
      if (s.ownSet) return { zenDay, monthStartDay: s.ownDay };
      const day = zenDay ?? s.ownDay;
      return { zenDay, ownDay: day, monthStartDay: day };
    });
  },
}));

/**
 * 1–31. Столько же разрешает приложение Дзен-мани, а короткие месяцы
 * разбираются при расчёте периода, а не обрезанием настройки: раньше день 31
 * из Дзен-мани молча превращался у нас в 28, и отчёты расходились с
 * приложением на три дня.
 */
function clamp(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(31, Math.round(n)));
}
