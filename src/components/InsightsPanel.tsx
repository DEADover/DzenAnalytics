import { Lightbulb, TrendingUp, AlertTriangle, Info } from "lucide-react";
import type { Insight } from "../lib/aggregations";
import { formatMoney } from "../lib/format";

const ICONS = {
  highlight: Lightbulb,
  trend: TrendingUp,
  warning: AlertTriangle,
  fact: Info,
};

const TONES = {
  highlight: "border-accent/40 bg-accent/5 text-accent",
  trend: "border-income/40 bg-income/5 text-income",
  warning: "border-warn/40 bg-warn/5 text-warn",
  fact: "border-border bg-panel2 text-text",
};

export function InsightsPanel({ insights, base }: { insights: Insight[]; base: string }) {
  if (insights.length === 0) return null;

  return (
    <div className="card-tray card-pad">
      <div className="font-semibold mb-3 flex items-center gap-2">
        <Lightbulb className="w-4 h-4 text-warn" />
        Авто-наблюдения
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {insights.map((ins, i) => {
          const Icon = ICONS[ins.kind];
          const tone = TONES[ins.kind];
          return (
            <div key={i} className={`p-3 rounded-lg border ${tone}`}>
              <div className="flex items-start gap-2 mb-1">
                <Icon className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="text-xs uppercase tracking-wider font-medium opacity-80">
                  {ins.title}
                </div>
              </div>
              <div className="text-sm text-text">{ins.body}</div>
              {ins.value !== undefined && ins.kind === "highlight" && (
                <div className="text-lg font-semibold tabular-nums mt-1">
                  {formatMoney(ins.value, base)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
