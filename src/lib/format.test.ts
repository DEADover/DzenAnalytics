import { describe, it, expect } from "vitest";
import { displayPayee, secondaryPayee, payeeSearchText, currencySymbol } from "./format";

describe("payeeSearchText", () => {
  it("includes both the dictionary name and the raw bank text when they differ", () => {
    expect(payeeSearchText({ brand: "STOLICHKI", payee: "APTEKA 4423 MSK" })).toBe(
      "STOLICHKI APTEKA 4423 MSK"
    );
  });

  it("does not duplicate the name when both sides are the same", () => {
    expect(payeeSearchText({ brand: "Ozon", payee: "Ozon" })).toBe("Ozon");
  });

  it("treats a case-only difference as the same name", () => {
    expect(payeeSearchText({ brand: "TASTY COFFEE", payee: "Tasty Coffee" })).toBe(
      "TASTY COFFEE"
    );
  });

  it("falls back to the raw text with no counterparty attached (CSV mode)", () => {
    expect(payeeSearchText({ brand: null, payee: "СБП перевод" })).toBe("СБП перевод");
    expect(payeeSearchText({ payee: "СБП перевод" })).toBe("СБП перевод");
  });

  it("falls back to the counterparty when the bank line is empty", () => {
    expect(payeeSearchText({ brand: "Ozon", payee: "" })).toBe("Ozon");
  });

  it("is empty when there is nothing to search", () => {
    expect(payeeSearchText({ brand: null, payee: "" })).toBe("");
  });

  it("covers whatever the row displays — so a search for it always hits", () => {
    const rows = [
      { brand: "STOLICHKI", payee: "APTEKA 4423 MSK" },
      { brand: null, payee: "СБП перевод" },
      { brand: "Ozon", payee: "" },
    ];
    for (const t of rows) {
      expect(payeeSearchText(t)).toContain(displayPayee(t));
    }
  });

  it("also covers the secondary line shown under the name", () => {
    const t = { brand: "STOLICHKI", payee: "APTEKA 4423 MSK" };
    expect(payeeSearchText(t)).toContain(secondaryPayee(t)!);
  });
});

describe("secondaryPayee — вторая строка только когда она что-то добавляет", () => {
  const tx = (payee: string, brand: string | null) =>
    ({ payee, brand }) as Parameters<typeof secondaryPayee>[0];

  it("прячет написание, отличающееся только регистром", () => {
    expect(secondaryPayee(tx("Aliexpress", "AliExpress"))).toBeNull();
  });

  it("прячет отличие в пробелах", () => {
    expect(secondaryPayee(tx("Пятёрочка  ", "Пятёрочка"))).toBeNull();
  });

  it("показывает по-настоящему другой текст от банка", () => {
    expect(secondaryPayee(tx("Сергей Г.", "AliExpress"))).toBe("Сергей Г.");
  });

  it("без контрагента второй строки нет вовсе", () => {
    expect(secondaryPayee(tx("SPAR 317", null))).toBeNull();
  });
});

describe("secondaryPayee — источник второй строки", () => {
  const tx = {
    payee: "Aliexpress",
    brand: "AliExpress",
    payeeRaw: "Сергей Г.",
  } as Parameters<typeof secondaryPayee>[0];

  it("по умолчанию берёт свободный текст получателя", () => {
    expect(secondaryPayee(tx)).toBeNull(); // совпадает с контрагентом
    expect(secondaryPayee({ ...tx, payee: "SPAR 317", brand: "SPAR" })).toBe("SPAR 317");
  });

  it("в режиме выписки берёт текст банка", () => {
    expect(secondaryPayee(tx, "statement")).toBe("Сергей Г.");
  });

  it("в режиме выписки молчит, когда банк написал то же самое", () => {
    expect(
      secondaryPayee({ payee: "x", brand: "SPAR", payeeRaw: "spar" }, "statement")
    ).toBeNull();
  });

  it("без выписки в режиме выписки второй строки нет", () => {
    expect(
      secondaryPayee({ payee: "Aliexpress", brand: "AliExpress", payeeRaw: null }, "statement")
    ).toBeNull();
  });
});

describe("currencySymbol — подписи без суммы (#57)", () => {
  it("знает ходовые валюты", () => {
    expect(currencySymbol("RUB")).toBe("₽");
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("EUR")).toBe("€");
  });

  it("для незнакомой валюты показывает её код, а не рубль", () => {
    expect(currencySymbol("XYZ")).toBe("XYZ");
  });
});
