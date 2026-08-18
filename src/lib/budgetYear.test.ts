import { describe, it, expect } from "vitest";
import { buildBudgetYear, categoryPathKey, rowIsLive, yearDiff } from "./budgetYear";
import type { BudgetLine } from "./budgets";
import type { Transaction } from "../types";

let seq = 0;
function tx(p: Partial<Transaction>): Transaction {
  return {
    id: `t${++seq}`,
    date: "2026-01-15",
    amount: 0,
    amountBase: 0,
    currency: "RUB",
    kind: "expense",
    category: "Еда",
    subcategory: null,
    payee: "",
    comment: "",
    account: "Карта",
    ...(p as object),
  } as Transaction;
}

function line(p: Partial<BudgetLine>): BudgetLine {
  return {
    id: `l${++seq}`,
    category: "Еда",
    subcategory: null,
    kind: "expense",
    amount: 0,
    recurrence: "monthly",
    startMonth: "2026-01",
    endMonth: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...p,
  };
}

describe("yearDiff", () => {
  it("у расхода это остаток: план минус факт", () => {
    expect(yearDiff({ plan: 10_000, fact: 8000 }, "expense")).toBe(2000);
    expect(yearDiff({ plan: 10_000, fact: 12_000 }, "expense")).toBe(-2000);
  });

  it("у дохода наоборот: факт минус план", () => {
    // Перевыполнить план по доходу — хорошо, поэтому знак зеркальный.
    expect(yearDiff({ plan: 50_000, fact: 60_000 }, "income")).toBe(10_000);
    expect(yearDiff({ plan: 50_000, fact: 40_000 }, "income")).toBe(-10_000);
  });

  it("«больше нуля» в обоих разделах значит одно и то же — «хорошо»", () => {
    const goodExpense = yearDiff({ plan: 100, fact: 50 }, "expense");
    const goodIncome = yearDiff({ plan: 100, fact: 150 }, "income");
    expect(goodExpense).toBeGreaterThan(0);
    expect(goodIncome).toBeGreaterThan(0);
  });
});

describe("buildBudgetYear", () => {
  it("раскладывает план и факт по месяцам года", () => {
    const r = buildBudgetYear(
      [line({ amount: 10_000 })],
      [tx({ date: "2026-03-10", amountBase: 8000 })],
      2026
    );
    const g = r.expense.groups[0];
    expect(r.months).toHaveLength(12);
    expect(g.total.cells[2]).toEqual({ plan: 10_000, fact: 8000 });
    expect(g.total.cells[3]).toEqual({ plan: 10_000, fact: 0 });
    expect(g.total.plan).toBe(120_000);
    expect(g.total.fact).toBe(8000);
  });

  it("месяцы вне окна строки плана не получают", () => {
    const r = buildBudgetYear(
      [line({ amount: 10_000, startMonth: "2026-06", endMonth: "2026-07" })],
      [],
      2026
    );
    const cells = r.expense.groups[0].total.cells;
    expect(cells.map((c) => c.plan)).toEqual([0, 0, 0, 0, 0, 10_000, 10_000, 0, 0, 0, 0, 0]);
  });

  it("операции соседних лет не попадают", () => {
    const r = buildBudgetYear(
      [],
      [
        tx({ date: "2025-12-31", amountBase: 5000 }),
        tx({ date: "2027-01-01", amountBase: 5000 }),
        tx({ date: "2026-01-01", amountBase: 1000 }),
      ],
      2026
    );
    expect(r.expense.fact).toBe(1000);
  });

  it("свод категории = родитель + под-категории", () => {
    const r = buildBudgetYear(
      [
        line({ amount: 10_000 }),
        line({ subcategory: "Кафе", amount: 5000 }),
      ],
      [
        tx({ date: "2026-02-10", amountBase: 9000 }),
        tx({ date: "2026-02-11", amountBase: 4000, subcategory: "Кафе" }),
      ],
      2026
    );
    const g = r.expense.groups[0];
    expect(g.parent.cells[1]).toEqual({ plan: 10_000, fact: 9000 });
    expect(g.subs).toHaveLength(1);
    expect(g.total.cells[1]).toEqual({ plan: 15_000, fact: 13_000 });
  });

  it("статья без плана, но с тратами, в отчёт попадает", () => {
    // Годовой отчёт, где потраченного не видно, отчётом не является.
    const r = buildBudgetYear([], [tx({ date: "2026-05-01", amountBase: 3000, category: "Дом" })], 2026);
    expect(r.expense.groups.map((g) => g.category)).toEqual(["Дом"]);
    expect(r.expense.fact).toBe(3000);
  });

  it("статья без плана и без трат за год выпадает", () => {
    const r = buildBudgetYear(
      [line({ category: "Дом", amount: 0, overrides: { "2025-05": 1000 } })],
      [],
      2026
    );
    expect(r.expense.groups).toEqual([]);
  });

  it("переводы и «Без категории» не считаются", () => {
    const r = buildBudgetYear(
      [],
      [
        tx({ date: "2026-04-01", amountBase: 50_000, kind: "transfer" }),
        tx({ date: "2026-04-02", amountBase: 700, category: "Без категории" }),
      ],
      2026
    );
    expect(r.expense.groups).toEqual([]);
    expect(r.expense.fact).toBe(0);
  });

  it("возвраты уменьшают факт месяца", () => {
    const r = buildBudgetYear(
      [],
      [
        tx({ date: "2026-04-01", amountBase: 5000 }),
        tx({ date: "2026-04-02", amountBase: 2000, kind: "refund" }),
      ],
      2026
    );
    expect(r.expense.totals[3].fact).toBe(3000);
  });

  it("дельта считается помесячно по плану и по факту", () => {
    const r = buildBudgetYear(
      [line({ amount: 10_000 }), line({ category: "Зарплата", kind: "income", amount: 50_000 })],
      [
        tx({ date: "2026-01-10", amountBase: 12_000 }),
        tx({ date: "2026-01-11", amountBase: 60_000, kind: "income", category: "Зарплата" }),
      ],
      2026
    );
    expect(r.delta[0]).toEqual({ plan: 40_000, fact: 48_000 });
    expect(r.delta[1]).toEqual({ plan: 40_000, fact: 0 });
  });

  it("по умолчанию категории идут по алфавиту", () => {
    // Порядок по названию — тот, к которому привыкли по справочнику категорий:
    // у статьи всегда одно место, и её находят глазами, а не пересчитывают
    // заново после каждой траты (issue #68).
    const r = buildBudgetYear(
      [],
      [
        tx({ date: "2026-01-10", amountBase: 1000, category: "Еда" }),
        tx({ date: "2026-01-10", amountBase: 9000, category: "Дом" }),
      ],
      2026
    );
    expect(r.expense.groups.map((g) => g.category)).toEqual(["Дом", "Еда"]);
  });

  it("порядок «по сумме» ставит крупные статьи наверх", () => {
    const txs = [
      tx({ date: "2026-01-10", amountBase: 9000, category: "Еда" }),
      tx({ date: "2026-01-10", amountBase: 1000, category: "Дом" }),
    ];
    expect(
      buildBudgetYear([], txs, 2026, undefined, "amount").expense.groups.map((g) => g.category)
    ).toEqual(["Еда", "Дом"]);
    expect(
      buildBudgetYear([], txs, 2026, undefined, "alpha").expense.groups.map((g) => g.category)
    ).toEqual(["Дом", "Еда"]);
  });

  it("под-категории идут тем же порядком, что и категории", () => {
    const txs = [
      tx({ date: "2026-01-10", amountBase: 1000, category: "Еда", subcategory: "Кафе" }),
      tx({ date: "2026-01-11", amountBase: 9000, category: "Еда", subcategory: "Аптека" }),
    ];
    const subs = (o: "alpha" | "amount") =>
      buildBudgetYear([], txs, 2026, undefined, o).expense.groups[0].subs.map(
        (s) => s.subcategory
      );
    expect(subs("alpha")).toEqual(["Аптека", "Кафе"]);
    expect(subs("amount")).toEqual(["Аптека", "Кафе"]); // 9000 > 1000
    const swapped = [
      tx({ date: "2026-01-10", amountBase: 9000, category: "Еда", subcategory: "Кафе" }),
      tx({ date: "2026-01-11", amountBase: 1000, category: "Еда", subcategory: "Аптека" }),
    ];
    expect(
      buildBudgetYear([], swapped, 2026, undefined, "amount").expense.groups[0].subs.map(
        (s) => s.subcategory
      )
    ).toEqual(["Кафе", "Аптека"]);
  });

  it("залоченный план категории уже включает под-категории", () => {
    // «Животные 36 000» с замком в Дзен-мани — это ВСЯ категория: планы «Кота»
    // и «Собаки» внутри неё, и складывать их второй раз нельзя.
    const r = buildBudgetYear(
      [
        line({ category: "Животные", amount: 0, overrides: { "2026-08": 36_000 }, locks: { "2026-08": true } }),
        line({ category: "Животные", subcategory: "Кот", amount: 0, overrides: { "2026-08": 10_000 } }),
        line({ category: "Животные", subcategory: "Собака", amount: 0, overrides: { "2026-08": 25_000 } }),
      ],
      [
        tx({ date: "2026-08-05", amountBase: 4151, category: "Животные", subcategory: "Кот" }),
        tx({ date: "2026-08-06", amountBase: 7632, category: "Животные", subcategory: "Собака" }),
      ],
      2026
    );
    const g = r.expense.groups.find((x) => x.category === "Животные")!;
    expect(g.total.cells[7].plan).toBe(36_000);
    // Факт по-прежнему складывается: он про деньги, а не про замок.
    expect(g.total.cells[7].fact).toBe(11_783);
    expect(r.expense.totals[7].plan).toBe(36_000);
  });

  it("без замка план категории — своё плюс под-категории", () => {
    const r = buildBudgetYear(
      [
        line({ category: "Еда дома", amount: 0, overrides: { "2026-08": 50_000 } }),
        line({ category: "Еда дома", subcategory: "Алкоголь", amount: 0, overrides: { "2026-08": 5000 } }),
      ],
      [],
      2026
    );
    const g = r.expense.groups.find((x) => x.category === "Еда дома")!;
    expect(g.total.cells[7].plan).toBe(55_000);
  });

  it("замок действует помесячно", () => {
    // В августе замок есть, в сентябре — нет: сентябрь снова складывается.
    const r = buildBudgetYear(
      [
        line({
          category: "Животные",
          amount: 0,
          overrides: { "2026-08": 36_000, "2026-09": 36_000 },
          locks: { "2026-08": true },
        }),
        line({ category: "Животные", subcategory: "Кот", amount: 0, overrides: { "2026-08": 10_000, "2026-09": 10_000 } }),
      ],
      [],
      2026
    );
    const g = r.expense.groups.find((x) => x.category === "Животные")!;
    expect(g.total.cells[7].plan).toBe(36_000);
    expect(g.total.cells[8].plan).toBe(46_000);
  });

  it("назначенная операция даёт план статье, у которой своего плана нет", () => {
    // Оплата назначена на 20-е, сумма известна — статья должна быть видна в
    // своде до самого списания, а не появляться задним числом.
    const r = buildBudgetYear([], [], 2026, undefined, "alpha", [
      { kind: "expense", category: "Дети", subcategory: "Садик", ym: "2026-09", amount: 12_000, ahead: 12_000, aheadOps: [] },
    ]);
    const g = r.expense.groups.find((x) => x.category === "Дети")!;
    expect(g.total.cells[8].plan).toBe(12_000); // сентябрь
    expect(g.total.cells[8].fact).toBe(0);
    expect(g.subs[0].subcategory).toBe("Садик");
    expect(r.expense.totals[8].plan).toBe(12_000);
    // Признак поднимается на свод категории: по нему таблица не прячет строку
    // как «без операций за год».
    expect(g.total.scheduled).toBe(true);
  });

  it("свой план назначенной операцией не удваивается", () => {
    // Дзен-мани прибавляет запланированные операции к плану сам — если план
    // есть, второй раз их считать нельзя.
    const r = buildBudgetYear(
      [line({ category: "Дети", kind: "expense", amount: 20_000 })],
      [],
      2026,
      undefined,
      "alpha",
      [{ kind: "expense", category: "Дети", subcategory: null, ym: "2026-09", amount: 12_000, ahead: 12_000, aheadOps: [] }]
    );
    const g = r.expense.groups.find((x) => x.category === "Дети")!;
    expect(g.total.cells[8].plan).toBe(20_000);
  });

  it("периметр счетов отсекает чужие операции, а перевод наружу становится статьёй", () => {
    const txs = [
      tx({ date: "2026-03-01", amountBase: 1000, account: "Карта" }),
      tx({ date: "2026-03-02", amountBase: 5000, account: "Наличные" }),
      tx({
        date: "2026-03-03",
        kind: "transfer",
        category: "Переводы",
        account: "Карта",
        outcomeAccount: "Карта",
        incomeAccount: "Накопительный",
        amountBase: 30_000,
      }),
    ];
    const scope = { accounts: new Set(["Карта"]), perimeterTransfers: true };
    const r = buildBudgetYear([], txs, 2026, scope);
    expect(r.expense.groups.map((g) => [g.category, g.total.fact])).toEqual([
      ["Еда", 1000],
      ["Переводы", 30_000],
    ]);
  });

  it("переводы идут последней строкой, а не по величине суммы", () => {
    // Это не статья расходов в ряду прочих, а оборот по счетам: место ему в
    // конце списка, каким бы ни был порядок остальных (issue #68).
    const scope = { accounts: new Set<string>(), perimeterTransfers: true };
    const r = buildBudgetYear(
      [],
      [
        tx({ date: "2026-01-10", amountBase: 900_000, category: "Дом" }),
        tx({ date: "2026-01-11", amountBase: 500_000, category: "Еда" }),
        tx({
          date: "2026-01-12",
          kind: "transfer",
          category: "Переводы",
          account: "Карта",
          outcomeAccount: "Карта",
          incomeAccount: "Накопительный",
          amountBase: 100,
        }),
      ],
      2026,
      scope,
      "amount"
    );
    // Сумма перевода — самая маленькая, но дело не в ней: даже с порядком «по
    // сумме» переводы стоят в конце.
    expect(r.expense.groups.map((g) => g.category)).toEqual(["Дом", "Еда", "Переводы"]);
    expect(r.income.groups.map((g) => g.category)).toEqual(["Переводы"]);
    // Остальные — по убыванию факта.
    expect(r.expense.groups[0].total.fact).toBeGreaterThan(r.expense.groups[1].total.fact);
  });

  it("перевод внутри бюджета виден и в расходах, и в доходах", () => {
    const scope = { accounts: new Set<string>(), perimeterTransfers: true };
    const r = buildBudgetYear(
      [],
      [
        tx({
          date: "2026-03-03",
          kind: "transfer",
          category: "Переводы",
          account: "Карта",
          outcomeAccount: "Карта",
          incomeAccount: "Накопительный",
          amountBase: 200,
        }),
      ],
      2026,
      scope
    );
    expect(r.expense.groups.map((g) => [g.category, g.total.fact])).toEqual([["Переводы", 200]]);
    expect(r.income.groups.map((g) => [g.category, g.total.fact])).toEqual([["Переводы", 200]]);
    // Под-категория — счёт на той стороне: видно, куда ушло и откуда пришло.
    expect(r.expense.groups[0].parent.subcategory).toBeNull();
    expect(r.expense.groups[0].subs[0].subcategory).toBe("Накопительный");
    expect(r.income.groups[0].subs[0].subcategory).toBe("Карта");
  });

  it("итог считается дважды: без переводов и вместе с ними", () => {
    const scope = { accounts: new Set<string>(), perimeterTransfers: true };
    const r = buildBudgetYear(
      [],
      [
        tx({ date: "2026-03-01", amountBase: 5000 }),
        tx({
          date: "2026-03-03",
          kind: "transfer",
          category: "Переводы",
          account: "Карта",
          outcomeAccount: "Карта",
          incomeAccount: "Накопительный",
          amountBase: 200,
        }),
      ],
      2026,
      scope
    );
    // «Сколько потрачено» и «сколько прошло по счетам» — разные вопросы.
    expect(r.expense.fact).toBe(5000);
    expect(r.expense.factAll).toBe(5200);
    expect(r.expense.totals[2].fact).toBe(5000);
    expect(r.expense.totalsAll[2].fact).toBe(5200);
    // Статья «Перевод» помечена — по ней и делится итог.
    expect(r.expense.groups.find((g) => g.category === "Переводы")?.transfer).toBe(true);
    expect(r.expense.groups.find((g) => g.category === "Еда")?.transfer).toBeUndefined();
  });

  it("перевод внутри бюджета не двигает разницу", () => {
    const scope = { accounts: new Set<string>(), perimeterTransfers: true };
    const transfer = tx({
      date: "2026-03-03",
      kind: "transfer",
      category: "Переводы",
      account: "Карта",
      outcomeAccount: "Карта",
      incomeAccount: "Накопительный",
      amountBase: 200,
    });
    const without = buildBudgetYear([], [tx({ date: "2026-03-01", amountBase: 5000 })], 2026, scope);
    const withTr = buildBudgetYear(
      [],
      [tx({ date: "2026-03-01", amountBase: 5000 }), transfer],
      2026,
      scope
    );
    // Обе ноги гасят друг друга — иначе «Разница» врала бы на каждый перевод.
    expect(withTr.delta[2].fact).toBe(without.delta[2].fact);
  });

  it("перевод наружу разницу двигает — деньги действительно ушли", () => {
    const scope = { accounts: new Set(["Карта"]), perimeterTransfers: true };
    const r = buildBudgetYear(
      [],
      [
        tx({
          date: "2026-03-03",
          kind: "transfer",
          category: "Переводы",
          account: "Карта",
          outcomeAccount: "Карта",
          incomeAccount: "Чужой",
          amountBase: 200,
        }),
      ],
      2026,
      scope
    );
    expect(r.delta[2].fact).toBe(-200);
  });

  it("без настройки оба итога совпадают", () => {
    const r = buildBudgetYear([], [tx({ date: "2026-01-10", amountBase: 1000 })], 2026);
    expect(r.expense.fact).toBe(r.expense.factAll);
    expect(r.expense.totals).toEqual(r.expense.totalsAll);
  });

  it("доходы и расходы под одним тегом идут в разные разделы", () => {
    const r = buildBudgetYear(
      [],
      [
        tx({ date: "2026-01-10", amountBase: 1000, category: "Банки" }),
        tx({ date: "2026-01-11", amountBase: 1500, category: "Банки", kind: "income" }),
      ],
      2026
    );
    expect(r.expense.fact).toBe(1000);
    expect(r.income.fact).toBe(1500);
  });
});

describe("свод — невидимая разница в имени статьи", () => {
  it("хвостовой пробел в названии не разводит статью на две строки", () => {
    // Так выглядели жалобы на «задвоения»: в плане статья записана с пробелом
    // на конце, в операциях — без него, и в своде появлялись две одинаковых с
    // виду строки, а итог категории складывался из обеих.
    const lines: BudgetLine[] = [
      {
        id: "l1",
        category: "Банк",
        subcategory: "Cash back ",
        kind: "income",
        amount: 0,
        recurrence: "monthly",
        startMonth: "2026-01",
        endMonth: null,
        overrides: { "2026-08": 4000 },
        createdAt: "",
      },
    ];
    const txs = [
      {
        id: "t1",
        date: "2026-08-05",
        amount: 1000,
        amountBase: 1000,
        currency: "RUB",
        kind: "income",
        account: "Сбер",
        incomeAccount: "Сбер",
        category: "Банк",
        subcategory: "Cash back",
        categoryFull: "Банк / Cash back",
      },
    ] as unknown as Transaction[];

    const report = buildBudgetYear(lines, txs, 2026);
    const bank = report.income.groups.find((g) => g.category === "Банк")!;
    expect(bank.subs).toHaveLength(1);
    expect(bank.subs[0].cells[7]).toEqual({ plan: 4000, fact: 1000 });
  });
});

describe("статьи переименованных категорий (#77)", () => {
  const live = (...paths: [string, string | null][]) =>
    new Set(paths.map(([c, s]) => categoryPathKey(c, s)));
  const names = (report: ReturnType<typeof buildBudgetYear>) =>
    [...report.expense.groups, ...report.income.groups].map((g) => g.category);

  it("КЛЮЧЕВОЕ: статья с планом, но с именем, которого больше нет, из отчёта уходит", () => {
    // Категорию переименовали в Дзен-мани: факт уехал на новое имя, а строка
    // со старым осталась с планом — и висела в отчёте с нулём.
    const report = buildBudgetYear(
      [line({ category: "Еда", overrides: { "2026-01": 10_000 } })],
      [],
      2026,
      undefined,
      undefined,
      [],
      live(["Питание", null])
    );
    expect(names(report)).not.toContain("Еда");
  });

  it("КЛЮЧЕВОЕ: живая статья с планом и без трат остаётся", () => {
    // В этом весь смысл плана: показать, что деньги заложены, а не потрачены.
    const report = buildBudgetYear(
      [line({ category: "Еда", overrides: { "2026-01": 10_000 } })],
      [],
      2026,
      undefined,
      undefined,
      [],
      live(["Еда", null])
    );
    expect(names(report)).toContain("Еда");
  });

  it("история удалённой категории с тратами остаётся", () => {
    // Из прошлого статьи не вычёркивают: деньги были потрачены.
    const report = buildBudgetYear(
      [],
      [tx({ category: "Хобби", amountBase: 500 })],
      2026,
      undefined,
      undefined,
      [],
      live(["Еда", null])
    );
    expect(names(report)).toContain("Хобби");
  });

  it("без справочника (режим CSV) не отсеиваем ничего", () => {
    const report = buildBudgetYear(
      [line({ category: "Еда", overrides: { "2026-01": 10_000 } })],
      [],
      2026
    );
    expect(names(report)).toContain("Еда");
  });

  it("под-статья переименованного родителя тоже уходит", () => {
    const report = buildBudgetYear(
      [line({ category: "Еда", subcategory: "Кафе", overrides: { "2026-01": 3000 } })],
      [],
      2026,
      undefined,
      undefined,
      [],
      live(["Питание", null], ["Питание", "Кафе"])
    );
    expect(names(report)).not.toContain("Еда");
  });
});

describe("статья с назначенной операцией", () => {
  const planned = (over: Record<string, unknown> = {}) => ({
    kind: "expense" as const,
    category: "Госуслуги",
    subcategory: "Налог на имущество",
    ym: "2026-10",
    amount: 3000,
    ahead: 3000,
    aheadOps: [],
    ...over,
  });

  it("КЛЮЧЕВОЕ: под-статья, у которой только назначенная оплата, видна наравне с категорией", () => {
    // Жалоба пользователя: «статья не вывелась с суммой, но в общем итоге
    // есть». Под-категории отбирались только по факту, а назначенная оплата
    // фактом ещё не стала — строка исчезала, хотя её сумма входила в план
    // категории.
    const report = buildBudgetYear([], [], 2026, undefined, undefined, [planned()]);
    const group = report.expense.groups.find((g) => g.category === "Госуслуги")!;
    const sub = group.subs.find((s) => s.subcategory === "Налог на имущество")!;
    expect(sub.plan).toBe(3000);
    expect(sub.scheduled).toBe(true);
    expect(rowIsLive(sub)).toBe(true);
    // И сама категория тоже: иначе строку негде было бы раскрыть.
    expect(rowIsLive(group.total)).toBe(true);
  });

  it("сумма назначенной операции входит в план категории", () => {
    const report = buildBudgetYear(
      [],
      [],
      2026,
      undefined,
      undefined,
      [planned(), planned({ subcategory: "Налог самозанятого", amount: 2920, ahead: 2920 })]
    );
    const group = report.expense.groups.find((g) => g.category === "Госуслуги")!;
    expect(group.total.plan).toBe(5920);
    expect(group.subs.map((s) => s.subcategory).sort()).toEqual([
      "Налог на имущество",
      "Налог самозанятого",
    ]);
  });
});

describe("rowIsLive — одно правило для категорий и под-категорий", () => {
  it("назначенная операция делает строку живой без единой траты", () => {
    expect(rowIsLive({ fact: 0, scheduled: true })).toBe(true);
  });

  it("пустая строка живой не считается", () => {
    expect(rowIsLive({ fact: 0 })).toBe(false);
  });

  it("копеечный хвост от пересчёта курса — это ноль", () => {
    // На экране такая строка всё равно «0», и «движением» её считать нельзя.
    expect(rowIsLive({ fact: 0.004 })).toBe(false);
    expect(rowIsLive({ fact: 0.005 })).toBe(true);
  });
});
