import { useMemo, useState } from "react";
import { useDataStore } from "../store/useDataStore";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useDrillStore } from "../store/useDrillStore";
import { topPayees, topTransactions, groupByCategory, NO_PAYEE_LABEL, type CategoryBucket, type PayeeBucket } from "../lib/aggregations";
import { DataTable } from "../components/DataTable";
import type { Transaction } from "../types";
import { formatMoney, formatDate, formatPct } from "../lib/format";
import { affectsExpense } from "../lib/txKindStyle";
import { EmptyState } from "../components/EmptyState";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";
import { InfoPopover, InfoTerm } from "../components/InfoPopover";
import { Segmented } from "../components/Segmented";
import { KindSwitcher } from "../components/KindSwitcher";
import { StatCell, StatRow } from "../components/SectionCard";
import { counterpartyOf } from "../lib/yearReview";
import { formatNum } from "../lib/format";
import { TrendingUp, TrendingDown, Tags, Users, Receipt, Coins } from "lucide-react";
import { SectionControls } from "../components/SectionControls";

type Tab = "categories" | "payees" | "transactions";

/** Что за строки в топе — подпись под их числом. */
const TAB_NOTE: Record<Tab, string> = {
  categories: "категорий с суммой",
  payees: "контрагентов",
  transactions: "крупнейших операций",
};

/**
 * Ширины колонок — одни на «Категории» и «Контрагенты» и на обе стороны.
 *
 * Без них таблица подбирала ширину под содержимое: переключишь «Расходы» на
 * «Доходы» или категории на контрагентов — и «Сумма», «Доля», «Операций»
 * переезжают вбок, потому что сменились самые длинные имя и число. Имя берёт
 * всё, что осталось, и обрезается многоточием.
 */
const COL = { value: "11rem", share: "7rem", count: "8rem", avg: "10rem" } as const;

/** Ширины таблицы крупнейших операций — тоже постоянные для обеих сторон. */
const TX_COL = { date: "9rem", category: "15rem", payee: "15rem", amount: "11rem" } as const;

export function TopPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);

  const [tab, setTab] = useState<Tab>("categories");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  // Главная сумма каждой таблицы топа — цветом стороны.
  const sideTone = kind === "expense" ? "expense" : "income";

  const showDrill = useDrillStore((s) => s.show);

  const filtered = useMemo(() => applyFilters(transactions, filters, monthStartDay), [transactions, filters, monthStartDay]);

  const cats = useMemo(() => groupByCategory(filtered, "full"), [filtered]);
  // По контрагентам справочника, а не по строкам банка: иначе одна «Ёлочка»
  // делится на «DOSTAVKA YOLOCHKA» и «DOSTAVKA IZ YOLOCHKI», обе строки
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
    <div className="space-y-6">
      <PageHeader
        icon={TrendingUp}
        title="Топ"
        info={
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
              справочника, а не из банковской строки: «DOSTAVKA YOLOCHKA» и
              «DOSTAVKA IZ YOLOCHKI» — это одна «Ёлочка».
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
      <SectionControls>
        <KindSwitcher kind={kind} onChange={setKind} size="md" />
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
      </SectionControls>

      {/* Итоги фильтра: страница показывала таблицу и ни одного числа сверху —
          сколько всего в этом топе, было видно только сложением глазами. */}
      <StatRow>
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
        />
        <StatCell
          label="Операций"
          value={formatNum(opCount)}
          icon={<Receipt className="w-4 h-4" />}
          note="в этих записях"
        />
        <StatCell
          label="В среднем"
          value={opCount > 0 ? formatMoney(total / opCount, base) : "—"}
          icon={<Coins className="w-4 h-4" />}
          note="на одну операцию"
        />
      </StatRow>

      {tab === "categories" && (
        <DataTable<CategoryBucket>
          icon={Tags}
          title={kind === "expense" ? "Расходные категории" : "Доходные категории"}
          info={
            <p>
              Полные названия категорий вместе с подкатегориями: «Еда /
              Продукты» и «Еда / Кафе» стоят отдельными строками. Доля
              считается от всего{kind === "expense" ? " расхода" : " дохода"}{" "}
              фильтра, «Средняя» — от суммы строки на её число операций.
            </p>
          }
          data={shownCats}
          rowKey={(c) => c.category}
          defaultSortKey="value"
          onRowClick={(c) => openCategoryFull(c.category)}
          limit={30}
          fixed
          exportName={`top_categories_${kind}`}
          columns={[
            {
              key: "name",
              type: "text",
              label: "Категория",
              sortValue: (c) => c.category,
              render: (c) => c.category,
            },
            {
              key: "value",
              type: "main",
              tone: sideTone,
              width: COL.value,
              label: "Сумма",
              sortValue: (c) => (kind === "expense" ? c.expense : c.income),
              render: (c) => formatMoney(kind === "expense" ? c.expense : c.income, base),
            },
            {
              key: "share",
              type: "pct",
              width: COL.share,
              label: "Доля",
              sortValue: (c) => (kind === "expense" ? c.expense : c.income) / (total || 1),
              render: (c) => formatPct((kind === "expense" ? c.expense : c.income) / total, 1),
            },
            {
              key: "count",
              type: "count",
              width: COL.count,
              label: "Операций",
              sortValue: (c) => c.count,
              render: (c) => formatNum(c.count),
            },
            {
              key: "avg",
              type: "money",
              muted: true,
              width: COL.avg,
              label: "Средняя",
              sortValue: (c) =>
                c.count > 0 ? (kind === "expense" ? c.expense : c.income) / c.count : 0,
              render: (c) =>
                formatMoney((kind === "expense" ? c.expense : c.income) / c.count, base),
            },
          ]}
        />
      )}

      {tab === "payees" && (
        <DataTable<PayeeBucket>
          icon={Users}
          title={`Контрагенты по ${kind === "expense" ? "расходам" : "доходам"}`}
          info={
            <p>
              Имя берётся из справочника контрагентов, а не из банковской
              строки. Операции без привязанного контрагента собраны в одну
              строку «{NO_PAYEE_LABEL}» — разобрать их можно в «Настройки →
              Справочники → Контрагенты».
            </p>
          }
          data={payees}
          rowKey={(p) => p.payee}
          defaultSortKey="total"
          onRowClick={(p) => openPayee(p.payee)}
          exportName={`top_payees_${kind}`}
          fixed
          columns={[
            {
              key: "payee",
              type: "text",
              label: "Контрагент",
              sortValue: (p) => p.payee,
              render: (p) => p.payee,
            },
            {
              key: "total",
              type: "main",
              tone: sideTone,
              width: COL.value,
              label: "Сумма",
              sortValue: (p) => p.total,
              render: (p) => formatMoney(p.total, base),
            },
            {
              key: "share",
              type: "pct",
              width: COL.share,
              label: "Доля",
              sortValue: (p) => p.total / (total || 1),
              render: (p) => formatPct(p.total / total, 1),
            },
            {
              key: "count",
              type: "count",
              width: COL.count,
              label: "Операций",
              sortValue: (p) => p.count,
              render: (p) => formatNum(p.count),
            },
            {
              key: "avg",
              type: "money",
              muted: true,
              width: COL.avg,
              label: "Средняя",
              sortValue: (p) => (p.count > 0 ? p.total / p.count : 0),
              render: (p) => formatMoney(p.total / p.count, base),
            },
          ]}
        />
      )}

      {tab === "transactions" && (
        <DataTable<Transaction>
          icon={Receipt}
          title={`Крупнейшие ${kind === "expense" ? "расходы" : "поступления"}`}
          info={
            <p>
              Пятьдесят самых крупных операций фильтра, по одной строке на
              операцию. Сумма показана в валюте операции, а сортируется
              список по сумме в базовой валюте — иначе покупка в лирах
              встала бы выше квартиры.
            </p>
          }
          data={txs}
          rowKey={(t) => t.id}
          defaultSortKey="amount"
          onRowClick={(t) => openSingle(t.id)}
          exportName={`top_transactions_${kind}`}
          fixed
          columns={[
            {
              key: "date",
              type: "date",
              width: TX_COL.date,
              label: "Дата",
              sortValue: (t) => t.date,
              render: (t) => formatDate(t.date, "full"),
            },
            {
              key: "category",
              type: "text",
              width: TX_COL.category,
              label: "Категория",
              sortValue: (t) => t.categoryFull,
              render: (t) => t.categoryFull,
            },
            {
              key: "payee",
              type: "text",
              width: TX_COL.payee,
              label: "Контрагент",
              sortValue: (t) => counterpartyOf(t),
              render: (t) => counterpartyOf(t) || "—",
            },
            {
              key: "comment",
              type: "text",
              muted: true,
              label: "Комментарий",
              sortValue: (t) => t.comment || "",
              render: (t) => t.comment,
            },
            {
              key: "amount",
              type: "main",
              tone: sideTone,
              width: TX_COL.amount,
              label: "Сумма",
              sortValue: (t) => t.amountBase,
              render: (t) => formatMoney(t.amount, t.currency),
            },
          ]}
        />
      )}
    </div>
  );
}
