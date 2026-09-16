import { useCallback, useMemo, useState } from "react";
import { Hash, Pencil, Cloud } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useDrillStore } from "../store/useDrillStore";
import {
  groupByHashtag,
  hashtagCategoryTrees,
  computeKPI,
  tagReturn,
} from "../lib/aggregations";
import { formatMoney, formatNum, formatPct } from "../lib/format";
import { pluralOps, pluralRu } from "../lib/plural";
import { EmptyState } from "../components/EmptyState";
import { CategoryDot } from "../components/CategoryDot";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";
import { Segmented } from "../components/Segmented";
import { DataTable, type Column } from "../components/DataTable";
import { toneOfSigned } from "../components/table/tableKit";
import { HashtagRenameModal } from "../components/HashtagRenameModal";
import { useTagModeStore } from "../store/useTagModeStore";
import { tagLabel, tagsOf, type TagMode } from "../lib/operationTags";
import type { Transaction } from "../types";
import { CardHeader } from "../components/CardHeader";
import { SectionEmpty } from "../components/SectionEmpty";
import { SectionControls } from "../components/SectionControls";

/**
 * Значок тега. Хэштег — решёткой, как его набирают в комментарии. Вторая
 * категория — своим значком и цветом из справочника: это та же категория, что
 * и в остальном сервисе, и узнаваться она должна так же.
 */
function TagMark({ tag, mode, size = "w-3 h-3" }: { tag: string; mode: TagMode; size?: string }) {
  if (mode === "hashtags") return <Hash className={`${size} text-accent shrink-0`} />;
  const [parent, ...rest] = tag.split(/\s*\/\s*/);
  const leaf = rest.join(" / ");
  return leaf ? (
    <CategoryDot category={leaf} parent={parent} size="w-4 h-4" />
  ) : (
    <CategoryDot category={parent} size="w-4 h-4" />
  );
}

/**
 * Что считать тегами — в ряду контролов раздела, под общим фильтром: выбор
 * меняет всю страницу ниже. В шапке он стоял в правом углу мелкой ступенью.
 */
function TagModeSwitch() {
  const mode = useTagModeStore((s) => s.mode);
  const setMode = useTagModeStore((s) => s.setMode);
  const options: { value: TagMode; label: string }[] = [
    { value: "hashtags", label: "Хэштеги" },
    { value: "categories", label: "Вторые категории" },
  ];
  return (
    <Segmented
      label="Что считать тегами"
      value={mode}
      onChange={(next) => void setMode(next)}
      options={options}
    />
  );
}

/**
 * Итог по тегу: доход минус расход. Знак несёт цвет, поэтому «+» рисуем сами —
 * без него плюс и минус различались бы только оттенком.
 */
/** Доход минус расход — со знаком; ноль — прочерк. */
function netText(value: number, base: string): string {
  if (Math.abs(value) < 0.005) return "—";
  return `${value > 0 ? "+" : "−"}${formatMoney(Math.abs(value), base)}`;
}

/** Доходность тега. Пусто — расхода не было, и делить не на что. */
function rateText(rate: number | null): string {
  if (rate === null) return "—";
  return `${rate > 0 ? "+" : ""}${formatPct(rate, 1)}`;
}

/**
 * Строка таблицы тегов: сам тег, категория внутри тега или подкатегория. Одна
 * форма на все три уровня — таблица рисует их одними колонками, дерево
 * раскрывается шевроном.
 */
interface TagRow {
  key: string;
  level: 0 | 1 | 2;
  name: string;
  tag: string;
  category?: string;
  sub?: string;
  expense: number;
  income: number;
  count: number;
  children?: TagRow[];
}

export function TagsPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const showDrill = useDrillStore((s) => s.show);

  const mode = useTagModeStore((s) => s.mode);
  // Откуда брать теги (#69): хэштеги из комментария или вторые категории.
  const getTags = useCallback((t: Transaction) => tagsOf(t, mode), [mode]);
  const label = (tag: string) => tagLabel(tag, mode);
  // Переименовать можно только хэштег: он живёт в тексте комментариев. Вторая
  // категория — запись справочника, и переименовывают её там же, в «Справочниках».
  const canRename = mode === "hashtags";

  const filtered = useMemo(() => applyFilters(transactions, filters, monthStartDay), [transactions, filters, monthStartDay]);
  const tags = useMemo(() => groupByHashtag(filtered, getTags), [filtered, getTags]);
  // Per-tag expense breakdown by category → subcategory.
  const catTrees = useMemo(() => hashtagCategoryTrees(filtered, getTags), [filtered, getTags]);

  // Tagged-only expense sum — shown as «всего» in the header.
  const totalExpense = tags.reduce((s, t) => s + t.expense, 0);
  // Whole-period expense / income (across ALL operations, not just tagged) —
  // the honest denominators for «Доля от расходов» / «Доля от дохода» (#20).
  const periodKpi = useMemo(() => computeKPI(filtered), [filtered]);
  const periodExpense = periodKpi.expense;
  const periodIncome = periodKpi.income;
  const taggedCount = useMemo(
    () => filtered.filter((t) => getTags(t).length > 0).length,
    [filtered, getTags]
  );

  const maxTotal = tags[0] ? tags[0].expense + tags[0].income : 1;

  // Tag cloud ordering: by total flow (default) or alphabetically (issue #20).
  const [cloudAlpha, setCloudAlpha] = useState(false);
  const cloudTags = useMemo(() => {
    if (!cloudAlpha) return tags; // already total-desc from groupByHashtag
    return [...tags].sort((a, b) => a.tag.localeCompare(b.tag, "ru"));
  }, [tags, cloudAlpha]);

  // Какой тег сейчас переименовывают. Окно берёт операции из стора само —
  // здешний `filtered` для этого не годится: переименовать тег только внутри
  // выбранного периода значит расщепить его надвое.
  const [renaming, setRenaming] = useState<string | null>(null);

  function openTag(tag: string) {
    const txs = filtered.filter((t) => getTags(t).includes(tag));
    showDrill(label(tag), txs, "Операции с тегом");
  }

  /** Тот же дрилл, но сузенный до одной категории или подкатегории тега. */
  function openTagCategory(tag: string, category: string, sub?: string) {
    const txs = filtered.filter(
      (t) =>
        getTags(t).includes(tag) &&
        t.category === category &&
        (sub === undefined || t.subcategory === sub)
    );
    showDrill(
      `${label(tag)} · ${sub ?? category}`,
      txs,
      sub ? "Операции с тегом по подкатегории" : "Операции с тегом по категории"
    );
  }

  /**
   * Счётчик операций — кнопка, открывающая список. Клик по строке раскрывает
   * разбивку по категориям, поэтому всплытие обязательно останавливаем: иначе
   * одно нажатие делало бы сразу два дела.
   */
  const countButton = (count: number, onOpen: () => void, title: string) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      className="tabular-nums text-muted hover:text-accent hover:underline underline-offset-2"
      title={title}
    >
      {count}
    </button>
  );

  // Дерево для таблицы: тег → категория → подкатегория, одними колонками.
  const tagRows = useMemo<TagRow[]>(
    () =>
      tags.map((t) => ({
        key: t.tag,
        level: 0,
        name: t.tag,
        tag: t.tag,
        expense: t.expense,
        income: t.income,
        count: t.count,
        children: (catTrees.get(t.tag) ?? []).map((n) => ({
          key: n.category,
          level: 1,
          name: n.category,
          tag: t.tag,
          category: n.category,
          expense: n.expense,
          income: n.income,
          count: n.count,
          children: n.subs.map((sub) => ({
            key: sub.name,
            level: 2,
            name: sub.name,
            tag: t.tag,
            category: n.category,
            sub: sub.name,
            expense: sub.expense,
            income: sub.income,
            count: sub.count,
          })),
        })),
      })),
    [tags, catTrees]
  );

  const openRow = (r: TagRow) =>
    r.level === 0 ? openTag(r.tag) : openTagCategory(r.tag, r.category!, r.sub);

  const tagColumns: Column<TagRow>[] = [
    {
      key: "tag",
      type: "text",
      label: "Тег",
      sortValue: (r) => r.name,
      render: (r) =>
        r.level === 0 ? (
          <span className="flex items-center gap-1.5 min-w-0">
            <TagMark tag={r.tag} mode={mode} />
            <span className="truncate">{r.name}</span>
          </span>
        ) : (
          <span className="flex items-center gap-2 min-w-0">
            <CategoryDot
              category={r.name}
              parent={r.level === 2 ? r.category : undefined}
              size={r.level === 2 ? "w-3.5 h-3.5" : "w-4 h-4"}
            />
            <span className="truncate">{r.name}</span>
          </span>
        ),
    },
    {
      key: "expense",
      type: "money",
      label: "Расход",
      sortValue: (r) => r.expense,
      render: (r) => (r.expense > 0 ? formatMoney(r.expense, base) : "—"),
    },
    {
      key: "income",
      type: "money",
      label: "Доход",
      sortValue: (r) => r.income,
      render: (r) => (r.income > 0 ? formatMoney(r.income, base) : "—"),
    },
    {
      key: "net",
      type: "main",
      tone: (r) => {
        const net = tagReturn(r).net;
        return Math.abs(net) < 0.005 ? "muted" : toneOfSigned(net);
      },
      label: "Доход − расход",
      sortValue: (r) => tagReturn(r).net,
      render: (r) => netText(tagReturn(r).net, base),
    },
    {
      key: "rate",
      type: "change",
      label: "Доходность",
      // Тег без расхода в сортировке уходит вниз, а не притворяется нулевой
      // доходностью; в выгрузку идёт пусто.
      sortValue: (r) => tagReturn(r).rate,
      render: (r) => rateText(tagReturn(r).rate),
    },
    {
      key: "total",
      type: "pct",
      label: "Доля от расходов",
      sortValue: (r) => (periodExpense > 0 ? r.expense / periodExpense : 0),
      render: (r) =>
        periodExpense > 0 && r.expense > 0 ? formatPct(r.expense / periodExpense, 1) : "—",
    },
    {
      key: "incomeShare",
      type: "pct",
      label: "Доля от дохода",
      sortValue: (r) => (periodIncome > 0 ? r.income / periodIncome : 0),
      render: (r) =>
        periodIncome > 0 && r.income > 0 ? formatPct(r.income / periodIncome, 1) : "—",
    },
    {
      key: "count",
      type: "count",
      label: "Операций",
      sortValue: (r) => r.count,
      render: (r) =>
        countButton(
          r.count,
          () => openRow(r),
          r.level === 0
            ? `Показать операции с тегом ${label(r.tag)}`
            : r.level === 1
              ? `Показать операции с тегом ${label(r.tag)} в категории «${r.name}»`
              : `Показать операции с тегом ${label(r.tag)} в подкатегории «${r.name}»`
        ),
    },
    ...(canRename
      ? [
          {
            key: "actions",
            type: "actions",
            label: "Действия",
            width: "6rem",
            // Переименовать можно только тег целиком.
            render: (r: TagRow) =>
              r.level === 0 ? (
                <button
                  type="button"
                  // Клик по строке раскрывает разбивку — не пускаем его туда.
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenaming(r.tag);
                  }}
                  className="btn-icon"
                  title="Переименовать тег или перенести операции в другой"
                  aria-label={`Переименовать тег ${label(r.tag)}`}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              ) : null,
          } satisfies Column<TagRow>,
        ]
      : []),
  ];

  if (transactions.length === 0) return <EmptyState />;

  // Подпись под заголовком — статичная. Цифры выборки живут рядом с тем, что
  // они описывают: счётчики тегов — в шапке облака, знаменатели процентов — в
  // шапке таблицы. А «тегов нет» — не подпись раздела, а его пустое
  // состояние: оно стоит под фильтрами. Шапка, фильтр и режим тегов — одни на
  // обе ветки, пустую и полную.
  const header = (
    <>
      <PageHeader icon={Hash} title="Теги" />
      <GlobalFilters />
      <SectionControls>
        <TagModeSwitch />
      </SectionControls>
    </>
  );

  if (tags.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <SectionEmpty
          icon={Hash}
          title={mode === "hashtags" ? "В выборке нет тегов" : "В выборке нет операций со второй категорией"}
        >
          {mode === "hashtags"
            ? "Метки вида #проект в комментариях собирают операции по темам"
            : "Вторая категория операции, например «Отпуск» или «Ремонт», собирает операции по темам"}
        </SectionEmpty>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <div className="card-tray card-pad">
        <CardHeader
          icon={Cloud}
          title="Облако тегов"
          subtitle={
            <>
              {tags.length} {pluralRu(tags.length, ["тег", "тега", "тегов"])} в{" "}
              {taggedCount}{" "}
              {pluralRu(taggedCount, ["операции", "операциях", "операциях"])}
              {totalExpense > 0 && ` · по тегам ${formatMoney(totalExpense, base)}`}
            </>
          }
          right={
            <Segmented
              size="sm"
              label="Порядок тегов в облаке"
              value={cloudAlpha ? "alpha" : "sum"}
              onChange={(next) => setCloudAlpha(next === "alpha")}
              options={[
                { value: "sum", label: "По сумме" },
                { value: "alpha", label: "А–Я" },
              ]}
            />
          }
        />
        <div className="flex flex-wrap gap-2">
          {cloudTags.map((t) => {
            const score = (t.expense + t.income) / maxTotal;
            const fontSize = 12 + Math.round(score * 16);
            return (
              <button
                key={t.tag}
                onClick={() => openTag(t.tag)}
                className="chip py-1.5 leading-normal text-text hover:border-accent hover:bg-accent/10"
                style={{ fontSize }}
              >
                <TagMark tag={t.tag} mode={mode} />
                <span className="font-medium">{t.tag}</span>
                <span className="text-muted text-xs tabular-nums">
                  {formatNum(t.count)} {pluralOps(t.count)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <DataTable<TagRow>
        icon={Hash}
        title="Все теги"
        info={
          periodExpense > 0 ? (
            <p>
              Проценты — доля от всех расходов за период ({formatMoney(periodExpense, base)})
              {periodIncome > 0 && ` и от всех доходов (${formatMoney(periodIncome, base)})`}, а
              не только от операций с тегами. Строка тега раскрывается разбивкой по
              категориям и подкатегориям.
            </p>
          ) : undefined
        }
        data={tagRows}
        rowKey={(r) => r.key}
        subRows={(r) => r.children}
        defaultSortKey="total"
        exportName={mode === "hashtags" ? "hashtags" : "tags"}
        columns={tagColumns}
      />

      {canRename && renaming && (
        <HashtagRenameModal
          hashtag={renaming}
          onClose={() => setRenaming(null)}
        />
      )}
    </div>
  );
}
