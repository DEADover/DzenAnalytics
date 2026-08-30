import { describe, it, expect } from "vitest";
import {
  evalAmount,
  splitProblem,
  splitRemainder,
  spreadRemainder,
  type SplitDraftPart,
} from "./splitTransaction";

const part = (over: Partial<SplitDraftPart> = {}): SplitDraftPart => ({
  key: "k1",
  category: "Еда",
  subcategory: null,
  amount: 0,
  pinned: false,
  ...over,
});

describe("splitRemainder", () => {
  it("считает, сколько ещё не хватает", () => {
    const parts = [part({ key: "a", amount: 700 }), part({ key: "b", amount: 300 })];
    expect(splitRemainder(1000, parts)).toBe(0);
    expect(splitRemainder(1200, parts)).toBe(200);
  });

  it("перебор показывает отрицательным числом", () => {
    const parts = [part({ key: "a", amount: 700 }), part({ key: "b", amount: 500 })];
    expect(splitRemainder(1000, parts)).toBe(-200);
  });

  it("копеечный хвост после деления — это ноль, а не расхождение", () => {
    // 100 на три части: 33,33 + 33,33 + 33,34. Хвосты не должны мешать
    // сохранить разбивку.
    const parts = [
      part({ key: "a", amount: 33.33 }),
      part({ key: "b", amount: 33.33 }),
      part({ key: "c", amount: 33.34 }),
    ];
    expect(splitRemainder(100, parts)).toBe(0);
  });
});

describe("spreadRemainder", () => {
  it("разбивка надвое: ввёл одну сумму — вторая стала остатком", () => {
    // Ровно то поведение, которого ждёшь от деления пополам.
    const parts = [
      part({ key: "a", amount: 700, pinned: true }),
      part({ key: "b", amount: 0 }),
    ];
    expect(spreadRemainder(1000, parts).map((p) => p.amount)).toEqual([700, 300]);
  });

  it("незаполненные строки делят остаток поровну", () => {
    const parts = [
      part({ key: "a", amount: 400, pinned: true }),
      part({ key: "b" }),
      part({ key: "c" }),
    ];
    expect(spreadRemainder(1000, parts).map((p) => p.amount)).toEqual([400, 300, 300]);
  });

  it("копейка от деления достаётся последней строке, а не теряется", () => {
    const out = spreadRemainder(100, [part({ key: "a" }), part({ key: "b" }), part({ key: "c" })]);
    expect(out.map((p) => p.amount)).toEqual([33.33, 33.33, 33.34]);
    expect(splitRemainder(100, out)).toBe(0);
  });

  it("введённые руками суммы не трогает никогда", () => {
    // Число, которое человек только что напечатал, не должно уплывать само.
    const parts = [
      part({ key: "a", amount: 700, pinned: true }),
      part({ key: "b", amount: 200, pinned: true }),
    ];
    expect(spreadRemainder(1000, parts).map((p) => p.amount)).toEqual([700, 200]);
    // О расхождении скажет остаток, а не самовольная правка.
    expect(splitRemainder(1000, spreadRemainder(1000, parts))).toBe(100);
  });

  it("ввели больше суммы операции — свободной строке достаётся ноль", () => {
    // Отрицательная сумма в части бессмысленна: пусть будет видно, что
    // разнесли лишнее, и это скажет проверка.
    const parts = [
      part({ key: "a", amount: 1200, pinned: true }),
      part({ key: "b" }),
    ];
    expect(spreadRemainder(1000, parts).map((p) => p.amount)).toEqual([1200, 0]);
  });
});

describe("splitProblem", () => {
  const ok = () => [
    part({ key: "a", category: "Еда", amount: 700 }),
    part({ key: "b", category: "Дом", amount: 300 }),
  ];

  it("сошлось — можно сохранять", () => {
    expect(splitProblem(1000, ok())).toBeNull();
  });

  it("одной части мало", () => {
    expect(splitProblem(1000, [part({ key: "a", amount: 1000 })])).toBe(
      "Нужны хотя бы две части"
    );
  });

  it("часть без категории не пропускаем", () => {
    const parts = ok();
    parts[1].category = "";
    expect(splitProblem(1000, parts)).toBe("У каждой части должна быть своя категория");
  });

  it("перебор виден раньше, чем обнулившаяся часть", () => {
    // Свободная часть при переборе обнуляется, и жалоба на нулевую сумму
    // показывала бы на неё — а виновата та, где перебрали.
    const parts = [
      part({ key: "a", category: "Еда", amount: 1200 }),
      part({ key: "b", category: "Дом", amount: 0 }),
    ];
    expect(splitProblem(1000, parts)).toBe("Больше суммы операции на 200");
  });

  it("нулевая часть не пропускается", () => {
    const parts = [
      part({ key: "a", category: "Еда", amount: 1000 }),
      part({ key: "b", category: "Дом", amount: 0 }),
    ];
    expect(splitProblem(1000, parts)).toBe("У каждой части должна быть сумма больше нуля");
  });

  it("не сошлось — говорим, сколько именно", () => {
    const parts = ok();
    parts[1].amount = 200;
    expect(splitProblem(1000, parts)).toBe("Не хватает 100");
    parts[1].amount = 500;
    expect(splitProblem(1000, parts)).toBe("Больше суммы операции на 200");
  });

  it("две части с одной категорией — это не разбивка", () => {
    // В аналитике они сложились бы обратно, и смысла в такой разбивке нет.
    const parts = [
      part({ key: "a", category: "Еда", amount: 700 }),
      part({ key: "b", category: "Еда", amount: 300 }),
    ];
    expect(splitProblem(1000, parts)).toBe("Категории частей должны различаться");
  });

  it("одна категория, но разные подкатегории — разбивка законная", () => {
    const parts = [
      part({ key: "a", category: "Еда", subcategory: "Кафе", amount: 700 }),
      part({ key: "b", category: "Еда", subcategory: "Продукты", amount: 300 }),
    ];
    expect(splitProblem(1000, parts)).toBeNull();
  });
});

describe("evalAmount", () => {
  it("считает то, что складывают из чека", () => {
    expect(evalAmount("1200+300")).toBe(1500);
    expect(evalAmount("2400/2")).toBe(1200);
    expect(evalAmount("199*3")).toBe(597);
    expect(evalAmount("1000-150")).toBe(850);
  });

  it("умножение и деление считаются раньше сложения", () => {
    expect(evalAmount("100+2*50")).toBe(200);
    expect(evalAmount("(100+2)*50")).toBe(5100);
  });

  it("запятая — это разделитель дробной части", () => {
    expect(evalAmount("10,5+4,5")).toBe(15);
    expect(evalAmount("1 200 + 300")).toBe(1500);
  });

  it("обычное число проходит как есть", () => {
    expect(evalAmount("1500")).toBe(1500);
    expect(evalAmount("1500,25")).toBe(1500.25);
  });

  it("округляет до копеек", () => {
    // 0.1 + 0.2 в двоичной арифметике даёт хвост, а в сумме частей он потом
    // не сошёлся бы с исходной операцией.
    expect(evalAmount("0,1+0,2")).toBe(0.3);
    expect(evalAmount("100/3")).toBe(33.33);
  });

  it("знак перед числом понимаем", () => {
    expect(evalAmount("-100")).toBe(-100);
    expect(evalAmount("500+-100")).toBe(400);
    // Плюс перед числом разбирается так же, как минус: «12++3» это 12 + (+3),
    // а не опечатка, которую надо отвергнуть. Считать одно и не считать
    // другое было бы непоследовательно.
    expect(evalAmount("12++3")).toBe(15);
  });

  it("мусор и битые выражения — это не число", () => {
    expect(evalAmount("")).toBeNull();
    expect(evalAmount("   ")).toBeNull();
    expect(evalAmount("абв")).toBeNull();
    expect(evalAmount("12+*3")).toBeNull();
    expect(evalAmount("1)2")).toBeNull();
    expect(evalAmount("(100")).toBeNull();
    expect(evalAmount("100+")).toBeNull();
  });

  it("деление на ноль — не число, а не бесконечность", () => {
    expect(evalAmount("100/0")).toBeNull();
  });

  it("код в поле суммы не выполняется", () => {
    // Разбор свой, а не `eval`: строку пишет человек, и пускать её в
    // интерпретатор нельзя даже в своём приложении.
    expect(evalAmount("alert(1)")).toBeNull();
    expect(evalAmount("1;alert(1)")).toBeNull();
    expect(evalAmount("process.exit")).toBeNull();
  });
});
