import { Children, isValidElement, type ReactNode } from "react";

/**
 * Весь текст, который человек увидит в готовой разметке, — одной строкой.
 *
 * Нужен поиску по справке: её разделы написаны прямо в JSX, и другого способа
 * узнать, о чём раздел, у нас нет. Искать только по заголовкам мало — человек
 * помнит слово из текста («периметр», «тег»), а не название раздела.
 *
 * Обходим дерево узлов, а не рендерим его в строку: рендер потребовал бы
 * сервера разметки и выполнял бы код компонентов ради поиска.
 */
export function nodeText(node: ReactNode): string {
  const parts: string[] = [];
  collect(node, parts);
  // Разделитель между соседними узлами: без него «Счета» и «Категории» из
  // соседних элементов склеились бы в «СчетаКатегории» и не нашлись бы.
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function collect(node: ReactNode, out: string[]): void {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (typeof node === "string") {
    out.push(node);
    return;
  }
  if (typeof node === "number") {
    out.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out);
    return;
  }
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode; title?: unknown; alt?: unknown };
    // Подписи, которые видны не сразу: подсказка у термина и замена картинки.
    // Человек мог запомнить слово именно оттуда.
    if (typeof props.title === "string") out.push(props.title);
    if (typeof props.alt === "string") out.push(props.alt);
    Children.forEach(props.children, (child) => collect(child, out));
  }
}

/** Слова запроса — все ли встречаются в тексте. Порядок не важен. */
export function matchesQuery(text: string, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = text.toLowerCase();
  return words.every((w) => haystack.includes(w));
}
