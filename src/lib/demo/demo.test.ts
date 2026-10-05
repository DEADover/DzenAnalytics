import { describe, expect, it } from "vitest";
import { DEMO_TODAY, demoDiff } from "./demoAccount";
import { DEMO_TOKEN, isDemoToken, respondDemo } from "./demoServer";

describe("demoDiff — история до «сегодня»", () => {
  it("для любой даты операции доходят ровно до неё, текущий месяц не пустой", () => {
    for (const today of ["2026-10-05", "2027-03-31", "2026-02-28", DEMO_TODAY]) {
      const d = demoDiff(1, today);
      const dates = d.transaction.map((t) => t.date).sort();
      expect(dates[dates.length - 1] <= today).toBe(true);
      expect(dates.some((x) => x.slice(0, 7) === today.slice(0, 7))).toBe(true);
      // Без малого два года истории.
      expect(dates[0].slice(0, 7) <= `${Number(today.slice(0, 4)) - 1}-${today.slice(5, 7)}`).toBe(true);
    }
  });

  it("события года — в своих месяцах при любом «сегодня»", () => {
    for (const today of ["2027-03-10", "2026-10-05", "2028-01-20"]) {
      const d = demoDiff(1, today);
      const salary = d.transaction.filter((t) => t.comment === "Зарплата");
      expect(salary.every((t) => t.date.endsWith("-05"))).toBe(true);
      const months = (tag: string) => new Set(d.transaction.filter((t) => t.tag?.[0] === tag).map((t) => t.date.slice(5, 7)));
      // Отпуск — летом, подарки — в декабре и к 8 Марта.
      for (const m of months("t-travel")) expect(["06", "07"]).toContain(m);
      for (const m of months("t-gifts")) expect(["03", "12"]).toContain(m);
      expect(months("t-travel").size).toBeGreaterThan(0);
    }
  });

  it("пять лет истории, комментарий у каждой операции, хэштеги и удалённые дубли", () => {
    const d = demoDiff(1, "2026-10-05");
    const dates = d.transaction.map((t) => t.date).sort();
    expect(dates[0].slice(0, 7)).toBe("2021-11");
    expect(d.transaction.every((t) => !!t.comment && t.comment.trim().length > 0)).toBe(true);
    const text = d.transaction.map((t) => t.comment).join(" ");
    for (const tag of ["#Отпуск", "#Лечение", "#Кот", "#Собака"]) expect(text).toContain(tag);
    // Хэштеги — не у каждой второй операции.
    const tagged = d.transaction.filter((t) => t.comment?.includes("#")).length;
    expect(tagged / d.transaction.length).toBeLessThan(0.1);
    expect(d.transaction.filter((t) => t.deleted).length).toBeGreaterThan(10);
    expect(d.tag.find((t) => t.id === "t-pets")?.title).toBe("Животные");
  });

  it("остатки счетов не уходят в минус ни на один день (кредитка — в пределах лимита)", () => {
    for (const today of ["2026-10-05", "2028-02-10", "2027-07-01"]) {
      const d = demoDiff(1, today);
      const bal = new Map(d.account.map((a) => [a.id, a.startBalance]));
      for (const t of d.transaction.filter((x) => !x.deleted).sort((a, b) => a.date.localeCompare(b.date))) {
        bal.set(t.outcomeAccount, bal.get(t.outcomeAccount)! - t.outcome);
        bal.set(t.incomeAccount, bal.get(t.incomeAccount)! + t.income);
        for (const a of d.account) {
          const floor = a.creditLimit ? -a.creditLimit : 0;
          expect(bal.get(a.id)!, `${today} ${a.title} ${t.date}`).toBeGreaterThanOrEqual(floor);
        }
      }
    }
  });

  it("одна и та же дата — один и тот же аккаунт", () => {
    expect(JSON.stringify(demoDiff(1, "2026-11-02"))).toBe(JSON.stringify(demoDiff(1, "2026-11-02")));
  });

  it("планы — только будущие даты, от текущего месяца на три вперёд", () => {
    const today = "2026-10-15";
    const m = demoDiff(1, today).reminderMarker ?? [];
    expect(m.length).toBeGreaterThan(0);
    expect(m.every((x) => x.date > today && x.date <= "2027-01-31")).toBe(true);
  });
});

describe("respondDemo — «Дзен-мани» в браузере", () => {
  it("первая синхронизация — аккаунт целиком, следующая — пусто", () => {
    expect(isDemoToken(DEMO_TOKEN)).toBe(true);
    expect(isDemoToken("настоящий")).toBe(false);
    const first = respondDemo({ serverTimestamp: 0 });
    expect(first.transaction.length).toBeGreaterThan(500);
    const next = respondDemo({ serverTimestamp: first.serverTimestamp });
    expect(next.transaction).toEqual([]);
    expect(next.serverTimestamp).toBeGreaterThan(first.serverTimestamp);
  });

  it("отправленное возвращается как принятое", () => {
    const tx = { id: "x1" } as never;
    const res = respondDemo({ serverTimestamp: 5, transaction: [tx] });
    expect(res.transaction).toEqual([tx]);
  });

  it("дозапрос справочника — целиком", () => {
    const res = respondDemo({ serverTimestamp: 5, forceFetch: ["user", "reminderMarker"] });
    expect(res.user.length).toBe(1);
    expect((res.reminderMarker ?? []).length).toBeGreaterThan(0);
    expect(res.transaction).toEqual([]);
  });
});
