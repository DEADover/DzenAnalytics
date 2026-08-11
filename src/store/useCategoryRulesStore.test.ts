import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Transaction } from "../types";

// Хранилище в памяти вместо IndexedDB: проверяем именно то, что уезжает на диск
// и что оттуда читается, — миграция поколений живёт ровно на этом стыке.
const disk = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../lib/db", () => ({
  loadJSON: async (key: string) => disk.get(key) ?? null,
  saveJSON: async (key: string, value: unknown) => {
    disk.set(key, JSON.parse(JSON.stringify(value)));
  },
}));

import {
  allConditions,
  migrateRule,
  type CategoryRuleV2Flat,
} from "../lib/ruleEngine";
import {
  useCategoryRulesStore,
  ruleMatches,
  compileRule,
  applyCategoryRules,
  describeCategoryRule,
  type CategoryRule,
  type StoredCategoryRule,
} from "./useCategoryRulesStore";

/** Правило первого поколения — то, что лежит в IndexedDB у людей. */
function rule(p: Partial<CategoryRule>): CategoryRule {
  return {
    id: "r",
    enabled: true,
    field: "payee",
    op: "contains",
    value: "",
    caseInsensitive: true,
    category: "Еда",
    createdAt: "",
    ...p,
  };
}

/** Правило второго поколения ДО групп — так оно лежит в базе у людей.
 *  Через него же проверяется, что миграция читает старую форму. */
function v2rule(p: Partial<CategoryRuleV2Flat>): CategoryRuleV2Flat {
  return {
    id: "r",
    enabled: true,
    conditions: [],
    join: "and",
    actions: [],
    createdAt: "",
    ...p,
  };
}

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

beforeEach(() => {
  disk.clear();
  useCategoryRulesStore.setState({ rules: [], loaded: false });
});

describe("правила — совпадение операции с условием", () => {
  it("ищет получателя во всех его формах, включая бренд", () => {
    // Сырой текст банка латиницей, а бренд от Дзен-мани — кириллицей.
    // Именно этот случай терял прежний предпросмотр на экране «Правила»:
    // он смотрел только в payeeOriginal и показывал меньше совпадений,
    // чем правило реально меняло.
    const t = tx({ payeeOriginal: "PYATEROCHKA 1234 MSK", payee: "Пятерочка 1234", brand: "Пятёрочка" });
    expect(ruleMatches(t, rule({ value: "Пятёрочка" }))).toBe(true);
    expect(ruleMatches(t, rule({ value: "PYATEROCHKA" }))).toBe(true);
  });

  it("учитывает регистр, когда флажок снят", () => {
    const t = tx({ payee: "Магнит" });
    expect(ruleMatches(t, rule({ value: "магнит", caseInsensitive: false }))).toBe(false);
    expect(ruleMatches(t, rule({ value: "магнит", caseInsensitive: true }))).toBe(true);
  });

  it("равно / начинается с", () => {
    const t = tx({ payee: "Аптека Ригла" });
    expect(ruleMatches(t, rule({ op: "equals", value: "Аптека Ригла" }))).toBe(true);
    expect(ruleMatches(t, rule({ op: "equals", value: "Аптека" }))).toBe(false);
    expect(ruleMatches(t, rule({ op: "starts_with", value: "Аптека" }))).toBe(true);
  });

  it("regex: рабочее выражение находит, битое — ничего не ломает", () => {
    const t = tx({ payee: "Яндекс Такси" });
    const good = rule({ op: "regex", value: "^Яндекс" });
    expect(ruleMatches(t, good, compileRule(good))).toBe(true);
    const bad = rule({ op: "regex", value: "([a-z" });
    expect(compileRule(bad)).toBeNull();
    expect(ruleMatches(t, bad, compileRule(bad))).toBe(false);
  });

  it("совпадение не зависит от того, включено правило или нет", () => {
    // Счётчик в таблице показывает совпадения и у выключенного правила —
    // иначе непонятно, что оно даст при включении.
    const t = tx({ payee: "Магнит" });
    expect(ruleMatches(t, rule({ value: "Магнит", enabled: false }))).toBe(true);
  });

  it("работает и с правилом второго поколения", () => {
    const t = tx({ payee: "", comment: "Выплата купона" });
    const v2 = v2rule({
      conditions: [
        { field: "payee", op: "empty", value: "", caseInsensitive: true },
        { field: "comment", op: "contains", value: "купон", caseInsensitive: true },
      ],
      join: "and",
      actions: [{ kind: "setCategory", value: "Доходы / Купоны" }],
    });
    expect(ruleMatches(t, v2)).toBe(true);
    expect(ruleMatches(tx({ payee: "Сбер", comment: "Выплата купона" }), v2)).toBe(false);
  });

  it("а вот применяются только включённые правила", () => {
    const t = tx({ payee: "Магнит" });
    const off = applyCategoryRules([t], [rule({ value: "Магнит", enabled: false, category: "Еда" })]);
    expect(off[0].categoryFull).toBe("Без категории");
    const on = applyCategoryRules([t], [rule({ value: "Магнит", category: "Еда" })]);
    expect(on[0].categoryFull).toBe("Еда");
  });

  it("применяется первое подошедшее правило", () => {
    const t = tx({ payee: "Магнит Косметик" });
    const out = applyCategoryRules(
      [t],
      [
        rule({ id: "a", value: "Магнит", category: "Еда" }),
        rule({ id: "b", value: "Косметик", category: "Красота" }),
      ]
    );
    expect(out[0].categoryFull).toBe("Еда");
  });

  it("смесь поколений применяется вместе", () => {
    const v1 = rule({ id: "a", value: "Магнит", category: "Еда" });
    const v2 = v2rule({
      id: "b",
      conditions: [{ field: "comment", op: "contains", value: "купон", caseInsensitive: true }],
      join: "and",
      actions: [{ kind: "setCategory", value: "Доходы / Купоны" }],
    });
    const out = applyCategoryRules(
      [tx({ id: "x", payee: "Магнит" }), tx({ id: "y", comment: "Выплата купона" })],
      [v1, v2]
    );
    expect(out[0].categoryFull).toBe("Еда");
    expect(out[1].categoryFull).toBe("Доходы / Купоны");
    expect(out[1].subcategory).toBe("Купоны");
  });
});

describe("правила — автоприменение", () => {
  it("галочка доживает до диска и переживает следующую правку", async () => {
    // Нормализация пересобирает правило по полям, и новое поле теряется, если
    // его не пронести явно: галочка в таблице ставилась и тут же слетала.
    disk.clear();
    useCategoryRulesStore.setState({ rules: [], loaded: true });
    await useCategoryRulesStore.getState().add({
      enabled: true,
      conditions: [{ field: "payee", op: "contains", value: "магнит", caseInsensitive: true }],
      join: "and",
      actions: [{ kind: "setCategory", value: "Еда" }],
    });
    const id = useCategoryRulesStore.getState().rules[0].id;

    await useCategoryRulesStore.getState().update(id, { autoApply: true });
    expect(useCategoryRulesStore.getState().rules[0].autoApply).toBe(true);
    expect((disk.get("categoryRules") as { autoApply?: boolean }[])[0].autoApply).toBe(true);

    // Правка любого другого поля галочку не сбрасывает.
    await useCategoryRulesStore.getState().update(id, { title: "Магнит" });
    expect(useCategoryRulesStore.getState().rules[0].autoApply).toBe(true);

    await useCategoryRulesStore.getState().update(id, { autoApply: false });
    expect(useCategoryRulesStore.getState().rules[0].autoApply).toBeUndefined();
  });

  it("правило первого поколения автоприменения не получает", async () => {
    disk.set("categoryRules", [
      {
        id: "old",
        enabled: true,
        field: "payee",
        op: "contains",
        value: "магнит",
        caseInsensitive: true,
        category: "Еда",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ]);
    useCategoryRulesStore.setState({ rules: [], loaded: false });
    await useCategoryRulesStore.getState().hydrate();
    expect(useCategoryRulesStore.getState().rules[0].autoApply).toBe(false);
  });
});

describe("правила — хранилище", () => {
  it("читает смесь поколений и разворачивает старые правила", async () => {
    const stored = [
      {
        id: "old",
        enabled: true,
        field: "payee",
        op: "contains",
        value: "магнит",
        caseInsensitive: true,
        category: "Еда",
        createdAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "new",
        enabled: true,
        title: "Купоны",
        conditions: [{ field: "comment", op: "contains", value: "купон", caseInsensitive: true }],
        join: "and",
        actions: [{ kind: "setCategory", value: "Доходы / Купоны" }],
        createdAt: "2026-06-01T00:00:00Z",
      },
    ];
    disk.set("categoryRules", stored);
    await useCategoryRulesStore.getState().hydrate();

    const rules = useCategoryRulesStore.getState().rules;
    expect(rules).toHaveLength(2);
    // Старое правило получило условия и действия, не потеряв ни поля.
    expect(allConditions(migrateRule(rules[0]))).toEqual([
      { field: "payee", op: "contains", value: "магнит", caseInsensitive: true },
    ]);
    expect(rules[0].actions).toEqual([{ kind: "setCategory", value: "Еда" }]);
    expect(rules[0].createdAt).toBe("2026-01-01T00:00:00Z");
    expect(rules[1].title).toBe("Купоны");
    // И оба продолжают работать.
    expect(ruleMatches(tx({ payee: "Магнит" }), rules[0])).toBe(true);
    expect(ruleMatches(tx({ comment: "купон" }), rules[1])).toBe(true);
  });

  it("старое правило переживает правку и уезжает на диск уже в новой форме", async () => {
    // У людей в IndexedDB лежат правила первого поколения. Прочитать их мало —
    // после любой правки они должны сохраниться в новой форме и продолжить
    // работать, ничего не потеряв.
    disk.set("categoryRules", [
      {
        id: "old",
        enabled: true,
        field: "payee",
        op: "contains",
        value: "магнит",
        caseInsensitive: true,
        category: "Еда",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ]);
    await useCategoryRulesStore.getState().hydrate();
    await useCategoryRulesStore.getState().update("old", { enabled: false });

    const saved = (disk.get("categoryRules") as StoredCategoryRule[])[0];
    expect(saved.enabled).toBe(false);
    expect(allConditions(migrateRule(saved))).toEqual([
      { field: "payee", op: "contains", value: "магнит", caseInsensitive: true },
    ]);
    expect(saved.actions).toEqual([{ kind: "setCategory", value: "Еда" }]);
    expect(saved.createdAt).toBe("2026-01-01T00:00:00Z");
    for (const key of ["field", "op", "value", "caseInsensitive", "category"])
      expect(saved).not.toHaveProperty(key);
    expect(ruleMatches(tx({ payee: "Магнит" }), saved)).toBe(true);
  });

  it("пустое и битое хранилище не роняет чтение", async () => {
    await useCategoryRulesStore.getState().hydrate();
    expect(useCategoryRulesStore.getState().rules).toEqual([]);
    expect(useCategoryRulesStore.getState().loaded).toBe(true);
  });

  it("сохраняет только второе поколение — без плоской проекции", async () => {
    await useCategoryRulesStore.getState().hydrate();
    await useCategoryRulesStore.getState().add({
      enabled: true,
      title: "Купоны",
      conditions: [
        { field: "payee", op: "empty", value: "", caseInsensitive: true },
        { field: "category", op: "empty", value: "", caseInsensitive: true },
      ],
      join: "and",
      actions: [
        { kind: "setCategory", value: "Доходы / Купоны" },
        { kind: "setPayee", value: "Сбербанк" },
      ],
    });
    const saved = disk.get("categoryRules") as StoredCategoryRule[];
    expect(saved).toHaveLength(1);
    expect(allConditions(migrateRule(saved[0]))).toHaveLength(2);
    expect(saved[0].actions).toHaveLength(2);
    // Плоских полей первого поколения на диске больше нет: два представления
    // одного правила в одной записи — это два источника истины.
    for (const key of ["field", "op", "value", "caseInsensitive", "category"])
      expect(saved[0]).not.toHaveProperty(key);
    expect(saved[0].id).toBeTruthy();
    expect(saved[0].createdAt).toBeTruthy();
  });

  it("правило первого поколения при сохранении обрастает условиями", async () => {
    await useCategoryRulesStore.getState().hydrate();
    await useCategoryRulesStore.getState().add({
      enabled: true,
      field: "payee",
      op: "contains",
      value: "магнит",
      caseInsensitive: true,
      category: "Еда",
    });
    const saved = disk.get("categoryRules") as StoredCategoryRule[];
    expect(allConditions(migrateRule(saved[0]))).toEqual([
      { field: "payee", op: "contains", value: "магнит", caseInsensitive: true },
    ]);
    expect(saved[0].actions).toEqual([{ kind: "setCategory", value: "Еда" }]);
  });

  it("два РАЗНЫХ правила второго поколения добавляются оба", async () => {
    // Ключ дублей раньше считался по полям первого поколения — у правил v2 они
    // все пустые, ключ совпадал, и второе правило молча не добавлялось.
    await useCategoryRulesStore.getState().hydrate();
    const base = {
      enabled: true,
      join: "and" as const,
      conditions: [{ field: "comment" as const, op: "contains" as const, value: "купон", caseInsensitive: true }],
      actions: [{ kind: "setCategory" as const, value: "Доходы / Купоны" }],
    };
    await useCategoryRulesStore.getState().add(base);
    await useCategoryRulesStore.getState().add({
      ...base,
      conditions: [{ field: "comment", op: "contains", value: "дивиденд", caseInsensitive: true }],
      actions: [{ kind: "setCategory", value: "Доходы / Дивиденды" }],
    });
    expect(useCategoryRulesStore.getState().rules).toHaveLength(2);
  });

  it("а одинаковое по смыслу правило второй раз не заводится", async () => {
    await useCategoryRulesStore.getState().hydrate();
    const draft = {
      enabled: true,
      field: "payee" as const,
      op: "contains" as const,
      value: "магнит",
      caseInsensitive: true,
      category: "Еда",
    };
    await useCategoryRulesStore.getState().add(draft);
    await useCategoryRulesStore.getState().add(draft);
    expect(useCategoryRulesStore.getState().rules).toHaveLength(1);
    // И то же правило, записанное в новой форме, тоже дубль.
    await useCategoryRulesStore.getState().add({
      enabled: true,
      join: "and",
      conditions: [{ field: "payee", op: "contains", value: "магнит", caseInsensitive: true }],
      actions: [{ kind: "setCategory", value: "Еда" }],
    });
    expect(useCategoryRulesStore.getState().rules).toHaveLength(1);
  });

  it("addMany отсеивает дубли внутри пачки", async () => {
    await useCategoryRulesStore.getState().hydrate();
    const draft = {
      enabled: true,
      field: "payee" as const,
      op: "contains" as const,
      value: "лента",
      caseInsensitive: true,
      category: "Еда",
    };
    const added = await useCategoryRulesStore.getState().addMany([
      draft,
      draft,
      { ...draft, value: "окей" },
    ]);
    expect(added).toBe(2);
  });

  it("правка правила, пришедшего из первого поколения, работает по условиям", async () => {
    // Правило добавлено в старой форме, а правится уже новой — на диске после
    // этого должно остаться ровно то, что показывает редактор.
    await useCategoryRulesStore.getState().hydrate();
    await useCategoryRulesStore.getState().add({
      enabled: true,
      field: "payee",
      op: "contains",
      value: "магнит",
      caseInsensitive: true,
      category: "Еда",
    });
    const id = useCategoryRulesStore.getState().rules[0].id;
    await useCategoryRulesStore.getState().update(id, {
      title: "Купоны",
      conditions: [{ field: "comment", op: "regex", value: "^Купон", caseInsensitive: false }],
      actions: [{ kind: "setCategory", value: "Доходы / Купоны" }],
    });
    const r = useCategoryRulesStore.getState().rules[0];
    expect(r.title).toBe("Купоны");
    expect(allConditions(migrateRule(r))).toEqual([
      { field: "comment", op: "regex", value: "^Купон", caseInsensitive: false },
    ]);
    expect(r.actions).toEqual([{ kind: "setCategory", value: "Доходы / Купоны" }]);
    expect(applyCategoryRules([tx({ comment: "Купон Сбер" })], [r])[0].categoryFull).toBe(
      "Доходы / Купоны"
    );
  });

  it("переключение флажка не трогает условия", async () => {
    await useCategoryRulesStore.getState().hydrate();
    await useCategoryRulesStore.getState().add({
      enabled: true,
      join: "and",
      conditions: [
        { field: "payee", op: "empty", value: "", caseInsensitive: true },
        { field: "category", op: "empty", value: "", caseInsensitive: true },
      ],
      actions: [{ kind: "setCategory", value: "Доходы" }],
    });
    const id = useCategoryRulesStore.getState().rules[0].id;
    await useCategoryRulesStore.getState().update(id, { enabled: false });
    expect(allConditions(migrateRule(useCategoryRulesStore.getState().rules[0]))).toHaveLength(2);
  });

  it("порядок правил меняется и сохраняется", async () => {
    await useCategoryRulesStore.getState().hydrate();
    await useCategoryRulesStore.getState().addMany([
      { enabled: true, field: "payee", op: "contains", value: "a", caseInsensitive: true, category: "A" },
      { enabled: true, field: "payee", op: "contains", value: "b", caseInsensitive: true, category: "B" },
    ]);
    const [first, second] = useCategoryRulesStore.getState().rules;
    await useCategoryRulesStore.getState().move(second.id, -1);
    const cat = (r: StoredCategoryRule) => r.actions[0]?.value;
    expect(useCategoryRulesStore.getState().rules.map(cat)).toEqual(["B", "A"]);
    expect((disk.get("categoryRules") as StoredCategoryRule[]).map(cat)).toEqual(["B", "A"]);
    // Несуществующее правило и выход за границы — молча ничего.
    await useCategoryRulesStore.getState().move("нет такого", 1);
    await useCategoryRulesStore.getState().move(first.id, 1);
    expect(useCategoryRulesStore.getState().rules).toHaveLength(2);
  });

  it("удаление правила", async () => {
    await useCategoryRulesStore.getState().hydrate();
    await useCategoryRulesStore.getState().add({
      enabled: true,
      field: "payee",
      op: "contains",
      value: "магнит",
      caseInsensitive: true,
      category: "Еда",
    });
    const id = useCategoryRulesStore.getState().rules[0].id;
    await useCategoryRulesStore.getState().remove(id);
    expect(useCategoryRulesStore.getState().rules).toEqual([]);
    expect(disk.get("categoryRules")).toEqual([]);
  });

  it("удаление всех действий необратимо — из старых плоских полей они не воскресают", async () => {
    await useCategoryRulesStore.getState().hydrate();
    await useCategoryRulesStore.getState().add({
      enabled: true,
      field: "payee",
      op: "contains",
      value: "магнит",
      caseInsensitive: true,
      category: "Еда",
    });
    const id = useCategoryRulesStore.getState().rules[0].id;
    await useCategoryRulesStore.getState().update(id, { actions: [] });
    const r = useCategoryRulesStore.getState().rules[0];
    expect(r.actions).toEqual([]);
    // И такое правило ничего не меняет.
    expect(applyCategoryRules([tx({ payee: "Магнит" })], [r])[0].categoryFull).toBe(
      "Без категории"
    );
  });

  it("правило с условиями, но без действий читается без падения", async () => {
    // Может прилететь из чужого бэкапа или из будущей версии.
    disk.set("categoryRules", [
      {
        id: "half",
        enabled: true,
        createdAt: "",
        conditions: [{ field: "payee", op: "contains", value: "магнит", caseInsensitive: true }],
      },
    ]);
    await useCategoryRulesStore.getState().hydrate();
    const r = useCategoryRulesStore.getState().rules[0];
    expect(r.actions).toEqual([]);
    expect(applyCategoryRules([tx({ payee: "Магнит" })], [r])[0].categoryFull).toBe(
      "Без категории"
    );
  });

  it("описание правила берётся из его условий", () => {
    const r = v2rule({
      conditions: [{ field: "payee", op: "empty", value: "", caseInsensitive: true }],
      actions: [{ kind: "setPayee", value: "Сбербанк" }],
    });
    expect(describeCategoryRule(r)).toBe("Получатель не заполнено → Получатель = «Сбербанк»");
  });
});

describe("переименование контрагента в правилах — issue #60", () => {
  beforeEach(async () => {
    disk.clear();
    await useCategoryRulesStore.getState().hydrate();
  });

  const withPayee = (value: string, condValue = value) => ({
    enabled: true,
    title: "П",
    conditions: [{ field: "payee" as const, op: "equals" as const, value: condValue, caseInsensitive: false }],
    join: "and" as const,
    actions: [{ kind: "setPayee" as const, value }],
  });

  it("меняет имя и в действии, и в точном условии", async () => {
    const store = useCategoryRulesStore.getState();
    await store.add(withPayee("Старое"));
    const touched = await useCategoryRulesStore.getState().renamePayee("Старое", "Новое");
    expect(touched).toBe(1);
    const r = useCategoryRulesStore.getState().rules[0];
    expect(r.actions?.[0].value).toBe("Новое");
    expect(allConditions(migrateRule(r))[0].value).toBe("Новое");
  });

  it("не трогает «содержит» — там значение это кусок строки", async () => {
    const store = useCategoryRulesStore.getState();
    await store.add({
      enabled: true,
      title: "П",
      conditions: [{ field: "payee", op: "contains", value: "Старое", caseInsensitive: false }],
      join: "and",
      actions: [{ kind: "setCategory", value: "Еда" }],
    });
    const touched = await useCategoryRulesStore.getState().renamePayee("Старое", "Новое");
    expect(touched).toBe(0);
    expect(allConditions(migrateRule(useCategoryRulesStore.getState().rules[0]))[0].value).toBe("Старое");
  });

  it("чужие имена не задевает", async () => {
    const store = useCategoryRulesStore.getState();
    await store.add(withPayee("Другое"));
    expect(await useCategoryRulesStore.getState().renamePayee("Старое", "Новое")).toBe(0);
  });

  it("переименование в себя — не операция", async () => {
    const store = useCategoryRulesStore.getState();
    await store.add(withPayee("Имя"));
    expect(await useCategoryRulesStore.getState().renamePayee("Имя", "Имя")).toBe(0);
  });
});

describe("reorder — перетаскивание правил", () => {
  const mk = (id: string) =>
    ({
      id,
      name: id,
      enabled: true,
      order: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      match: "all",
      groups: [{ id: "g" + id, join: "all", conditions: [] }],
      actions: [],
    }) as unknown as StoredCategoryRule;
  const ids = () => useCategoryRulesStore.getState().rules.map((r) => r.id);

  beforeEach(() => {
    useCategoryRulesStore.setState({ rules: [mk("a"), mk("b"), mk("c"), mk("d")], loaded: true });
  });

  it("вынимает правило и вставляет на новое место, а не меняет местами", async () => {
    // Через десяток строк обмен местами дал бы совсем другой порядок.
    await useCategoryRulesStore.getState().reorder("a", 2);
    expect(ids()).toEqual(["b", "c", "a", "d"]);
  });

  it("перетаскивание снизу вверх", async () => {
    await useCategoryRulesStore.getState().reorder("d", 0);
    expect(ids()).toEqual(["d", "a", "b", "c"]);
  });

  it("бросок на своё же место ничего не меняет", async () => {
    await useCategoryRulesStore.getState().reorder("b", 1);
    expect(ids()).toEqual(["a", "b", "c", "d"]);
  });

  it("индекс за пределами списка прижимается к краю", async () => {
    await useCategoryRulesStore.getState().reorder("a", 99);
    expect(ids()).toEqual(["b", "c", "d", "a"]);
  });
});
