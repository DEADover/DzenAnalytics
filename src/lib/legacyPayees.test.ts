import { describe, expect, it } from "vitest";
import { restoreOriginalPayees } from "./legacyPayees";
import { tx } from "../test/fixtures";

describe("restoreOriginalPayees — лента после бывшей «Группировки получателей»", () => {
  it("склеенное имя возвращается к тексту из Дзен-мани", () => {
    const a = tx({ payee: "Ёлочка", payeeOriginal: "YOLOCHKA-MOSCOW" });
    const b = tx({ payee: "Магнит", payeeOriginal: "Магнит" });
    const { txs, changed } = restoreOriginalPayees([a, b]);
    expect(changed).toBe(true);
    expect(txs.map((t) => t.payee)).toEqual(["YOLOCHKA-MOSCOW", "Магнит"]);
    expect(txs[1]).toBe(b);
  });

  it("менять нечего — тот же массив, без перезаписи ленты", () => {
    const list = [tx({ payee: "Магнит", payeeOriginal: "Магнит" }), tx({ payee: "Без исходного" })];
    delete (list[1] as { payeeOriginal?: string }).payeeOriginal;
    const { txs, changed } = restoreOriginalPayees(list);
    expect(changed).toBe(false);
    expect(txs).toBe(list);
  });
});
