import clsx from "clsx";
import { WEEKDAYS_SHORT_BY_JS_DAY } from "../lib/weekdays";
import { formatMoney } from "../lib/format";

/** Две полосы друг под другом: длина — доля от большей, большая — акцентом. */
export function Pair({ a, b, base }: { a: { label: string; value: number }; b: { label: string; value: number }; base: string }) {
  const max = Math.max(a.value, b.value, 1);
  return (
    <div className="space-y-1 my-0.5">
      {[a, b].map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-[11px]">
          <span className="w-16 shrink-0 text-muted">{r.label}</span>
          <span className="flex-1 h-1.5 rounded-full bg-border/60 overflow-hidden">
            <span
              className={clsx("block h-full rounded-full", r.value >= max ? "bg-accent" : "bg-muted/50")}
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </span>
          <span className="w-20 shrink-0 text-right tabular-nums text-muted">{formatMoney(r.value, base, { compact: true })}</span>
        </div>
      ))}
    </div>
  );
}

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEK_SHORT = WEEKDAYS_SHORT_BY_JS_DAY;

export function WeekBars({ byWeekday, best }: { byWeekday: number[]; best: number }) {
  const max = Math.max(...byWeekday, 1);
  return (
    <div className="flex items-end gap-1 h-10 my-0.5" aria-hidden>
      {WEEK_ORDER.map((w) => (
        <div key={w} className="flex-1 flex flex-col items-center gap-0.5 h-full justify-end">
          <span
            className={clsx("w-full rounded-sm", w === best ? "bg-accent" : "bg-muted/40")}
            style={{ height: `${Math.max(6, (byWeekday[w] / max) * 100)}%` }}
          />
          <span className={clsx("text-[10px] leading-none", w === best ? "text-accent font-medium" : "text-muted")}>
            {WEEK_SHORT[w]}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ShareBar({ share }: { share: number }) {
  return (
    <span className="block h-1.5 rounded-full bg-border/60 overflow-hidden my-1" aria-hidden>
      <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.min(100, share * 100)}%` }} />
    </span>
  );
}

