import { create } from "zustand";
import * as db from "../lib/db";
import { getZenCache } from "../lib/zenCacheMemo";
import { reconcileRulesRefs, refDictionaryFromCache, type RefDictionary } from "../lib/ruleRefs";
import type { Transaction } from "../types";
import {
  allConditions,
  migrateRule,
  ruleMatchesV2,
  compileCondition,
  applyRulesV2,
  describeRule,
  type CategoryRuleV2,
  type ConditionJoin,
  type ConditionOp,
  type RuleAction,
  type RuleCondition,
  type RuleConditionGroup,
  type StoredRule,
} from "../lib/ruleEngine";

export type RuleField = "payee" | "comment" | "category" | "account" | "amount" | "kind";

/**
 * Операция условия. Раньше их было четыре — теперь это тот же список, что у
 * условий второго поколения (issue #49): «не содержит», «не заполнено» и
 * «заполнено» появились там, а хранилище держит правила обоих поколений в одном
 * массиве, и разъезжаться этим спискам нельзя.
 */
export type RuleOp = ConditionOp;

/**
 * Правило ПЕРВОГО поколения — плоская форма: одно условие и одна категория.
 *
 * Собственных правил в этой форме мы больше не создаём и на диск её не пишем.
 * Но она никуда не делась: такие правила лежат в IndexedDB у людей, приезжают
 * в бэкапах и приходят из подсказок на странице «Без категории». Тип нужен
 * ровно для них — и для движка, который разворачивает такое правило в новое
 * (`migrateRule`).
 */
export interface CategoryRule {
  id: string;
  enabled: boolean;
  field: RuleField;
  op: RuleOp;
  value: string;
  caseInsensitive: boolean;
  category: string;
  createdAt: string;
}

/**
 * Правило, как оно лежит в хранилище сейчас: условия, объединение и действия.
 *
 * v1-проекции (плоские `field`/`op`/`value`/`category` рядом с условиями)
 * больше нет: два представления одного правила в одной записи — это два
 * источника истины, из которых интерфейс показывает один, а движок применяет
 * другой. Читать старую форму мы при этом продолжаем — `normalizeRule`.
 */
export type StoredCategoryRule = CategoryRuleV2;

/** Новое правило первого поколения — как его создают подсказки категорий. */
export type NewRule = Omit<CategoryRule, "id" | "createdAt">;
/**
 * Новое правило второго поколения.
 *
 * `groups` необязательны: правило можно задать и плоским списком `conditions` —
 * это форма до появления групп, и она сворачивается в одну группу. Так пишут
 * подсказки категорий и всё, что собирает правило на лету.
 */
export type NewRuleV2 = Omit<CategoryRuleV2, "id" | "createdAt" | "groups"> & {
  groups?: RuleConditionGroup[];
  conditions?: RuleCondition[];
};

interface RulesState {
  rules: StoredCategoryRule[];
  loaded: boolean;
  hydrate: () => Promise<void>;
  /**
   * Добавить правило. Возвращает его id — и когда правило создано, и когда
   * такое же уже было: вызвавшему обычно нужно тут же прогнать правило по
   * операциям, а прогонять надо и совпавшее.
   */
  add: (r: NewRule | NewRuleV2) => Promise<string>;
  /** То же пачкой: id по каждому правилу, без повторов. */
  addMany: (rs: (NewRule | NewRuleV2)[]) => Promise<string[]>;
  update: (id: string, patch: Partial<NewRuleV2>) => Promise<void>;
  /**
   * Переписать в правилах имя контрагента: старое → новое.
   *
   * Правило хранит получателя ТЕКСТОМ, а не ссылкой на запись справочника.
   * Переименовали контрагента — и правило продолжало требовать старое имя,
   * которого в справочнике уже нет: правка не приживалась, и «ждут записи»
   * висело вечно (issue #60).
   *
   * Меняем только ТОЧНЫЕ совпадения: у условий «содержит» и «регулярное
   * выражение» значение — кусок строки, и подменять его в нём нельзя.
   *
   * Возвращает число изменённых правил.
   */
  renamePayee: (from: string, to: string) => Promise<number>;
  /**
   * Свести ссылки правил со справочниками Дзен-мани: подтянуть переименованные
   * названия и проставить id там, где их ещё нет (`lib/ruleRefs`). Возвращает,
   * было ли что переписать.
   */
  reconcileRefs: (dict: RefDictionary) => Promise<boolean>;
  /**
   * Заменить правила целиком — итог слияния с облаком. Каждое проходит ту же
   * нормализацию, что и при чтении с диска: правило любого поколения и чужой
   * мусор разбираются мягко, без правила без id.
   */
  replaceAll: (raw: readonly unknown[]) => Promise<void>;
  /** То же по кэшу синхронизации; без кэша (CSV) ничего не делает. */
  reconcileRefsFromCache: () => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  move: (id: string, dir: -1 | 1) => Promise<void>;
  /** Переставить правило на место с индексом `to` (перетаскиванием). */
  reorder: (id: string, to: number) => Promise<void>;
  /**
   * Правила из файла (`lib/rulesTransfer`): добавить к своим или заменить ими
   * все. Возвращает итог — сколько записано и сколько отсеяно как дубли.
   */
  importRules: (
    incoming: readonly CategoryRuleV2[],
    mode: RulesImportMode
  ) => Promise<RulesImportPlan>;
}

export type RulesImportMode = "add" | "replace";

export interface RulesImportPlan {
  /** Список правил после импорта — ровно то, что ляжет на диск. */
  rules: StoredCategoryRule[];
  /** Сколько правил из файла вошло в список. */
  added: number;
  /** Сколько отсеяно: такое правило уже есть или повторяется в самом файле. */
  duplicates: number;
  /** Сколько из вошедших применяются сами — об этом стоит сказать до записи. */
  auto: number;
}

/** Что угодно похожее на правило: своё, из чужого бэкапа, любого поколения. */
type RuleLike = Partial<CategoryRule> &
  Partial<CategoryRuleV2> & { id: string; createdAt: string };

/**
 * Привести правило к каноническому виду второго поколения.
 *
 * Плоские поля разворачиваются в одно условие и одно действие только когда
 * условий/действий нет вовсе. Пустой массив условий (или действий) — осмысленное
 * состояние: человек удалил в редакторе всё. Поэтому «есть массив» и «массива
 * нет» различаем строго, а не через длину, иначе удалённое действие воскресало
 * бы из старых плоских полей, которые ещё лежат в том же объекте на диске.
 */
function normalizeRule(r: RuleLike): StoredCategoryRule {
  const legacyConditions = (r as { conditions?: RuleCondition[] }).conditions;
  const hasV2 =
    Array.isArray(r.groups) || Array.isArray(legacyConditions) || Array.isArray(r.actions);
  if (hasV2) {
    // Группы — единственная форма условий на диске. Правило, записанное до их
    // появления, сворачивается в одну группу со своей прежней связкой; связка
    // правила становится межгрупповой и при единственной группе ни на что не
    // влияет.
    const groups: RuleConditionGroup[] = Array.isArray(r.groups)
      ? r.groups.map((g) => ({
          join: g?.join === "or" ? "or" : "and",
          conditions: Array.isArray(g?.conditions) ? g.conditions : [],
        }))
      : [
          {
            join: r.join === "or" ? "or" : "and",
            conditions: Array.isArray(legacyConditions) ? legacyConditions : [],
          },
        ];
    return {
      id: r.id,
      enabled: r.enabled ?? true,
      createdAt: r.createdAt,
      groups,
      join: Array.isArray(r.groups) && r.join === "or" ? "or" : "and",
      actions: Array.isArray(r.actions) ? r.actions : [],
      ...(r.title !== undefined ? { title: r.title } : {}),
      // Нормализация пересобирает правило по полям, поэтому каждое новое поле
      // надо проносить здесь явно — иначе оно молча теряется при первой же
      // правке. Пишем только когда включено: у большинства правил
      // автоприменения нет, и лишний `false` в хранилище только шумит.
      ...(r.autoApply ? { autoApply: true } : {}),
      // Расписание автоприменения (issue #75). Пишем только когда задано: у
      // правила без него прежнее поведение — трогает лишь новые операции.
      ...(r.schedule ? { schedule: r.schedule } : {}),
    };
  }
  return migrateRule({
    id: r.id,
    enabled: r.enabled ?? true,
    field: r.field ?? "payee",
    op: r.op ?? "contains",
    value: r.value ?? "",
    caseInsensitive: r.caseInsensitive ?? true,
    category: r.category ?? "",
    createdAt: r.createdAt,
  });
}

/**
 * Ключ для отсева дублей. Считается по условиям и действиям, поэтому два
 * одинаковых по смыслу правила не заведутся дважды, даже если одно пришло из
 * подсказок в старой форме, а другое собрано в новой.
 */
function ruleKey(r: RuleLike): string {
  const v2 = normalizeRule(r);
  const conds = v2.groups
    .map(
      (g) =>
        `${g.join}(` +
        g.conditions
          .map((c) => {
            const v = c.caseInsensitive ? c.value.toLowerCase() : c.value;
            return `${c.field} ${c.op} ${c.caseInsensitive ? "i" : "s"} ${v}`;
          })
          .join(" & ") +
        ")"
    )
    .join(" & ");
  const acts = v2.actions.map((a) => `${a.kind}=${a.value}`).join(" & ");
  return `${v2.join} [${conds}] → [${acts}]`;
}

function makeRule(r: NewRule | NewRuleV2, salt: number): StoredCategoryRule {
  return normalizeRule({
    ...(r as Partial<CategoryRule> & Partial<CategoryRuleV2>),
    id: `${Date.now()}-${salt}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  });
}

/**
 * Что получится из импорта — без записи; этим же окно импорта считает сводку
 * до подтверждения.
 *
 * При добавлении свои правила не трогаются вовсе: новые встают в конец, а
 * совпадающие по смыслу (тот же ключ, что у `add`) пропускаются — повторный
 * импорт того же файла ничего не удваивает. id из файла берётся, только если
 * он свободен: правило, перенесённое файлом на второе устройство, при переносе
 * настроек через Дзен-мани сходится с оригиналом, а не заводит копию.
 */
export function planRulesImport(
  existing: readonly StoredCategoryRule[],
  incoming: readonly CategoryRuleV2[],
  mode: RulesImportMode,
  now: Date = new Date()
): RulesImportPlan {
  const base = mode === "add" ? existing : [];
  const keys = new Set(base.map(ruleKey));
  const ids = new Set(base.map((r) => r.id));
  const fresh: StoredCategoryRule[] = [];
  let duplicates = 0;
  let salt = 0;
  for (const raw of incoming) {
    const rule = normalizeRule({
      ...raw,
      id:
        raw.id && !ids.has(raw.id)
          ? raw.id
          : `${now.getTime()}-${salt++}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: raw.createdAt || now.toISOString(),
    });
    const key = ruleKey(rule);
    if (keys.has(key)) {
      duplicates++;
      continue;
    }
    keys.add(key);
    ids.add(rule.id);
    fresh.push(rule);
  }
  return {
    rules: [...base, ...fresh],
    added: fresh.length,
    duplicates,
    auto: fresh.filter((r) => r.autoApply).length,
  };
}

/**
 * Пометка каждого правила из файла — для списка в мастере импорта, по порядку
 * файла:
 *   • `new` — такого правила нет;
 *   • `exists` — такое же по смыслу уже есть (только при добавлении: при замене
 *     текущие правила уходят и совпадать не с чем);
 *   • `repeat` — повторяет правило выше в том же файле.
 * Ключ сравнения тот же, что у импорта и `add`, — пометка не разойдётся с
 * тем, что импорт на деле пропустит.
 */
export type RuleImportStatus = "new" | "exists" | "repeat";

export function ruleImportStatuses(
  existing: readonly StoredCategoryRule[],
  incoming: readonly CategoryRuleV2[],
  mode: RulesImportMode
): RuleImportStatus[] {
  const current = new Set(mode === "add" ? existing.map(ruleKey) : []);
  const seen = new Set<string>();
  return incoming.map((raw) => {
    const key = ruleKey(normalizeRule({ ...raw, createdAt: raw.createdAt || "" }));
    if (current.has(key)) return "exists";
    if (seen.has(key)) return "repeat";
    seen.add(key);
    return "new";
  });
}

export const useCategoryRulesStore = create<RulesState>((set, get) => ({
  rules: [],
  loaded: false,

  hydrate: async () => {
    const data = await db.loadJSON<RuleLike[]>("categoryRules");
    // В хранилище может лежать смесь поколений — разворачиваем сразу при
    // чтении, чтобы дальше по коду поколение уже не встречалось. Обратно на
    // диск не пишем: пересчёт идемпотентен, а лишняя запись при каждом старте
    // приложения ничего не даёт.
    set({ rules: (data || []).map((r) => normalizeRule(r)), loaded: true });
    await get().reconcileRefsFromCache();
  },

  replaceAll: async (raw) => {
    const list = raw
      .filter(
        (r): r is RuleLike =>
          !!r && typeof r === "object" && typeof (r as RuleLike).id === "string"
      )
      .map((r) => normalizeRule({ ...r, createdAt: r.createdAt ?? "" }));
    await db.saveJSON("categoryRules", list);
    set({ rules: list });
    await get().reconcileRefsFromCache();
  },

  reconcileRefs: async (dict) => {
    if (!get().loaded) return false;
    const { rules, changed } = reconcileRulesRefs(get().rules, dict);
    if (!changed) return false;
    await db.saveJSON("categoryRules", rules);
    set({ rules });
    return true;
  },

  reconcileRefsFromCache: async () => {
    const cache = await getZenCache().catch(() => null);
    return cache ? get().reconcileRefs(refDictionaryFromCache(cache)) : false;
  },

  add: async (r) => {
    const existing = get().rules;
    const fresh = makeRule(r, 0);
    const key = ruleKey(fresh);
    const twin = existing.find((x) => ruleKey(x) === key);
    if (twin) return twin.id;
    const list = [...existing, fresh];
    await db.saveJSON("categoryRules", list);
    set({ rules: list });
    await get().reconcileRefsFromCache();
    return fresh.id;
  },

  addMany: async (rs) => {
    if (rs.length === 0) return [];
    const existing = get().rules;
    const byKey = new Map(existing.map((x) => [ruleKey(x), x.id]));
    const fresh: StoredCategoryRule[] = [];
    const ids: string[] = [];
    let salt = 0;
    for (const r of rs) {
      const made = makeRule(r, salt++);
      const k = ruleKey(made);
      const twin = byKey.get(k);
      if (twin) {
        if (!ids.includes(twin)) ids.push(twin);
        continue;
      }
      byKey.set(k, made.id);
      ids.push(made.id);
      fresh.push(made);
    }
    if (fresh.length === 0) return ids;
    const list = [...existing, ...fresh];
    await db.saveJSON("categoryRules", list);
    set({ rules: list });
    await get().reconcileRefsFromCache();
    return ids;
  },

  renamePayee: async (from, to) => {
    const oldTitle = from.trim();
    const newTitle = to.trim();
    if (!oldTitle || !newTitle || oldTitle === newTitle) return 0;
    // Зовут отсюда со страницы «Настройки», где список правил мог ещё ни разу
    // не читаться: без этого мы прошлись бы по пустому массиву и молча ничего
    // не переименовали. Проверено вживую — именно так и получилось.
    if (!get().loaded) await get().hydrate();
    let touched = 0;
    const list = get().rules.map((r) => {
      let changed = false;
      const next = { ...r } as StoredCategoryRule;
      if (Array.isArray(next.actions)) {
        next.actions = next.actions.map((a) => {
          if (a.kind === "setPayee" && a.value === oldTitle) {
            changed = true;
            return { ...a, value: newTitle };
          }
          return a;
        });
      }
      if (Array.isArray(next.groups)) {
        next.groups = next.groups.map((g) => ({
          ...g,
          conditions: (g.conditions ?? []).map((c) => {
            if (c.field === "payee" && c.op === "equals" && c.value === oldTitle) {
              changed = true;
              return { ...c, value: newTitle };
            }
            return c;
          }),
        }));
      }
      if (!changed) return r;
      touched++;
      return next;
    });
    if (touched === 0) return 0;
    await db.saveJSON("categoryRules", list);
    set({ rules: list });
    return touched;
  },

  update: async (id, patch) => {
    // Патч в плоской форме сворачиваем в группу здесь: у правила на диске
    // группы уже есть, и нормализация предпочла бы их — плоские условия из
    // патча молча потерялись бы.
    const { conditions, ...rest } = patch;
    const next =
      conditions && !patch.groups
        ? {
            ...rest,
            groups: [
              { join: patch.join === "or" ? ("or" as const) : ("and" as const), conditions },
            ],
          }
        : rest;
    const list = get().rules.map((r) => (r.id === id ? normalizeRule({ ...r, ...next }) : r));
    await db.saveJSON("categoryRules", list);
    set({ rules: list });
    await get().reconcileRefsFromCache();
  },

  remove: async (id) => {
    const list = get().rules.filter((r) => r.id !== id);
    await db.saveJSON("categoryRules", list);
    set({ rules: list });
  },

  move: async (id, dir) => {
    const list = [...get().rules];
    const idx = list.findIndex((r) => r.id === id);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    [list[idx], list[j]] = [list[j], list[idx]];
    await db.saveJSON("categoryRules", list);
    set({ rules: list });
  },

  importRules: async (incoming, mode) => {
    if (!get().loaded) await get().hydrate();
    const plan = planRulesImport(get().rules, incoming, mode);
    // Добавлять нечего — диск не трогаем. Замена пишется всегда: «заменить на
    // пустой список» тоже осмысленный итог, но до него окно не допустит.
    if (mode === "add" && plan.added === 0) return plan;
    await db.saveJSON("categoryRules", plan.rules);
    set({ rules: plan.rules });
    await get().reconcileRefsFromCache();
    return plan;
  },

  // Перетаскивание вынимает правило и вставляет на новое место, а не меняет
  // местами с соседом: при переносе через десяток строк обмен местами дал бы
  // совсем другой порядок.
  reorder: async (id, to) => {
    const list = [...get().rules];
    const from = list.findIndex((r) => r.id === id);
    if (from < 0) return;
    const target = Math.max(0, Math.min(list.length - 1, to));
    if (from === target) return;
    const [moved] = list.splice(from, 1);
    list.splice(target, 0, moved);
    await db.saveJSON("categoryRules", list);
    set({ rules: list });
  },
}));

/** Скомпилировать regex первого условия правила (с защитой от ReDoS).
 *  Не-regex условию вернёт null. У правила может быть несколько выражений —
 *  тогда движок соберёт их сам (они кэшируются по тексту, так что это не
 *  дороже). */
export function compileRule(r: StoredRule): RegExp | null {
  const first = allConditions(migrateRule(r))[0];
  return first ? compileCondition(first) : null;
}

/**
 * Подходит ли операция под условия правила — БЕЗ учёта того, включено оно или
 * нет. Ровно эта функция стоит и за применением правил, и за предпросмотром:
 * раньше предпросмотр имел свою копию логики и искал только по `payeeOriginal`,
 * пропуская совпадения по бренду, — и показывал меньше, чем правило реально
 * меняло.
 */
export function ruleMatches(
  t: Transaction,
  r: StoredRule,
  compiledRegex?: RegExp | null
): boolean {
  const v2 = migrateRule(r);
  // Готовое выражение имеет смысл только для правила с единственным условием —
  // у остальных движок берёт своё из кэша.
  const compiled =
    compiledRegex !== undefined && allConditions(v2).length === 1
      ? new Map([[0, compiledRegex]])
      : undefined;
  return ruleMatchesV2(t, v2, compiled);
}

/** Человекочитаемое описание правила — для строки таблицы и заголовка окна. */
export function describeCategoryRule(r: StoredRule): string {
  return describeRule(migrateRule(r));
}

/**
 * Применить правила ко всему набору операций — в слое операций (только
 * категория).
 *
 * ⚠️ В конвейере данных НЕ используется: автоприменение убрано, теперь все три
 * поля меняются одинаково — кнопкой «Проверить и применить» и только у
 * отмеченных операций (issue #62). Оставлено вместе с тестами под будущее
 * управляемое автоприменение; подробности в шапке `ruleEngine.ts`.
 */
export function applyCategoryRules(
  txs: Transaction[],
  rules: StoredRule[]
): Transaction[] {
  return applyRulesV2(txs, rules.map(migrateRule));
}

export type { RuleCondition, RuleAction, ConditionJoin };
