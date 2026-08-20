import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import {
  CloudOff,
  X,
  Pencil,
  Plus,
  Trash2,
  Undo2,
  Tags,
  Users,
  Wallet,
  ChevronDown,
  ArrowRight,
  ListChecks,
  Combine,
  Store,
  UploadCloud,
  SquarePen,
  CalendarClock,
} from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useEditsStore, type TransactionEdit } from "../store/useEditsStore";
import { useDraftsStore } from "../store/useDraftsStore";
import { useDeletedStore } from "../store/useDeletedStore";
import { useTagEditsStore } from "../store/useTagEditsStore";
import { useAccountEditsStore } from "../store/useAccountEditsStore";
import { useNewCategoriesStore } from "../store/useNewCategoriesStore";
import { useTagDeletionsStore } from "../store/useTagDeletionsStore";
import { usePlannedDeletionsStore } from "../store/usePlannedDeletionsStore";
import { useCounterpartyEditsStore } from "../store/useCounterpartyEditsStore";
import {
  getCategoryTagsFromCache,
  getCounterpartiesFromCache,
  getLiveAccountsFromCache,
  useZenmoneyStore,
  type CategoryTag,
  type Counterparty,
  type LiveAccount,
} from "../store/useZenmoneyStore";
import { confirm } from "../store/useConfirmStore";
import { snapshotPromiseText } from "../lib/cloudSnapshots";
import { EditTransactionModal } from "./EditTransactionModal";
import { CategoryDot } from "./CategoryDot";
import { formatMoney, formatDate, displayPayee } from "../lib/format";
import { accountKindLabel } from "../lib/accountType";
import { pluralRu } from "../lib/plural";
import { kindLabel, kindColorClass } from "../lib/txKindStyle";
import type { Transaction } from "../types";

// Which patch fields map to which human-readable «changed aspect».
/** Одна «грань» операции: какие ключи патча её задевают, как она называется и
 *  как достать её значение из транзакции. Один источник и для чипов в строке,
 *  и для раскрытого «было → стало» — они не могут разойтись. */
interface Aspect {
  keys: string[];
  label: string;
  get: (t: Transaction) => string;
  /** Чем читать сторону «было», если она не совпадает с обычным значением.
   *  Нужно там, где исходную транзакцию мог переписать производный слой. */
  getBefore?: (t: Transaction) => string;
}

const dash = (v: string | null | undefined) => (v && v.trim() ? v : "—");

const ASPECTS: Aspect[] = [
  { keys: ["date"], label: "Дата", get: (t) => formatDate(t.date) },
  {
    keys: ["createdAt"],
    label: "Время",
    get: (t) =>
      t.createdAt
        ? new Date(t.createdAt).toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "—",
  },
  {
    keys: ["category", "subcategory", "categoryFull"],
    label: "Категория",
    get: (t) => dash(t.categoryFull),
    // «Было» — категория от Дзен-мани. В `transactionsRaw` её мог переписать
    // слой правил, и тогда правка, записанная кнопкой «Применить правила»,
    // сравнивалась бы сама с собой и не показывалась в списке на отправку —
    // хотя в облако уедет именно смена категории. Тот же расчёт, что в
    // `buildRulePlan`.
    getBefore: (t) => dash(t.categoryFullOriginal || t.categoryFull),
  },
  { keys: ["payee", "brand"], label: "Получатель", get: (t) => dash(displayPayee(t)) },
  { keys: ["comment"], label: "Комментарий", get: (t) => dash(t.comment) },
  {
    keys: ["amount", "currency"],
    label: "Сумма",
    get: (t) => formatMoney(t.amount, t.currency),
  },
  { keys: ["kind"], label: "Тип", get: (t) => kindLabel(t.kind) },
  { keys: ["account"], label: "Счёт", get: (t) => dash(t.account) },
  { keys: ["outcomeAccount"], label: "Счёт списания", get: (t) => dash(t.outcomeAccount) },
  { keys: ["incomeAccount"], label: "Счёт зачисления", get: (t) => dash(t.incomeAccount) },
  {
    keys: ["incomeAmount", "incomeCurrency"],
    label: "Сумма зачисления",
    get: (t) => formatMoney(t.incomeAmount, t.incomeCurrency),
  },
];

/** Строка раскрытого сравнения: поле, было, стало. */
export interface FieldDiff {
  label: string;
  from: string;
  to: string;
}

/** Что именно поменялось: сравниваем исходную транзакцию с той, что видна
 *  сейчас (с наложенной правкой). Грани, где значение фактически не изменилось,
 *  отбрасываем — патч иногда несёт поля, которых пользователь не трогал. */
function diffOf(before: Transaction | undefined, after: Transaction, patch: TransactionEdit): FieldDiff[] {
  const touched = new Set(Object.keys(patch));
  const out: FieldDiff[] = [];
  for (const a of ASPECTS) {
    if (!a.keys.some((k) => touched.has(k))) continue;
    const to = a.get(after);
    const from = before ? (a.getBefore ?? a.get)(before) : "—";
    if (from === to) continue;
    out.push({ label: a.label, from, to });
  }
  return out;
}

/** Подписи изменённых полей — чипами в свёрнутой строке. */
function changedFields(diff: FieldDiff[]): string[] {
  return diff.map((d) => d.label);
}

/**
 * Local pending changes that haven't been pushed to Zenmoney yet — edits,
 * newly-created drafts, and local deletions. Each can be reverted (rolled back)
 * individually, or all at once. Purely local: reverting never touches the cloud.
 */
export function PendingChangesModal({ onClose }: { onClose: () => void }) {
  const transactions = useDataStore((s) => s.transactions);
  const transactionsRaw = useDataStore((s) => s.transactionsRaw);
  const reapply = useDataStore((s) => s.reapplyRules);
  const deleteTransaction = useDataStore((s) => s.deleteTransaction);

  const edits = useEditsStore((s) => s.edits);
  const clearEdit = useEditsStore((s) => s.clearEdit);
  const clearAllEdits = useEditsStore((s) => s.clearAll);
  const drafts = useDraftsStore((s) => s.drafts);
  const clearAllDrafts = useDraftsStore((s) => s.clearAll);
  const deletedIds = useDeletedStore((s) => s.deletedIds);
  const restoreDeleted = useDeletedStore((s) => s.restore);
  const restoreManyDeleted = useDeletedStore((s) => s.restoreMany);

  // Справочники (issue #50): раньше их правки уходили в тот же push, но в этом
  // списке не показывались — отменить одну из них точечно было нельзя, только
  // «сбросить всё» в самом справочнике.
  const tagEdits = useTagEditsStore((s) => s.edits);
  const newCats = useNewCategoriesStore((s) => s.items);
  const tagDeletions = useTagDeletionsStore((s) => s.deletions);
  const plannedDeletions = usePlannedDeletionsStore((s) => s.deletions);
  const cpRenames = useCounterpartyEditsStore((s) => s.renames);
  const cpCreated = useCounterpartyEditsStore((s) => s.created);
  const cpDeleted = useCounterpartyEditsStore((s) => s.deleted);
  const cpMerges = useCounterpartyEditsStore((s) => s.merges);

  // Названия берём из кэша: правки хранятся по id, а показать надо человеку.
  const [cacheTags, setCacheTags] = useState<CategoryTag[]>([]);
  const [cacheCps, setCacheCps] = useState<Counterparty[]>([]);
  const [cacheAccounts, setCacheAccounts] = useState<LiveAccount[]>([]);
  const accountEdits = useAccountEditsStore((s) => s.edits);
  useEffect(() => {
    let alive = true;
    getCategoryTagsFromCache().then((t) => alive && setCacheTags(t ?? []));
    getCounterpartiesFromCache().then((c) => alive && setCacheCps(c ?? []));
    getLiveAccountsFromCache().then((a) => alive && setCacheAccounts(a ?? []));
    return () => {
      alive = false;
    };
  }, []);
  const tagTitle = useMemo(() => {
    const m = new Map(cacheTags.map((t) => [t.id, t.title]));
    for (const c of newCats) m.set(c.id, c.title);
    return (id: string) => m.get(id) ?? "категория удалена из Дзен-мани";
  }, [cacheTags, newCats]);
  const cpTitle = useMemo(() => {
    const m = new Map(cacheCps.map((c) => [c.id, c.title]));
    for (const c of cpCreated) m.set(c.id, c.title);
    return (id: string) => m.get(id) ?? "контрагент удалён из Дзен-мани";
  }, [cacheCps, cpCreated]);

  // Аккордеон: раскрыта максимум одна строка — иначе список из десятка правок
  // превращается в простыню, а сравнивать всё равно удобнее по одной.
  const token = useZenmoneyStore((s) => s.token);
  const pushing = useZenmoneyStore((s) => s.pushStatus) === "syncing";

  // Полноценный редактор операции прямо из списка: увидел странную правку —
  // открыл и поправил, не выходя в ленту и не ища строку заново (issue #50).
  const [editing, setEditing] = useState<Transaction | null>(null);

  const [openKey, setOpenKey] = useState<string | null>(null);
  const toggle = (key: string) => setOpenKey((cur) => (cur === key ? null : key));

  const backdropDown = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Пока поверх открыт редактор операции — Escape принадлежит ему. Оба окна
      // слушают клавишу на window, и без этой проверки одно нажатие закрывало
      // сразу оба, выкидывая из списка вместо возврата к нему.
      if (editing) return;
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editing]);

  const byId = useMemo(
    () => new Map(transactions.map((t) => [t.id, t])),
    [transactions]
  );
  const rawById = useMemo(
    () => new Map(transactionsRaw.map((t) => [t.id, t])),
    [transactionsRaw]
  );

  const editItems = useMemo(
    () =>
      Object.keys(edits)
        .map((id) => {
          const tx = byId.get(id);
          if (!tx) return null;
          return { id, tx, diff: diffOf(rawById.get(id), tx, edits[id]) };
        })
        .filter((x): x is { id: string; tx: Transaction; diff: FieldDiff[] } => !!x),
    [edits, byId, rawById]
  );
  const draftItems = useMemo(
    () => Object.keys(drafts).map((id) => byId.get(id)).filter((t): t is Transaction => !!t),
    [drafts, byId]
  );
  const deletedItems = useMemo(
    () => deletedIds.map((id) => rawById.get(id)).filter((t): t is Transaction => !!t),
    [deletedIds, rawById]
  );

  /** Одна строка списка справочника: что поменяли и как это отменить. */
  type DictAction = "create" | "edit" | "merge" | "delete";

  interface DictItem {
    key: string;
    action: DictAction;
    title: string;
    note: string;
    /** «Было → стало» — есть только у правок, у создания/удаления его нет. */
    diff?: FieldDiff[];
    revert: () => Promise<void>;
  }

  const categoryItems = useMemo<DictItem[]>(() => {
    const out: DictItem[] = [];
    for (const c of newCats) {
      out.push({
        key: `new:${c.id}`,
        action: "create",
        title: c.title,
        note: c.parent ? "Новая подкатегория" : "Новая категория",
        revert: () => useNewCategoriesStore.getState().remove(c.id),
      });
    }
    for (const [id, patch] of Object.entries(tagEdits)) {
      const was = cacheTags.find((t) => t.id === id);
      const diff: FieldDiff[] = [];
      const yesNo = (v: boolean | undefined | null) => (v ? "Да" : "Нет");
      if (patch.title !== undefined)
        diff.push({ label: "Название", from: was?.title ?? "—", to: patch.title });
      if (patch.parent !== undefined)
        diff.push({
          label: "Родитель",
          from: was?.parent ? tagTitle(was.parent) : "Верхний уровень",
          to: patch.parent ? tagTitle(patch.parent) : "Верхний уровень",
        });
      if (patch.showOutcome !== undefined)
        diff.push({ label: "Расходная", from: yesNo(was?.showOutcome), to: yesNo(patch.showOutcome) });
      if (patch.showIncome !== undefined)
        diff.push({ label: "Доходная", from: yesNo(was?.showIncome), to: yesNo(patch.showIncome) });
      if (patch.required !== undefined)
        diff.push({
          label: "Обязательность",
          from: was?.required === false ? "Необязательная" : "Обязательная",
          to: patch.required === false ? "Необязательная" : "Обязательная",
        });
      if (patch.color !== undefined) diff.push({ label: "Цвет", from: "Прежний", to: "Новый" });
      if (patch.icon !== undefined) diff.push({ label: "Иконка", from: "Прежняя", to: "Новая" });
      out.push({
        key: `edit:${id}`,
        action: "edit",
        title: patch.title ?? tagTitle(id),
        note: diff.map((d) => d.label).join(", ") || "Изменено",
        diff,
        revert: () => useTagEditsStore.getState().clearMany([id]),
      });
    }
    for (const [id, replacement] of Object.entries(tagDeletions)) {
      out.push({
        key: `del:${id}`,
        action: "delete",
        title: tagTitle(id),
        note: replacement
          ? `Удаление · Операции переедут в «${tagTitle(replacement)}»`
          : "Удаление · Операции останутся без категории",
        revert: () => useTagDeletionsStore.getState().restore(id),
      });
    }
    return out;
  }, [newCats, tagEdits, tagDeletions, tagTitle, cacheTags]);

  const accountItems = useMemo<DictItem[]>(() => {
    const byId = new Map(cacheAccounts.map((a) => [a.id, a]));
    const yesNo = (v: boolean | undefined | null) => (v ? "Да" : "Нет");
    const out: DictItem[] = [];
    for (const [id, patch] of Object.entries(accountEdits)) {
      const was = byId.get(id);
      const diff: FieldDiff[] = [];
      if (patch.title !== undefined)
        diff.push({ label: "Название", from: was?.title ?? "—", to: patch.title });
      // Вид счёта — это пара (type, savings), поэтому и в разборе правок он
      // одной строкой: «Банковский счёт → Накопительный счёт» понятнее, чем
      // два отдельных изменения, из которых по одному ничего не ясно.
      if (patch.type !== undefined || patch.savings !== undefined)
        diff.push({
          label: "Вид счёта",
          from: was ? accountKindLabel(was.type, was.savings) : "—",
          to: accountKindLabel(
            patch.type ?? was?.type ?? "",
            patch.savings ?? was?.savings
          ),
        });
      if (patch.inBalance !== undefined)
        diff.push({ label: "В балансе", from: yesNo(was?.inBalance), to: yesNo(patch.inBalance) });
      if (patch.private !== undefined)
        diff.push({ label: "Личный", from: yesNo(was?.private), to: yesNo(patch.private) });
      if (patch.archive !== undefined)
        diff.push({ label: "Архивный", from: yesNo(was?.archive), to: yesNo(patch.archive) });
      if (patch.creditLimit !== undefined)
        diff.push({
          label: "Кредитный лимит",
          from: formatMoney(was?.creditLimit ?? 0, was?.currency ?? ""),
          to: formatMoney(patch.creditLimit, was?.currency ?? ""),
        });
      if (patch.startBalance !== undefined && was) {
        // Показываем то, что человек правил, — баланс, а не служебный
        // начальный остаток, который сдвинулся под капотом.
        const ops = was.balance - was.startBalance;
        diff.push({
          label: "Баланс",
          from: formatMoney(was.balance, was.currency),
          to: formatMoney(patch.startBalance + ops, was.currency),
        });
      }
      const unitRu = (u: string | null | undefined) =>
        u === "year" ? "г." : u === "day" ? "дн." : u === "week" ? "нед." : "мес.";
      const payoffRu = (step?: number | null, interval?: string | null) =>
        interval === "year" && step === 1
          ? "Раз в год"
          : interval === "month" && step === 3
            ? "Ежеквартально"
            : interval === "month" && step === 1
              ? "Ежемесячно"
              : "В конце срока";
      if (patch.percent !== undefined)
        diff.push({
          label: "Ставка",
          from: was?.percent != null ? `${was.percent}%` : "не указана",
          to: patch.percent != null ? `${patch.percent}%` : "не указана",
        });
      if (patch.capitalization !== undefined)
        diff.push({
          label: "Капитализация",
          from: yesNo(was?.capitalization),
          to: yesNo(patch.capitalization),
        });
      if (patch.endDateOffset !== undefined || patch.endDateOffsetInterval !== undefined)
        diff.push({
          label: "Срок",
          from:
            was?.endDateOffset != null
              ? `${was.endDateOffset} ${unitRu(was.endDateOffsetInterval)}`
              : "не указан",
          to: `${patch.endDateOffset ?? was?.endDateOffset ?? "—"} ${unitRu(
            patch.endDateOffsetInterval ?? was?.endDateOffsetInterval
          )}`,
        });
      if (patch.payoffStep !== undefined || patch.payoffInterval !== undefined)
        diff.push({
          label: "Начисление процентов",
          from: payoffRu(was?.payoffStep, was?.payoffInterval),
          to: payoffRu(
            patch.payoffStep ?? was?.payoffStep,
            patch.payoffInterval ?? was?.payoffInterval
          ),
        });
      if (patch.startDate !== undefined)
        diff.push({
          label: "Дата открытия",
          from: was?.startDate ? formatDate(was.startDate) : "не указана",
          to: patch.startDate ? formatDate(patch.startDate) : "не указана",
        });
      out.push({
        key: `acc:${id}`,
        action: "edit",
        title: patch.title ?? was?.title ?? "счёт удалён из Дзен-мани",
        note: diff.map((d) => d.label).join(", ") || "Изменено",
        diff,
        revert: () => useAccountEditsStore.getState().revert(id),
      });
    }
    return out;
  }, [accountEdits, cacheAccounts]);

  const counterpartyItems = useMemo<DictItem[]>(() => {
    const out: DictItem[] = [];
    for (const c of cpCreated) {
      out.push({
        key: `cpnew:${c.id}`,
        action: "create",
        title: c.title,
        note: "Новый контрагент",
        revert: () => useCounterpartyEditsStore.getState().remove(c.id),
      });
    }
    for (const [id, title] of Object.entries(cpRenames)) {
      out.push({
        key: `cpren:${id}`,
        action: "edit",
        title,
        note: "Переименование",
        diff: [{ label: "Название", from: cpTitle(id), to: title }],
        revert: () => useCounterpartyEditsStore.getState().rename(id, undefined),
      });
    }
    for (const [id, survivor] of Object.entries(cpMerges)) {
      out.push({
        key: `cpmrg:${id}`,
        action: "merge",
        title: cpTitle(id),
        note: `Объединение · Операции переедут на «${cpTitle(survivor)}»`,
        revert: () => useCounterpartyEditsStore.getState().restore(id),
      });
    }
    for (const id of cpDeleted) {
      out.push({
        key: `cpdel:${id}`,
        action: "delete",
        title: cpTitle(id),
        note: "Удаление · У операций очистится получатель",
        revert: () => useCounterpartyEditsStore.getState().restore(id),
      });
    }
    return out;
  }, [cpCreated, cpRenames, cpMerges, cpDeleted, cpTitle]);

  // Просроченные запланированные операции, снятые вручную (issue #71). Подпись
  // и дату берём из очереди, а не из кэша: после отправки операции там уже нет,
  // а строка должна оставаться читаемой до самого конца.
  const plannedItems = useMemo<DictItem[]>(
    () =>
      Object.values(plannedDeletions).map((p) => ({
        key: `plan:${p.id}`,
        action: "delete" as const,
        title: p.title,
        note: p.wholePlan
          ? `Разовый план от ${formatDate(p.date, "short")} · Удаление в Дзен-мани`
          : `Операция от ${formatDate(p.date, "short")} · Сам план останется`,
        revert: () => usePlannedDeletionsStore.getState().restore(p.id),
      })),
    [plannedDeletions]
  );

  const total =
    editItems.length +
    draftItems.length +
    deletedItems.length +
    categoryItems.length +
    accountItems.length +
    counterpartyItems.length +
    plannedItems.length;

  /** Отправка прямо отсюда: пользователь уже просмотрел список и решил — гонять
   *  его обратно в настройки за кнопкой незачем. */
  async function pushAll() {
    // Фразу про копию облака берём из реальной политики снимков: обещать её
    // при политике «никогда» — врать пользователю.
    const snapshotText = await snapshotPromiseText(
      useZenmoneyStore.getState().snapshotPolicy
    );
    const ok = await confirm({
      title: `Отправить ${total} ${pluralRu(total, ["изменение", "изменения", "изменений"])} в Дзен-мани?`,
      message:
        snapshotText +
          "Проверим конфликты. Неподдерживаемые правки будут пропущены — их список появится в журнале синхронизаций.",
      confirmLabel: "Отправить",
    });
    if (!ok) return;
    await useZenmoneyStore
      .getState()
      .pushPendingEdits()
      .catch(() => {
        /* ошибка видна в журнале и в статусе синхронизации */
      });
  }

  async function revertAll() {
    const ok = await confirm({
      title: "Откатить все изменения?",
      message: `${total} несинхронизированных изменений будут отменены локально (правки, черновики, удаления). В облаке Дзен-мани ничего не тронется.`,
      confirmLabel: "Откатить все",
      tone: "danger",
    });
    if (!ok) return;
    await clearAllEdits();
    await clearAllDrafts();
    if (deletedIds.length) await restoreManyDeleted(deletedIds);
    // Справочники — по одному, у каждого стора своя семантика отмены.
    for (const it of [
      ...categoryItems,
      ...accountItems,
      ...counterpartyItems,
      ...plannedItems,
    ])
      await it.revert();
    await reapply();
  }

  const label = (t: Transaction) =>
    t.brand?.trim() || t.payee?.trim() || t.categoryFull || "—";

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => {
        backdropDown.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && backdropDown.current) onClose();
        backdropDown.current = false;
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-3xl max-h-[85vh] flex flex-col"
        style={{ scrollbarGutter: "stable" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="p-1.5 rounded-lg bg-accent/10 text-accent shrink-0">
              <CloudOff className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <div className="font-semibold truncate">
                Изменения ждут отправки в Дзен-мани
              </div>
              <div className="text-xs text-muted">
                {total > 0 ? `Всего изменений: ${total}` : "Всё отправлено"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {total > 0 && (
              <button
                onClick={revertAll}
                className="btn-ghost text-xs text-expense whitespace-nowrap"
              >
                <Undo2 className="w-3.5 h-3.5" />
                Откатить все
              </button>
            )}
            {total > 0 && token && (
              <button
                onClick={pushAll}
                disabled={pushing}
                className="btn-primary text-xs whitespace-nowrap"
              >
                <UploadCloud className="w-3.5 h-3.5" />
                {pushing ? "Отправка…" : "Отправить все"}
              </button>
            )}
            <button onClick={onClose} className="text-muted hover:text-text" aria-label="Закрыть">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto px-5 py-3 flex-1">
          {total === 0 ? (
            <div className="text-center text-muted text-sm py-10">
              Нет несинхронизированных изменений — всё отправлено в Дзен-мани.
            </div>
          ) : (
            <div className="space-y-6">
              <EntityGroup
                icon={<ListChecks className="w-4 h-4 text-accent" />}
                title="Операции"
                count={draftItems.length + editItems.length + deletedItems.length}
              >
                <ActionGroup icon={<Plus className="w-3.5 h-3.5 text-income" />} title="Создано" tone={ACTION_TONE.create} count={draftItems.length}>
                  {draftItems.map((t) => (
                    <Row
                      key={t.id}
                      t={t}
                      label={label(t)}
                      onEdit={() => setEditing(t)}
                      action="Удалить"
                      onAction={() => deleteTransaction(t.id)}
                    />
                  ))}
                </ActionGroup>
                <ActionGroup icon={<Pencil className="w-3.5 h-3.5 text-warn" />} title="Изменено" tone={ACTION_TONE.edit} count={editItems.length}>
                  {editItems.map(({ id, tx, diff }) => (
                    <Row
                      key={id}
                      t={tx}
                      label={label(tx)}
                      fields={changedFields(diff)}
                      diff={diff}
                      expanded={openKey === id}
                      onToggle={() => toggle(id)}
                      onEdit={() => setEditing(tx)}
                      action="Откатить"
                      onAction={async () => {
                        await clearEdit(id);
                        await reapply();
                      }}
                    />
                  ))}
                </ActionGroup>
                <ActionGroup icon={<Trash2 className="w-3.5 h-3.5 text-expense" />} title="Удалено" tone={ACTION_TONE.delete} count={deletedItems.length}>
                  {deletedItems.map((t) => (
                    <Row
                      key={t.id}
                      t={t}
                      label={label(t)}
                      action="Вернуть"
                      onAction={async () => {
                        await restoreDeleted(t.id);
                        await reapply();
                      }}
                    />
                  ))}
                </ActionGroup>
              </EntityGroup>

              <DictGroup
                icon={<Tags className="w-4 h-4 text-accent" />}
                title="Категории"
                items={categoryItems}
                openKey={openKey}
                onToggle={toggle}
                withDot
              />
              <DictGroup
                icon={<Wallet className="w-4 h-4 text-accent" />}
                title="Счета"
                items={accountItems}
                openKey={openKey}
                onToggle={toggle}
              />
              <DictGroup
                icon={<Users className="w-4 h-4 text-accent" />}
                title="Контрагенты"
                items={counterpartyItems}
                openKey={openKey}
                onToggle={toggle}
              />
              <DictGroup
                icon={<CalendarClock className="w-4 h-4 text-accent" />}
                title="Планы"
                items={plannedItems}
                openKey={openKey}
                onToggle={toggle}
              />
            </div>
          )}
        </div>
      </div>
      {editing && (
        <EditTransactionModal
          key={editing.id}
          tx={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>,
    document.body
  );
}

type DictActionView = "create" | "edit" | "merge" | "delete";

interface DictItemView {
  key: string;
  action: DictActionView;
  title: string;
  note: string;
  diff?: FieldDiff[];
  revert: () => Promise<void>;
}

/** Сущность верхнего уровня: Операции / Категории / Контрагенты. Пустая —
 *  не рисуется вовсе, чтобы список не пестрел нулями. */
function EntityGroup({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="font-semibold text-base">{title}</span>
        <span className="text-sm text-muted tabular-nums">{count}</span>
        <div className="flex-1 h-px bg-border" />
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

/** Действие внутри сущности: Создано / Изменено / Объединено / Удалено. */
function ActionGroup({
  icon,
  title,
  count,
  tone,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  /** Полупрозрачная подложка по смыслу действия. */
  tone: string;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div>
      {/* `-mx-5 px-5` компенсирует горизонтальные поля скролл-контейнера, чтобы
          полоса шла от края до края модалки, а текст остался на своём месте. */}
      <div
        className={clsx(
          "flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted",
          "-mx-5 px-5 py-1.5 mb-1",
          tone
        )}
      >
        {icon}
        <span className="font-medium">{title}</span>
        <span className="opacity-60 tabular-nums">{count}</span>
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

/** Оттенок подложки по действию — тот же язык цвета, что и во всём приложении. */
const ACTION_TONE = {
  create: "bg-income/10",
  edit: "bg-warn/10",
  merge: "bg-accent/10",
  delete: "bg-expense/10",
} as const;

/** Сущность справочника целиком: строки разложены по действию тем же порядком,
 *  что и операции — создание, изменение, объединение, удаление. */
function DictGroup({
  icon,
  title,
  items,
  openKey,
  onToggle,
  withDot,
}: {
  icon: React.ReactNode;
  title: string;
  items: DictItemView[];
  openKey: string | null;
  onToggle: (key: string) => void;
  /** Категории показываем их же цветным кружком, как везде в приложении. */
  withDot?: boolean;
}) {
  const ACTIONS: { action: DictActionView; title: string; icon: React.ReactNode }[] = [
    { action: "create", title: "Создано", icon: <Plus className="w-3.5 h-3.5 text-income" /> },
    { action: "edit", title: "Изменено", icon: <Pencil className="w-3.5 h-3.5 text-warn" /> },
    { action: "merge", title: "Объединено", icon: <Combine className="w-3.5 h-3.5 text-accent" /> },
    { action: "delete", title: "Удалено", icon: <Trash2 className="w-3.5 h-3.5 text-expense" /> },
  ];
  return (
    <EntityGroup icon={icon} title={title} count={items.length}>
      {ACTIONS.map((a) => {
        const rows = items.filter((i) => i.action === a.action);
        return (
          <ActionGroup key={a.action} icon={a.icon} title={a.title} tone={ACTION_TONE[a.action]} count={rows.length}>
            {rows.map((it) => (
              <DictRow
                key={it.key}
                item={it}
                withDot={withDot}
                expanded={openKey === it.key}
                onToggle={() => onToggle(it.key)}
              />
            ))}
          </ActionGroup>
        );
      })}
    </EntityGroup>
  );
}

function Row({
  t,
  label,
  fields,
  diff,
  expanded,
  onToggle,
  onEdit,
  action,
  onAction,
}: {
  t: Transaction;
  label: string;
  /** Изменённые поля — рисуются чипами, а не строкой через запятую. */
  fields?: string[];
  /** «Было → стало» по каждому полю; при пустом списке строка не раскрывается. */
  diff?: FieldDiff[];
  expanded?: boolean;
  onToggle?: () => void;
  /** Открыть операцию в полном редакторе. */
  onEdit?: () => void;
  action: string;
  onAction: () => void | Promise<void>;
}) {
  const canExpand = !!diff && diff.length > 0 && !!onToggle;
  return (
    <div
      className={clsx(
        "group rounded-lg -mx-2 px-2 transition-colors",
        expanded ? "bg-panel2/60" : "hover:bg-panel2/60"
      )}
    >
      <div
        className={clsx("flex items-center gap-3 py-2 text-sm", canExpand && "cursor-pointer")}
        onClick={canExpand ? onToggle : undefined}
      >
        <CategoryDot category={t.category} size="w-7 h-7" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium" title={label}>
            {label}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
            <span className="text-xs text-muted truncate">{t.categoryFull}</span>
            {fields?.map((f) => (
              <span
                key={f}
                className="text-[10px] px-1.5 py-0.5 rounded bg-warn/10 text-warn whitespace-nowrap"
              >
                {f}
              </span>
            ))}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={clsx("tabular-nums whitespace-nowrap", kindColorClass(t.kind))}>
            {formatMoney(t.amount, t.currency)}
          </div>
          <div className="text-[11px] text-muted">{kindLabel(t.kind)}</div>
        </div>
        {/* Слот под шеврон занят всегда: без него кнопка отката съезжала на
            строках без раскрытия («Создано», «Удалено») и правый край рвался. */}
        <span className="w-4 shrink-0 flex items-center justify-center">
          {canExpand && (
            <ChevronDown
              className={clsx(
                "w-4 h-4 text-muted transition-transform duration-200",
                expanded && "rotate-180"
              )}
            />
          )}
        </span>
        {/* Клик по кнопкам не должен заодно раскрывать строку. */}
        <span className="flex items-center" onClick={(e) => e.stopPropagation()}>
          {onEdit && (
            <button
              onClick={onEdit}
              className="p-1.5 rounded-md shrink-0 text-muted opacity-70 hover:opacity-100 hover:text-accent hover:bg-panel2 group-hover:opacity-100 transition-colors"
              title="Открыть в редакторе операции"
              aria-label="Открыть в редакторе операции"
            >
              <SquarePen className="w-4 h-4" />
            </button>
          )}
          <RevertButton action={action} onAction={onAction} />
        </span>
      </div>
      {canExpand && <DiffPanel diff={diff!} open={!!expanded} />}
    </div>
  );
}

/**
 * Раскрывающееся сравнение «было → стало».
 *
 * Высота измеряется и анимируется явно, а не через модный `grid-template-rows:
 * 0fr → 1fr`: числовая высота предсказуемо анимируется в любом движке и не
 * зависит от поддержки интерполяции `fr`. `scrollHeight` снимаем после
 * отрисовки строк, поэтому панель подстраивается под своё содержимое.
 */
function DiffPanel({ diff, open }: { diff: FieldDiff[]; open: boolean }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    if (inner.current) setHeight(inner.current.scrollHeight);
  }, [diff]);

  return (
    <div
      className="overflow-hidden transition-[height] duration-200 ease-out"
      style={{ height: open ? height : 0 }}
      aria-hidden={!open}
    >
      <div ref={inner} className="pb-2.5 pl-10 pr-1 space-y-1">
        {diff.map((d) => (
          <div key={d.label} className="flex items-baseline gap-2 text-xs">
            <span className="text-muted shrink-0 min-w-[7rem]">{d.label}:</span>
            <span className="text-muted line-through truncate">{d.from}</span>
            <ArrowRight className="w-3 h-3 text-muted shrink-0" />
            <span className="text-text truncate">{d.to}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Откат строки — только иконка: подпись повторялась бы на каждой строке и
 *  перетягивала внимание с самих изменений. Смысл несут подсказка и aria-label,
 *  а «Откатить все» в шапке остаётся с текстом — там действие одно и опасное. */
function RevertButton({
  action,
  onAction,
}: {
  action: string;
  onAction: () => void | Promise<void>;
}) {
  return (
    <button
      onClick={() => void onAction()}
      className="p-1.5 rounded-md shrink-0 text-muted opacity-70 hover:opacity-100 hover:text-accent hover:bg-panel2 group-hover:opacity-100 transition-colors"
      title={`${action} (локально, без облака)`}
      aria-label={action}
    >
      <Undo2 className="w-4 h-4" />
    </button>
  );
}

/** Строка правки справочника — без суммы и категории, их тут нет. */
function DictRow({
  item,
  withDot,
  expanded,
  onToggle,
}: {
  item: DictItemView;
  withDot?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const canExpand = !!item.diff && item.diff.length > 0 && !!onToggle;
  return (
    <div
      className={clsx(
        "group rounded-lg -mx-2 px-2 transition-colors",
        expanded ? "bg-panel2/60" : "hover:bg-panel2/60"
      )}
    >
      <div
        className={clsx("flex items-center gap-3 py-2 text-sm", canExpand && "cursor-pointer")}
        onClick={canExpand ? onToggle : undefined}
      >
        {/* Категория узнаётся по своему кружку, контрагент — нейтральной
            иконкой: без них строки справочников читались как голый текст
            рядом с операциями, у которых иконка есть. */}
        {withDot ? (
          <CategoryDot category={item.title} size="w-7 h-7" />
        ) : (
          <span className="w-7 h-7 shrink-0 rounded-full bg-panel2 border border-border flex items-center justify-center text-muted">
            <Store className="w-3.5 h-3.5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium" title={item.title}>
            {item.title}
          </div>
          <div className="text-xs text-muted truncate mt-0.5">{item.note}</div>
        </div>
        <span className="w-4 shrink-0 flex items-center justify-center">
          {canExpand && (
            <ChevronDown
              className={clsx(
                "w-4 h-4 text-muted transition-transform duration-200",
                expanded && "rotate-180"
              )}
            />
          )}
        </span>
        <span onClick={(e) => e.stopPropagation()}>
          <RevertButton action="Откатить" onAction={item.revert} />
        </span>
      </div>
      {canExpand && <DiffPanel diff={item.diff!} open={!!expanded} />}
    </div>
  );
}
