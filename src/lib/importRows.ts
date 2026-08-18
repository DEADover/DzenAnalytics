/**
 * Разбор заполненного шаблона: строки Excel → готовые операции Дзен-мани.
 *
 * Здесь нет ни одной собственной проверки «а примет ли облако»: окончательный
 * судья — `buildDraftTransaction`, тот же, что собирает операцию из формы
 * создания. Что прошло здесь — гарантированно уйдёт в облако, и формулировки
 * отказов человек видит те же, что и в форме.
 *
 * Своё в этом файле только то, чего у формы нет и быть не может:
 *
 *   • нормализация ячейки — Excel щедро подсыпает неразрывные пробелы,
 *     ведущие апострофы и числа-строки;
 *   • канонизация имён по справочнику: «наличные» → «Наличные». Билдер
 *     сравнивает названия ТОЧНО, и без этого шага половина строк отбивалась бы
 *     по причине, которую в ячейке не видно глазами;
 *   • подпись строки для поиска дублей: у черновика всегда свежий id, так что
 *     повторная загрузка того же файла иначе создала бы вторые копии всего.
 *
 * Всё чистое и без ввода-вывода — это единственный способ покрыть логику
 * тестами: DOM в тестах проекта нет.
 */

import type { Transaction, TxKind } from "../types";
import type { ZenTransaction } from "./zenmoney";
import type { ZenCache } from "./zenmoneyCache";
import {
  buildDraftTransaction,
  newDraftId,
  type DraftFields,
  type NewCounterpartyDraft,
} from "./zenmoneyPush";
import {
  createCounterpartyMinter,
  nearestPayee,
  type CounterpartyMinter,
} from "./counterparties";
import { validateOperation } from "./operationValidation";
import { splitCategoryFull } from "./ruleEngine";
import { OPS_COLUMNS, OP_TYPES, type OpsColumn, type OpTypeLabel } from "./importTemplate";
import { cellNumber, cellText, colOf, rowOf, serialToParts, type XlsxSheet } from "./xlsxRead";

/** Больше тысячи строк за раз — повод разбить файл, а не ждать зависшую вкладку. */
export const MAX_ROWS = 1000;

/** Тип операции из шаблона → вид операции в приложении. */
const KIND_BY_LABEL: Record<OpTypeLabel, TxKind> = {
  Расход: "expense",
  Доход: "income",
  Возврат: "refund",
  Перевод: "transfer",
};

export interface ImportDicts {
  /** Названия счетов ровно так, как они записаны в Дзен-мани. */
  accounts: string[];
  /** Полные пути категорий: «Еда / Кафе». */
  categories: string[];
  /** Контрагенты из справочника. */
  payees: string[];
}

/** Что мы поняли из строки — до того, как за неё взялся билдер. */
export interface ParsedRow {
  /** Номер строки на листе Excel — им человек и найдёт её у себя. */
  excelRow: number;
  date: string;
  time: string;
  type: string;
  category: string;
  outAccount: string;
  inAccount: string;
  amount: number | null;
  incomeAmount: number | null;
  payee: string;
  comment: string;
}

export type RowVerdict =
  | {
      ok: true;
      zen: ZenTransaction;
      /** Валюта счёта строки — только чтобы показать сумму в отчёте. */
      currency: string;
      duplicateOf?: string;
      /**
       * Контрагента с таким именем в справочнике нет — заведём вместе с
       * операцией. Не ошибка: вписать нового поставщика в свой файл человек
       * имеет полное право, а требовать «сначала заведите в Дзен-мани» —
       * значит гонять его между двумя приложениями из-за одной строки.
       */
      newCounterparty?: NewCounterpartyDraft;
      /**
       * Похожее имя из справочника. Только подсказка: «Пятерочка» при живой
       * «Пятёрочке» — обычно опечатка, но бывает и вправду другая лавка,
       * поэтому молча подменять имя нельзя.
       */
      payeeHint?: string;
    }
  | { ok: false; reason: string };

export interface PlanRow extends ParsedRow {
  verdict: RowVerdict;
  /** Брать ли строку в импорт. Дубликаты приходят снятыми. */
  picked: boolean;
}

export interface ImportPlan {
  rows: PlanRow[];
  ready: number;
  failed: number;
  duplicates: number;
  /** Контрагенты, которых придётся завести. Уникальные, только по годным строкам. */
  newCounterparties: NewCounterpartyDraft[];
}

/* ------------------------------------------------------------------ шапка */

/**
 * Колонки листа по тексту шапки: «Дата» → «A».
 *
 * По тексту, а не по позиции: человек переставит колонки местами или вставит
 * свою — и это его право, пока названия на месте.
 */
export function matchHeader(sheet: XlsxSheet): {
  columns: Map<OpsColumn, string>;
  missing: OpsColumn[];
} {
  const byName = new Map<string, string>();
  for (const [addr] of sheet.cells) {
    if (rowOf(addr) !== 1) continue;
    const name = headerName(cellText(sheet, addr)).toLowerCase();
    if (name && !byName.has(name)) byName.set(name, colOf(addr));
  }
  const columns = new Map<OpsColumn, string>();
  const missing: OpsColumn[] = [];
  for (const col of OPS_COLUMNS) {
    const at = byName.get(col.toLowerCase());
    if (at) columns.set(col, at);
    else missing.push(col);
  }
  return { columns, missing };
}

/**
 * Имя колонки из текста шапки: «Счёт списания (расход, перевод)» → «Счёт
 * списания».
 *
 * В шаблоне к названиям приписано, для каких типов операций колонка нужна —
 * без этого «Счёт списания» и «Счёт зачисления» стоят рядом одинаково
 * убедительно. Договор с разбором при этом остаётся в самом названии: приписка
 * в скобках отбрасывается, и файл со старой шапкой читается по-прежнему.
 */
export function headerName(raw: string): string {
  return normalizeText(raw.replace(/\s*\(.*$/, ""));
}

/* ------------------------------------------------------------- нормализация */

/** Убрать то, чего пользователь не видит: неразрывные пробелы, хвосты, апостроф. */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\u00a0/g, " ")
    .replace(/^'/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Дата ячейки → «ГГГГ-ММ-ДД».
 *
 * Excel хранит настоящую дату числом; текстом она приходит из Google Таблиц и
 * от тех, кто набирал руками. Принимаем оба вида и оба порядка — «ДД.ММ.ГГГГ»
 * привычнее человеку, «ГГГГ-ММ-ДД» приходит из выгрузок.
 */
export function parseDate(sheet: XlsxSheet, addr: string): string | null {
  const num = cellNumber(sheet, addr);
  if (num !== null) {
    if (num <= 0) return null;
    const p = serialToParts(num, sheet.date1904);
    return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  }
  const text = normalizeText(cellText(sheet, addr));
  if (!text) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) return `${iso[1]}-${pad(+iso[2])}-${pad(+iso[3])}`;
  const ru = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/.exec(text);
  if (ru) return `${ru[3]}-${pad(+ru[2])}-${pad(+ru[1])}`;
  return null;
}

/** Время ячейки → минуты от полуночи; `null` — не заполнено или мусор. */
export function parseTime(sheet: XlsxSheet, addr: string): number | null {
  const num = cellNumber(sheet, addr);
  if (num !== null) {
    // Время Excel — доля суток; целое число здесь означает «дата без времени».
    const p = serialToParts(num, sheet.date1904);
    return p.hh * 60 + p.mm;
  }
  const text = normalizeText(cellText(sheet, addr));
  if (!text) return null;
  const m = /^(\d{1,2})[:.](\d{2})/.exec(text);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

/**
 * Сумма ячейки.
 *
 * Число берём как есть; строку чистим от пробелов-разделителей и запятой.
 * Отрицательное значение — не повод молча взять модуль: знак в шаблоне задаёт
 * колонка «Тип», и минус здесь значит, что человек понял шаблон иначе.
 */
export function parseAmount(sheet: XlsxSheet, addr: string): number | null {
  const num = cellNumber(sheet, addr);
  if (num !== null) return num;
  const text = normalizeText(cellText(sheet, addr)).replace(/\s/g, "").replace(",", ".");
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * Привести имя к написанию из справочника.
 *
 * Возвращает и подсказку: если точного совпадения нет, ищем ближайшее — по
 * началу строки и по вхождению. «Тинькоф» → «Тинькофф Блэк» человек узнает
 * сразу, а «не найдено» без вариантов заставляет его гадать.
 */
export function canonical(
  raw: string,
  dict: string[]
): { value: string; exact: boolean; suggestion?: string } {
  const value = normalizeText(raw);
  if (!value) return { value: "", exact: false };
  const lower = value.toLowerCase();
  const hit = dict.find((d) => d.toLowerCase() === lower);
  if (hit) return { value: hit, exact: true };
  const near =
    dict.find((d) => d.toLowerCase().startsWith(lower)) ??
    dict.find((d) => d.toLowerCase().includes(lower)) ??
    dict.find((d) => lower.includes(d.toLowerCase()));
  return { value, exact: false, suggestion: near };
}

/* ---------------------------------------------------------------- разбор */

/** Прочитать строку листа как есть, без суждений о её правильности. */
export function readRow(
  sheet: XlsxSheet,
  columns: Map<OpsColumn, string>,
  excelRow: number
): ParsedRow {
  const at = (col: OpsColumn) => `${columns.get(col) ?? "A"}${excelRow}`;
  const txt = (col: OpsColumn) => normalizeText(cellText(sheet, at(col)));
  const time = parseTime(sheet, at("Время"));
  return {
    excelRow,
    date: parseDate(sheet, at("Дата")) ?? "",
    time: time === null ? "" : `${pad(Math.floor(time / 60))}:${pad(time % 60)}`,
    type: txt("Тип"),
    category: txt("Категория"),
    outAccount: txt("Счёт списания"),
    inAccount: txt("Счёт зачисления"),
    amount: parseAmount(sheet, at("Сумма")),
    incomeAmount: parseAmount(sheet, at("Сумма зачисления")),
    payee: txt("Контрагент"),
    comment: txt("Комментарий"),
  };
}

/** Вид операции по подписи из колонки «Тип»; `null` — подпись непонятна. */
export function kindOf(type: string): TxKind | null {
  const hit = OP_TYPES.find((t) => t.toLowerCase() === normalizeText(type).toLowerCase());
  return hit ? KIND_BY_LABEL[hit] : null;
}

/**
 * Убрать из строки колонки, которых у её типа быть не должно.
 *
 * Разбор считает лишнее заполненное поле ошибкой — и правильно делает: в файле
 * это признак того, что строку поняли иначе. Но в редакторе отчёта тип меняют
 * осознанно, и оставлять после «Расход → Доход» счёт списания, чтобы тут же
 * отбить строку своей же подсказкой, — издевательство. Поэтому смена типа
 * чистит поля, которые к новому типу не относятся.
 */
export function clearForType(row: ParsedRow): ParsedRow {
  switch (kindOf(row.type)) {
    case "transfer":
      return { ...row, category: "" };
    case "expense":
      return { ...row, inAccount: "", incomeAmount: null };
    case "income":
    case "refund":
      return { ...row, outAccount: "", incomeAmount: null };
    default:
      return row;
  }
}

/**
 * Сменить тип строки, не потеряв счёт.
 *
 * У расхода счёт лежит в «списании», у дохода — в «зачислении», и человек,
 * переключивший тип, имел в виду ТУ ЖЕ операцию на том же счёте, а не пустое
 * поле. Поэтому счёт переезжает следом за типом; у перевода он встаёт
 * источником, а получатель остаётся пустым — иначе вышел бы перевод на самого
 * себя, который отбивается.
 */
export function retype(row: ParsedRow, type: string): ParsedRow {
  const before = kindOf(row.type);
  const next = kindOf(type);
  if (!next) return { ...row, type };
  const main = row.outAccount || row.inAccount;
  const moved: ParsedRow =
    next === "income" || next === "refund"
      ? { ...row, type, inAccount: main, outAccount: "" }
      : next === "transfer"
        ? { ...row, type, outAccount: main, inAccount: before === "transfer" ? row.inAccount : "" }
        : { ...row, type, outAccount: main, inAccount: "" };
  return clearForType(moved);
}

/** Пустая строка — это конец данных или дырка в середине, но не ошибка. */
export function isBlankRow(row: ParsedRow): boolean {
  return (
    !row.date &&
    !row.type &&
    !row.category &&
    !row.outAccount &&
    !row.inAccount &&
    row.amount === null &&
    !row.payee &&
    !row.comment
  );
}

/**
 * Строка → операция или причина отказа.
 *
 * Порядок проверок — от того, что человек видит в ячейке, к тому, что знает
 * только облако: сначала «что не заполнено», потом «чего нет в справочнике».
 * Обратный порядок отвечал бы «категория не найдена» на строке, где вообще нет
 * даты.
 */
export function rowToVerdict(
  row: ParsedRow,
  dicts: ImportDicts,
  cache: ZenCache,
  stampSeconds: number,
  makeId: () => string = newDraftId,
  /**
   * Общий на весь файл связыватель контрагентов. Без него делается разовый —
   * это режим живого вердикта в редакторе строки: показать статус надо, а
   * запоминать заведённое там незачем, коммит всё равно берёт план целиком.
   */
  minter: CounterpartyMinter = createCounterpartyMinter(cache.merchants)
): RowVerdict {
  if (!row.date) return { ok: false, reason: "Не разобрали дату. Формат: 17.08.2026" };
  if (!row.type) return { ok: false, reason: "Не заполнен тип операции" };

  const typeHit = OP_TYPES.find((t) => t.toLowerCase() === row.type.toLowerCase());
  if (!typeHit) {
    return {
      ok: false,
      reason: `Тип «${row.type}» непонятен. Выберите из списка: ${OP_TYPES.join(", ")}`,
    };
  }
  const kind = KIND_BY_LABEL[typeHit];

  if (row.amount === null) return { ok: false, reason: "Не заполнена сумма" };
  if (row.amount < 0) {
    return {
      ok: false,
      reason: "Сумма пишется без минуса — направление задаёт колонка «Тип»",
    };
  }

  // Счета и категория — с приведением к написанию справочника.
  const outAcc = canonical(row.outAccount, dicts.accounts);
  const inAcc = canonical(row.inAccount, dicts.accounts);
  for (const [label, hit] of [
    ["Счёт списания", outAcc],
    ["Счёт зачисления", inAcc],
  ] as const) {
    if (hit.value && !hit.exact) {
      return {
        ok: false,
        reason: hit.suggestion
          ? `${label} «${hit.value}» не найден. Похоже на «${hit.suggestion}»`
          : `${label} «${hit.value}» не найден в Дзен-мани`,
      };
    }
  }

  const cat = canonical(row.category, dicts.categories);
  if (cat.value && !cat.exact) {
    return {
      ok: false,
      reason: cat.suggestion
        ? `Категория «${cat.value}» не найдена. Похоже на «${cat.suggestion}»`
        : `Категория «${cat.value}» не найдена в Дзен-мани — возможно, её убрали в архив`,
    };
  }

  // Согласованность колонок с типом: лишнее заполненное поле — это не мелочь,
  // а признак того, что строку поняли иначе, чем задумано.
  if (kind === "transfer") {
    if (cat.value) {
      return { ok: false, reason: "У перевода категория не заполняется" };
    }
  } else if (kind === "expense") {
    if (inAcc.value) {
      return { ok: false, reason: "У расхода заполняется только «Счёт списания»" };
    }
  } else if (outAcc.value) {
    return {
      ok: false,
      reason: `У операции «${typeHit}» заполняется только «Счёт зачисления»`,
    };
  }

  // Контрагент — после счетов и категории: сначала то, что человек видит в
  // ячейке, потом то, чего в ней не видно.
  const payee = minter.resolve(row.payee);
  const mainAccount = kind === "expense" || kind === "transfer" ? outAcc.value : inAcc.value;
  const isDebt = isDebtAccount(mainAccount, cache) || isDebtAccount(inAcc.value, cache);

  const semantic = validateOperation({
    kind,
    amount: row.amount,
    isDebt,
    payee: row.payee,
    realAcc: isDebt ? mainAccount || inAcc.value : "",
    outAcc: kind === "transfer" ? outAcc.value : "",
    inAcc: kind === "transfer" ? inAcc.value : "",
    category: cat.value,
    // Возврат должен целиться в расходную категорию: доходная означает, что
    // человек выбрал не ту — деньги вернулись бы «в доход дохода».
    categoryHasIncome: categoryAllowsIncome(cat.value, cache),
  });
  if (semantic) return { ok: false, reason: semantic };

  const parts = cat.value ? splitCategoryFull(cat.value) : null;
  const fields: DraftFields = {
    id: makeId(),
    kind,
    date: row.date,
    amount: row.amount,
    account: mainAccount,
    incomeAccount: kind === "transfer" ? inAcc.value : undefined,
    incomeAmount: row.incomeAmount ?? undefined,
    createdSeconds: createdSeconds(row),
    category: parts?.category,
    subcategory: parts?.subcategory ?? null,
    payee: payee?.title || undefined,
    comment: row.comment || undefined,
  };
  // Найденного контрагента отдаём билдеру всегда, а не только свежего: он
  // может быть заведён локально и в кэше отсутствовать — тогда без подсказки
  // операция ушла бы со свободной строкой вместо ссылки на запись. Если имя
  // есть в облаке, билдер всё равно возьмёт облачный id: кэш в его карте
  // стоит первым.
  const built = buildDraftTransaction(
    fields,
    cache,
    stampSeconds,
    payee ? [{ id: payee.id, title: payee.title }] : []
  );
  // Сузить тип по `skip` нельзя: у ветки успеха он объявлен необязательным.
  if (!built.zen) return { ok: false, reason: built.skip ?? "Не удалось собрать операцию" };
  return {
    ok: true,
    zen: built.zen,
    currency: accountCurrency(mainAccount, cache),
    ...(payee?.isNew ? { newCounterparty: { id: payee.id, title: payee.title } } : {}),
    ...(payee?.isNew ? { payeeHint: nearestPayee(payee.title, dicts.payees) } : {}),
  };
}

/**
 * Подпись строки для поиска дублей.
 *
 * Та же, что у детектора дублей в аналитике: вид, контрагент, сумма до копейки,
 * валюта и счёт. Дата в подпись не входит — она сравнивается с допуском, потому
 * что один и тот же платёж в двух источниках нередко отличается днём.
 */
export function rowSignature(t: {
  kind: string;
  payee?: string;
  amount: number;
  currency: string;
  account: string;
}): string {
  return [
    t.kind,
    normalizeText(t.payee ?? "").toLowerCase(),
    Math.round(t.amount * 100),
    t.currency,
    normalizeText(t.account).toLowerCase(),
  ].join("|");
}

/** Разница в днях между двумя «ГГГГ-ММ-ДД». */
function daysApart(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.abs(Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000;
}

/** Допуск по дате: тот же платёж в двух источниках нередко отличается днём. */
const DUP_DAYS = 3;

/**
 * Собрать план импорта: что создастся, что отбито, что похоже на дубликат.
 *
 * `existing` — то, что уже видно в приложении (облачные операции и черновики).
 * Дубликаты не отбиваются, а помечаются: право решать остаётся за человеком, но
 * галочка у них снята — молча создать вторую копию платежа хуже, чем не создать.
 */
export function buildImportPlan(
  rows: ParsedRow[],
  dicts: ImportDicts,
  cache: ZenCache,
  existing: Transaction[],
  stampSeconds: number,
  makeId: () => string = newDraftId,
  /** Контрагенты, заведённые локально и ещё не уехавшие: второй раз не заводим. */
  pendingCounterparties: NewCounterpartyDraft[] = [],
  mintCounterpartyId: () => string = () => crypto.randomUUID()
): ImportPlan {
  const minter = createCounterpartyMinter(
    cache.merchants,
    pendingCounterparties,
    mintCounterpartyId
  );
  const seen = new Map<string, string[]>();
  const remember = (sig: string, date: string) => {
    const list = seen.get(sig) ?? [];
    list.push(date);
    seen.set(sig, list);
  };
  for (const t of existing) {
    remember(
      rowSignature({
        kind: t.kind,
        payee: t.brand || t.payee,
        amount: t.amount,
        currency: t.currency,
        account: t.account,
      }),
      t.date.slice(0, 10)
    );
  }

  const out: PlanRow[] = [];
  let ready = 0;
  let failed = 0;
  let duplicates = 0;

  for (const row of rows) {
    const verdict = rowToVerdict(row, dicts, cache, stampSeconds, makeId, minter);
    if (!verdict.ok) {
      failed++;
      out.push({ ...row, verdict, picked: false });
      continue;
    }
    const zen = verdict.zen;
    const kind = kindOf(row.type) ?? "expense";
    // Счёт берём в написании справочника: строка с вердиктом «ок» точно
    // совпала с ним, но могла быть набрана в другом регистре — а подпись
    // сравнивается с подписями уже имеющихся операций, где название настоящее.
    const account = canonical(
      kind === "expense" || kind === "transfer" ? row.outAccount : row.inAccount,
      dicts.accounts
    ).value;
    const sig = rowSignature({
      kind,
      payee: row.payee,
      amount: row.amount ?? 0,
      currency: accountCurrency(account, cache),
      account,
    });
    const near = (seen.get(sig) ?? []).some((d) => daysApart(d, row.date) <= DUP_DAYS);
    remember(sig, row.date);
    if (near) duplicates++;
    else ready++;
    out.push({
      ...row,
      verdict: near
        ? { ...verdict, ok: true, zen, duplicateOf: "похожая операция уже есть" }
        : verdict,
      picked: !near,
    });
  }

  // Отбитая строка контрагента не заводит: её id просто умирает вместе с ней.
  const wanted = new Set(
    out.flatMap((r) => (r.verdict.ok && r.verdict.newCounterparty ? [r.verdict.newCounterparty.id] : []))
  );
  const newCounterparties = minter.minted().filter((m) => wanted.has(m.id));

  return { rows: out, ready, failed, duplicates, newCounterparties };
}

/* -------------------------------------------------------------- мелочи */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Время операции: из колонки, иначе полдень — не «сейчас». */
function createdSeconds(row: ParsedRow): number | undefined {
  if (!row.date) return undefined;
  const [hh, mm] = row.time ? row.time.split(":").map(Number) : [12, 0];
  const [y, m, d] = row.date.split("-").map(Number);
  return Math.floor(new Date(y, m - 1, d, hh, mm, 0).getTime() / 1000);
}

/** Валюта счёта по кэшу — нужна только для подписи дубля. */
function accountCurrency(title: string, cache: ZenCache): string {
  const acc = cache.accounts.find((a) => a.title === title);
  const inst = acc ? cache.instruments.find((i) => i.id === acc.instrument) : undefined;
  return inst?.shortTitle ?? "RUB";
}

/**
 * Доходная ли категория — по флагу тега в справочнике.
 *
 * Нужна одна-единственная проверка: возврат по доходной категории бессмыслен, и
 * форма создания отбивает его теми же словами.
 */
function categoryAllowsIncome(full: string, cache: ZenCache): boolean {
  if (!full) return false;
  const leaf = full.split(" / ").pop() ?? full;
  const tag = cache.tags.find((t) => t.title === leaf);
  return tag ? tag.showIncome !== false : false;
}

/** Долговой ли счёт — по типу из справочника, а не по названию. */
function isDebtAccount(title: string, cache: ZenCache): boolean {
  if (!title) return false;
  const acc = cache.accounts.find((a) => a.title === title);
  return acc ? acc.type === "loan" || acc.type === "credit" || acc.type === "debt" : false;
}
