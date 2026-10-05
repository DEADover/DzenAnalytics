/**
 * Демо-аккаунт Дзен-мани: «Попробовать на демо-данных» без своего аккаунта.
 *
 * Выдуманная семья в Москве: зарплата и аванс, ипотека, ребёнок, кот, отпуск
 * летом, подарки в декабре. Без малого два года истории, чтобы «Сравнение»,
 * «Год в цифрах» и тренды были не пустыми. Ни одного настоящего счёта или
 * операции здесь нет.
 *
 * История — 20 полных месяцев до `today` (настоящего «сегодня») и текущий
 * месяц, чтобы он не был пустым. События года привязаны к своим месяцам и
 * повторяются каждый год: отпуск летом, сборы в школу в конце августа, подарки
 * в декабре, 8 Марта. Для одной и той же даты результат всегда один и тот же:
 * случайность — из генератора с фиксированным зерном. Остатки счетов не
 * задаются руками, а считаются из операций: иначе история остатков на
 * «Счетах» не сошлась бы с текущими.
 */
import type {
  ZenAccount,
  ZenBudget,
  ZenDiffResponse,
  ZenReminder,
  ZenReminderMarker,
  ZenTag,
  ZenTransaction,
} from "../zenmoney";

/** «Сегодня» по умолчанию — для повторяемых снимков экрана. */
export const DEMO_TODAY = "2026-09-22";
/** Полдень по Москве. */
export const DEMO_NOW = new Date(`${DEMO_TODAY}T12:00:00+03:00`);

/* ───────────────────────── даты ───────────────────────── */

/** «ГГГГ-ММ-ДД» плюс `n` месяцев; число за концом месяца — последний день. */
function addMonths(date: string, n: number): string {
  const idx = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1 + n;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const d = Math.min(Number(date.slice(8, 10)), last);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
/** «Сегодня» этой сборки аккаунта и даты, отсчитанные от него. */
let TODAY = DEMO_TODAY;
/** Первое число месяца, отстоящего от текущего на `n` месяцев. */
const monthStart = (n: number) => addMonths(`${TODAY.slice(0, 7)}-01`, n);

const USER = 2001;
const RUB = 2;
const USD = 1;
let STAMP = Math.floor(Date.parse("2026-09-01T00:00:00Z") / 1000);

/* ───────────────────────── случайность ───────────────────────── */

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rnd = mulberry32(20260922);
const between = (a: number, b: number) => a + rnd() * (b - a);
const chance = (p: number) => rnd() < p;
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
/** Сумма «как в чеке»: до рубля, крупные — до десятков. */
const amount = (a: number, b: number) => {
  const v = between(a, b);
  return v > 5000 ? Math.round(v / 10) * 10 : Math.round(v);
};

/* ───────────────────────── счета ───────────────────────── */

interface AccountSeed {
  id: string;
  title: string;
  type?: ZenAccount["type"];
  instrument?: number;
  savings?: boolean;
  inBalance?: boolean;
  creditLimit?: number;
  /** Остаток на начало истории. */
  start: number;
}

const ACCOUNT_SEEDS: AccountSeed[] = [
  { id: "a-tbank", title: "Т-Банк Black", start: 697_000 },
  { id: "a-sber", title: "СберКарта", start: 18_500 },
  { id: "a-cash", title: "Наличные", type: "cash", start: 2_000 },
  { id: "a-alfa", title: "Альфа кредитка", creditLimit: 150_000, start: -12_300 },
  { id: "a-save", title: "Накопительный счёт", type: "checking", savings: true, start: 420_000 },
  { id: "a-usd", title: "Валютный счёт", instrument: USD, start: 2_400 },
  { id: "a-broker", title: "Брокерский счёт", type: "checking", inBalance: false, start: 310_000 },
];

/* ───────────────────────── категории ───────────────────────── */

const rgb = (hex: string) => parseInt(hex.slice(1), 16);

interface TagSeed {
  id: string;
  title: string;
  icon: string;
  color: string;
  parent?: string;
  income?: boolean;
  required?: boolean;
}

const TAG_SEEDS: TagSeed[] = [
  { id: "t-food", title: "Продукты", icon: "1001_bunch_ingredients", color: "#4CAF50", required: true },
  { id: "t-cafe", title: "Кафе и рестораны", icon: "1008_lunch", color: "#FF8A3D" },
  { id: "t-coffee", title: "Кофе", icon: "1016_coffee_cup", color: "#B07A4F", parent: "t-cafe" },
  { id: "t-delivery", title: "Доставка еды", icon: "1009_deliver", color: "#F06A4A", parent: "t-cafe" },
  { id: "t-transport", title: "Транспорт", icon: "3002_cars", color: "#3F8CFF" },
  { id: "t-taxi", title: "Такси", icon: "3004_taxi", color: "#F5B700", parent: "t-transport" },
  { id: "t-metro", title: "Метро", icon: "3007_metro", color: "#E5484D", parent: "t-transport" },
  { id: "t-fuel", title: "Бензин", icon: "3505_gasoline", color: "#2F6FDB", parent: "t-transport" },
  { id: "t-home", title: "Дом", icon: "5501_armchair", color: "#7C5CFA", required: true },
  { id: "t-mortgage", title: "Ипотека", icon: "9011_mortgage", color: "#6E56CF", parent: "t-home", required: true },
  { id: "t-utils", title: "Коммуналка", icon: "5409_water", color: "#4C9BE8", parent: "t-home", required: true },
  { id: "t-telecom", title: "Связь и интернет", icon: "5506_mobile", color: "#30A7B8", parent: "t-home", required: true },
  { id: "t-health", title: "Здоровье", icon: "6504_heart", color: "#E54666" },
  { id: "t-pharmacy", title: "Аптека", icon: "6502_pill", color: "#EC6A85", parent: "t-health" },
  { id: "t-dentist", title: "Стоматология", icon: "6506_dantist", color: "#D6409F", parent: "t-health" },
  { id: "t-sport", title: "Спорт", icon: "2506_fitness", color: "#12A594" },
  { id: "t-clothes", title: "Одежда и обувь", icon: "5006_shopping", color: "#D9A02B" },
  { id: "t-beauty", title: "Красота", icon: "5004_barbers_scissors", color: "#C2649A" },
  { id: "t-fun", title: "Развлечения", icon: "2003_film_reel", color: "#8E4EC6" },
  { id: "t-subs", title: "Подписки", icon: "5505_laptop", color: "#5B5BD6" },
  { id: "t-travel", title: "Путешествия", icon: "4001_airport", color: "#0090FF" },
  { id: "t-gifts", title: "Подарки", icon: "7001_gift", color: "#E93D82" },
  { id: "t-kids", title: "Дети", icon: "6001_children", color: "#F76B15" },
  { id: "t-kids-clubs", title: "Кружки", icon: "2505_paint_palette", color: "#FF9E5E", parent: "t-kids" },
  { id: "t-pets", title: "Кот", icon: "7901_cat", color: "#978365" },
  { id: "t-edu", title: "Образование", icon: "2008_books", color: "#3E63DD" },
  { id: "t-salary", title: "Зарплата", icon: "9003_banknotes", color: "#30A46C", income: true },
  { id: "t-freelance", title: "Подработка", icon: "9013_portfolio", color: "#46A758", income: true },
  { id: "t-cashback", title: "Кэшбэк", icon: "9014_percentage", color: "#2EB67D", income: true },
  { id: "t-interest", title: "Проценты", icon: "9010_coin_piggy", color: "#18A57B", income: true },
];

/* ───────────────────────── операции ───────────────────────── */

/**
 * Комментарии, как их пишут люди: у большинства трат что-то есть. Своя
 * случайность — иначе комментарии сдвинули бы суммы и даты операций.
 */
const COMMENTS: Record<string, readonly string[]> = {
  "t-food": ["Продукты на неделю", "Молоко, хлеб, фрукты", "К ужину", "Закупка на выходные", "Овощи и курица", "Для завтраков"],
  "t-coffee": ["Капучино по дороге", "Флэт уайт", "Кофе с Сашей", "Раф и круассан"],
  "t-delivery": ["Пицца на вечер", "Роллы", "Обед в офис", "Ужин доставкой"],
  "t-cafe": ["Обед с коллегами", "Ужин с друзьями", "Завтрак в выходной", "Семейный ужин"],
  "t-taxi": ["До офиса", "Из аэропорта", "Домой после встречи", "В гости", "Опаздывал на встречу"],
  "t-metro": ["Проезд"],
  "t-fuel": ["Полный бак", "Заправка по пути на дачу", "95-й"],
  "t-pharmacy": ["Витамины", "От простуды", "Детские лекарства"],
  "t-pets": ["Корм коту", "Наполнитель", "Игрушка для Барсика"],
  "t-clothes": ["Кроссовки", "Куртка на осень", "Футболки", "Джинсы", "Детская одежда"],
  "t-fun": ["Кино всей семьёй", "Билеты на концерт", "Прогулка в парке"],
  "t-beauty": ["Стрижка"],
  "t-kids": ["Конструктор", "Канцтовары", "Подарок однокласснику"],
  "t-kids-clubs": ["Рисование, месяц"],
  "t-edu": ["Курс по аналитике"],
  "t-telecom": ["Мобильная связь"],
  "t-utils": ["Квартплата", "ЖКУ за месяц"],
  "t-subs": ["Подписка"],
};
let commentRnd = mulberry32(7);

let seq = 0;
const txs: ZenTransaction[] = [];
/** Траты по кредитке с прошлого погашения — гасим их целиком. */
let alfaDebt = 0;

function push(
  date: string,
  kind: "expense" | "income" | "transfer",
  sum: number,
  o: { tag?: string; account?: string; to?: string; payee?: string; comment?: string; toSum?: number } = {}
) {
  seq += 1;
  const acc = o.account ?? "a-tbank";
  if (o.comment === undefined && kind === "expense" && o.tag && COMMENTS[o.tag] && commentRnd() < 0.62) {
    const pool = COMMENTS[o.tag];
    o = { ...o, comment: pool[Math.floor(commentRnd() * pool.length)] };
  }
  if (acc === "a-alfa" && kind === "expense") alfaDebt += sum;
  const created = Math.floor(Date.parse(`${date}T09:00:00Z`) / 1000) + seq * 7;
  const incomeAcc = kind === "transfer" ? (o.to ?? "a-save") : acc;
  const inst = (id: string) => (id === "a-usd" ? USD : RUB);
  txs.push({
    id: `demo-${String(seq).padStart(5, "0")}`,
    user: USER,
    date,
    income: kind === "expense" ? 0 : (o.toSum ?? sum),
    outcome: kind === "income" ? 0 : sum,
    changed: created,
    incomeInstrument: inst(incomeAcc),
    outcomeInstrument: inst(acc),
    created,
    originalPayee: null,
    deleted: false,
    viewed: true,
    hold: false,
    qrCode: null,
    source: null,
    incomeAccount: incomeAcc,
    outcomeAccount: acc,
    tag: o.tag ? [o.tag] : null,
    comment: o.comment ?? null,
    payee: o.payee ?? null,
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
  });
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (d: string) => Number(d.slice(8, 10));

const GROCERIES = ["Перекрёсток", "Пятёрочка", "ВкусВилл", "Лента", "Самокат", "Магнит"];
const COFFEE = ["Кофемания", "Cofix", "Даблби", "Шоколадница"];
const DELIVERY = ["Яндекс Еда", "Додо Пицца", "Самокат Еда"];
const RESTAURANTS = ["Тануки", "Хинкальная", "Pinsa Romana", "Чайхона №1", "Grill Room"];
const MARKETPLACES = ["Wildberries", "Ozon", "Lamoda"];

function buildTransactions(start: string, today: string) {
  seq = 0;
  txs.length = 0;
  alfaDebt = 0;
  commentRnd = mulberry32(7);
  rnd = mulberry32(20260922);
  const end = new Date(`${today}T00:00:00Z`);
  for (let d = new Date(`${start}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = iso(d);
    const dom = day(date);
    const month = Number(date.slice(5, 7));
    const year = Number(date.slice(0, 4));
    const md = date.slice(5);
    const weekday = d.getUTCDay(); // 0 — воскресенье
    const weekend = weekday === 0 || weekday === 6;
    const summer = month === 7;

    // ── Доходы ──
    // Повышение — с марта текущего года (или прошлого, если март ещё впереди).
    const raise = date >= RAISE_FROM ? 1 : 0.9;
    if (dom === 5) push(date, "income", Math.round(132_000 * raise), { tag: "t-salary", payee: "ООО «Северный ветер»", comment: "Зарплата" });
    if (dom === 20) push(date, "income", Math.round(86_000 * raise), { tag: "t-salary", payee: "ООО «Северный ветер»", comment: "Аванс" });
    if (dom === 14 && chance(0.55)) push(date, "income", amount(18_000, 46_000), { tag: "t-freelance", payee: "Самозанятость", comment: "Проект для клиента" });
    if (dom === 2) push(date, "income", amount(900, 2_600), { tag: "t-cashback", payee: "Т-Банк", comment: "Кэшбэк за месяц" });
    if (dom === 28) push(date, "income", amount(3_600, 5_200), { tag: "t-interest", account: "a-save", payee: "Т-Банк", comment: "Проценты на остаток" });

    // ── Переводы ──
    if (dom === 6) push(date, "transfer", 25_000, { to: "a-save", comment: "В накопления" });
    if (dom === 21 && chance(0.4)) push(date, "transfer", 20_000, { to: "a-broker", comment: "Пополнение брокерского" });
    if (dom === 25 && alfaDebt > 0) {
      push(date, "transfer", Math.round(alfaDebt), { account: "a-tbank", to: "a-alfa", comment: "Погашение кредитки" });
      alfaDebt = 0;
    }
    if (dom === 5) push(date, "transfer", 16_000, { to: "a-sber", comment: "На вторую карту" });
    if (dom === 16) push(date, "transfer", 3_000, { to: "a-cash", comment: "Снял наличные" });
    if (dom === 15 && month % 3 === 0) push(date, "transfer", 9_000, { to: "a-usd", toSum: 100, comment: "Купил долларов" });

    // ── Обязательные ──
    if (dom === 10) push(date, "expense", 58_400, { tag: "t-mortgage", payee: "Сбербанк", comment: "Ипотека" });
    if (dom === 12) push(date, "expense", amount(month >= 11 || month <= 3 ? 7_800 : 5_900, month >= 11 || month <= 3 ? 9_400 : 6_800), { tag: "t-utils", payee: "Мосэнергосбыт" });
    if (dom === 8) push(date, "expense", 1_190, { tag: "t-telecom", payee: "МГТС", comment: "Интернет" });
    if (dom === 18) push(date, "expense", 850, { tag: "t-telecom", payee: "Билайн", account: "a-sber" });
    if (dom === 3) push(date, "expense", 4_900, { tag: "t-sport", payee: "World Class", comment: "Абонемент" });
    if (dom === 1) push(date, "expense", 6_200, { tag: "t-kids-clubs", payee: "Детская студия «Акварель»", account: "a-sber" });

    // ── Подписки ──
    if (dom === 9) push(date, "expense", 449, { tag: "t-subs", payee: "Яндекс Плюс" });
    if (dom === 16) push(date, "expense", date >= monthStart(-3) ? 399 : 299, { tag: "t-subs", payee: "Кинопоиск" });
    if (dom === 23) push(date, "expense", 299, { tag: "t-subs", payee: "Telegram Premium", account: "a-alfa" });

    // ── Повседневное ──
    if (chance(weekend ? 0.75 : 0.5)) {
      const big = weekend && chance(0.6);
      push(date, "expense", amount(big ? 3_200 : 650, big ? 6_800 : 2_400), { tag: "t-food", payee: pick(GROCERIES), account: chance(0.2) ? "a-alfa" : "a-tbank" });
    }
    if (!weekend && chance(0.55)) push(date, "expense", amount(240, 420), { tag: "t-coffee", payee: pick(COFFEE), account: "a-sber" });
    if (chance(0.16)) push(date, "expense", amount(900, 2_100), { tag: "t-delivery", payee: pick(DELIVERY) });
    if (weekend && chance(0.4)) push(date, "expense", amount(2_400, 6_900), { tag: "t-cafe", payee: pick(RESTAURANTS), account: "a-alfa" });
    if (chance(0.22)) push(date, "expense", amount(340, 980), { tag: "t-taxi", payee: "Яндекс Go" });
    if (!weekend && chance(0.6)) push(date, "expense", 62, { tag: "t-metro", payee: "Московский метрополитен", account: "a-sber" });
    if (dom % 9 === 4) push(date, "expense", amount(2_700, 3_900), { tag: "t-fuel", payee: pick(["Лукойл", "Газпромнефть"]) });
    if (chance(0.07)) push(date, "expense", amount(320, 1_900), { tag: "t-pharmacy", payee: pick(["Ригла", "Горздрав"]) });
    if (chance(0.05)) push(date, "expense", amount(600, 2_400), { tag: "t-pets", payee: "Четыре лапы" });
    if (chance(0.06)) push(date, "expense", amount(1_400, 7_800), { tag: "t-clothes", payee: pick(MARKETPLACES), account: "a-alfa" });
    if (weekend && chance(0.12)) push(date, "expense", amount(900, 3_600), { tag: "t-fun", payee: pick(["Каро Фильм", "Кассир.ру", "Парк Горького"]) });
    if (dom === 19 && chance(0.6)) push(date, "expense", amount(2_200, 3_400), { tag: "t-beauty", payee: "Барбершоп Chop-Chop" });
    if (chance(0.05)) push(date, "expense", amount(800, 3_500), { tag: "t-kids", payee: "Детский мир", account: "a-sber" });
    if (dom === 3 && month % 2 === 0) push(date, "expense", 3_900, { tag: "t-edu", payee: "Яндекс Практикум" });
    if (weekend && chance(0.35)) push(date, "expense", amount(250, 1_200), { tag: "t-food", payee: "Рынок у дома", account: "a-cash" });
    if (chance(0.0025)) push(date, "expense", amount(300, 900), { comment: "Без категории" });

    // ── Сезонное ──
    // Отпуск: в нечётный год — Сочи в июле, в чётный — Калининград в июне.
    const odd = year % 2 === 1;
    if (odd && md === "07-03") push(date, "expense", 92_400, { tag: "t-travel", payee: "Аэрофлот", comment: "Билеты в Сочи", account: "a-alfa" });
    if (odd && md === "07-05") push(date, "expense", 71_800, { tag: "t-travel", payee: "Островок", comment: "Отель, 9 ночей" });
    if (!odd && md === "06-02") push(date, "expense", 78_600, { tag: "t-travel", payee: "Аэрофлот", comment: "Билеты в Калининград", account: "a-alfa" });
    if (!odd && md === "06-09") push(date, "expense", 64_200, { tag: "t-travel", payee: "Островок", comment: "Отель, 7 ночей" });
    if (md === (odd ? "08-25" : "08-24")) push(date, "expense", odd ? 24_600 : 27_300, { tag: "t-kids", payee: "Детский мир", comment: "Сборы в школу" });
    if (md === "12-22") push(date, "expense", 23_400, { tag: "t-gifts", payee: "Ozon", comment: "Подарки к Новому году", account: "a-alfa" });
    if (md === "12-27") push(date, "expense", 8_900, { tag: "t-gifts", payee: "Золотое яблоко", account: "a-alfa" });
    if (md === "03-06" && date >= RAISE_FROM) push(date, "expense", 6_400, { tag: "t-gifts", payee: "Цветочный ряд", comment: "8 Марта" });
    if (date === DENTIST) push(date, "expense", 34_800, { tag: "t-dentist", payee: "Клиника «Дента Люкс»", comment: "Лечение зуба" });
    if (summer && dom >= 4 && dom <= 11) push(date, "expense", amount(3_500, 7_800), { tag: "t-cafe", payee: pick(RESTAURANTS), comment: "Отпуск" });
    if (date === BIRTHDAY) push(date, "expense", 12_900, { tag: "t-cafe", payee: "Grill Room", comment: "День рождения", account: "a-alfa" });
  }
  return txs.slice();
}

/* ───────────────────────── сборка ответа ───────────────────────── */

/** Начало истории — 20 месяцев до текущего. */
const historyStart = () => monthStart(-20);
/** Разовые даты года, отсчитанные от «сегодня». */
let RAISE_FROM = "";
let DENTIST = "";
let BIRTHDAY = "";

function accounts(list: ZenTransaction[]): ZenAccount[] {
  const net = new Map<string, number>();
  for (const t of list) {
    net.set(t.outcomeAccount, (net.get(t.outcomeAccount) ?? 0) - t.outcome);
    net.set(t.incomeAccount, (net.get(t.incomeAccount) ?? 0) + t.income);
  }
  return ACCOUNT_SEEDS.map((a) => ({
    id: a.id,
    title: a.title,
    user: USER,
    instrument: a.instrument ?? RUB,
    type: a.type ?? "ccard",
    role: null,
    private: false,
    savings: a.savings ?? false,
    inBalance: a.inBalance ?? true,
    archive: false,
    startBalance: a.start,
    startDate: historyStart(),
    creditLimit: a.creditLimit ?? 0,
    syncID: null,
    company: null,
    changed: STAMP,
    balance: Math.round(a.start + (net.get(a.id) ?? 0)),
  })) as ZenAccount[];
}

function tags(): ZenTag[] {
  return TAG_SEEDS.map((t) => ({
    id: t.id,
    user: USER,
    title: t.title,
    parent: t.parent ?? null,
    archive: false,
    showIncome: !!t.income,
    showOutcome: !t.income,
    budgetIncome: !!t.income,
    budgetOutcome: !t.income,
    required: t.required ?? null,
    icon: t.icon,
    picture: null,
    color: rgb(t.color),
    changed: STAMP,
  })) as ZenTag[];
}

/** Месячные лимиты: по ним «Бюджет» и «Свободные деньги». */
const BUDGET_LIMITS: Record<string, number> = {
  "t-food": 38_000,
  "t-cafe": 22_000,
  "t-transport": 14_000,
  "t-home": 72_000,
  "t-health": 6_000,
  "t-sport": 5_000,
  "t-clothes": 10_000,
  "t-fun": 6_000,
  "t-subs": 1_500,
  "t-kids": 12_000,
  "t-pets": 2_500,
  "t-salary": 218_000,
};

function budgets(): ZenBudget[] {
  const out: ZenBudget[] = [];
  const months: string[] = [];
  // Вся история и три месяца вперёд.
  for (let n = -20; n <= 3; n++) months.push(monthStart(n).slice(0, 7));
  for (const month of months) {
    for (const [tag, limit] of Object.entries(BUDGET_LIMITS)) {
      const income = tag === "t-salary";
      out.push({
        user: USER,
        changed: STAMP,
        date: `${month}-01`,
        tag,
        income: income ? limit : 0,
        incomeLock: income,
        outcome: income ? 0 : limit,
        outcomeLock: !income,
      } as ZenBudget);
    }
  }
  return out;
}

interface PlanSeed {
  id: string;
  dom: number;
  tag: string;
  payee: string;
  comment: string;
  income?: number;
  outcome?: number;
  account?: string;
}

const PLANS: PlanSeed[] = [
  { id: "r-salary", dom: 5, tag: "t-salary", payee: "ООО «Северный ветер»", comment: "Зарплата", income: 132_000 },
  { id: "r-advance", dom: 20, tag: "t-salary", payee: "ООО «Северный ветер»", comment: "Аванс", income: 86_000 },
  { id: "r-mortgage", dom: 10, tag: "t-mortgage", payee: "Сбербанк", comment: "Ипотека", outcome: 58_400 },
  { id: "r-utils", dom: 12, tag: "t-utils", payee: "Мосэнергосбыт", comment: "Коммуналка", outcome: 7_200 },
  { id: "r-internet", dom: 8, tag: "t-telecom", payee: "МГТС", comment: "Интернет", outcome: 1_190 },
  { id: "r-gym", dom: 3, tag: "t-sport", payee: "World Class", comment: "Абонемент", outcome: 4_900 },
  { id: "r-plus", dom: 9, tag: "t-subs", payee: "Яндекс Плюс", comment: "Подписка", outcome: 449 },
  { id: "r-kino", dom: 16, tag: "t-subs", payee: "Кинопоиск", comment: "Подписка", outcome: 399 },
  { id: "r-tg", dom: 23, tag: "t-subs", payee: "Telegram Premium", comment: "Подписка", outcome: 299, account: "a-alfa" },
  { id: "r-insurance", dom: 28, tag: "t-health", payee: "Ингосстрах", comment: "Страховка ДМС", outcome: 3_400 },
];

function reminders(): ZenReminder[] {
  return PLANS.map((p) => ({
    id: p.id,
    user: USER,
    changed: STAMP,
    interval: "month",
    step: 1,
    points: [0],
    startDate: `${monthStart(-8).slice(0, 7)}-${String(p.dom).padStart(2, "0")}`,
    endDate: null,
    payee: p.payee,
    comment: p.comment,
    income: p.income ?? 0,
    incomeInstrument: RUB,
    incomeAccount: p.account ?? "a-tbank",
    outcome: p.outcome ?? 0,
    outcomeInstrument: RUB,
    outcomeAccount: p.account ?? "a-tbank",
    tag: [p.tag],
  })) as ZenReminder[];
}

/** Будущие даты планов: остаток текущего месяца и три месяца вперёд. */
function markers(today: string): ZenReminderMarker[] {
  const out: ZenReminderMarker[] = [];
  const months = [0, 1, 2, 3].map((n) => addMonths(`${today.slice(0, 7)}-01`, n).slice(0, 7));
  for (const month of months) {
    for (const p of PLANS) {
      const date = `${month}-${String(p.dom).padStart(2, "0")}`;
      if (date <= today) continue;
      out.push({
        id: `m-${p.id}-${month}`,
        user: USER,
        changed: STAMP,
        date,
        income: p.income ?? 0,
        incomeInstrument: RUB,
        incomeAccount: p.account ?? "a-tbank",
        outcome: p.outcome ?? 0,
        outcomeInstrument: RUB,
        outcomeAccount: p.account ?? "a-tbank",
        tag: [p.tag],
        reminder: p.id,
        state: "planned",
        payee: p.payee,
        comment: p.comment,
      } as ZenReminderMarker);
    }
  }
  return out;
}

/**
 * Ответ `/v8/diff/` на первую синхронизацию демо-аккаунта — с историей до
 * `today` («ГГГГ-ММ-ДД», по умолчанию `DEMO_TODAY`).
 */
export function demoDiff(serverTimestamp: number, today: string = DEMO_TODAY): ZenDiffResponse {
  TODAY = today;
  STAMP = Math.floor(Date.parse(`${monthStart(0)}T00:00:00Z`) / 1000);
  const y = Number(today.slice(0, 4));
  RAISE_FROM = `${today.slice(5, 7) >= "03" ? y : y - 1}-03-01`;
  DENTIST = `${monthStart(-4).slice(0, 7)}-14`;
  // День рождения — 12-го числа текущего месяца, если оно уже было, иначе прошлого.
  BIRTHDAY = `${(today.slice(8) >= "12" ? monthStart(0) : monthStart(-1)).slice(0, 7)}-12`;
  const transaction = buildTransactions(historyStart(), today);
  return {
    serverTimestamp,
    instrument: [
      { id: RUB, title: "Российский рубль", shortTitle: "RUB", symbol: "₽", rate: 1 },
      { id: USD, title: "Доллар США", shortTitle: "USD", symbol: "$", rate: 92.4 },
    ],
    account: accounts(transaction),
    tag: tags(),
    merchant: [],
    transaction,
    user: [{ id: USER, currency: RUB, login: "demo", monthStartDay: 1 }],
    budget: budgets(),
    reminder: reminders(),
    reminderMarker: markers(today),
    company: [],
    deletion: [],
  } as ZenDiffResponse;
}
