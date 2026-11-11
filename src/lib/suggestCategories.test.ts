/**
 * Подсказки «Без категории» ищутся по индексам — итог должен совпадать с
 * прежним полным перебором истории до порядка и цифр. Эталон ниже — тот самый
 * перебор (слова в данных выбраны так, чтобы стоп-слова не влияли).
 */
import { describe, it, expect } from "vitest";
import { suggestCategoriesForUncategorized } from "./aggregations";
import { tx } from "../test/fixtures";
import type { Transaction } from "../types";

function tokenize(text: string): Set<string> {
  return new Set(
    (text || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !/^\d+$/.test(w))
  );
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
function reference(txs: Transaction[], uncategorized: Transaction[], k: number) {
  const corpus = txs
    .filter((t) => t.kind !== "transfer" && !!t.categoryFull && !/^\s*$/.test(t.categoryFull) && !/^без катего/i.test(t.categoryFull))
    .map((t) => ({ tx: t, tokens: tokenize(`${t.payee} ${t.comment} ${t.categoryFull}`), payee: (t.payee || "").toLowerCase() }));
  const out = [];
  for (const u of uncategorized) {
    const uTokens = tokenize(`${u.payee} ${u.comment}`);
    const uPayee = (u.payee || "").toLowerCase();
    const scored = corpus
      .map((c) => ({
        tx: c.tx,
        score:
          jaccard(uTokens, c.tokens) +
          (uPayee && c.payee && (uPayee === c.payee || c.payee.includes(uPayee) || uPayee.includes(c.payee)) ? 0.5 : 0),
      }))
      .filter((x) => x.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
    if (scored.length === 0) continue;
    const votes = new Map<string, { score: number; count: number; examples: string[] }>();
    for (const s of scored) {
      let v = votes.get(s.tx.categoryFull);
      if (!v) votes.set(s.tx.categoryFull, (v = { score: 0, count: 0, examples: [] }));
      v.score += s.score;
      v.count += 1;
      if (v.examples.length < 3 && s.tx.payee && !v.examples.includes(s.tx.payee)) v.examples.push(s.tx.payee);
    }
    const winner = [...votes.entries()].sort((a, b) => b[1].score - a[1].score)[0]!;
    const total = scored.reduce((s, x) => s + x.score, 0);
    out.push({
      txId: u.id,
      payee: u.payee,
      comment: u.comment,
      amount: u.amount,
      currency: u.currency,
      date: u.date,
      suggested: winner[0],
      confidence: total > 0 ? winner[1].score / total : 0,
      reasonExamples: winner[1].examples,
      matched: winner[1].count,
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

/** Детерминированный генератор — тест повторяем. */
function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
}

describe("suggestCategoriesForUncategorized — индексы дают тот же итог", () => {
  for (const seed of [1, 7, 42, 2026]) {
    it(`случайная история, seed ${seed}`, () => {
      const r = rng(seed);
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
      const payees = ["Пятёрочка", "пятёрочка у дома", "Кофейня", "Кофе", "Ozon", "Ozon Банк", "Яндекс Go", "", "Аптека 36,6", "Ресторан"];
      const words = ["кофе", "латте", "хлеб", "молоко", "такси", "аренда", "лекарства", "подарок", "w12", "zz9", "обед", "ужин"];
      const cats = ["Продукты", "Еда вне дома", "Транспорт", "Дом", "Здоровье", "Подарки / Друзья", "Без категории", "Перевод"];
      const comment = () => Array.from({ length: Math.floor(r() * 4) }, () => pick(words)).join(" ");
      const history = Array.from({ length: 400 }, (_, i) => {
        const categoryFull = pick(cats);
        return tx({
          id: `h${i}`,
          payee: pick(payees),
          comment: comment(),
          category: categoryFull.split(" / ")[0],
          categoryFull,
          kind: categoryFull === "Перевод" ? "transfer" : "expense",
        });
      });
      const uncategorized = Array.from({ length: 120 }, (_, i) =>
        tx({ id: `u${i}`, payee: pick(payees), comment: comment(), category: "Без категории", categoryFull: "Без категории" })
      );
      for (const k of [1, 5, 7]) {
        expect(suggestCategoriesForUncategorized(history, uncategorized, k)).toEqual(reference(history, uncategorized, k));
      }
    });
  }
});
