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
  stepMonth: (delta: number, fallbackMaxYM: string) => void;
}

/**
 * Local, page-scoped period. Same semantics as the store's period setters
 * (setRange → preset "custom", setMonth/stepMonth → preset "month"), just held
 * in component state so it never touches the global «месяц».
 */
export function useLocalPeriod(defaultPreset: DatePreset = "12m"): PeriodController {
  const gPreset = useFiltersStore((s) => s.preset);
  const gFrom = useFiltersStore((s) => s.from);
  const gTo = useFiltersStore((s) => s.to);
  const gMonthYM = useFiltersStore((s) => s.monthYM);

  // Adopt an explicit date RANGE that's already active on mount (a saved filter
  // «от/до» applied on another page), but not the plain default month — the
  // page should still open on its own wide span.
  const [preset, setPreset] = useState<DatePreset>(
    gPreset === "custom" ? "custom" : defaultPreset
  );
  const [monthYM, setMonthYM] = useState<string | null>(
    gPreset === "custom" ? gMonthYM : currentPeriod(1)
  );
  const [from, setFrom] = useState<string | null>(gPreset === "custom" ? gFrom : null);
  const [to, setTo] = useState<string | null>(gPreset === "custom" ? gTo : null);

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
      stepMonth: (delta: number, fallbackMaxYM: string) => {
        const cur = preset === "month" && monthYM ? monthYM : fallbackMaxYM;
        setPreset("month");
        setMonthYM(shiftPeriod(cur, delta));
      },
    }),
    [preset, monthYM, from, to]
  );
}
