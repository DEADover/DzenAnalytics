import { useRef } from "react";

/**
 * Какие ветки таблицы только что раскрыли — их подстроки проявляются
 * (`animate-tree-row`). Отмечаются только ветки, раскрытые нажатием: строки,
 * открытые уже при загрузке страницы, не мигают. Отметка живёт до следующего
 * раскрытия — повторная отрисовка без пересоздания строки анимацию не
 * повторяет, а заново раскрытая ветка монтирует строки и играет её снова.
 */
export function useRevealRows() {
  const opened = useRef<ReadonlySet<string>>(new Set());
  return {
    /** Запомнить раскрытые сейчас ветки: `next` минус то, что было открыто. */
    mark(prev: ReadonlySet<string>, next: ReadonlySet<string>) {
      opened.current = new Set([...next].filter((k) => !prev.has(k)));
    },
    /** Строка — потомок только что раскрытой ветки (ключ `ветка/…`). */
    isNew(key: string, sep = "/") {
      for (const k of opened.current) if (key.startsWith(k + sep)) return true;
      return false;
    },
    /** То же по ключу самой ветки — когда у подстрок свой ключ, не путём. */
    isOpenedNow(branch: string) {
      return opened.current.has(branch);
    },
  };
}
