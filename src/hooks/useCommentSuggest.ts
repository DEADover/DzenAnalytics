import { useCallback } from "react";
import { useDataStore } from "../store/useDataStore";
import {
  buildCommentIndex,
  suggestComment,
  type CommentIndex,
  type CommentSuggestion,
  type SuggestContext,
} from "../lib/commentSuggest";
import type { Transaction } from "../types";

/**
 * Индекс подсказок комментария — один на массив операций: окна операции,
 * массовой правки, разделения открываются часто, а пересчитывать тысячи
 * комментариев на каждое открытие незачем. Массив операций в сторе меняется
 * целиком при синхронизации — тогда индекс и пересобирается.
 */
const cache = new WeakMap<readonly Transaction[], CommentIndex>();

function indexFor(txs: readonly Transaction[]): CommentIndex {
  let idx = cache.get(txs);
  if (!idx) {
    idx = buildCommentIndex(txs);
    cache.set(txs, idx);
  }
  return idx;
}

/** Подсказка к набранному комментарию с учётом получателя и категории. */
export function useCommentSuggest(context: SuggestContext = {}): (text: string) => CommentSuggestion | null {
  const txs = useDataStore((s) => s.transactions);
  const { payee, category } = context;
  return useCallback(
    (text: string) => suggestComment(indexFor(txs), text, { payee, category }),
    [txs, payee, category]
  );
}
