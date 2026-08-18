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
  clearForType,
  kindOf,
  retype,
  type ImportDicts,
  type ParsedRow,
} from "./importRows";
import { OPS_COLUMNS } from "./importTemplate";
import {
  createCounterpartyMinter,
  nearestPayee,
  reconcileNewCounterparties,
} from "./counterparties";

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

describe("kindOf — вид операции по подписи типа", () => {
  it("узнаёт подпись в любом регистре и с лишними пробелами", () => {
    expect(kindOf("Расход")).toBe("expense");
    expect(kindOf(" перевод ")).toBe("transfer");
    expect(kindOf("ВОЗВРАТ")).toBe("refund");
  });

  it("непонятная подпись — не повод угадывать", () => {
    expect(kindOf("Трата")).toBeNull();
    expect(kindOf("")).toBeNull();
  });
});

describe("clearForType — смена типа чистит чужие поля", () => {
  it("КЛЮЧЕВОЕ: после смены типа строка не отбивается остатками прежнего", () => {
    // Расход со счётом списания переделали в доход. Останься счёт списания —
    // разбор ответил бы «у дохода заполняется только счёт зачисления», то есть
    // отругал бы человека за то, что сделал сам редактор.
    const wasExpense = parsed({ type: "Доход", inAccount: "Т-Банк", category: "Зарплата" });
    expect(clearForType(wasExpense)).toMatchObject({ outAccount: "", inAccount: "Т-Банк" });
  });

  it("у перевода снимается категория, у расхода — счёт зачисления", () => {
    expect(clearForType(parsed({ type: "Перевод", inAccount: "Наличные" })).category).toBe("");
    expect(clearForType(parsed({ type: "Расход", inAccount: "Наличные" })).inAccount).toBe("");
  });

  it("сумма зачисления живёт только у перевода", () => {
    expect(clearForType(parsed({ type: "Расход", incomeAmount: 10 })).incomeAmount).toBeNull();
    expect(clearForType(parsed({ type: "Перевод", incomeAmount: 10 })).incomeAmount).toBe(10);
  });

  it("непонятный тип ничего не трогает: чистить нечего, пока неясно подо что", () => {
    const row = parsed({ type: "Трата", inAccount: "Наличные" });
    expect(clearForType(row)).toEqual(row);
  });
});

describe("правка строки в отчёте", () => {
  /** Пересборка плана — ровно то, что делает отчёт после сохранения правки. */
  const replan = (rows: ParsedRow[], existing: Transaction[] = []) =>
    buildImportPlan(rows, dicts, cache(), existing, 1_700_000_000, () => "d1");

  it("КЛЮЧЕВОЕ: исправленная строка становится готовой, счётчики сходятся", () => {
    const rows = [parsed({ category: "Небо" }), parsed({ excelRow: 3, date: "2026-08-25" })];
    expect(replan(rows)).toMatchObject({ ready: 1, failed: 1 });

    const fixed = rows.map((r) => (r.excelRow === 2 ? { ...r, category: "Еда / Кафе" } : r));
    const after = replan(fixed);
    expect(after).toMatchObject({ ready: 2, failed: 0, duplicates: 0 });
    expect(after.rows[0].verdict.ok).toBe(true);
    expect(after.rows[0].picked).toBe(true);
  });

  it("правка пересчитывает дубликаты, а не только свою строку", () => {
    // Две разные операции; в одной поправили сумму — и она совпала со второй.
    const rows = [parsed(), parsed({ excelRow: 3, amount: 999 })];
    expect(replan(rows).duplicates).toBe(0);

    const after = replan(rows.map((r) => (r.excelRow === 3 ? { ...r, amount: 1290.5 } : r)));
    expect(after).toMatchObject({ ready: 1, duplicates: 1 });
    expect(after.rows[1].picked).toBe(false);
  });

  it("правка возвращает строку из дубликатов, если её больше ничто не повторяет", () => {
    const rows = [parsed(), parsed({ excelRow: 3 })];
    expect(replan(rows).duplicates).toBe(1);

    const after = replan(rows.map((r) => (r.excelRow === 3 ? { ...r, amount: 500 } : r)));
    expect(after).toMatchObject({ ready: 2, duplicates: 0 });
    expect(after.rows[1].picked).toBe(true);
  });

  it("счёт в другом регистре не мешает узнать дубликат среди своих операций", () => {
    // Правка выбирается из списка, но строка могла прийти из файла набранной
    // руками: «т-банк» — тот же счёт, и повтор надо увидеть.
    const existing: Transaction[] = [
      {
        id: "t1",
        date: "2026-08-17",
        kind: "expense",
        amount: 1290.5,
        currency: "RUB",
        account: "Т-Банк",
        payee: "Пятёрочка",
      } as unknown as Transaction,
    ];
    expect(replan([parsed({ outAccount: "т-банк" })], existing).duplicates).toBe(1);
  });
});

describe("retype — смена типа не теряет счёт", () => {
  it("КЛЮЧЕВОЕ: счёт переезжает следом за типом", () => {
    // Человек переключил «Расход» на «Доход»: операция та же и счёт тот же,
    // просто теперь деньги пришли, а не ушли. Обнулить поле значило бы
    // заставить его выбирать счёт заново — за нашу же перестановку колонок.
    const income = retype(parsed({ outAccount: "Т-Банк", inAccount: "" }), "Доход");
    expect(income).toMatchObject({ type: "Доход", inAccount: "Т-Банк", outAccount: "" });
    expect(retype(income, "Расход")).toMatchObject({ outAccount: "Т-Банк", inAccount: "" });
  });

  it("у перевода счёт встаёт источником, а получатель пуст", () => {
    // Иначе получился бы перевод на тот же счёт — и строка отбилась бы сразу.
    const t = retype(parsed({ outAccount: "Наличные" }), "Перевод");
    expect(t).toMatchObject({ outAccount: "Наличные", inAccount: "", category: "" });
  });

  it("перевод сохраняет оба счёта, пока остаётся переводом", () => {
    const t = parsed({ type: "Перевод", category: "", outAccount: "Т-Банк", inAccount: "Наличные" });
    expect(retype(t, "Перевод")).toMatchObject({ outAccount: "Т-Банк", inAccount: "Наличные" });
    expect(retype(t, "Расход")).toMatchObject({ outAccount: "Т-Банк", inAccount: "" });
  });

  it("непонятный тип только записывается — переставлять поля не подо что", () => {
    expect(retype(parsed(), "Трата")).toMatchObject({ type: "Трата", outAccount: "Т-Банк" });
  });
});

describe("контрагент, которого ещё нет в справочнике", () => {
  /** Разбор с предсказуемыми id контрагентов — как уже сделано с makeId. */
  let mint = 0;
  const nextCp = () => `cp-${++mint}`;
  const plan = (rows: ParsedRow[], pending: { id: string; title: string }[] = []) => {
    mint = 0;
    return buildImportPlan(rows, dicts, cache(), [], 1_700_000_000, () => "d1", pending, nextCp);
  };

  it("КЛЮЧЕВОЕ: новое имя — не ошибка, а запись, которой пока нет", () => {
    // Требовать «сначала заведите контрагента в Дзен-мани» — значит гонять
    // человека между двумя приложениями из-за одной строки файла.
    const p = plan([parsed({ payee: "Ларёк у дома" })]);
    expect(p).toMatchObject({ ready: 1, failed: 0 });
    const v = p.rows[0].verdict;
    expect(v.ok && v.newCounterparty).toMatchObject({ id: "cp-1", title: "Ларёк у дома" });
    expect(v.ok && v.zen.merchant).toBe("cp-1");
    expect(p.newCounterparties).toEqual([{ id: "cp-1", title: "Ларёк у дома" }]);
  });

  it("КЛЮЧЕВОЕ: одно имя в разном регистре — одна запись и один id", () => {
    // Иначе в справочник уедут два одинаковых контрагента, а операции
    // разъедутся по ним; склеить их потом можно только вручную.
    const p = plan([
      parsed({ payee: "Ларёк у дома" }),
      parsed({ excelRow: 3, amount: 500, payee: " ларёк у дома " }),
    ]);
    const ids = p.rows.map((r) => (r.verdict.ok ? r.verdict.zen.merchant : null));
    expect(ids[0]).toBe("cp-1");
    expect(ids[1]).toBe("cp-1");
    // Написание — от первой строки.
    expect(p.newCounterparties).toEqual([{ id: "cp-1", title: "Ларёк у дома" }]);
  });

  it("знакомое имя в другом регистре берёт запись из справочника", () => {
    const p = plan([parsed({ payee: "пятЁрочка" })]);
    const v = p.rows[0].verdict;
    expect(v.ok && v.zen.merchant).toBe("m-pyat");
    expect(v.ok && v.newCounterparty).toBeUndefined();
    expect(p.newCounterparties).toEqual([]);
  });

  it("уже заведённый локально контрагент второй раз не заводится", () => {
    const p = plan([parsed({ payee: "Ларёк у дома" })], [{ id: "cp-old", title: "ларёк у дома" }]);
    const v = p.rows[0].verdict;
    expect(v.ok && v.zen.merchant).toBe("cp-old");
    expect(p.newCounterparties).toEqual([]);
  });

  it("опечатка получает подсказку, но имя не подменяется молча", () => {
    // «Пятерочка» при живой «Пятёрочке» — обычно опечатка, но бывает и
    // вправду другая лавка: решать человеку.
    const p = plan([parsed({ payee: "Пятерочка" })]);
    const v = p.rows[0].verdict;
    expect(v.ok && v.payeeHint).toBe("Пятёрочка");
    expect(v.ok && v.newCounterparty?.title).toBe("Пятерочка");
  });

  it("у долга новый контрагент проставляется и записью, и текстом", () => {
    const p = plan([
      parsed({ type: "Перевод", category: "", outAccount: "Т-Банк", inAccount: "Долги", payee: "Тётя Маша" }),
    ]);
    const v = p.rows[0].verdict;
    expect(v.ok && v.zen.merchant).toBe("cp-1");
    expect(v.ok && v.zen.payee).toBe("Тётя Маша");
  });

  it("долг без контрагента отбивается прежними словами", () => {
    const p = plan([
      parsed({ type: "Перевод", category: "", outAccount: "Т-Банк", inAccount: "Долги", payee: "" }),
    ]);
    expect(p.rows[0].verdict).toMatchObject({
      ok: false,
      reason: "Укажите плательщика (контрагента) для долговой операции.",
    });
  });

  it("пустое имя ничего не заводит", () => {
    const p = plan([parsed({ payee: "" })]);
    expect(p.newCounterparties).toEqual([]);
    expect(p.rows[0].verdict.ok && p.rows[0].verdict.zen.merchant).toBeFalsy();
  });

  it("КЛЮЧЕВОЕ: отбитая строка контрагента не заводит", () => {
    // Её id умирает вместе с ней — иначе в справочнике появилась бы запись
    // под операцию, которой не будет.
    const p = plan([parsed({ payee: "Ларёк у дома", date: "" })]);
    expect(p.rows[0].verdict.ok).toBe(false);
    expect(p.newCounterparties).toEqual([]);
  });
});

describe("nearestPayee — похожее имя из справочника", () => {
  const list = ["Пятёрочка", "Ozon", "Тётя Маша"];

  it("«ё» и «е» не различают имена, когда ищем похожее", () => {
    expect(nearestPayee("Пятерочка", list)).toBe("Пятёрочка");
    expect(nearestPayee("тетя маша", list)).toBe("Тётя Маша");
  });

  it("незнакомое имя не притягивается за уши", () => {
    expect(nearestPayee("Ларёк у дома", list)).toBeUndefined();
    expect(nearestPayee("", list)).toBeUndefined();
  });
});

describe("reconcileNewCounterparties — сверка в момент записи", () => {
  const tx = (id: string, merchant: string) =>
    ({ id, merchant }) as unknown as import("./zenmoney").ZenTransaction;

  it("КЛЮЧЕВОЕ: заведённого за это время контрагента вторым не плодим", () => {
    // Пока человек смотрел отчёт, то же имя могли завести руками или оно
    // приехало из облака.
    const out = reconcileNewCounterparties(
      [tx("t1", "cp-1")],
      [{ id: "cp-1", title: "Ларёк у дома" }],
      [{ id: "m-lar", title: "ларёк У ДОМА" }]
    );
    expect(out.toCreate).toEqual([]);
    expect(out.txs[0].merchant).toBe("m-lar");
  });

  it("то же самое для имени, заведённого локально", () => {
    const out = reconcileNewCounterparties(
      [tx("t1", "cp-1")],
      [{ id: "cp-1", title: "Ларёк" }],
      [],
      [{ id: "cp-old", title: "Ларёк" }]
    );
    expect(out.toCreate).toEqual([]);
    expect(out.txs[0].merchant).toBe("cp-old");
  });

  it("совпадений нет — всё остаётся как было", () => {
    const txs = [tx("t1", "cp-1")];
    const out = reconcileNewCounterparties(txs, [{ id: "cp-1", title: "Ларёк" }], []);
    expect(out.toCreate).toEqual([{ id: "cp-1", title: "Ларёк" }]);
    expect(out.txs).toBe(txs);
  });
});

describe("createCounterpartyMinter", () => {
  it("облако важнее локального черновика с тем же именем", () => {
    // Иначе на одно имя было бы две записи: одна в облаке, вторая наша.
    const m = createCounterpartyMinter(
      [{ id: "m-1", title: "Ларёк" }],
      [{ id: "cp-1", title: "ларёк" }]
    );
    expect(m.resolve("ЛАРЁК")).toMatchObject({ id: "m-1", isNew: false });
    expect(m.minted()).toEqual([]);
  });

  it("«ё» и «е» — разные записи: иначе такого контрагента не завести", () => {
    const m = createCounterpartyMinter([{ id: "m-1", title: "Пятёрочка" }], [], () => "cp-1");
    expect(m.resolve("Пятерочка")).toMatchObject({ id: "cp-1", isNew: true });
  });
});
