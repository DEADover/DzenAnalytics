import { useMemo, useState, type ReactNode } from "react";
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
import { InfoPopover, InfoTerm } from "../components/InfoPopover";
import { Segmented } from "../components/Segmented";
import { KindSwitcher } from "../components/KindSwitcher";
import { StatCell } from "../components/SectionCard";
import { counterpartyOf } from "../lib/yearReview";
import { formatNum } from "../lib/format";
import { TrendingUp, TrendingDown, Tags, Users, Receipt, Coins } from "lucide-react";

type Tab = "categories" | "payees" | "transactions";

/** Что за строки в топе — подпись под их числом. */
const TAB_NOTE: Record<Tab, string> = {
  categories: "категорий с суммой",
  payees: "контрагентов",
  transactions: "крупнейших операций",
};

/**
 * Шапка таблицы топа: значок, название и знак вопроса.
 *
 * Отдаётся в `title` самой таблицы, а не рисуется над ней отдельной карточкой:
 * так заголовок и кнопка CSV стоят в одной строке. Отдельной шапкой кнопка
 * уезжала на строку ниже, и над таблицей висели два ряда вместо одного.
 */
function TableHeading({ icon, title, info }: { icon: ReactNode; title: string; info: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      {icon}
      <span className="truncate">{title}</span>
      <InfoPopover>{info}</InfoPopover>
    </span>
  );
}

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
  // По контрагентам справочника, а не по строкам банка: иначе одна «Пятёрочка»
  // делится на «DOSTAVKA PYATEROCHKA» и «DOSTAVKA IZ PYATEROCHK», обе строки
  // получают половину суммы и обе проваливаются вниз списка.
  const payees = useMemo(() => topPayees(filtered, kind, 30, true), [filtered, kind]);
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
    // Mirror topPayees' bucketing so the «Без контрагента» row opens its
    // unattached operations instead of an empty drawer.
    const list = filtered.filter(
      (t) => matchesKind(t.kind) && (counterpartyOf(t) || NO_PAYEE_LABEL) === name
    );
    showDrill(name, list, kind === "expense" ? "Расходы контрагенту" : "Поступления от");
  }
  function openSingle(id: string) {
    const tx = filtered.find((t) => t.id === id);
    if (!tx) return;
    showDrill(counterpartyOf(tx) || tx.categoryFull, [tx], "Одиночная операция");
  }

  if (transactions.length === 0) return <EmptyState />;

  const shownCats = cats.filter((c) => (kind === "expense" ? c.expense : c.income) > 0);
  const total =
    tab === "categories"
      ? shownCats.reduce((s, c) => s + (kind === "expense" ? c.expense : c.income), 0)
      : tab === "payees"
        ? payees.reduce((s, p) => s + p.total, 0)
        : txs.reduce((s, t) => s + t.amountBase, 0);
  const rowCount =
    tab === "categories" ? shownCats.length : tab === "payees" ? payees.length : txs.length;
  const opCount =
    tab === "categories"
      ? shownCats.reduce((s, c) => s + c.count, 0)
      : tab === "payees"
        ? payees.reduce((s, p) => s + p.count, 0)
        : txs.length;
  /** Весь расход (или доход) фильтра — от него считается доля топа. */
  const periodTotal = cats.reduce(
    (s, c) => s + (kind === "expense" ? c.expense : c.income),
    0
  );

  return (
    <div className="space-y-3">
      <PageHeader
        icon={TrendingUp}
        title="Топ"
        hint="Категории, контрагенты и крупнейшие операции"
        right={
          <InfoPopover>
            <p>
              На что больше всего уходит денег и откуда они приходят — за период,
              счета и категории из <InfoTerm>общего фильтра</InfoTerm> сверху.
            </p>
            <p>
              Переключатель слева выбирает сторону —{" "}
              <InfoTerm>расходы или доходы</InfoTerm>, справа — разрез:{" "}
              <InfoTerm>категории</InfoTerm> вместе с подкатегориями, тридцать
              самых крупных <InfoTerm>контрагентов</InfoTerm> или пятьдесят{" "}
              <InfoTerm>крупнейших операций</InfoTerm>.
            </p>
            <p>
              Плитки над таблицей считают то, что в неё попало: сумму и её долю от
              всего расхода или дохода за фильтр, число записей и операций в них
              и среднюю операцию. Нажатие на строку открывает её операции, кнопка
              «CSV» выгружает таблицу в текущей сортировке.
            </p>
            <p>
              На стороне расходов <InfoTerm>возвраты вычитаются</InfoTerm> из
              своей категории и своего контрагента: «заказал и вернул» — это ноль,
              а не расход и доход по отдельности. Контрагент берётся из
              справочника, а не из банковской строки: «DOSTAVKA PYATEROCHKA» и
              «DOSTAVKA IZ PYATEROCHK» — это одна «Пятёрочка».
            </p>
          </InfoPopover>
        }
      />
      <GlobalFilters />

      {/* Вкладки — общим контролом: своя полоска с подчёркиванием была третьим
          видом вкладок в продукте, при том что рядом на странице уже стоит
          сегментированный переключатель. */}
      {/* Сторона слева, разрез справа. Расходы и доходы — тем же
          переключателем, что в разделе «Категории»: один и тот же выбор в двух
          разделах должен выглядеть одинаково. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <KindSwitcher kind={kind} onChange={setKind} />
        <Segmented
          value={tab}
          onChange={setTab}
          label="Что показывать в топе"
          options={[
            { value: "categories" as Tab, label: "Категории", icon: Tags },
            { value: "payees" as Tab, label: "Контрагенты", icon: Users },
            { value: "transactions" as Tab, label: "Операции", icon: Receipt },
          ]}
        />
      </div>

      {/* Итоги фильтра: страница показывала таблицу и ни одного числа сверху —
          сколько всего в этом топе, было видно только сложением глазами. */}
      <div className="tray">
        <div className="tray-core px-5 py-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-4 divide-border lg:divide-x">
            <StatCell
              label={kind === "expense" ? "Расход в топе" : "Доход в топе"}
              value={formatMoney(total, base)}
              icon={
                kind === "expense" ? (
                  <TrendingDown className="w-4 h-4" />
                ) : (
                  <TrendingUp className="w-4 h-4" />
                )
              }
              tone={kind === "expense" ? "expense" : "income"}
              note={
                periodTotal > 0
                  ? `${formatPct(total / periodTotal, 0)} от всего за период`
                  : undefined
              }
            />
            <StatCell
              label="Записей"
              value={formatNum(rowCount)}
              icon={<Tags className="w-4 h-4" />}
              note={TAB_NOTE[tab]}
              pad
            />
            <StatCell
              label="Операций"
              value={formatNum(opCount)}
              icon={<Receipt className="w-4 h-4" />}
              note="в этих записях"
              pad
            />
            <StatCell
              label="В среднем"
              value={opCount > 0 ? formatMoney(total / opCount, base) : "—"}
              icon={<Coins className="w-4 h-4" />}
              note="на одну операцию"
              pad
            />
          </div>
        </div>
      </div>

      {tab === "categories" && (
        <div className="card-tray px-4 py-3">
          <SortableTable<CategoryBucket>
            title={
              <TableHeading
                icon={<Tags className="w-4 h-4 text-accent" />}
                title={kind === "expense" ? "Расходные категории" : "Доходные категории"}
                info={
                  <p>
                    Полные названия категорий вместе с подкатегориями: «Еда /
                    Продукты» и «Еда / Кафе» стоят отдельными строками. Доля
                    считается от всего{kind === "expense" ? " расхода" : " дохода"}{" "}
                    фильтра, «Средняя» — от суммы строки на её число операций.
                  </p>
                }
              />
            }
            data={shownCats}
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
                  align: "center",
                  sortValue: (c) => c.count,
                  render: (c) => <span className="tabular-nums text-muted">{c.count}</span>,
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
        <div className="card-tray px-4 py-3">
          <SortableTable<PayeeBucket>
            title={
              <TableHeading
                icon={<Users className="w-4 h-4 text-accent2" />}
                title={`Контрагенты по ${kind === "expense" ? "расходам" : "доходам"}`}
                info={
                  <p>
                    Имя берётся из справочника контрагентов, а не из банковской
                    строки. Операции без привязанного контрагента собраны в одну
                    строку «{NO_PAYEE_LABEL}» — разобрать их можно в «Настройки →
                    Справочники → Контрагенты».
                  </p>
                }
              />
            }
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
                  label: "Контрагент",
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
                  align: "center",
                  sortValue: (p) => p.count,
                  render: (p) => <span className="tabular-nums text-muted">{p.count}</span>,
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
        <div className="card-tray px-4 py-3">
          <SortableTable<Transaction>
            title={
              <TableHeading
                icon={<Receipt className="w-4 h-4 text-expense" />}
                title={`Крупнейшие ${kind === "expense" ? "расходы" : "поступления"}`}
                info={
                  <p>
                    Пятьдесят самых крупных операций фильтра, по одной строке на
                    операцию. Сумма показана в валюте операции, а сортируется
                    список по сумме в базовой валюте — иначе покупка в лирах
                    встала бы выше квартиры.
                  </p>
                }
              />
            }
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
                  label: "Контрагент",
                  sortValue: (t) => counterpartyOf(t),
                  render: (t) => (
                    <span
                      className="truncate max-w-[180px] inline-block"
                      title={counterpartyOf(t)}
                    >
                      {counterpartyOf(t) || "—"}
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
