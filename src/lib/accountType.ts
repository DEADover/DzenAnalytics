// Zenmoney account `type` (+ `savings`) → короткая русская подпись. Общая для
// таблицы на Главной, страницы «Счета» и редактора счёта, чтобы формулировки
// нигде не разъезжались.
//
// Проверено на живом API: «Накопительный счёт» в Дзен-мани — это НЕ отдельный
// тип, а `checking` с `savings: true` (все счета вида «… - Нак.счет» именно
// такие), а «Депозит» — `deposit`, тоже с `savings: true` и ставкой. Поэтому
// вид счёта определяется парой (type, savings), а не одним полем.

export interface AccountKind {
  /** Значение поля `type` в Дзен-мани. */
  type: string;
  /** Значение поля `savings`. */
  savings: boolean;
  label: string;
}

/** Виды счетов ровно в том наборе и порядке, в каком их показывает Дзен-мани. */
export const ACCOUNT_KINDS: AccountKind[] = [
  { type: "cash", savings: false, label: "Наличные" },
  { type: "ccard", savings: false, label: "Карта" },
  { type: "checking", savings: false, label: "Банковский счёт" },
  { type: "checking", savings: true, label: "Накопительный счёт" },
  { type: "loan", savings: false, label: "Кредит" },
  { type: "deposit", savings: true, label: "Депозит" },
];

/** Запасные подписи для типов, которых нет в списке выбора. */
const EXTRA_TYPE_RU: Record<string, string> = {
  debit: "Карта",
  emoney: "Кошелёк",
  // Служебный счёт «Долги» — он один на пользователя и не создаётся вручную.
  debt: "Долги",
  credit: "Кредит",
};

/**
 * Подпись вида счёта. `savings` учитывается, поэтому накопительный счёт не
 * подписывается «Банковским»: для пользователя это разные вещи.
 */
export function accountKindLabel(type: string, savings?: boolean): string {
  if (!type) return "—";
  const exact = ACCOUNT_KINDS.find((k) => k.type === type && k.savings === !!savings);
  if (exact) return exact.label;
  const byType = ACCOUNT_KINDS.find((k) => k.type === type);
  if (byType) return byType.label;
  return EXTRA_TYPE_RU[type] || type;
}

/** Совместимая подпись по одному типу — там, где признак накопительного
 *  неизвестен (например, у счёта, собранного из CSV). */
export function accountTypeLabel(type: string): string {
  return accountKindLabel(type, false);
}

/**
 * Типы счетов Дзен-мани, которые считаются долговыми.
 *
 * Живёт здесь, а не на странице «Счета»: тот же список нужен глобальному
 * отбору, где долговой счёт раскрывается по контрагентам.
 */
export const DEBT_TYPES = new Set(["debt", "loan", "credit"]);
