import { describe, it, expect } from "vitest";
import {
  allowanceRatio,
  dailyAllowance,
  freeSpentToday,
  freeToSpend,
  incomePlanTotal,
  incomeStillToCome,
  moneyBreakdown,
  planRemainder,
  spendableAccounts,
  type PlanRow,
  type SpendableAccount,
} from "./freeMoney";

const acc = (p: Partial<SpendableAccount> & { title: string }): SpendableAccount => ({
  balanceBase: 0,
  type: "ccard",
  savings: false,
  archive: false,
  offBalance: false,
  ...p,
});

describe("spendableAccounts", () => {
  it("берёт карты, наличные и обычные счета", () => {
    const list = [
      acc({ title: "Карта", type: "ccard" }),
      acc({ title: "Наличные", type: "cash" }),
      acc({ title: "Счёт", type: "checking" }),
    ];
    expect(spendableAccounts(list).map((a) => a.title)).toEqual([
      "Карта",
      "Наличные",
      "Счёт",
    ]);
  });

  it("не берёт накопительные, вклады и долговые", () => {
    const list = [
      acc({ title: "Нак. счёт", type: "checking", savings: true }),
      acc({ title: "Вклад", type: "deposit", savings: true }),
      acc({ title: "Кредит", type: "loan" }),
      acc({ title: "Долги", type: "debt" }),
    ];
    expect(spendableAccounts(list)).toEqual([]);
  });

  it("не берёт архивные и внебалансовые", () => {
    const list = [
      acc({ title: "Старая", archive: true }),
      acc({ title: "Брокерский", offBalance: true }),
    ];
    expect(spendableAccounts(list)).toEqual([]);
  });

  it("минус на кредитной карте остаётся в расчёте", () => {
    const list = [acc({ title: "Кредитка", type: "ccard", balanceBase: -12000 })];
    expect(spendableAccounts(list)[0].balanceBase).toBe(-12000);
  });
});

describe("planRemainder", () => {
  const row = (p: Partial<PlanRow> & { tagId: string }): PlanRow => ({
    title: p.tagId,
    plan: 0,
    locked: false,
    ...p,
  });
  const m = (o: Record<string, number>) => new Map(Object.entries(o));
  /** Дерево категорий: тег → родитель. */
  const tree = (o: Record<string, string | null>) =>
    new Map<string, string | null>(Object.entries(o));
  const flat = new Map<string, string | null>();

  it("остаток категории — план минус потраченное", () => {
    const out = planRemainder([row({ tagId: "Еда", plan: 50000 })], m({}), m({ Еда: 4645 }), flat);
    expect(out.total).toBe(45355);
  });

  it("назначенные операции ПРИБАВЛЯЮТСЯ к бюджету категории", () => {
    // Живой пример: «Подписки» — бюджет 8 719, назначенных списаний 18 101,
    // и Дзен-мани показывает в остатке плана 26 720, а не 8 719.
    const out = planRemainder(
      [row({ tagId: "Подписки", plan: 8719.26 })],
      m({ Подписки: 18101.16 }),
      m({ Подписки: 100.42 }),
      flat
    );
    expect(out.total).toBeCloseTo(26720, 0);
  });

  it("замок у родителя: дети — разбивка, а не добавка", () => {
    // «Животные» с замком: 36 000 у родителя против 10 000 + 25 000 у детей.
    // На экране 36 000, а не 71 000 — иначе те же деньги учтены дважды.
    const rows = [
      row({ tagId: "Животные", plan: 36000, locked: true }),
      row({ tagId: "Кот", plan: 10000 }),
      row({ tagId: "Собака", plan: 25000 }),
    ];
    const t = tree({ Животные: null, Кот: "Животные", Собака: "Животные" });
    expect(planRemainder(rows, m({}), m({}), t).total).toBe(36000);
  });

  it("замок: остаток не меньше суммы остатков подкатегорий", () => {
    // Категория 2 000 перебрана, а у подкатегории на 26 000 ещё есть запас: он
    // остаётся в планах, и перерасхода у ветки нет.
    const rows = [
      row({ tagId: "Покупки", plan: 2000, locked: true }),
      row({ tagId: "Подписки", plan: 26000, locked: true }),
    ];
    const t = tree({ Покупки: null, Подписки: "Покупки" });
    const out = planRemainder(rows, m({}), m({ Покупки: 1000, Подписки: 14000 }), t);
    expect(out.total).toBe(12000);
    expect(out.rows[0].left).toBe(12000);
    expect(out.full).toBe(26000);
    // Своя тысяча категории в сумму подкатегории не вошла: это трата мимо плана.
    expect(out.overspent).toBe(1000);
  });

  it("замок: своя сумма категории важнее, когда она больше", () => {
    const rows = [
      row({ tagId: "Еда", plan: 50000, locked: true }),
      row({ tagId: "Алкоголь", plan: 5000, locked: true }),
    ];
    const t = tree({ Еда: null, Алкоголь: "Еда" });
    expect(planRemainder(rows, m({}), m({ Еда: 30000 }), t).total).toBe(20000);
  });

  it("замок: запас подкатегории цел, а перебор считается от выбранной части плана", () => {
    const rows = [
      row({ tagId: "Разное", plan: 3800, locked: true }),
      row({ tagId: "Комиссии", plan: 1200, locked: true }),
    ];
    const t = tree({ Разное: null, Комиссии: "Разное" });
    const out = planRemainder(rows, m({}), m({ Разное: 8000 }), t);
    expect(out.total).toBe(1200);
    expect(out.full).toBe(3800);
    expect(out.overspent).toBe(5400);
  });

  it("без замка план категории складывается с подкатегориями", () => {
    // «Интернет-покупки» 2 000 + «Подписки» 8 719 = 10 719.
    const rows = [row({ tagId: "Интернет", plan: 2000 }), row({ tagId: "Подписки", plan: 8719.26 })];
    const t = tree({ Интернет: null, Подписки: "Интернет" });
    expect(planRemainder(rows, m({}), m({}), t).total).toBeCloseTo(10719.26, 2);
  });

  it("трата по подкатегории доезжает до родителя", () => {
    // Своей строки бюджета у под-тега нет — раньше такие расходы терялись, и
    // категория показывала 27 619 ₽ вместо 20 419.
    const rows = [row({ tagId: "Хобби", plan: 34650 })];
    const t = tree({ Хобби: null, Кружки: "Хобби" });
    const out = planRemainder(rows, m({ Хобби: 350 }), m({ Кружки: 7200, Хобби: 7381 }), t);
    expect(out.total).toBe(34650 + 350 - 7200 - 7381);
  });

  it("перебор по статье даёт ноль, а не минус", () => {
    // Иначе перерасход на еде развязывал бы руки по всем остальным статьям.
    const out = planRemainder([row({ tagId: "Еда", plan: 5000 })], m({}), m({ Еда: 9000 }), flat);
    expect(out.total).toBe(0);
    expect(out.overspent).toBe(4000);
  });

  it("перебор родителя не гасится остатком под-строки", () => {
    // Живой случай: «Периодические» 3 800 при тратах 8 000 — перебор 4 200, а у
    // подкатегории «Платежи и комиссии» своя строка на 1 200, и она цела.
    // Веткой целиком вышло бы −2 900, то есть на 1 300 ₽ свободных больше, чем
    // показывает Дзен-мани.
    const rows = [
      row({ tagId: "Периодические", plan: 3800 }),
      row({ tagId: "Платежи", plan: 1200 }),
    ];
    const t = tree({ Периодические: null, Платежи: "Периодические" });
    const out = planRemainder(rows, m({}), m({ Периодические: 8000 }), t);
    expect(out.total).toBe(1200);
    expect(out.overspent).toBe(4200);
  });

  it("сумма переборов — та самая разница «свободно из»", () => {
    // 12 сентября Дзен-мани показывал 40 116 из 51 789: ровно 11 673 ₽ съели
    // три перебравшие строки.
    const rows = [
      row({ tagId: "Отдых", plan: 5000 }),
      row({ tagId: "Периодические", plan: 3800 }),
      row({ tagId: "Уход", plan: 5000 }),
    ];
    const t = tree({ Отдых: null, Периодические: null, Уход: null, Сережа: "Уход", Катя: "Уход" });
    const out = planRemainder(
      rows,
      m({}),
      m({ Отдых: 10219, Периодические: 8000, Уход: 97, Сережа: 3457, Катя: 3700 }),
      t
    );
    expect(Math.round(out.overspent)).toBe(11673);
    expect(out.total).toBe(0);
  });

  it("трата по категории вне плана остаток плана не трогает", () => {
    // Строки у неё нет и выше по дереву тоже: такие деньги уходят прямо из
    // свободных, а не из чьего-то бюджета.
    const out = planRemainder(
      [row({ tagId: "Еда", plan: 5000 })],
      m({}),
      m({ Еда: 1000, Казино: 20000 }),
      flat
    );
    expect(out.total).toBe(4000);
    // Зато это трата мимо плана: на неё свободных меньше, чем могло быть.
    expect(out.overspent).toBe(20000);
  });

  it("пустые строки в список не попадают", () => {
    const rows = [row({ tagId: "Еда", plan: 5000 }), row({ tagId: "Пусто", plan: 0 })];
    expect(planRemainder(rows, m({}), m({ Еда: 1000 }), flat).rows.map((r) => r.tagId)).toEqual([
      "Еда",
    ]);
  });

  it("строки идут по убыванию остатка — крупное сверху", () => {
    const rows = [row({ tagId: "Мелочь", plan: 100 }), row({ tagId: "Аренда", plan: 40000 })];
    expect(planRemainder(rows, m({}), m({}), flat).rows.map((r) => r.tagId)).toEqual([
      "Аренда",
      "Мелочь",
    ]);
  });

  it("верхняя строка показывает всю ветку, подстатья — саму себя", () => {
    // Как на экране Дзен-мани: «Еда дома 40 909» — это 35 909 своих плюс
    // 5 000 «Алкоголя», и «Алкоголь» стоит под ней отдельной строкой.
    const rows = [
      row({ tagId: "Еда", title: "Еда дома", plan: 50000 }),
      row({ tagId: "Алкоголь", plan: 5000 }),
    ];
    const t = tree({ Еда: null, Алкоголь: "Еда" });
    const out = planRemainder(rows, m({}), m({ Еда: 14091 }), t);
    expect(out.total).toBe(40909);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].left).toBe(40909);
    expect(out.rows[0].children?.map((c) => [c.title, c.left])).toEqual([
      ["Алкоголь", 5000],
    ]);
  });

  it("под замком подстатьи показываются разбивкой, а не добавкой", () => {
    // «Животные» под замком: 36 000 − 13 091 трат = 22 909, и под ними своими
    // цифрами «Кот 8 940» и «Собака 13 778». Сумма ветки от этого не растёт.
    const rows = [
      row({ tagId: "Животные", plan: 36000, locked: true }),
      row({ tagId: "Кот", plan: 10000 }),
      row({ tagId: "Собака", plan: 25000 }),
    ];
    const t = tree({ Животные: null, Кот: "Животные", Собака: "Животные" });
    const out = planRemainder(
      rows,
      m({}),
      m({ Животные: 809, Кот: 1060, Собака: 11222 }),
      t
    );
    expect(out.total).toBe(22909);
    expect(out.rows[0].left).toBe(22909);
    expect(out.rows[0].children?.map((c) => [c.title, c.left])).toEqual([
      ["Собака", 13778],
      ["Кот", 8940],
    ]);
  });

  it("под замком назначенные операции к сумме не прибавляются", () => {
    // Замок значит «сумму я задал сам, не пересчитывай». Живой пример:
    // «Платежи и комиссии» — 1 200 ₽ под замком и назначенный платёж на 100 ₽,
    // а Дзен-мани показывает 1 200, а не 1 300.
    const rows = [row({ tagId: "Платежи", plan: 1200, locked: true })];
    const out = planRemainder(rows, m({ Платежи: 100 }), m({}), flat);
    expect(out.total).toBe(1200);
  });

  it("без замка назначенная операция сумму поднимает", () => {
    const rows = [row({ tagId: "Подписки", plan: 8719.26 })];
    const out = planRemainder(rows, m({ Подписки: 15909 }), m({ Подписки: 300 }), flat);
    expect(Math.round(out.total)).toBe(24328);
  });

  it("назначенный платёж без бюджета всё равно попадает в остаток", () => {
    // Строку с нулевым планом для такой категории заводит вызывающий: платёж
    // назначен, денег он потребует, и в остатке плана ему место.
    const out = planRemainder(
      [row({ tagId: "Квартира", plan: 0 })],
      m({ Квартира: 4000 }),
      m({}),
      flat
    );
    expect(out.total).toBe(4000);
  });
});

describe("freeSpentToday", () => {
  it("считает только то, что план не впитал", () => {
    // 12 сентября: 15 973 ₽ трат, остаток плана просел с 209 397 до 200 897 —
    // значит из свободных ушло 7 473, ровно как показывает Дзен-мани.
    const spent = freeSpentToday({
      expenseToday: 15973,
      planLeftBefore: 209397,
      planLeftNow: 200897,
    });
    expect(Math.round(spent)).toBe(7473);
  });

  it("трата целиком внутри плана свободных не трогает", () => {
    expect(freeSpentToday({ expenseToday: 4000, planLeftBefore: 54000, planLeftNow: 50000 })).toBe(0);
  });

  it("трата по категории вне плана уходит из свободных целиком", () => {
    expect(freeSpentToday({ expenseToday: 3000, planLeftBefore: 50000, planLeftNow: 50000 })).toBe(3000);
  });
});

describe("moneyBreakdown / freeToSpend", () => {
  it("складывает баланс периода и будущие поступления", () => {
    // Живые цифры: 99 005 + 174 600 = 273 605.
    const money = moneyBreakdown({ balance: 99005, stillToCome: 174600, excluded: 0 });
    expect(money.total).toBe(273605);
  });

  it("неснижаемый остаток вычитается сразу", () => {
    const money = moneyBreakdown({ balance: 99005, stillToCome: 174600, excluded: 10000 });
    expect(money.total).toBe(263605);
  });

  it("отрицательный остаток не увеличивает деньги", () => {
    const money = moneyBreakdown({ balance: 1000, stillToCome: 0, excluded: -500 });
    expect(money.excluded).toBe(0);
    expect(money.total).toBe(1000);
  });

  it("свободные = деньги минус остаток плана", () => {
    // 273 605 − 226 391 = 47 214: ровно то, что показывает Дзен-мани.
    const money = moneyBreakdown({ balance: 99005, stillToCome: 174600, excluded: 0 });
    expect(freeToSpend(money, 226391)).toBe(47214);
  });

  it("свободные бывают отрицательными — это и есть ответ", () => {
    const money = moneyBreakdown({ balance: 1000, stillToCome: 0, excluded: 0 });
    expect(freeToSpend(money, 30000)).toBe(-29000);
  });
});

describe("incomePlanTotal", () => {
  const m = (o: Record<string, number>) => new Map(Object.entries(o));
  const t = (o: Record<string, string | null>) => new Map<string, string | null>(Object.entries(o));

  it("по категории берётся большее из бюджета и назначенных", () => {
    const total = incomePlanTotal(
      m({ Работа: 290000, Кэшбек: 1500, Проценты: 24500, Прочее: 2000 }),
      m({ Работа: 145000, Кэшбек: 1600, Проценты: 26000 }),
      new Set(["Работа", "Кэшбек", "Проценты", "Прочее"]),
      t({ Работа: null, Банки: null, Кэшбек: "Банки", Проценты: "Банки", Прочее: null })
    );
    expect(total).toBe(319600);
  });

  it("запертая категория вбирает подкатегории", () => {
    const parents = t({ Доход: null, Часть: "Доход" });
    const locked = new Set(["Доход"]);
    expect(incomePlanTotal(m({ Доход: 5000, Часть: 3000 }), m({}), locked, parents)).toBe(5000);
    expect(incomePlanTotal(m({ Доход: 2000, Часть: 3000 }), m({}), locked, parents)).toBe(3000);
  });
});

describe("dailyAllowance — ежедневный пересчёт", () => {
  const daily = (free: number, daysLeft: number) =>
    dailyAllowance({ method: "daily", free, daysLeft, planFree: 99999, daysTotal: 30 });

  it("делит свободные на оставшиеся дни", () => {
    // Сверено с Дзен-мани: 47 213 ÷ 21 = 2 248 ₽.
    expect(Math.round(daily(47213, 21).perDay)).toBe(2248);
  });

  it("лимит считается от свободных на начало дня, а не от текущих", () => {
    // Свободных 40 116, за день из них ушло 7 473, дней 19: делится 47 589.
    const spent = 7473;
    const a = daily(40116 + spent, 19);
    expect(Math.round(a.perDay)).toBe(2505);
    expect(Math.round(spent - a.perDay)).toBe(4968);
  });

  it("накопленное этот метод не знает вовсе", () => {
    expect(daily(1000, 10).saved).toBeNull();
  });

  it("в последний день доступен весь остаток", () => {
    expect(daily(5000, 1).perDay).toBe(5000);
  });
});

describe("dailyAllowance — копим сэкономленное", () => {
  const cumulative = (free: number, daysLeft: number, planFree: number, daysTotal = 30) =>
    dailyAllowance({ method: "cumulative", free, daysLeft, planFree, daysTotal });

  it("лимит — свободные по плану, делённые на все дни месяца", () => {
    expect(cumulative(5000, 12, 30000).perDay).toBe(1000);
    expect(cumulative(90000, 2, 30000).perDay).toBe(1000);
  });

  it("экономия копится сверх лимита", () => {
    const a = cumulative(40000, 20, 30000);
    expect(a.saved).toBe(20000);
  });

  it("перерасход прошлых дней уводит накопленное в минус", () => {
    // Сверено с Дзен-мани: план 41 097 на 30 дней, свободных −34 346, дней 8 —
    // на сегодня «43 935 ₽ сверх 1 370 ₽».
    const a = cumulative(-34345.91, 8, 41097);
    expect(Math.round(a.perDay)).toBe(1370);
    expect(Math.round(a.perDay + a.saved!)).toBe(-43935);
  });

  it("инвариант: свободные = накоплено + лимит × оставшиеся дни", () => {
    const a = cumulative(47213, 21, 32580);
    expect(a.saved! + a.perDay * 21).toBeCloseTo(47213, 6);
  });

  it("при плане в минус лимита нет", () => {
    const a = cumulative(-3000, 10, -9000);
    expect(a.perDay).toBe(0);
    expect(a.saved).toBe(-3000);
  });
});

describe("allowanceRatio", () => {
  it("половина лимита — половина кольца", () => {
    expect(allowanceRatio(500, 1000)).toBe(0.5);
  });

  it("сверх лимита кольцо не выкручивается", () => {
    expect(allowanceRatio(4000, 1000)).toBe(1);
  });

  it("перерасход — пустое кольцо, а не отрицательная дуга", () => {
    expect(allowanceRatio(-2000, 1000)).toBe(0);
  });

  it("нулевой лимит не делится", () => {
    expect(allowanceRatio(0, 0)).toBe(0);
  });
});

describe("incomeStillToCome — «Ещё поступит» (#100)", () => {
  const m = (o: Record<string, number>) => new Map(Object.entries(o));
  const roots = new Map<string, string | null>();

  it("живой аккаунт: сходится с приложением по всем доходным категориям сразу", () => {
    // Работа: бюджет 100, аванс уже пришёл 110, зарплата 100 назначена на конец
    // месяца — ждём её целиком. Прочее: бюджет 2, ничего не пришло. Кэшбек:
    // бюджет 1, пришло 5 — ноль. Проценты: бюджет 20, пришло 21 — ноль.
    const plan = m({ work: 100, other: 2, cashback: 1, interest: 20 });
    const upcoming = m({ work: 100 });
    const received = m({ work: 110, cashback: 5, interest: 21 });
    expect(incomeStillToCome(plan, upcoming, received, roots)).toBe(102);
  });

  it("бюджет без назначенных поступлений гасится пришедшим, не ниже нуля", () => {
    expect(incomeStillToCome(m({ salary: 100 }), m({}), m({ salary: 40 }), roots)).toBe(60);
    expect(incomeStillToCome(m({ salary: 100 }), m({}), m({ salary: 130 }), roots)).toBe(0);
  });

  it("будущее назначенное поступление пришедшим не гасится", () => {
    expect(incomeStillToCome(m({}), m({ salary: 100 }), m({ salary: 100 }), roots)).toBe(100);
  });

  it("из бюджета и будущего назначенного — большее, не сумма", () => {
    expect(incomeStillToCome(m({ salary: 100 }), m({ salary: 120 }), m({}), roots)).toBe(120);
    expect(incomeStillToCome(m({ salary: 150 }), m({ salary: 120 }), m({}), roots)).toBe(150);
  });

  it("доход по подкатегории гасит бюджет родителя", () => {
    const parents = new Map<string, string | null>([["advance", "salary"], ["salary", null]]);
    expect(incomeStillToCome(m({ salary: 100 }), m({}), m({ advance: 30 }), parents)).toBe(70);
  });

  it("доход вне плана остаток не трогает", () => {
    expect(incomeStillToCome(m({ salary: 100 }), m({}), m({ gift: 5 }), roots)).toBe(100);
  });
});
