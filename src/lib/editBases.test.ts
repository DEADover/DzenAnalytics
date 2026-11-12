import { describe, expect, it } from "vitest";
import { forgetBases, recordBases, staleFields } from "./editBases";
import { tx } from "../test/fixtures";

const T0 = 1_000_000;

describe("recordBases — от какой версии сделана правка", () => {
  it("запоминает облачное значение и время по каждому полю", () => {
    const server = tx({ id: "a", comment: "Было", payee: "Магнит" });
    const b = recordBases({}, "a", { comment: "Стало" }, server, T0);
    expect(b).toEqual({ a: { comment: { base: "Было", at: T0 } } });
  });

  it("повторная правка поля сохраняет прежнюю версию, время — новое", () => {
    const server1 = tx({ id: "a", comment: "Было" });
    const b1 = recordBases({}, "a", { comment: "Раз" }, server1, T0);
    const server2 = tx({ id: "a", comment: "Другое" });
    const b2 = recordBases(b1, "a", { comment: "Два", payee: "X" }, server2, T0 + 5);
    expect(b2.a!.comment).toEqual({ base: "Было", at: T0 + 5 });
    expect(b2.a!.payee).toEqual({ base: server2.payee, at: T0 + 5 });
  });

  it("операции нет в данных (черновик) — версии нет", () => {
    expect(recordBases({}, "draft", { comment: "x" }, undefined, T0)).toEqual({});
  });

  it("forgetBases убирает операции и не трогает карту без них", () => {
    const b = recordBases({}, "a", { comment: "x" }, tx({ id: "a" }), T0);
    expect(forgetBases(b, ["a"])).toEqual({});
    expect(forgetBases(b, ["z"])).toBe(b);
  });
});

describe("staleFields — что облако поменяло позже правки", () => {
  const server0 = tx({ id: "a", comment: "Было", payee: "Магнит", category: "Еда", subcategory: "Хлеб", categoryFull: "Еда / Хлеб" });

  it("поле изменено в облаке позже — снимается", () => {
    const edit = { comment: "Здесь" };
    const bases = recordBases({}, "a", edit, server0, T0).a;
    expect(staleFields(edit, bases, { ...server0, comment: "С телефона" }, T0 + 1)).toEqual(["comment"]);
  });

  it("изменено раньше правки — правка новее, остаётся", () => {
    const edit = { comment: "Здесь" };
    const bases = recordBases({}, "a", edit, server0, T0).a;
    expect(staleFields(edit, bases, { ...server0, comment: "С телефона" }, T0 - 1)).toEqual([]);
  });

  it("поменяли другое поле — правка остаётся", () => {
    const edit = { comment: "Здесь" };
    const bases = recordBases({}, "a", edit, server0, T0).a;
    expect(staleFields(edit, bases, { ...server0, payee: "Пятёрочка" }, T0 + 1)).toEqual([]);
  });

  it("категория снимается вместе с подкатегорией и полным путём", () => {
    const edit = { category: "Дом", subcategory: null, categoryFull: "Дом" };
    const bases = recordBases({}, "a", edit, server0, T0).a;
    const phone = { ...server0, category: "Кафе", subcategory: null, categoryFull: "Кафе" };
    expect(staleFields(edit, bases, phone, T0 + 1).sort()).toEqual(["category", "categoryFull", "subcategory"]);
  });

  it("пусто и null — одно и то же: пустой комментарий не считается изменением", () => {
    const s = tx({ id: "a", comment: "" });
    const edit = { comment: "Здесь" };
    const bases = recordBases({}, "a", edit, s, T0).a;
    expect(staleFields(edit, bases, { ...s, comment: null as unknown as string }, T0 + 1)).toEqual([]);
  });

  it("правка без версии (сделана до меток) — как раньше, остаётся", () => {
    expect(staleFields({ comment: "Здесь" }, undefined, { ...server0, comment: "С телефона" }, T0 + 1)).toEqual([]);
  });
});
