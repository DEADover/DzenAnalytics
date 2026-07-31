import { describe, it, expect } from "vitest";
import {
  migrateRule,
  isV2,
  conditionValues,
  conditionMatches,
  compileCondition,
  compileRuleV2,
  ruleMatchesV2,
  ruleHasEffect,
  ruleActionsToEdit,
  collectRuleHits,
  applyRulesV2,
  previewRules,
  mergeHits,
  describeRule,
  splitCategoryFull,
  type CategoryRuleV2,
  type RuleAction,
  type RuleCondition,
} from "./ruleEngine";
import type { CategoryRule } from "../store/useCategoryRulesStore";
import type { Transaction } from "../types";

function tx(p: Partial<Transaction> = {}): Transaction {
  return {
    id: "t",
    date: "2026-07-01",
    category: "Без категории",
    subcategory: null,
    categoryFull: "Без категории",
    categoryFullOriginal: "Без категории",
    payee: "",
    payeeOriginal: "",
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

function cond(p: Partial<RuleCondition> = {}): RuleCondition {
  return { field: "payee", op: "contains", value: "", caseInsensitive: true, ...p };
}

function rule(p: Partial<CategoryRuleV2> = {}): CategoryRuleV2 {
  return {
    id: "r",
    enabled: true,
    conditions: [cond({ value: "магнит" })],
    join: "and",
    actions: [{ kind: "setCategory", value: "Еда" }],
    createdAt: "2026-07-01T00:00:00Z",
    ...p,
  };
}

describe("правила — миграция первого поколения", () => {
  const old: CategoryRule = {
    id: "old",
    enabled: true,
    field: "comment",
    op: "starts_with",
    value: "Выплата купона",
    caseInsensitive: false,
    category: "Доходы / Купоны",
    createdAt: "2026-01-01T00:00:00Z",
  };

  it("разворачивает старое правило в одно условие и одно действие, ничего не теряя", () => {
    expect(isV2(old)).toBe(false);
    const v2 = migrateRule(old);
    expect(v2.id).toBe("old");
    expect(v2.createdAt).toBe("2026-01-01T00:00:00Z");
    expect(v2.join).toBe("and");
    expect(v2.conditions).toEqual([
      {
        field: "comment",
        op: "starts_with",
        value: "Выплата купона",
        caseInsensitive: false,
      },
    ]);
    expect(v2.actions).toEqual([{ kind: "setCategory", value: "Доходы / Купоны" }]);
  });

  it("правило второго поколения возвращает как есть", () => {
    const r = rule();
    expect(migrateRule(r)).toBe(r);
  });

  it("половинчатое правило из чужого бэкапа не роняет применение", () => {
    // Правила ездят в бэкапе и читаются с диска напрямую, минуя хранилище, —
    // на форму полагаться нельзя. Такое правило должно просто ничего не делать.
    const broken = { id: "x", enabled: true, createdAt: "", actions: [{ kind: "setCategory", value: "Еда" }] };
    const v2 = migrateRule(broken as unknown as CategoryRuleV2);
    expect(v2.conditions).toEqual([]);
    expect(v2.join).toBe("and");
    expect(ruleMatchesV2(tx({ payee: "Магнит" }), v2)).toBe(false);
    expect(applyRulesV2([tx({ payee: "Магнит" })], [v2])[0].categoryFull).toBe("Без категории");
  });

  it("мусор в способе объединения читается как И", () => {
    // Более строгий вариант — безопасный ответ на непонятное значение.
    const r = rule({
      join: "чепуха" as never,
      conditions: [cond({ value: "магнит" }), cond({ field: "comment", op: "contains", value: "нет" })],
    });
    expect(ruleMatchesV2(tx({ payee: "Магнит" }), r)).toBe(false);
  });

  it("мигрированное правило работает так же, как работало", () => {
    const t = tx({ comment: "Выплата купона по облигации Сбербанк" });
    expect(ruleMatchesV2(t, migrateRule(old))).toBe(true);
    expect(ruleMatchesV2(tx({ comment: "выплата купона" }), migrateRule(old))).toBe(false);
  });
});

describe("правила — условия", () => {
  it("получатель проверяется по каждой форме отдельно, а не по склейке", () => {
    // Сырой текст банка латиницей, бренд от Дзен-мани кириллицей. В первой
    // версии все формы склеивались в одну строку, и «равно» не срабатывало
    // никогда — совпасть со склейкой невозможно.
    const t = tx({
      payeeOriginal: "PYATEROCHKA 1234 MSK",
      payee: "Пятерочка 1234",
      brand: "Пятёрочка",
    });
    expect(conditionValues(t, "payee")).toEqual([
      "PYATEROCHKA 1234 MSK",
      "Пятерочка 1234",
      "Пятёрочка",
    ]);
    expect(conditionMatches(t, cond({ op: "equals", value: "Пятёрочка" }))).toBe(true);
    expect(conditionMatches(t, cond({ op: "starts_with", value: "PYATEROCHKA" }))).toBe(true);
    expect(conditionMatches(t, cond({ op: "contains", value: "1234" }))).toBe(true);
  });

  it("«не содержит» — значит ни в одной из форм получателя", () => {
    const t = tx({ payeeOriginal: "MAGNIT MM", payee: "Магнит", brand: "" });
    // Слово есть в тексте банка — правило не должно срабатывать из-за пустого бренда.
    expect(conditionMatches(t, cond({ op: "not_contains", value: "magnit" }))).toBe(false);
    expect(conditionMatches(t, cond({ op: "not_contains", value: "лента" }))).toBe(true);
  });

  it("«не заполнено» — когда пусты все формы поля", () => {
    const empty = tx({ payeeOriginal: "", payee: "", brand: "" });
    expect(conditionMatches(empty, cond({ op: "empty" }))).toBe(true);
    expect(conditionMatches(empty, cond({ op: "not_empty" }))).toBe(false);
    // Достаточно одной заполненной формы: бренд есть — получатель заполнен.
    const withBrand = tx({ payeeOriginal: "", payee: "", brand: "Сбербанк" });
    expect(conditionMatches(withBrand, cond({ op: "empty" }))).toBe(false);
    expect(conditionMatches(withBrand, cond({ op: "not_empty" }))).toBe(true);
  });

  it("«Без категории» считается незаполненной категорией", () => {
    const t = tx({ categoryFullOriginal: "Без категории" });
    expect(conditionMatches(t, cond({ field: "category", op: "empty" }))).toBe(true);
    const eda = tx({ categoryFullOriginal: "Еда" });
    expect(conditionMatches(eda, cond({ field: "category", op: "empty" }))).toBe(false);
  });

  it("категория проверяется по исходной, а не по поставленной правилом", () => {
    // Иначе правило, однажды сработавшее, перестало бы совпадать с самим собой.
    const t = tx({ categoryFullOriginal: "Без категории", categoryFull: "Еда" });
    expect(conditionMatches(t, cond({ field: "category", op: "empty" }))).toBe(true);
  });

  it("неизвестное поле не выполняется — даже «не заполнено»", () => {
    // Иначе правило из чужого бэкапа с неизвестным полем совпало бы со всем.
    const weird = cond({ field: "сумма" as never, op: "empty" });
    expect(conditionMatches(tx(), weird)).toBe(false);
    expect(conditionMatches(tx(), cond({ field: "сумма" as never, value: "x" }))).toBe(false);
  });

  it("учитывает регистр, когда флажок снят", () => {
    const t = tx({ payee: "Магнит" });
    expect(conditionMatches(t, cond({ value: "магнит", caseInsensitive: false }))).toBe(false);
    expect(conditionMatches(t, cond({ value: "магнит", caseInsensitive: true }))).toBe(true);
  });
});

describe("правила — регулярные выражения", () => {
  it("рабочее выражение находит", () => {
    const c = cond({ op: "regex", value: "^Яндекс" });
    const t = tx({ payee: "Яндекс Такси" });
    expect(conditionMatches(t, c, compileCondition(c))).toBe(true);
  });

  it("битое выражение не ломает правило — просто не совпадает", () => {
    const c = cond({ op: "regex", value: "([a-z" });
    expect(compileCondition(c)).toBeNull();
    expect(conditionMatches(tx({ payee: "abc" }), c, compileCondition(c))).toBe(false);
  });

  it("regex-бомба не собирается вовсе", () => {
    // Правила ездят в бэкапе: чужой бэкап с таким выражением иначе подвесил бы
    // вкладку насмерть. safeCompileRegex отказывается его собирать.
    const c = cond({ op: "regex", value: "(a+)+$" });
    expect(compileCondition(c)).toBeNull();
    const t = tx({ payee: "a".repeat(60) + "b" });
    expect(conditionMatches(t, c)).toBe(false);
  });

  it("compileRuleV2 собирает выражения по индексам условий", () => {
    const r = rule({
      conditions: [
        cond({ op: "contains", value: "магнит" }),
        cond({ field: "comment", op: "regex", value: "^Купон" }),
      ],
    });
    const compiled = compileRuleV2(r);
    expect(compiled.has(0)).toBe(false);
    expect(compiled.get(1)).toBeInstanceOf(RegExp);
    expect(
      ruleMatchesV2(tx({ payee: "Магнит", comment: "Купон 12" }), r, compiled)
    ).toBe(true);
  });
});

describe("правила — объединение условий", () => {
  const both = rule({
    join: "and",
    conditions: [
      cond({ field: "payee", op: "empty" }),
      cond({ field: "category", op: "empty" }),
    ],
  });

  it("И — нужны все условия", () => {
    // Сценарий из issue #49: получателя нет и категории нет.
    expect(ruleMatchesV2(tx(), both)).toBe(true);
    expect(ruleMatchesV2(tx({ brand: "Сбербанк" }), both)).toBe(false);
    expect(ruleMatchesV2(tx({ categoryFullOriginal: "Еда" }), both)).toBe(false);
  });

  it("ИЛИ — достаточно одного", () => {
    const any = rule({ ...both, join: "or" });
    expect(ruleMatchesV2(tx({ brand: "Сбербанк" }), any)).toBe(true);
    expect(ruleMatchesV2(tx({ brand: "Сбербанк", categoryFullOriginal: "Еда" }), any)).toBe(
      false
    );
  });

  it("правило без условий не подходит ни к чему", () => {
    // Пустой список — это недописанное правило, а не «применить ко всем».
    expect(ruleMatchesV2(tx(), rule({ conditions: [] }))).toBe(false);
  });
});

describe("правила — действия", () => {
  it("категория с подкатегорией разбирается на поля и нормализуется", () => {
    const patch = ruleActionsToEdit(
      tx(),
      rule({ actions: [{ kind: "setCategory", value: "Еда дома/Алкоголь" }] })
    );
    expect(patch).toEqual({
      category: "Еда дома",
      subcategory: "Алкоголь",
      categoryFull: "Еда дома / Алкоголь",
    });
  });

  it("получатель пишется в бренд", () => {
    // В интерфейсе поле называется «Получатель», но показывается и уезжает в
    // Дзен-мани именно бренд: правка `payee` на операции с брендом не была бы
    // видна вообще.
    const patch = ruleActionsToEdit(
      tx({ payee: "SBER 1234" }),
      rule({ actions: [{ kind: "setPayee", value: "Сбербанк" }] })
    );
    expect(patch).toEqual({ brand: "Сбербанк" });
    expect(patch.payee).toBeUndefined();
  });

  it("комментарий: заменить, дописать в начало, дописать в конец", () => {
    const t = tx({ comment: "Купон" });
    expect(
      ruleActionsToEdit(t, rule({ actions: [{ kind: "setComment", value: "Иное" }] }))
    ).toEqual({ comment: "Иное" });
    expect(
      ruleActionsToEdit(t, rule({ actions: [{ kind: "prependComment", value: "Облигации:" }] }))
    ).toEqual({ comment: "Облигации: Купон" });
    expect(
      ruleActionsToEdit(t, rule({ actions: [{ kind: "appendComment", value: "(авто)" }] }))
    ).toEqual({ comment: "Купон (авто)" });
  });

  it("своё значение разделителя", () => {
    const patch = ruleActionsToEdit(
      tx({ comment: "Купон" }),
      rule({ actions: [{ kind: "appendComment", value: "авто", separator: " — " }] })
    );
    expect(patch.comment).toBe("Купон — авто");
    const tight = ruleActionsToEdit(
      tx({ comment: "12" }),
      rule({ actions: [{ kind: "prependComment", value: "№", separator: "" }] })
    );
    expect(tight.comment).toBe("№12");
  });

  it("к пустому комментарию дописывает без разделителя", () => {
    expect(
      ruleActionsToEdit(tx(), rule({ actions: [{ kind: "appendComment", value: "Купон" }] }))
        .comment
    ).toBe("Купон");
  });

  it("не дописывает то, что уже дописано", () => {
    // Правила пересчитываются на каждый чих, а комментарий, уехавший в облако,
    // возвращается уже с припиской. Без проверки вышло бы «Купон Купон Купон».
    const done = tx({ comment: "Купон (авто)" });
    expect(
      ruleActionsToEdit(done, rule({ actions: [{ kind: "appendComment", value: "(авто)" }] }))
    ).toEqual({});
    const donePre = tx({ comment: "Облигации: Купон" });
    expect(
      ruleActionsToEdit(
        donePre,
        rule({ actions: [{ kind: "prependComment", value: "Облигации:" }] })
      )
    ).toEqual({});
  });

  it("пустое значение действия ничего не стирает", () => {
    // Пустой бренд обнулил бы в облаке и merchant, и payee.
    const patch = ruleActionsToEdit(
      tx({ brand: "Сбербанк", comment: "Купон" }),
      rule({
        actions: [
          { kind: "setPayee", value: "  " },
          { kind: "setComment", value: "" },
          { kind: "setCategory", value: "" },
        ],
      })
    );
    expect(patch).toEqual({});
  });

  it("действия одного правила копятся: заменили комментарий и дописали к новому", () => {
    const patch = ruleActionsToEdit(
      tx({ comment: "старое" }),
      rule({
        actions: [
          { kind: "setComment", value: "Купон" },
          { kind: "appendComment", value: "(авто)" },
        ],
      })
    );
    expect(patch.comment).toBe("Купон (авто)");
  });

  it("правило без заполненных действий ничего не делает", () => {
    expect(ruleHasEffect(rule({ actions: [] }))).toBe(false);
    expect(ruleHasEffect(rule({ actions: [{ kind: "setCategory", value: " " }] }))).toBe(false);
    expect(ruleHasEffect(rule())).toBe(true);
  });

  it("сценарий из issue #49 целиком", () => {
    const t = tx({ comment: "Выплата купона по облигации Сбербанк оббП804" });
    const r = rule({
      join: "and",
      conditions: [
        cond({ field: "payee", op: "empty" }),
        cond({ field: "category", op: "empty" }),
      ],
      actions: [
        { kind: "setCategory", value: "Доходы / Купоны" },
        { kind: "setPayee", value: "Сбербанк" },
        { kind: "appendComment", value: "[облигации]" },
      ],
    });
    expect(ruleMatchesV2(t, r)).toBe(true);
    expect(ruleActionsToEdit(t, r)).toEqual({
      category: "Доходы",
      subcategory: "Купоны",
      categoryFull: "Доходы / Купоны",
      brand: "Сбербанк",
      comment: "Выплата купона по облигации Сбербанк оббП804 [облигации]",
    });
  });
});

describe("правила — порядок и захват полей", () => {
  const comm = rule({
    id: "comm",
    conditions: [cond({ field: "comment", op: "contains", value: "купон" })],
    actions: [{ kind: "appendComment", value: "[облигации]" }],
  });
  const cat = rule({
    id: "cat",
    conditions: [cond({ field: "comment", op: "contains", value: "купон" })],
    actions: [{ kind: "setCategory", value: "Доходы / Купоны" }],
  });

  it("правило про комментарий не блокирует следующее правило про категорию", () => {
    // «Первое подошедшее правило целиком» было бы неверно: правила говорят про
    // РАЗНЫЕ поля и должны сработать оба.
    const hits = collectRuleHits(tx({ comment: "купон" }), [comm, cat]);
    expect(hits.map((h) => h.ruleId)).toEqual(["comm", "cat"]);
    expect(mergeHits(hits).t).toEqual({
      comment: "купон [облигации]",
      category: "Доходы",
      subcategory: "Купоны",
      categoryFull: "Доходы / Купоны",
    });
  });

  it("поле забирает первое высказавшееся правило", () => {
    const first = rule({ id: "a", actions: [{ kind: "setCategory", value: "Еда" }] });
    const second = rule({ id: "b", actions: [{ kind: "setCategory", value: "Красота" }] });
    const hits = collectRuleHits(tx({ payee: "Магнит" }), [first, second]);
    expect(hits).toHaveLength(1);
    expect(hits[0].ruleId).toBe("a");
    expect(hits[0].patch.categoryFull).toBe("Еда");
  });
});

describe("правила — применение к операциям (слой операций)", () => {
  it("ставит категорию и возвращает исходную, когда правило выключено", () => {
    const t = tx({ payee: "Магнит" });
    const on = applyRulesV2([t], [rule({ actions: [{ kind: "setCategory", value: "Еда" }] })]);
    expect(on[0].categoryFull).toBe("Еда");
    expect(on[0].category).toBe("Еда");
    // Выключили — вернулось к исходной, без всякой отдельной «отмены».
    const off = applyRulesV2(on, [rule({ enabled: false })]);
    expect(off[0].categoryFull).toBe("Без категории");
    // И удаление правила тоже.
    expect(applyRulesV2(on, [])[0].categoryFull).toBe("Без категории");
  });

  it("получателя и комментарий в слое операций не трогает", () => {
    // Откатывать их тут не во что: payeeOriginal — это текст банка ДО
    // группировки, а исходного комментария не хранит никто. Они применяются
    // только через слой правок.
    const t = tx({ payee: "SBER", comment: "Купон" });
    const out = applyRulesV2(
      [t],
      [
        rule({
          conditions: [cond({ field: "comment", op: "contains", value: "купон" })],
          actions: [
            { kind: "setPayee", value: "Сбербанк" },
            { kind: "appendComment", value: "[авто]" },
          ],
        }),
      ]
    );
    expect(out[0].payee).toBe("SBER");
    expect(out[0].brand).toBeUndefined();
    expect(out[0].comment).toBe("Купон");
  });

  it("применяет первое подошедшее правило с категорией", () => {
    const out = applyRulesV2(
      [tx({ payee: "Магнит Косметик" })],
      [
        rule({ id: "a", conditions: [cond({ value: "магнит" })], actions: [{ kind: "setCategory", value: "Еда" }] }),
        rule({ id: "b", conditions: [cond({ value: "косметик" })], actions: [{ kind: "setCategory", value: "Красота" }] }),
      ]
    );
    expect(out[0].categoryFull).toBe("Еда");
  });

  it("правило, которое молчит про категорию, не мешает следующему", () => {
    const out = applyRulesV2(
      [tx({ payee: "Магнит" })],
      [
        rule({ id: "a", actions: [{ kind: "appendComment", value: "x" }] }),
        rule({ id: "b", actions: [{ kind: "setCategory", value: "Еда" }] }),
      ]
    );
    expect(out[0].categoryFull).toBe("Еда");
  });

  it("применяется повторно устойчиво", () => {
    const rules = [rule({ actions: [{ kind: "setCategory", value: "Еда" }] })];
    let out = applyRulesV2([tx({ payee: "Магнит" })], rules);
    for (let i = 0; i < 3; i++) out = applyRulesV2(out, rules);
    expect(out[0].categoryFull).toBe("Еда");
    expect(out[0].categoryFullOriginal).toBe("Без категории");
  });

  it("выключенные правила и правила-пустышки пропускаются", () => {
    const t = tx({ payee: "Магнит" });
    expect(applyRulesV2([t], [rule({ enabled: false })])[0].categoryFull).toBe("Без категории");
    expect(applyRulesV2([t], [rule({ conditions: [] })])[0].categoryFull).toBe("Без категории");
    expect(applyRulesV2([t], [rule({ actions: [] })])[0].categoryFull).toBe("Без категории");
  });
});

describe("правила — предпросмотр", () => {
  const r = rule({
    id: "coupon",
    conditions: [cond({ field: "category", op: "empty" })],
    actions: [
      { kind: "setCategory", value: "Доходы / Купоны" },
      { kind: "appendComment", value: "[авто]" },
    ],
  });

  it("считает от исходников: уже применённое правило всё равно видно", () => {
    // На этих граблях первая версия стояла: предпросмотр смотрел на текущую
    // категорию и показывал ноль совпадений у сработавшего правила.
    const applied = tx({ categoryFullOriginal: "Без категории", categoryFull: "Доходы / Купоны" });
    const hits = previewRules([applied], [r]);
    expect(hits).toHaveLength(1);
    expect(hits[0].patch.categoryFull).toBe("Доходы / Купоны");
  });

  it("отбирает только выбранные правила, и невыбранные ничего не занимают", () => {
    const other = rule({
      id: "other",
      conditions: [cond({ field: "category", op: "empty" })],
      actions: [{ kind: "setCategory", value: "Прочее" }],
    });
    const hits = previewRules([tx()], [other, r], new Set(["coupon"]));
    expect(hits.map((h) => h.ruleId)).toEqual(["coupon"]);
    expect(hits[0].patch.categoryFull).toBe("Доходы / Купоны");
  });

  it("дописывание комментария устойчиво к повторам после отправки в облако", () => {
    // Круг: посчитали правку → она уехала в Дзен-мани → вернулась синхронизацией
    // в самой операции → считаем снова. Комментарий не должен расти.
    let t = tx({ comment: "Выплата купона" });
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      const patch = mergeHits(previewRules([t], [r]))[t.id] ?? {};
      t = { ...t, ...patch, categoryFullOriginal: t.categoryFullOriginal };
      seen.push(t.comment);
    }
    expect(seen).toEqual([
      "Выплата купона [авто]",
      "Выплата купона [авто]",
      "Выплата купона [авто]",
    ]);
  });

  it("выключенное правило видно, когда его выбрали галочкой", () => {
    // Само по себе выключенное правило не считается, но раз человек отметил
    // его в списке — он хочет посмотреть, что оно найдёт.
    const off = { ...r, enabled: false };
    expect(previewRules([tx()], [off])).toEqual([]);
    expect(previewRules([tx()], [off], new Set(["coupon"]))).toHaveLength(1);
  });

  it("пустой набор правил — пустой предпросмотр", () => {
    expect(previewRules([tx()], [])).toEqual([]);
    expect(previewRules([], [r])).toEqual([]);
  });
});

describe("правила — вспомогательное", () => {
  it("разбор полного названия категории", () => {
    expect(splitCategoryFull("Еда / Кафе")).toEqual({ category: "Еда", subcategory: "Кафе" });
    expect(splitCategoryFull("Еда/Кафе/Кофе")).toEqual({
      category: "Еда",
      subcategory: "Кафе / Кофе",
    });
    expect(splitCategoryFull("  ")).toEqual({ category: "Без категории", subcategory: null });
  });

  it("описание правила читается по-русски", () => {
    const r = rule({
      join: "and",
      conditions: [
        cond({ field: "payee", op: "empty" }),
        cond({ field: "comment", op: "contains", value: "купон" }),
      ],
      actions: [{ kind: "setCategory", value: "Доходы / Купоны" }] as RuleAction[],
    });
    expect(describeRule(r)).toBe(
      "Получатель не заполнено И Комментарий содержит «купон» → Категория = «Доходы / Купоны»"
    );
  });

  it("своё название правила важнее автоописания", () => {
    expect(describeRule(rule({ title: "  Купоны  " }))).toBe("Купоны");
  });
});
