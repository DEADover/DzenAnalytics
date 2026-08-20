import { describe, it, expect } from "vitest";
import { nestedBranches, visibleOptions } from "./nestedOptions";
import { debtKey, parseDebtKey } from "./debtFilter";

/** Признак ветки — тот же, что в отборе счетов: пара «счёт → контрагент». */
const isNested = (opt: string) => parseDebtKey(opt) !== null;

const ИВАН = debtKey("Долги", "Иван");
const МАША = debtKey("Долги", "Маша");
const БАНК = debtKey("Долги в валюте", "Банк");

const OPTIONS = ["Сбер", "Долги", ИВАН, МАША, "Долги в валюте", БАНК, "Кошелёк"];

describe("разбор списка на ветки", () => {
  const branches = nestedBranches(OPTIONS, isNested);

  it("контрагенты уходят под свой счёт, в порядке списка", () => {
    expect(branches.children.get("Долги")).toEqual([ИВАН, МАША]);
    expect(branches.children.get("Долги в валюте")).toEqual([БАНК]);
  });

  it("у ветки известен её родитель", () => {
    expect(branches.parent.get(ИВАН)).toBe("Долги");
    expect(branches.parent.get(БАНК)).toBe("Долги в валюте");
  });

  it("обычные счета веток не заводят", () => {
    expect(branches.children.has("Сбер")).toBe(false);
    expect(branches.parent.has("Кошелёк")).toBe(false);
  });

  it("без признака вложенности веток нет вовсе", () => {
    const flat = nestedBranches(OPTIONS);
    expect(flat.children.size).toBe(0);
    expect(flat.parent.size).toBe(0);
  });

  it("ветка без родителя ничьей не становится", () => {
    // Так список приходит из поиска: нашёлся человек, а сам счёт — нет.
    const branches = nestedBranches([ИВАН, МАША], isNested);
    expect(branches.parent.size).toBe(0);
    expect(branches.children.size).toBe(0);
  });
});

describe("видимые варианты", () => {
  const branches = nestedBranches(OPTIONS, isNested);

  it("свёрнуто по умолчанию: счета на месте, контрагентов не видно", () => {
    expect(visibleOptions(OPTIONS, branches, new Set())).toEqual([
      "Сбер",
      "Долги",
      "Долги в валюте",
      "Кошелёк",
    ]);
  });

  it("раскрывается только та ветка, которую раскрыли", () => {
    expect(visibleOptions(OPTIONS, branches, new Set(["Долги"]))).toEqual([
      "Сбер",
      "Долги",
      ИВАН,
      МАША,
      "Долги в валюте",
      "Кошелёк",
    ]);
  });

  it("раскрытые ветки дают список целиком", () => {
    const all = new Set(["Долги", "Долги в валюте"]);
    expect(visibleOptions(OPTIONS, branches, all)).toEqual(OPTIONS);
  });

  it("список без веток не трогается", () => {
    const plain = ["Сбер", "Кошелёк"];
    const flat = nestedBranches(plain, isNested);
    expect(visibleOptions(plain, flat, new Set())).toBe(plain);
  });

  it("ветка без родителя видна и свёрнутой", () => {
    const orphans = [ИВАН, МАША];
    const branches = nestedBranches(orphans, isNested);
    expect(visibleOptions(orphans, branches, new Set())).toEqual(orphans);
  });
});
