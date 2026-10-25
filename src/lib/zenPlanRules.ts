/**
 * Правила экрана «Планы» Дзен-мани — что идёт в поступления и расходы.
 *
 * Сверено с экраном приложения на
 * живом аккаунте. Всем управляют настройки пользователя, которые Дзен-мани
 * синхронизирует вместе с данными (`user.planBalanceMode`, `user.planSettings`),
 * поэтому своих настроек под это у нас нет: бюджет показывает ровно то, что
 * человек выбрал у себя в приложении.
 *
 * Два режима:
 *   • «Баланс vs Расходы» (`balance`, `budgetLimit`) — входящий баланс в
 *     поступлениях, все переводы через границу баланса считаются, возвраты
 *     НЕ вычитаются из расходов (поступление в расходной категории — доход);
 *   • «Доходы vs Расходы» (`excludeOpeningBalance`) — входящий баланс и каждую
 *     группу переводов человек включает сам (`planSettings`), возвраты
 *     вычитаются из расходов.
 *
 * Периметр — счета «в балансе». Перевод между двумя такими счетами в планы не
 * идёт. Перевод через границу — строка своей группы: списание наружу —
 * расход, зачисление снаружи — поступление. Счёт «Долги» тут не особенный:
 * отмечен «в балансе» — долги внутренние и в планы не идут (сверено на живом
 * аккаунте: октябрь 2025, 200 000 ₽ в долг, в «Планах» их нет); вне баланса —
 * группа «Долги».
 */

/** Группа переводов в «Планах». */
export type PlanTransferGroup = "savings" | "loans" | "debts" | "other";

/** Направление: «to» — перевод со счёта в балансе наружу (расход), «from» — внутрь. */
export type PlanTransferSide = "to" | "from";

/** Подписи строк — как в приложении. */
export const PLAN_GROUP_LABEL: Record<PlanTransferSide, Record<PlanTransferGroup, string>> = {
  to: {
    savings: "Накопления",
    loans: "Кредиты и кредитки",
    debts: "Долги",
    other: "Остальные переводы",
  },
  from: {
    savings: "Из накоплений",
    loans: "С кредитных счетов",
    debts: "Долги",
    other: "Остальные переводы",
  },
};

/** Подпись строки входящего баланса. */
export const OPENING_BALANCE_LABEL = "Входящий баланс";

const SETTING_KEY: Record<PlanTransferSide, Record<PlanTransferGroup, string>> = {
  to: {
    savings: "excludeTransferToSavings",
    loans: "excludeTransferToLoans",
    debts: "excludeTransferToDebts",
    other: "excludeTransferToOtherAccounts",
  },
  from: {
    savings: "excludeTransferFromSavings",
    loans: "excludeTransferFromLoans",
    debts: "excludeTransferFromDebts",
    other: "excludeTransferFromOtherAccounts",
  },
};

/** Настройки «Планов» пользователя, разобранные. */
export interface ZenPlanSettings {
  /** Строка «Входящий баланс» в поступлениях. */
  openingBalance: boolean;
  /** Выключенные группы переводов: ключ `${side}:${group}`. */
  excluded: Set<string>;
  /** Вычитать возвраты из расходов (режим «Доходы vs Расходы»). */
  refunds: boolean;
  /**
   * Авто-прогнозы Дзен-мани идут в план («Учитывать прогнозы» в настройках
   * «Планов»): у статьи без своего плана план — прогноз, и прогнозные
   * плановые операции прибавляются к плану, как назначенные.
   */
  forecasts: boolean;
}

/**
 * `planSettings` приходит то массивом, то строкой с JSON-массивом внутри —
 * на живом аккаунте он лежит строкой.
 */
function settingsList(raw: unknown): string[] {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function zenPlanSettings(
  user:
    | { planBalanceMode?: unknown; planSettings?: unknown; isForecastEnabled?: unknown }
    | undefined
    | null
): ZenPlanSettings {
  const list = settingsList(user?.planSettings);
  // Режим по умолчанию у приложения — «Доходы vs Расходы».
  const mode = typeof user?.planBalanceMode === "string" ? user.planBalanceMode : "excludeOpeningBalance";
  const incomeMode = mode === "excludeOpeningBalance";
  const excluded = new Set<string>();
  if (incomeMode) {
    for (const side of ["to", "from"] as const)
      for (const group of ["savings", "loans", "debts", "other"] as const)
        if (list.includes(SETTING_KEY[side][group])) excluded.add(`${side}:${group}`);
  }
  return {
    openingBalance: !incomeMode || list.includes("includeOpeningBalance"),
    excluded,
    refunds: incomeMode,
    forecasts: user?.isForecastEnabled === true,
  };
}

/** Что о счёте нужно правилам. */
export interface PlanAccount {
  title: string;
  type: string;
  savings: boolean;
  creditLimit: number;
  inBalance: boolean;
  archive?: boolean;
}

/**
 * Группа внешнего счёта — как в приложении: долги; кредит или карта с
 * кредитным лимитом; вклад или накопительный; всё прочее.
 */
export function accountGroup(a: Pick<PlanAccount, "type" | "savings" | "creditLimit">): PlanTransferGroup {
  if (a.type === "debt") return "debts";
  if (a.type === "loan" || (a.type === "ccard" && a.creditLimit > 0)) return "loans";
  if (a.type === "deposit" || a.savings) return "savings";
  return "other";
}

/** Правила, привязанные к счетам и категориям конкретного аккаунта. */
export interface ZenPlanRules extends ZenPlanSettings {
  /** Счета внутри периметра — по названию, как в операциях. */
  inside: Set<string>;
  /** Группа каждого внешнего счёта. */
  groupOf: Map<string, PlanTransferGroup>;
  /** Подписи групп с учётом совпадений с категориями пользователя. */
  labels: Record<PlanTransferSide, Record<PlanTransferGroup, string>>;
  /**
   * Категории «только для доходов» — ключ «категория / подкатегория» (или
   * просто «категория»). Трата в такой категории в режиме возвратов вычитается
   * из её дохода — зеркальное правило к возврату в расходной.
   */
  incomeOnly: Set<string>;
}

/** Ключ категории для `incomeOnly`. */
export function categoryKey(category: string, subcategory: string | null | undefined): string {
  return subcategory ? `${category} / ${subcategory}` : category;
}

export function buildZenPlanRules(
  accounts: PlanAccount[],
  settings: ZenPlanSettings,
  categories: { key: string; showIncome: boolean; showOutcome: boolean }[]
): ZenPlanRules {
  const inside = new Set<string>();
  const groupOf = new Map<string, PlanTransferGroup>();
  for (const a of accounts) {
    if (a.inBalance) inside.add(a.title);
    else groupOf.set(a.title, accountGroup(a));
  }
  // Подпись группы не должна совпасть с категорией пользователя: строки
  // бюджета опознаются по имени, и «Накопления»-перевод слился бы с
  // «Накоплениями»-категорией.
  const taken = new Set(categories.map((c) => c.key.split(" / ")[0]));
  const labels = {
    to: { ...PLAN_GROUP_LABEL.to },
    from: { ...PLAN_GROUP_LABEL.from },
  };
  for (const side of ["to", "from"] as const)
    for (const g of Object.keys(labels[side]) as PlanTransferGroup[])
      if (taken.has(labels[side][g])) labels[side][g] = `${labels[side][g]} (переводы)`;
  const incomeOnly = new Set<string>();
  for (const c of categories) if (c.showIncome && !c.showOutcome) incomeOnly.add(c.key);
  return { ...settings, inside, groupOf, labels, incomeOnly };
}

/** Все подписи групп — чтобы опознать строку перевода по категории. */
export function planGroupLabels(rules: ZenPlanRules | undefined): Set<string> {
  const out = new Set<string>();
  if (!rules) return out;
  for (const side of ["to", "from"] as const)
    for (const label of Object.values(rules.labels[side])) out.add(label);
  return out;
}

/**
 * Остаток на счетах «в балансе» к началу дня `dateIso` — входящий баланс
 * периода. Считается назад от текущего остатка: минус всё, что пришло на счёт
 * с этого дня, плюс всё, что ушло. Счёт «Долги» сюда входит, если он в
 * балансе, — как и в балансе самого приложения.
 */
export function openingBalance(
  accounts: { id: string; inBalance: boolean; archive?: boolean; balance: number; instrument: number }[],
  transactions: {
    date: string;
    deleted?: boolean;
    income: number;
    outcome: number;
    incomeAccount: string;
    outcomeAccount: string;
  }[],
  dateIso: string,
  /** Сумма в валюте инструмента → в базовую. */
  toBase: (amount: number, instrument: number) => number
): number {
  const native = new Map<string, number>();
  const instr = new Map<string, number>();
  for (const a of accounts) {
    if (!a.inBalance) continue;
    native.set(a.id, a.balance);
    instr.set(a.id, a.instrument);
  }
  for (const t of transactions) {
    if (t.deleted || t.date < dateIso) continue;
    if (t.income && native.has(t.incomeAccount))
      native.set(t.incomeAccount, native.get(t.incomeAccount)! - t.income);
    if (t.outcome && native.has(t.outcomeAccount))
      native.set(t.outcomeAccount, native.get(t.outcomeAccount)! + t.outcome);
  }
  let sum = 0;
  for (const [id, v] of native) sum += toBase(v, instr.get(id)!);
  return sum;
}

/**
 * Остаток статьи — как в «Планах» Дзен-мани: без плана — ноль; иначе не меньше
 * того, что ещё назначено на даты, и не меньше нуля. Перерасход остатком не
 * считается — он показан отдельно.
 */
export function planResidue(plan: number, fact: number, ahead: number): number {
  if (plan === 0) return 0;
  return Math.max(0, ahead, plan - fact);
}
