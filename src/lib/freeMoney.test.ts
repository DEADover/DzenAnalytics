import { describe, it, expect } from "vitest";
import {
  allowanceRatio,
  dailyAllowance,
  freeSpentToday,
  freeToSpend,
  moneyBreakdown,
  planRemainder,
  savedSoFar,
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

  it("без замка план категории складывается с под-категориями", () => {
    // «Интернет-покупки» 2 000 + «Подписки» 8 719 = 10 719.
    const rows = [row({ tagId: "Интернет", plan: 2000 }), row({ tagId: "Подписки", plan: 8719.26 })];
    const t = tree({ Интернет: null, Подписки: "Интернет" });
    expect(planRemainder(rows, m({}), m({}), t).total).toBeCloseTo(10719.26, 2);
  });

  it("трата по под-категории доезжает до родителя", () => {
    // Своей строки бюджета у под-тега нет — раньше такие расходы терялись, и
    // «София» показывала 27 619 ₽ вместо 20 419.
    const rows = [row({ tagId: "София", plan: 34650 })];
    const t = tree({ София: null, Кружки: "София" });
    const out = planRemainder(rows, m({ София: 350 }), m({ Кружки: 7200, София: 7381 }), t);
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
    // под-категории «Платежи и комиссии» своя строка на 1 200, и она цела.
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
    expect(out.overspent).toBe(0);
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

  it("верхняя строка показывает всю ветку, под-статья — саму себя", () => {
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

  it("под замком под-статьи показываются разбивкой, а не добавкой", () => {
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

describe("dailyAllowance — ежедневный пересчёт", () => {
  it("делит свободные на оставшиеся дни", () => {
    // Сверено с Дзен-мани: 47 213 ÷ 21 = 2 248 ₽.
    const a = dailyAllowance({ method: "daily", free: 47213, daysLeft: 21, saved: 99999 });
    expect(Math.round(a.perDay)).toBe(2248);
  });

  it("лимит считается от свободных на начало дня, а не от текущих", () => {
    // 12 сентября: свободных 40 116, за день из них ушло 7 473, дней 19.
    // Дзен-мани показывает лимит 2 505 и «4 968 ₽ сверх» — то есть делит
    // 47 589, иначе сегодняшняя трата урезала бы сегодняшний же лимит.
    const spent = 7473;
    const a = dailyAllowance({ method: "daily", free: 40116 + spent, daysLeft: 19, saved: 0 });
    expect(Math.round(a.perDay)).toBe(2505);
    expect(Math.round(spent - a.perDay)).toBe(4968);
  });

  it("накопленное этот метод не знает вовсе", () => {
    const a = dailyAllowance({ method: "daily", free: 1000, daysLeft: 10, saved: 500 });
    expect(a.saved).toBeNull();
  });

  it("в последний день доступен весь остаток", () => {
    const a = dailyAllowance({ method: "daily", free: 5000, daysLeft: 1, saved: 0 });
    expect(a.perDay).toBe(5000);
  });
});

describe("dailyAllowance — копим сэкономленное", () => {
  it("накопленное лежит отдельно, остальное делится на оставшиеся дни", () => {
    // Сверено с Дзен-мани: (47 213 − 24 408) ÷ 21 = 1 086 ₽.
    const a = dailyAllowance({
      method: "cumulative",
      free: 47213,
      daysLeft: 21,
      saved: 24408,
    });
    expect(Math.round(a.perDay)).toBe(1086);
    expect(a.saved).toBe(24408);
  });

  it("инвариант: свободные = накоплено + лимит × оставшиеся дни", () => {
    const a = dailyAllowance({ method: "cumulative", free: 47213, daysLeft: 21, saved: 24408 });
    expect(a.saved! + a.perDay * 21).toBeCloseTo(47213, 6);
  });

  it("накопленное больше свободных не бывает: лимит не уходит в минус", () => {
    // Иначе виджет обещал бы долг вместо денег.
    const a = dailyAllowance({ method: "cumulative", free: 5000, daysLeft: 10, saved: 9000 });
    expect(a.saved).toBe(5000);
    expect(a.perDay).toBe(0);
  });

  it("при отрицательных свободных копить нечего", () => {
    const a = dailyAllowance({ method: "cumulative", free: -3000, daysLeft: 10, saved: 4000 });
    expect(a.saved).toBe(0);
    expect(a.perDay).toBeLessThan(0);
  });
});

describe("savedSoFar", () => {
  it("каждый прожитый день добавляет свою долю", () => {
    // 30 дней, идёт четвёртый: накоплено за три прожитых.
    expect(savedSoFar({ free: 30000, daysTotal: 30, dayIndex: 4 })).toBe(3000);
  });

  it("в первый день копить ещё нечего", () => {
    expect(savedSoFar({ free: 30000, daysTotal: 30, dayIndex: 1 })).toBe(0);
  });

  it("вместе с лимитом даёт ровно свободные деньги", () => {
    // Инвариант метода: накоплено + лимит × оставшиеся = свободные.
    const free = 47213, daysTotal = 30, dayIndex = 10;
    const saved = savedSoFar({ free, daysTotal, dayIndex });
    const a = dailyAllowance({
      method: "cumulative",
      free,
      daysLeft: daysTotal - dayIndex + 1,
      saved,
    });
    expect(saved + a.perDay * (daysTotal - dayIndex + 1)).toBeCloseTo(free, 6);
  });

  it("лимит выходит постоянным — свободные, делённые на длину периода", () => {
    // Это и значит «лимит на день постоянный»: он не зависит от того, какой
    // сейчас день периода.
    const free = 30000, daysTotal = 30;
    for (const dayIndex of [1, 7, 15, 30]) {
      const saved = savedSoFar({ free, daysTotal, dayIndex });
      const a = dailyAllowance({
        method: "cumulative",
        free,
        daysLeft: daysTotal - dayIndex + 1,
        saved,
      });
      expect(a.perDay).toBeCloseTo(1000, 6);
    }
  });

  it("перерасход сверх плана снижает и накопленное", () => {
    // Свободные упали — вместе с ними и доля прожитых дней.
    expect(savedSoFar({ free: 15000, daysTotal: 30, dayIndex: 11 })).toBe(5000);
  });

  it("отрицательные свободные не дают отрицательного накопления", () => {
    expect(savedSoFar({ free: -9000, daysTotal: 30, dayIndex: 11 })).toBe(0);
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
