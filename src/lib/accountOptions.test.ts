import { describe, it, expect } from "vitest";
import {
  accountOptions,
  capitalShare,
  mergeLiveByTitle,
  positiveBalanceTotal,
} from "./accountOptions";

const meta = (
  archived: string[] = [],
  kinds: Record<string, string> = {}
) => ({
  archived: new Set(archived),
  kinds: new Map(Object.entries(kinds)),
});

describe("accountOptions", () => {
  it("счёт без единой операции всё равно попадает в фильтр", () => {
    // Тот самый случай из issue #67: счёт виден на странице «Счета», а в
    // фильтре «Операций» его не было — список строился только по операциям.
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

describe("mergeLiveByTitle: одноимённые счета (issue #89)", () => {
  // Курсы: рубль к евро примерно сотня.
  const toBase = (amt: number, cur: string) => (cur === "EUR" ? amt : amt / 100);
  const acc = (title: string, balance: number, currency = "EUR") => ({
    title,
    balance,
    currency,
  });

  it("складывает остатки долговых счетов разных валют", () => {
    // У Дзен-мани долговой счёт свой на каждую валюту, и все зовутся «Долги».
    // Карта по названию оставляла последний — в списке стоял ноль вместо 690.
    const m = mergeLiveByTitle(
      [acc("Долги", 690), acc("Долги", 0, "RUB"), acc("Долги", 0, "USD")],
      toBase
    );
    expect(m.size).toBe(1);
    expect(m.get("Долги")!.base).toBeCloseTo(690, 6);
    expect(m.get("Долги")!.count).toBe(3);
  });

  it("представителем берёт самый крупный по модулю", () => {
    const m = mergeLiveByTitle([acc("Долги", 5), acc("Долги", -900)], toBase);
    expect(m.get("Долги")!.lead.balance).toBe(-900);
  });

  it("родной суммы у разных валют нет, у одинаковых — есть", () => {
    const mixed = mergeLiveByTitle([acc("Долги", 690), acc("Долги", 100, "RUB")], toBase);
    expect(mixed.get("Долги")!.native).toBeNull();
    const same = mergeLiveByTitle([acc("Долги", 690), acc("Долги", 10)], toBase);
    expect(same.get("Долги")!.native).toEqual({ balance: 700, currency: "EUR" });
  });

  it("разные названия не смешивает", () => {
    const m = mergeLiveByTitle([acc("Карта", 10), acc("Долги", 690)], toBase);
    expect(m.size).toBe(2);
    expect(m.get("Карта")!.count).toBe(1);
  });
});
