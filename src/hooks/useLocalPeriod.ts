import { useEffect, useMemo, useRef, useState } from "react";
import { isWindowPreset, useFiltersStore, type DatePreset } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { currentPeriod, shiftPeriod } from "../lib/period";

/**
 * The period slice of the filter store, as a standalone controller. History
 * pages (Cash-flow, Trends) keep their OWN period — a wide default span like
 * «12 мес» — instead of the global «месяц», but still want the FULL set of
 * controls: presets, a specific month, and a custom range. This mirrors exactly
 * the fields/handlers `GlobalFilters` reads off the store, so the component can
 * treat either source uniformly (see its `periodCtl`).
 */
export interface PeriodController {
  preset: DatePreset;
  /** Сдвиг скользящего окна стрелками, в окнах (см. `FiltersState.windowShift`). */
  windowShift: number;
  monthYM: string | null;
  from: string | null;
  to: string | null;
  setPreset: (p: DatePreset) => void;
  setRange: (from: string | null, to: string | null) => void;
  setMonth: (ym: string) => void;
  setPeriodMonth: (ym: string) => void;
  setQuarter: (ym: string) => void;
  setYear: (year: number) => void;
  /** Шагнуть на соседний период — единица берётся из пресета: месяц, квартал или год. */
  stepPeriod: (delta: number, fallbackMaxYM: string) => void;
}

/**
 * Local, page-scoped period. Same semantics as the store's period setters
 * (setRange → preset "custom", setMonth/stepPeriod → preset "month"/"year"), just held
 * in component state so it never touches the global «месяц».
 *
 * Второй аргумент — месяц из ссылки (`/report?month=2026-08`).
 */
export function useLocalPeriod(
  defaultPreset: DatePreset = "12m",
  /**
   * Месяц, заданный ссылкой (`/report?month=2026-08`).
   *
   * Главнее и умолчания страницы, и глобального периода: раз в ссылке прямо
   * сказано, за какой месяц открыть, ни своя широкая «Всё», ни чужой
   * сохранённый диапазон «от/до» перебить это не должны. Ставится начальным
   * значением, а не эффектом после отрисовки, — иначе первый кадр страница
   * рисует не тем периодом, а потом перерисовывается.
   */
  initialMonthYM?: string | null
): PeriodController {
  const gPreset = useFiltersStore((s) => s.preset);
  const gShift = useFiltersStore((s) => s.windowShift);
  const gFrom = useFiltersStore((s) => s.from);
  const gTo = useFiltersStore((s) => s.to);
  const gMonthYM = useFiltersStore((s) => s.monthYM);

  // Adopt an explicit date RANGE that's already active on mount (a saved filter
  // «от/до» applied on another page), but not the plain default month — the
  // page should still open on its own wide span.
  const pinned = initialMonthYM || null;
  const [preset, setPreset] = useState<DatePreset>(
    // Месяц из ссылки — отчётный, как на главной: отрезок должен совпасть с
    // тем, что называют «месяцем» остальные разделы.
    pinned ? "period" : gPreset === "custom" ? "custom" : defaultPreset
  );
  const [monthYM, setMonthYM] = useState<string | null>(
    pinned ??
      (gPreset === "custom"
        ? gMonthYM
        : currentPeriod(useReportPeriodStore.getState().monthStartDay))
  );
  const [from, setFrom] = useState<string | null>(
    pinned ? null : gPreset === "custom" ? gFrom : null
  );
  const [to, setTo] = useState<string | null>(
    pinned ? null : gPreset === "custom" ? gTo : null
  );
  const [windowShift, setWindowShift] = useState(0);

  // Follow the GLOBAL period whenever it actually CHANGES — that's a saved
  // filter being applied (it carries «от»/«до» dates), or the period changed
  // elsewhere. Without this the page kept its own period and silently ignored a
  // saved date filter (issue #40). The page's own period pills write to LOCAL
  // state only, so they never trigger this.
  //
  // Compare against the previous value rather than "skip the first run": under
  // StrictMode effects fire twice on mount, and a run-counter would treat the
  // second one as a real change and clobber the page's own default period.
  const prevGlobal = useRef({ preset: gPreset, from: gFrom, to: gTo, monthYM: gMonthYM });
  useEffect(() => {
    const p = prevGlobal.current;
    if (p.preset === gPreset && p.from === gFrom && p.to === gTo && p.monthYM === gMonthYM) {
      return;
    }
    prevGlobal.current = { preset: gPreset, from: gFrom, to: gTo, monthYM: gMonthYM };
    setPreset(gPreset);
    setFrom(gFrom);
    setTo(gTo);
    setMonthYM(gMonthYM);
    setWindowShift(gShift);
  }, [gPreset, gFrom, gTo, gMonthYM, gShift]);

  return useMemo(
    () => ({
      preset,
      windowShift,
      monthYM,
      from,
      to,
      setPreset: (p: DatePreset) => {
        setPreset(p);
        setWindowShift(0);
      },
      setRange: (f: string | null, t: string | null) => {
        setFrom(f);
        setTo(t);
        setPreset("custom");
        setWindowShift(0);
      },
      setMonth: (ym: string) => {
        setPreset("month");
        setMonthYM(ym);
        setWindowShift(0);
      },
      setPeriodMonth: (ym: string) => {
        setWindowShift(0);
        setPreset("period");
        setMonthYM(ym);
        setFrom(null);
        setTo(null);
      },
      setQuarter: (ym: string) => {
        setWindowShift(0);
        setPreset("quarter");
        setMonthYM(ym);
      },
      setYear: (year: number) => {
        setWindowShift(0);
        setPreset("year");
        setMonthYM(
          `${year}-${(monthYM ?? currentPeriod(useReportPeriodStore.getState().monthStartDay)).slice(5, 7)}`
        );
      },
      stepPeriod: (delta: number, fallbackMaxYM: string) => {
        // Окно листается окнами и остаётся выбранным (как в общем фильтре).
        if (isWindowPreset(preset)) {
          setWindowShift((s) => Math.min(0, s + delta));
          return;
        }
        const anchored =
          preset === "month" || preset === "quarter" || preset === "year" || preset === "period";
        // После своего отрезка — от месяца его начала (как в общем фильтре).
        const cur =
          anchored && monthYM ? monthYM : preset === "custom" && from ? from.slice(0, 7) : fallbackMaxYM;
        // Единица шага сохраняется: отчётный месяц листается отчётными.
        const keep = preset === "year" || preset === "quarter" || preset === "period";
        setPreset(keep ? preset : "month");
        setMonthYM(shiftPeriod(cur, delta * (preset === "year" ? 12 : preset === "quarter" ? 3 : 1)));
        if (preset === "period") {
          setFrom(null);
          setTo(null);
        }
      },
    }),
    [preset, windowShift, monthYM, from, to]
  );
}
