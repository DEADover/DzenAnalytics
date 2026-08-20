import { useMemo, useState } from "react";
import { useDataStore } from "../store/useDataStore";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useDrillStore } from "../store/useDrillStore";
import { topPayees, topTransactions, groupByCategory, NO_PAYEE_LABEL, type CategoryBucket, type PayeeBucket } from "../lib/aggregations";
import { SortableTable, type Column } from "../components/SortableTable";
import type { Transaction } from "../types";
import { formatMoney, formatDate, formatPct } from "../lib/format";
import { affectsExpense } from "../lib/txKindStyle";
import { EmptyState } from "../components/EmptyState";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";
import { TrendingUp } from "lucide-react";

type Tab = "categories" | "payees" | "transactions";

export function TopPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);

  const [tab, setTab] = useState<Tab>("categories");
  const [kind, setKind] = useState<"expense" | "income">("expense");

  const showDrill = useDrillStore((s) => s.show);

  const filtered = useMemo(() => applyFilters(transactions, filters, monthStartDay), [transactions, filters, monthStartDay]);

  const cats = useMemo(() => groupByCategory(filtered, "full"), [filtered]);
  const payees = useMemo(() => topPayees(filtered, kind, 30), [filtered, kind]);
  const txs = useMemo(() => topTransactions(filtered, kind, 50), [filtered, kind]);

  // Expense-side drill-downs include refunds for the same
  // category/payee — they're what made the displayed net total
  // smaller than the raw spend would suggest.
  const matchesKind = (k: Transaction["kind"]) =>
    kind === "expense" ? affectsExpense(k) : k === kind;
  function openCategoryFull(name: string) {
    const list = filtered.filter((t) => matchesKind(t.kind) && t.categoryFull === name);
    showDrill(name, list, kind === "expense" ? "Расходы по категории" : "Доходы по категории");
  }
  function openPayee(name: string) {
    // Mirror topPayees' bucketing so the «Без получателя» row opens its
    // empty-payee operations instead of an empty drawer.
    const list = filtered.filter(
      (t) => matchesKind(t.kind) && (t.payee || NO_PAYEE_LABEL) === name
    );
    showDrill(name, list, kind === "expense" ? "Расходы получателю" : "Поступления от");
  }
  function openSingle(id: string) {
    const tx = filtered.find((t) => t.id === id);
    if (!tx) return;
    showDrill(tx.payee || tx.categoryFull, [tx], "Одиночная операция");
  }

  if (transactions.length === 0) return <EmptyState />;

  const total =
    tab === "categories"
      ? cats.reduce((s, c) => s + (kind === "expense" ? c.expense : c.income), 0)
      : tab === "payees"
        ? payees.reduce((s, p) => s + p.total, 0)
        : txs.reduce((s, t) => s + t.amountBase, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={TrendingUp}
        title="Топ"
        hint="Категории, получатели и крупнейшие операции"
        right={
          <div className="flex bg-panel2 rounded-full p-1 border border-border shadow-tray">
            <button
              onClick={() => setKind("expense")}
              className={`px-3 py-1 text-xs rounded-full ${kind === "expense" ? "bg-expense text-white" : "text-muted"}`}
            >
              Расходы
            </button>
            <button
              onClick={() => setKind("income")}
              className={`px-3 py-1 text-xs rounded-full ${kind === "income" ? "bg-income text-white" : "text-muted"}`}
            >
              Доходы
            </button>
          </div>
        }
      />
      <GlobalFilters />

      <div className="flex gap-2 border-b border-border">
        {(
          [
            ["categories", "Категории"],
            ["payees", "Получатели"],
            ["transactions", "Операции"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
              tab === k ? "border-accent text-accent" : "border-transparent text-muted hover:text-text"
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === "categories" && (
        <div className="card-tray card-pad">
          <div className="font-semibold mb-3">
            Топ категорий по {kind === "expense" ? "расходам" : "доходам"}
          </div>
          <SortableTable<CategoryBucket>
            data={cats.filter((c) => (kind === "expense" ? c.expense : c.income) > 0)}
            rowKey={(c) => c.category}
            defaultSortKey="value"
            defaultSortDir="desc"
            onRowClick={(c) => openCategoryFull(c.category)}
            limit={30}
            exportName={`top_categories_${kind}`}
            columns={
              [
                {
                  key: "name",
                  label: "Категория",
                  sortValue: (c) => c.category,
                  render: (c) => c.category,
                },
                {
                  key: "value",
                  label: "Сумма",
                  align: "right",
                  sortValue: (c) => (kind === "expense" ? c.expense : c.income),
                  render: (c) => {
                    const v = kind === "expense" ? c.expense : c.income;
                    return (
                      <span
                        className={`tabular-nums font-medium ${
                          kind === "expense" ? "text-expense" : "text-income"
                        }`}
                      >
                        {formatMoney(v, base)}
                      </span>
                    );
                  },
                },
                {
                  key: "share",
                  label: "Доля",
                  align: "right",
                  sortValue: (c) => (kind === "expense" ? c.expense : c.income) / (total || 1),
                  render: (c) => {
                    const v = kind === "expense" ? c.expense : c.income;
                    return (
                      <span className="tabular-nums text-muted">{formatPct(v / total, 1)}</span>
                    );
                  },
                },
                {
                  key: "count",
                  label: "Операций",
                  align: "right",
                  sortValue: (c) => c.count,
                  render: (c) => <span className="text-muted">{c.count}</span>,
                },
                {
                  key: "avg",
                  label: "Средняя",
                  align: "right",
                  sortValue: (c) =>
                    c.count > 0 ? (kind === "expense" ? c.expense : c.income) / c.count : 0,
                  render: (c) => {
                    const v = kind === "expense" ? c.expense : c.income;
                    return (
                      <span className="tabular-nums text-muted">
                        {formatMoney(v / c.count, base)}
                      </span>
                    );
                  },
                },
              ] as Column<CategoryBucket>[]
            }
          />
        </div>
      )}

      {tab === "payees" && (
        <div className="card-tray card-pad">
          <div className="font-semibold mb-3">
            Топ получателей по {kind === "expense" ? "расходам" : "доходам"}
          </div>
          <SortableTable<PayeeBucket>
            data={payees}
            rowKey={(p) => p.payee}
            defaultSortKey="total"
            defaultSortDir="desc"
            onRowClick={(p) => openPayee(p.payee)}
            exportName={`top_payees_${kind}`}
            columns={
              [
                {
                  key: "payee",
                  label: "Получатель",
                  sortValue: (p) => p.payee,
                  render: (p) => (
                    <span className="truncate max-w-[300px] inline-block" title={p.payee}>
                      {p.payee}
                    </span>
                  ),
                },
                {
                  key: "total",
                  label: "Сумма",
                  align: "right",
                  sortValue: (p) => p.total,
                  render: (p) => (
                    <span
                      className={`tabular-nums font-medium ${
                        kind === "expense" ? "text-expense" : "text-income"
                      }`}
                    >
                      {formatMoney(p.total, base)}
                    </span>
                  ),
                },
                {
                  key: "share",
                  label: "Доля",
                  align: "right",
                  sortValue: (p) => p.total / (total || 1),
                  render: (p) => (
                    <span className="tabular-nums text-muted">{formatPct(p.total / total, 1)}</span>
                  ),
                },
                {
                  key: "count",
                  label: "Операций",
                  align: "right",
                  sortValue: (p) => p.count,
                  render: (p) => <span className="text-muted">{p.count}</span>,
                },
                {
                  key: "avg",
                  label: "Средняя",
                  align: "right",
                  sortValue: (p) => (p.count > 0 ? p.total / p.count : 0),
                  render: (p) => (
                    <span className="tabular-nums text-muted">
                      {formatMoney(p.total / p.count, base)}
                    </span>
                  ),
                },
              ] as Column<PayeeBucket>[]
            }
          />
        </div>
      )}

      {tab === "transactions" && (
        <div className="card-tray card-pad">
          <div className="font-semibold mb-3">
            Крупнейшие {kind === "expense" ? "расходы" : "поступления"}
          </div>
          <SortableTable<Transaction>
            data={txs}
            rowKey={(t) => t.id}
            defaultSortKey="amount"
            defaultSortDir="desc"
            onRowClick={(t) => openSingle(t.id)}
            exportName={`top_transactions_${kind}`}
            columns={
              [
                {
                  key: "date",
                  label: "Дата",
                  sortValue: (t) => t.date,
                  render: (t) => (
                    <span className="whitespace-nowrap text-muted">
                      {formatDate(t.date, "full")}
                    </span>
                  ),
                },
                {
                  key: "category",
                  label: "Категория",
                  sortValue: (t) => t.categoryFull,
                  render: (t) => (
                    <span className="truncate max-w-[180px] inline-block" title={t.categoryFull}>
                      {t.categoryFull}
                    </span>
                  ),
                },
                {
                  key: "payee",
                  label: "Получатель",
                  sortValue: (t) => t.payee || "",
                  render: (t) => (
                    <span className="truncate max-w-[180px] inline-block" title={t.payee}>
                      {t.payee || "—"}
                    </span>
                  ),
                },
                {
                  key: "comment",
                  label: "Комментарий",
                  sortValue: (t) => t.comment || "",
                  render: (t) => (
                    <span
                      className="truncate max-w-[280px] inline-block text-muted text-xs"
                      title={t.comment}
                    >
                      {t.comment}
                    </span>
                  ),
                },
                {
                  key: "amount",
                  label: "Сумма",
                  align: "right",
                  sortValue: (t) => t.amountBase,
                  render: (t) => (
                    <span
                      className={`tabular-nums font-medium ${
                        kind === "expense" ? "text-expense" : "text-income"
                      }`}
                    >
                      {formatMoney(t.amount, t.currency)}
                    </span>
                  ),
                },
              ] as Column<Transaction>[]
            }
          />
        </div>
      )}
    </div>
  );
}
