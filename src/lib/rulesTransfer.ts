/**
 * Правила файлом: выгрузка в JSON и разбор такого файла обратно.
 *
 * Файл приходит откуда угодно — со второго устройства, от другого человека,
 * из старой версии, руками поправленный. Поэтому разбор строгий и поштучный:
 * правило с непонятным условием или действием отбрасывается ЦЕЛИКОМ, а не по
 * частям. Выкинь из правила одно условие — и оно начнёт ловить больше
 * операций, чем задумывалось; выкинь действие — будет молча делать не то.
 *
 * Кроме своего файла понимаем голый массив правил и полный бэкап
 * DzenAnalytics — правила лежат в нём под ключом `categoryRules`.
 * Правила первого поколения (одно условие и категория) разворачиваются в
 * нынешнюю форму тем же `migrateRule`, что и при чтении с диска.
 */

import {
  NUMERIC_FIELDS,
  migrateRule,
  opsForField,
  type CategoryRuleV2,
  type ConditionJoin,
  type RuleAction,
  type RuleActionKind,
  type RuleCondition,
  type RuleConditionGroup,
  type RuleField,
  KIND_VALUE_LABELS,
  isSetKindValue,
} from "./ruleEngine";
import type { RuleSchedule, ScheduleDepth, ScheduleEvery } from "./ruleSchedule";
import { ruleModeFields, ruleModeOf, type RuleMode } from "./ruleMode";

export const RULES_FILE_APP = "dzenanalytics";
export const RULES_FILE_TYPE = "rules";
export const RULES_FILE_VERSION = 1;
/** Больше — это уже не файл правил: не читаем, чтобы не повесить вкладку. */
export const RULES_FILE_MAX_BYTES = 5 * 1024 * 1024;

export interface RulesFile {
  app: typeof RULES_FILE_APP;
  type: typeof RULES_FILE_TYPE;
  v: number;
  exportedAt: string;
  rules: CategoryRuleV2[];
}

export function buildRulesFile(rules: readonly CategoryRuleV2[], now: Date): RulesFile {
  return {
    app: RULES_FILE_APP,
    type: RULES_FILE_TYPE,
    v: RULES_FILE_VERSION,
    exportedAt: now.toISOString(),
    rules: rules.map((r) => structuredClone(r)),
  };
}

export function rulesFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `dzenanalytics-rules-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

export type RulesFileParse =
  | { ok: true; rules: CategoryRuleV2[]; invalid: number }
  | { ok: false; error: string };

const FIELDS: ReadonlySet<string> = new Set<RuleField>([
  "payee",
  "comment",
  "category",
  "account",
  "amount",
  "kind",
]);
const ACTION_KINDS: ReadonlySet<string> = new Set<RuleActionKind>([
  "setCategory",
  "setPayee",
  "setComment",
  "prependComment",
  "appendComment",
  "setKind",
  "setTransfer",
]);
const EVERY: ReadonlySet<string> = new Set<ScheduleEvery>(["minute", "hour", "day", "month"]);
const DEPTH: ReadonlySet<string> = new Set<ScheduleDepth>(["day", "month", "year", "all"]);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const optString = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : undefined;
const join = (v: unknown): ConditionJoin => (v === "or" ? "or" : "and");

function condition(raw: unknown): RuleCondition | null {
  if (!isObj(raw) || typeof raw.field !== "string" || !FIELDS.has(raw.field)) return null;
  const field = raw.field as RuleField;
  const op = raw.op;
  if (typeof op !== "string" || !opsForField(field).includes(op as RuleCondition["op"])) {
    return null;
  }
  // Число в значении суммы — обычная ручная правка файла; остальное не угадываем.
  const value =
    typeof raw.value === "string"
      ? raw.value
      : typeof raw.value === "number" && Number.isFinite(raw.value) && NUMERIC_FIELDS.has(field)
        ? String(raw.value)
        : raw.value == null && (op === "empty" || op === "not_empty")
          ? ""
          : null;
  if (value === null) return null;
  // Тип — только из известного списка: иначе условие не совпадёт ни с чем, а
  // человек не поймёт почему.
  if (field === "kind" && !(value in KIND_VALUE_LABELS)) return null;
  const refId = optString(raw.refId);
  return {
    field,
    op: op as RuleCondition["op"],
    value,
    caseInsensitive: typeof raw.caseInsensitive === "boolean" ? raw.caseInsensitive : true,
    ...(refId ? { refId } : {}),
  };
}

function action(raw: unknown): RuleAction | null {
  if (!isObj(raw) || typeof raw.kind !== "string" || !ACTION_KINDS.has(raw.kind)) return null;
  if (typeof raw.value !== "string") return null;
  if (raw.kind === "setKind" && !isSetKindValue(raw.value)) return null;
  const refId = optString(raw.refId);
  return {
    kind: raw.kind as RuleActionKind,
    value: raw.value,
    ...(typeof raw.separator === "string" ? { separator: raw.separator } : {}),
    ...(refId ? { refId } : {}),
  };
}

const positiveInt = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : undefined;

/** Непонятное расписание не портит правило: без него автоприменение трогает лишь новые операции. */
function schedule(raw: unknown): RuleSchedule | undefined {
  if (!isObj(raw)) return undefined;
  if (typeof raw.every !== "string" || !EVERY.has(raw.every)) return undefined;
  if (typeof raw.depth !== "string" || !DEPTH.has(raw.depth)) return undefined;
  const everyN = positiveInt(raw.everyN);
  const depthN = positiveInt(raw.depthN);
  return {
    every: raw.every as ScheduleEvery,
    depth: raw.depth as ScheduleDepth,
    ...(everyN ? { everyN } : {}),
    ...(depthN ? { depthN } : {}),
  };
}

function all<T>(list: unknown, one: (raw: unknown) => T | null): T[] | null {
  if (!Array.isArray(list)) return null;
  const out: T[] = [];
  for (const raw of list) {
    const item = one(raw);
    if (!item) return null;
    out.push(item);
  }
  return out;
}

/**
 * Одно правило из файла или `null`, если в нём есть что-то непонятное.
 * `id` сохраняется как был (пустая строка — не было): решать, брать ли его,
 * будет импорт — по тому, что уже лежит в хранилище.
 */
export function sanitizeImportedRule(raw: unknown): CategoryRuleV2 | null {
  if (!isObj(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id : "";
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : "";
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : true;

  const hasV2 = Array.isArray(raw.groups) || Array.isArray(raw.conditions) || Array.isArray(raw.actions);
  if (!hasV2) {
    // Первое поколение: одно условие и категория.
    const c = condition({ ...raw, op: raw.op ?? "contains" });
    if (!c || typeof raw.category !== "string" || !raw.category) return null;
    return migrateRule({
      id,
      enabled,
      field: c.field,
      op: c.op,
      value: c.value,
      caseInsensitive: c.caseInsensitive,
      category: raw.category,
      createdAt,
    });
  }

  let groups: RuleConditionGroup[] | null;
  if (Array.isArray(raw.groups)) {
    groups = all(raw.groups, (g) => {
      if (!isObj(g)) return null;
      const conditions = all(g.conditions ?? [], condition);
      return conditions ? { join: join(g.join), conditions } : null;
    });
  } else {
    const conditions = all(raw.conditions ?? [], condition);
    groups = conditions ? [{ join: join(raw.join), conditions }] : null;
  }
  const actions = all(raw.actions ?? [], action);
  if (!groups || !actions) return null;

  const title = typeof raw.title === "string" ? raw.title : undefined;
  const sched = schedule(raw.schedule);
  return {
    id,
    enabled,
    ...(title !== undefined ? { title } : {}),
    groups,
    join: Array.isArray(raw.groups) ? join(raw.join) : "and",
    actions,
    ...(raw.autoApply === true ? { autoApply: true } : {}),
    ...(sched ? { schedule: sched } : {}),
    createdAt,
  };
}

/** Где в разобранном JSON лежит список правил. */
function rulesList(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (!isObj(data)) return null;
  if (data.app === RULES_FILE_APP && data.type === RULES_FILE_TYPE && Array.isArray(data.rules)) {
    return data.rules;
  }
  // Полный бэкап DzenAnalytics.
  if ("version" in data && "exportedAt" in data) {
    return Array.isArray(data.categoryRules) ? data.categoryRules : [];
  }
  return null;
}

export function parseRulesFile(text: string): RulesFileParse {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "Это не JSON — файл повреждён или другого формата." };
  }
  if (isObj(data) && typeof data.v === "number" && data.v > RULES_FILE_VERSION && data.app === RULES_FILE_APP) {
    return { ok: false, error: "Файл из более новой версии DzenAnalytics — обновите страницу." };
  }
  const list = rulesList(data);
  if (!list) return { ok: false, error: "В файле не нашлось правил DzenAnalytics." };
  const rules: CategoryRuleV2[] = [];
  let invalid = 0;
  for (const raw of list) {
    const rule = sanitizeImportedRule(raw);
    if (rule) rules.push(rule);
    else invalid++;
  }
  if (rules.length === 0 && invalid === 0) {
    return { ok: false, error: "Файл правильный, но правил в нём нет." };
  }
  return { ok: true, rules, invalid };
}

/**
 * Режим правил при переносе: как было или один для всех.
 *
 * Файл для другого человека удобно выгрузить «по кнопке»: его правила не
 * начнут сами переписывать чужие операции при первой же синхронизации. Тот же
 * выбор есть при импорте — файл мог прийти от кого угодно.
 */
export type RuleModeOverride = "keep" | RuleMode;

/** Варианты выбора режима в мастерах экспорта и импорта. */
export const MODE_OVERRIDE_OPTIONS: { value: RuleModeOverride; label: string }[] = [
  { value: "keep", label: "Как в правилах" },
  { value: "manual", label: "По кнопке" },
  { value: "off", label: "Выключены" },
];

export function withRuleMode<R extends CategoryRuleV2>(rules: readonly R[], mode: RuleModeOverride): R[] {
  if (mode === "keep") return [...rules];
  return rules.map((r) => (ruleModeOf(r) === mode ? r : { ...r, ...ruleModeFields(mode) }));
}

/** Сколько правил в каждом режиме — для сводки мастера. */
export function countRuleModes(rules: readonly CategoryRuleV2[]): Record<RuleMode, number> {
  const out: Record<RuleMode, number> = { off: 0, manual: 0, auto: 0 };
  for (const r of rules) out[ruleModeOf(r)]++;
  return out;
}
