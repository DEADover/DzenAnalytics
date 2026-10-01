/**
 * Выдуманный аккаунт Дзен-мани для сквозных тестов — ответ `/v8/diff/` на
 * первую (полную) синхронизацию.
 *
 * Данные детерминированы от «сегодня» (`TODAY`), а часы в браузере тестов
 * остановлены на нём же: суммы, «просрочено» и «до конца месяца» не плывут
 * от дня запуска. Ни одного настоящего счёта или операции здесь нет.
 */
import type {
  ZenAccount,
  ZenBudget,
  ZenDiffResponse,
  ZenReminder,
  ZenReminderMarker,
  ZenTag,
  ZenTransaction,
} from "../../src/lib/zenmoney";

export const TODAY = "2026-10-15";
/** Полдень по Москве — у тестов часовой пояс Europe/Moscow. */
export const NOW = new Date(`${TODAY}T12:00:00+03:00`);

export const USER = 1001;
const RUB = 2;
const USD = 1;
const STAMP = Math.floor(Date.parse("2026-10-01T00:00:00Z") / 1000);

const account = (a: Partial<ZenAccount> & Pick<ZenAccount, "id" | "title" | "balance">): ZenAccount => ({
  user: USER,
  instrument: RUB,
  type: "ccard",
  role: null,
  private: false,
  savings: false,
  inBalance: true,
  archive: false,
  startBalance: 0,
  startDate: null,
  creditLimit: 0,
  syncID: null,
  company: null,
  changed: STAMP,
  ...a,
});

export const ACCOUNTS: ZenAccount[] = [
  account({ id: "acc-tbank", title: "Т-Банк", balance: 84_250 }),
  account({ id: "acc-sber", title: "Сбер", balance: 31_400 }),
  account({ id: "acc-cash", title: "Наличные", type: "cash", balance: 6_500 }),
  account({ id: "acc-save", title: "Накопительный счёт", type: "checking", savings: true, balance: 250_000 }),
  account({ id: "acc-usd", title: "Валютный счёт", instrument: USD, balance: 1_200 }),
];

const tag = (t: Partial<ZenTag> & Pick<ZenTag, "id" | "title">): ZenTag => ({
  user: USER,
  parent: null,
  archive: false,
  showIncome: false,
  showOutcome: true,
  budgetIncome: false,
  budgetOutcome: true,
  required: null,
  icon: null,
  picture: null,
  color: null,
  changed: STAMP,
  ...t,
});

export const TAGS: ZenTag[] = [
  tag({ id: "tag-food", title: "Продукты", required: true }),
  tag({ id: "tag-cafe", title: "Еда вне дома" }),
  tag({ id: "tag-transport", title: "Транспорт" }),
  tag({ id: "tag-taxi", title: "Такси", parent: "tag-transport" }),
  tag({ id: "tag-subs", title: "Подписки" }),
  tag({ id: "tag-home", title: "Дом", required: true }),
  tag({ id: "tag-salary", title: "Зарплата", showIncome: true, showOutcome: false, budgetIncome: true, budgetOutcome: false }),
];

/** Первые числа месяцев: «2026-05» … «2026-10». */
const MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];

let seq = 0;
function tx(
  date: string,
  kind: "expense" | "income" | "transfer",
  amount: number,
  opts: { tag?: string; account?: string; to?: string; payee?: string; comment?: string; viewed?: boolean } = {}
): ZenTransaction {
  seq += 1;
  const acc = opts.account ?? "acc-tbank";
  const created = Math.floor(Date.parse(`${date}T10:00:00Z`) / 1000) + seq;
  return {
    id: `tx-${String(seq).padStart(4, "0")}`,
    user: USER,
    date,
    income: kind === "expense" ? 0 : amount,
    outcome: kind === "income" ? 0 : amount,
    changed: created,
    incomeInstrument: RUB,
    outcomeInstrument: RUB,
    created,
    originalPayee: null,
    deleted: false,
    viewed: opts.viewed ?? true,
    hold: false,
    qrCode: null,
    source: null,
    incomeAccount: kind === "transfer" ? (opts.to ?? "acc-save") : acc,
    outcomeAccount: acc,
    tag: opts.tag ? [opts.tag] : null,
    comment: opts.comment ?? null,
    payee: opts.payee ?? null,
    opIncome: null,
    opOutcome: null,
    opIncomeInstrument: null,
    opOutcomeInstrument: null,
    latitude: null,
    longitude: null,
    merchant: null,
    incomeBankID: null,
    outcomeBankID: null,
    reminderMarker: null,
  };
}

function buildTransactions(): ZenTransaction[] {
  seq = 0;
  const out: ZenTransaction[] = [];
  for (const [i, ym] of MONTHS.entries()) {
    const current = ym === TODAY.slice(0, 7);
    const lastDay = current ? Number(TODAY.slice(8)) : 28;
    out.push(tx(`${ym}-05`, "income", 150_000, { tag: "tag-salary", payee: "ООО Ромашка", comment: "Зарплата" }));
    out.push(tx(`${ym}-06`, "transfer", 20_000, { to: "acc-save", comment: "В накопления" }));
    out.push(tx(`${ym}-10`, "expense", 35_000, { tag: "tag-home", payee: "Управляющая компания", comment: "Аренда" }));
    for (let d = 2; d <= lastDay; d += 3) {
      const day = `${ym}-${String(d).padStart(2, "0")}`;
      out.push(tx(day, "expense", 1_800 + ((d * 37 + i * 11) % 900), { tag: "tag-food", payee: "Пятёрочка" }));
      if (d % 2 === 0) out.push(tx(day, "expense", 650 + ((d * 13) % 400), { tag: "tag-cafe", payee: "Кофейня у дома", account: "acc-sber" }));
      if (d % 4 === 1) out.push(tx(day, "expense", 420 + ((d * 7) % 300), { tag: "tag-taxi", payee: "Яндекс Go" }));
    }
    out.push(tx(`${ym}-20`, "expense", 499, { tag: "tag-subs", payee: "Кинопоиск" }));
  }
  // Свежие непросмотренные — для «Просмотрено» в панели выделения.
  out.push(tx("2026-10-14", "expense", 2_340, { tag: "tag-food", payee: "Перекрёсток", viewed: false }));
  out.push(tx("2026-10-15", "expense", 560, { tag: "tag-cafe", payee: "Кофейня у дома", account: "acc-cash", viewed: false }));
  return out;
}

export const BUDGETS: ZenBudget[] = [
  {
    user: USER,
    changed: STAMP,
    date: "2026-10-01",
    tag: "tag-food",
    income: 0,
    incomeLock: false,
    outcome: 25_000,
    outcomeLock: true,
  },
];

export const REMINDERS: ZenReminder[] = [
  {
    id: "rem-gym",
    user: USER,
    changed: STAMP,
    interval: "month",
    step: 1,
    points: [12],
    startDate: "2026-09-12",
    endDate: null,
    payee: "Фитнес-клуб",
    comment: "Абонемент",
    income: 0,
    incomeInstrument: RUB,
    incomeAccount: "acc-tbank",
    outcome: 3_000,
    outcomeInstrument: RUB,
    outcomeAccount: "acc-tbank",
    tag: ["tag-home"],
  },
];

const marker = (id: string, date: string): ZenReminderMarker => ({
  id,
  user: USER,
  changed: STAMP,
  date,
  income: 0,
  incomeInstrument: RUB,
  incomeAccount: "acc-tbank",
  outcome: 3_000,
  outcomeInstrument: RUB,
  outcomeAccount: "acc-tbank",
  tag: ["tag-home"],
  reminder: "rem-gym",
  state: "planned",
  payee: "Фитнес-клуб",
  comment: "Абонемент",
});

/** 12.10 — уже прошло и не исполнено: в ленте это «Просрочено». */
export const MARKERS: ZenReminderMarker[] = [
  marker("mk-2026-10", "2026-10-12"),
  marker("mk-2026-11", "2026-11-12"),
  marker("mk-2026-12", "2026-12-12"),
];

export function fullDiff(serverTimestamp: number): ZenDiffResponse {
  return {
    serverTimestamp,
    instrument: [
      { id: RUB, title: "Российский рубль", shortTitle: "RUB", symbol: "₽", rate: 1 },
      { id: USD, title: "Доллар США", shortTitle: "USD", symbol: "$", rate: 90 },
    ],
    account: ACCOUNTS,
    tag: TAGS,
    merchant: [],
    transaction: buildTransactions(),
    user: [{ id: USER, currency: RUB, login: "e2e", monthStartDay: 1 }],
    budget: BUDGETS,
    reminder: REMINDERS,
    reminderMarker: MARKERS,
    company: [],
    deletion: [],
  };
}
