import { describe, it, expect } from "vitest";
import {
  axisFractionDigits,
  niceStep,
  currencySymbol,
  displayPayee,
  formatNum,
  formatPct,
  payeeSearchText,
  secondaryPayee,
  truncateWords,
} from "./format";

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

describe("formatNum — округление по модулю", () => {
  it("копейки отбрасываются одинаково у плюса и у минуса", () => {
    // Сравнение самого значения давало «20 010» и «−20 010,09» в одной колонке.
    expect(formatNum(20010.09).replace(/ /g, " ")).toBe("20 010");
    expect(formatNum(-20010.09).replace(/ /g, " ")).toBe("-20 010");
  });

  it("мелкие суммы копейки сохраняют — тоже с обеих сторон нуля", () => {
    expect(formatNum(12.34)).toBe("12,34");
    expect(formatNum(-12.34)).toBe("-12,34");
  });

  it("граница ровно в тысяче", () => {
    expect(formatNum(999.99)).toBe("999,99");
    expect(formatNum(-999.99)).toBe("-999,99");
    expect(formatNum(1000.5).replace(/ /g, " ")).toBe("1 001");
    expect(formatNum(-1000.5).replace(/ /g, " ")).toBe("-1 001");
  });
});

describe("formatPct", () => {
  it("дробная часть отделяется запятой, как и все числа в интерфейсе", () => {
    // `toFixed` ставил точку, и рядом с «18 000 ₽» появлялось «18.0%».
    expect(formatPct(0.18)).toBe("18,0%");
    expect(formatPct(-0.055)).toBe("−5,5%");
  });

  it("округление до нуля не оставляет минус перед нулём", () => {
    // «−0,0%» читается как ошибка, а не как «почти не изменилось».
    expect(formatPct(-0.0004)).toBe("0,0%");
  });

  it("разрядность задаётся вызывающим", () => {
    expect(formatPct(0.18, 0)).toBe("18%");
    expect(formatPct(0.1836, 2)).toBe("18,36%");
  });

  it("не-число даёт прочерк, а не «NaN%»", () => {
    expect(formatPct(Number.NaN)).toBe("—");
    expect(formatPct(Infinity)).toBe("—");
  });
});

describe("axisFractionDigits", () => {
  it("ось от нуля обходится одним знаком", () => {
    // «0 · 950 тыс. · 1,9 млн · 2,9 млн · 3,8 млн» — деления и так различимы.
    expect(axisFractionDigits(0, 3_800_000)).toBe(1);
  });

  it("узкий размах требует больше знаков, иначе все деления «3,8 млн»", () => {
    // Ровно тот случай, ради которого функция и появилась: баланс 3,79–3,82 млн
    // за месяц. С одним знаком вся ось читается как одно и то же число.
    expect(axisFractionDigits(3_790_000, 3_820_000)).toBeGreaterThanOrEqual(3);
  });

  it("знаков не больше четырёх — дальше подпись не прочитать", () => {
    expect(axisFractionDigits(3_800_000, 3_800_001)).toBe(4);
  });

  it("плоская линия не роняет расчёт", () => {
    expect(axisFractionDigits(1000, 1000)).toBe(1);
    expect(axisFractionDigits(0, 0)).toBe(1);
  });

  it("тысячи считаются от своей единицы, а не от миллионов", () => {
    expect(axisFractionDigits(0, 8000)).toBe(1);
    expect(axisFractionDigits(7900, 8000)).toBeGreaterThanOrEqual(2);
  });
});

describe("niceStep — деления оси, которые мы считаем сами", () => {
  it("шаг круглый: 1, 2 или 5 на своём порядке", () => {
    expect(niceStep(900_000)).toBe(1_000_000);
    expect(niceStep(1_100_000)).toBe(2_000_000);
    expect(niceStep(3_000_000)).toBe(5_000_000);
    expect(niceStep(120)).toBe(200);
    expect(niceStep(1)).toBe(1);
  });

  it("на пустых и бессмысленных значениях не ломается", () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-5)).toBe(1);
    expect(niceStep(Number.NaN)).toBe(1);
  });

  it("сетка накрывает пик и не оставляет лишнего деления", () => {
    // Ровно то, ради чего шаг и считается: верх оси — ближайшее деление НАД
    // пиком, а не «ещё одно сверху для красоты».
    const peak = 3_626_504;
    const step = niceStep(peak / 4);
    const top = Math.ceil(peak / step) * step;
    expect(step).toBe(1_000_000);
    expect(top).toBe(4_000_000);
    expect(top - step).toBeLessThan(peak);
  });
});

describe("truncateWords", () => {
  it("короткий текст не трогает", () => {
    expect(truncateWords("Билеты Пхукет", 64)).toBe("Билеты Пхукет");
  });

  it("режет по слову и ставит многоточие", () => {
    const long =
      "Телевизор HiSense 65U8NQ плюс тестирование на битые пиксели и доставка до квартиры";
    const out = truncateWords(long, 40);
    expect(out.length).toBeLessThanOrEqual(41);
    expect(out.endsWith("…")).toBe(true);
    // Слово посередине не разорвано.
    expect(long.startsWith(out.slice(0, -1))).toBe(true);
    expect(out.slice(0, -1).endsWith(" ")).toBe(false);
  });

  it("одно длинное слово режет как есть — иначе остался бы огрызок", () => {
    const out = truncateWords("A" + "б".repeat(80), 20);
    expect(out).toHaveLength(21);
    expect(out.endsWith("…")).toBe(true);
  });

  it("схлопывает переводы строк и пробелы", () => {
    expect(truncateWords("  два\n\nслова  ", 64)).toBe("два слова");
  });

  it("пустое и отсутствующее — пустая строка", () => {
    expect(truncateWords("", 10)).toBe("");
    expect(truncateWords(null, 10)).toBe("");
    expect(truncateWords(undefined, 10)).toBe("");
  });
});
