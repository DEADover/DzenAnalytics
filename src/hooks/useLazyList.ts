import { useEffect, useState } from "react";

/**
 * Постепенный показ длинного списка: сначала первая порция, дальше — по мере
 * прокрутки страницы.
 *
 * Тот же приём, что в «Операциях»: маячок в конце списка следит за появлением в
 * поле зрения и добавляет ещё порцию. Нужен там, где записей сотни: рисовать их
 * все разом дорого, а запирать список в собственную прокрутку — неудобно
 * (получается две полосы прокрутки, страницы и списка внутри).
 *
 * Счётчик сбрасывается, когда меняется САМ массив — то есть поиск, отбор или
 * сортировка. Списки, которым нужен этот хук, собираются через `useMemo`, так
 * что сравнение по ссылке здесь честное: пересобрался массив — значит поменялся
 * его состав.
 */
export function useLazyList<T>(
  items: T[],
  pageSize = 100
): {
  /** Что рисовать сейчас. */
  visible: T[];
  /** Сколько показано и сколько всего — для подписи «Показано N из M». */
  shown: number;
  total: number;
  /** Есть ли ещё не показанные записи. */
  hasMore: boolean;
  /**
   * Повесить на элемент в конце списка (`ref={lazy.attachSentinel}`).
   *
   * Это функция-ссылка, а не объект: маячок появляется и исчезает вместе со
   * своим списком (у отборов «Дубли» и «Без контрагента» он и вовсе рисуется
   * не сразу), и наблюдателя надо переподключать в этот самый момент. С
   * объектом-ссылкой эффект о появлении узла не узнаёт — он зависит от
   * счётчиков, а те не меняются, — и подгрузка молча не включалась: список
   * замирал на первой сотне.
   */
  attachSentinel: (el: HTMLDivElement | null) => void;
} {
  const [prevItems, setPrevItems] = useState(items);
  const [count, setCount] = useState(pageSize);
  if (items !== prevItems) {
    setPrevItems(items);
    setCount(pageSize);
  }

  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  const total = items.length;
  const shown = Math.min(count, total);

  useEffect(() => {
    if (!sentinel) return;
    if (count >= total) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setCount((n) => Math.min(n + pageSize, total));
          }
        }
      },
      // Подгружаем заранее, чтобы не было пустого хвоста под курсором.
      { rootMargin: "400px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, count, total, pageSize]);

  return {
    visible: count >= total ? items : items.slice(0, count),
    shown,
    total,
    hasMore: count < total,
    attachSentinel: setSentinel,
  };
}
