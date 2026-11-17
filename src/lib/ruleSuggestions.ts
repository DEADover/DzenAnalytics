/**
 * Подсказки правил по ручным правкам.
 *
 * Правило приходится придумывать самому, хотя человек его уже «показал»:
 * третий раз подряд меняет категорию у одного и того же контрагента или
 * третий раз поправляет его имя. Здесь такие повторы превращаются в черновик
 * правила, который остаётся только открыть и сохранить.
 *
 * История правок в сервисе не хранится — правка исчезает, как только уходит в
 * Дзен-мани. Поэтому исправления записываются в отдельный журнал
 * (`useRuleHintsStore`) в момент, когда человек их делает; подсказки считаются
 * по нему. Правки, сделанные до появления журнала, в подсказки не попадают.
 */

import type { Transaction } from "../types";
import type { TransactionEdit } from "../store/useEditsStore";
import type { RulePrefill } from "./ruleFromTransaction";
import { allConditions, type CategoryRuleV2 } from "./ruleEngine";
import { displayPayee } from "./format";
import { NO_CATEGORY, isServiceCategory } from "./zenmoneyMap";

/** Одно ручное исправление: у операций с таким признаком поле стало таким. */
export interface Correction {
  field: "category" | "payee";
  /**
   * По чему такие операции узнаются. У категории — имя контрагента. У
   * контрагента — имя, которое стояло до правки; если его не было — пусто, и
   * тогда операции узнаются по строке из выписки.
   */
  key: string;
  /** Строка из выписки — запасной признак для правки контрагента. */
  statement: string;
  /** Что поставили: категория целиком или имя контрагента. */
  to: string;
  txId: string;
  at: number;
}

/** Сколько раз надо поправить одно и то же, чтобы появилась подсказка. */
export const SUGGEST_MIN_COUNT = 3;

/** Журнал не растёт без конца: помним последние исправления. */
export const CORRECTION_LOG_LIMIT = 1500;

/**
 * Категорию подсказываем, только если человек правит контрагента в одну
 * сторону: три раза в «Уход за собой» и два раза в «Товары для дома» — значит,
 * у него там две категории, и правило переложило бы лишнее. Нужная категория
 * должна набрать такую долю всех исправлений этого контрагента.
 */
export const SUGGEST_MIN_SHARE = 0.75;

const norm = (v: string) => v.trim().toLowerCase().replace(/ё/g, "е");

/**
 * Исправления из одной правки. `before` — операция, какой её видели до правки.
 * Перевод и долг пропускаем: категории у них нет, а контрагент у долга — часть
 * его устройства.
 */
export function correctionsOf(before: Transaction, patch: TransactionEdit, at: number): Correction[] {
  if (before.kind === "transfer" || patch.kind === "transfer") return [];
  const out: Correction[] = [];
  const statement = (before.payeeRaw ?? "").trim();
  const oldName = displayPayee(before).trim();

  if (patch.brand !== undefined) {
    const to = (patch.brand ?? "").trim();
    // Узнавать операции надо по чему-то: по прежнему имени или по строке банка.
    if (to && norm(to) !== norm(oldName) && (oldName || statement)) {
      out.push({ field: "payee", key: oldName, statement, to, txId: before.id, at });
    }
  }

  if (patch.categoryFull !== undefined) {
    const to = (patch.categoryFull ?? "").trim();
    const name = (patch.brand !== undefined ? (patch.brand ?? "").trim() : "") || oldName;
    if (
      to &&
      to !== NO_CATEGORY &&
      !isServiceCategory(to) &&
      to !== (before.categoryFull ?? "") &&
      name
    ) {
      out.push({ field: "category", key: name, statement, to, txId: before.id, at });
    }
  }
  return out;
}

/** Дописать исправления в журнал: у операции и поля остаётся последнее. */
export function appendCorrections(log: readonly Correction[], added: readonly Correction[]): Correction[] {
  if (added.length === 0) return log as Correction[];
  const replaced = new Set(added.map((c) => `${c.txId}|${c.field}`));
  const kept = log.filter((c) => !replaced.has(`${c.txId}|${c.field}`));
  return [...kept, ...added].slice(-CORRECTION_LOG_LIMIT);
}

export interface RuleSuggestion {
  /** Устойчивый ключ — по нему подсказку прячут навсегда. */
  id: string;
  field: "category" | "payee";
  /** По чему правило узнаёт операции — словами условия. */
  matchLabel: string;
  matchValue: string;
  /** Что правило поставит. */
  to: string;
  /** Сколько раз человек сделал это руками. */
  count: number;
  /** У категории: сколько сейчас операций у контрагента и сколько уже в ней. */
  total?: number;
  inTarget?: number;
  draft: RulePrefill;
}

/** Есть ли уже правило с таким же условием «равно» и таким же действием. */
function covered(
  rules: readonly CategoryRuleV2[],
  field: "payee" | "statement",
  value: string,
  action: "setCategory" | "setPayee",
  to: string
): boolean {
  return rules.some(
    (r) =>
      r.actions.some((a) => a.kind === action && norm(a.value ?? "") === norm(to)) &&
      allConditions(r).some(
        (c) => c.field === field && (c.op === "equals" || c.op === "contains") && norm(c.value) === norm(value)
      )
  );
}

/**
 * Подсказки по журналу. Не предлагаем то, что уже есть в правилах, что человек
 * спрятал, и категорию у контрагента, которого правят в разные стороны.
 */
export function buildRuleSuggestions(
  log: readonly Correction[],
  rules: readonly CategoryRuleV2[],
  transactions: readonly Transaction[],
  dismissed: ReadonlySet<string>
): RuleSuggestion[] {
  // Одинаковые исправления: поле + признак + итог.
  const groups = new Map<string, { sample: Correction; txIds: Set<string>; byStatement: boolean }>();
  for (const c of log) {
    const byStatement = c.field === "payee" && !c.key;
    const match = byStatement ? c.statement : c.key;
    if (!match) continue;
    const id = `${c.field}|${byStatement ? "s" : "n"}|${norm(match)}|${norm(c.to)}`;
    let g = groups.get(id);
    if (!g) {
      g = { sample: c, txIds: new Set(), byStatement };
      groups.set(id, g);
    }
    g.txIds.add(c.txId);
    // Написание берём из самого свежего исправления.
    if (c.at >= g.sample.at) g.sample = c;
  }

  // Сколько всего раз человек менял категорию у контрагента — во все стороны.
  const categoryFixes = new Map<string, Set<string>>();
  for (const c of log) {
    if (c.field !== "category") continue;
    const k = norm(c.key);
    categoryFixes.set(k, (categoryFixes.get(k) ?? new Set()).add(c.txId));
  }

  const out: RuleSuggestion[] = [];
  for (const [id, g] of groups) {
    if (g.txIds.size < SUGGEST_MIN_COUNT || dismissed.has(id)) continue;
    const c = g.sample;
    if (c.field === "category") {
      if (covered(rules, "payee", c.key, "setCategory", c.to)) continue;
      const allFixes = categoryFixes.get(norm(c.key))?.size ?? g.txIds.size;
      if (g.txIds.size / allFixes < SUGGEST_MIN_SHARE) continue;
      // Для строки подсказки: сколько операций у контрагента и сколько уже там.
      const same = transactions.filter((t) => t.kind !== "transfer" && norm(displayPayee(t)) === norm(c.key));
      const inTarget = same.filter((t) => t.categoryFull === c.to).length;
      out.push({
        id,
        field: "category",
        matchLabel: "Контрагент",
        matchValue: c.key,
        to: c.to,
        count: g.txIds.size,
        total: same.length,
        inTarget,
        draft: {
          groups: [{ join: "and", conditions: [{ field: "payee", op: "equals", value: c.key, caseInsensitive: true }] }],
          actions: [{ kind: "setCategory", value: c.to }],
        },
      });
    } else {
      const field = g.byStatement ? "statement" : "payee";
      const value = g.byStatement ? c.statement : c.key;
      if (covered(rules, field, value, "setPayee", c.to)) continue;
      out.push({
        id,
        field: "payee",
        matchLabel: g.byStatement ? "Строка из выписки" : "Контрагент",
        matchValue: value,
        to: c.to,
        count: g.txIds.size,
        draft: {
          groups: [{ join: "and", conditions: [{ field, op: "equals", value, caseInsensitive: true }] }],
          actions: [{ kind: "setPayee", value: c.to }],
        },
      });
    }
  }
  return out.sort((a, b) => b.count - a.count || a.matchValue.localeCompare(b.matchValue, "ru"));
}
