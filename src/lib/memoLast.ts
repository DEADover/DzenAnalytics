/**
 * Запомнить последний результат функции на уровне модуля: те же аргументы
 * (сравнение по ссылке) — тот же результат без пересчёта.
 *
 * Для хуков, которые вызываются в нескольких компонентах сразу: `useMemo`
 * помнит своё в каждом компоненте, и тяжёлый расчёт по всем операциям шёл бы
 * столько раз, сколько компонентов на экране.
 */
export function memoLast<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  let lastArgs: A | null = null;
  let last: R;
  return (...args: A): R => {
    if (
      lastArgs !== null &&
      lastArgs.length === args.length &&
      args.every((a, i) => Object.is(a, lastArgs![i]))
    ) {
      return last;
    }
    last = fn(...args);
    lastArgs = args;
    return last;
  };
}
