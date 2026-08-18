// Editor for a category's «обязательная» (`tag.required`) flag — the field
// Zenmoney uses to mark mandatory expenses, and the source the 50/30/20 page
// reads to split needs vs wants. Edits are optimistic locally (the split
// updates instantly) and ride to the cloud through the normal Push flow
// (same modes / snapshot safety as transaction edits).
//
// Semantics: `null` (not set) and `true` both mean «обязательная» (default —
// mandatory); only an explicit `false` is «необязательная». So the control is
// a two-state Обязательные / Необязательные toggle, and the 50/30/20 page
// treats `required !== false` as a need.

import { useEffect, useMemo, useState } from "react";
import { useLazyList } from "../hooks/useLazyList";
import { Link } from "react-router-dom";
import {
  Search,
  RotateCcw,
  Eye,
  EyeOff,
  Pencil,
  Check,
  Plus,
  Trash2,
  Undo2,
} from "lucide-react";
import clsx from "clsx";
import {
  getCategoryTagsFromCache,
  useZenmoneyStore,
  type CategoryTag,
} from "../store/useZenmoneyStore";
import { useTagEditsStore } from "../store/useTagEditsStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { useSlicesStore, activeSlice } from "../store/useSlicesStore";
import { useNewCategoriesStore, type NewCategory } from "../store/useNewCategoriesStore";
import { useTagDeletionsStore } from "../store/useTagDeletionsStore";
import { useDataStore } from "../store/useDataStore";
import { useDrillStore } from "../store/useDrillStore";
import { confirm } from "../store/useConfirmStore";
import { colorForCategory } from "../lib/categoryColor";
import { formatNum } from "../lib/format";
import { CategoryDot } from "./CategoryDot";
import { CategoryEditModal } from "./CategoryEditModal";
import {
  CategoryDeleteModal,
  type ReplacementOption,
} from "./CategoryDeleteModal";
import { InfoPopover } from "./InfoPopover";
import { CountSortHeader, type SortMode } from "./CountSortHeader";

/** What the edit/create modal is currently doing. */
type ModalState =
  | { kind: "create"; parent: string | null }
  | { kind: "edit"; tag: CategoryTag }
  | { kind: "edit-new"; draft: NewCategory }
  | { kind: "delete"; tag: CategoryTag }
  | null;

/** «Обязательная» if `required` is not explicitly `false` (null/true → true). */
function isObligatory(required: boolean | null): boolean {
  return required !== false;
}

export function CategoryManager() {
  const serverTimestamp = useZenmoneyStore((s) => s.serverTimestamp);

  const tagEdits = useTagEditsStore((s) => s.edits);
  const transactions = useDataStore((s) => s.transactions);
  const showDrill = useDrillStore((s) => s.show);
  const newCats = useNewCategoriesStore((s) => s.items);
  const newCatsLoaded = useNewCategoriesStore((s) => s.loaded);
  const hydrateNewCats = useNewCategoriesStore((s) => s.hydrate);
  const tagDeletions = useTagDeletionsStore((s) => s.deletions);

  const [tags, setTags] = useState<CategoryTag[] | null | "loading">("loading");
  const [query, setQuery] = useState("");
  // The edit/create modal (name/type/parent/colour/icon/обязательность).
  const [modal, setModal] = useState<ModalState>(null);
  // «?» info popover next to the toolbar.
  const [sort, setSort] = useState<SortMode>("title");
  // Category colours (for the parent→child rail), keyed by title.
  const meta = useCategoryMetaStore((s) => s.meta);

  useEffect(() => {
    if (!newCatsLoaded) hydrateNewCats();
  }, [newCatsLoaded, hydrateNewCats]);

  // Operation count per category leaf, keyed by `categoryFull` (root by title,
  // sub by «Родитель / Подкатегория») — matches how a tag maps to its tx.
  const countByFull = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of transactions) {
      m.set(t.categoryFull, (m.get(t.categoryFull) ?? 0) + 1);
    }
    return m;
  }, [transactions]);
  // «Не учитывать в аналитике» set (#14). Keyed the same way as categoryMeta:
  // root by title, sub by «Родитель / Подкатегория».
  // Галочка правит АКТИВНЫЙ разрез — в шапке колонки написано, какой именно.
  const sliceList = useSlicesStore((s) => s.slices);
  const sliceActiveId = useSlicesStore((s) => s.activeId);
  const toggleExcluded = useSlicesStore((s) => s.toggleCategory);
  const slice = activeSlice({ slices: sliceList, activeId: sliceActiveId });
  const excluded = useMemo(() => new Set(slice.excludedCategories), [slice]);

  // (Re)load the category tags from cache. Re-runs after a sync (serverTimestamp
  // bumps) so freshly-pulled `required` values show up.
  useEffect(() => {
    let alive = true;
    getCategoryTagsFromCache().then((t) => {
      if (alive) setTags(t);
    });
    return () => {
      alive = false;
    };
  }, [serverTimestamp]);

  // Unpushed new categories, shown alongside the cached ones (with a «новая»
  // badge). Merged into the flattened list so a new sub appears under its parent.
  const newIds = useMemo(() => new Set(newCats.map((c) => c.id)), [newCats]);
  const allTags = useMemo<CategoryTag[]>(() => {
    const base = Array.isArray(tags) ? tags : [];
    const asTag: CategoryTag[] = newCats.map((c) => ({
      id: c.id,
      title: c.title,
      parent: c.parent,
      required: c.required,
      showIncome: c.showIncome,
      showOutcome: c.showOutcome,
      icon: c.icon,
      color: c.color,
    }));
    return [...base, ...asTag];
  }, [tags, newCats]);

  // Flatten tags into display order: each root followed by its sub-tags
  // (`depth: 1`). When searching, a group survives if the root OR any child
  // matches; within a matched-root group all children show, otherwise only the
  // matching children (the root stays as their header).
  const groups = useMemo(() => {
    if (!Array.isArray(tags)) return [];
    const q = query.trim().toLowerCase();
    const hit = (t: CategoryTag) => t.title.toLowerCase().includes(q);
    const roots = allTags.filter((t) => !t.parent);
    const kids = new Map<string, CategoryTag[]>();
    for (const t of allTags) {
      if (!t.parent) continue;
      const arr = kids.get(t.parent);
      if (arr) arr.push(t);
      else kids.set(t.parent, [t]);
    }
    const out: { root: CategoryTag; children: CategoryTag[] }[] = [];
    for (const root of roots) {
      const children = kids.get(root.id) ?? [];
      const rootHit = !q || hit(root);
      const anyChildHit = children.some(hit);
      if (q && !rootHit && !anyChildHit) continue;
      // Searching with a non-matching root → keep only matching children
      // (the root stays as their header).
      const shown = q && !rootHit ? children.filter(hit) : children;
      out.push({ root, children: shown });
    }
    if (sort === "title") return out;
    // Count sort applies at BOTH levels — roots among themselves, sub-categories
    // within their parent — with an alphabetical tiebreak so equal counts keep a
    // stable order. Sub-categories always stay under their own root.
    const dir = sort === "count-desc" ? -1 : 1;
    const cmp = (aKey: string, aTitle: string, bKey: string, bTitle: string) => {
      const d = (countByFull.get(aKey) ?? 0) - (countByFull.get(bKey) ?? 0);
      return d !== 0 ? d * dir : aTitle.localeCompare(bTitle, "ru");
    };
    return out
      .map((g) => ({
        ...g,
        children: [...g.children].sort((a, b) =>
          cmp(`${g.root.title} / ${a.title}`, a.title, `${g.root.title} / ${b.title}`, b.title)
        ),
      }))
      .sort((a, b) => cmp(a.root.title, a.root.title, b.root.title, b.root.title));
  }, [tags, allTags, query, sort, countByFull]);

  // Показываем порциями по мере прокрутки страницы: режем ВЕРХНИЙ уровень,
  // подкатегории едут вместе со своим родителем — иначе группа разорвалась бы
  // посередине. Внутренней прокрутки у списка больше нет, она давала вторую
  // полосу прокрутки поверх страничной.
  // Разбираем результат сразу: правило про ссылки считает обращением к ссылке
  // любое чтение поля у объекта, в котором есть функция-ссылка.
  const {
    visible: visibleGroups,
    shown: shownGroups,
    total: totalGroups,
    hasMore: hasMoreGroups,
    attachSentinel: attachGroupsSentinel,
  } = useLazyList(groups, 60);

  const pendingCount =
    Object.keys(tagEdits).length +
    newCats.length +
    Object.keys(tagDeletions).length;

  /** Subcategories of a root, from the unfiltered list (a search must not
   *  narrow what a delete actually cascades to). */
  const childrenOf = (id: string) => allTags.filter((t) => t.parent === id);

  /** Operations attached to a category and — for a root — its subcategories,
   *  since deleting the root takes them along. */
  function affectedCount(t: CategoryTag): number {
    if (t.parent) {
      const parentTitle = allTags.find((p) => p.id === t.parent)?.title ?? "";
      return countByFull.get(`${parentTitle} / ${t.title}`) ?? 0;
    }
    let n = countByFull.get(t.title) ?? 0;
    for (const c of childrenOf(t.id)) {
      n += countByFull.get(`${t.title} / ${c.title}`) ?? 0;
    }
    return n;
  }

  /** Everything that could inherit the operations — minus the rows going away
   *  with this delete, and minus categories that are themselves queued for
   *  deletion or not in the cloud yet. */
  function replacementOptions(t: CategoryTag): ReplacementOption[] {
    const doomed = new Set([t.id, ...childrenOf(t.id).map((c) => c.id)]);
    const byId = new Map(allTags.map((x) => [x.id, x]));
    return allTags
      .filter(
        (x) =>
          !doomed.has(x.id) &&
          !newIds.has(x.id) &&
          tagDeletions[x.id] === undefined
      )
      .map((x) => ({
        id: x.id,
        title: x.title,
        parentTitle: x.parent ? byId.get(x.parent)?.title : undefined,
      }))
      .sort((a, b) =>
        `${a.parentTitle ?? ""}${a.title}`.localeCompare(
          `${b.parentTitle ?? ""}${b.title}`,
          "ru"
        )
      );
  }

  /** Delete a category. An unpushed draft never reached the cloud, so it's just
   *  dropped; a cached one goes through the «куда перенести операции» dialog. */
  async function onDelete(t: CategoryTag) {
    if (newIds.has(t.id)) {
      const kids = childrenOf(t.id);
      const ok = await confirm({
        title: "Удалить новую категорию?",
        message: kids.length
          ? `«${t.title}» ещё не отправлена в облако — черновик удалится вместе с ${formatNum(kids.length)} подкатегориями.`
          : `«${t.title}» ещё не отправлена в облако — черновик просто удалится.`,
        confirmLabel: "Удалить",
        tone: "danger",
      });
      if (!ok) return;
      const store = useNewCategoriesStore.getState();
      await store.removeMany([t.id, ...kids.filter((c) => newIds.has(c.id)).map((c) => c.id)]);
      return;
    }
    setModal({ kind: "delete", tag: t });
  }

  async function resetEdits() {
    // Clear the local overlay AND any unpushed new categories. The cloud is
    // untouched; the next sync re-derives categoryMeta from the cache.
    await useTagEditsStore.getState().clearAll();
    await useNewCategoriesStore.getState().clear();
    await useTagDeletionsStore.getState().clearAll();
  }

  /** Open the operations of a category leaf in the shared drill drawer. The key
   *  is the same `categoryFull` the count is built from, so what opens matches
   *  the number exactly (a root shows only its own ops, not its subs'). */
  function openOperations(fullKey: string) {
    const txs = transactions.filter((t) => t.categoryFull === fullKey);
    if (txs.length === 0) return;
    showDrill(fullKey, txs, "Категория");
  }

  /** Double-click a row to edit it — but not when the click landed on a
   *  control inside the row (checkbox, eye, pencil…), which has its own job. */
  function onRowDoubleClick(e: React.MouseEvent, t: CategoryTag) {
    if ((e.target as HTMLElement).closest("button, input, a, select")) return;
    openEdit(t);
  }

  /** Open the modal for a row — as an unpushed-new draft or a cached tag. */
  function openEdit(t: CategoryTag) {
    if (newIds.has(t.id)) {
      const draft = newCats.find((c) => c.id === t.id);
      if (draft) setModal({ kind: "edit-new", draft });
    } else {
      setModal({ kind: "edit", tag: t });
    }
  }

  // CSV mode — no Zenmoney cache, nothing to edit / sync.
  if (tags === null) {
    return (
      <p className="text-sm text-muted">
        Управление категориями (название, тип, иерархия, цвет, иконка,
        обязательность, создание) доступно только в режиме Дзен-мани API — нужен
        живой список категорий и синхронизация. Подключите Дзен-мани в
        настройках.
      </p>
    );
  }

  // Bare content — the card + heading come from OperationsSettings.
  return (
    <div className="space-y-3">
      {/* Toolbar: search + «?» info popover + pending/reset/push + Добавить. */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 bg-panel2 rounded-lg px-2 py-1 border border-border flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-muted shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск категории…"
            className="bg-transparent text-sm flex-1 outline-none min-w-0"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="text-xs text-muted hover:text-text"
              aria-label="Очистить поиск"
            >
              ✕
            </button>
          )}
        </div>

        <InfoPopover label="Как это работает">
                <p>
                  Кнопка <strong className="text-text">карандаша</strong> (или
                  двойной клик по строке) открывает редактирование: <strong className="text-text">название</strong>,{" "}
                  <strong className="text-text">тип</strong> (расходная/доходная),{" "}
                  <strong className="text-text">родительская категория</strong>,{" "}
                  <strong className="text-text">цвет</strong>,{" "}
                  <strong className="text-text">иконка</strong> и{" "}
                  <strong className="text-text">обязательность</strong>. Кнопка{" "}
                  <strong className="text-text">«Добавить»</strong> создаёт новую
                  категорию или подкатегорию. Всё копится локально и уходит в
                  Дзен-мани при отправке в облако (режим API).
                </p>
                <p>
                  <strong className="text-text">Корзина</strong> удаляет категорию.
                  Перед этим спросим, куда перенести её операции — в другую
                  категорию или оставить без категории. Удаление корневой
                  категории забирает с собой и подкатегории: в Дзен-мани
                  подкатегория не может остаться без родителя.
                </p>
                <p>
                  <strong className="text-text">«Обязательность»</strong> — справочный
                  столбец: по умолчанию категории обязательные, необязательными вы
                  помечаете исключения (кафе, развлечения). Используется в правиле{" "}
                  <Link to="/50-30-20" className="text-accent hover:underline">
                    50/30/20
                  </Link>{" "}
                  и в оценке финансового здоровья.
                </p>
                <p>
                  <strong className="text-text">«В аналитике»</strong> позволяет
                  <strong className="text-text"> исключить</strong> категорию из
                  сводных виджетов (Цели и FIRE, Здоровье, Что-если, Год в цифрах,
                  Дайджест) — удобно для оборотов, взаимозачётов и возмещений.
                  Исключение корневой категории охватывает и подкатегории. Настройка
                  локальная, в облако не уходит.
                </p>
              </InfoPopover>

        {pendingCount > 0 && (
          <span className="text-xs text-warn tabular-nums shrink-0">
            правок: {pendingCount}
          </span>
        )}
        {pendingCount > 0 && (
          <button
            onClick={resetEdits}
            className="text-xs flex items-center gap-1 text-muted hover:text-text shrink-0"
            title="Сбросить несохранённые правки (облако не меняется)"
          >
            <RotateCcw className="w-3.5 h-3.5" /> сбросить
          </button>
        )}
        <button
          type="button"
          onClick={() => setModal({ kind: "create", parent: null })}
          className="btn-primary text-sm shrink-0"
        >
          <Plus className="w-4 h-4" />
          Добавить
        </button>
      </div>

      {/* One scroll container holds the sticky header AND the rows, so both
          share the exact same content width and scrollbar gutter — the columns
          line up regardless of whether the list overflows. */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div
          // Obeys the «Размер текста в таблицах» slider — rows inherit this.
          style={{ fontSize: "var(--tbl-font)" }}
        >
          <div className="sticky top-0 z-10 bg-panel border-b border-border flex items-center gap-3 px-3 py-2 text-[0.85em] text-muted uppercase tracking-wide">
            <span className="flex-1 min-w-0">Категория</span>
            <span className="hidden sm:block w-24 shrink-0 text-center">Расходная</span>
            <span className="hidden sm:block w-24 shrink-0 text-center">Доходная</span>
            <span className="hidden md:block w-36 shrink-0">Обязательность</span>
            <span className="hidden lg:flex w-20 shrink-0 items-center justify-center">
              <CountSortHeader sort={sort} onChange={setSort} />
            </span>
            <span className="w-28 shrink-0 text-center whitespace-nowrap">В аналитике</span>
            <span className="w-20 shrink-0 text-center whitespace-nowrap">Действия</span>
          </div>

          {groups.length === 0 ? (
            <div className="text-sm text-muted py-6 text-center">
              {tags.length === 0 ? "Категории не найдены." : "Ничего не найдено."}
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {visibleGroups.map(({ root, children }) => {
                const hasKids = children.length > 0;
                const rail = colorForCategory(root.title, meta);
                const rEdit = tagEdits[root.id];
                const rObl = isObligatory(
                  rEdit?.required !== undefined ? rEdit.required : root.required ?? null
                );
                const rExcluded = excluded.has(root.title);
                const rCount = countByFull.get(root.title) ?? 0;
                const rOutcome = rEdit?.showOutcome ?? root.showOutcome;
                const rIncome = rEdit?.showIncome ?? root.showIncome;
                const rIsNew = newIds.has(root.id);
                const rDeleted = tagDeletions[root.id] !== undefined;
                return (
                  <div key={root.id}>
                    <div
                      onDoubleClick={(e) => onRowDoubleClick(e, root)}
                      title={rDeleted ? undefined : "Двойной клик — редактирование"}
                      className={clsx(
                        "flex items-center gap-3 px-3 py-1.5 hover:bg-panel2/40 select-none",
                        rDeleted && "opacity-50"
                      )}
                    >
                      <span className="flex items-center gap-2 min-w-0 flex-1">
                        {!rIsNew && rEdit && (
                          <span className="w-1.5 h-1.5 rounded-full bg-warn shrink-0" />
                        )}
                        <CategoryDot category={root.title} size="w-7 h-7" />
                        <span className={clsx("truncate", rDeleted && "line-through")}>
                          {rEdit?.title ?? root.title}
                        </span>
                        {rIsNew && !rDeleted && (
                          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-accent/10 text-accent shrink-0">
                            новая
                          </span>
                        )}
                        {rDeleted && (
                          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-expense/10 text-expense shrink-0">
                            удалена
                          </span>
                        )}
                      </span>
                      <span className="hidden sm:flex w-24 shrink-0 items-center justify-center">
                        {rOutcome && <Check className="w-4 h-4 text-muted" />}
                      </span>
                      <span className="hidden sm:flex w-24 shrink-0 items-center justify-center">
                        {rIncome && <Check className="w-4 h-4 text-muted" />}
                      </span>
                      <span className="hidden md:block w-36 shrink-0 text-muted truncate">
                        {rObl ? "Обязательная" : "Необязательная"}
                      </span>
                      <span className="hidden lg:flex w-20 shrink-0 items-center justify-center">
                        {rCount ? (
                          <button
                            onClick={() => openOperations(root.title)}
                            title="Показать операции категории"
                            className="tabular-nums text-muted hover:text-accent hover:underline px-1 rounded"
                          >
                            {formatNum(rCount)}
                          </button>
                        ) : (
                          <span className="text-muted tabular-nums">—</span>
                        )}
                      </span>
                      <span className="w-28 shrink-0 flex items-center justify-center">
                        <button
                          onClick={() => toggleExcluded(root.title)}
                          aria-pressed={rExcluded}
                          title={
                            rExcluded
                              ? `Не учитывается в аналитике вместе с подкатегориями (Разрез «${slice.name}»)`
                              : `Учитывается в аналитике (Разрез «${slice.name}»)`
                          }
                          aria-label={
                            rExcluded ? "Вернуть категорию в аналитику" : "Исключить категорию из аналитики"
                          }
                          className={clsx(
                            "p-1.5 rounded-md",
                            rExcluded
                              ? "text-warn bg-warn/10"
                              : "text-muted hover:text-accent hover:bg-panel2"
                          )}
                        >
                          {rExcluded ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </span>
                      {/* Both row actions share ONE cell so the pair sits under
                          the «Действия» header as a block and the two icons stay
                          next to each other instead of drifting apart. */}
                      <span className="w-20 shrink-0 flex items-center justify-center gap-0.5">
                        <button
                          onClick={() => openEdit(root)}
                          disabled={rDeleted}
                          title="Редактировать категорию"
                          aria-label="Редактировать категорию"
                          className="p-1.5 rounded-md text-muted hover:text-accent hover:bg-panel2 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        {rDeleted ? (
                          <button
                            onClick={() => useTagDeletionsStore.getState().restore(root.id)}
                            title="Отменить удаление"
                            aria-label="Отменить удаление категории"
                            className="p-1.5 rounded-md text-muted hover:text-accent hover:bg-panel2"
                          >
                            <Undo2 className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => onDelete(root)}
                            title="Удалить категорию"
                            aria-label="Удалить категорию"
                            className="p-1.5 rounded-md text-muted hover:text-expense hover:bg-expense/10"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </span>
                    </div>
                    {hasKids && (
                      <div className="mb-2" style={{ marginLeft: "19px", borderLeft: `3px solid ${rail}` }}>
                        {children.map((c) => {
                          const cEdit = tagEdits[c.id];
                          const cObl = isObligatory(
                            cEdit?.required !== undefined ? cEdit.required : c.required ?? null
                          );
                          const cKey = `${root.title} / ${c.title}`;
                          const cOwnExcluded = excluded.has(cKey);
                          // A sub is also excluded when its ROOT is excluded (the
                          // selector matches on `tx.category`) — show it as such
                          // and disable its own toggle, since the root covers it.
                          const cExcluded = rExcluded || cOwnExcluded;
                          const cCount = countByFull.get(cKey) ?? 0;
                          const cOutcome = cEdit?.showOutcome ?? c.showOutcome;
                          const cIncome = cEdit?.showIncome ?? c.showIncome;
                          const cIsNew = newIds.has(c.id);
                          // A subcategory is struck through both when deleted on
                          // its own and when its root is going away with it.
                          const cDeleted = rDeleted || tagDeletions[c.id] !== undefined;
                          return (
                            <div
                              key={c.id}
                              onDoubleClick={(e) => onRowDoubleClick(e, c)}
                              title={cDeleted ? undefined : "Двойной клик — редактирование"}
                              className={clsx(
                                "flex items-center gap-3 pl-2 pr-3 py-1.5 hover:bg-panel2/40 select-none",
                                cDeleted && "opacity-50"
                              )}
                            >
                              <span className="flex items-center gap-2 min-w-0 flex-1">
                                {!cIsNew && cEdit && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-warn shrink-0" />
                                )}
                                <CategoryDot
                                  category={c.title}
                                  parent={root.title}
                                  fallback={rail}
                                  size="w-6 h-6"
                                />
                                <span
                                  className={clsx(
                                    "truncate text-muted",
                                    cDeleted && "line-through"
                                  )}
                                >
                                  {cEdit?.title ?? c.title}
                                </span>
                                {cIsNew && !cDeleted && (
                                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-accent/10 text-accent shrink-0">
                                    новая
                                  </span>
                                )}
                                {cDeleted && (
                                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-expense/10 text-expense shrink-0">
                                    удалена
                                  </span>
                                )}
                              </span>
                              <span className="hidden sm:flex w-24 shrink-0 items-center justify-center">
                                {cOutcome && <Check className="w-4 h-4 text-muted" />}
                              </span>
                              <span className="hidden sm:flex w-24 shrink-0 items-center justify-center">
                                {cIncome && <Check className="w-4 h-4 text-muted" />}
                              </span>
                              <span className="hidden md:block w-36 shrink-0 text-muted truncate">
                                {cObl ? "Обязательная" : "Необязательная"}
                              </span>
                              <span className="hidden lg:flex w-20 shrink-0 items-center justify-center">
                                {cCount ? (
                                  <button
                                    onClick={() => openOperations(cKey)}
                                    title="Показать операции подкатегории"
                                    className="tabular-nums text-muted hover:text-accent hover:underline px-1 rounded"
                                  >
                                    {formatNum(cCount)}
                                  </button>
                                ) : (
                                  <span className="text-muted tabular-nums">—</span>
                                )}
                              </span>
                              <span className="w-28 shrink-0 flex items-center justify-center">
                                <button
                                  onClick={() => toggleExcluded(cKey)}
                                  disabled={rExcluded}
                                  aria-pressed={cExcluded}
                                  title={
                                    rExcluded
                                      ? "Исключена вместе с родительской категорией"
                                      : cOwnExcluded
                                        ? `Не учитывается в аналитике (Разрез «${slice.name}»)`
                                        : `Учитывается в аналитике (Разрез «${slice.name}»)`
                                  }
                                  aria-label={
                                    cExcluded
                                      ? "Вернуть подкатегорию в аналитику"
                                      : "Исключить подкатегорию из аналитики"
                                  }
                                  className={clsx(
                                    "p-1.5 rounded-md",
                                    rExcluded && "opacity-40 cursor-not-allowed",
                                    cExcluded
                                      ? "text-warn bg-warn/10"
                                      : "text-muted hover:text-accent hover:bg-panel2"
                                  )}
                                >
                                  {cExcluded ? (
                                    <EyeOff className="w-4 h-4" />
                                  ) : (
                                    <Eye className="w-4 h-4" />
                                  )}
                                </button>
                              </span>
                              <span className="w-20 shrink-0 flex items-center justify-center gap-0.5">
                                <button
                                  onClick={() => openEdit(c)}
                                  disabled={cDeleted}
                                  title="Редактировать подкатегорию"
                                  aria-label="Редактировать подкатегорию"
                                  className="p-1.5 rounded-md text-muted hover:text-accent hover:bg-panel2 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                {tagDeletions[c.id] !== undefined ? (
                                  <button
                                    onClick={() => useTagDeletionsStore.getState().restore(c.id)}
                                    title="Отменить удаление"
                                    aria-label="Отменить удаление подкатегории"
                                    className="p-1.5 rounded-md text-muted hover:text-accent hover:bg-panel2"
                                  >
                                    <Undo2 className="w-4 h-4" />
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => onDelete(c)}
                                    disabled={rDeleted}
                                    title={
                                      rDeleted
                                        ? "Удалится вместе с родительской категорией"
                                        : "Удалить подкатегорию"
                                    }
                                    aria-label="Удалить подкатегорию"
                                    className="p-1.5 rounded-md text-muted hover:text-expense hover:bg-expense/10 disabled:opacity-40 disabled:cursor-not-allowed"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              {hasMoreGroups && (
                <div
                  ref={attachGroupsSentinel}
                  className="px-3 py-3 text-center text-xs text-muted"
                >
                  Показано {shownGroups} из {totalGroups} — прокрутите
                  дальше, чтобы загрузить ещё
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {modal?.kind === "edit" && (
        <CategoryEditModal
          roots={allTags.filter((t) => !t.parent)}
          tag={modal.tag}
          pending={tagEdits[modal.tag.id]}
          hasChildren={allTags.some((t) => t.parent === modal.tag.id)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "edit-new" && (
        <CategoryEditModal
          roots={allTags.filter((t) => !t.parent)}
          draft={modal.draft}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "create" && (
        <CategoryEditModal
          roots={allTags.filter((t) => !t.parent)}
          create
          initialParent={modal.parent}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "delete" && (
        <CategoryDeleteModal
          target={modal.tag}
          subcategories={childrenOf(modal.tag.id)}
          options={replacementOptions(modal.tag)}
          affected={affectedCount(modal.tag)}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
