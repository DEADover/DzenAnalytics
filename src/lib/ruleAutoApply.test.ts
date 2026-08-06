import { describe, it, expect } from "vitest";
import { autoApplyPatches } from "./ruleAutoApply";
import type { CategoryRuleV2 } from "./ruleEngine";
import type { Transaction } from "../types";
import type { TransactionEdit } from "../store/useEditsStore";

let seq = 0;
function tx(p: Partial<Transaction> = {}): Transaction {
  return {
    id: `t${++seq}`,
    date: "2026-07-01",
    category: "Без категории",
    subcategory: null,
    categoryFull: "Без категории",
    categoryFullOriginal: "Без категории",
    payee: "Магнит",
    payeeOriginal: "Магнит",
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

function rule(p: Partial<CategoryRuleV2> = {}): CategoryRuleV2 {
  return {
    id: `r${++seq}`,
    enabled: true,
    groups: [
      {
        join: "and",
        conditions: [
          { field: "payee", op: "contains", value: "магнит", caseInsensitive: true },
        ],
      },
    ],
    join: "and",
    actions: [{ kind: "setCategory", value: "Еда" }],
    autoApply: true,
    createdAt: "2026-01-01T00:00:00Z",
    ...p,
  };
}

const noEdits: Record<string, TransactionEdit> = {};
const nothingDeleted = new Set<string>();

const run = (
  fresh: Transaction[],
  rules: CategoryRuleV2[],
  edits = noEdits,
  categoryOk: ((c: string, s: string | null) => boolean) | null = null
) => autoApplyPatches(fresh, rules, edits, nothingDeleted, categoryOk);

describe("autoApplyPatches", () => {
  it("записывает правку по правилу с автоприменением", () => {
    const t = tx();
    const out = run([t], [rule()]);
    expect(out[t.id]).toMatchObject({ category: "Еда", categoryFull: "Еда" });
  });

  it("правило без автоприменения не срабатывает", () => {
    expect(run([tx()], [rule({ autoApply: false })])).toEqual({});
    expect(run([tx()], [rule({ autoApply: undefined })])).toEqual({});
  });

  it("выключенное правило не срабатывает, даже с автоприменением", () => {
    expect(run([tx()], [rule({ enabled: false })])).toEqual({});
  });

  it("операции без совпадений правку не получают", () => {
    // Получателя подменяем в обеих формах: условие сверяется и с исходным
    // текстом банка, иначе правило перестало бы совпадать после группировки.
    const other = tx({ payee: "Пятёрочка", payeeOriginal: "Пятёрочка" });
    expect(run([other], [rule()])).toEqual({});
  });

  it("пустой список операций — пустой результат", () => {
    expect(run([], [rule()])).toEqual({});
  });

  it("не переписывает то, что уже записано тем же значением", () => {
    // Иначе каждая синхронизация плодила бы одну и ту же правку заново, и
    // «ждут отправки» не уходило бы никогда.
    const t = tx();
    const edits = { [t.id]: { category: "Еда", subcategory: null, categoryFull: "Еда" } };
    expect(run([t], [rule()], edits)).toEqual({});
  });

  it("категорию, которой нет в справочнике Дзен-мани, не записывает", () => {
    const t = tx();
    const out = run([t], [rule()], noEdits, () => false);
    expect(out).toEqual({});
  });

  it("считает только правила с автоприменением, соблюдая их порядок", () => {
    // Первое высказавшееся о поле правило и занимает поле — как и при ручной
    // записи. Правило без галочки в расчёт не идёт вовсе, даже если стоит выше.
    const t = tx();
    const out = run(
      [t],
      [
        rule({ id: "a", autoApply: false, actions: [{ kind: "setCategory", value: "Первая" }] }),
        rule({ id: "b", actions: [{ kind: "setCategory", value: "Вторая" }] }),
        rule({ id: "c", actions: [{ kind: "setCategory", value: "Третья" }] }),
      ]
    );
    expect(out[t.id].categoryFull).toBe("Вторая");
  });

  it("пишет получателя и комментарий тем же путём, что и кнопка", () => {
    const t = tx({ comment: "Купон" });
    const out = run(
      [t],
      [
        rule({
          actions: [
            { kind: "setPayee", value: "Сбербанк" },
            { kind: "appendComment", value: "[авто]" },
          ],
        }),
      ]
    );
    expect(out[t.id]).toMatchObject({ brand: "Сбербанк", comment: "Купон [авто]" });
  });
});
