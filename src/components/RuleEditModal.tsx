import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Wand2,
  ChevronDown,
  Plus,
  Trash2,
  HelpCircle,
  Clock,
} from "lucide-react";
import clsx from "clsx";
import {
  CONDITION_OP_LABELS,
  FIELD_LABELS,
  VALUELESS_OPS,
  actionTarget,
  compileCondition,
  compileRuleV2,
  describeRule,
  joinCategoryFull,
  splitCategoryFull,
  ruleMatchesV2,
  type CategoryRuleV2,
  type ConditionJoin,
  type ConditionOp,
  type RuleAction,
  type RuleActionKind,
  type RuleCondition,
  type RuleField,
  type RuleTargetField,
} from "../lib/ruleEngine";
import { displayPayee, formatDate, formatMoney, formatNum } from "../lib/format";
import { pluralRu } from "../lib/plural";
import { CategoryDot } from "./CategoryDot";
import { AccountLogo } from "./AccountLogo";
import {
  CategoryCascadePicker,
  type CategoryNode,
} from "./CategoryCascadePicker";
import { Select } from "./Select";
import { Tooltip } from "./Tooltip";
import { Combobox } from "./Combobox";
import type { Transaction } from "../types";

const RULE_FIELDS: { value: RuleField; label: string }[] = (
  Object.keys(FIELD_LABELS) as RuleField[]
).map((value) => ({ value, label: FIELD_LABELS[value] }));

const RULE_OPS: { value: ConditionOp; label: string }[] = (
  Object.keys(CONDITION_OP_LABELS) as ConditionOp[]
).map((value) => ({ value, label: CONDITION_OP_LABELS[value] }));

/**
 * Что правило меняет — три цели, а не пять видов действия.
 *
 * Раньше в одном списке лежали «Комментарий», «Дописать в начало комментария» и
 * «Дописать в конец комментария»: выбор поля и способ записи были свалены в
 * кучу, а длинные подписи распирали окно. Теперь сначала выбирают ЧТО менять,
 * и уже для комментария — КАК.
 */
const ACTION_TARGETS: { value: RuleTargetField; label: string }[] = [
  { value: "category", label: "Категория" },
  { value: "payee", label: "Получатель" },
  { value: "comment", label: "Комментарий" },
];

/** Способ записи комментария. Внутри правила это по-прежнему три вида действия. */
const COMMENT_MODES: { value: RuleActionKind; label: string }[] = [
  { value: "setComment", label: "Новый комментарий" },
  { value: "prependComment", label: "Дописать в начало" },
  { value: "appendComment", label: "Дописать в конец" },
];

/** Вид действия по умолчанию для выбранной цели. */
const DEFAULT_KIND: Record<RuleTargetField, RuleActionKind> = {
  category: "setCategory",
  payee: "setPayee",
  comment: "setComment",
};

/** Черновик правила — то, что редактируется в окне. */
export interface RuleDraft {
  enabled: boolean;
  /** Своё название. Пустое — значит правило описывается своими условиями. */
  title: string;
  conditions: RuleCondition[];
  join: ConditionJoin;
  actions: RuleAction[];
}

interface Props {
  /** Правило для редактирования; отсутствует — создаём новое. */
  rule?: CategoryRuleV2;
  /** Операции ДО правок — правила видят именно их, значит и счётчик совпадений
   *  должен считаться по ним, иначе он покажет одно, а правило сделает другое. */
  transactions: Transaction[];
  /** Подсказки категорий для действия «Категория». */
  categories: string[];
  /** Подсказки получателей для действия «Получатель». */
  payees: string[];
  /** Названия счетов — для пикера в условии «Счёт». */
  accounts: string[];
  /** Те же счета, разложенные по виду («Карта», «Депозит»…). Нет в режиме CSV. */
  accountGroups?: { label: string; items: string[] }[];
  onClose: () => void;
  onSave: (draft: RuleDraft) => void | Promise<void>;
}

/** Ключ строки в списке — на смысл правила не влияет, живёт только в окне. */
let seq = 0;
const nextId = () => `k${Date.now().toString(36)}-${seq++}`;

const newCondition = (): RuleCondition => ({
  id: nextId(),
  field: "payee",
  op: "contains",
  value: "",
  caseInsensitive: true,
});

const newAction = (): RuleAction => ({ id: nextId(), kind: "setCategory", value: "" });

const EMPTY: RuleDraft = {
  enabled: true,
  title: "",
  conditions: [newCondition()],
  join: "and",
  actions: [newAction()],
};

/** Действие, которое видно в операциях только после «Применить правила». */
const NEEDS_APPLY: ReadonlySet<RuleActionKind> = new Set<RuleActionKind>([
  "setPayee",
  "setComment",
  "prependComment",
  "appendComment",
]);

/** Единый вид поля в окне: `Select` рисует себя как `.input h-10` с текстом
 *  `text-sm`, поэтому обычные поля должны задавать то же самое — иначе соседние
 *  «Получатель» и «Магнит» набраны разным кеглем и разной высоты. */
const FIELD = "input h-10 text-sm";

/** Синтаксис регулярных выражений — за знаком вопроса, а не абзацем в форме:
 *  нужен он раз в сто правил, а место занимал бы всегда. Таблицей, потому что
 *  колонка знаков в тексте подсказки разъезжается на пропорциональном шрифте. */
const REGEX_TOKENS: [string, string][] = [
  ["^", "начало строки"],
  ["$", "конец строки"],
  [".", "любой символ"],
  ["\\d", "цифра"],
  ["\\s", "пробел"],
  ["[абв]", "один из символов"],
  ["(…)", "группа"],
  ["|", "или"],
  ["+", "один и больше"],
  ["*", "ноль и больше"],
  ["?", "необязательно"],
  ["\\.", "точка как символ"],
];

const REGEX_HINT = (
  <div className="space-y-2">
    <div>Регулярное выражение JavaScript — ищется в любом месте значения.</div>
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
      {REGEX_TOKENS.map(([sign, meaning]) => (
        <Fragment key={sign}>
          <span className="font-mono text-accent">{sign}</span>
          <span className="text-muted">{meaning}</span>
        </Fragment>
      ))}
    </div>
    <div>
      Пример: <span className="font-mono">^(яндекс|ozon)</span> — значение
      начинается с «яндекс» или «ozon».
    </div>
  </div>
);

/** Больше этого совпадений за раз не рисуем: список на тысячи операций подвешивал
 *  бы окно на каждое нажатие клавиши в условии, а листать его никто не станет.
 *  Правило при этом применяется ко всем совпадениям, не только к показанным. */
const MATCH_LIMIT = 50;

/** Чем подписать операцию в списке совпадений: получателем, а если его нет —
 *  комментарием. У операций без получателя это единственная зацепка. */
function matchTitle(t: Transaction): string {
  const payee = displayPayee(t);
  if (payee && payee.trim()) return payee;
  return t.comment?.trim() || "—";
}

/**
 * Редактор правила категоризации — та же модалка-карточка, что у счёта и
 * категории: шапка с живым описанием правила, поля ниже, действия внизу.
 *
 * Условий и действий может быть несколько (issue #49), поэтому окно построено
 * как два списка со своими кнопками добавления, а не как набор фиксированных
 * полей. Счётчик совпадений считается прямо во время набора тем же движком,
 * что применяет правила, — правило видно «в деле» ещё до сохранения.
 */
export function RuleEditModal({
  rule,
  transactions,
  categories,
  payees,
  accounts,
  accountGroups,
  onClose,
  onSave,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [showMatches, setShowMatches] = useState(false);

  /**
   * Категории для каскадного пикера: верхний уровень — родители, справа их
   * подкатегории. Тот же компонент, что в окне правки операции, — иначе выбор
   * категории в правилах выглядел бы иначе, чем везде.
   */
  const categoryNodes = useMemo<CategoryNode[]>(() => {
    const subs = new Map<string, Set<string>>();
    for (const full of categories) {
      // Разделитель тот же, что разбирает `splitCategoryFull`.
      const parts = full.split(/\s*\/\s*/).filter(Boolean);
      const parent = parts[0];
      if (!parent) continue;
      const rest = parts.slice(1).join(" / ");
      const bucket = subs.get(parent) ?? new Set<string>();
      if (rest) bucket.add(rest);
      subs.set(parent, bucket);
    }
    return [...subs.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "ru"))
      .map(([name, set]) => ({
        name,
        subs: [...set].sort((x, y) => x.localeCompare(y, "ru")),
      }));
  }, [categories]);
  const [draft, setDraft] = useState<RuleDraft>(() =>
    rule
      ? {
          enabled: rule.enabled,
          title: rule.title ?? "",
          // Ключи строк проставляем при открытии: в хранилище их может не быть,
          // а списку нужен стабильный key, иначе React путает строки при удалении.
          conditions: (rule.conditions.length ? rule.conditions : [newCondition()]).map(
            (c) => ({ ...c, id: c.id ?? nextId() })
          ),
          join: rule.join,
          actions: (rule.actions.length ? rule.actions : [newAction()]).map((a) => ({
            ...a,
            id: a.id ?? nextId(),
          })),
        }
      : EMPTY
  );

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function patchCondition(id: string, patch: Partial<RuleCondition>) {
    setDraft((d) => ({
      ...d,
      conditions: d.conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  }

  function patchAction(id: string, patch: Partial<RuleAction>) {
    setDraft((d) => ({
      ...d,
      actions: d.actions.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));
  }

  /** Правило, каким оно уйдёт в движок: значения обрезаны, у операций без
   *  значения оно очищено — «не заполнено» с текстом в поле сбивало бы с толку. */
  /** Цели, которые ещё не заняты: по одному действию на поле. */
  const freeTargets = ACTION_TARGETS.filter(
    (t) => !draft.actions.some((a) => actionTarget(a.kind) === t.value)
  );

  const cleaned = useMemo<CategoryRuleV2>(
    () => ({
      id: rule?.id ?? "preview",
      enabled: draft.enabled,
      title: draft.title.trim(),
      join: draft.join,
      conditions: draft.conditions.map((c) => ({
        ...c,
        value: VALUELESS_OPS.has(c.op) ? "" : c.value.trim(),
      })),
      actions: draft.actions.map((a) => ({ ...a, value: a.value.trim() })),
      createdAt: rule?.createdAt ?? "",
    }),
    [draft, rule]
  );

  /** Условия, которые уже можно проверять: у остальных ещё не введено значение. */
  const usableConditions = useMemo(
    () => cleaned.conditions.filter((c) => VALUELESS_OPS.has(c.op) || c.value.length > 0),
    [cleaned]
  );

  /** Условия с несобирающимся выражением — подсвечиваем именно их поле, а не
   *  пишем общую строку «где-то ошибка» под формой. */
  const brokenRegex = useMemo(() => {
    const bad = new Set<string>();
    for (const c of cleaned.conditions) {
      if (c.op === "regex" && c.value.length > 0 && compileCondition(c) === null) {
        bad.add(c.id!);
      }
    }
    return bad;
  }, [cleaned]);
  const badRegex = brokenRegex.size > 0;

  // Совпадения считаем тем же движком, что и применение правил, — иначе
  // предпросмотр обещал бы одно, а правило делало другое. Действия здесь ни при
  // чём: счётчик отвечает на вопрос «сколько операций подойдёт под условия»,
  // и должен работать, пока действие ещё не заполнено.
  const matches = useMemo(() => {
    if (usableConditions.length === 0) return [];
    const probe: CategoryRuleV2 = { ...cleaned, conditions: usableConditions };
    const compiled = compileRuleV2(probe);
    return transactions.filter((t) => ruleMatchesV2(t, probe, compiled));
  }, [cleaned, usableConditions, transactions]);

  const count = matches.length;

  // --- Валидация. Правило без условий подошло бы ко всему подряд, правило без
  // действий ничего не делает, а действие без значения движок молча пропустит —
  // о каждом из трёх случаев пользователю надо сказать до сохранения.
  const emptyConditionValue = cleaned.conditions.some(
    (c) => !VALUELESS_OPS.has(c.op) && c.value.length === 0
  );
  const emptyActionValue = cleaned.actions.some((a) => a.value.length === 0);
  const noConditions = cleaned.conditions.length === 0;
  const noActions = cleaned.actions.length === 0;
  const canSave =
    !noConditions && !noActions && !emptyConditionValue && !emptyActionValue;

  /** Правило уже что-то значит: есть заполненное условие И заполненное действие.
   *  До этого описывать его в заголовке нечем. */
  const hasSubstance =
    usableConditions.length > 0 && cleaned.actions.some((a) => a.value.length > 0);

  /** Одна короткая причина вместо простыни красного текста: человек и так видит,
   *  что кнопка неактивна, ему нужно знать только чего не хватает. */
  const blocker = noConditions
    ? "Добавьте условие"
    : noActions
      ? "Добавьте действие"
      : emptyConditionValue
        ? "Заполните значение условия"
        : emptyActionValue
          ? "Заполните значение действия"
          : badRegex
            ? "Выражение не собирается"
            : null;

  /** Поля, которым назначено больше одного действия: движок внутри правила
   *  перезаписывает, поэтому применится последнее — и об этом надо сказать
   *  прямо на спорных строках. */

  async function save() {
    if (!canSave) return;
    await onSave({
      enabled: cleaned.enabled,
      title: draft.title.trim(),
      join: cleaned.join,
      conditions: cleaned.conditions,
      actions: cleaned.actions,
    });
    onClose();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rule-edit-title"
        className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-border bg-panel shadow-2xl outline-none"
      >
        <div className="flex items-center gap-3 px-5 py-4 bg-panel2/50 border-b border-border rounded-t-2xl shrink-0">
          <span className="w-11 h-11 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
            <Wand2 className="w-5 h-5 text-accent" />
          </span>
          <div className="min-w-0 flex-1">
            <div
              className="text-[11px] uppercase tracking-wider text-muted"
              id="rule-edit-title"
            >
              {rule ? "Правило" : "Новое правило"}
            </div>
            {/* Описание показываем, только когда правило уже что-то значит:
                на пустом бланке «Получатель содержит «»» — шум, а не подсказка. */}
            <div className="font-semibold truncate" title={hasSubstance ? describeRule(cleaned) : undefined}>
              {hasSubstance ? describeRule(cleaned) : "Условие → что изменить"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost !p-1.5 text-muted hover:text-text shrink-0"
            aria-label="Закрыть"
            title="Закрыть (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto">
          <div>
            <label className="label block mb-1" htmlFor="rule-title">
              Название <span className="font-normal normal-case">— необязательно</span>
            </label>
            <input
              id="rule-title"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder="Купоны по облигациям"
              className={FIELD}
              autoFocus
            />
          </div>

          {/* --- Условия --------------------------------------------------- */}
          <div>
            <div className="label mb-2">Если</div>

            {/* Связка И/ИЛИ стоит МЕЖДУ карточками, а не в заголовке: там она
                читалась как свойство раздела, хотя описывает стык условий.
                Слово «если» у первой строки убрано — заголовок уже сказал это. */}
            <div className="space-y-2">
              {draft.conditions.map((c, i) => (
                <Fragment key={c.id}>
                  {i > 0 && (
                    <div className="flex items-center gap-2">
                      {i === 1 ? (
                        <div
                          className="flex items-center gap-1"
                          role="group"
                          aria-label="Как объединять условия"
                        >
                          {(["and", "or"] as const).map((j) => (
                            <button
                              key={j}
                              type="button"
                              onClick={() => setDraft((d) => ({ ...d, join: j }))}
                              aria-pressed={draft.join === j}
                              title={
                                j === "and"
                                  ? "Должны выполниться все условия"
                                  : "Достаточно одного условия"
                              }
                              className={clsx(
                                "px-2 py-0.5 rounded-md text-xs font-medium border transition-colors",
                                draft.join === j
                                  ? "bg-accent/10 border-accent/40 text-accent"
                                  : "bg-panel2 border-border text-muted hover:text-text"
                              )}
                            >
                              {j === "and" ? "И" : "ИЛИ"}
                            </button>
                          ))}
                        </div>
                      ) : (
                        // Связка у правила одна на все условия, поэтому дальше
                        // она только показывается — переключатель выше меняет всё.
                        <span
                          className="px-2 text-xs font-medium text-muted"
                          title="Связка одна на все условия — меняется переключателем выше"
                        >
                          {draft.join === "and" ? "И" : "ИЛИ"}
                        </span>
                      )}
                      <span className="h-px flex-1 bg-border" aria-hidden />
                    </div>
                  )}
                  <div className="rounded-lg border border-border bg-panel2/40 p-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <Select
                        className="flex-1 min-w-0"
                        ariaLabel="Поле условия"
                        portal
                        value={c.field}
                        options={RULE_FIELDS}
                        onChange={(v) =>
                          // Значение осмысленно только внутри своего поля:
                          // название счёта в поле комментария — мусор.
                          patchCondition(c.id!, { field: v, value: "" })
                        }
                      />
                      <Select
                        className="flex-1 min-w-0"
                        ariaLabel="Условие"
                        portal
                        value={c.op}
                        options={RULE_OPS}
                        onChange={(v) => patchCondition(c.id!, { op: v })}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            conditions: d.conditions.filter((x) => x.id !== c.id),
                          }))
                        }
                        className="btn-ghost !p-1.5 text-muted hover:text-expense shrink-0"
                        title="Удалить условие"
                        aria-label="Удалить условие"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    {/* «Не заполнено» / «Заполнено» значения не требуют — поле
                        прячем, чтобы не спрашивать то, что не будет учтено. */}
                    {!VALUELESS_OPS.has(c.op) && (
                      <div className="flex items-center gap-2">
                        {/* У счёта значение — не свободный текст, а название из
                            списка: набирать его руками негде и незачем. Для
                            «содержит» и регулярных выражений поле остаётся
                            текстовым — там как раз нужен кусок строки. */}
                        {c.field === "account" && c.op === "equals" ? (
                          <div className="flex-1 min-w-0">
                            <Combobox
                              value={c.value}
                              options={accounts}
                              groups={accountGroups}
                              renderIcon={(title) => (
                                <AccountLogo title={title} size={18} />
                              )}
                              allowCustom={false}
                              searchable
                              portal
                              onChange={(v) => patchCondition(c.id!, { value: v })}
                              placeholder="Поиск счёта"
                            />
                          </div>
                        ) : (
                        <input
                          value={c.value}
                          onChange={(e) => patchCondition(c.id!, { value: e.target.value })}
                          placeholder={c.op === "regex" ? "^(яндекс|ozon)" : "магнит"}
                          className={clsx(FIELD, c.op === "regex" && "font-mono")}
                          aria-label="Значение условия"
                          aria-invalid={c.op === "regex" && brokenRegex.has(c.id!)}
                        />
                        )}
                        {c.op === "regex" && (
                          <Tooltip content={REGEX_HINT} placement="bottom">
                            <button
                              type="button"
                              className={clsx(
                                "shrink-0",
                                brokenRegex.has(c.id!)
                                  ? "text-expense"
                                  : "text-muted hover:text-accent"
                              )}
                              aria-label="Синтаксис регулярных выражений"
                            >
                              <HelpCircle className="w-4 h-4" />
                            </button>
                          </Tooltip>
                        )}
                        <label
                          className="flex items-center gap-1.5 text-xs text-muted cursor-pointer shrink-0 whitespace-nowrap"
                          title="Считать «магнит» и «МАГНИТ» одним и тем же"
                        >
                          <input
                            type="checkbox"
                            checked={c.caseInsensitive}
                            onChange={(e) =>
                              patchCondition(c.id!, { caseInsensitive: e.target.checked })
                            }
                            className="accent-accent w-4 h-4"
                          />
                          Регистр не важен
                        </label>
                      </div>
                    )}
                  </div>
                </Fragment>
              ))}
            </div>

            <button
              type="button"
              onClick={() =>
                setDraft((d) => ({ ...d, conditions: [...d.conditions, newCondition()] }))
              }
              className="btn-ghost text-xs mt-2"
            >
              <Plus className="w-3.5 h-3.5" />
              Условие
            </button>
          </div>

          {/* --- Действия -------------------------------------------------- */}
          <div>
            <div className="label mb-2">То</div>
            <div className="space-y-2">
              {draft.actions.map((a) => {
                const target = actionTarget(a.kind);
                // Цель, занятая ДРУГИМ действием, из списка убирается: одно
                // правило не может задавать одно и то же поле дважды —
                // применилось бы последнее, а человек видел бы два действия.
                const takenByOthers = new Set(
                  draft.actions.filter((x) => x.id !== a.id).map((x) => actionTarget(x.kind))
                );
                const targetOptions = ACTION_TARGETS.filter(
                  (o) => o.value === target || !takenByOthers.has(o.value)
                );
                return (
                  <div key={a.id} className="flex items-center gap-2 min-w-0">
                    <Select
                      className="w-36 shrink-0"
                      ariaLabel="Что менять"
                      portal
                      value={target}
                      options={targetOptions}
                      onChange={(v) =>
                        patchAction(a.id!, {
                          kind: DEFAULT_KIND[v],
                          // Значение осмысленно только внутри своей цели:
                          // категория в поле комментария — мусор.
                          value: "",
                        })
                      }
                    />
                    {target === "comment" && (
                      <Select
                        className="w-52 shrink-0"
                        ariaLabel="Как записать комментарий"
                        portal
                        value={a.kind}
                        options={COMMENT_MODES}
                        onChange={(v) => patchAction(a.id!, { kind: v })}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      {target === "category" ? (
                        <CategoryCascadePicker
                          category={a.value.trim() ? splitCategoryFull(a.value).category : ""}
                          subcategory={
                            a.value.trim() ? splitCategoryFull(a.value).subcategory ?? "" : ""
                          }
                          categories={categoryNodes}
                          portal
                          onChange={(cat, sub) =>
                            patchAction(a.id!, { value: joinCategoryFull(cat, sub || null) })
                          }
                        />
                      ) : target === "payee" ? (
                        <Combobox
                          value={a.value}
                          options={payees}
                          portal
                          onChange={(v) => patchAction(a.id!, { value: v })}
                          placeholder="Сбербанк"
                        />
                      ) : (
                        <input
                          value={a.value}
                          onChange={(e) => patchAction(a.id!, { value: e.target.value })}
                          placeholder={
                            a.kind === "setComment" ? "Новый комментарий" : "[купон]"
                          }
                          className={FIELD}
                          aria-label="Значение действия"
                        />
                      )}
                    </div>
                    {/* Место под значок держим всегда: иначе строка дёргалась бы
                        каждый раз, когда в поле появляется первый символ. */}
                    <span className="w-4 shrink-0 flex justify-center">
                      {NEEDS_APPLY.has(a.kind) && a.value.trim().length > 0 && (
                        <Tooltip content="Появится в операциях только после кнопки «Применить правила»">
                          <button
                            type="button"
                            className="text-muted"
                            aria-label="Применяется не сразу"
                          >
                            <Clock className="w-4 h-4" />
                          </button>
                        </Tooltip>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          actions: d.actions.filter((x) => x.id !== a.id),
                        }))
                      }
                      className="btn-ghost !p-1.5 text-muted hover:text-expense shrink-0"
                      title="Удалить действие"
                      aria-label="Удалить действие"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              disabled={freeTargets.length === 0}
              onClick={() =>
                setDraft((d) => {
                  const used = new Set(d.actions.map((x) => actionTarget(x.kind)));
                  const next = ACTION_TARGETS.find((t) => !used.has(t.value));
                  if (!next) return d;
                  return {
                    ...d,
                    actions: [
                      ...d.actions,
                      { id: nextId(), kind: DEFAULT_KIND[next.value], value: "" },
                    ],
                  };
                })
              }
              className="btn-ghost text-xs mt-2 disabled:opacity-40 disabled:cursor-not-allowed"
              title={
                freeTargets.length === 0
                  ? "Все поля уже заданы: категория, получатель и комментарий"
                  : "Добавить действие"
              }
            >
              <Plus className="w-3.5 h-3.5" />
              Действие
            </button>

          </div>

          {/* Живой счётчик: правило видно «в деле» ещё до сохранения. Список
              раскрывается тут же — уходить из окна, чтобы посмотреть, что
              зацепило правило, значит потерять недописанное условие. */}
          <div className="rounded-lg border border-border bg-panel2/50">
            <div className="px-3 py-2 flex items-center gap-3">
              <div className="text-sm min-w-0 flex-1">
                {usableConditions.length === 0 ? (
                  <span className="text-muted">Заполните условие — покажу совпадения</span>
                ) : count > 0 ? (
                  <>
                    Подойдёт <strong className="tabular-nums">{formatNum(count)}</strong>{" "}
                    {pluralRu(count, ["операция", "операции", "операций"])}
                  </>
                ) : (
                  <span className="text-muted">Совпадений нет</span>
                )}
              </div>
              {count > 0 && (
                <button
                  type="button"
                  onClick={() => setShowMatches((v) => !v)}
                  className="btn-ghost text-xs shrink-0"
                  aria-expanded={showMatches}
                  aria-controls="rule-matches"
                >
                  <ChevronDown
                    className={clsx(
                      "w-3.5 h-3.5 transition-transform",
                      showMatches && "rotate-180"
                    )}
                    aria-hidden
                  />
                  {showMatches ? "Скрыть" : "Показать"}
                </button>
              )}
            </div>

            {showMatches && count > 0 && (
              <div
                id="rule-matches"
                className="border-t border-border max-h-60 overflow-y-auto px-3 py-2 space-y-1"
              >
                {matches.slice(0, MATCH_LIMIT).map((t) => (
                  <div key={t.id} className="flex items-center gap-2.5 text-sm">
                    <CategoryDot category={t.category} size="w-6 h-6" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{matchTitle(t)}</div>
                      <div className="text-xs text-muted truncate">
                        {formatDate(t.date)} · {t.category || "Без категории"}
                      </div>
                    </div>
                    <div
                      className={clsx(
                        "shrink-0 tabular-nums whitespace-nowrap",
                        t.kind === "income" ? "text-income" : "text-text"
                      )}
                    >
                      {formatMoney(t.amount, t.currency)}
                    </div>
                  </div>
                ))}
                {count > MATCH_LIMIT && (
                  <div className="text-xs text-muted pt-1">
                    Показаны первые {MATCH_LIMIT} из {formatNum(count)} — правило
                    применится ко всем.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border shrink-0">
          {blocker && (
            <span className="text-xs text-muted mr-auto">{blocker}</span>
          )}
          <button type="button" onClick={onClose} className="btn-ghost text-sm">
            Отмена
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="btn-primary text-sm"
          >
            {rule ? "Сохранить" : "Создать"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
