import { useMemo, useState } from "react";
import { Hash, Pencil } from "lucide-react";
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
import { HashtagRenameModal } from "../components/HashtagRenameModal";

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

  // Какой тег сейчас переименовывают. Окно берёт операции из стора само —
  // здешний `filtered` для этого не годится: переименовать тег только внутри
  // выбранного периода значит расщепить его надвое.
  const [renaming, setRenaming] = useState<string | null>(null);

  function openTag(tag: string) {
    const txs = filtered.filter((t) => extractHashtags(t.comment).includes(tag));
    showDrill(`#${tag}`, txs, "Операции с тегом");
  }

  /** Тот же дрилл, но сузенный до одной категории или подкатегории тега. */
  function openTagCategory(tag: string, category: string, sub?: string) {
    const txs = filtered.filter(
      (t) =>
        extractHashtags(t.comment).includes(tag) &&
        t.category === category &&
        (sub === undefined || t.subcategory === sub)
    );
    showDrill(
      `#${tag} · ${sub ?? category}`,
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

  if (transactions.length === 0) return <EmptyState />;

  if (tags.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={Hash}
          title="Теги"
          hint="Метки `#проект` в комментариях группируют операции по темам — в текущей выборке тегов нет"
        />
        <GlobalFilters />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Подпись под заголовком — статичная. Цифры выборки живут рядом с тем,
          что они описывают: счётчики тегов — в шапке облака, знаменатели
          процентов — в шапке таблицы. Заголовок должен объяснять страницу, а не
          пересказывать её содержимое. */}
      <PageHeader
        icon={Hash}
        title="Теги"
        hint="Группировка операций по хэштегам из комментариев"
        hintWrap
      />
      <GlobalFilters />

      <div className="card-tray card-pad">
        <div className="flex items-center justify-between mb-4 gap-3">
          <div className="font-semibold flex items-baseline gap-2 flex-wrap min-w-0">
            <span>Облако тегов</span>
            <span className="text-xs font-normal text-muted">
              {tags.length} {pluralRu(tags.length, ["тег", "тега", "тегов"])} в{" "}
              {taggedCount}{" "}
              {pluralRu(taggedCount, ["операции", "операциях", "операциях"])}
              {totalExpense > 0 && ` · по тегам ${formatMoney(totalExpense, base)}`}
            </span>
          </div>
          <div className="inline-flex gap-0.5 rounded-full p-1 bg-panel2 border border-border shadow-tray text-xs">
            <button
              onClick={() => setCloudAlpha(false)}
              className={`px-2.5 py-1 rounded-full transition-colors duration-200 ${!cloudAlpha ? "bg-accent text-accent-fg" : "text-muted hover:text-text hover:bg-panel/70"}`}
            >
              По сумме
            </button>
            <button
              onClick={() => setCloudAlpha(true)}
              className={`px-2.5 py-1 rounded-full transition-colors duration-200 ${cloudAlpha ? "bg-accent text-accent-fg" : "text-muted hover:text-text hover:bg-panel/70"}`}
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
              <button
                key={t.tag}
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
            );
          })}
        </div>
      </div>

      <div className="card-tray card-pad">
        <SortableTable<TagBucket>
          title={
            <span className="flex items-baseline gap-2 flex-wrap min-w-0">
              <span>Все теги</span>
              {periodExpense > 0 && (
                <span className="text-xs font-normal text-muted">
                  Проценты — доля от всех расходов за период (
                  {formatMoney(periodExpense, base)}
                  {periodIncome > 0 && ` · доходов ${formatMoney(periodIncome, base)}`})
                </span>
              )}
            </span>
          }
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
                align: "center",
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
                align: "center",
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
                align: "center",
                sortValue: (t) => t.count,
                render: (t) =>
                  countButton(t.count, () => openTag(t.tag), `Показать операции с тегом #${t.tag}`),
              },
              {
                key: "total",
                label: "Доля от расходов",
                align: "center",
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
                align: "center",
                sortValue: (t) => (periodIncome > 0 ? t.income / periodIncome : 0),
                render: (t) => (
                  <span className="tabular-nums text-muted">
                    {periodIncome > 0 && t.income > 0
                      ? formatPct(t.income / periodIncome, 1)
                      : "—"}
                  </span>
                ),
              },
              {
                key: "actions",
                label: "Действия",
                align: "center",
                // Именно длина в CSS, а не Tailwind-класс: SortableTable кладёт
                // `width` прямо в инлайновый стиль, и «w-24» браузер молча
                // выбрасывает как невалидное значение.
                width: "6rem",
                sortable: false,
                // Кнопки в выгрузке бессмысленны — колонку в CSV не берём вовсе.
                exportSkip: true,
                render: (t) => (
                  <div className="flex items-center justify-center">
                    <button
                      type="button"
                      // Клик по строке раскрывает разбивку по категориям —
                      // без остановки всплытия карандаш заодно её дёргал бы.
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenaming(t.tag);
                      }}
                      className="btn-ghost !p-1.5 text-muted hover:text-accent"
                      title="Переименовать тег или перенести операции в другой"
                      aria-label={`Переименовать тег #${t.tag}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  </div>
                ),
              },
            ] as Column<TagBucket>[]
          }
          isExpanded={(t) => expanded.has(t.tag)}
          onToggleExpand={(t) => toggle(t.tag)}
          // Раскрыть все теги сразу — иконкой в шапке колонки со шевронами.
          onToggleAllExpanded={(expand) =>
            setExpanded(expand ? new Set(tags.map((t) => t.tag)) : new Set())
          }
          renderExpanded={(t) => {
            const nodes = catTrees.get(t.tag);
            if (!nodes || nodes.length === 0) {
              return (
                <tr className="bg-panel2/20">
                  <td className="table-td" />
                  <td className="table-td text-xs text-muted" colSpan={7}>
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
                <td className="table-td text-center tabular-nums text-expense">
                  {n.expense > 0 ? formatMoney(n.expense, base) : "—"}
                </td>
                <td className="table-td text-center tabular-nums text-income">
                  {n.income > 0 ? formatMoney(n.income, base) : "—"}
                </td>
                <td className="table-td text-center">
                  {countButton(
                    n.count,
                    () => openTagCategory(t.tag, n.category),
                    `Показать операции с тегом #${t.tag} в категории «${n.category}»`
                  )}
                </td>
                <td className="table-td text-center tabular-nums text-muted">
                  {periodExpense > 0 && n.expense > 0
                    ? formatPct(n.expense / periodExpense, 1)
                    : "—"}
                </td>
                <td className="table-td text-center tabular-nums text-muted">
                  {periodIncome > 0 && n.income > 0
                    ? formatPct(n.income / periodIncome, 1)
                    : "—"}
                </td>
                {/* Под колонку действий — переименовывать можно только тег целиком. */}
                <td className="table-td" />
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
                  <td className="table-td text-center tabular-nums">
                    {s.expense > 0 ? formatMoney(s.expense, base) : "—"}
                  </td>
                  <td className="table-td text-center tabular-nums">
                    {s.income > 0 ? formatMoney(s.income, base) : "—"}
                  </td>
                  <td className="table-td text-center">
                    {countButton(
                      s.count,
                      () => openTagCategory(t.tag, n.category, s.name),
                      `Показать операции с тегом #${t.tag} в подкатегории «${s.name}»`
                    )}
                  </td>
                  <td className="table-td text-center tabular-nums">
                    {periodExpense > 0 && s.expense > 0
                      ? formatPct(s.expense / periodExpense, 1)
                      : "—"}
                  </td>
                  <td className="table-td text-center tabular-nums">
                    {periodIncome > 0 && s.income > 0
                      ? formatPct(s.income / periodIncome, 1)
                      : "—"}
                  </td>
                  <td className="table-td" />
                </tr>
              )),
            ]);
          }}
        />
      </div>

      {renaming && (
        <HashtagRenameModal
          hashtag={renaming}
          onClose={() => setRenaming(null)}
        />
      )}
    </div>
  );
}
