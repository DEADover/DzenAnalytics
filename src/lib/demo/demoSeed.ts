import { useGoalsStore, type Goal } from "../../store/useGoalsStore";
import { useCategoryRulesStore, type NewRuleV2 } from "../../store/useCategoryRulesStore";
import type { RuleCondition } from "../ruleEngine";

/**
 * Цели и правила демо-аккаунта. Их хранит сама панель, а не Дзен-мани, поэтому
 * они не приходят синхронизацией — заводятся один раз, при первом открытии
 * демо-данных.
 */

/** «ГГГГ-ММ-ДД» через `months` месяцев от сегодня. */
function inMonths(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months, 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-01`;
}

export const DEMO_GOALS: Omit<Goal, "id" | "createdAt">[] = [
  {
    name: "Подушка безопасности",
    target: 1_500_000,
    current: 0,
    deadline: null,
    accountTitle: "Накопительный счёт",
    accountTitles: ["Накопительный счёт"],
    monthlyContribution: 18_000,
  },
  {
    name: "Отпуск в Японии",
    target: 650_000,
    current: 210_000,
    deadline: inMonths(12),
    monthlyContribution: 40_000,
  },
  {
    name: "Новая машина",
    target: 2_500_000,
    current: 0,
    deadline: inMonths(36),
    accountTitle: "Брокерский счёт",
    accountTitles: ["Брокерский счёт"],
    monthlyContribution: 25_000,
  },
  {
    name: "Ремонт детской",
    target: 300_000,
    current: 300_000,
    deadline: inMonths(-2),
  },
];

const cond = (field: RuleCondition["field"], op: RuleCondition["op"], value: string): RuleCondition => ({
  field,
  op,
  value,
  caseInsensitive: true,
});

export const DEMO_RULES: NewRuleV2[] = [
  {
    enabled: true,
    title: "Такси — в «Такси»",
    join: "and",
    conditions: [cond("payee", "contains", "Яндекс Go")],
    actions: [{ kind: "setCategory", value: "Транспорт / Такси" }],
  },
  {
    enabled: true,
    title: "Продуктовые сети — в «Продукты»",
    join: "or",
    conditions: ["Пятёрочка", "Перекрёсток", "ВкусВилл", "Лента", "Магнит"].map((p) => cond("payee", "equals", p)),
    actions: [{ kind: "setCategory", value: "Продукты" }],
  },
  {
    enabled: true,
    title: "Подписки — в «Подписки» и просмотрены",
    join: "or",
    conditions: [cond("payee", "contains", "Яндекс Плюс"), cond("payee", "contains", "Кинопоиск"), cond("payee", "contains", "Telegram")],
    actions: [
      { kind: "setCategory", value: "Подписки" },
      { kind: "markSeen", value: "1" },
    ],
  },
  {
    enabled: true,
    title: "#Отпуск — вторая категория «Путешествия»",
    join: "and",
    conditions: [cond("comment", "contains", "#Отпуск")],
    actions: [{ kind: "addTag", value: "Путешествия" }],
  },
  {
    enabled: true,
    title: "Ветклиника — #Собака в комментарий",
    join: "and",
    conditions: [cond("payee", "contains", "Ветклиника"), cond("comment", "not_contains", "#Собака")],
    actions: [{ kind: "appendComment", value: "#Собака" }],
  },
  {
    enabled: false,
    title: "Крупные траты — пометка в комментарии",
    join: "and",
    conditions: [cond("kind", "equals", "expense"), cond("amount", "gte", "30000")],
    actions: [{ kind: "prependComment", value: "Крупная трата:" }],
  },
];

/** Завести цели и правила демо — если их ещё нет. */
export async function seedDemoLocal(): Promise<void> {
  const goals = useGoalsStore.getState();
  if (!goals.loaded) await goals.hydrate();
  if (useGoalsStore.getState().goals.length === 0) {
    for (const g of DEMO_GOALS) await useGoalsStore.getState().add(g);
  }
  const rules = useCategoryRulesStore.getState();
  if (!rules.loaded) await rules.hydrate();
  if (useCategoryRulesStore.getState().rules.length === 0) {
    await useCategoryRulesStore.getState().addMany(DEMO_RULES);
  }
}
