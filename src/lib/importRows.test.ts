import { describe, it, expect } from "vitest";
import type { ZenCache } from "./zenmoneyCache";
import type { Transaction } from "../types";
import type { XlsxCell, XlsxSheet } from "./xlsxRead";
import {
  buildImportPlan,
  canonical,
  isBlankRow,
  matchHeader,
  normalizeText,
  parseAmount,
  parseDate,
  parseTime,
  readRow,
  rowSignature,
  rowToVerdict,
  type ImportDicts,
  type ParsedRow,
} from "./importRows";
import { OPS_COLUMNS } from "./importTemplate";

const RUB = 2;
const USD = 1;

/** Кэш Дзен-мани: счета, категории, контрагенты — как у живого пользователя. */
const cache = (): ZenCache =>
  ({
    serverTimestamp: 0,
    instruments: [
      { id: RUB, shortTitle: "RUB", rate: 1 },
      { id: USD, shortTitle: "USD", rate: 90 },
    ],
    accounts: [
      { id: "acc-cash", title: "Наличные", instrument: RUB, archive: false, type: "cash" },
      { id: "acc-card", title: "Т-Банк", instrument: RUB, archive: false, type: "ccard" },
      { id: "acc-usd", title: "FFin $", instrument: USD, archive: false, type: "ccard" },
      { id: "acc-debt", title: "Долги", instrument: RUB, archive: false, type: "loan" },
    ],
    tags: [
      { id: "t-food", title: "Еда", parent: null, archive: false, showIncome: false },
      { id: "t-cafe", title: "Кафе", parent: "t-food", archive: false, showIncome: false },
      { id: "t-salary", title: "Зарплата", parent: null, archive: false, showIncome: true },
    ],
    merchants: [{ id: "m-pyat", title: "Пятёрочка" }],
    transactions: [],
    user: [{ id: 99, currency: RUB }],
  }) as unknown as ZenCache;

const dicts: ImportDicts = {
  accounts: ["Наличные", "Т-Банк", "FFin $", "Долги"],
  categories: ["Еда", "Еда / Кафе", "Зарплата"],
  payees: ["Пятёрочка"],
};

/** Лист из готовых ячеек — так тест не зависит от чтения zip. */
function sheetOf(cells: Record<string, string | number>, date1904 = false): XlsxSheet {
  const map = new Map<string, XlsxCell>();
  for (const [addr, v] of Object.entries(cells)) {
    map.set(addr, typeof v === "number" ? { kind: "number", num: v } : { kind: "text", text: v });
  }
  return { cells: map, lastRow: 99, date1904 };
}

/** Лист с нашей шапкой и одной строкой данных. */
function withHeader(row: Partial<Record<string, string | number>>): XlsxSheet {
  const cells: Record<string, string | number> = {};
  OPS_COLUMNS.forEach((name, i) => {
    cells[`${String.fromCharCode(65 + i)}1`] = name;
  });
  for (const [addr, v] of Object.entries(row)) if (v !== undefined) cells[addr] = v;
  return sheetOf(cells);
}

const parsed = (over: Partial<ParsedRow> = {}): ParsedRow => ({
  excelRow: 2,
  date: "2026-08-17",
  time: "",
  type: "Расход",
  category: "Еда / Кафе",
  outAccount: "Т-Банк",
  inAccount: "",
  amount: 1290.5,
  incomeAmount: null,
  payee: "Пятёрочка",
  comment: "",
  ...over,
});

const verdict = (over: Partial<ParsedRow> = {}, d: ImportDicts = dicts) =>
  rowToVerdict(parsed(over), d, cache(), 1_700_000_000, () => "draft-1");

describe("matchHeader — колонки по названию", () => {
  it("КЛЮЧЕВОЕ: колонки ищутся по тексту, а не по позиции", () => {
    // Человек имеет право переставить колонки и вставить свою — договор в
    // названиях, а не в порядке.
    const sheet = sheetOf({
      A1: "Комментарий",
      B1: "Моя пометка",
      C1: "Дата",
      D1: "Тип",
      E1: "Сумма",
      F1: "Категория",
      G1: "Счёт списания",
      H1: "Счёт зачисления",
      I1: "Контрагент",
      J1: "Время",
      K1: "Сумма зачисления",
    });
    const { columns, missing } = matchHeader(sheet);
    expect(missing).toEqual([]);
    expect(columns.get("Дата")).toBe("C");
    expect(columns.get("Комментарий")).toBe("A");
  });

  it("недостающие колонки называются поимённо", () => {
    const { missing } = matchHeader(sheetOf({ A1: "Дата", B1: "Сумма" }));
    expect(missing).toContain("Тип");
    expect(missing).toContain("Счёт списания");
    expect(missing).not.toContain("Дата");
  });

  it("регистр и лишние пробелы в шапке не мешают", () => {
    const { columns } = matchHeader(sheetOf({ A1: "  ДАТА ", B1: "тип" }));
    expect(columns.get("Дата")).toBe("A");
    expect(columns.get("Тип")).toBe("B");
  });
});

describe("нормализация ячеек", () => {
  it("неразрывные пробелы и ведущий апостроф вычищаются", () => {
    expect(normalizeText(" Пятёрочка ")).toBe("Пятёрочка");
    expect(normalizeText("'2026-08-17")).toBe("2026-08-17");
    expect(normalizeText("Еда  /  Кафе")).toBe("Еда / Кафе");
  });

  it("дата читается и числом, и двумя текстовыми форматами", () => {
    expect(parseDate(sheetOf({ A2: 45000 }), "A2")).toBe("2023-03-15");
    expect(parseDate(sheetOf({ A2: "17.08.2026" }), "A2")).toBe("2026-08-17");
    expect(parseDate(sheetOf({ A2: "2026-8-7" }), "A2")).toBe("2026-08-07");
    expect(parseDate(sheetOf({ A2: "позавчера" }), "A2")).toBeNull();
    expect(parseDate(sheetOf({}), "A2")).toBeNull();
  });

  it("время читается долей суток и текстом", () => {
    expect(parseTime(sheetOf({ B2: 45000.5 }), "B2")).toBe(12 * 60);
    expect(parseTime(sheetOf({ B2: "09:30" }), "B2")).toBe(9 * 60 + 30);
    expect(parseTime(sheetOf({ B2: "25:00" }), "B2")).toBeNull();
    expect(parseTime(sheetOf({}), "B2")).toBeNull();
  });

  it("сумма терпит пробелы-разделители и запятую", () => {
    expect(parseAmount(sheetOf({ G2: 1290.5 }), "G2")).toBe(1290.5);
    expect(parseAmount(sheetOf({ G2: "1 290,50" }), "G2")).toBe(1290.5);
    expect(parseAmount(sheetOf({ G2: "много" }), "G2")).toBeNull();
  });

  it("КЛЮЧЕВОЕ: написание имени приводится к справочнику", () => {
    // Билдер сравнивает названия точно. Без канонизации строка «наличные»
    // отбилась бы по причине, которой в ячейке не видно глазами.
    expect(canonical("наличные", dicts.accounts)).toMatchObject({
      value: "Наличные",
      exact: true,
    });
    expect(canonical("Т-банк ", dicts.accounts).value).toBe("Т-Банк");
  });

  it("непохожее имя приходит с подсказкой ближайшего", () => {
    expect(canonical("Т-Бан", dicts.accounts)).toMatchObject({
      exact: false,
      suggestion: "Т-Банк",
    });
  });
});

describe("readRow — чтение строки", () => {
  it("собирает поля по своим колонкам", () => {
    const row = readRow(
      withHeader({ A2: "17.08.2026", B2: "09:30", C2: "Расход", D2: "Еда / Кафе", E2: "Т-Банк", G2: 1290.5, I2: "Пятёрочка", J2: "Обед" }),
      matchHeader(withHeader({})).columns,
      2
    );
    expect(row).toMatchObject({
      excelRow: 2,
      date: "2026-08-17",
      time: "09:30",
      type: "Расход",
      category: "Еда / Кафе",
      outAccount: "Т-Банк",
      amount: 1290.5,
      payee: "Пятёрочка",
      comment: "Обед",
    });
  });

  it("пустая строка опознаётся и не считается ошибкой", () => {
    const row = readRow(withHeader({}), matchHeader(withHeader({})).columns, 5);
    expect(isBlankRow(row)).toBe(true);
    expect(isBlankRow(parsed())).toBe(false);
  });
});

describe("rowToVerdict — строка становится операцией", () => {
  it("обычный расход собирается", () => {
    const v = verdict();
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.zen).toMatchObject({ outcome: 1290.5, income: 0, merchant: "m-pyat" });
      expect(v.zen.tag).toEqual(["t-cafe"]);
    }
  });

  it("КЛЮЧЕВОЕ: минус в сумме — ошибка, а не тихий модуль", () => {
    // Знак задаёт колонка «Тип». Минус значит, что человек понял шаблон иначе,
    // и молча превращать расход в доход нельзя.
    const v = verdict({ amount: -100 });
    expect(v).toMatchObject({ ok: false });
    if (!v.ok) expect(v.reason).toContain("без минуса");
  });

  it("порядок проверок: сначала своё поле, потом справочник", () => {
    // У строки нет даты И незнакомая категория. Человеку надо сказать про дату:
    // она в его ячейке, а не в чужом справочнике.
    const v = verdict({ date: "", category: "Небо" });
    expect(v).toMatchObject({ ok: false });
    if (!v.ok) expect(v.reason).toContain("дат");
  });

  it("незнакомая категория отбивается с подсказкой", () => {
    const v = verdict({ category: "Еда / Каф" });
    expect(v).toMatchObject({ ok: false });
    if (!v.ok) expect(v.reason).toContain("Еда / Кафе");
  });

  it("расход со счётом зачисления — ошибка согласованности", () => {
    const v = verdict({ inAccount: "Наличные" });
    expect(v).toMatchObject({ ok: false });
    if (!v.ok) expect(v.reason).toContain("Счёт списания");
  });

  it("перевод с категорией — ошибка", () => {
    const v = verdict({ type: "Перевод", inAccount: "Наличные", category: "Еда" });
    expect(v).toMatchObject({ ok: false });
    if (!v.ok) expect(v.reason).toContain("категория не заполняется");
  });

  it("перевод между своими счетами собирается двумя ногами", () => {
    const v = verdict({ type: "Перевод", category: "", inAccount: "Наличные", payee: "" });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.zen).toMatchObject({
        outcomeAccount: "acc-card",
        incomeAccount: "acc-cash",
        outcome: 1290.5,
        income: 1290.5,
      });
    }
  });

  it("перевод между валютами требует сумму зачисления", () => {
    const bad = verdict({
      type: "Перевод",
      category: "",
      outAccount: "Т-Банк",
      inAccount: "FFin $",
      payee: "",
    });
    expect(bad.ok).toBe(false);
    const good = verdict({
      type: "Перевод",
      category: "",
      outAccount: "Т-Банк",
      inAccount: "FFin $",
      payee: "",
      amount: 9000,
      incomeAmount: 100,
    });
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.zen).toMatchObject({ outcome: 9000, income: 100 });
  });

  it("долг без контрагента отбивается", () => {
    const v = verdict({
      type: "Перевод",
      category: "",
      outAccount: "Т-Банк",
      inAccount: "Долги",
      payee: "",
    });
    expect(v).toMatchObject({ ok: false });
    if (!v.ok) expect(v.reason).toMatch(/контрагент|плательщик/i);
  });

  it("долг с контрагентом собирается", () => {
    const v = verdict({
      type: "Перевод",
      category: "",
      outAccount: "Т-Банк",
      inAccount: "Долги",
      payee: "Ренат",
    });
    expect(v.ok).toBe(true);
  });

  it("неизвестный тип называет допустимые", () => {
    const v = verdict({ type: "Списание" });
    expect(v).toMatchObject({ ok: false });
    if (!v.ok) expect(v.reason).toContain("Расход");
  });

  it("время из строки попадает в операцию, пустое — это полдень", () => {
    const noon = verdict();
    const nine = verdict({ time: "09:30" });
    expect(noon.ok && nine.ok).toBe(true);
    if (noon.ok && nine.ok) {
      expect(noon.zen.created).toBeGreaterThan(nine.zen.created);
      expect(noon.zen.created - nine.zen.created).toBe(2.5 * 3600);
    }
  });
});

describe("buildImportPlan — план импорта", () => {
  const existing: Transaction[] = [
    {
      id: "old-1",
      date: "2026-08-16",
      kind: "expense",
      amount: 1290.5,
      amountBase: 1290.5,
      currency: "RUB",
      account: "Т-Банк",
      payee: "Пятёрочка",
    } as Transaction,
  ];

  it("КЛЮЧЕВОЕ: похожая операция помечается дубликатом и приходит снятой", () => {
    // У черновика всегда свежий id, дедупа по id тут не существует — повторная
    // загрузка иначе создала бы вторые копии всего файла.
    const plan = buildImportPlan([parsed()], dicts, cache(), existing, 1_700_000_000, () => "d1");
    expect(plan.duplicates).toBe(1);
    expect(plan.ready).toBe(0);
    expect(plan.rows[0].picked).toBe(false);
  });

  it("дубликат внутри самого файла тоже ловится", () => {
    const plan = buildImportPlan(
      [parsed(), parsed({ excelRow: 3 })],
      dicts,
      cache(),
      [],
      1_700_000_000,
      () => "d1"
    );
    expect(plan.ready).toBe(1);
    expect(plan.duplicates).toBe(1);
  });

  it("разница в дате больше допуска — это разные операции", () => {
    const plan = buildImportPlan(
      [parsed({ date: "2026-08-25" })],
      dicts,
      cache(),
      existing,
      1_700_000_000,
      () => "d1"
    );
    expect(plan.duplicates).toBe(0);
    expect(plan.ready).toBe(1);
  });

  it("ошибочные строки считаются отдельно и не отмечены", () => {
    const plan = buildImportPlan(
      [parsed({ amount: null }), parsed({ excelRow: 3, date: "2026-08-25" })],
      dicts,
      cache(),
      [],
      1_700_000_000,
      () => "d1"
    );
    expect(plan.failed).toBe(1);
    expect(plan.ready).toBe(1);
    expect(plan.rows[0].picked).toBe(false);
    expect(plan.rows[1].picked).toBe(true);
  });
});

describe("rowSignature — подпись для поиска дублей", () => {
  it("не зависит от регистра и лишних пробелов", () => {
    const a = rowSignature({ kind: "expense", payee: " Пятёрочка ", amount: 100, currency: "RUB", account: "Т-Банк" });
    const b = rowSignature({ kind: "expense", payee: "пятёрочка", amount: 100, currency: "RUB", account: "т-банк" });
    expect(a).toBe(b);
  });

  it("копейки различают операции, а вид и счёт — тем более", () => {
    const base = { kind: "expense", payee: "X", amount: 100, currency: "RUB", account: "Т-Банк" };
    expect(rowSignature(base)).not.toBe(rowSignature({ ...base, amount: 100.01 }));
    expect(rowSignature(base)).not.toBe(rowSignature({ ...base, kind: "income" }));
    expect(rowSignature(base)).not.toBe(rowSignature({ ...base, account: "Наличные" }));
  });
});
