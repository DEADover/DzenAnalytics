import { useCallback, useMemo, useState } from "react";
import { Hash, Pencil } from "lucide-react";
import clsx from "clsx";
import { useDataStore } from "../store/useDataStore";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useDrillStore } from "../store/useDrillStore";
import {
  groupByHashtag,
  hashtagCategoryTrees,
  computeKPI,
  tagReturn,
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
import { useTagModeStore } from "../store/useTagModeStore";
import { tagLabel, tagsOf, type TagMode } from "../lib/operationTags";
import type { Transaction } from "../types";

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

/** Переключатель режима прямо в шапке: эффект выбора виден здесь же. */
function TagModeSwitch() {
  const mode = useTagModeStore((s) => s.mode);
  const setMode = useTagModeStore((s) => s.setMode);
  const options: { value: TagMode; label: string }[] = [
    { value: "hashtags", label: "Хэштеги" },
    { value: "categories", label: "Вторые категории" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Что считать тегами"
      className="inline-flex gap-0.5 rounded-full p-1 bg-panel2 border border-border shadow-tray text-xs"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={mode === o.value}
          onClick={() => void setMode(o.value)}
          className={clsx(
            "px-2.5 py-1 rounded-full transition-colors duration-200",
            mode === o.value
              ? "bg-accent text-accent-fg"
              : "text-muted hover:text-text hover:bg-panel/70"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Итог по тегу: доход минус расход. Знак несёт цвет, поэтому «+» рисуем сами —
 * без него плюс и минус различались бы только оттенком.
 */
function NetCell({ value, base }: { value: number; base: string }) {
  if (Math.abs(value) < 0.005) return <span className="tabular-nums text-muted">—</span>;
  return (
    <span className={`tabular-nums ${value > 0 ? "text-income" : "text-expense"}`}>
      {value > 0 ? "+" : "−"}
      {formatMoney(Math.abs(value), base)}
    </span>
  );
}

/** Доходность тега. Пусто — расхода не было, и делить не на что. */
function RateCell({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="tabular-nums text-muted">—</span>;
  return (
    <span className={`tabular-nums ${rate >= 0 ? "text-income" : "text-expense"}`}>
      {rate > 0 ? "+" : ""}
      {formatPct(rate, 1)}
    </span>
  );
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

  if (transactions.length === 0) return <EmptyState />;

  const hint =
    mode === "hashtags"
      ? "Группировка операций по хэштегам из комментариев"
      : "Группировка операций по второй и следующим категориям";

  if (tags.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={Hash}
          title="Теги"
          hint={
            mode === "hashtags"
              ? "Метки `#проект` в комментариях группируют операции по темам — в текущей выборке тегов нет"
              : "Вторая категория операции — «Отпуск», «Ремонт» — группирует операции по темам. В текущей выборке таких операций нет"
          }
          right={<TagModeSwitch />}
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
      <PageHeader icon={Hash} title="Теги" hint={hint} hintWrap right={<TagModeSwitch />} />
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
          exportName={mode === "hashtags" ? "hashtags" : "tags"}
          columns={
            (
            [
              {
                key: "tag",
                label: "Тег",
                sortValue: (t) => t.tag,
                render: (t) => (
                  <span className="inline-flex items-center gap-1.5">
                    <TagMark tag={t.tag} mode={mode} />
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
                key: "net",
                label: "Доход − расход",
                align: "center",
                sortValue: (t) => tagReturn(t).net,
                render: (t) => <NetCell value={tagReturn(t).net} base={base} />,
              },
              {
                key: "rate",
                label: "Доходность",
                align: "center",
                // Тег без расхода в сортировке уходит вниз, а не притворяется
                // нулевой доходностью.
                sortValue: (t) => tagReturn(t).rate ?? Number.NEGATIVE_INFINITY,
                // В выгрузку идёт пусто, а не «-Infinity», которым тег без
                // расхода уходит вниз списка.
                exportValue: (t) => tagReturn(t).rate ?? "",
                render: (t) => <RateCell rate={tagReturn(t).rate} />,
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
                key: "count",
                label: "Операций",
                align: "center",
                sortValue: (t) => t.count,
                render: (t) =>
                  countButton(t.count, () => openTag(t.tag), `Показать операции с тегом ${label(t.tag)}`),
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
                      aria-label={`Переименовать тег ${label(t.tag)}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  </div>
                ),
              },
            ] as Column<TagBucket>[]
            ).filter((c) => canRename || c.key !== "actions")
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
                  <td className="table-td text-xs text-muted" colSpan={canRename ? 9 : 8}>
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
                  <NetCell value={tagReturn(n).net} base={base} />
                </td>
                <td className="table-td text-center">
                  <RateCell rate={tagReturn(n).rate} />
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
                <td className="table-td text-center">
                  {countButton(
                    n.count,
                    () => openTagCategory(t.tag, n.category),
                    `Показать операции с тегом ${label(t.tag)} в категории «${n.category}»`
                  )}
                </td>
                {/* Под колонку действий — переименовывать можно только тег целиком. */}
                {canRename && <td className="table-td" />}
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
                    <NetCell value={tagReturn(s).net} base={base} />
                  </td>
                  <td className="table-td text-center">
                    <RateCell rate={tagReturn(s).rate} />
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
                  <td className="table-td text-center">
                    {countButton(
                      s.count,
                      () => openTagCategory(t.tag, n.category, s.name),
                      `Показать операции с тегом ${label(t.tag)} в подкатегории «${s.name}»`
                    )}
                  </td>
                  {canRename && <td className="table-td" />}
                </tr>
              )),
            ]);
          }}
        />
      </div>

      {canRename && renaming && (
        <HashtagRenameModal
          hashtag={renaming}
          onClose={() => setRenaming(null)}
        />
      )}
    </div>
  );
}
