import { describe, it, expect } from "vitest";
import {
  CONFIDENT,
  groupUncategorizedByDay,
  sortUncategorized,
  suggestionKey,
  suggestionReason,
  suggestionStats,
  suggestionsById,
} from "./uncategorized";
import type { Transaction } from "../types";
import type { CategorySuggestion } from "./aggregations";

const tx = (id: string, date: string, amountBase: number, payee = ""): Transaction =>
  ({
    id,
    date,
    amountBase,
    amount: amountBase,
    currency: "RUB",
    payee,
    comment: "",
    account: "Т-Банк",
    category: "",
    categoryFull: "",
    kind: "expense",
  }) as unknown as Transaction;

const sug = (
  txId: string,
  confidence: number,
  extra: Partial<CategorySuggestion> = {}
): CategorySuggestion => ({
  txId,
  payee: "Пятёрочка",
  comment: "",
  amount: -100,
  currency: "RUB",
  date: "2026-09-01",
  suggested: "Еда дома",
  confidence,
  reasonExamples: [],
  matched: 3,
  ...extra,
});

describe("порядок ленты «Без категории»", () => {
  const rows = [
    tx("a", "2026-09-01", -100, "Бета"),
    tx("b", "2026-09-03", -900, "Альфа"),
    tx("c", "2026-09-02", -50, "Гамма"),
  ];

  it("по дате — свежие сверху, и наоборот", () => {
    expect(sortUncategorized(rows, "date-desc").map((t) => t.id)).toEqual(["b", "c", "a"]);
    expect(sortUncategorized(rows, "date-asc").map((t) => t.id)).toEqual(["a", "c", "b"]);
  });

  it("по сумме — по модулю, чтобы доход и расход мерялись одинаково", () => {
    expect(sortUncategorized(rows, "amount-desc").map((t) => t.id)).toEqual(["b", "a", "c"]);
    expect(sortUncategorized(rows, "amount-asc").map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("по контрагенту — по-русски", () => {
    expect(sortUncategorized(rows, "payee-asc").map((t) => t.id)).toEqual(["b", "a", "c"]);
  });

  it("по подсказке — уверенные вперёд, без подсказки в конец", () => {
    const conf = new Map([
      ["a", 0.2],
      ["b", 0.9],
    ]);
    const out = sortUncategorized(rows, "confidence-desc", (t) => conf.get(t.id) ?? 0);
    expect(out.map((t) => t.id)).toEqual(["b", "a", "c"]);
  });

  it("исходный список не трогается", () => {
    const before = rows.map((t) => t.id);
    sortUncategorized(rows, "amount-desc");
    expect(rows.map((t) => t.id)).toEqual(before);
  });
});

describe("разбивка по дням", () => {
  const rows = [tx("a", "2026-09-03", -1), tx("b", "2026-09-03", -2), tx("c", "2026-09-01", -3)];

  it("режет по дате, когда лента идёт по дате", () => {
    const days = groupUncategorizedByDay(sortUncategorized(rows, "date-desc"), "date-desc");
    expect(days?.map((d) => [d.ymd, d.txs.length])).toEqual([
      ["2026-09-03", 2],
      ["2026-09-01", 1],
    ]);
  });

  it("при другом порядке дней нет — заголовок дня врал бы", () => {
    expect(groupUncategorizedByDay(rows, "amount-desc")).toBeNull();
    expect(groupUncategorizedByDay(rows, "confidence-desc")).toBeNull();
  });
});

describe("подсказки", () => {
  it("ключ правила — контрагент, а без него комментарий", () => {
    expect(suggestionKey({ payee: "Пятёрочка", comment: "молоко" })).toEqual({
      field: "payee",
      value: "Пятёрочка",
    });
    expect(suggestionKey({ payee: "  ", comment: "Комиссия банка" })).toEqual({
      field: "comment",
      value: "Комиссия банка",
    });
    expect(suggestionKey({ payee: "", comment: "   " })).toBeNull();
  });

  it("считает применимые и надёжные, пропуская уже применённые", () => {
    const list = [
      sug("a", 0.9),
      sug("b", CONFIDENT),
      sug("c", 0.3),
      sug("d", 0.95, { payee: "", comment: "" }),
      sug("e", 0.99),
    ];
    const stats = suggestionStats(list, new Set(["e"]));
    expect(stats).toEqual({ applicable: 3, confident: 2 });
  });

  it("раскладывает подсказки по операциям", () => {
    const map = suggestionsById([sug("a", 0.5), sug("b", 0.6)]);
    expect(map.get("b")?.confidence).toBe(0.6);
    expect(map.has("zzz")).toBe(false);
  });
});

describe("откуда взялась подсказка", () => {
  it("называет категорию, число похожих операций и по кому именно", () => {
    expect(
      suggestionReason({ suggested: "Еда дома", matched: 3, reasonExamples: ["Самокат"] })
    ).toBe("«Еда дома» — так размечены похожие операции (3): Самокат");
  });

  it("без примеров — только категория и счёт похожих", () => {
    expect(suggestionReason({ suggested: "Такси", matched: 1, reasonExamples: [] })).toBe(
      "«Такси» — так размечены похожие операции (1)"
    );
    expect(suggestionReason({ suggested: "Такси", matched: 0, reasonExamples: [] })).toBe(
      "«Такси» — так размечены похожие операции"
    );
  });

  it("перечисляет только разные имена — повтор ничего не добавляет", () => {
    expect(
      suggestionReason({ suggested: "Еда дома", matched: 5, reasonExamples: ["Самокат", "Пятёрочка"] })
    ).toContain("Самокат, Пятёрочка");
  });
});
