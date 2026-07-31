/**
 * План применения правил: что выбранные правила сделают с операциями.
 *
 * Один расчёт на всё — и для счётчиков на странице «Правила», и для окна
 * предпросмотра, и для самой записи в слой правок. Два независимых расчёта на
 * одной странице неминуемо разошлись бы в числах, а объяснить пользователю
 * разницу было бы нечем.
 *
 * Считается по `transactionsRaw` (правила применены, правки — ещё нет): по
 * текущим значениям уже применённое правило показало бы ноль совпадений — на
 * этих граблях первая версия правил уже стояла.
 */

import { previewRules, mergeHits, type StoredRule } from "./ruleEngine";
import type { TransactionEdit } from "../store/useEditsStore";
import { displayPayee } from "./format";
import type { Transaction } from "../types";

/** Одно изменение поля операции: что было, что станет и нужно ли его писать. */
export interface RuleFieldChange {
  label: string;
  from: string;
  to: string;
  /** `same` — правило просит то, что уже стоит; `written` — правка уже записана. */
  state: "pending" | "written" | "same";
}

export interface RuleRow {
  tx: Transaction;
  /** Только то, что действительно надо записать. Пусто у строк без «pending». */
  patch: TransactionEdit;
  changes: RuleFieldChange[];
  status: "pending" | "written" | "same" | "blocked";
  /** Категория, которой нет в справочнике Дзен-мани (для `blocked`). */
  blockedCategory?: string;
}

export interface RulePlan {
  rows: RuleRow[];
  /** Строки, которые реально изменят операцию, — только их и пишем. */
  pending: RuleRow[];
  /** Операции, отсеянные из-за отсутствующей в Дзен-мани категории. */
  skipped: { category: string; count: number }[];
  skippedCount: number;
}

const dash = (v: string | null | undefined) => (v && v.trim() ? v : "—");

/**
 * Что сделают выбранные правила с операциями.
 *
 * @param raw        `transactionsRaw` — правила применены, правки ещё нет. Именно
 *                   исходники: по текущим значениям уже применённое правило
 *                   показало бы ноль совпадений.
 * @param rules      все правила (движок сам отберёт нужные).
 * @param ruleIds    выбранные галочкой правила; выбранное правило показывается,
 *                   даже если оно выключено.
 * @param edits      слой правок — чтобы не предлагать записать записанное.
 * @param deletedSet локально удалённые операции: их не трогаем вовсе.
 * @param categoryOk «такая категория есть в Дзен-мани»; без токена — `null`.
 */
export function buildRulePlan(
  raw: Transaction[],
  rules: StoredRule[],
  ruleIds: ReadonlySet<string>,
  edits: Record<string, TransactionEdit>,
  deletedSet: Set<string>,
  categoryOk: ((category: string, subcategory: string | null) => boolean) | null
): RulePlan {
  if (ruleIds.size === 0)
    return { rows: [], pending: [], skipped: [], skippedCount: 0 };

  const byTx = mergeHits(previewRules(raw, rules, ruleIds));
  const rows: RuleRow[] = [];
  const skips = new Map<string, number>();

  for (const t of raw) {
    const patch = byTx[t.id];
    if (!patch) continue;
    if (deletedSet.has(t.id)) continue;

    // Категории нет в справочнике Дзен-мани — операцию пропускаем целиком.
    // Записать получателя с комментарием, но не категорию, значило бы применить
    // правило наполовину, и объяснить это в интерфейсе нечем.
    if (
      patch.categoryFull !== undefined &&
      categoryOk &&
      !categoryOk(patch.category ?? "", patch.subcategory ?? null)
    ) {
      skips.set(patch.categoryFull, (skips.get(patch.categoryFull) ?? 0) + 1);
      rows.push({
        tx: t,
        patch: {},
        changes: [],
        status: "blocked",
        blockedCategory: patch.categoryFull,
      });
      continue;
    }

    const written = edits[t.id];
    const changes: RuleFieldChange[] = [];
    const toWrite: TransactionEdit = {};

    const add = (
      label: string,
      from: string,
      to: string,
      alreadyWritten: boolean,
      apply: () => void
    ) => {
      if (from === to) {
        changes.push({ label, from, to, state: "same" });
        return;
      }
      if (alreadyWritten) {
        changes.push({ label, from, to, state: "written" });
        return;
      }
      changes.push({ label, from, to, state: "pending" });
      apply();
    };

    if (patch.categoryFull !== undefined) {
      // «Было» — категория от Дзен-мани: в `raw` правило её уже переписало.
      const from = t.categoryFullOriginal || t.categoryFull;
      add(
        "Категория",
        dash(from),
        dash(patch.categoryFull),
        written?.categoryFull === patch.categoryFull,
        () => {
          toWrite.category = patch.category;
          toWrite.subcategory = patch.subcategory ?? null;
          toWrite.categoryFull = patch.categoryFull;
        }
      );
    }
    if (patch.brand !== undefined) {
      add(
        "Получатель",
        dash(displayPayee(t)),
        dash(patch.brand),
        written?.brand === patch.brand,
        () => {
          toWrite.brand = patch.brand;
        }
      );
    }
    if (patch.comment !== undefined) {
      add(
        "Комментарий",
        dash(t.comment),
        dash(patch.comment),
        written?.comment === patch.comment,
        () => {
          toWrite.comment = patch.comment;
        }
      );
    }

    const status: RuleRow["status"] = changes.some((c) => c.state === "pending")
      ? "pending"
      : changes.some((c) => c.state === "written")
        ? "written"
        : "same";

    rows.push({ tx: t, patch: toWrite, changes, status });
  }

  const skipped = Array.from(skips, ([category, count]) => ({ category, count })).sort(
    (a, b) => b.count - a.count || a.category.localeCompare(b.category, "ru")
  );

  return {
    rows,
    pending: rows.filter((r) => r.status === "pending"),
    skipped,
    skippedCount: skipped.reduce((s, x) => s + x.count, 0),
  };
}

