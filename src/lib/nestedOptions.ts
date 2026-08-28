/**
 * Ветки внутри плоского списка фильтра: кто чей и что из этого видно.
 *
 * `MultiSelect` получает варианты ОДНИМ списком, а вложенность помечает
 * признаком строки (см. `nestedOf`): ветки идут сразу за своим родителем. Так
 * под долговым счётом стоят его контрагенты — в Дзен-мани долговой счёт один
 * на всех, и разложить его можно только по людям (см. `debtFilter`).
 *
 * Людей в долгах набирается больше, чем всех остальных счетов вместе, и
 * раскрытая ветка превращает фильтр счетов в список должников. Поэтому ветки
 * сворачиваются, а разбор «кто чей» вынесен сюда: искать родителя перебором
 * списка на каждую строку — это N² там, где хватает одного прохода.
 */

/** Разбор списка на ветки. */
export interface NestedBranches {
  /** Родитель → его ветки, в порядке списка. */
  children: Map<string, string[]>;
  /** Ветка → её родитель. */
  parent: Map<string, string>;
}

/**
 * Разобрать список на ветки за один проход.
 *
 * Вложенность одноуровневая и НЕПРЕРЫВНАЯ: ветки родителя — все вложенные
 * строки до следующей невложенной. Ровно так их и складывает
 * `withDebtCounterparties`.
 */
export function nestedBranches(
  options: string[],
  isNested?: (opt: string) => boolean
): NestedBranches {
  const children = new Map<string, string[]>();
  const parent = new Map<string, string>();
  if (!isNested) return { children, parent };
  let head: string | null = null;
  for (const opt of options) {
    if (!isNested(opt)) {
      head = opt;
      continue;
    }
    // Вложенная строка до первого родителя (так список приходит при поиске,
    // когда сам счёт в него не попал) остаётся сама по себе: сворачивать её
    // некому, а спрятать — значит потерять насовсем.
    if (head === null) continue;
    parent.set(opt, head);
    const kids = children.get(head);
    if (kids) kids.push(opt);
    else children.set(head, [opt]);
  }
  return { children, parent };
}

/**
 * Что из списка видно: ветки показываем только у раскрытых родителей.
 *
 * Сами родители и обычные варианты видны всегда — сворачивается только то,
 * что под ними.
 */
export function visibleOptions(
  options: string[],
  branches: NestedBranches,
  expanded: ReadonlySet<string>
): string[] {
  if (branches.parent.size === 0) return options;
  return options.filter((opt) => {
    const head = branches.parent.get(opt);
    return head === undefined || expanded.has(head);
  });
}
