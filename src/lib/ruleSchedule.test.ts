import { describe, it, expect } from "vitest";
import {
  depthFrom,
  depthLabel,
  everyLabel,
  isDue,
  nextRunLabel,
  readRun,
  scheduleLabel,
  scheduleShort,
  withinDepth,
  type RuleSchedule,
} from "./ruleSchedule";

const daily: RuleSchedule = { every: "day", depth: "month" };
const monthly: RuleSchedule = { every: "month", depth: "year" };

describe("isDue — пора ли запускать правило", () => {
  it("без расписания не запускается никогда", () => {
    expect(isDue(undefined, undefined, new Date("2026-08-16T10:00:00"))).toBe(false);
  });

  it("ни разу не отрабатывало — пора", () => {
    expect(isDue(daily, undefined, new Date("2026-08-16T10:00:00"))).toBe(true);
  });

  it("«раз в день» считается по календарю, а не по суткам", () => {
    // Запуск в 23:50 не должен отменить утренний: для человека это разные дни.
    expect(isDue(daily, "2026-08-15T23:50:00", new Date("2026-08-16T00:10:00"))).toBe(true);
    expect(isDue(daily, "2026-08-16T00:10:00", new Date("2026-08-16T23:50:00"))).toBe(false);
  });

  it("«раз в месяц» — по календарному месяцу", () => {
    expect(isDue(monthly, "2026-07-31T12:00:00", new Date("2026-08-01T09:00:00"))).toBe(true);
    expect(isDue(monthly, "2026-08-01T09:00:00", new Date("2026-08-31T23:00:00"))).toBe(false);
  });

  it("испорченная отметка времени не блокирует запуск", () => {
    expect(isDue(daily, "не дата", new Date("2026-08-16T10:00:00"))).toBe(true);
  });
});

describe("depthFrom — насколько глубоко смотреть", () => {
  const now = new Date("2026-08-16T12:00:00");

  it("«весь период» — без нижней границы", () => {
    expect(depthFrom("all", now)).toBeNull();
  });

  it("день — сегодняшняя дата", () => {
    expect(depthFrom("day", now)).toBe("2026-08-16");
  });

  it("месяц и год отсчитываются назад от сегодня", () => {
    expect(depthFrom("month", now)).toBe("2026-07-17");
    expect(depthFrom("year", now)).toBe("2025-08-16");
  });

  it("число единиц умножает глубину", () => {
    // «За 3 месяца» — 90 дней назад, «за 2 года» — 730.
    expect(depthFrom("month", now, 3)).toBe("2026-05-18");
    expect(depthFrom("year", now, 2)).toBe("2024-08-16");
  });

  it("КЛЮЧЕВОЕ: дни считаются включительно", () => {
    // «За 1 день» — это сегодня, «за 3 дня» — сегодня и два предыдущих.
    expect(depthFrom("day", now, 1)).toBe("2026-08-16");
    expect(depthFrom("day", now, 3)).toBe("2026-08-14");
  });

  it("правило без числа считается как «за одну единицу» — как и раньше", () => {
    expect(depthFrom("month", now, 1)).toBe(depthFrom("month", now));
  });

  it("«всё время» числом не портится", () => {
    expect(depthFrom("all", now, 5)).toBeNull();
  });
});

describe("depthLabel — глубина словами", () => {
  it("склоняется по числу", () => {
    expect(depthLabel({ depth: "day", depthN: 1 })).toBe("1 день");
    expect(depthLabel({ depth: "day", depthN: 3 })).toBe("3 дня");
    expect(depthLabel({ depth: "month", depthN: 6 })).toBe("6 месяцев");
    expect(depthLabel({ depth: "year", depthN: 2 })).toBe("2 года");
  });

  it("без числа — одна единица, «всё время» без числа вовсе", () => {
    expect(depthLabel({ depth: "month" })).toBe("1 месяц");
    expect(depthLabel({ depth: "all", depthN: 7 })).toBe("всё время");
  });

  it("полная подпись расписания собирается из частоты и глубины", () => {
    expect(scheduleLabel({ every: "day", depth: "month", depthN: 6 })).toBe(
      "Раз в день · 6 месяцев"
    );
  });
});

describe("withinDepth — попадает ли операция в окно", () => {
  it("без границы попадает всё, даже без даты", () => {
    expect(withinDepth("2019-01-01", null)).toBe(true);
    expect(withinDepth(undefined, null)).toBe(true);
  });

  it("граница включительна", () => {
    expect(withinDepth("2026-07-17", "2026-07-17")).toBe(true);
    expect(withinDepth("2026-07-16", "2026-07-17")).toBe(false);
  });

  it("операция без даты в окно не попадает: сравнивать не с чем", () => {
    expect(withinDepth(undefined, "2026-07-17")).toBe(false);
  });

  it("время в дате не мешает", () => {
    expect(withinDepth("2026-07-20T15:00:00", "2026-07-17")).toBe(true);
  });
});

describe("scheduleShort — частота одним словом для значка режима", () => {
  it("без расписания — «Только новые»", () => {
    expect(scheduleShort(undefined)).toBe("Только новые");
  });

  it("частота не зависит от глубины: в значок влезает только она", () => {
    expect(scheduleShort({ every: "day", depth: "all" })).toBe("Ежедневно");
    expect(scheduleShort({ every: "month", depth: "day" })).toBe("Ежемесячно");
  });
});

describe("readRun — отметка о заходе правила", () => {
  it("старая запись — просто дата, без числа правок", () => {
    expect(readRun("2026-08-16T10:00:00.000Z")).toEqual({ at: "2026-08-16T10:00:00.000Z" });
  });

  it("новая запись помнит, сколько операций поправила", () => {
    expect(readRun({ at: "2026-08-16T10:00:00.000Z", changed: 5 })).toEqual({
      at: "2026-08-16T10:00:00.000Z",
      changed: 5,
    });
  });

  it("«ноль правок» — это тоже ответ, и он не теряется", () => {
    expect(readRun({ at: "2026-08-16T10:00:00.000Z", changed: 0 })?.changed).toBe(0);
  });

  it("мусор и пустота отметкой не считаются", () => {
    expect(readRun(null)).toBeNull();
    expect(readRun("")).toBeNull();
    expect(readRun({ changed: 3 })).toBeNull();
    expect(readRun(42)).toBeNull();
  });
});

describe("nextRunLabel — когда правило заработает снова", () => {
  const now = new Date("2026-08-16T12:00:00");

  it("без расписания говорит про новые операции, а не про срок", () => {
    expect(nextRunLabel(undefined, undefined, now)).toContain("только новые");
  });

  it("срок наступил — называем повод, а не дату из прошлого", () => {
    const label = nextRunLabel({ every: "day", depth: "month" }, undefined, now);
    expect(label).toContain("синхронизации");
    expect(label).toContain("заходе");
  });

  it("КЛЮЧЕВОЕ: в подписи нет слов «открытие» и «пора»", () => {
    // Ровно на них и спотыкается человек: «первое открытие» — язык
    // программиста, а «уже пора» не отвечает, что теперь делать.
    for (const label of [
      nextRunLabel(undefined, undefined, now),
      nextRunLabel({ every: "day", depth: "month" }, undefined, now),
      nextRunLabel({ every: "day", depth: "month" }, "2026-08-16T09:00:00", now),
      nextRunLabel({ every: "month", depth: "month" }, "2026-08-01T09:00:00", now),
    ]) {
      expect(label).not.toContain("открытии");
      expect(label).not.toContain("первом");
      expect(label).not.toContain("пора");
    }
  });

  it("сегодня уже отработало — ежедневное ждёт завтра", () => {
    const label = nextRunLabel(
      { every: "day", depth: "month" },
      "2026-08-16T09:00:00",
      now
    );
    expect(label).toContain("17 августа");
  });

  it("ежемесячное после захода ждёт первого числа следующего месяца", () => {
    const label = nextRunLabel(
      { every: "month", depth: "month" },
      "2026-08-01T09:00:00",
      now
    );
    expect(label).toContain("1 сентября");
  });
});

describe("частота в минутах и часах", () => {
  const at = (iso: string) => new Date(iso);

  it("КЛЮЧЕВОЕ: минуты меряются временем, а не календарём", () => {
    const s: RuleSchedule = { every: "minute", everyN: 15, depth: "day" };
    expect(isDue(s, "2026-08-16T12:00:00", at("2026-08-16T12:14:00"))).toBe(false);
    expect(isDue(s, "2026-08-16T12:00:00", at("2026-08-16T12:15:00"))).toBe(true);
  });

  it("часы считаются так же", () => {
    const s: RuleSchedule = { every: "hour", everyN: 2, depth: "day" };
    expect(isDue(s, "2026-08-16T12:00:00", at("2026-08-16T13:59:00"))).toBe(false);
    expect(isDue(s, "2026-08-16T12:00:00", at("2026-08-16T14:00:00"))).toBe(true);
  });

  it("«раз в день» осталось календарным: заход в 23:50 не отменяет утренний", () => {
    const s: RuleSchedule = { every: "day", depth: "day" };
    expect(isDue(s, "2026-08-16T23:50:00", at("2026-08-17T00:10:00"))).toBe(true);
    expect(isDue(s, "2026-08-16T00:10:00", at("2026-08-16T23:50:00"))).toBe(false);
  });

  it("число единиц работает и у дней с месяцами", () => {
    expect(isDue({ every: "day", everyN: 3, depth: "day" }, "2026-08-14", at("2026-08-16T10:00:00"))).toBe(
      false
    );
    expect(isDue({ every: "day", everyN: 3, depth: "day" }, "2026-08-13", at("2026-08-16T10:00:00"))).toBe(
      true
    );
    expect(
      isDue({ every: "month", everyN: 2, depth: "day" }, "2026-07-01", at("2026-08-16T10:00:00"))
    ).toBe(false);
    expect(
      isDue({ every: "month", everyN: 2, depth: "day" }, "2026-06-01", at("2026-08-16T10:00:00"))
    ).toBe(true);
  });

  it("подписи называют частоту с числом и склонением", () => {
    expect(everyLabel({ every: "minute", everyN: 15, depth: "day" })).toBe("Каждые 15 минут");
    expect(everyLabel({ every: "hour", everyN: 1, depth: "day" })).toBe("Раз в час");
    expect(everyLabel({ every: "day", everyN: 2, depth: "day" })).toBe("Каждые 2 дня");
    expect(everyLabel({ every: "month", everyN: 1, depth: "day" })).toBe("Раз в месяц");
    expect(scheduleShort({ every: "minute", everyN: 30, depth: "day" })).toBe("Каждые 30 мин.");
    expect(scheduleShort({ every: "minute", everyN: 1, depth: "day" })).toBe("Раз в минуту");
    expect(scheduleShort({ every: "hour", everyN: 1, depth: "day" })).toBe("Раз в час");
  });

  it("минутное расписание обещает время, а не повод — оно идёт само", () => {
    const label = nextRunLabel(
      { every: "minute", everyN: 30, depth: "day" },
      "2026-08-16T11:50:00",
      new Date("2026-08-16T12:00:00")
    );
    expect(label).toContain("20 минут");
    expect(label).toContain("само");
  });
});
