import { create } from "zustand";
import * as db from "../lib/db";
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

export type RuleField = "payee" | "comment" | "category" | "account" | "amount";

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
  add: (r: NewRule | NewRuleV2) => Promise<void>;
  addMany: (rs: (NewRule | NewRuleV2)[]) => Promise<number>;
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
  remove: (id: string) => Promise<void>;
  move: (id: string, dir: -1 | 1) => Promise<void>;
  /** Переставить правило на место с индексом `to` (перетаскиванием). */
  reorder: (id: string, to: number) => Promise<void>;
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
  },

  add: async (r) => {
    const existing = get().rules;
    const fresh = makeRule(r, 0);
    const key = ruleKey(fresh);
    if (existing.some((x) => ruleKey(x) === key)) return;
    const list = [...existing, fresh];
    await db.saveJSON("categoryRules", list);
    set({ rules: list });
  },

  addMany: async (rs) => {
    if (rs.length === 0) return 0;
    const existing = get().rules;
    const existingKeys = new Set(existing.map(ruleKey));
    const fresh: StoredCategoryRule[] = [];
    let salt = 0;
    for (const r of rs) {
      const made = makeRule(r, salt++);
      const k = ruleKey(made);
      if (existingKeys.has(k)) continue;
      existingKeys.add(k);
      fresh.push(made);
    }
    if (fresh.length === 0) return 0;
    const list = [...existing, ...fresh];
    await db.saveJSON("categoryRules", list);
    set({ rules: list });
    return fresh.length;
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
