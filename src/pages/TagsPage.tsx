import { useMemo, useState } from "react";
import { Hash } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useDrillStore } from "../store/useDrillStore";
import {
  groupByHashtag,
  extractHashtags,
  hashtagCategoryTrees,
  computeKPI,
  type TagBucket,
} from "../lib/aggregations";
import { formatMoney, formatNum, formatPct } from "../lib/format";
import { pluralOps, pluralRu } from "../lib/plural";
import { EmptyState } from "../components/EmptyState";
import { CategoryDot } from "../components/CategoryDot";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";
import { SortableTable, type Column } from "../components/SortableTable";
import { Tooltip } from "../components/Tooltip";

export function TagsPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const showDrill = useDrillStore((s) => s.show);

  const filtered = useMemo(() => applyFilters(transactions, filters, monthStartDay), [transactions, filters, monthStartDay]);
  const tags = useMemo(() => groupByHashtag(filtered), [filtered]);
  // Per-tag expense breakdown by category → subcategory.
  const catTrees = useMemo(() => hashtagCategoryTrees(filtered), [filtered]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (tag: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });

  // Tagged-only expense sum — shown as «всего» in the header.
  const totalExpense = tags.reduce((s, t) => s + t.expense, 0);
  // Whole-period expense / income (across ALL operations, not just tagged) —
  // the honest denominators for «Доля от расходов» / «Доля от дохода» (#20).
  const periodKpi = useMemo(() => computeKPI(filtered), [filtered]);
  const periodExpense = periodKpi.expense;
  const periodIncome = periodKpi.income;
  const taggedCount = useMemo(
    () => filtered.filter((t) => extractHashtags(t.comment).length > 0).length,
    [filtered]
  );

  const maxTotal = tags[0] ? tags[0].expense + tags[0].income : 1;

  // Tag cloud ordering: by total flow (default) or alphabetically (issue #20).
  const [cloudAlpha, setCloudAlpha] = useState(false);
  const cloudTags = useMemo(() => {
    if (!cloudAlpha) return tags; // already total-desc from groupByHashtag
    return [...tags].sort((a, b) => a.tag.localeCompare(b.tag, "ru"));
  }, [tags, cloudAlpha]);

  function openTag(tag: string) {
    const txs = filtered.filter((t) => extractHashtags(t.comment).includes(tag));
    showDrill(`#${tag}`, txs, "Операции с тегом");
  }

  if (transactions.length === 0) return <EmptyState />;

  if (tags.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={Hash}
          title="Теги"
          hint="Метки `#проект` в комментариях позволяют группировать операции по темам — поездки, члены семьи, машины и так далее. В текущей выборке тегов нет."
        />
        <GlobalFilters />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Hash}
        title="Теги"
        hint={
          <>
            {tags.length} {pluralRu(tags.length, ["тег", "тега", "тегов"])} в{" "}
            {taggedCount} {pluralRu(taggedCount, ["операции", "операциях", "операциях"])}
            {totalExpense > 0 && ` · по тегам ${formatMoney(totalExpense, base)}`}.{" "}
            Проценты — доля от всех расходов за период
            {periodExpense > 0 ? ` (${formatMoney(periodExpense, base)}` : ""}
            {periodExpense > 0 && periodIncome > 0
              ? ` · доходов ${formatMoney(periodIncome, base)})`
              : periodExpense > 0
                ? ")"
                : ""}
            . Клик по облаку — операции, по строке таблицы — разбивка по категориям.
          </>
        }
        hintWrap
      />
      <GlobalFilters />

      <div className="card card-pad">
        <div className="flex items-center justify-between mb-4 gap-3">
          <div className="font-semibold">Облако тегов</div>
          <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
            <button
              onClick={() => setCloudAlpha(false)}
              className={`px-2.5 py-1 ${!cloudAlpha ? "bg-accent text-accent-fg" : "text-muted hover:text-text"}`}
            >
              По сумме
            </button>
            <button
              onClick={() => setCloudAlpha(true)}
              className={`px-2.5 py-1 ${cloudAlpha ? "bg-accent text-accent-fg" : "text-muted hover:text-text"}`}
            >
              А–Я
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {cloudTags.map((t) => {
            const score = (t.expense + t.income) / maxTotal;
            const fontSize = 12 + Math.round(score * 16);
            return (
              <Tooltip
                key={t.tag}
                content={`Чистый: ${formatMoney(t.income - t.expense, base, { signed: true })}`}
              >
                <button
                  onClick={() => openTag(t.tag)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-panel2 hover:border-accent hover:bg-accent/10 transition-colors"
                  style={{ fontSize }}
                >
                  <Hash className="w-3 h-3 text-accent shrink-0" />
                  <span className="font-medium">{t.tag}</span>
                  <span className="text-muted text-xs tabular-nums">
                    {formatNum(t.count)} {pluralOps(t.count)}
                  </span>
                </button>
              </Tooltip>
            );
          })}
        </div>
      </div>

      <div className="card card-pad">
        <SortableTable<TagBucket>
          title="Все теги"
          data={tags}
          rowKey={(t) => t.tag}
          defaultSortKey="total"
          defaultSortDir="desc"
          exportName="hashtags"
          columns={
            [
              {
                key: "tag",
                label: "Тег",
                sortValue: (t) => t.tag,
                render: (t) => (
                  <span className="inline-flex items-center gap-1">
                    <Hash className="w-3 h-3 text-accent" />
                    {t.tag}
                  </span>
                ),
              },
              {
                key: "expense",
                label: "Расход",
                align: "right",
                sortValue: (t) => t.expense,
                render: (t) => (
                  <span className="tabular-nums text-expense">
                    {t.expense > 0 ? formatMoney(t.expense, base) : "—"}
                  </span>
                ),
              },
              {
                key: "income",
                label: "Доход",
                align: "right",
                sortValue: (t) => t.income,
                render: (t) => (
                  <span className="tabular-nums text-income">
                    {t.income > 0 ? formatMoney(t.income, base) : "—"}
                  </span>
                ),
              },
              {
                key: "count",
                label: "Операций",
                align: "right",
                sortValue: (t) => t.count,
                render: (t) => <span className="text-muted">{t.count}</span>,
              },
              {
                key: "total",
                label: "Доля от расходов",
                align: "right",
                sortValue: (t) => (periodExpense > 0 ? t.expense / periodExpense : 0),
                render: (t) => (
                  <span className="tabular-nums text-muted">
                    {periodExpense > 0 && t.expense > 0
                      ? formatPct(t.expense / periodExpense, 1)
                      : "—"}
                  </span>
                ),
              },
              {
                key: "incomeShare",
                label: "Доля от дохода",
                align: "right",
                sortValue: (t) => (periodIncome > 0 ? t.income / periodIncome : 0),
                render: (t) => (
                  <span className="tabular-nums text-muted">
                    {periodIncome > 0 && t.income > 0
                      ? formatPct(t.income / periodIncome, 1)
                      : "—"}
                  </span>
                ),
              },
            ] as Column<TagBucket>[]
          }
          isExpanded={(t) => expanded.has(t.tag)}
          onToggleExpand={(t) => toggle(t.tag)}
          renderExpanded={(t) => {
            const nodes = catTrees.get(t.tag);
            if (!nodes || nodes.length === 0) {
              return (
                <tr className="bg-panel2/20">
                  <td className="table-td" />
                  <td className="table-td text-xs text-muted" colSpan={6}>
                    Нет операций по категориям
                  </td>
                </tr>
              );
            }
            return nodes.flatMap((n) => [
              <tr key={`${t.tag}:${n.category}`} className="bg-panel2/20">
                <td className="table-td" />
                <td className="table-td pl-6">
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <CategoryDot category={n.category} size="w-4 h-4" />
                    <span className="truncate">{n.category}</span>
                  </span>
                </td>
                <td className="table-td text-right tabular-nums text-expense">
                  {n.expense > 0 ? formatMoney(n.expense, base) : "—"}
                </td>
                <td className="table-td text-right tabular-nums text-income">
                  {n.income > 0 ? formatMoney(n.income, base) : "—"}
                </td>
                <td className="table-td text-right text-muted">{n.count}</td>
                <td className="table-td text-right tabular-nums text-muted">
                  {periodExpense > 0 && n.expense > 0
                    ? formatPct(n.expense / periodExpense, 1)
                    : "—"}
                </td>
                <td className="table-td text-right tabular-nums text-muted">
                  {periodIncome > 0 && n.income > 0
                    ? formatPct(n.income / periodIncome, 1)
                    : "—"}
                </td>
              </tr>,
              ...n.subs.map((s) => (
                <tr
                  key={`${t.tag}:${n.category}:${s.name}`}
                  className="bg-panel2/10 text-xs text-muted"
                >
                  <td className="table-td" />
                  <td className="table-td pl-10">
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <CategoryDot
                        category={s.name}
                        parent={n.category}
                        size="w-3.5 h-3.5"
                      />
                      <span className="truncate">{s.name}</span>
                    </span>
                  </td>
                  <td className="table-td text-right tabular-nums">
                    {s.expense > 0 ? formatMoney(s.expense, base) : "—"}
                  </td>
                  <td className="table-td text-right tabular-nums">
                    {s.income > 0 ? formatMoney(s.income, base) : "—"}
                  </td>
                  <td className="table-td text-right">{s.count}</td>
                  <td className="table-td text-right tabular-nums">
                    {periodExpense > 0 && s.expense > 0
                      ? formatPct(s.expense / periodExpense, 1)
                      : "—"}
                  </td>
                  <td className="table-td text-right tabular-nums">
                    {periodIncome > 0 && s.income > 0
                      ? formatPct(s.income / periodIncome, 1)
                      : "—"}
                  </td>
                </tr>
              )),
            ]);
          }}
        />
      </div>
    </div>
  );
}
