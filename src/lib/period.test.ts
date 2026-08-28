import { describe, it, expect } from "vitest";
import {
  alignWindows,
  comparableRanges,
  endAfterDays,
  isRunningPeriod,
  parseIsoDate,
  periodRange,
  previousWindows,
  shiftDays,
  spanDays,
  toIsoDate,
  yearRange,
} from "./period";

describe("spanDays", () => {
  it("считает обе границы", () => {
    expect(spanDays("2026-08-01", "2026-08-01")).toBe(1);
    expect(spanDays("2026-08-01", "2026-08-03")).toBe(3);
    expect(spanDays("2026-01-01", "2026-01-31")).toBe(31);
  });

  it("переживает границу месяца и года", () => {
    expect(spanDays("2025-12-30", "2026-01-02")).toBe(4);
  });

  it("даёт 0 на вывернутом отрезке", () => {
    expect(spanDays("2026-08-10", "2026-08-01")).toBe(0);
  });
});

describe("endAfterDays", () => {
  it("отсчитывает от первого дня включительно", () => {
    expect(endAfterDays("2026-08-01", 1)).toBe("2026-08-01");
    expect(endAfterDays("2026-08-01", 3)).toBe("2026-08-03");
  });

  it("переходит через конец месяца", () => {
    expect(endAfterDays("2026-01-30", 4)).toBe("2026-02-02");
  });
});

describe("comparableRanges", () => {
  const jul = { from: "2026-07-01", to: "2026-07-31" };
  const aug = { from: "2026-08-01", to: "2026-08-31" };

  it("обрезает идущий период по последней операции", () => {
    const r = comparableRanges(aug, jul, "2026-08-03", false);
    expect(r.a).toEqual({ from: "2026-08-01", to: "2026-08-03" });
  });

  it("без выравнивания оставляет второй период целым", () => {
    const r = comparableRanges(aug, jul, "2026-08-03", false);
    expect(r.b).toEqual(jul);
  });

  it("выравнивает неполный период с таким же отрезком второго", () => {
    const r = comparableRanges(aug, jul, "2026-08-03", true);
    expect(r.a).toEqual({ from: "2026-08-01", to: "2026-08-03" });
    expect(r.b).toEqual({ from: "2026-07-01", to: "2026-07-03" });
  });

  it("выравнивает и когда идущий период стоит вторым", () => {
    const r = comparableRanges(jul, aug, "2026-08-03", true);
    expect(r.a).toEqual({ from: "2026-07-01", to: "2026-07-03" });
    expect(r.b).toEqual({ from: "2026-08-01", to: "2026-08-03" });
  });

  it("НЕ трогает два законченных месяца разной длины", () => {
    // Январь длиннее февраля, но обрезать его до 28 дней значит потерять
    // операции, о которых никто не просил.
    const janu = { from: "2026-01-01", to: "2026-01-31" };
    const febr = { from: "2026-02-01", to: "2026-02-28" };
    const r = comparableRanges(janu, febr, "2026-08-03", true);
    expect(r.a).toEqual(janu);
    expect(r.b).toEqual(febr);
  });

  it("упирается в конец короткого периода, а не вылезает за него", () => {
    // Идущий март (31 день) против законченного февраля (28): выравнивание
    // берёт минимум, поэтому март тоже становится 28-дневным.
    const mar = { from: "2026-03-01", to: "2026-03-31" };
    const febr = { from: "2026-02-01", to: "2026-02-28" };
    const r = comparableRanges(mar, febr, "2026-03-30", true);
    expect(r.a).toEqual({ from: "2026-03-01", to: "2026-03-28" });
    expect(r.b).toEqual(febr);
  });

  it("работает с отчётным месяцем не с первого числа", () => {
    // «Первый день отчётного месяца» = 11: считаем дни ОТ НАЧАЛА периода,
    // а не по числу месяца.
    const cur = { from: "2026-07-11", to: "2026-08-10" };
    const prev = { from: "2026-06-11", to: "2026-07-10" };
    const r = comparableRanges(cur, prev, "2026-07-15", true);
    expect(r.a).toEqual({ from: "2026-07-11", to: "2026-07-15" });
    expect(r.b).toEqual({ from: "2026-06-11", to: "2026-06-15" });
  });

  it("не разваливается на пустых границах", () => {
    const empty = { from: "", to: "" };
    expect(comparableRanges(empty, jul, "2026-08-03", true)).toEqual({
      a: empty,
      b: jul,
    });
  });

  it("игнорирует maxDate раньше начала периода", () => {
    // Данных за период нет вовсе — обрезать не по чему, иначе получился бы
    // вывернутый отрезок.
    const r = comparableRanges(aug, jul, "2026-06-15", true);
    expect(r.a).toEqual(aug);
  });
});

describe("previousWindows", () => {
  it("шагает отчётными месяцами, когда период — месяц", () => {
    const w = previousWindows({ from: "2026-07-01", to: "2026-07-31" }, 3, "2026-07", 1);
    expect(w).toEqual([
      { from: "2026-06-01", to: "2026-06-30" },
      { from: "2026-05-01", to: "2026-05-31" },
      { from: "2026-04-01", to: "2026-04-30" },
    ]);
  });

  it("месяцами, а не «шагами по 31 дню» — иначе окна поехали бы", () => {
    // От марта три шага назад по 31 дню не попали бы в декабрь.
    const w = previousWindows({ from: "2026-03-01", to: "2026-03-31" }, 3, "2026-03", 1);
    expect(w.map((x) => x.from)).toEqual(["2026-02-01", "2026-01-01", "2025-12-01"]);
  });

  it("уважает свой первый день отчётного месяца", () => {
    const w = previousWindows({ from: "2026-07-11", to: "2026-08-10" }, 2, "2026-07", 11);
    expect(w).toEqual([
      { from: "2026-06-11", to: "2026-07-10" },
      { from: "2026-05-11", to: "2026-06-10" },
    ]);
  });

  it("без месяца берёт равные отрезки той же длины", () => {
    const w = previousWindows({ from: "2026-07-11", to: "2026-07-20" }, 2, null, 1);
    expect(w).toEqual([
      { from: "2026-07-01", to: "2026-07-10" },
      { from: "2026-06-21", to: "2026-06-30" },
    ]);
  });

  it("текущий период в результат не входит", () => {
    const cur = { from: "2026-07-01", to: "2026-07-31" };
    const w = previousWindows(cur, 3, "2026-07", 1);
    expect(w).not.toContainEqual(cur);
    expect(w).toHaveLength(3);
  });

  it("нулевой и отрицательный счёт дают пустой список", () => {
    expect(previousWindows({ from: "2026-07-01", to: "2026-07-31" }, 0, "2026-07", 1)).toEqual([]);
    expect(previousWindows({ from: "2026-07-01", to: "2026-07-31" }, -1, null, 1)).toEqual([]);
  });

  it("вывернутый отрезок без месяца не даёт окон", () => {
    expect(previousWindows({ from: "2026-07-31", to: "2026-07-01" }, 3, null, 1)).toEqual([]);
  });
});

describe("shiftDays", () => {
  it("двигает вперёд и назад через границу месяца", () => {
    expect(shiftDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(shiftDays("2026-07-15", 0)).toBe("2026-07-15");
  });
});

describe("toIsoDate / parseIsoDate", () => {
  // Регрессия на сдвиг дат в режиме «с начала года» (issue #37): раньше в
  // ComparePage смешивались локальный конструктор Date и toISOString(), и в
  // поясе UTC+3 период начинался 31 декабря прошлого года.
  it("разбор и сборка возвращают ту же дату", () => {
    for (const d of ["2026-01-01", "2026-08-02", "2025-12-31", "2024-02-29"]) {
      expect(toIsoDate(parseIsoDate(d))).toBe(d);
    }
  });

  it("разбирает как локальную полночь, а не как UTC", () => {
    const d = parseIsoDate("2026-01-01");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(1);
    expect(d.getHours()).toBe(0);
  });

  it("первое января остаётся первым января после сборки", () => {
    // Именно этот путь и ломался: локальный конструктор + toISOString().
    const jan = new Date(2026, 0, 1);
    expect(toIsoDate(jan)).toBe("2026-01-01");
  });

  it("выдерживает арифметику через границу года", () => {
    const d = parseIsoDate("2026-01-01");
    d.setDate(d.getDate() - 1);
    expect(toIsoDate(d)).toBe("2025-12-31");
  });
});

describe("alignWindows", () => {
  it("подрезает окна под длину идущего периода", () => {
    const w = [
      { from: "2026-07-01", to: "2026-07-31" },
      { from: "2026-06-01", to: "2026-06-30" },
    ];
    expect(alignWindows(w, 3)).toEqual([
      { from: "2026-07-01", to: "2026-07-03" },
      { from: "2026-06-01", to: "2026-06-03" },
    ]);
  });

  it("не растягивает окно за его собственный конец", () => {
    const feb = [{ from: "2026-02-01", to: "2026-02-28" }];
    expect(alignWindows(feb, 31)).toEqual(feb);
  });

  it("нулевая длина оставляет окна как есть", () => {
    const w = [{ from: "2026-07-01", to: "2026-07-31" }];
    expect(alignWindows(w, 0)).toEqual(w);
  });
});

// Ровно та цепочка, по которой считается «среднее за N месяцев»: взять окна
// назад, подрезать их под длину идущего месяца, поделить сумму на число окон.
// Каждое звено проверено выше по отдельности — здесь важно, что даёт связка.
describe("среднее за N месяцев: previousWindows + alignWindows", () => {
  it("подрезает прошлые месяцы под отработанную часть текущего", () => {
    const march = periodRange("2027-03", 1);
    const days = spanDays(march.from, "2027-03-30"); // месяц идёт, отработано 30 дн.
    const windows = alignWindows(previousWindows(march, 3, "2027-03", 1), days);
    expect(windows).toEqual([
      { from: "2027-02-01", to: "2027-02-28" },
      { from: "2027-01-01", to: "2027-01-30" },
      { from: "2026-12-01", to: "2026-12-30" },
    ]);
    // Февраль короче 30 дней и растянут быть не может, поэтому средний
    // «типичный месяц» выходит чуть короче текущего — 88 / 3 против 30.
    const total = windows.reduce((sum, w) => sum + spanDays(w.from, w.to), 0);
    expect(total).toBe(88);
    expect(spanDays(march.from, "2027-03-30")).toBe(30);
  });

  it("делитель равен числу окон, а не числу дней", () => {
    const april = periodRange("2027-04", 1);
    const windows = alignWindows(
      previousWindows(april, 12, "2027-04", 1),
      spanDays(april.from, "2027-04-29"),
    );
    expect(windows).toHaveLength(12);
    expect(windows.every((w) => spanDays(w.from, w.to) <= 29)).toBe(true);
  });

  it("в режиме «Месяцы» подрезаются ОБА периода — до общей длины", () => {
    // Март отработан на 30 дн., но февраль всего 28 — сравнивать честно можно
    // только 28 дн. против 28, иначе у марта окажется лишняя пара дней трат.
    const fit = comparableRanges(
      periodRange("2027-03", 1),
      periodRange("2027-02", 1),
      "2027-03-30",
      true,
    );
    expect(fit.a).toEqual({ from: "2027-03-01", to: "2027-03-28" });
    expect(fit.b).toEqual({ from: "2027-02-01", to: "2027-02-28" });
  });
});

describe("isRunningPeriod", () => {
  const march = { from: "2027-03-01", to: "2027-03-31" };

  it("месяц идёт, пока данные кончаются раньше его конца", () => {
    expect(isRunningPeriod(march, "2027-03-30")).toBe(true);
    expect(isRunningPeriod(march, "2027-03-01")).toBe(true);
  });

  it("месяц закончен, когда данные дошли до последнего дня или дальше", () => {
    expect(isRunningPeriod(march, "2027-03-31")).toBe(false);
    expect(isRunningPeriod(march, "2027-05-10")).toBe(false);
  });

  it("месяц ещё не начался — тоже не идёт", () => {
    expect(isRunningPeriod(march, "2027-02-28")).toBe(false);
  });

  // Ровно та путаница, из-за которой панель называла идущим не тот месяц:
  // выравнивание равных отрезков подрезает и законченный период.
  it("подрезанный выравниванием январь идущим не считается", () => {
    const januaryCut = { from: "2027-01-01", to: "2027-01-30" }; // подрезан до 30 дн.
    expect(isRunningPeriod(januaryCut, "2027-03-30")).toBe(false);
    // А сам январь целиком — тем более закончен.
    expect(isRunningPeriod({ from: "2027-01-01", to: "2027-01-31" }, "2027-03-30")).toBe(false);
  });

  it("без данных или без периода — нет и ответа", () => {
    expect(isRunningPeriod(march, "")).toBe(false);
    expect(isRunningPeriod(null, "2027-03-30")).toBe(false);
  });
});

describe("yearRange", () => {
  it("обычный год — с 1 января по 31 декабря", () => {
    expect(yearRange(2026)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("високосный год не теряет 29 февраля", () => {
    const y = yearRange(2028);
    expect(spanDays(y.from, y.to)).toBe(366);
  });

  it("своё начало месяца сдвигает и год", () => {
    // Отчётный январь начинается 11-го, значит и год — с 11 января по 10-е
    // января следующего. Иначе «год» на «Сравнении» разошёлся бы с «месяцем»
    // на остальных страницах.
    expect(yearRange(2026, 11)).toEqual({ from: "2026-01-11", to: "2027-01-10" });
  });

  it("сдвинутый год всё равно длиной в год", () => {
    const y = yearRange(2026, 11);
    expect(spanDays(y.from, y.to)).toBe(365);
  });

  it("год стыкуется со следующим без дыр и нахлёста", () => {
    const a = yearRange(2026, 11);
    const b = yearRange(2027, 11);
    expect(shiftDays(a.to, 1)).toBe(b.from);
  });

  it("два законченных года сравниваются целиком, идущий — по равному куску", () => {
    const a = yearRange(2026);
    const b = yearRange(2025);
    // 2026-й ещё идёт: данные кончаются 15 марта.
    const cut = comparableRanges(a, b, "2026-03-15", true);
    expect(cut.a).toEqual({ from: "2026-01-01", to: "2026-03-15" });
    expect(cut.b).toEqual({ from: "2025-01-01", to: "2025-03-15" });
    // Оба закончены — режем только по данным, длины не трогаем.
    const whole = comparableRanges(b, yearRange(2024), "2026-03-15", true);
    expect(whole.a).toEqual(b);
    expect(whole.b).toEqual(yearRange(2024));
  });
});
