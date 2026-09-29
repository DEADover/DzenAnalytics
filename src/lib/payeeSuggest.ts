import type { Transaction } from "../types";

const DAY = 86_400_000;

/**
 * Получатели, которых вероятнее всего выберут, — для группы «Часто
 * используемые» в начале списка, как у счетов.
 *
 * Прежде список шёл по алфавиту, и привычного получателя приходилось искать
 * среди сотен строк из выписок. Вес получателя — число его операций, где
 * свежие весят больше старых: с магазином, куда ходили весь прошлый год и
 * перестали, выбирать теперь реже, чем с тем, куда ходят сейчас. Если
 * категория уже выбрана, получатели с ней весят втрое больше — «Кафе» тянет
 * наверх кофейни, а не АЗС.
 */
export function rankPayees(
  txs: readonly Transaction[],
  opts: { category?: string; today: string; limit?: number }
): string[] {
  const now = Date.parse(opts.today);
  const scores = new Map<string, number>();
  for (const t of txs) {
    if (t.kind === "transfer") continue;
    const name = (t.brand?.trim() || t.payee?.trim() || "").trim();
    if (!name) continue;
    const age = (now - Date.parse(t.date)) / DAY;
    const fresh = age <= 90 ? 1 : age <= 365 ? 0.5 : 0.2;
    const same = opts.category && t.category === opts.category ? 3 : 1;
    scores.set(name, (scores.get(name) ?? 0) + fresh * same);
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"))
    .slice(0, opts.limit ?? 8)
    .map(([name]) => name);
}
