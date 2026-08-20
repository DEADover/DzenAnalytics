import { useEffect, useMemo } from "react";
import { ResponsiveContainer, Sankey, Tooltip } from "recharts";
import { GitFork } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { colorForCategory } from "../lib/categoryColor";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { buildSankey } from "../lib/aggregations";
import { formatMoney, chartTooltipProps } from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";
import { SeriesTooltip } from "../components/TooltipFacts";

const COLORS = {
  income: "#10B981",
  account: "#22D3EE",
  category: "#EF4444",
  savings: "#A78BFA",
  funding: "#F59E0B",
};

export function SankeyPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const categoryMeta = useCategoryMetaStore((s) => s.meta);
  const metaLoaded = useCategoryMetaStore((s) => s.loaded);
  const hydrateMeta = useCategoryMetaStore((s) => s.hydrate);
  useEffect(() => {
    if (!metaLoaded) hydrateMeta();
  }, [metaLoaded, hydrateMeta]);
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);

  const filtered = useMemo(() => applyFilters(transactions, filters, monthStartDay), [transactions, filters, monthStartDay]);
  const data = useMemo(() => buildSankey(filtered), [filtered]);

  if (transactions.length === 0) return <EmptyState />;

  if (data.links.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={GitFork}
          title="Потоки денег"
          hint="Слева — источники доходов (и привлечённые со счетов средства, если трат больше дохода); справа — категории расходов и сбережения"
        />
        <GlobalFilters />
        <div className="card-tray card-pad text-center py-12 text-muted">
          Нет данных для построения потоков в текущем фильтре.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={GitFork}
        title="Потоки денег"
        hint="Слева — источники доходов (и привлечённые со счетов средства, если трат больше дохода); справа — категории расходов и сбережения"
      />
      <GlobalFilters />

      <div className="card-tray card-pad">
        <div className="h-[600px]">
          <ResponsiveContainer>
            <Sankey
              data={data}
              nodePadding={20}
              nodeWidth={14}
              linkCurvature={0.5}
              iterations={64}
              link={{ stroke: "rgb(var(--c-muted))", strokeOpacity: 0.15 }}
              node={({ x, y, width, height, index, payload }: {
                x?: number; y?: number; width?: number; height?: number; index?: number;
                payload?: {
                  name?: string;
                  kind?: "income" | "account" | "category" | "savings" | "funding";
                  value?: number;
                };
              }) => {
                const xv = x ?? 0;
                const yv = y ?? 0;
                const w = width ?? 0;
                const h = height ?? 0;
                const kind = payload?.kind || "account";
                // Expense-category nodes get their own per-category colour
                // (API / deterministic), matching every other page. Income
                // sources and the budget node keep their flow colours.
                const fill =
                  kind === "category" && payload?.name
                    ? colorForCategory(payload.name, categoryMeta)
                    : COLORS[kind];
                const isLeft = xv < 200;
                return (
                  <g key={`node-${index}`}>
                    <rect x={xv} y={yv} width={w} height={h} fill={fill} fillOpacity={0.8} />
                    <text
                      x={isLeft ? xv - 6 : xv + w + 6}
                      y={yv + h / 2}
                      textAnchor={isLeft ? "end" : "start"}
                      dominantBaseline="middle"
                      fontSize={11}
                      fill="rgb(var(--c-text))"
                    >
                      {payload?.name}
                    </text>
                  </g>
                );
              }}
            >
              <Tooltip
                {...chartTooltipProps}
                content={<SeriesTooltip formatValue={(v) => formatMoney(v, base)} />}
              />
            </Sankey>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center gap-4 mt-3 text-xs text-muted justify-center">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ background: COLORS.income }} />
            Источники доходов
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ background: COLORS.account }} />
            Бюджет
          </span>
          <span className="flex items-center gap-1">
            {/* Category nodes are each coloured individually (Zenmoney tag /
                deterministic), so the legend chip is multi-colour, not a single
                red. */}
            <span
              className="w-3 h-3 rounded"
              style={{
                background:
                  "conic-gradient(#22D3EE 0 90deg, #A78BFA 90deg 180deg, #F59E0B 180deg 270deg, #10B981 270deg 360deg)",
              }}
            />
            Категории расходов
          </span>
          {data.nodes.some((n) => n.kind === "savings") && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded" style={{ background: COLORS.savings }} />
              Сбережения (доход больше трат)
            </span>
          )}
          {data.nodes.some((n) => n.kind === "funding") && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded" style={{ background: COLORS.funding }} />
              Привлечено со счетов (траты больше дохода)
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
