import { describe, expect, it } from "vitest";
import { acceptSuggestion, buildCommentIndex, suggestComment } from "./commentSuggest";

const TODAY = Date.parse("2026-10-15");
type Op = { comment: string; date?: string; payee?: string; categoryFull?: string };
const index = (ops: Op[]) =>
  buildCommentIndex(
    ops.map((o) => ({ comment: o.comment, date: o.date ?? "2026-10-01", payee: o.payee ?? "", brand: null, categoryFull: o.categoryFull ?? "" })),
    TODAY
  );
const twice = (o: Op): Op[] => [o, o];

describe("suggestComment — фраза", () => {
  const idx = index([...twice({ comment: "Обед с коллегами" }), ...twice({ comment: "День рождения мамы" })]);

  it("набранное — начало прежнего комментария: дописываем фразу", () => {
    expect(suggestComment(idx, "Обед с")).toEqual({ from: 6, insert: " коллегами", ghost: " коллегами" });
  });

  it("регистр и «ё» не важны, хвост — как писали раньше", () => {
    expect(suggestComment(idx, "обед С К")?.ghost).toBe("оллегами");
  });

  it("принятие дописывает текст", () => {
    const s = suggestComment(idx, "День р")!;
    expect(acceptSuggestion("День р", s)).toBe("День рождения мамы");
  });

  it("встретилось один раз — не подсказка", () => {
    expect(suggestComment(index([{ comment: "Разовая покупка" }]), "Разов")).toBeNull();
  });

  it("меньше двух букв — молчим", () => {
    expect(suggestComment(idx, "О")).toBeNull();
  });
});

describe("suggestComment — слово", () => {
  const idx = index([...twice({ comment: "Пятёрочка у дома" }), ...twice({ comment: "заехали в пятёрочку" })]);

  it("начатое слово дописывается самым частым словом", () => {
    expect(suggestComment(idx, "Купили в пят")?.ghost).toMatch(/^ёрочк/);
  });

  it("короткие слова и хэштеги не подсказываем", () => {
    const tags = index(twice({ comment: "в #Отпуск" }));
    expect(suggestComment(tags, "Едем в #От")).toBeNull();
  });
});

describe("suggestComment — контекст и свежесть", () => {
  it("у этого получателя своё продолжение важнее общего", () => {
    const idx = index([
      ...twice({ comment: "Обед в офисе" }),
      ...twice({ comment: "Обед в офисе" }),
      ...twice({ comment: "Обед с семьёй", payee: "Ресторан" }),
    ]);
    expect(suggestComment(idx, "Обед ")?.ghost).toBe("в офисе");
    expect(suggestComment(idx, "Обед ", { payee: "Ресторан" })?.ghost).toBe("с семьёй");
  });

  it("при равной частоте свежее выигрывает", () => {
    const idx = index([
      ...twice({ comment: "Такси до работы", date: "2022-01-01" }),
      ...twice({ comment: "Такси до вокзала", date: "2026-09-01" }),
    ]);
    expect(suggestComment(idx, "Такси до ")?.ghost).toBe("вокзала");
  });
});

describe("suggestComment — другая раскладка", () => {
  const idx = index(twice({ comment: "День рождения" }));

  it("набрали латиницей — подсказка заменит набранное", () => {
    const s = suggestComment(idx, "Lt")!;
    expect(s.ghost).toBe(" → День рождения");
    expect(acceptSuggestion("Lt", s)).toBe("День рождения");
  });

  it("слово в другой раскладке внутри фразы", () => {
    const words = index(twice({ comment: "купили продукты" }));
    const s = suggestComment(words, "Опять ghj")!;
    expect(acceptSuggestion("Опять ghj", s)).toBe("Опять продукты");
  });
});
