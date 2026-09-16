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

import {
  describeRule,
  mergeHits,
  migrateRule,
  previewRules,
  type StoredRule,
} from "./ruleEngine";
import type { TransactionEdit } from "../store/useEditsStore";
import { displayPayee } from "./format";
import { isServiceCategory } from "./zenmoneyMap";
import type { Transaction } from "../types";

/** Одно изменение поля операции: что было, что станет и нужно ли его писать. */
export interface RuleFieldChange {
  label: string;
  from: string;
  to: string;
  /** `same` — правило просит то, что уже стоит; `written` — правка уже записана. */
  state: "pending" | "written" | "same";
  /** Правило, занявшее это поле, — человекочитаемо. Поля одной операции могут
   *  достаться РАЗНЫМ правилам, поэтому подпись у каждого изменения своя, а не
   *  одна на строку. */
  rule?: string;
}

export interface RuleRow {
  tx: Transaction;
  /** Только то, что действительно надо записать. Пусто у строк без «pending». */
  patch: TransactionEdit;
  changes: RuleFieldChange[];
  status: "pending" | "written" | "same" | "blocked";
  /** Категория, которую нельзя записать (для `blocked`), — см. `blockedReason`. */
  blockedCategory?: string;
  /**
   * Почему категорию нельзя записать: `missing` — её нет в справочнике
   * Дзен-мани, `service` — это ярлык сервиса («Перевод», «Долг»), а не
   * категория вовсе.
   */
  blockedReason?: CategoryBlockReason;
  /** Получатель, которого нет в справочнике Дзен-мани, — правило устарело. */
  blockedPayee?: string;
}

export type CategoryBlockReason = "missing" | "service";

export interface RulePlan {
  rows: RuleRow[];
  /** Строки, которые реально изменят операцию, — только их и пишем. */
  pending: RuleRow[];
  /** Операции, отсеянные из-за категории, которую нельзя записать. */
  skipped: { category: string; count: number; reason: CategoryBlockReason }[];
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
 * @param payeeOk    «такой контрагент есть в Дзен-мани»; без токена — `null`.
 */
/** Отсеянное по причине — окну проверки нужны разные объяснения. */
export function skippedByReason(plan: Pick<RulePlan, "skipped">): Record<
  CategoryBlockReason,
  { count: number; items: RulePlan["skipped"] }
> {
  const out = {
    missing: { count: 0, items: [] as RulePlan["skipped"] },
    service: { count: 0, items: [] as RulePlan["skipped"] },
  };
  for (const s of plan.skipped) {
    out[s.reason].count += s.count;
    out[s.reason].items.push(s);
  }
  return out;
}

export function buildRulePlan(
  raw: Transaction[],
  rules: StoredRule[],
  ruleIds: ReadonlySet<string>,
  edits: Record<string, TransactionEdit>,
  deletedSet: Set<string>,
  categoryOk: ((category: string, subcategory: string | null) => boolean) | null,
  payeeOk: ((title: string) => boolean) | null = null
): RulePlan {
  if (ruleIds.size === 0)
    return { rows: [], pending: [], skipped: [], skippedCount: 0 };

  const hits = previewRules(raw, rules, ruleIds);
  const byTx = mergeHits(hits);
  // Кто занял какое поле. Поле забирает ПЕРВОЕ высказавшееся о нём правило
  // (см. `collectRuleHits`), поэтому и здесь запоминаем первого — иначе подпись
  // указала бы на правило, которое до этого поля так и не добралось.
  const ownerOf = new Map<string, Map<string, string>>();
  for (const h of hits) {
    let owners = ownerOf.get(h.txId);
    if (!owners) {
      owners = new Map();
      ownerOf.set(h.txId, owners);
    }
    for (const field of Object.keys(h.patch)) {
      if (!owners.has(field)) owners.set(field, h.ruleId);
    }
  }
  const ruleName = new Map(
    rules.map((r) => [r.id, describeRule(migrateRule(r))] as const)
  );
  const owner = (txId: string, field: string) => {
    const id = ownerOf.get(txId)?.get(field);
    return id ? ruleName.get(id) : undefined;
  };

  const rows: RuleRow[] = [];
  const skips = new Map<string, { category: string; count: number; reason: CategoryBlockReason }>();
  const skip = (category: string, reason: CategoryBlockReason) => {
    const key = `${reason}|${category}`;
    const cur = skips.get(key);
    if (cur) cur.count += 1;
    else skips.set(key, { category, count: 1, reason });
  };

  for (const t of raw) {
    const patch = byTx[t.id];
    if (!patch) continue;
    if (deletedSet.has(t.id)) continue;

    // Категорию нельзя записать — операцию пропускаем целиком. Записать
    // получателя с комментарием, но не категорию, значило бы применить правило
    // наполовину, и объяснить это в интерфейсе нечем.
    //
    // «Перевод» и «Долг» отсекаем всегда, и без подключения тоже: это не
    // категории, а ярлыки вида операции. Правило, поставившее такой ярлык
    // расходу, превратило бы его в «перевод» только на вид, а отправка такую
    // правку не примет никогда.
    const categoryBlock: CategoryBlockReason | null =
      patch.categoryFull === undefined
        ? null
        : isServiceCategory(patch.category)
          ? "service"
          : categoryOk && !categoryOk(patch.category ?? "", patch.subcategory ?? null)
            ? "missing"
            : null;
    if (categoryBlock && patch.categoryFull !== undefined) {
      skip(patch.categoryFull, categoryBlock);
      rows.push({
        tx: t,
        patch: {},
        changes: [],
        status: "blocked",
        blockedCategory: patch.categoryFull,
        blockedReason: categoryBlock,
      });
      continue;
    }

    // Получателя нет в справочнике — правило ссылается на имя, которого больше
    // не существует: контрагента переименовали или удалили. Записывать такое
    // бессмысленно: отправка положит имя свободным текстом, при возврате из
    // облака получатель окажется пустым, и правило запросится снова — так и
    // крутилось «ждут записи», которое не уходило после «Применить» (issue
    // #60). Показываем строку заблокированной и называем причину.
    if (
      patch.brand !== undefined &&
      payeeOk &&
      (patch.brand ?? "").trim() &&
      !payeeOk((patch.brand ?? "").trim())
    ) {
      rows.push({
        tx: t,
        patch: {},
        changes: [],
        status: "blocked",
        blockedPayee: (patch.brand ?? "").trim(),
      });
      continue;
    }

    const written = edits[t.id];
    const changes: RuleFieldChange[] = [];
    const toWrite: TransactionEdit = {};

    const add = (
      label: string,
      field: string,
      from: string,
      to: string,
      alreadyWritten: boolean,
      apply: () => void
    ) => {
      const rule = owner(t.id, field);
      if (from === to) {
        changes.push({ label, from, to, state: "same", rule });
        return;
      }
      if (alreadyWritten) {
        changes.push({ label, from, to, state: "written", rule });
        return;
      }
      changes.push({ label, from, to, state: "pending", rule });
      apply();
    };

    if (patch.categoryFull !== undefined) {
      // «Было» — категория от Дзен-мани: в `raw` правило её уже переписало.
      const from = t.categoryFullOriginal || t.categoryFull;
      add(
        "Категория",
        "categoryFull",
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
        "brand",
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
        "comment",
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

  const skipped = Array.from(skips.values()).sort(
    (a, b) => b.count - a.count || a.category.localeCompare(b.category, "ru")
  );

  return {
    rows,
    pending: rows.filter((r) => r.status === "pending"),
    skipped,
    skippedCount: skipped.reduce((s, x) => s + x.count, 0),
  };
}

