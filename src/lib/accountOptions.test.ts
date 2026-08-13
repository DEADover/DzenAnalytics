import { describe, it, expect } from "vitest";
import { accountOptions, capitalShare, positiveBalanceTotal } from "./accountOptions";

const meta = (
  archived: string[] = [],
  kinds: Record<string, string> = {}
) => ({
  archived: new Set(archived),
  kinds: new Map(Object.entries(kinds)),
});

describe("accountOptions", () => {
  it("счёт без единой операции всё равно попадает в отбор", () => {
    // Тот самый случай из issue #67: счёт виден на странице «Счета», а в
    // отборе «Операций» его не было — список строился только по операциям.
    const list = accountOptions(["Карта"], ["Карта", "Вклад"], meta());
    expect(list).toContain("Вклад");
  });

  it("счёт из операций остаётся, даже если справочник о нём не знает", () => {
    // Режим CSV, переименование в облаке, удалённый счёт — операции всё равно
    // на что-то ссылаются, и отобрать их нужно.
    expect(accountOptions(["Старый счёт"], [], meta())).toEqual(["Старый счёт"]);
  });

  it("без справочника (CSV) остаются одни операции", () => {
    const list = accountOptions(["Б", "А"], [], meta());
    expect(list).toEqual(["А", "Б"]);
  });

  it("повторы схлопываются", () => {
    const list = accountOptions(["Карта", "Карта"], ["Карта"], meta());
    expect(list).toEqual(["Карта"]);
  });

  it("пустые названия отбрасываются, а не превращаются в пункт-призрак", () => {
    expect(accountOptions(["", null, undefined, "Карта"], [""], meta())).toEqual([
      "Карта",
    ]);
  });

  it("архивные уходят вниз", () => {
    const list = accountOptions([], ["Архивный", "Активный"], meta(["Архивный"]));
    expect(list).toEqual(["Активный", "Архивный"]);
  });

  it("внутри активных — группами по виду счёта, внутри вида по алфавиту", () => {
    // Порядок должен читаться так же, как на странице «Счета».
    const list = accountOptions(
      [],
      ["Тинькофф", "Наличные", "Альфа", "Вклад"],
      meta([], {
        Тинькофф: "Карта",
        Альфа: "Карта",
        Наличные: "Наличные",
        Вклад: "Депозит",
      })
    );
    expect(list).toEqual(["Вклад", "Альфа", "Тинькофф", "Наличные"]);
  });

  it("архивный уходит вниз даже с «сильным» видом счёта", () => {
    const list = accountOptions(
      [],
      ["Старая карта", "Наличные"],
      meta(["Старая карта"], { "Старая карта": "Карта", Наличные: "Наличные" })
    );
    expect(list).toEqual(["Наличные", "Старая карта"]);
  });
});

describe("capitalShare", () => {
  it("доля считается от суммы положительных остатков", () => {
    const total = positiveBalanceTotal([600, 400, -100]);
    expect(total).toBe(1000);
    expect(capitalShare(600, total)).toBeCloseTo(0.6);
    expect(capitalShare(400, total)).toBeCloseTo(0.4);
  });

  it("долги в знаменатель не входят и своей доли не имеют", () => {
    // Активы 1 млн, долг 900 тыс. Если сложить всё подряд, знаменатель станет
    // 100 тыс. — и счёт на 500 тыс. получит «долю» в 500 %.
    const total = positiveBalanceTotal([500_000, 500_000, -900_000]);
    expect(total).toBe(1_000_000);
    expect(capitalShare(500_000, total)).toBeCloseTo(0.5);
    expect(capitalShare(-900_000, total)).toBeNull();
  });

  it("ноль и отсутствующий остаток доли не получают", () => {
    expect(capitalShare(0, 1000)).toBeNull();
    expect(capitalShare(null, 1000)).toBeNull();
  });

  it("считать не от чего — доли нет, а не деление на ноль", () => {
    expect(capitalShare(100, 0)).toBeNull();
    expect(positiveBalanceTotal([])).toBe(0);
    expect(positiveBalanceTotal([-5, null])).toBe(0);
  });
});
