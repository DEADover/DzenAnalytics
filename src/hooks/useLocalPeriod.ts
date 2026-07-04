import { useMemo, useState } from "react";
import type { DatePreset } from "../store/useFiltersStore";
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
  const [preset, setPreset] = useState<DatePreset>(defaultPreset);
  const [monthYM, setMonthYM] = useState<string | null>(currentPeriod(1));
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);

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
