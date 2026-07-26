import { describe, it, expect } from "vitest";
import { displayPayee, secondaryPayee, payeeSearchText } from "./format";

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
