import { create } from "zustand";
import * as db from "../lib/db";

/**
 * "Отчётный период" — the day of the calendar month on which the user's
 * personal accounting month begins. Default 1 (calendar month). Values
 * are clamped to 1..28 in the UI (29–31 don't exist in every month).
 *
 * This store is consulted by:
 *   - useFiltersStore — "Месяц" preset range + month-step chevrons
 *   - DashboardPage — hero KPI "Доход / Расход" for "last period",
 *     Top-10 категорий за текущий период
 *   - CashflowPage — monthly bars / table / drill-down
 *   - groupByMonth in aggregations.ts (via opts)
 *
 * ДВА ИСТОЧНИКА. При подключённом Дзен-мани день берётся из его настроек
 * (`user.monthStartDay`) — так отчёты не расходятся с приложением, а своя
 * настройка не заводит второй «правды» (решение 16.09.2026). Свой день
 * (`ownDay`, ключ `reportPeriod` в IndexedDB) остаётся для режима CSV и
 * возвращается, если Дзен-мани отключить. Потребители смотрят только на
 * `monthStartDay` — действующее значение из двух.
 */
interface ReportPeriodState {
  /** Действующий день: из Дзен-мани, если он подключён, иначе свой. */
  monthStartDay: number;
  /** Свой день — для CSV. Хранится на диске. */
  ownDay: number;
  /** День из настроек Дзен-мани; `null` — Дзен-мани не подключён. */
  zenDay: number | null;
  loaded: boolean;
  hydrate: () => Promise<void>;
  setMonthStartDay: (day: number) => Promise<void>;
  /** Принять день из настроек Дзен-мани (`null` — отключился). */
  adoptZenDay: (day: number | null | undefined) => void;
}

export const useReportPeriodStore = create<ReportPeriodState>((set) => ({
  monthStartDay: 1,
  ownDay: 1,
  zenDay: null,
  loaded: false,
  hydrate: async () => {
    const data = await db.loadJSON<{ monthStartDay: number }>("reportPeriod");
    const day =
      data && typeof data.monthStartDay === "number"
        ? clamp(data.monthStartDay)
        : 1;
    // День из Дзен-мани мог приехать раньше, чем прочитался свой: не затираем.
    set((s) => ({ ownDay: day, monthStartDay: s.zenDay ?? day, loaded: true }));
  },
  setMonthStartDay: async (day) => {
    const value = clamp(day);
    await db.saveJSON("reportPeriod", { monthStartDay: value });
    set((s) => ({ ownDay: value, monthStartDay: s.zenDay ?? value }));
  },
  adoptZenDay: (day) => {
    const zenDay = typeof day === "number" && Number.isFinite(day) ? clamp(day) : null;
    set((s) => ({ zenDay, monthStartDay: zenDay ?? s.ownDay }));
  },
}));

/**
 * 1–28. Дзен-мани позволяет и 29–31, но их нет в каждом месяце — такой день
 * прижимаем к 28, как и свой.
 */
function clamp(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(28, Math.round(n)));
}
