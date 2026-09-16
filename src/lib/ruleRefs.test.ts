import { describe, it, expect } from "vitest";
import { reconcileRulesRefs, type RefDictionary } from "./ruleRefs";
import type { CategoryRuleV2 } from "./ruleEngine";

const dict: RefDictionary = {
  tags: [
    { id: "t-food", title: "Еда", parent: null },
    { id: "t-home", title: "Дома", parent: "t-food" },
    { id: "t-old", title: "Старое", parent: null, archive: true },
  ],
  accounts: [
    { id: "a-tb", title: "Т-Банк" },
    { id: "a-cash1", title: "Наличные" },
    { id: "a-cash2", title: "Наличные" },
  ],
  merchants: [{ id: "m-5", title: "Пятёрочка" }],
};

function rule(p: Partial<CategoryRuleV2>): CategoryRuleV2 {
  return {
    id: "r",
    enabled: true,
    groups: [{ join: "and", conditions: [] }],
    join: "and",
    actions: [],
    createdAt: "",
    ...p,
  };
}

const cond = (field: string, op: string, value: string, extra = {}) =>
  ({ field, op, value, caseInsensitive: true, ...extra }) as never;

describe("ссылки правил на справочники Дзен-мани", () => {
  it("проставляет id там, где значение однозначно находится", () => {
    const r = rule({
      groups: [
        {
          join: "and",
          conditions: [
            cond("category", "equals", "Еда / Дома"),
            cond("account", "equals", "Т-Банк"),
            cond("payee", "equals", "пятёрочка"),
          ],
        },
      ],
      actions: [
        { kind: "setCategory", value: "Еда" },
        { kind: "setPayee", value: "Пятёрочка" },
      ],
    });
    const { rules, changed } = reconcileRulesRefs([r], dict);
    expect(changed).toBe(true);
    const c = rules[0].groups[0].conditions as { refId?: string }[];
    expect(c.map((x) => x.refId)).toEqual(["t-home", "a-tb", "m-5"]);
    expect((rules[0].actions as { refId?: string }[]).map((a) => a.refId)).toEqual([
      "t-food",
      "m-5",
    ]);
  });

  it("переименование в Дзен-мани подтягивает новое название", () => {
    const r = rule({
      groups: [
        { join: "and", conditions: [cond("account", "equals", "Тинькофф", { refId: "a-tb" })] },
      ],
      actions: [{ kind: "setCategory", value: "Продукты / Дома", refId: "t-home" } as never],
    });
    const { rules } = reconcileRulesRefs([r], dict);
    expect(rules[0].groups[0].conditions[0].value).toBe("Т-Банк");
    expect(rules[0].actions[0].value).toBe("Еда / Дома");
  });

  it("значение, поменянное в редакторе, важнее старой ссылки", () => {
    const r = rule({
      actions: [{ kind: "setCategory", value: "Еда", refId: "t-home" } as never],
    });
    const { rules } = reconcileRulesRefs([r], dict);
    expect(rules[0].actions[0].value).toBe("Еда");
    expect((rules[0].actions[0] as { refId?: string }).refId).toBe("t-food");
  });

  it("одинаковые названия ссылку не дают — угадывать нельзя", () => {
    const r = rule({
      groups: [{ join: "and", conditions: [cond("account", "equals", "Наличные")] }],
    });
    const { rules, changed } = reconcileRulesRefs([r], dict);
    expect(changed).toBe(false);
    expect((rules[0].groups[0].conditions[0] as { refId?: string }).refId).toBeUndefined();
  });

  it("у текстовых условий, «Без категории» и ярлыков сервиса ссылки нет", () => {
    const r = rule({
      groups: [
        {
          join: "and",
          conditions: [
            cond("payee", "contains", "Пятёрочка"),
            // Раньше было «равно» со ссылкой, потом сменили на «содержит».
            cond("category", "contains", "Еда", { refId: "t-food" }),
            cond("category", "equals", "Перевод"),
          ],
        },
      ],
      actions: [{ kind: "setCategory", value: "Без категории" }],
    });
    const { rules } = reconcileRulesRefs([r], dict);
    const refs = [
      ...rules[0].groups[0].conditions,
      ...rules[0].actions,
    ].map((x) => (x as { refId?: string }).refId);
    expect(refs).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("удалённый объект: название остаётся как было", () => {
    const r = rule({
      actions: [{ kind: "setPayee", value: "Магнит", refId: "m-gone" } as never],
    });
    const { rules, changed } = reconcileRulesRefs([r], dict);
    expect(changed).toBe(false);
    expect(rules[0].actions[0].value).toBe("Магнит");
  });

  it("если менять нечего — те же объекты, changed=false", () => {
    const r = rule({
      actions: [{ kind: "setCategory", value: "Еда", refId: "t-food" } as never],
    });
    const { rules, changed } = reconcileRulesRefs([r], dict);
    expect(changed).toBe(false);
    expect(rules[0]).toBe(r);
  });
});
