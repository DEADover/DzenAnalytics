/**
 * Движок правил категоризации второго поколения (issue #49).
 *
 * ЭТО ШОВ между движком и интерфейсом: типы и сигнатуры здесь фиксированы,
 * чтобы обе стороны можно было делать независимо.
 *
 * Чем отличается от первой версии:
 *   • несколько условий, объединённых И / ИЛИ (было ровно одно);
 *   • условия «не заполнено» / «заполнено» — ради случая «получателя нет и
 *     категории нет, но в комментарии написано, что это купон по облигации»;
 *   • действий тоже несколько, и они меняют не только категорию, но и
 *     получателя с комментарием (заменить / дописать в начало / в конец).
 *
 * Правила первого поколения читаются как есть: `migrateRule` разворачивает их
 * в новую форму, ничего не теряя. Хранилище может содержать смесь — в IndexedDB
 * у людей лежат правила, созданные прошлыми версиями приложения.
 *
 * ГДЕ ЧТО ПРИМЕНЯЕТСЯ. Правила живут в двух слоях, и это не случайность:
 *
 *   1. Категория применяется в слое операций (`applyRulesV2`) — она обратима
 *      сама по себе, потому что исходную кладёт импорт в `categoryFullOriginal`.
 *      Выключил правило — категория вернулась, без всякой «отмены».
 *   2. Получатель и комментарий применяются ТОЛЬКО через слой правок
 *      (`previewRules` → `buildRulePlan` → «Применить правила»). Откатывать их
 *      в слое операций не во что: `payeeOriginal` — это текст банка ДО
 *      группировки получателей, а исходного комментария не хранит никто.
 *      Поэтому обратимость обеспечивает снятие правки, а не выключение правила.
 *
 * Такое разделение честнее ещё и потому, что получатель с комментарием всё
 * равно обязаны уехать в облако (issue #51), а туда уезжает только слой правок.
 */

import type { Transaction } from "../types";
import type { TransactionEdit } from "../store/useEditsStore";
import type { CategoryRule as CategoryRuleV1, RuleField } from "../store/useCategoryRulesStore";
import { safeCompileRegex, safeTest } from "./safeRegex";
import { NO_CATEGORY } from "./zenmoneyMap";

export type { RuleField };

export const FIELD_LABELS: Record<RuleField, string> = {
  payee: "Получатель",
  comment: "Комментарий",
  category: "Текущая категория",
  account: "Счёт",
};

/** Условие проверки. `empty`/`not_empty` значения не требуют. */
export type ConditionOp =
  | "contains"
  | "not_contains"
  | "equals"
  | "starts_with"
  | "regex"
  | "empty"
  | "not_empty";

export const CONDITION_OP_LABELS: Record<ConditionOp, string> = {
  contains: "содержит",
  not_contains: "не содержит",
  equals: "равно",
  starts_with: "начинается с",
  regex: "регулярное выражение",
  empty: "не заполнено",
  not_empty: "заполнено",
};

/** Операции, которым значение не нужно, — у них поле ввода прячется. */
export const VALUELESS_OPS: ReadonlySet<ConditionOp> = new Set(["empty", "not_empty"]);

export interface RuleCondition {
  /** Ключ для списка в интерфейсе; на смысл правила не влияет. */
  id?: string;
  field: RuleField;
  op: ConditionOp;
  /** Пусто для `empty` / `not_empty`. */
  value: string;
  caseInsensitive: boolean;
}

/** Как объединяются условия правила. */
export type ConditionJoin = "and" | "or";

export type RuleActionKind =
  | "setCategory"
  | "setPayee"
  | "setComment"
  | "prependComment"
  | "appendComment";

export const ACTION_LABELS: Record<RuleActionKind, string> = {
  setCategory: "Категория",
  setPayee: "Получатель",
  setComment: "Комментарий",
  prependComment: "Дописать в начало комментария",
  appendComment: "Дописать в конец комментария",
};

/** Что вставляем между старым и дописанным текстом, если правило не задало своё. */
export const DEFAULT_SEPARATOR = " ";

export interface RuleAction {
  /** Ключ для списка в интерфейсе; на смысл правила не влияет. */
  id?: string;
  kind: RuleActionKind;
  value: string;
  /** Разделитель при дописывании в начало/конец. По умолчанию пробел; пустая
   *  строка означает «вплотную», и это осмысленный выбор, поэтому отличаем её
   *  от «не задано». */
  separator?: string;
}

/** Поле операции, которое занимает действие. Нужно, чтобы понимать, кто из
 *  правил уже высказался про это поле, — см. `collectRuleHits`. */
export type RuleTargetField = "category" | "payee" | "comment";

export const ALL_TARGET_FIELDS: readonly RuleTargetField[] = [
  "category",
  "payee",
  "comment",
];

export function actionTarget(kind: RuleActionKind): RuleTargetField {
  if (kind === "setCategory") return "category";
  if (kind === "setPayee") return "payee";
  return "comment";
}

export interface CategoryRuleV2 {
  id: string;
  enabled: boolean;
  /** Своё название. С несколькими условиями строка «если …» уже не читается. */
  title?: string;
  conditions: RuleCondition[];
  join: ConditionJoin;
  actions: RuleAction[];
  createdAt: string;
}

/** Правило любого поколения — то, что реально лежит в хранилище. */
export type StoredRule = CategoryRuleV1 | CategoryRuleV2;

export function isV2(r: StoredRule): r is CategoryRuleV2 {
  const v2 = r as CategoryRuleV2;
  return Array.isArray(v2.conditions) || Array.isArray(v2.actions);
}

/**
 * Развернуть правило первого поколения в новую форму. Правило второго
 * поколения возвращается как есть.
 *
 * К форме правила относимся недоверчиво: правила приезжают в бэкапе и читаются
 * из IndexedDB напрямую (`useDataStore` берёт их с диска, минуя хранилище), так
 * что половинчатое правило из чужого файла обязано не ронять применение, а
 * просто ничего не находить.
 */
export function migrateRule(r: StoredRule): CategoryRuleV2 {
  if (isV2(r)) {
    if (Array.isArray(r.conditions) && Array.isArray(r.actions)) return r;
    return {
      ...r,
      conditions: Array.isArray(r.conditions) ? r.conditions : [],
      actions: Array.isArray(r.actions) ? r.actions : [],
      join: r.join === "or" ? "or" : "and",
    };
  }
  return {
    id: r.id,
    enabled: r.enabled,
    conditions: [
      {
        field: r.field,
        op: r.op,
        value: r.value,
        caseInsensitive: r.caseInsensitive,
      },
    ],
    join: "and",
    actions: [{ kind: "setCategory", value: r.category }],
    createdAt: r.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Условия
// ---------------------------------------------------------------------------

/**
 * Значения операции, по которым проверяется условие.
 *
 * Именно СПИСОК, а не склеенная строка: у получателя три формы — сырой текст
 * банка, очищенное имя и бренд Дзен-мани, — и правило по бренду обязано
 * находить операцию, у которой в выписке латиница. Склейка через пробел (так
 * было в первой версии) годилась только для «содержит»: «равно Пятёрочка» на
 * строке «PYATEROCHKA 1234 Пятерочка Пятёрочка» не совпало бы никогда.
 */
export function conditionValues(t: Transaction, field: RuleField): string[] {
  switch (field) {
    case "payee":
      return [t.payeeOriginal ?? "", t.payee ?? "", t.brand ?? ""];
    case "comment":
      return [t.comment ?? ""];
    case "category":
      return [t.categoryFullOriginal || t.categoryFull || ""];
    // У перевода счёт не один: списание идёт с одного, зачисление на другой.
    // Возвращаем обе ноги, иначе условие «Счёт = Карта» не поймало бы перевод
    // НА карту — а человек его ждёт.
    case "account":
      return [t.account ?? "", t.outcomeAccount ?? "", t.incomeAccount ?? ""];
    // Поле не из нашего списка — правило приехало из чужого бэкапа или из
    // будущей версии. Проверять нечего.
    default:
      return [];
  }
}

/** Пустое ли поле по смыслу. «Без категории» — это и есть незаполненная
 *  категория, хотя текст в поле есть. */
export function isBlankField(raw: string, field: RuleField): boolean {
  const v = raw.trim();
  if (!v) return true;
  return field === "category" && v === NO_CATEGORY;
}

/**
 * Кэш собранных выражений.
 *
 * Правило проверяется по каждой операции, а операций десятки тысяч. Собирать
 * RegExp заново (да ещё и прогонять проверку на ReDoS) на каждую — заметная
 * работа впустую. Ключ — сам текст выражения с флагами, поэтому кэш переживает
 * пересоздание объекта правила при любой правке в интерфейсе.
 *
 * Флага `g` мы не ставим, так что общий на всех RegExp состояния не хранит.
 */
const regexCache = new Map<string, RegExp | null>();
const REGEX_CACHE_LIMIT = 500;

function cachedRegex(src: string, flags: string): RegExp | null {
  const key = `${flags} ${src}`;
  if (regexCache.has(key)) return regexCache.get(key) ?? null;
  const re = safeCompileRegex(src, flags);
  // Кэш нужен в пределах прохода по операциям; расти без конца ему незачем —
  // на переполнении просто начинаем заново.
  if (regexCache.size >= REGEX_CACHE_LIMIT) regexCache.clear();
  regexCache.set(key, re);
  return re;
}

/**
 * Собрать регулярное выражение условия — через `safeCompileRegex`, а не через
 * голый `new RegExp`: правила ездят в бэкапе, и чужой бэкап с `(a+)+$` иначе
 * подвешивал бы вкладку насмерть. Небезопасное или битое выражение даёт `null`,
 * что движок считает «не совпало».
 */
export function compileCondition(c: RuleCondition): RegExp | null {
  if (c.op !== "regex") return null;
  return cachedRegex(c.value, c.caseInsensitive ? "iu" : "u");
}

/** Собрать выражения всех условий правила разом — по индексу условия. */
export function compileRuleV2(rule: CategoryRuleV2): Map<number, RegExp | null> {
  const out = new Map<number, RegExp | null>();
  rule.conditions.forEach((c, i) => {
    if (c.op === "regex") out.set(i, compileCondition(c));
  });
  return out;
}

/**
 * Проверка одного условия.
 *
 * `compiled` — заранее собранное регулярное выражение (см. `compileRuleV2`);
 * без него движок возьмёт своё из кэша.
 */
export function conditionMatches(
  t: Transaction,
  c: RuleCondition,
  compiled?: RegExp | null
): boolean {
  const values = conditionValues(t, c.field);
  // Неизвестное поле не выполняется ни при какой операции — в том числе при
  // «не заполнено», где `every` по пустому списку дал бы «да».
  if (values.length === 0) return false;

  // «Не заполнено» — про операцию целиком: пусты должны быть ВСЕ формы поля.
  if (c.op === "empty") return values.every((v) => isBlankField(v, c.field));
  if (c.op === "not_empty") return values.some((v) => !isBlankField(v, c.field));

  if (c.op === "regex") {
    const re = compiled !== undefined ? compiled : compileCondition(c);
    return re ? values.some((v) => safeTest(re, v)) : false;
  }

  const norm = (v: string) => (c.caseInsensitive ? v.toLowerCase() : v);
  const needle = norm(c.value);
  switch (c.op) {
    case "contains":
      return values.some((v) => norm(v).includes(needle));
    // Отрицание тоже про операцию целиком: «не содержит» значит «ни в одной из
    // форм поля». Иначе правило срабатывало бы на пустом бренде у операции,
    // где нужное слово стоит в тексте банка.
    case "not_contains":
      return values.every((v) => !norm(v).includes(needle));
    case "equals":
      return values.some((v) => norm(v) === needle);
    case "starts_with":
      return values.some((v) => norm(v).startsWith(needle));
  }
  return false;
}

/** Подходит ли операция под правило целиком (И / ИЛИ по условиям). */
export function ruleMatchesV2(
  t: Transaction,
  rule: CategoryRuleV2,
  compiled?: Map<number, RegExp | null>
): boolean {
  // Правило без условий подошло бы ко всему подряд — это не «применить ко
  // всем», а недописанное правило.
  if (rule.conditions.length === 0) return false;
  const test = (c: RuleCondition, i: number) =>
    conditionMatches(t, c, compiled?.get(i));
  // Всё, что не «ИЛИ», считаем «И»: более строгий вариант — безопасный ответ на
  // мусор в поле.
  return rule.join === "or"
    ? rule.conditions.some(test)
    : rule.conditions.every(test);
}

/** Есть ли у правила хоть одно действие, которое что-то делает. Правило с
 *  пустыми действиями не должно занимать поле у следующих правил: недописанное
 *  правило молча выключило бы всё, что под ним. */
export function ruleHasEffect(rule: CategoryRuleV2): boolean {
  return rule.actions.some((a) => (a.value ?? "").trim().length > 0);
}

// ---------------------------------------------------------------------------
// Действия
// ---------------------------------------------------------------------------

/**
 * Во что правило превращает операцию — готовая правка для слоя правок.
 * Возвращает пустой объект, если менять нечего.
 *
 * `taken` — поля, про которые уже высказалось предыдущее правило: их это
 * правило не трогает (см. `collectRuleHits`).
 *
 * Внутри одного правила действия применяются по порядку и накопительно:
 * «дописать в конец» после «заменить» допишет к новому тексту, а не к старому.
 *
 * Получатель пишется в `brand`, а не в `payee`. В интерфейсе поле называется
 * «Получатель», но показывается (`displayPayee`) и отправляется в Дзен-мани
 * именно бренд; правка `payee` на операции с брендом не была бы видна вообще.
 */
export function ruleActionsToEdit(
  t: Transaction,
  rule: CategoryRuleV2,
  taken?: ReadonlySet<RuleTargetField>
): TransactionEdit {
  const patch: TransactionEdit = {};
  for (const a of rule.actions) {
    if (taken?.has(actionTarget(a.kind))) continue;
    const value = (a.value ?? "").trim();
    // Пустое значение — это незаполненная форма, а не команда «очисти поле».
    // Пустой бренд обнулил бы в облаке и merchant, и payee, поэтому такое
    // действие должно называться отдельно, а не получаться по недосмотру.
    if (!value) continue;
    switch (a.kind) {
      case "setCategory": {
        const { category, subcategory } = splitCategoryFull(value);
        patch.category = category;
        patch.subcategory = subcategory;
        patch.categoryFull = joinCategoryFull(category, subcategory);
        break;
      }
      case "setPayee":
        patch.brand = value;
        break;
      case "setComment":
        patch.comment = value;
        break;
      case "prependComment": {
        const cur = patch.comment ?? t.comment ?? "";
        // Приписка уже на месте — второй раз не дублируем. Правила
        // пересчитываются на каждый чих (включение, перемещение, синхронизация),
        // а комментарий, однажды уехавший в облако, возвращается уже с
        // припиской: без этой проверки получилось бы «Купон Купон Купон».
        if (cur.startsWith(value)) break;
        patch.comment = cur ? `${value}${a.separator ?? DEFAULT_SEPARATOR}${cur}` : value;
        break;
      }
      case "appendComment": {
        const cur = patch.comment ?? t.comment ?? "";
        if (cur.endsWith(value)) break;
        patch.comment = cur ? `${cur}${a.separator ?? DEFAULT_SEPARATOR}${value}` : value;
        break;
      }
    }
  }
  return patch;
}

/** «Еда / Кафе» → категория и подкатегория. */
export function splitCategoryFull(full: string): {
  category: string;
  subcategory: string | null;
} {
  const v = full.trim();
  if (!v) return { category: NO_CATEGORY, subcategory: null };
  const parts = v.split(/\s*\/\s*/).filter((p) => p.length > 0);
  return {
    category: parts[0] ?? NO_CATEGORY,
    subcategory: parts.slice(1).join(" / ") || null,
  };
}

/** Обратная сборка — с теми же пробелами вокруг «/», что и везде в приложении,
 *  иначе «Еда/Кафе» из правила и «Еда / Кафе» из Дзен-мани выглядели бы разными
 *  категориями в отчётах. */
export function joinCategoryFull(category: string, subcategory: string | null): string {
  return subcategory ? `${category} / ${subcategory}` : category;
}

// ---------------------------------------------------------------------------
// Применение
// ---------------------------------------------------------------------------

/** Что одно правило сделает с одной операцией. Основа для «Проверить правила»
 *  и «Применить правила»: галочка на правиле, галочка на операции. */
export interface RuleHit {
  txId: string;
  ruleId: string;
  patch: TransactionEdit;
}

/**
 * Собрать вклад каждого правила в одну операцию.
 *
 * Порядок правил важен, но «первое подошедшее правило целиком» — неверная
 * семантика для нескольких действий: правило «дописать комментарий» заблокировало
 * бы следующее «поставить категорию». Поэтому занимается ПОЛЕ: первое правило,
 * высказавшееся про категорию, забирает категорию; про комментарий —
 * комментарий; остальные поля достаются следующим правилам.
 */
export function collectRuleHits(
  t: Transaction,
  rules: CategoryRuleV2[],
  compiled?: Map<string, Map<number, RegExp | null>>
): RuleHit[] {
  const hits: RuleHit[] = [];
  const taken = new Set<RuleTargetField>();
  for (const rule of rules) {
    // Все три поля заняты — дальше по списку смотреть незачем.
    if (taken.size === ALL_TARGET_FIELDS.length) break;
    if (!ruleMatchesV2(t, rule, compiled?.get(rule.id))) continue;
    const patch = ruleActionsToEdit(t, rule, taken);
    if (Object.keys(patch).length === 0) continue;
    if (patch.categoryFull !== undefined) taken.add("category");
    if (patch.brand !== undefined) taken.add("payee");
    if (patch.comment !== undefined) taken.add("comment");
    hits.push({ txId: t.id, ruleId: rule.id, patch });
  }
  return hits;
}

/**
 * Отобрать правила, которые вообще могут сработать, и собрать их выражения.
 *
 * `requireEnabled` снимается там, где правила выбрал человек: отметил галочкой —
 * значит хочет посмотреть именно это правило, даже если оно пока выключено.
 */
function prepare(
  rules: StoredRule[],
  requireEnabled = true
): {
  active: CategoryRuleV2[];
  compiled: Map<string, Map<number, RegExp | null>>;
} {
  const active = rules
    .map(migrateRule)
    .filter(
      (r) => (!requireEnabled || r.enabled) && r.conditions.length > 0 && ruleHasEffect(r)
    );
  const compiled = new Map<string, Map<number, RegExp | null>>();
  for (const r of active) compiled.set(r.id, compileRuleV2(r));
  return { active, compiled };
}

/** Вернуть категорию к той, что пришла из Дзен-мани. И применение, и
 *  предпросмотр считают условия от исходной категории — иначе однажды
 *  сработавшее правило перестало бы совпадать с самим собой. */
function withOriginalCategory(t: Transaction): Transaction {
  return {
    ...t,
    category: t.categoryOriginal ?? t.category,
    subcategory:
      t.subcategoryOriginal !== undefined ? t.subcategoryOriginal : t.subcategory,
    categoryFull: t.categoryFullOriginal ?? t.categoryFull,
  };
}

/**
 * Слой операций: применить обратимую часть правил — категорию.
 *
 * Сначала операция откатывается к исходной категории (`categoryFullOriginal` от
 * импорта), потом применяется первое правило, высказавшееся про категорию.
 * Поэтому выключение или удаление правила возвращает всё как было.
 *
 * Получатель и комментарий здесь НЕ применяются — см. шапку файла.
 */
export function applyRulesV2(txs: Transaction[], rules: StoredRule[]): Transaction[] {
  const { active, compiled } = prepare(rules);
  const withCategory = active.filter((r) =>
    r.actions.some((a) => a.kind === "setCategory" && (a.value ?? "").trim())
  );

  return txs.map((t) => {
    const restored = withOriginalCategory(t);
    for (const rule of withCategory) {
      if (!ruleMatchesV2(restored, rule, compiled.get(rule.id))) continue;
      const patch = ruleActionsToEdit(restored, rule);
      if (patch.categoryFull === undefined || patch.category === undefined) continue;
      return {
        ...restored,
        category: patch.category,
        subcategory: patch.subcategory ?? null,
        categoryFull: patch.categoryFull,
      };
    }
    return restored;
  });
}

/**
 * Что правила сделают с набором операций — без применения.
 *
 * Кормить нужно `transactionsRaw` (правила применены, правки — ещё нет): там
 * получатель, бренд и комментарий такие, какими пришли из Дзен-мани. Категорию
 * функция сама возвращает к исходной, иначе уже применённое правило показывало
 * бы ноль совпадений — на этих граблях первая версия уже стояла.
 *
 * `onlyRuleIds` — считать только по выбранным правилам (галочки на экране
 * «Правила»). Порядок и захват полей при этом считаются по выбранным: правило,
 * которое пользователь не отметил, ничего не занимает. Отмеченное правило
 * показывается даже выключенным — раз выбрали, значит хотят посмотреть.
 */
export function previewRules(
  txs: Transaction[],
  rules: StoredRule[],
  onlyRuleIds?: ReadonlySet<string>
): RuleHit[] {
  const picked = onlyRuleIds ? rules.filter((r) => onlyRuleIds.has(r.id)) : rules;
  const { active, compiled } = prepare(picked, onlyRuleIds === undefined);
  if (active.length === 0) return [];

  const out: RuleHit[] = [];
  for (const t of txs) {
    out.push(...collectRuleHits(withOriginalCategory(t), active, compiled));
  }
  return out;
}

/** Слить вклады нескольких правил в одну правку операции. Ранние правила уже
 *  заняли свои поля, так что конфликтов тут нет — только сборка. */
export function mergeHits(hits: RuleHit[]): Record<string, TransactionEdit> {
  const out: Record<string, TransactionEdit> = {};
  for (const h of hits) out[h.txId] = { ...out[h.txId], ...h.patch };
  return out;
}

/** Человекочитаемое описание правила — для строки таблицы и заголовка окна. */
export function describeRule(rule: CategoryRuleV2): string {
  if (rule.title?.trim()) return rule.title.trim();
  const join = rule.join === "and" ? " И " : " ИЛИ ";
  const conds = rule.conditions
    .map((c) => {
      const f = FIELD_LABELS[c.field];
      if (VALUELESS_OPS.has(c.op)) return `${f} ${CONDITION_OP_LABELS[c.op]}`;
      // В списке операций «регулярное выражение» — название приёма, а во фразе
      // на его месте нужен предлог, иначе выходит «Получатель регулярное
      // выражение «^яндекс»».
      const op = c.op === "regex" ? "по выражению" : CONDITION_OP_LABELS[c.op];
      return `${f} ${op} «${c.value}»`;
    })
    .join(join);
  const acts = rule.actions
    .map((a) => `${ACTION_LABELS[a.kind]} = «${a.value}»`)
    .join(", ");
  return conds && acts ? `${conds} → ${acts}` : conds || acts;
}
