import { describe, it, expect } from "vitest";
import {
  forgetOrigins,
  handEditedFields,
  markRuleFields,
  markUserFields,
  seedOrigins,
  userEdits,
} from "./editOrigins";
import type { TransactionEdit } from "../store/useEditsStore";

const edits = (o: Record<string, TransactionEdit>) => o;

describe("разметка происхождения правок", () => {
  it("правило занимает поля, которые записало", () => {
    const o = markRuleFields({}, "t1", ["category", "categoryFull"]);
    expect(o.t1.sort()).toEqual(["category", "categoryFull"]);
  });

  it("рука отбирает поле у правила — человек всегда последний", () => {
    const o = markRuleFields({}, "t1", ["category", "comment"]);
    expect(markUserFields(o, "t1", ["comment"]).t1).toEqual(["category"]);
  });

  it("когда у правила не осталось полей, запись уходит целиком", () => {
    const o = markRuleFields({}, "t1", ["comment"]);
    expect(markUserFields(o, "t1", ["comment"])).toEqual({});
  });

  it("удалённая правка уносит с собой и разметку", () => {
    const o = markRuleFields({}, "t1", ["comment"]);
    expect(forgetOrigins(o, ["t1"])).toEqual({});
  });
});

describe("userEdits — что видят правила", () => {
  it("КЛЮЧЕВОЕ: правило видит ручную правку и не видит своей", () => {
    // Ровно случай из issue #75: комментарий поправлен руками — правило должно
    // о нём знать; категорию записало само правило — её оно видеть не должно,
    // иначе следующий пересчёт покажет ноль совпадений.
    const all = edits({ t1: { comment: "Дивиденды", categoryFull: "Доход / Дивиденды" } });
    const origins = markRuleFields({}, "t1", ["categoryFull"]);
    expect(userEdits(all, origins)).toEqual({ t1: { comment: "Дивиденды" } });
  });

  it("правка без разметки считается ручной", () => {
    const all = edits({ t1: { comment: "мой" } });
    expect(userEdits(all, {})).toEqual(all);
  });

  it("операция, где всё записано правилом, из выборки уходит", () => {
    const all = edits({ t1: { categoryFull: "Еда" } });
    const origins = markRuleFields({}, "t1", ["categoryFull"]);
    expect(userEdits(all, origins)).toEqual({});
  });
});

describe("handEditedFields — что автоприменению трогать нельзя", () => {
  it("поля, правленные руками", () => {
    const all = edits({ t1: { comment: "мой", categoryFull: "Еда" } });
    const origins = markRuleFields({}, "t1", ["categoryFull"]);
    expect([...handEditedFields(all, origins, "t1")]).toEqual(["comment"]);
  });

  it("у операции без правок неприкосновенного нет", () => {
    expect(handEditedFields({}, {}, "t1").size).toBe(0);
  });
});

describe("seedOrigins — разовая разметка накопленного", () => {
  it("всё уже записанное считаем сделанным правилами", () => {
    // Так поведение для существующих данных остаётся прежним: правила
    // сопоставляются с исходником, как и до появления разметки.
    const all = edits({ t1: { comment: "старая", categoryFull: "Еда" }, t2: {} });
    expect(seedOrigins(all)).toEqual({ t1: ["comment", "categoryFull"] });
  });
});
