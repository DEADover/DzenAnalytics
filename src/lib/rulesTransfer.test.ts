import { describe, it, expect } from "vitest";
import {
  RULES_FILE_APP,
  buildRulesFile,
  countRuleModes,
  withRuleMode,
  parseRulesFile,
  rulesFileName,
  sanitizeImportedRule,
} from "./rulesTransfer";
import type { CategoryRuleV2 } from "./ruleEngine";

const full: CategoryRuleV2 = {
  id: "r1",
  enabled: true,
  title: "Кофе",
  groups: [
    {
      join: "or",
      conditions: [
        { field: "payee", op: "equals", value: "Кофемания", caseInsensitive: true, refId: "m1" },
        { field: "comment", op: "regex", value: "^кофе", caseInsensitive: false },
      ],
    },
    { join: "and", conditions: [{ field: "amount", op: "lt", value: "1000", caseInsensitive: true }] },
  ],
  join: "and",
  actions: [
    { kind: "setCategory", value: "Кафе / Кофе", refId: "t1" },
    { kind: "appendComment", value: "#кофе", separator: "" },
  ],
  autoApply: true,
  schedule: { every: "day", everyN: 2, depth: "month", depthN: 3 },
  createdAt: "2026-05-01T10:00:00.000Z",
};

describe("файл правил", () => {
  it("выгрузка и разбор возвращают правила один в один", () => {
    const file = buildRulesFile([full], new Date("2026-09-16T12:00:00Z"));
    expect(file).toMatchObject({ app: RULES_FILE_APP, type: "rules", v: 1 });
    const parsed = parseRulesFile(JSON.stringify(file));
    expect(parsed).toEqual({ ok: true, rules: [full], invalid: 0 });
  });

  it("имя файла с датой", () => {
    expect(rulesFileName(new Date(2026, 8, 6))).toBe("dzenanalytics-rules-2026-09-06.json");
  });

  it("понимает голый массив и полный бэкап", () => {
    expect(parseRulesFile(JSON.stringify([full]))).toMatchObject({ ok: true, rules: [full] });
    const backup = { version: 3, exportedAt: "x", transactions: [], categoryRules: [full] };
    expect(parseRulesFile(JSON.stringify(backup))).toMatchObject({ ok: true, rules: [full] });
  });

  it("понятные ошибки вместо падения", () => {
    expect(parseRulesFile("{битый")).toMatchObject({ ok: false });
    expect(parseRulesFile(JSON.stringify({ hello: 1 }))).toMatchObject({ ok: false });
    expect(parseRulesFile("[]")).toMatchObject({ ok: false });
    const newer = { app: RULES_FILE_APP, type: "rules", v: 99, rules: [full] };
    expect(parseRulesFile(JSON.stringify(newer))).toMatchObject({ ok: false });
  });
});

describe("проверка правила из файла", () => {
  it("правило первого поколения разворачивается в нынешнюю форму", () => {
    const r = sanitizeImportedRule({
      id: "old",
      enabled: false,
      field: "payee",
      op: "contains",
      value: "Пятёрочка",
      caseInsensitive: true,
      category: "Продукты",
      createdAt: "2025-01-01",
    });
    expect(r).toMatchObject({
      id: "old",
      enabled: false,
      groups: [{ conditions: [{ field: "payee", op: "contains", value: "Пятёрочка" }] }],
      actions: [{ kind: "setCategory", value: "Продукты" }],
    });
  });

  it("плоский список условий сворачивается в группу со своей связкой", () => {
    const r = sanitizeImportedRule({
      id: "flat",
      join: "or",
      conditions: [{ field: "payee", op: "contains", value: "а", caseInsensitive: true }],
      actions: [{ kind: "setPayee", value: "Б" }],
    });
    expect(r?.groups).toEqual([
      { join: "or", conditions: [{ field: "payee", op: "contains", value: "а", caseInsensitive: true }] },
    ]);
    expect(r?.join).toBe("and");
  });

  it("одно непонятное условие или действие — отбрасывается всё правило, а не его часть", () => {
    const badCond = structuredClone(full) as unknown as { groups: { conditions: object[] }[] };
    badCond.groups[0].conditions.push({ field: "weather", op: "equals", value: "дождь" });
    expect(sanitizeImportedRule(badCond)).toBeNull();

    const badOp = structuredClone(full) as unknown as { groups: { conditions: object[] }[] };
    // «Больше» у текстового поля не бывает.
    badOp.groups[0].conditions[0] = { field: "payee", op: "gt", value: "1" };
    expect(sanitizeImportedRule(badOp)).toBeNull();

    const badAction = { ...full, actions: [...full.actions, { kind: "deleteAll", value: "" }] };
    expect(sanitizeImportedRule(badAction)).toBeNull();

    expect(sanitizeImportedRule({ ...full, actions: [{ kind: "setCategory", value: 5 }] })).toBeNull();
    expect(sanitizeImportedRule("правило")).toBeNull();
  });

  it("чужие поля не протаскиваются, непонятное расписание снимается", () => {
    const r = sanitizeImportedRule({ ...full, hack: "<script>", schedule: { every: "week", depth: "all" } });
    expect(r).not.toHaveProperty("hack");
    expect(r).not.toHaveProperty("schedule");
    expect(r?.autoApply).toBe(true);
  });

  it("битые правила считаются, годные проходят", () => {
    const parsed = parseRulesFile(JSON.stringify([full, { id: "x" }, null]));
    expect(parsed).toMatchObject({ ok: true, invalid: 2 });
    expect(parsed.ok && parsed.rules.map((r) => r.id)).toEqual(["r1"]);
  });
});

describe("режим правил при переносе", () => {
  const manual = { ...full, id: "m", autoApply: undefined };
  const off = { ...full, id: "o", enabled: false, autoApply: true };

  it("«как было» ничего не меняет", () => {
    const rules = [full, manual, off];
    expect(withRuleMode(rules, "keep")).toEqual(rules);
    expect(countRuleModes(rules)).toEqual({ auto: 1, manual: 1, off: 1 });
  });

  it("один режим для всех: оба поля задаются явно, расписание остаётся", () => {
    const out = withRuleMode([full, off], "manual");
    expect(out.map((r) => [r.enabled, r.autoApply])).toEqual([
      [true, false],
      [true, false],
    ]);
    expect(out[0].schedule).toEqual(full.schedule);
    expect(countRuleModes(withRuleMode([full, manual], "off"))).toEqual({ auto: 0, manual: 0, off: 2 });
  });
});
