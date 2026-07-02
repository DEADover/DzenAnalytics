import { Link } from "react-router-dom";
import {
  HeartPulse,
  TrendingUp,
  ShieldCheck,
  Tag as TagIcon,
  Repeat,
  Lock,
  Info,
  Sparkles,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import type { HealthComponent, HealthScore } from "../lib/health";
import { formatMoney, formatPct } from "../lib/format";
import { Tooltip } from "./Tooltip";

const COMPONENT_ICONS: Record<string, typeof HeartPulse> = {
  savings_rate: TrendingUp,
  emergency_fund: ShieldCheck,
  uncategorized: TagIcon,
  stability: Repeat,
  fixed_load: Lock,
};

function formatValue(c: HealthComponent): string {
  if (c.value === null) return "—";
  switch (c.id) {
    case "savings_rate":
    case "uncategorized":
    case "fixed_load":
      return formatPct(c.value, 1);
    case "emergency_fund":
      return `${c.value.toFixed(1)} мес`;
    case "stability":
      // Show the spread as a plain word, not the raw «CV» coefficient.
      return c.value <= 0.5 ? "Ровно" : c.value <= 1 ? "С колебаниями" : "Скачет";
    default:
      return c.value.toFixed(2);
  }
}

function statusText(status: HealthComponent["status"]): string {
  switch (status) {
    case "good":
      return "text-income";
    case "fair":
      return "text-warn";
    case "poor":
      return "text-expense";
    default:
      return "text-muted";
  }
}

function statusBar(status: HealthComponent["status"]): string {
  switch (status) {
    case "good":
      return "bg-income";
    case "fair":
      return "bg-warn";
    case "poor":
      return "bg-expense";
    default:
      return "bg-muted";
  }
}

/** Overall-score → SVG stroke for the ring. The app's colour vars are raw RGB
 *  triples (e.g. `16 185 129`), so they MUST be wrapped in `rgb(...)` — passing
 *  a bare `var(--c-income)` as `stroke` is an invalid colour and the arc renders
 *  invisible (the bug where the ring never filled). Aligns with the
 *  good / fair / poor thresholds used per-component (75 / 50). */
function overallVar(overall: number): string {
  if (overall >= 75) return "rgb(var(--c-income))";
  if (overall >= 50) return "rgb(var(--c-warn))";
  return "rgb(var(--c-expense))";
}

function overallText(overall: number): string {
  if (overall >= 75) return "text-income";
  if (overall >= 50) return "text-warn";
  return "text-expense";
}

/** Tinted pill (bg + text) for the grade badge — makes the letter grade pop
 *  instead of sitting as plain small text next to the verdict. */
function overallPill(overall: number): string {
  if (overall >= 75) return "bg-income/10 text-income";
  if (overall >= 50) return "bg-warn/10 text-warn";
  return "bg-expense/10 text-expense";
}

function gradeWord(overall: number): string {
  if (overall >= 80) return "Отличное";
  if (overall >= 70) return "Хорошее";
  if (overall >= 60) return "Среднее";
  if (overall >= 50) return "Слабое";
  return "Тревожное";
}

function verdictSentence(components: HealthComponent[]): string {
  const poor = components.filter((c) => c.status === "poor");
  const fair = components.filter((c) => c.status === "fair");
  const names = (cs: HealthComponent[]) =>
    cs.map((c) => c.label.toLowerCase()).join(", ");
  if (poor.length > 0) return `Слабые места: ${names(poor)}.`;
  if (fair.length > 0) return `Есть куда расти: ${names(fair)}.`;
  return "Всё под контролем — держите ритм и подумайте об инвестициях.";
}

/** Per-row explanation shown in the app tooltip: what's measured + weight. */
function rowTooltip(c: HealthComponent): string {
  return `${c.detail}\n\nВес в общей оценке: ${c.weight}%.`;
}

const RING = 2 * Math.PI * 60; // circumference for r=60

/** «Higher value is BETTER» metrics — their bar fills straight to the value, so
 *  more = fuller = further right (good). The number shown matches the bar. */
const HIGHER_IS_BETTER = new Set(["savings_rate", "uncategorized"]);

/** Bar fill (0–100), always «good → right, bad → left».
 *   • higher-is-better metrics (norma, categorization) → the value itself;
 *   • everything else — «риск»-metrics where higher is WORSE (obligatory load,
 *     instability) and «Подушка» — fill by the health SCORE, so a worse metric
 *     is a shorter bar (further left), a better one fills to the right.
 *  Floor 4% so a measured metric never reads as an empty «no data» track. */
function barFill(c: HealthComponent): number {
  if (c.status === "na") return 0;
  const raw = HIGHER_IS_BETTER.has(c.id) ? (c.value ?? 0) * 100 : c.score;
  return Math.min(Math.max(raw, 4), 100);
}

function ScoreRow({ c, base }: { c: HealthComponent; base: string }) {
  const Icon = COMPONENT_ICONS[c.id] || HeartPulse;
  const advice = c.extra?.hint ?? c.hint;
  const showAdvice = !!c.hint && c.status !== "good"; // steer only when off-target
  const barPct = barFill(c);
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${statusText(c.status)}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium">{c.label}</span>
            <Tooltip content={rowTooltip(c)} placement="top">
              <span className="shrink-0 cursor-help text-muted hover:text-text">
                <Info className="w-3.5 h-3.5" />
              </span>
            </Tooltip>
            <span
              className={`ml-auto text-sm font-bold tabular-nums shrink-0 ${statusText(c.status)}`}
            >
              {formatValue(c)}
            </span>
          </div>

          <div className="h-1.5 rounded-full overflow-hidden bg-panel2 mt-2">
            <div
              className={`h-full ${statusBar(c.status)}`}
              style={{ width: `${barPct}%` }}
            />
          </div>

          {c.extra && (
            <div className="text-[11px] text-muted mt-1.5 tabular-nums">
              По обязательным — {c.extra.obligatoryMonths.toFixed(1)} мес · в
              среднем {formatMoney(c.extra.avgMonthly, base)} / мес
            </div>
          )}

          {showAdvice && advice && (
            <div className="text-[11px] text-muted mt-1.5 flex items-start gap-1.5">
              <Sparkles className="w-3 h-3 text-accent2 shrink-0 mt-0.5" />
              <span className="leading-snug">{advice}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The financial-health block: a progress ring + one-line verdict, and a
 * scorecard list of the 5 components — each with the metric, a status bar, the
 * obligatory-runway detail (#32) and inline advice when off-target. Every row
 * has an app tooltip (weight + definition). Used on the /health page; `to`
 * renders a «Подробнее» link when embedded as a compact widget elsewhere.
 */
export function HealthSummary({
  score,
  to,
  hideHeading = false,
}: {
  score: HealthScore;
  to?: string;
  /** Hide the card's own «Финансовое здоровье» title — used on the /health
   *  page where the page already has that heading. */
  hideHeading?: boolean;
}) {
  const { overall, grade, components, baseCurrency } = score;

  return (
    <div className="card card-pad">
      {!hideHeading && (
        <div className="flex items-center justify-between mb-4">
          <div className="font-semibold flex items-center gap-2">
            <HeartPulse className="w-4 h-4 text-accent" />
            Финансовое здоровье
          </div>
          {to && (
            <Link
              to={to}
              className="text-xs text-accent hover:underline flex items-center gap-1"
            >
              Подробнее <ArrowRight className="w-3 h-3" />
            </Link>
          )}
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-stretch gap-6">
        {/* Ring → grade → verdict, stacked and centered */}
        <div className="flex flex-col items-center text-center gap-3 md:w-52 md:shrink-0 md:justify-center">
          <div className="relative w-40 h-40 shrink-0">
            <svg width="160" height="160" viewBox="0 0 160 160">
              <circle
                cx="80"
                cy="80"
                r="60"
                fill="none"
                stroke="rgb(var(--c-panel2))"
                strokeWidth="12"
              />
              <circle
                cx="80"
                cy="80"
                r="60"
                fill="none"
                stroke={overallVar(overall)}
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={RING}
                strokeDashoffset={RING * (1 - overall / 100)}
                transform="rotate(-90 80 80)"
                style={{ transition: "stroke-dashoffset 0.6s ease" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className={`text-5xl font-bold tabular-nums leading-none ${overallText(overall)}`}>
                {overall}
              </div>
              <div className="text-[11px] text-muted mt-1.5">из 100</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`text-lg font-bold leading-none px-2.5 py-1 rounded-md ${overallPill(overall)}`}
            >
              {grade}
            </span>
            <span className={`text-base font-semibold ${overallText(overall)}`}>
              {gradeWord(overall)}
            </span>
          </div>

          <div className="text-sm text-muted leading-snug">
            {verdictSentence(components)}
          </div>
        </div>

        {/* Scorecard */}
        <div className="flex-1 min-w-0 md:border-l md:border-border md:pl-6 divide-y divide-border/60">
          {components.map((c) => (
            <ScoreRow key={c.id} c={c} base={baseCurrency} />
          ))}
        </div>
      </div>

      {/* Footer: what to act on first / all-clear — merged into the same card */}
      {(() => {
        const poor = components.filter((c) => c.status === "poor");
        if (poor.length > 0) {
          return (
            <div className="mt-5 pt-5 border-t border-border">
              <div className="flex items-center gap-2 font-semibold mb-2 text-expense">
                <AlertCircle className="w-4 h-4" />
                На что обратить внимание в первую очередь
              </div>
              <ul className="space-y-1 text-sm">
                {poor.map((c) => (
                  <li key={c.id} className="flex items-start gap-2">
                    <span className="text-expense">•</span>
                    <span>
                      <strong>{c.label}</strong>
                      {c.hint ? ` — ${c.hint}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        }
        if (overall >= 75) {
          return (
            <div className="mt-5 pt-5 border-t border-border">
              <div className="flex items-center gap-2 text-income font-semibold">
                <CheckCircle2 className="w-4 h-4" />
                Всё под контролем. Держите этот ритм и думайте про инвестиции.
              </div>
            </div>
          );
        }
        return null;
      })()}
    </div>
  );
}
