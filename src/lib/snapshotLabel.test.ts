import { describe, it, expect } from "vitest";
import { formatBytes, snapshotSummary } from "./snapshotLabel";

const counts = (over: Partial<Parameters<typeof snapshotSummary>[0]> = {}) => ({
  transactions: 0,
  accounts: 0,
  tags: 0,
  instruments: 0,
  ...over,
});

/** Пробелы в числах неразрывные — сравниваем по обычным. */
const plain = (s: string) => s.replace(/\u00A0/g, " ");

describe("formatBytes", () => {
  it("до мегабайта — килобайты", () => {
    expect(plain(formatBytes(500 * 1024))).toBe("500 КБ");
  });

  it("дальше — мегабайты с десятой", () => {
    // «7250 КБ» приходилось делить в уме.
    expect(plain(formatBytes(7250 * 1024))).toBe("7,1 МБ");
  });

  it("ровно мегабайт уже мегабайт", () => {
    expect(plain(formatBytes(1024 * 1024))).toBe("1 МБ");
  });

  it("ноль не ломается", () => {
    expect(plain(formatBytes(0))).toBe("0 КБ");
  });
});

describe("snapshotSummary", () => {
  it("пишет всё целиком и в правильном падеже", () => {
    const s = plain(
      snapshotSummary(
        counts({ transactions: 7660, accounts: 32, tags: 48, instruments: 137 }),
        7250 * 1024
      )
    );
    expect(s).toBe("7 660 операций · 32 счёта · 48 категорий · 137 валют · 7,1 МБ");
  });

  it("единственное число склоняется", () => {
    const s = plain(
      snapshotSummary(counts({ transactions: 1, accounts: 1, tags: 1 }), 1024)
    );
    expect(s).toBe("1 операция · 1 счёт · 1 категория · 1 КБ");
  });

  it("одиннадцать — не «одиннадцать счёт»", () => {
    const s = plain(
      snapshotSummary(counts({ transactions: 11, accounts: 11, tags: 11 }), 1024)
    );
    expect(s).toContain("11 операций");
    expect(s).toContain("11 счетов");
    expect(s).toContain("11 категорий");
  });

  it("двойка-четвёрка берут родительный единственного", () => {
    const s = plain(
      snapshotSummary(counts({ transactions: 2, accounts: 3, tags: 4 }), 1024)
    );
    expect(s).toContain("2 операции");
    expect(s).toContain("3 счёта");
    expect(s).toContain("4 категории");
  });

  it("одна валюта не упоминается", () => {
    // Рублёвому пользователю строка «1 валюта» не сообщает ничего, а место ест.
    const s = plain(snapshotSummary(counts({ transactions: 5, instruments: 1 }), 1024));
    expect(s).not.toContain("валют");
  });

  it("несколько валют упоминаются", () => {
    const s = plain(snapshotSummary(counts({ transactions: 5, instruments: 3 }), 1024));
    expect(s).toContain("3 валюты");
  });

  it("нули не роняют строку", () => {
    expect(plain(snapshotSummary(counts(), 0))).toBe(
      "0 операций · 0 счетов · 0 категорий · 0 КБ"
    );
  });
});
