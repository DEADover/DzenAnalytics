/**
 * Дерево категорий для отбора по нескольким категориям сразу
 * (`CategoryFilterPicker`): родитель → его подкатегории, с типом категории.
 *
 * Жило в панели общих фильтров, пока тот же выбор не понадобился настройкам
 * «Ориентиров» в «Финансовом здоровье».
 */
import type { Transaction } from "../types";
import type { CategoryNode } from "../components/CategoryFilterPicker";
import { memoLast } from "./memoLast";
import type { ZenTag } from "./zenmoney";
import { NO_CATEGORY } from "./zenmoneyMap";

/** Служебные категории, которые держим наверху списка без заголовка группы. */
const PINNED_CATEGORIES = ["Корректировка"];

export type TagKinds = Map<string, "expense" | "income" | "both">;

/** Название корневой категории → её тип по справочнику Дзен-мани. */
export const tagKindsOf = memoLast((tags: readonly ZenTag[]): TagKinds => {
  const m: TagKinds = new Map();
  for (const t of tags) {
    if (t.parent) continue; // тип задаёт корневая категория
    m.set(t.title, t.showOutcome && t.showIncome ? "both" : t.showIncome ? "income" : "expense");
  }
  return m;
});

// Parent categories each with their observed sub-categories — for the cascade
// category filter (parent on the left, subs on the right).
export const categoryNodesOf = memoLast((transactions: Transaction[], tagKinds: TagKinds): CategoryNode[] => {
    const map = new Map<
      string,
      { subs: Set<string>; hasBare: boolean; seenIncome: boolean; seenExpense: boolean }
    >();
    // Сначала — плоский список листьев: основная категория каждой операции и
    // её вторые (#69). «Отпуск», стоящий всегда вторым, иначе в фильтре не
    // появлялся бы вовсе.
    const leaves: [Transaction["kind"], string, string | null][] = [];
    for (const t of transactions) {
      if (!t.category) continue;
      leaves.push([t.kind, t.category, t.subcategory]);
      for (const full of t.extraCategories ?? []) {
        const [category, ...rest] = full.split(/\s*\/\s*/);
        if (category) leaves.push([t.kind, category, rest.join(" / ") || null]);
      }
    }
    for (const [kind, category, subcategory] of leaves) {
      let e = map.get(category);
      if (!e) {
        e = { subs: new Set<string>(), hasBare: false, seenIncome: false, seenExpense: false };
        map.set(category, e);
      }
      // A transaction tagged with just the parent (no sub) is "bare" — a
      // distinct leaf from any «Category / Subcategory».
      if (subcategory) e.subs.add(subcategory);
      else e.hasBare = true;
      if (kind === "income") e.seenIncome = true;
      else if (kind === "expense" || kind === "refund") e.seenExpense = true;
    }
    // Тип берём из справочника Дзен-мани, а если его нет (режим CSV) — выводим
    // из самих операций: категория, встреченная только в доходах, доходная.
    const kindOf = (name: string, e: { seenIncome: boolean; seenExpense: boolean }) => {
      const fromTags = tagKinds.get(name);
      if (fromTags) return fromTags;
      if (e.seenIncome && e.seenExpense) return "both" as const;
      if (e.seenIncome) return "income" as const;
      if (e.seenExpense) return "expense" as const;
      return undefined;
    };
    // Доходных категорий обычно единицы, расходных — десятки, поэтому короткий
    // список идёт первым. Смешанные («и расход, и доход») — в хвост: их мало и
    // они не то, что ищут в первую очередь.
    const ORDER = { income: 0, expense: 1, both: 2 } as const;
    const real = [...map.entries()]
      .filter(([name]) => name !== NO_CATEGORY)
      .map(([name, e]) => ({
        name,
        hasBare: e.hasBare,
        kind: kindOf(name, e),
        subs: [...e.subs].sort((a, b) => a.localeCompare(b, "ru")),
      }))
      .sort(
        (a, b) =>
          (a.kind ? ORDER[a.kind] : 3) - (b.kind ? ORDER[b.kind] : 3) ||
          a.name.localeCompare(b.name, "ru")
      );
    // Наверх и без заголовка группы — «Без категории» и «Корректировка».
    // Первая всегда под рукой: по ней ищут операции, которым забыли категорию.
    // Вторая формально «и расход, и доход» и заводила бы себе отдельную группу
    // из одной строки — а по смыслу это служебная запись, а не статья бюджета.
    const pinnedNames = new Set([NO_CATEGORY, ...PINNED_CATEGORIES]);
    const pinned = real.filter((n) => pinnedNames.has(n.name)).map((n) => ({
      ...n,
      // Тип убираем намеренно: без него строка не получает заголовок группы.
      kind: undefined,
    }));
    return [
      { name: NO_CATEGORY, hasBare: true, subs: [] },
      ...pinned,
      ...real.filter((n) => !pinnedNames.has(n.name)),
    ];
});


/** Все листья дерева — ключи отбора, равные `categoryFull` операции. */
export function categoryLeavesOf(nodes: readonly CategoryNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (n.hasBare) out.push(n.name);
    for (const sub of n.subs) out.push(`${n.name} / ${sub}`);
  }
  return out;
}
