#!/usr/bin/env node
/**
 * Генератор синтетической CSV-выгрузки в формате Дзен-мани.
 *
 * Профиль: семья из 3 человек (муж, жена, дочь) + кот и собака.
 * Город: Москва. Период: 2021-05-02 — 2026-05-02 (5 лет).
 * Около 10 счетов, реалистичные паттерны: ежедневные траты, ЖКУ,
 * подписки, периодические крупные покупки, отпуска, ремонт, болезни,
 * учеба ребёнка и т.п. Все суммы с поправкой на ~7% годовой инфляции.
 *
 * Запуск:  node scripts/gen-demo-csv.mjs [output-path]
 * Default: ./sample/demo-2021-2026.csv
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// ===================== Конфигурация =====================
const START = new Date("2021-05-02");
const END = new Date("2026-05-02");
const SEED = 20210502;

const OUT_PATH = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(PROJECT_ROOT, "sample", "demo-2021-2026.csv");

// ===================== Псевдо-ГСЧ =====================
function mulberry32(s) {
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const pick = (a) => a[Math.floor(rand() * a.length)];
const ri = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const round = (v, step = 0.01) => Math.round(v / step) * step;
const chance = (p) => rand() < p;
const gauss = (m, s) => {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

// ===================== Даты =====================
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
function ts(d, hourBase = -1) {
  const x = new Date(d);
  const h = hourBase < 0 ? ri(8, 22) : Math.min(23, Math.max(0, hourBase + ri(-1, 1)));
  x.setHours(h, ri(0, 59), ri(0, 59));
  return `${ymd(x)} ${String(x.getHours()).padStart(2, "0")}:${String(
    x.getMinutes()
  ).padStart(2, "0")}:${String(x.getSeconds()).padStart(2, "0")}`;
}
const RU_MONTHS = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];
const monthName = (m) => RU_MONTHS[((m - 1) % 12 + 12) % 12];

function inflFactor(d) {
  const yrs = d.getFullYear() - 2021 + d.getMonth() / 12;
  return Math.pow(1.07, yrs);
}

// ===================== Транзакции =====================
const txs = [];
function addTx({
  date,
  category = "",
  payee = "",
  comment = "",
  account = "",
  expense = 0,
  income = 0,
  currency = "RUB",
  hour = -1,
  fromAccount = "",
  toAccount = "",
}) {
  const created = ts(date, hour);
  const changed = created;
  const out = fromAccount || account;
  const inAcc = toAccount || account;
  txs.push({
    date: ymd(date),
    categoryName: category,
    payee,
    comment,
    outcomeAccountName: out,
    outcome: round(expense, 0.01),
    outcomeCurrencyShortTitle: currency,
    incomeAccountName: inAcc,
    income: round(income, 0.01),
    incomeCurrencyShortTitle: currency,
    createdDate: created,
    changedDate: changed,
    qrCode: "",
  });
}

const expense = (date, account, amount, category, payee, comment, hour = -1) =>
  addTx({ date, account, expense: amount, category, payee, comment, hour });
const inc = (date, account, amount, category, payee, comment, hour = -1) =>
  addTx({ date, account, income: amount, category, payee, comment, hour });
const transfer = (date, from, to, amount, comment, hour = -1) =>
  addTx({
    date,
    fromAccount: from,
    toAccount: to,
    expense: amount,
    income: amount,
    comment,
    category: "",
    payee: "",
    hour,
  });

// ===================== Профиль семьи =====================
const ACCOUNT_TBANK = "Т-Банк";
const ACCOUNT_TBANK_SAVE = "Т-Банк - Нак.счет";
const ACCOUNT_SBER = "Сбер";
const ACCOUNT_SBER_SAVE = "Сбер - Нак.счет";
const ACCOUNT_VTB_DEPOSIT = "ВТБ - Вклад";
const ACCOUNT_GPB_SAVE = "ГПБ - Нак.счет";
const ACCOUNT_ALFA = "Альфа";
const ACCOUNT_OZON = "Озон Карта";
const ACCOUNT_BROKER = "Т-Банк - Брокерский счёт";
const ACCOUNT_CASH = "Наличные ₽";

const ALL_ACCOUNTS = [
  ACCOUNT_TBANK,
  ACCOUNT_TBANK_SAVE,
  ACCOUNT_SBER,
  ACCOUNT_SBER_SAVE,
  ACCOUNT_VTB_DEPOSIT,
  ACCOUNT_GPB_SAVE,
  ACCOUNT_ALFA,
  ACCOUNT_OZON,
  ACCOUNT_BROKER,
  ACCOUNT_CASH,
];

// ===================== Пулы получателей и комментариев =====================
const GROC = [
  "Магнит",
  "Пятёрочка",
  "Перекрёсток",
  "ВкусВилл",
  "Ашан",
  "Лента",
  "Окей",
  "Метро",
  "Яндекс Лавка",
  "Самокат",
  "Глобус",
  "Азбука Вкуса",
];
const DINING = [
  "Burger King",
  "Вкусно — и точка",
  "KFC",
  "Шоколадница",
  "Старбакс",
  "Cofix",
  "Чайхона №1",
  "Папа Джонс",
  "Tanuki",
  "Ribambelle",
  "Грузинский погребок",
  "Перчини",
  "Ginza",
  "Bro & N",
];
const DELIVERY = ["Яндекс Еда", "Delivery Club", "Кухня на районе", "Яндекс Лавка"];
const TAXI = ["Яндекс Такси"];
const FUEL = ["Лукойл", "Газпромнефть", "Роснефть", "Shell", "BP", "Татнефть"];
const PHARMACY = ["Аптека Ригла", "Аптека 36.6", "Горздрав", "Самсон-Фарма", "ЭкономЪ"];
const COSMETICS = ["Л'Этуаль", "Иль де Ботэ", "Золотое Яблоко", "Sephora"];
const HOUSEHOLD = ["IKEA", "Леруа Мерлен", "OBI", "Hoff", "Castorama", "Wildberries", "Ozon"];
const KIDS_CLOTHES = ["Детский Мир", "Acoola", "Gulliver", "H&M Kids", "Zara Kids"];
const ADULT_CLOTHES = [
  "Zara",
  "H&M",
  "Massimo Dutti",
  "Uniqlo",
  "Lamoda",
  "Wildberries",
  "Bershka",
  "Pull&Bear",
];
const ELECTRONICS = ["М.Видео", "DNS", "Эльдорадо", "re:Store", "iSpace", "Технопарк"];
const VET = ["Беланта", "Свой Доктор", "Vetcity Clinic", "Зоозавр (ветклиника)"];
const PET_SHOPS = ["Зоомагазин Бетховен", "Четыре Лапы", "Ле'Муррр", "Зоозавр", "Petshop.ru"];
const MEDICAL = [
  "Поликлиника СМ-Клиника",
  "Атлас",
  "Чайка",
  "Семейная клиника",
  "Стоматология Дентал",
];
const ENTERTAINMENT = [
  "Кинотеатр Каро",
  "Кинотеатр Формула Кино",
  "Океанариум",
  "Парк Горького",
  "ВДНХ",
  "Музей современного искусства",
];
const HAIRDRESSER = ["Салон красоты", "OldBoy Barbershop", "Точка красоты"];
const TRANSPORT_PUBLIC = ["Метро Москвы", "Аэроэкспресс", "Билет на Тройку"];
const PARKING = ["Парковка центр Москвы", "Платная парковка"];
const TOLLS = ["Госавтоинспекция", "Платная дорога М11"];

// Праздничные / подарочные комментарии
const GIFTS_NY = [
  "Подарок маме на Новый Год",
  "Подарок Алексея под ёлку",
  "Конфеты для ребёнка #дочь",
  "Игрушки Аня нашла под ёлкой",
  "Шампанское на новогодний стол",
  "Икра и лосось на новогодний стол",
  "Мандарины и фрукты к празднику",
  "Свечи и украшения для ёлки",
];

// ===================== Жизненные события =====================
// Каждое событие: { from: "YYYY-MM-DD", to: "YYYY-MM-DD", action: (d) => ... }
function withinDate(d, fromYMD, toYMD) {
  const y = ymd(d);
  return y >= fromYMD && y <= toYMD;
}

// Зарплаты — растут со временем
function salaryDad(d) {
  const factor = inflFactor(d);
  return 245000 * factor * (1 + (rand() - 0.5) * 0.04);
}
function salaryMom(d) {
  const factor = inflFactor(d);
  return 145000 * factor * (1 + (rand() - 0.5) * 0.04);
}

// Главный цикл день-за-днём
const oneDay = 86400000;
const totalDays = Math.round((END - START) / oneDay);

for (let i = 0; i <= totalDays; i++) {
  const d = new Date(START.getTime() + i * oneDay);
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const dow = d.getDay(); // 0=вс
  const isWeekend = dow === 0 || dow === 6;
  const factor = inflFactor(d);
  const yymd = ymd(d);

  // ========== Ежемесячные регулярные ==========

  // Зарплата папы 5-го
  if (day === 5) {
    inc(d, ACCOUNT_TBANK, salaryDad(d), "Зарплата", "Работа Алексея",
      `Зарплата за ${monthName(month - 1)}`, 11);
    // Премии квартальные
    if ([3, 6, 9, 12].includes(month)) {
      const bonus = salaryDad(d) * (0.4 + rand() * 0.4);
      inc(d, ACCOUNT_TBANK, bonus, "Зарплата", "Работа Алексея",
        `Квартальная премия за Q${Math.ceil(month / 3) - 1 || 4}`, 11);
    }
  }

  // Аванс мамы 25-го
  if (day === 25) {
    inc(d, ACCOUNT_SBER, salaryMom(d), "Зарплата", "Работа Лены",
      `Зарплата за ${monthName(month)} (аванс)`, 11);
  }

  // ЖКУ — 10 числа
  if (day === 10) {
    const amt = (12000 + rand() * 6000) * factor;
    expense(d, ACCOUNT_TBANK, amt, "Квартира", "iBank.ZhKU Moscow",
      `Оплата ЖКУ за ${monthName(month - 1)}`, 18);
  }

  // Электричество — 12 числа
  if (day === 12) {
    const amt = (3500 + rand() * 2000) * factor;
    expense(d, ACCOUNT_TBANK, amt, "Квартира", "ЖКУ-Москва",
      `Оплата электроэнергии за ${monthName(month - 1)}`, 19);
  }

  // Аренда квартиры до августа 2022, потом ипотека
  if (day === 7) {
    if (yymd < "2022-08-01") {
      const rent = 50000 * factor;
      expense(d, ACCOUNT_TBANK, rent, "Квартира", "Иван П.",
        `Аренда квартиры за ${monthName(month)}`, 10);
    } else {
      const mortgage = 72000 * factor;
      expense(d, ACCOUNT_TBANK, mortgage, "Квартира", "ВТБ Ипотека",
        `Платёж по ипотеке за ${monthName(month)} #ипотека`, 10);
    }
  }

  // Интернет
  if (day === 14) {
    expense(d, ACCOUNT_TBANK, 700 * factor, "Квартира", "МГТС",
      "Домашний интернет 500 Мбит/с", 12);
  }

  // Мобильная связь Алексея
  if (day === 3) {
    expense(d, ACCOUNT_TBANK, 800 * factor, "Связь", "Tele2",
      "Мобильная связь Алексея", 9);
  }
  // Мобильная связь Лены
  if (day === 4) {
    expense(d, ACCOUNT_SBER, 700 * factor, "Связь", "МТС",
      "Мобильная связь Лены", 9);
  }
  // Мобильная связь дочери (с 2023)
  if (day === 6 && yymd >= "2023-09-01") {
    expense(d, ACCOUNT_TBANK, 350 * factor, "Связь", "Билайн",
      "Мобильная связь Ани #дочь", 9);
  }

  // Подписки
  const SUBS = [
    [5, "Яндекс Плюс", 299, "Подписка Яндекс Плюс"],
    [8, "iCloud", 99, "iCloud 50 ГБ #apple"],
    [12, "Кинопоиск HD", 599, "Подписка на кино"],
    [15, "Spotify", 199, "Spotify Premium"],
    [18, "YouTube Premium", 299, "YouTube Premium"],
    [22, "ivi", 399, "Подписка ivi"],
  ];
  for (const [d_, payee, amt, cm] of SUBS) {
    if (day === d_) {
      expense(d, ACCOUNT_TBANK, amt * factor * (0.9 + rand() * 0.2),
        "Интернет-покупки / Подписки", payee, cm, 8);
    }
  }
  // ChatGPT с 2023
  if (day === 20 && yymd >= "2023-04-01") {
    expense(d, ACCOUNT_TBANK, 25 * factor, "Интернет-покупки / Подписки",
      "OpenAI", "ChatGPT Plus подписка #работа", 9);
    // currency = USD на самом деле, но пусть будет в RUB по курсу для простоты
  }
  // Adobe для Лены (маркетолога)
  if (day === 11 && yymd >= "2022-01-01") {
    expense(d, ACCOUNT_SBER, 1500 * factor, "Интернет-покупки / Подписки",
      "Adobe", "Подписка Adobe Creative Cloud #работа", 14);
  }

  // Фитнес-клуб
  if (day === 1 && month <= 12) {
    if (chance(0.85)) {
      expense(d, ACCOUNT_TBANK, 5500 * factor, "Спорт", "World Class",
        `Абонемент в фитнес-клуб на ${monthName(month)}`, 12);
    }
  }

  // ========== Ежедневные траты ==========

  // Продукты (1-2 раза в день в 60% дней)
  const grocTrips =
    rand() < 0.7 ? (rand() < 0.3 ? 2 : 1) : 0;
  for (let g = 0; g < grocTrips; g++) {
    const payee = pick(GROC);
    let amt;
    if (["Магнит", "Пятёрочка", "Окей", "Лента"].includes(payee)) {
      amt = (1500 + rand() * 4000) * factor;
    } else if (["Яндекс Лавка", "Самокат"].includes(payee)) {
      amt = (400 + rand() * 1800) * factor;
    } else if (["Азбука Вкуса", "Глобус"].includes(payee)) {
      amt = (3000 + rand() * 5000) * factor;
    } else {
      amt = (1200 + rand() * 3000) * factor;
    }
    const cmts = [
      `Продукты в ${payee}`,
      `Магазин ${payee}, на ужин`,
      `${payee} #еда`,
      `Закупка на неделю`,
      `${payee}, фрукты и хлеб`,
      `${payee}, забежали по дороге домой`,
      `${payee} #дочь покупала молоко и хлопья`,
    ];
    expense(d, pick([ACCOUNT_TBANK, ACCOUNT_TBANK, ACCOUNT_SBER]),
      amt, "Еда дома", payee, pick(cmts), -1);
  }

  // Кафе/рестораны (~30% дней)
  if (chance(isWeekend ? 0.55 : 0.3)) {
    const trips = isWeekend && chance(0.35) ? 2 : 1;
    for (let k = 0; k < trips; k++) {
      const payee = pick([...DINING, ...DINING, ...DELIVERY]);
      let amt;
      if (DELIVERY.includes(payee)) {
        amt = (900 + rand() * 2000) * factor;
      } else if (["Cofix", "Старбакс", "Шоколадница"].includes(payee)) {
        amt = (200 + rand() * 600) * factor;
      } else if (["Burger King", "KFC", "Вкусно — и точка"].includes(payee)) {
        amt = (500 + rand() * 1500) * factor;
      } else {
        amt = (1500 + rand() * 4500) * factor;
      }
      const cmts = [
        `Ужин в ${payee}`,
        `${payee} с Леной`,
        `${payee} на обед`,
        `Завтрак в ${payee}`,
        `${payee} семьёй`,
        `${payee} с коллегами #работа`,
      ];
      expense(d, ACCOUNT_TBANK, amt, "Еда вне дома", payee, pick(cmts), -1);
    }
  }

  // Кофе на работе (workdays)
  if (!isWeekend && chance(0.4)) {
    expense(d, ACCOUNT_TBANK, (170 + rand() * 200) * factor,
      "Еда вне дома", pick(["Cofix", "Coffee Bean", "Кафе у работы"]),
      "Кофе с утра #работа", 9);
  }

  // Транспорт — рабочие дни преимущественно
  if (!isWeekend && chance(0.7)) {
    if (chance(0.55)) {
      // Такси
      expense(d, ACCOUNT_TBANK,
        (250 + rand() * 700) * factor,
        "Транспорт",
        "Яндекс Такси",
        pick([
          "Такси до офиса",
          "Такси с работы",
          "Такси из аэропорта",
          "Такси домой после работы",
          "Такси до клиента #работа",
        ]),
        -1);
    } else {
      // Метро
      expense(d, ACCOUNT_SBER,
        (62 + rand() * 25) * factor,
        "Транспорт",
        pick(TRANSPORT_PUBLIC),
        "Поездка на метро",
        -1);
    }
  }

  // Пополнение карты Тройка для дочери (с 2023)
  if (day === 1 && yymd >= "2023-09-01") {
    expense(d, ACCOUNT_TBANK, 500 * factor, "Транспорт",
      "Bilet cherez SBP na tr", "Пополнение карты Тройка #дочь", 10);
  }

  // Бензин — раз в 7-10 дней
  if (chance(0.13)) {
    expense(d, ACCOUNT_TBANK,
      (2400 + rand() * 1800) * factor,
      "Машина",
      pick(FUEL),
      pick([
        "Бензин ⛽ АИ-95 #машина",
        "Заправка #машина",
        "Дозаправка по дороге",
        "Бензин 40 литров #машина",
        "Полный бак #машина",
      ]), -1);
  }

  // Парковка
  if (!isWeekend && chance(0.1)) {
    expense(d, ACCOUNT_TBANK,
      (50 + rand() * 200) * factor,
      "Машина", pick(PARKING),
      "Парковка в центре #машина", -1);
  }
  // МСД и платные дороги
  if (chance(0.05)) {
    expense(d, ACCOUNT_TBANK, (38 + rand() * 200) * factor,
      "Машина", pick(TOLLS), "Проезд по платной дороге #машина", -1);
  }

  // Аптека
  if (chance(0.05)) {
    expense(d, ACCOUNT_TBANK,
      (300 + rand() * 1800) * factor,
      "Здоровье", pick(PHARMACY),
      pick([
        "Лекарства от простуды",
        "Витамины для всей семьи",
        "Анальгин и парацетамол",
        "Лекарства для Ани #дочь",
        "Антибиотики по рецепту",
        "Препараты для давления для мамы",
      ]), -1);
  }

  // Косметика
  if (chance(0.04)) {
    expense(d, ACCOUNT_SBER,
      (1500 + rand() * 4500) * factor,
      "Уход за собой / Лена", pick(COSMETICS),
      pick([
        "Косметика #Лена",
        "Помада и тушь #Лена",
        "Крем для лица #Лена",
        "Парфюм #Лена",
        "Шампунь и кондиционер",
      ]), -1);
  }

  // Парикмахерская / стрижки
  if (chance(0.02)) {
    expense(d, ACCOUNT_TBANK,
      (1500 + rand() * 3000) * factor,
      "Уход за собой", pick(HAIRDRESSER),
      pick([
        "Стрижка Алексея #Алексей",
        "Окрашивание #Лена",
        "Стрижка Ани #дочь",
        "Семейная стрижка втроём",
      ]), -1);
  }

  // Одежда
  if (chance(0.03)) {
    const adultClothes = chance(0.7);
    const payee = adultClothes ? pick(ADULT_CLOTHES) : pick(KIDS_CLOTHES);
    const amt = adultClothes
      ? (3000 + rand() * 12000) * factor
      : (1500 + rand() * 5000) * factor;
    expense(d, chance(0.5) ? ACCOUNT_TBANK : ACCOUNT_SBER,
      amt,
      adultClothes ? "Одежда" : "Аня",
      payee,
      adultClothes
        ? pick([
            `${payee}, осенняя коллекция`,
            `${payee}, рубашки и джинсы`,
            `${payee} для Лены`,
            `${payee} для Алексея`,
          ])
        : pick([
            `${payee}, одежда для Ани #дочь`,
            `${payee}, школьная форма #дочь`,
            `${payee}, обувь #дочь`,
            `${payee}, куртка на зиму #дочь`,
          ]), -1);
  }

  // Товары для дома
  if (chance(0.04)) {
    const payee = pick(HOUSEHOLD);
    const amt = (700 + rand() * 8000) * factor;
    expense(d, chance(0.6) ? ACCOUNT_TBANK : ACCOUNT_OZON,
      amt, "Товары для дома", payee,
      pick([
        `${payee} — мелочи для кухни`,
        `${payee} — постельное бельё`,
        `${payee} — посуда`,
        `${payee} — лампочки и батарейки`,
        `${payee} — порошок и хозяйственное`,
        `${payee} — органайзер для шкафа`,
      ]), -1);
  }

  // Зоомагазин — еженедельно
  if (chance(0.18)) {
    const payee = pick(PET_SHOPS);
    let petTag, comment, amt;
    const hasDog = yymd >= "2022-10-15";
    const which = hasDog ? (chance(0.55) ? "cat" : "dog") : "cat";
    if (which === "cat") {
      petTag = "#Мурзик";
      amt = (500 + rand() * 3500) * factor;
      comment = pick([
        `Корм для кота ${petTag}`,
        `Лоток и наполнитель ${petTag}`,
        `Royal Canin для кота ${petTag}`,
        `Игрушка для кота ${petTag}`,
        `Сухой корм Hill's ${petTag}`,
      ]);
    } else {
      petTag = "#Тоби";
      amt = (1500 + rand() * 4500) * factor;
      comment = pick([
        `Корм для собаки ${petTag}`,
        `Поводок и амуниция ${petTag}`,
        `Игрушки для Тоби ${petTag}`,
        `Сухой корм Acana ${petTag}`,
        `Витамины для собаки ${petTag}`,
      ]);
    }
    expense(d, ACCOUNT_TBANK, amt,
      `Животные / ${which === "cat" ? "Кот" : "Собака"}`, payee, comment, -1);
  }

  // Развлечения
  if (chance(isWeekend ? 0.15 : 0.04)) {
    const payee = pick(ENTERTAINMENT);
    const amt = (1500 + rand() * 4000) * factor;
    expense(d, ACCOUNT_TBANK, amt, "Развлечения", payee,
      pick([
        `Кино всей семьёй ${payee}`,
        `Поход в ${payee} #дочь`,
        `Посещение ${payee}`,
        `Семейные выходные в ${payee}`,
      ]), -1);
  }

  // Cashback в конце месяца
  if (day >= 28 && day <= 30 && chance(0.6)) {
    inc(d, ACCOUNT_TBANK, (300 + rand() * 1500) * factor,
      "Кешбэк", "Т-Банк", `Кешбэк за ${monthName(month)}`, 12);
  }

  // ========== Сезонные / годовые события ==========

  // Подарки / Новый Год (с 25 декабря по 5 января)
  if ((month === 12 && day >= 25) || (month === 1 && day <= 5)) {
    if (chance(0.35)) {
      expense(d, ACCOUNT_TBANK,
        (1500 + rand() * 8000) * factor,
        "Подарки", pick([...HOUSEHOLD, "Hoff", "Подарки.ру"]),
        pick(GIFTS_NY), -1);
    }
  }
  // 8 марта
  if (month === 3 && day >= 5 && day <= 8 && chance(0.5)) {
    expense(d, ACCOUNT_TBANK,
      (2000 + rand() * 6000) * factor,
      "Подарки", pick(["Цветы Никитский", "OZON", "Wildberries"]),
      pick([
        "Цветы для Лены на 8 марта #Лена",
        "Букет роз #Лена",
        "Подарок маме на 8 марта",
      ]), -1);
  }
  // 23 февраля
  if (month === 2 && day >= 20 && day <= 23 && chance(0.4)) {
    expense(d, ACCOUNT_SBER,
      (1500 + rand() * 5000) * factor,
      "Подарки", pick(ELECTRONICS),
      "Подарок Алексею на 23 февраля #Алексей", -1);
  }

  // Дни рождения
  // Алексей: 14 июня
  if (month === 6 && day === 14) {
    expense(d, ACCOUNT_SBER,
      (5000 + rand() * 8000) * factor, "Подарки", pick(ELECTRONICS),
      "Подарок Алексею на день рождения #Алексей", 14);
  }
  // Лена: 22 сентября
  if (month === 9 && day === 22) {
    expense(d, ACCOUNT_TBANK,
      (5000 + rand() * 8000) * factor, "Подарки", "Цветы Никитский",
      "Подарок Лене на день рождения #Лена", 14);
  }
  // Аня: 7 ноября
  if (month === 11 && day === 7) {
    expense(d, ACCOUNT_TBANK,
      (3000 + rand() * 6000) * factor, "Аня", "Детский Мир",
      "Подарок Ане на день рождения #дочь", 14);
  }

  // ========== Сберегательные переводы ==========
  // Каждый 6-й число — на накопит. Т-Банк
  if (day === 6 && chance(0.85)) {
    transfer(d, ACCOUNT_TBANK, ACCOUNT_TBANK_SAVE,
      (30000 + rand() * 30000) * factor, "Перевод на накопительный счёт", 13);
  }
  // 27 — на Сбер накопит
  if (day === 27 && chance(0.7)) {
    transfer(d, ACCOUNT_SBER, ACCOUNT_SBER_SAVE,
      (15000 + rand() * 25000) * factor, "Перевод на накопительный Сбер", 13);
  }
  // Брокерский счёт ежемесячно
  if (day === 9 && yymd >= "2022-01-01" && chance(0.85)) {
    transfer(d, ACCOUNT_TBANK, ACCOUNT_BROKER,
      (15000 + rand() * 25000) * factor, "Пополнение брокерского счёта", 12);
  }

  // Проценты по накопительным (0.5%/мес)
  if (day === 28) {
    inc(d, ACCOUNT_TBANK_SAVE,
      gauss(2500, 800) * factor, "Проценты", "Т-Банк",
      "Начисление процентов на накопит. счёт", 0);
    if (yymd >= "2022-01-01") {
      inc(d, ACCOUNT_SBER_SAVE,
        gauss(1500, 500) * factor, "Проценты", "Сбер",
        "Начисление процентов на накопит. Сбер", 0);
    }
  }
  // Купоны/дивы по брокерскому
  if ((day === 17 && month % 3 === 0)) {
    if (yymd >= "2022-04-01") {
      inc(d, ACCOUNT_BROKER, gauss(8000, 3000) * factor, "Инвестиции",
        "Т-Банк Инвестиции", "Купонный доход по облигациям", 11);
    }
  }
  // Вклад ВТБ — пополнение раз в полгода
  if (day === 1 && (month === 3 || month === 9) && yymd >= "2022-03-01") {
    transfer(d, ACCOUNT_TBANK_SAVE, ACCOUNT_VTB_DEPOSIT,
      (200000 + rand() * 200000) * factor,
      `Пополнение вклада ВТБ`, 12);
  }
  // Проценты по вкладу — раз в полгода
  if (day === 30 && (month === 8 || month === 2) && yymd >= "2022-08-01") {
    inc(d, ACCOUNT_VTB_DEPOSIT, gauss(80000, 25000) * factor,
      "Проценты", "ВТБ", "Проценты по вкладу", 0);
  }

  // Снятие наличных
  if (chance(0.04)) {
    transfer(d, ACCOUNT_TBANK, ACCOUNT_CASH,
      (3000 + rand() * 7000) * factor, "Снятие наличных в банкомате", -1);
  }
  // Трата наличных
  if (chance(0.06)) {
    expense(d, ACCOUNT_CASH, (300 + rand() * 1500) * factor,
      pick(["Еда дома", "Транспорт", "Развлечения"]),
      pick(["Рынок продукты", "Чаевые в кафе", "Парковка наличными", "Цветы у метро"]),
      pick([
        "Покупки на рынке",
        "Чаевые официанту",
        "Цветы у метро",
        "Мелочи в киоске",
      ]),
      -1);
  }

  // Обучение Ани (с сентября 2021)
  if (yymd >= "2021-09-01") {
    // Гимнастика 4500 в месяц (1 числа)
    if (day === 2) {
      expense(d, ACCOUNT_TBANK, 4500 * factor, "Аня", "Школа гимнастики Юная",
        "Абонемент на гимнастику #дочь", 18);
    }
    // Английский — 2 раза в неделю
    if ((dow === 2 || dow === 4) && yymd >= "2021-09-01") {
      if (chance(0.85)) {
        expense(d, ACCOUNT_TBANK, 2500 * factor, "Аня", "Ольга Николаевна",
          "Урок английского с репетитором #дочь", 17);
      }
    }
    // Музыкальная школа (с 2022-09)
    if (yymd >= "2022-09-01" && dow === 6 && chance(0.7)) {
      expense(d, ACCOUNT_TBANK, 3000 * factor, "Аня",
        "Музыкальная школа", "Урок фортепиано #дочь", 11);
    }
  }

  // ========== Особые события ==========

  // 2021-08-30..09-01: подготовка к школе
  if (yymd >= "2021-08-25" && yymd <= "2021-09-05") {
    if (chance(0.5)) {
      expense(d, ACCOUNT_TBANK,
        (3000 + rand() * 8000) * factor,
        "Аня", pick([...KIDS_CLOTHES, "Канцтовары Гулливер", "Книги Москва"]),
        pick([
          "Школьная форма для Ани #дочь",
          "Канцтовары к 1 сентября #дочь",
          "Учебники и тетради #дочь",
          "Рюкзак на новый год обучения #дочь",
        ]), -1);
    }
  }
  // То же каждый август
  if (month === 8 && day >= 25 && yymd >= "2022-08-25") {
    if (chance(0.45)) {
      expense(d, ACCOUNT_TBANK,
        (4000 + rand() * 9000) * factor,
        "Аня", pick([...KIDS_CLOTHES, "Канцтовары", "Wildberries"]),
        pick([
          "Подготовка к новому учебному году #дочь",
          "Канцтовары на 1 сентября #дочь",
          "Школьная форма #дочь",
          "Новый рюкзак #дочь",
        ]), -1);
    }
  }

  // Поездка в Сочи 2022 (15-25 мая)
  if (yymd === "2022-05-12") {
    expense(d, ACCOUNT_TBANK, 80000 * factor, "Зеленокумск/Отпуск",
      "Авиабилеты в Т-Путешествиях", "Авиабилеты Москва-Сочи на 3 человека #отпуск", 14);
  }
  if (yymd === "2022-05-13") {
    expense(d, ACCOUNT_TBANK, 95000 * factor, "Зеленокумск/Отпуск",
      "Букинг отель", "Бронирование отеля в Сочи на 10 ночей #отпуск", 15);
  }
  if (yymd >= "2022-05-15" && yymd <= "2022-05-25") {
    if (chance(0.6)) {
      expense(d, ACCOUNT_TBANK,
        (1500 + rand() * 6000) * factor,
        "Зеленокумск/Отпуск", pick([...DINING, ...ENTERTAINMENT]),
        pick([
          "Ужин на набережной #отпуск",
          "Развлечения на пляже #отпуск",
          "Аквапарк всей семьёй #отпуск",
          "Ресторан на закате #отпуск",
          "Сувениры с Чёрного моря #отпуск",
        ]), -1);
    }
  }

  // Покупка машины Kia Rio — 2022-08-15
  if (yymd === "2022-08-15") {
    transfer(d, ACCOUNT_TBANK_SAVE, ACCOUNT_TBANK,
      1500000 * factor, "Перевод на покупку машины #KiaRio", 9);
    expense(d, ACCOUNT_TBANK, 1450000 * factor, "Машина",
      "Автосалон Москва", "Покупка Kia Rio 2022 года выпуска #KiaRio #машина", 14);
    expense(d, ACCOUNT_TBANK, 35000 * factor, "Машина",
      "ОСАГО", "ОСАГО на Kia Rio #машина", 16);
    expense(d, ACCOUNT_TBANK, 65000 * factor, "Машина",
      "КАСКО Ингосстрах", "КАСКО на Kia Rio #машина", 17);
  }
  // Затем регулярное обслуживание машины — каждые ~3 месяца
  if (yymd >= "2022-09-01" && day === 18 && month % 3 === 0 && chance(0.7)) {
    expense(d, ACCOUNT_TBANK, (3500 + rand() * 4000) * factor,
      "Машина", "Автомойка", "Мойка машины и химчистка #машина", -1);
  }
  // ТО раз в полгода
  if ((month === 4 || month === 10) && day === 12 && yymd >= "2022-10-12") {
    expense(d, ACCOUNT_TBANK, (8000 + rand() * 10000) * factor,
      "Машина", "СТО Киа Сервис", "ТО Kia Rio #машина", 14);
  }
  // ОСАГО ежегодно
  if (month === 8 && day === 15 && yymd >= "2023-08-15") {
    expense(d, ACCOUNT_TBANK, 38000 * factor, "Машина",
      "ОСАГО", "Продление ОСАГО #машина", 14);
  }

  // Появление собаки 2022-10-15
  if (yymd === "2022-10-15") {
    expense(d, ACCOUNT_TBANK, 35000 * factor, "Животные / Собака",
      "Питомник Лабрадоров", "Покупка щенка лабрадора Тоби #Тоби", 13);
    expense(d, ACCOUNT_TBANK, 12000 * factor, "Животные / Собака",
      "Зоозавр", "Стартовый набор для щенка: лежак, миски, корм #Тоби", 15);
    expense(d, ACCOUNT_TBANK, 5000 * factor, "Животные / Собака",
      "Беланта", "Первичный осмотр и вакцинация #Тоби", 17);
  }
  // Дрессировка с ноября 2022
  if (yymd >= "2022-11-15" && yymd <= "2023-03-30" && dow === 0 && chance(0.7)) {
    expense(d, ACCOUNT_TBANK, 3000 * factor, "Животные / Собака",
      "Кинолог Дарья Е.", "Занятие по дрессировке с кинологом #Тоби", 11);
  }

  // Болезнь кота — март 2023
  if (yymd === "2023-03-12") {
    expense(d, ACCOUNT_TBANK, 25000 * factor, "Животные / Кот",
      "Беланта", "Срочный приём, УЗИ и анализы для Мурзика #Мурзик", 18);
  }
  if (yymd === "2023-03-15") {
    expense(d, ACCOUNT_TBANK, 50000 * factor, "Животные / Кот",
      "Беланта", "Операция по удалению опухоли коту #Мурзик", 12);
  }
  if (yymd === "2023-03-20") {
    expense(d, ACCOUNT_TBANK, 8000 * factor, "Животные / Кот",
      "Аптека Beethoven", "Препараты после операции для кота #Мурзик", 18);
  }

  // Ремонт кухни — июль-сентябрь 2023
  if (yymd >= "2023-07-01" && yymd <= "2023-09-15") {
    if (chance(0.13)) {
      const cost = (8000 + rand() * 50000) * factor;
      const payee = pick([
        "Леруа Мерлен", "Hoff", "IKEA", "Кухни Мария", "Бригада ремонтников",
        "Электрик Андрей", "Сантехник Максим", "Грузчики ГрузовичкоФ",
      ]);
      expense(d, chance(0.5) ? ACCOUNT_TBANK : ACCOUNT_TBANK_SAVE,
        cost, "Ремонт", payee,
        pick([
          `${payee} — материалы для ремонта #ремонт`,
          `${payee} — оплата работ #ремонт`,
          `${payee} — кухонный гарнитур #ремонт`,
          `${payee} — плитка и затирка #ремонт`,
          `${payee} — техника на кухню #ремонт`,
        ]), -1);
    }
  }
  // Финальный аккорд ремонта
  if (yymd === "2023-09-10") {
    expense(d, ACCOUNT_TBANK_SAVE, 180000 * factor, "Ремонт",
      "Кухни Мария", "Установка кухонного гарнитура #ремонт", 16);
  }

  // Турция 2023-07-20..2023-08-03 — отпуск
  if (yymd === "2023-07-15") {
    expense(d, ACCOUNT_TBANK, 250000 * factor, "Отпуск",
      "Travelata.ru", "Тур в Турцию (Анталия) на 14 дней семьёй #отпуск", 14);
  }
  if (yymd >= "2023-07-20" && yymd <= "2023-08-03" && chance(0.55)) {
    expense(d, ACCOUNT_TBANK, (800 + rand() * 6000) * factor,
      "Отпуск", pick([...DINING, "Турецкий рынок", "Аквапарк Анталии", "Magnit Турция"]),
      pick([
        "Ужин на берегу моря в Анталии #отпуск",
        "Сувениры с курорта #отпуск",
        "Экскурсия в Памуккале #отпуск",
        "Аквапарк #отпуск",
        "Прогулка на яхте #отпуск",
        "Турецкая баня #отпуск",
      ]), -1);
  }

  // iPhone 2024-01-25
  if (yymd === "2024-01-25") {
    expense(d, ACCOUNT_TBANK_SAVE, 130000 * factor, "Электроника",
      "re:Store", "iPhone 15 Pro для Алексея #Алексей", 14);
  }
  // iPhone для Лены — февраль 2024
  if (yymd === "2024-02-14") {
    expense(d, ACCOUNT_TBANK, 110000 * factor, "Электроника",
      "re:Store", "iPhone 15 для Лены как подарок на 14 февраля #Лена", 18);
  }

  // Турция 2024-07-12..07-26
  if (yymd === "2024-07-05") {
    expense(d, ACCOUNT_TBANK_SAVE, 380000 * factor, "Отпуск",
      "OneTwoTrip", "Тур в Турцию all-inclusive 5* семьёй #отпуск", 13);
  }
  if (yymd >= "2024-07-12" && yymd <= "2024-07-26" && chance(0.6)) {
    expense(d, ACCOUNT_TBANK, (1000 + rand() * 7000) * factor,
      "Отпуск", pick([...DINING, "Турецкий базар", "Аквапарк"]),
      pick([
        "Обед в ресторане отеля #отпуск",
        "Шоппинг на базаре #отпуск",
        "Морская прогулка #отпуск",
        "Спа в отеле #отпуск",
        "Сувениры #отпуск",
      ]), -1);
  }

  // MacBook 2025-02-18
  if (yymd === "2025-02-18") {
    expense(d, ACCOUNT_TBANK_SAVE, 220000 * factor, "Электроника",
      "re:Store", "MacBook Pro M4 для Алексея #Алексей #работа", 14);
  }

  // Брекеты для Ани — серия платежей с 2025-04
  if (yymd === "2025-04-12") {
    expense(d, ACCOUNT_TBANK, 90000 * factor, "Здоровье",
      "Стоматология Дентал", "Установка брекетов для Ани #дочь", 11);
  }
  if (yymd === "2025-07-15") {
    expense(d, ACCOUNT_TBANK, 50000 * factor, "Здоровье",
      "Стоматология Дентал", "Корректировка брекетов #дочь", 11);
  }
  if (yymd === "2025-10-15") {
    expense(d, ACCOUNT_TBANK, 50000 * factor, "Здоровье",
      "Стоматология Дентал", "Контроль брекетов #дочь", 11);
  }
  if (yymd === "2026-01-15") {
    expense(d, ACCOUNT_TBANK, 55000 * factor, "Здоровье",
      "Стоматология Дентал", "Контроль и замена дуг брекетов #дочь", 11);
  }

  // Грузия 2025-08-10..08-22
  if (yymd === "2025-08-01") {
    expense(d, ACCOUNT_TBANK, 290000 * factor, "Отпуск",
      "Aviasales", "Билеты и отель в Грузии (Тбилиси-Батуми) #отпуск", 14);
  }
  if (yymd >= "2025-08-10" && yymd <= "2025-08-22" && chance(0.55)) {
    expense(d, ACCOUNT_TBANK, (700 + rand() * 5500) * factor,
      "Отпуск", pick(["Khinkali House", "Salobie Bia", "Винодельня Кахети", ...DINING]),
      pick([
        "Хинкали и хачапури #отпуск",
        "Винный тур Кахети #отпуск",
        "Канатная дорога Тбилиси #отпуск",
        "Прогулка по старому городу #отпуск",
        "Сувениры из Грузии #отпуск",
      ]), -1);
  }

  // Ежегодный медосмотр
  if (month === 11 && day === 5) {
    expense(d, ACCOUNT_TBANK, (15000 + rand() * 8000) * factor,
      "Здоровье", "СМ-Клиника",
      "Ежегодный медосмотр Алексея #Алексей", 11);
  }
  if (month === 4 && day === 22) {
    expense(d, ACCOUNT_SBER, (15000 + rand() * 6000) * factor,
      "Здоровье", "Семейная клиника",
      "Ежегодный осмотр Лены #Лена", 11);
  }

  // Налоги — июль-октябрь
  if (month === 11 && day === 28) {
    expense(d, ACCOUNT_TBANK, gauss(45000, 8000) * factor, "Налоги",
      "ФНС России", "Транспортный налог + налог на имущество", 17);
  }
  // Возврат НДФЛ за лечение/обучение — апрель
  if (month === 4 && day === 18 && yymd >= "2022-04-18") {
    inc(d, ACCOUNT_TBANK, gauss(35000, 12000) * factor, "Налоги",
      "ФНС России", "Возврат НДФЛ по налоговому вычету", 11);
  }
}

// ===================== Запись CSV =====================
function csvEscape(s) {
  const str = String(s ?? "");
  if (str.includes('"') || str.includes(";") || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}
function csvNumeric(v) {
  if (v === 0 || v === null || v === undefined) return `"0"`;
  return `"${Number(v).toFixed(2).replace(/\.?0+$/, "")}"`;
}

const HEADER = [
  "date",
  "categoryName",
  "payee",
  "comment",
  "outcomeAccountName",
  "outcome",
  "outcomeCurrencyShortTitle",
  "incomeAccountName",
  "income",
  "incomeCurrencyShortTitle",
  "createdDate",
  "changedDate",
  "qrCode",
];

// Сортируем по дате (descending как в реальной выгрузке)
txs.sort((a, b) => b.createdDate.localeCompare(a.createdDate));

const lines = [HEADER.join(";")];
for (const t of txs) {
  lines.push(
    [
      t.date,
      csvEscape(t.categoryName),
      csvEscape(t.payee),
      csvEscape(t.comment),
      csvEscape(t.outcomeAccountName),
      csvNumeric(t.outcome),
      t.outcomeCurrencyShortTitle,
      csvEscape(t.incomeAccountName),
      csvNumeric(t.income),
      t.incomeCurrencyShortTitle,
      csvEscape(t.createdDate),
      csvEscape(t.changedDate),
      "",
    ].join(";")
  );
}

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, lines.join("\n") + "\n", "utf-8");

// ===================== Сводка =====================
const accountBalances = {};
let totalIncome = 0,
  totalExpense = 0;
for (const t of txs) {
  if (t.outcome > 0) {
    totalExpense += t.outcome;
    accountBalances[t.outcomeAccountName] =
      (accountBalances[t.outcomeAccountName] || 0) - t.outcome;
  }
  if (t.income > 0) {
    totalIncome += t.income;
    accountBalances[t.incomeAccountName] =
      (accountBalances[t.incomeAccountName] || 0) + t.income;
  }
}
const dates = txs.map((t) => t.date).sort();
const fmt = (n) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n);

console.log("");
console.log(`✓ Сгенерирован файл: ${OUT_PATH}`);
console.log(`  Транзакций: ${txs.length}`);
console.log(`  Период: ${dates[0]} — ${dates[dates.length - 1]}`);
console.log(`  Всего доходов: ${fmt(totalIncome)} ₽`);
console.log(`  Всего расходов: ${fmt(totalExpense)} ₽`);
console.log(`  Чистый поток (≈ совокупный баланс от 0): ${fmt(totalIncome - totalExpense)} ₽`);
console.log("");
console.log("  Дельта по счетам (от 0):");
const sorted = Object.entries(accountBalances).sort(
  (a, b) => Math.abs(b[1]) - Math.abs(a[1])
);
for (const [acc, bal] of sorted) {
  const sign = bal >= 0 ? "+" : "−";
  console.log(`    ${acc.padEnd(32)} ${sign}${fmt(Math.abs(bal))} ₽`);
}
