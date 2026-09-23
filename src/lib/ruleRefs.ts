/**
 * Ссылки правил на справочники Дзен-мани по id (16.09.2026).
 *
 * Правило помнит категорию, счёт и получателя НАЗВАНИЕМ: так их ищет движок и
 * так их показывает редактор. Но название в Дзен-мани можно поменять, и тогда
 * правило молча ломалось: «поставить категорию «Продукты»» после
 * переименования в «Еда дома» становилось «заблокировано», условие «счёт равен
 * «Т-Банк»» переставало совпадать.
 *
 * Теперь рядом с названием хранится `refId` — id тега, счёта или контрагента.
 * После каждой синхронизации названия подтягиваются по id, а у значений без
 * ссылки она проставляется, если название однозначно находится в справочнике.
 * То же нужно и для переноса правил между устройствами: id у одного аккаунта
 * Дзен-мани одинаковые везде, названия — как успели переименовать.
 *
 * Что получает ссылку:
 *   • условие «категория равна» и действие «категория» → тег;
 *   • условие «счёт равен» → счёт;
 *   • условие «получатель равен» и действие «получатель» → контрагент.
 * «Содержит», регулярные выражения и прочие — текст, ссылаться там не на что.
 * «Без категории», «Перевод» и «Долг» — не теги, ссылки у них нет.
 */

import type { CategoryRuleV2, RuleAction, RuleCondition } from "./ruleEngine";
import type { ZenCache } from "./zenmoneyCache";
import { NO_CATEGORY, isServiceCategory } from "./zenmoneyMap";

/** Справочники Дзен-мани в том виде, который нужен ссылкам. */
export interface RefDictionary {
  tags: readonly { id: string; title: string; parent: string | null; archive?: boolean }[];
  accounts: readonly { id: string; title: string; archive?: boolean }[];
  merchants: readonly { id: string; title: string }[];
}

/** Справочники из кэша синхронизации. */
export function refDictionaryFromCache(cache: ZenCache): RefDictionary {
  return {
    tags: cache.tags ?? [],
    accounts: cache.accounts ?? [],
    merchants: cache.merchants ?? [],
  };
}

type RefKind = "tag" | "account" | "merchant";

function conditionKind(c: RuleCondition): RefKind | null {
  if (c.op !== "equals") return null;
  if (c.field === "category") return "tag";
  if (c.field === "account") return "account";
  if (c.field === "payee") return "merchant";
  return null;
}

function actionKind(a: RuleAction): RefKind | null {
  if (a.kind === "setCategory") return "tag";
  if (a.kind === "setPayee") return "merchant";
  if (a.kind === "setTransfer") return "account";
  return null;
}

/** Поиск по справочникам: id → название и название → единственный id. */
export interface RefIndex {
  nameOf: (kind: RefKind, id: string) => string | null;
  idOf: (kind: RefKind, name: string) => string | null;
}

export function buildRefIndex(dict: RefDictionary): RefIndex {
  const tagById = new Map(dict.tags.map((t) => [t.id, t]));
  const tagName = (id: string): string | null => {
    const t = tagById.get(id);
    if (!t) return null;
    const parent = t.parent ? tagById.get(t.parent) : undefined;
    return parent ? `${parent.title} / ${t.title}` : t.title;
  };
  const accName = new Map(dict.accounts.map((a) => [a.id, a.title]));
  const merchName = new Map(dict.merchants.map((m) => [m.id, m.title]));

  // Название → id только однозначно. Одинаковые названия у двух счетов или
  // двух контрагентов (дубли контрагентов в Дзен-мани — норма) ссылку не дают:
  // угадывать, какой из них имелся в виду, нельзя. Живые записи важнее
  // архивных — архивный тег с тем же названием не мешает найти живой.
  const unique = <T extends { id: string; archive?: boolean }>(
    items: readonly T[],
    keyOf: (item: T) => string
  ) => {
    const live = new Map<string, string[]>();
    const all = new Map<string, string[]>();
    for (const it of items) {
      const k = keyOf(it).trim().toLowerCase();
      if (!k) continue;
      (all.get(k) ?? all.set(k, []).get(k)!).push(it.id);
      if (!it.archive) (live.get(k) ?? live.set(k, []).get(k)!).push(it.id);
    }
    return (name: string): string | null => {
      const k = name.trim().toLowerCase();
      const ids = live.get(k) ?? all.get(k);
      return ids && ids.length === 1 ? ids[0] : null;
    };
  };
  const tagId = unique(dict.tags, (t) => tagName(t.id) ?? t.title);
  const accId = unique(dict.accounts, (a) => a.title);
  const merchId = unique(dict.merchants, (m) => m.title);

  return {
    nameOf: (kind, id) =>
      kind === "tag" ? tagName(id) : (kind === "account" ? accName : merchName).get(id) ?? null,
    idOf: (kind, name) => {
      if (kind === "tag" && (name === NO_CATEGORY || isServiceCategory(name))) return null;
      return kind === "tag" ? tagId(name) : kind === "account" ? accId(name) : merchId(name);
    },
  };
}

/**
 * Свести значение и ссылку.
 *
 *   • Значение находится в справочнике — оно и главное: ссылка ставится (или
 *     переставляется) на найденное. Человек мог поменять значение в редакторе,
 *     а старая ссылка ещё висит.
 *   • Значение не находится, а ссылка жива — объект переименовали: подтягиваем
 *     новое название.
 *   • Ни того ни другого — оставляем как было: объект удалён или это режим
 *     без справочника.
 */
function reconcile<T extends { value: string; refId?: string }>(
  item: T,
  kind: RefKind | null,
  index: RefIndex
): T {
  if (!kind || !item.value.trim()) {
    if (item.refId === undefined) return item;
    const { refId: _dropped, ...rest } = item;
    return rest as T;
  }
  const byName = index.idOf(kind, item.value);
  if (byName) return byName === item.refId ? item : { ...item, refId: byName };
  if (item.refId) {
    const current = index.nameOf(kind, item.refId);
    if (current && current !== item.value) return { ...item, value: current };
  }
  return item;
}

/** Правило со сведёнными ссылками. Тот же объект, если менять нечего. */
export function reconcileRuleRefs<R extends CategoryRuleV2>(rule: R, index: RefIndex): R {
  let changed = false;
  const groups = rule.groups.map((g) => {
    let groupChanged = false;
    const conditions = g.conditions.map((c) => {
      const next = reconcile(c, conditionKind(c), index);
      if (next !== c) groupChanged = true;
      return next;
    });
    if (!groupChanged) return g;
    changed = true;
    return { ...g, conditions };
  });
  const actions = rule.actions.map((a) => {
    const next = reconcile(a, actionKind(a), index);
    if (next !== a) changed = true;
    return next;
  });
  return changed ? { ...rule, groups, actions } : rule;
}

/** Все правила разом; `changed` — было ли что переписать. */
export function reconcileRulesRefs<R extends CategoryRuleV2>(
  rules: readonly R[],
  dict: RefDictionary
): { rules: R[]; changed: boolean } {
  const index = buildRefIndex(dict);
  let changed = false;
  const out = rules.map((r) => {
    const next = reconcileRuleRefs(r, index);
    if (next !== r) changed = true;
    return next;
  });
  return { rules: out, changed };
}
