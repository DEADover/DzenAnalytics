import { describe, it, expect } from "vitest";
import { buildRulePlan } from "./rulePlan";
import type { StoredRule } from "./ruleEngine";
import type { Transaction } from "../types";

function tx(p: Partial<Transaction>): Transaction {
  return {
    id: "t",
    date: "2026-07-01",
    category: "Без категории",
    subcategory: null,
    categoryFull: "Без категории",
    categoryFullOriginal: "Без категории",
    payee: "",
    comment: "",
    outcomeAccount: "Карта",
    outcomeAmount: 100,
    outcomeCurrency: "RUB",
    incomeAccount: "",
    incomeAmount: 0,
    incomeCurrency: "RUB",
    kind: "expense",
    amount: 100,
    currency: "RUB",
    account: "Карта",
    amountBase: 100,
    opAmount: null,
    opCurrency: null,
    createdAt: "2026-07-01T00:00:00Z",
    ...p,
  } as Transaction;
}

/** Правило из #49: получателя нет, категории нет, а в комментарии — купон. */
const coupon: StoredRule = {
  id: "coupon",
  enabled: true,
  title: "Купоны",
  conditions: [
    { field: "payee", op: "empty", value: "", caseInsensitive: true },
    { field: "comment", op: "contains", value: "купон", caseInsensitive: true },
  ],
  join: "and",
  actions: [
    { kind: "setCategory", value: "Доходы / Купоны" },
    { kind: "setPayee", value: "Сбербанк" },
    { kind: "prependComment", value: "[купон]" },
  ],
  createdAt: "",
};

const all = new Set(["coupon"]);
const anyCategory = () => true;

describe("план применения правил", () => {
  it("собирает «было → станет» по всем трём полям", () => {
    const t = tx({ id: "a", comment: "Выплата купона" });
    const plan = buildRulePlan([t], [coupon], all, {}, new Set(), null);

    expect(plan.rows).toHaveLength(1);
    expect(plan.pending).toHaveLength(1);
    expect(plan.rows[0].changes).toEqual([
      { label: "Категория", from: "Без категории", to: "Доходы / Купоны", state: "pending" },
      { label: "Получатель", from: "—", to: "Сбербанк", state: "pending" },
      {
        label: "Комментарий",
        from: "Выплата купона",
        to: "[купон] Выплата купона",
        state: "pending",
      },
    ]);
    expect(plan.rows[0].patch).toEqual({
      category: "Доходы",
      subcategory: "Купоны",
      categoryFull: "Доходы / Купоны",
      brand: "Сбербанк",
      comment: "[купон] Выплата купона",
    });
  });

  it("категорию берёт от Дзен-мани, а не от уже сработавшего правила", () => {
    // В `transactionsRaw` категорию правило уже переписало — «было» должно
    // показывать исходную, иначе получилось бы «Купоны → Купоны».
    const t = tx({
      id: "a",
      comment: "Выплата купона",
      category: "Доходы",
      subcategory: "Купоны",
      categoryFull: "Доходы / Купоны",
      categoryFullOriginal: "Без категории",
    });
    const plan = buildRulePlan([t], [coupon], all, {}, new Set(), null);
    expect(plan.rows[0].changes[0]).toMatchObject({
      from: "Без категории",
      to: "Доходы / Купоны",
      state: "pending",
    });
  });

  it("уже записанную правку вторым разом не предлагает", () => {
    const t = tx({ id: "a", comment: "Выплата купона" });
    const written = {
      a: {
        category: "Доходы",
        subcategory: "Купоны",
        categoryFull: "Доходы / Купоны",
        brand: "Сбербанк",
        comment: "[купон] Выплата купона",
      },
    };
    const plan = buildRulePlan([t], [coupon], all, written, new Set(), null);
    expect(plan.rows[0].status).toBe("written");
    expect(plan.rows[0].patch).toEqual({});
    expect(plan.pending).toHaveLength(0);
    // Но строка видна: пустой список сказал бы, что правило не работает.
    expect(plan.rows).toHaveLength(1);
  });

  it("правило, которое просит уже стоящее значение, помечается «уже соответствует»", () => {
    const t = tx({
      id: "a",
      comment: "[купон] Выплата купона",
      brand: "Сбербанк",
      category: "Доходы",
      subcategory: "Купоны",
      categoryFull: "Доходы / Купоны",
      categoryFullOriginal: "Доходы / Купоны",
    });
    // Получателя правило больше не найдёт (он заполнен) — берём правило только
    // по комментарию.
    const byComment: StoredRule = {
      ...coupon,
      conditions: [
        { field: "comment", op: "contains", value: "купон", caseInsensitive: true },
      ],
    };
    const plan = buildRulePlan([t], [byComment], all, {}, new Set(), null);
    expect(plan.rows[0].status).toBe("same");
    expect(plan.pending).toHaveLength(0);
  });

  it("локально удалённую операцию не трогает", () => {
    const t = tx({ id: "a", comment: "Выплата купона" });
    const plan = buildRulePlan([t], [coupon], all, {}, new Set(["a"]), null);
    expect(plan.rows).toHaveLength(0);
  });

  it("операцию с категорией, которой нет в Дзен-мани, откладывает целиком", () => {
    const t = tx({ id: "a", comment: "Выплата купона" });
    const plan = buildRulePlan([t], [coupon], all, {}, new Set(), () => false);
    expect(plan.rows[0].status).toBe("blocked");
    expect(plan.rows[0].patch).toEqual({});
    expect(plan.skipped).toEqual([{ category: "Доходы / Купоны", count: 1 }]);
    expect(plan.skippedCount).toBe(1);
    expect(plan.pending).toHaveLength(0);
  });

  it("считает только по выбранным правилам", () => {
    const other: StoredRule = {
      id: "other",
      enabled: true,
      conditions: [{ field: "comment", op: "contains", value: "купон", caseInsensitive: true }],
      join: "and",
      actions: [{ kind: "setCategory", value: "Прочее" }],
      createdAt: "",
    };
    const t = tx({ id: "a", comment: "Выплата купона" });
    const onlyOther = buildRulePlan([t], [coupon, other], new Set(["other"]), {}, new Set(), anyCategory);
    expect(onlyOther.rows[0].changes.map((c) => c.to)).toEqual(["Прочее"]);
  });

  it("выбранное выключенное правило всё равно показывается", () => {
    const t = tx({ id: "a", comment: "Выплата купона" });
    const off: StoredRule = { ...coupon, enabled: false } as StoredRule;
    const plan = buildRulePlan([t], [off], all, {}, new Set(), anyCategory);
    expect(plan.pending).toHaveLength(1);
  });

  it("без выбранных правил план пуст", () => {
    const t = tx({ id: "a", comment: "Выплата купона" });
    const plan = buildRulePlan([t], [coupon], new Set(), {}, new Set(), anyCategory);
    expect(plan.rows).toHaveLength(0);
  });

  it("читает правило первого поколения", () => {
    const v1 = {
      id: "old",
      enabled: true,
      field: "payee" as const,
      op: "contains" as const,
      value: "магнит",
      caseInsensitive: true,
      category: "Еда дома",
      createdAt: "",
    };
    const t = tx({ id: "a", payee: "Магнит" });
    const plan = buildRulePlan([t], [v1], new Set(["old"]), {}, new Set(), anyCategory);
    expect(plan.pending).toHaveLength(1);
    expect(plan.rows[0].changes[0]).toMatchObject({ to: "Еда дома", state: "pending" });
  });

  it("повторный расчёт после записи не удваивает приписку к комментарию", () => {
    const t = tx({ id: "a", comment: "Выплата купона" });
    const first = buildRulePlan([t], [coupon], all, {}, new Set(), null);
    const written = { a: first.rows[0].patch };
    const second = buildRulePlan([t], [coupon], all, written, new Set(), null);
    expect(second.pending).toHaveLength(0);
    // И сам текст не вырос.
    expect(second.rows[0].changes[2].to).toBe("[купон] Выплата купона");
  });
});

describe("устаревший получатель в правиле — issue #60", () => {
  it("контрагента больше нет в справочнике — строка блокируется, а не просится в работу", () => {
    // Правило требует «Сбербанк», но контрагента переименовали. Записать это
    // нельзя: отправка положит имя свободным текстом, при возврате из облака
    // получатель окажется пустым, и правило запросится снова — так «ждут
    // записи» и не уходило после «Применить правила».
    const t = tx({ id: "a", comment: "Выплата купона" });
    const справочник = (title: string) => title === "Сбер";
    const plan = buildRulePlan([t], [coupon], all, {}, new Set(), anyCategory, справочник);

    expect(plan.pending).toHaveLength(0);
    expect(plan.rows[0].status).toBe("blocked");
    expect(plan.rows[0].blockedPayee).toBe("Сбербанк");
  });

  it("контрагент на месте — правило работает как обычно", () => {
    const t = tx({ id: "a", comment: "Выплата купона" });
    const справочник = (title: string) => title === "Сбербанк";
    const plan = buildRulePlan([t], [coupon], all, {}, new Set(), anyCategory, справочник);

    expect(plan.rows[0].status).toBe("pending");
    expect(plan.rows[0].patch.brand).toBe("Сбербанк");
  });

  it("без подключения к Дзен-мани справочника нет — не блокируем ничего", () => {
    const t = tx({ id: "a", comment: "Выплата купона" });
    const plan = buildRulePlan([t], [coupon], all, {}, new Set(), null, null);
    expect(plan.rows[0].status).toBe("pending");
  });
});
