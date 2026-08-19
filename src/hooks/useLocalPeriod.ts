import { useEffect, useMemo, useRef, useState } from "react";
import { useFiltersStore, type DatePreset } from "../store/useFiltersStore";
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
  monthYM: string | null;
  from: string | null;
  to: string | null;
  setPreset: (p: DatePreset) => void;
  setRange: (from: string | null, to: string | null) => void;
  setMonth: (ym: string) => void;
  setYear: (year: number) => void;
  /** Шагнуть на соседний период — единица берётся из пресета: месяц или год. */
  stepPeriod: (delta: number, fallbackMaxYM: string) => void;
}

/**
 * Local, page-scoped period. Same semantics as the store's period setters
 * (setRange → preset "custom", setMonth/stepPeriod → preset "month"/"year"), just held
 * in component state so it never touches the global «месяц».
 *
 * Второй аргумент — месяц из ссылки: им пользуется «Месячный отчёт» с главной.
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
  const gFrom = useFiltersStore((s) => s.from);
  const gTo = useFiltersStore((s) => s.to);
  const gMonthYM = useFiltersStore((s) => s.monthYM);

  // Adopt an explicit date RANGE that's already active on mount (a saved filter
  // «от/до» applied on another page), but not the plain default month — the
  // page should still open on its own wide span.
  const pinned = initialMonthYM || null;
  const [preset, setPreset] = useState<DatePreset>(
    pinned ? "month" : gPreset === "custom" ? "custom" : defaultPreset
  );
  const [monthYM, setMonthYM] = useState<string | null>(
    pinned ?? (gPreset === "custom" ? gMonthYM : currentPeriod(1))
  );
  const [from, setFrom] = useState<string | null>(
    pinned ? null : gPreset === "custom" ? gFrom : null
  );
  const [to, setTo] = useState<string | null>(
    pinned ? null : gPreset === "custom" ? gTo : null
  );

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
  }, [gPreset, gFrom, gTo, gMonthYM]);

  return useMemo(
    () => ({
      preset,
      monthYM,
      from,
      to,
      setPreset: (p: DatePreset) => setPreset(p),
      setRange: (f: string | null, t: string | null) => {
        setFrom(f);
        setTo(t);
        setPreset("custom");
      },
      setMonth: (ym: string) => {
        setPreset("month");
        setMonthYM(ym);
      },
      setYear: (year: number) => {
        setPreset("year");
        setMonthYM(`${year}-${(monthYM ?? currentPeriod(1)).slice(5, 7)}`);
      },
      stepPeriod: (delta: number, fallbackMaxYM: string) => {
        const anchored = preset === "month" || preset === "year";
        const cur = anchored && monthYM ? monthYM : fallbackMaxYM;
        setPreset(preset === "year" ? "year" : "month");
        setMonthYM(shiftPeriod(cur, delta * (preset === "year" ? 12 : 1)));
      },
    }),
    [preset, monthYM, from, to]
  );
}
