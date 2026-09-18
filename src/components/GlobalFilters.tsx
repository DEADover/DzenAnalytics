import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Popover } from "./Popover";
import { useFiltersDockStore } from "../store/useFiltersDockStore";
import { useDisplayStore } from "../store/useDisplayStore";
import { Checkbox } from "./Checkbox";
import type { Transaction } from "../types";
import {
  X,
  ChevronDown,
  FilterX,
  Filter,
  SlidersHorizontal,
  Coins,
  PieChart,
  Wallet,
  Users,
  UserRound,
  UsersRound,
} from "lucide-react";
import { MultiSelect } from "./MultiSelect";
import { AccountLogo } from "./AccountLogo";
import { accountKindLabel, DEBT_TYPES } from "../lib/accountType";
import { parseDebtKey, withDebtCounterparties } from "../lib/debtFilter";
import { CategoryFilterPicker } from "./CategoryFilterPicker";
import { PeriodPicker } from "./PeriodPicker";
import { Segmented, type SegmentedOption } from "./Segmented";
import { currencySymbol } from "../lib/format";
import clsx from "clsx";
import { useDataStore } from "../store/useDataStore";
import {
  getLiveAccountsFromCache,
  getCategoryTagsFromCache,
  getZenUsersFromCache,
} from "../store/useZenmoneyStore";
import { accountOptions } from "../lib/accountOptions";
import { presetToRange, useFiltersStore, type DatePreset } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { currentPeriod, periodRange } from "../lib/period";
import { formatDate } from "../lib/format";
import type { PeriodController } from "../hooks/useLocalPeriod";
import { FiltersMenu } from "./FiltersMenu";
import { NO_CATEGORY } from "../lib/zenmoneyMap";
import { currencyFlagEmoji } from "../lib/currencyFlag";
import {
  membersInData,
  hasSharedItems,
  userLabel,
  MEMBER_SHARED,
  type ZenUserOption,
} from "../lib/zenUsers";
import { useMembersStore } from "../store/useMembersStore";

/**
 * Пресеты периода.
 *
 * «Месяц» и «Период» стоят кнопками наравне с остальными, хотя задаются
 * соседними контролами: без них выбор месяца или своих дат не подсвечивал
 * ничего, и было не понять, какой фильтр сейчас действует. «С начала года»
 * убран — при живой кнопке «Год», которая и так открывается на текущем,
 * он повторял её; старые сохранённые виды с ним по-прежнему работают, и
 * кнопка для них возвращается в ряд (см. `presetOptions`).
 */
const PRESETS: SegmentedOption<DatePreset>[] = [
  { value: "30d", label: "30 дней" },
  { value: "3m", label: "3 мес" },
  { value: "6m", label: "6 мес" },
  { value: "12m", label: "12 мес" },
  {
    value: "year",
    label: "Год",
    title: "Календарный год целиком — листается стрелками, в отличие от скользящих «12 мес»",
  },
  { value: "all", label: "Всё" },
];

const OP_TYPES: { value: string; label: string; hint?: string }[] = [
  { value: "income", label: "Доходы" },
  {
    value: "expense",
    label: "Расходы",
    hint: "Траты вместе с возвратами — как их считает Дзен-мани",
  },
  { value: "transfer", label: "Переводы" },
  {
    value: "refund",
    label: "Возвраты",
    hint: "Только возвраты: приход по расходной категории, гасящий трату",
  },
];


/**
 * Выбор в ряду данных (счета, категории, валюта, участники): на десктопе —
 * своей ширины, на телефоне — по два в строку. Меню у них порталом и само
 * держится в экране.
 */
const PICKER_PHONE =
  "shrink-0 max-sm:w-auto max-sm:flex-1 max-sm:basis-[calc(50%-0.25rem)] max-sm:min-w-0";

/** Служебные категории, которые держим наверху списка без заголовка группы. */
const PINNED_CATEGORIES = ["Корректировка"];

export function GlobalFilters({
  showDateRange = true,
  dateRangeHint,
  showDataFilters = true,
  dataFiltersHint,
  dimmed = false,
  period,
}: {
  /**
   * Управляет ли эта панель периодом. `false` — контролы дат остаются на месте,
   * но становятся НЕАКТИВНЫМИ.
   *
   * Раньше они просто исчезали, и панель на страницах со своим периодом
   * («Сравнение», «Календарь», «50/30/20») выглядела короче, чем на остальных.
   * Одинаковая на вид панель, часть которой погашена, читается спокойнее, чем
   * панель, у которой каждый раз разный набор контролов.
   */
  showDateRange?: boolean;
  /** Чем объяснить, почему даты недоступны. Показывается подсказкой. */
  dateRangeHint?: string;
  /**
   * Работают ли фильтры ДАННЫХ: сохранённый вид, «Дополнительно», счета,
   * категории, валюта, поиск. `false` — они остаются на месте, но гаснут и не
   * нажимаются, а период при этом живой. Зеркало `showDateRange`, только с
   * другой стороны панели.
   *
   * Нужно там, где страница считает по всей истории и слушает только период
   * («Счета» → «Капитал»): без этого рядом стоят два фильтра «Счета» — общий,
   * который на остатки не влияет, и свой у графика, — и понять, какой чем
   * управляет, нельзя.
   */
  showDataFilters?: boolean;
  /** Чем объяснить, почему фильтры данных недоступны. Подсказкой и строкой под панелью. */
  dataFiltersHint?: string;
  /**
   * Панель целиком не действует на то, что сейчас на экране: гасим её и не даём
   * трогать. Тот же приём, что и с датами выше, только на всю панель.
   *
   * Убирать панель совсем нельзя: она общая для всего приложения, и её пропажа
   * читалась бы как «фильтров тут не бывает». Погашенная панель на месте
   * говорит правду: они есть, но этим данным не указ.
   */
  dimmed?: boolean;
  /** Controlled period — when provided, ALL period controls (presets, month
   *  picker, custom range) drive this page-local controller instead of the
   *  global filter store, without touching the global «месяц». Used by history
   *  charts (Cash-flow, Trends). See `useLocalPeriod`. */
  period?: PeriodController;
} = {}) {
  const transactions = useDataStore((s) => s.transactions);
  // Фильтр сравнивает суммы в базовой валюте, поэтому и подпись — по ней.
  const base = useDataStore((s) => s.rates.base);
  const f = useFiltersStore();
  const controlledPeriod = period !== undefined;
  // Period slice source: the local controller when controlled, else the store.
  // Both expose the same fields/handlers (preset/monthYM/from/to + setters).
  const periodCtl: PeriodController = controlledPeriod ? period : f;
  const additionalRef = useRef<HTMLDivElement>(null);
  const [additionalOpen, setAdditionalOpen] = useState(false);

  // Archived (closed) account titles from the Zenmoney cache — used to sort the
  // archived accounts to the bottom of the filter and group them under a divider.
  const [archivedAccounts, setArchivedAccounts] = useState<Set<string>>(new Set());
  /** Название счёта → его вид («Карта», «Депозит», …). Пусто в режиме CSV: там
   *  метаданных счетов нет, и группировать нечем. */
  const [accountKinds, setAccountKinds] = useState<Map<string, string>>(new Map());
  /** Долговые счета: их в фильтре можно раскрыть по контрагентам. */
  const [debtAccounts, setDebtAccounts] = useState<Set<string>>(new Set());
  /** Название категории → расходная она или доходная, по справочнику Дзен-мани.
   *  Пусто в режиме CSV — тогда тип выводим из самих операций. */
  const [tagKinds, setTagKinds] = useState<Map<string, "expense" | "income" | "both">>(
    new Map()
  );

  useEffect(() => {
    let cancelled = false;
    void getCategoryTagsFromCache().then((tags) => {
      if (cancelled || !tags) return;
      const m = new Map<string, "expense" | "income" | "both">();
      for (const t of tags) {
        if (t.parent) continue; // тип задаёт корневая категория
        m.set(
          t.title,
          t.showOutcome && t.showIncome
            ? "both"
            : t.showIncome
              ? "income"
              : "expense"
        );
      }
      setTagKinds(m);
    });
    return () => {
      cancelled = true;
    };
  }, [transactions]);
  // Off-balance account titles → the filter store, so `applyFilters` can honour
  // the «исключить внебалансовые» option (which needs account metadata the pure
  // filter can't see). Loaded here since GlobalFilters renders on every page.
  const offBalanceAccounts = f.offBalanceAccounts;
  const setOffBalanceAccounts = f.setOffBalanceAccounts;
  useEffect(() => {
    let cancelled = false;
    getLiveAccountsFromCache().then((live) => {
      if (cancelled || !live) return;
      setArchivedAccounts(new Set(live.filter((a) => a.archive).map((a) => a.title)));
      setAccountKinds(
        new Map(live.map((a) => [a.title, accountKindLabel(a.type, a.savings)]))
      );
      setDebtAccounts(new Set(live.filter((a) => DEBT_TYPES.has(a.type)).map((a) => a.title)));
      setOffBalanceAccounts(
        new Set(live.filter((a) => !a.archive && !a.inBalance).map((a) => a.title))
      );
    });
    return () => {
      cancelled = true;
    };
  }, [transactions, setOffBalanceAccounts]);

  // Список счетов — операции ПЛЮС справочник Дзен-мани: счёт без операций в
  // загруженных данных на странице «Счета» есть, и в фильтре он тоже должен
  // быть (issue #67). `accountKinds` знает все счета справочника и пуст в
  // режиме CSV — там остаются одни операции.
  const accounts = useMemo(() => {
    const base = accountOptions(
      transactions.map((t) => t.account),
      accountKinds.keys(),
      { archived: archivedAccounts, kinds: accountKinds }
    );
    if (debtAccounts.size === 0) return base;
    // Долговой счёт в Дзен-мани ОДИН на все долги, и фильтр по нему отвечает
    // «все сразу». Поэтому контрагенты идут ВЛОЖЕННЫМИ прямо под своим счётом —
    // теми же именами, что и в разбивке на странице «Счета».
    return withDebtCounterparties(base, debtAccounts, transactions);
  }, [transactions, archivedAccounts, accountKinds, debtAccounts]);

  /** Заголовок группы для пикера счетов: архивные идут под своим разделителем,
   *  который рисует сам MultiSelect, поэтому им группу не назначаем. */
  const accountGroup = useCallback(
    (title: string) => {
      // Контрагент живёт в группе своего счёта: он его ветка, а не отдельный
      // раздел — иначе между счётом и его же разбивкой встал бы заголовок.
      const debt = parseDebtKey(title);
      const key = debt ? debt.account : title;
      return archivedAccounts.has(key) ? null : (accountKinds.get(key) ?? null);
    },
    [archivedAccounts, accountKinds]
  );

  /** Подпись варианта: у пары «счёт → контрагент» показываем человека. */
  const accountLabel = useCallback(
    (value: string) => parseDebtKey(value)?.payee ?? value,
    []
  );

  // Parent categories each with their observed sub-categories — for the cascade
  // category filter (parent on the left, subs on the right).
  const categoryNodes = useMemo(() => {
    const map = new Map<
      string,
      { subs: Set<string>; hasBare: boolean; seenIncome: boolean; seenExpense: boolean }
    >();
    // Сначала — плоский список листьев: основная категория каждой операции и
    // её вторые (#69). «Отпуск», стоящий всегда вторым, иначе в фильтре не
    // появлялся бы вовсе.
    const leaves: [Transaction["kind"], string, string | null][] = [];
    for (const t of transactions) {
      if (!t.category) continue;
      leaves.push([t.kind, t.category, t.subcategory]);
      for (const full of t.extraCategories ?? []) {
        const [category, ...rest] = full.split(/\s*\/\s*/);
        if (category) leaves.push([t.kind, category, rest.join(" / ") || null]);
      }
    }
    for (const [kind, category, subcategory] of leaves) {
      let e = map.get(category);
      if (!e) {
        e = { subs: new Set<string>(), hasBare: false, seenIncome: false, seenExpense: false };
        map.set(category, e);
      }
      // A transaction tagged with just the parent (no sub) is "bare" — a
      // distinct leaf from any «Category / Subcategory».
      if (subcategory) e.subs.add(subcategory);
      else e.hasBare = true;
      if (kind === "income") e.seenIncome = true;
      else if (kind === "expense" || kind === "refund") e.seenExpense = true;
    }
    // Тип берём из справочника Дзен-мани, а если его нет (режим CSV) — выводим
    // из самих операций: категория, встреченная только в доходах, доходная.
    const kindOf = (name: string, e: { seenIncome: boolean; seenExpense: boolean }) => {
      const fromTags = tagKinds.get(name);
      if (fromTags) return fromTags;
      if (e.seenIncome && e.seenExpense) return "both" as const;
      if (e.seenIncome) return "income" as const;
      if (e.seenExpense) return "expense" as const;
      return undefined;
    };
    // Доходных категорий обычно единицы, расходных — десятки, поэтому короткий
    // список идёт первым. Смешанные («и расход, и доход») — в хвост: их мало и
    // они не то, что ищут в первую очередь.
    const ORDER = { income: 0, expense: 1, both: 2 } as const;
    const real = [...map.entries()]
      .filter(([name]) => name !== NO_CATEGORY)
      .map(([name, e]) => ({
        name,
        hasBare: e.hasBare,
        kind: kindOf(name, e),
        subs: [...e.subs].sort((a, b) => a.localeCompare(b, "ru")),
      }))
      .sort(
        (a, b) =>
          (a.kind ? ORDER[a.kind] : 3) - (b.kind ? ORDER[b.kind] : 3) ||
          a.name.localeCompare(b.name, "ru")
      );
    // Наверх и без заголовка группы — «Без категории» и «Корректировка».
    // Первая всегда под рукой: по ней ищут операции, которым забыли категорию.
    // Вторая формально «и расход, и доход» и заводила бы себе отдельную группу
    // из одной строки — а по смыслу это служебная запись, а не статья бюджета.
    const pinnedNames = new Set([NO_CATEGORY, ...PINNED_CATEGORIES]);
    const pinned = real.filter((n) => pinnedNames.has(n.name)).map((n) => ({
      ...n,
      // Тип убираем намеренно: без него строка не получает заголовок группы.
      kind: undefined,
    }));
    return [
      { name: NO_CATEGORY, hasBare: true, subs: [] },
      ...pinned,
      ...real.filter((n) => !pinnedNames.has(n.name)),
    ];
  }, [transactions, tagKinds]);

  // Люди на аккаунте (#92). Считаем по самим операциям, а не по списку
  // аккаунта: на общем аккаунте человек мог не завести ни одной операции, и
  // пустая строка в фильтре только мешала бы. На личном список выйдет из
  // одного человека — тогда фильтр не показываем вовсе, выбирать не из кого.
  const memberIds = useMemo(() => membersInData(transactions), [transactions]);
  // «Общие» — отдельным пунктом: операция на общем счёте не принадлежит
  // никому, и выбрасывать её из выбора нельзя. Пункт добавляем только если
  // общие счета в данных есть.
  const userOptions = useMemo(() => {
    const out = memberIds.map(String);
    if (hasSharedItems(transactions)) out.push(MEMBER_SHARED);
    return out;
  }, [memberIds, transactions]);
  const userAliases = useMembersStore((s) => s.aliases);
  const [zenUserList, setZenUserList] = useState<ZenUserOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    getZenUsersFromCache().then((list) => {
      if (!cancelled && list) setZenUserList(list);
    });
    return () => {
      cancelled = true;
    };
  }, [transactions]);

  const currencies = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) if (t.currency) set.add(t.currency);
    return Array.from(set).sort();
  }, [transactions]);

  const dataRange = useMemo(() => {
    let min = "";
    let max = "";
    for (const t of transactions) {
      if (!min || t.date < min) min = t.date;
      if (!max || t.date > max) max = t.date;
    }
    return {
      minYM: min.slice(0, 7) || "",
      maxYM: max.slice(0, 7) || "",
      // Крайние даты целиком: от последней отсчитываются скользящие пресеты, а
      // обе вместе — это и есть отрезок «Всё».
      minDate: min || null,
      maxDate: max || null,
    };
  }, [transactions]);

  // Год якорится тем же `monthYM`, поэтому пикеру он подходит как есть.
  const anchored = periodCtl.preset === "month" || periodCtl.preset === "year";
  /** Какой месяц человек выбирал последним — им и подписана кнопка. */
  const monthKind = useDisplayStore((st) => st.monthKind);

  /**
   * Залита та зона контрола, которая задаёт период, и ровно одна: отрезок — сам
   * по себе, только когда даты выставлены руками. Отчётный месяц задаёт
   * название (оно и светится), а даты у него — производные.
   */
  const rangeActive = periodCtl.preset === "custom";
  /** Название задаёт период: отчётный месяц, календарный месяц или год. */
  const monthAnchored = anchored || periodCtl.preset === "period";

  const currentMonthYM =
    anchored && periodCtl.monthYM ? periodCtl.monthYM : dataRange.maxYM;

  // Отчётный месяц не с 1-го числа: подпись «Август» идёт по 27 сентября, и
  // без дат её читают неверно. Даты — подсказкой к кнопке месяца.
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const monthHint = useMemo(() => {
    if (monthStartDay === 1 || !anchored || periodCtl.preset === "year" || !currentMonthYM)
      return undefined;
    const r = periodRange(currentMonthYM, monthStartDay);
    return formatDate(r.from, "full") + " — " + formatDate(r.to, "full");
  }, [monthStartDay, anchored, periodCtl.preset, currentMonthYM]);

  /**
   * Кнопки пресетов. «Месяц», «Год» и «Период» задают период соседними
   * контролами, поэтому нажатие на них не просто ставит пресет:
   * - «Месяц» и «Год» якорятся на том, что сейчас показано;
   * - «Период» подставляет действующие границы, чтобы данные под руками не
   *   прыгнули: человек переходит к своим датам, чтобы их поправить, а не
   *   чтобы внезапно увидеть всю историю.
   */
  const choosePreset = (next: DatePreset) => {
    if (next === "month") periodCtl.setMonth(currentMonthYM || defaultMonthYM);
    else if (next === "year") periodCtl.setYear(Number((currentMonthYM || defaultMonthYM).slice(0, 4)));
    // «Период» — это отчётный месяц; свои даты появляются, только если их
    // поправили руками, и кнопка при этом остаётся той же.
    else if (next === "period") periodCtl.setPeriodMonth(currentMonthYM || defaultMonthYM);
    else periodCtl.setPreset(next);
  };

  /**
   * Кнопка месяца: двух кнопок рядом ряд не выдерживал — «Календарный месяц» и
   * «Отчётный месяц» словами длинны, а сокращать до значков значит заставлять
   * угадывать. Одна кнопка показывает ВЫБРАННЫЙ вид (он помнится и после
   * «30 дней»), остальные — за стрелкой.
   */
  const monthOption: SegmentedOption<DatePreset> = {
    value: monthKind,
    label: monthKind === "month" ? "Календарный месяц" : "Отчётный месяц",
    menu: [
      {
        value: "period",
        label: "Отчётный месяц",
        title:
          "Ваш отчётный месяц — тот же отрезок, что считают главная, бюджет и Дзен-мани. Даты можно поправить",
      },
      {
        value: "month",
        label: "Календарный месяц",
        title: "С первого числа по последнее, каким бы ни был ваш первый день",
      },
    ],
  };

  // Сохранённый вид мог быть снят со «С начала года» — кнопки для него в ряду
  // больше нет, но пока он действует, показываем её, иначе подсвечивать нечего.
  // Кнопка месяца встаёт после скользящих окон, перед «Годом».
  const withMonth: SegmentedOption<DatePreset>[] = [
    ...PRESETS.slice(0, 4),
    monthOption,
    ...PRESETS.slice(4),
  ];
  const presetOptions =
    periodCtl.preset === "ytd"
      ? [...withMonth, { value: "ytd" as DatePreset, label: "С начала года" }]
      : withMonth;
  /**
   * Свои даты не светят ни одной кнопкой ряда: отрезок «4 сен. 2025 — 18 сен.
   * 2026» — это не «Отчётный месяц», и подсвеченная кнопка врала про период.
   * Показывает его сама дорожка дат — они и горят акцентом.
   *
   * Пока кнопка называлась «Период», подсветка была уместна: свои даты — её
   * же состояние. С переименованием в «Отчётный месяц» это перестало быть
   * правдой.
   */
  const presetValue: DatePreset = periodCtl.preset;

  /**
   * Что показывать в дорожке дат. Свои даты — как есть, у остальных пресетов —
   * границы, которые они дают на самом деле: «Всё» это вся история, «30 дней»
   * — конкретные тридцать. Пустые «Начало — Конец» говорили о периоде ровно
   * ничего, хотя период всегда чем-то ограничен.
   */
  const shownRange = useMemo(() => {
    if (periodCtl.preset === "custom") return { from: periodCtl.from, to: periodCtl.to };
    // «Период» без правки — границы отчётного месяца, как их считает сервис.
    const r = presetToRange(
      periodCtl.preset,
      dataRange.maxDate,
      periodCtl.monthYM,
      monthStartDay
    );
    return {
      from: r.from ?? dataRange.minDate,
      to: r.to ?? dataRange.maxDate,
    };
  }, [
    periodCtl.preset,
    periodCtl.from,
    periodCtl.to,
    periodCtl.monthYM,
    dataRange.maxDate,
    dataRange.minDate,
    monthStartDay,
  ]);

  // Default preset is now "current month"; treat anything else as user-set.
  // Месяц по умолчанию — ОТЧЁТНЫЙ, как его ставит сам стор фильтров: считая его
  // календарно, мы с первым днём месяца 28-го всегда видели «фильтры заданы» и
  // держали «Сбросить» активной на чистых фильтрах.
  const defaultMonthYM = currentPeriod(monthStartDay);
  const hasExtra =
    f.excludeTransfers ||
    f.minAmount != null ||
    f.maxAmount != null ||
    f.types.size > 0 ||
    f.onlyUncategorized ||
    f.hideZero ||
    f.onlyWithComment ||
    f.onlyNew ||
    f.excludeOffBalance;
  const extraCount =
    (f.excludeTransfers ? 1 : 0) +
    (f.minAmount != null || f.maxAmount != null ? 1 : 0) +
    (f.types.size > 0 ? 1 : 0) +
    (f.onlyUncategorized ? 1 : 0) +
    (f.hideZero ? 1 : 0) +
    (f.onlyWithComment ? 1 : 0) +
    (f.onlyNew ? 1 : 0) +
    (f.excludeOffBalance ? 1 : 0);
  const hasFilters =
    f.accounts.size > 0 ||
    f.categories.size > 0 ||
    f.currencies.size > 0 ||
    f.users.size > 0 ||
    f.search.length > 0 ||
    hasExtra ||
    !(f.preset === "period" && f.monthYM === defaultMonthYM);

  // Где рисовать панель, решает настройка «Панель фильтров» (Оформление):
  // «По кнопке» — уходим порталом под шапку (`FiltersDock`), «На странице» —
  // остаёмся первым блоком страницы, как было раньше. Кнопка в шапке активна,
  // пока смонтирована хоть одна панель в режиме кнопки, а точка на ней — пока
  // есть что сбросить.
  const hasData = transactions.length > 0;
  const docked = useDisplayStore((s) => s.filtersMode) === "button";
  const registerDock = useFiltersDockStore((s) => s.register);
  const setDockActive = useFiltersDockStore((s) => s.setActive);
  const dockEl = useFiltersDockStore((s) => s.dockEl);
  useEffect(
    () => (hasData && docked ? registerDock() : undefined),
    [hasData, docked, registerDock]
  );
  useEffect(() => {
    if (hasData && docked) setDockActive(hasFilters);
  }, [hasData, docked, hasFilters, setDockActive]);

  if (!hasData) return null;
  if (docked && !dockEl) return null;

  const panel = (
    <div className={docked ? undefined : "mb-4 md:mb-6"}>
      <div
        className={clsx(
          // В режиме кнопки панель — второй ярус шапки: та же стеклянная
          // подложка, её поля, черта снизу, никаких скруглений и тени. На
          // странице — обычная карточка с двойным кантом.
          docked
            ? "glass border-b border-border px-4 md:px-6 py-3"
            : "card-tray p-3 md:card-pad md:p-4",
          // `inert` снимает и клики, и обход с клавиатуры, и внимание читалок —
          // одним атрибутом, без перебора всех контролов внутри.
          dimmed && "opacity-45 grayscale select-none"
        )}
        inert={dimmed || undefined}
        aria-disabled={dimmed || undefined}
      >
      <div className="flex flex-wrap items-center gap-2">
        {/* ── Row 1: saved filter · «Дополнительно» │ period │ reset ── */}
        {/* Обёртка НЕ инертна — на ней подсказка, почему фильтры погашены;
            инертен внутренний слой. Тот же приём, что у дат ниже. */}
        {/* На телефоне (`max-sm`) панель раскладывается иначе, иначе она шире
            экрана — 701 пиксель вместо 375: первой строкой сохранённый фильтр,
            «Дополнительно» и сброс (порядок — через `order`); ниже дорожка
            периодов, листающаяся внутри себя; месяц; даты; счета и категории
            по два в строку; поиск. От `sm` и шире — всё как было. */}
        <div
          className={clsx(
            "flex items-center gap-2",
            // `basis-0`, чтобы делить строку со сбросом; `relative` — для меню
            // «Дополнительно», которое на телефоне открывается во всю эту ширину.
            "max-sm:-order-2 max-sm:basis-0 max-sm:flex-1 max-sm:min-w-0 max-sm:relative",
            !showDataFilters && "opacity-45"
          )}
          title={!showDataFilters ? dataFiltersHint : undefined}
          aria-disabled={!showDataFilters || undefined}
        >
        <div
          className={clsx("contents", !showDataFilters && "pointer-events-none")}
          inert={!showDataFilters}
        >
        <FiltersMenu />

        {/* «Дополнительно» — right next to the filter button */}
        <div ref={additionalRef} className="relative max-sm:static max-sm:flex-1 max-sm:min-w-0">
          <button
            onClick={() => setAdditionalOpen((o) => !o)}
            className={clsx(
              "btn-ghost text-[12.5px] leading-4 w-52 max-sm:w-full",
              hasExtra && "border-accent text-accent"
            )}
            title="Дополнительные фильтры"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 shrink-0 text-muted" />
            <span className="flex-1 min-w-0 text-left truncate">Дополнительно</span>
            {extraCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-accent-fg text-[11px] font-medium leading-none shrink-0">
                {extraCount}
              </span>
            )}
            <ChevronDown className="w-3.5 h-3.5 opacity-60 shrink-0" />
          </button>
          {/* Общим `Popover` в портале на body: панель фильтров живёт внутри
              шапки, у которой размытие фона, а там `fixed` считается от самой
              шапки — подложка «клик мимо» накрыла бы только её. Портал заодно
              сам уводит меню в экран, если кнопка у правого края. */}
          <Popover
            open={additionalOpen}
            anchorRef={additionalRef}
            onClose={() => setAdditionalOpen(false)}
            className="w-72 card p-2 space-y-3 max-h-[70vh] overflow-auto"
          >
            <>
                <div>
                  <div className="caps-label mb-1.5">Тип операции</div>
                  {/* Сеткой 2×2, а не строкой: четвёртой кнопке в ряд уже не
                      хватало ширины панели, и подписи начинали обрезаться. */}
                  <div className="grid grid-cols-2 gap-1">
                    {OP_TYPES.map((t) => (
                      <button
                        key={t.value}
                        onClick={() => f.toggleType(t.value)}
                        title={t.hint}
                        className={clsx(
                          "chip chip-sm justify-center",
                          f.types.has(t.value) && "chip-on"
                        )}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="caps-label mb-1.5">
                    Сумма, {currencySymbol(base)}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder="От"
                      value={f.minAmount ?? ""}
                      onChange={(e) =>
                        f.setAmountRange(e.target.value === "" ? null : Number(e.target.value), f.maxAmount)
                      }
                      className="input text-xs flex-1 min-w-0"
                    />
                    <span className="text-muted text-xs">—</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder="До"
                      value={f.maxAmount ?? ""}
                      onChange={(e) =>
                        f.setAmountRange(f.minAmount, e.target.value === "" ? null : Number(e.target.value))
                      }
                      className="input text-xs flex-1 min-w-0"
                    />
                  </div>
                </div>

                <div className="space-y-0.5 pt-1 border-t border-border">
                  {[
                    { label: "Без переводов между счетами", checked: f.excludeTransfers, on: f.setExcludeTransfers },
                    { label: "Только без категории", checked: f.onlyUncategorized, on: f.setOnlyUncategorized },
                    { label: "Скрыть нулевые операции", checked: f.hideZero, on: f.setHideZero },
                    { label: "Только с комментарием", checked: f.onlyWithComment, on: f.setOnlyWithComment },
                    { label: "Только новые", checked: f.onlyNew, on: f.setOnlyNew },
                    // Only offered when the user actually HAS off-balance accounts
                    // (savings/brokerage) — otherwise the option would be a no-op.
                    ...(offBalanceAccounts.size > 0
                      ? [
                          {
                            label: "Без внебалансовых счетов",
                            checked: f.excludeOffBalance,
                            on: f.setExcludeOffBalance,
                          },
                        ]
                      : []),
                  ].map((row) => (
                    <label
                      key={row.label}
                      className="flex items-center justify-between gap-2 text-xs px-1.5 py-1.5 rounded hover:bg-panel2 cursor-pointer"
                    >
                      <span>{row.label}</span>
                      <Checkbox
                        checked={row.checked}
                        onChange={(on) => row.on(on)}
                        label="Включить фильтр"
                        className="shrink-0"
                      />
                    </label>
                  ))}
                </div>
            </>
          </Popover>
        </div>
        </div>
        </div>

        {
          <>
            {/* Разделителя перед периодом нет: «Дополнительно» и пресеты и так
                разной формы — пилюля с подписью против сегментов, — а лишняя
                черта дробила ряд на куски там, где граница видна сама. Тот, что
                ПОСЛЕ дат, оставлен: он отделяет сброс, а сброс относится ко
                всей панели, а не к периоду. */}
            {/* Обёртка НЕ инертна: на ней висит подсказка, объясняющая, почему
                даты погашены. Инертен только внутренний слой — он убирает
                контролы и из мыши, и из обхода с клавиатуры, иначе по ним можно
                было бы протабиться и нажать. Событие наведения при этом
                проходит наверх, к обёртке, и подсказка показывается. */}
            <div
              className={clsx(
                // Переносить разрешено ВСЕГДА: без этого на ширинах чуть шире
                // порога блоки не переносились, а вылезали за край — кнопка
                // сброса наезжала на дорожку дат.
                //
                // `min-w-fit` — чтобы блок не сжимался уже своего содержимого:
                // с фиксированным минимумом в 220 пикселей он «соглашался» на
                // ширину, в которую дорожки не влезали, и те лезли на соседей.
                "flex flex-wrap items-center gap-2 flex-1 min-w-fit",
                // Ниже `xl` период — своей строкой, а месяцу с датами разрешено
                // уйти под пресеты. Иначе блок вставал рядом с «Дополнительно»
                // шириной в 234 пикселя, пресеты вылезали за экран, а поля дат
                // сжимались до 26 пикселей — вводить в них было нечего. Порог
                // подняли до своего порога 1400, когда пресетов стало восемь, а даты собрались
                // в дорожку со стрелками: на 1024 ряд перестал помещаться.
                //
                // `order-1` уводит период в конец ряда: иначе на своей строке он
                // утаскивал за собой кнопку сброса, и та висела в пустой строке
                // одна, вместе с осиротевшим разделителем.
                "max-filters:flex-wrap max-filters:basis-full max-filters:order-1 max-sm:min-w-0",
                !showDateRange && "opacity-45"
              )}
              title={!showDateRange ? dateRangeHint : undefined}
              aria-disabled={!showDateRange || undefined}
            >
            <div
              className={clsx("contents", !showDateRange && "pointer-events-none")}
              inert={!showDateRange}
            >
            <Segmented
              tight
              label="Период"
              value={presetValue}
              onChange={choosePreset}
              className="shrink-0"
              options={presetOptions}
            />

            {/* Период — ОДИН контрол: название месяца, его даты, стрелки и
                возврат к текущему. Двумя дорожками он ломался на каждой ширине
                по-своему — то наезжали друг на друга, то вставали лесенкой, —
                а один блок либо помещается, либо переносится целиком. Сброс
                идёт следом и держится его. */}
            <div className="flex items-center gap-2 flex-1 min-w-fit max-lg:basis-full max-sm:min-w-0">
              <PeriodPicker
                monthYM={currentMonthYM}
                minYM={dataRange.minYM}
                maxYM={dataRange.maxYM}
                mode={periodCtl.preset === "year" ? "year" : "month"}
                monthActive={monthAnchored}
                rangeActive={rangeActive}
                stepsByWindow={periodCtl.preset === "custom"}
                from={shownRange.from}
                to={shownRange.to}
                monthHint={monthHint}
                onSelectMonth={(ym) => periodCtl.setMonth(ym)}
                onSelectYear={(y) => periodCtl.setYear(y)}
                onStep={(dir) => periodCtl.stepPeriod(dir, dataRange.maxYM)}
                onRangeChange={(from, to) => periodCtl.setRange(from, to)}
                onCurrent={() => periodCtl.setPeriodMonth(defaultMonthYM)}
                atCurrent={periodCtl.preset === "period" && periodCtl.monthYM === defaultMonthYM}
              />
              <ResetButton
                onReset={f.reset}
                disabled={!hasFilters || !showDataFilters}
                hint={!showDataFilters ? dataFiltersHint : hasFilters ? "Сбросить все фильтры" : "Фильтры не заданы"}
              />
            </div>

            </div>
            </div>
          </>
        }

        {/* Break → row 2 with the data controls, filling the full width. */}
        <div className="basis-full h-0 max-filters:order-2" />

        <div
          className={clsx(
            // Ниже `xl` период уходит в конец первой группы (`order-1`), поэтому
            // строке данных нужен свой порядок: иначе счета с категориями
            // вставали ВЫШЕ периода, хотя период — главное в этом ряду.
            "basis-full flex flex-wrap items-center gap-2 max-filters:order-3",
            !showDataFilters && "opacity-45"
          )}
          title={!showDataFilters ? dataFiltersHint : undefined}
          aria-disabled={!showDataFilters || undefined}
        >
        <div
          className={clsx("contents", !showDataFilters && "pointer-events-none")}
          inert={!showDataFilters}
        >
        <MultiSelect
          className={clsx("w-52", PICKER_PHONE)}
          icon={Wallet}
          label="Счета"
          options={accounts}
          selected={f.accounts}
          onChange={(s) => f.setSet("accounts", s)}
          renderIcon={(name) =>
            parseDebtKey(name) ? (
              <Users className="w-[18px] h-[18px] text-muted" />
            ) : (
              <AccountLogo title={name} size={18} />
            )
          }
          labelOf={accountLabel}
          nestedOf={(name) => parseDebtKey(name) !== null}
          nestedUnitForms={["контрагент", "контрагента", "контрагентов"]}
          unitForms={["счёт", "счёта", "счетов"]}
          searchPlaceholder="Поиск счёта"
          archivedSet={archivedAccounts}
          groupOf={accountGroup}
        />

        <CategoryFilterPicker
          className={clsx("w-52", PICKER_PHONE)}
          icon={PieChart}
          nodes={categoryNodes}
          selected={f.categories}
          onChange={(s) => f.setSet("categories", s)}
        />

        {currencies.length > 1 && (
          <MultiSelect
            // Ширина подобрана так, чтобы пара «Валюта + Участники» кончалась
            // ровно там же, где ряд пресетов периода сверху: 174 + 8 (зазор) +
            // 208 = 390, а 390 — это ширина ряда «30 дней … Всё». Оба ряда
            // начинаются с одной точки (перед ними по два контрола шириной
            // 13rem), поэтому совпадают и правые края. Меняются подписи
            // пресетов — придётся пересчитать; других способов связать ширины
            // из разных строк у CSS нет.
            //
            // МЕНЮ по кнопке равнять нельзя: при `menuMinWidth={0}` оно
            // повторяло её ширину, и шапка «4 валюты · Выбрать все» ломалась на
            // две строки. Поэтому кнопке узко, а меню просторно.
            className={clsx("w-[174px]", PICKER_PHONE)}
            menuMinWidth={208}
            icon={Coins}
            label="Валюта"
            options={currencies}
            selected={f.currencies}
            onChange={(s) => f.setSet("currencies", s)}
            unitForms={["валюта", "валюты", "валют"]}
            renderIcon={(code) => {
              const flag = currencyFlagEmoji(code);
              return flag ? (
                <span className="text-base leading-none">{flag}</span>
              ) : (
                <Coins className="w-4 h-4 text-muted" />
              );
            }}
          />
        )}

        {userOptions.length > 1 && (
          <MultiSelect
            className={clsx("w-52", PICKER_PHONE)}
            menuMinWidth={0}
            icon={UsersRound}
            label="Участники"
            options={userOptions}
            selected={f.users}
            onChange={(s) => f.setSet("users", s)}
            labelOf={(id) =>
              id === MEMBER_SHARED ? "Общие счета" : userLabel(Number(id), zenUserList, userAliases)
            }
            unitForms={["участник", "участника", "участников"]}
            searchPlaceholder="Поиск участника"
            /* «Общие счета» — не человек, а строка «всё остальное»: с тем же
               значком, что у участников, она читалась как ещё один человек по
               имени «Общие счета». Значок из той же семьи, но с людьми во
               множественном числе. */
            renderIcon={(id) =>
              id === MEMBER_SHARED ? (
                <UsersRound className="w-[18px] h-[18px] text-muted" />
              ) : (
                <UserRound className="w-[18px] h-[18px] text-muted" />
              )
            }
          />
        )}

        <div
          className="relative flex-1 min-w-[220px]"
          title="Фильтр по получателю и комментарию — входит в сохранённый фильтр и влияет на все виджеты"
        >
          {/* Значок поля — такой же тихий, как у соседних кнопок: фиолетовый
              выбивался из ряда единственным цветным пятном. */}
          <Filter className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            value={f.search}
            onChange={(e) => f.setSearch(e.target.value)}
            placeholder="Фильтр: получатель, комментарий"
            /* Высота ступени 34, как у соседних кнопок и дорожек: с py-1.5
               поле выходило на 30 и просаживалось в ряду. */
            className="input pl-9 pr-9 text-[12.5px] leading-4 h-[34px] py-0"
          />
          {f.search && (
            <button
              onClick={() => f.setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        </div>
        </div>
      </div>
      </div>
      {/* Объяснения, почему часть фильтров погашена, здесь больше нет. Абзацем
          оно занимало три строки под панелью, значком — висело в стороне от
          того, что объясняет. Теперь оно стоит у самого переключателя раздела,
          который эти фильтры и гасит (см. «Счета»), а на самих погашенных
          контролах остаётся та же подсказка при наведении. */}
    </div>
  );

  return docked && dockEl ? createPortal(panel, dockEl) : panel;
}

/**
 * Сброс всех фильтров. Стоит в ряду дважды и показывается там, где не окажется
 * один: пока период держится в первой строке — в её конце, а когда он уезжает
 * на свою строку — рядом с поиском. Разметка одна, различаются только классы
 * видимости.
 */
function ResetButton({
  className,
  onReset,
  disabled,
  hint,
}: {
  className?: string;
  onReset: () => void;
  disabled: boolean;
  hint?: string;
}) {
  return (
    <button
      onClick={onReset}
      disabled={disabled}
      title={hint}
      aria-label="Сбросить все фильтры"
      className={clsx(
        "btn-ghost text-xs px-3 shrink-0 ml-auto disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-panel2",
        className
      )}
    >
      <FilterX className="w-4 h-4" />
    </button>
  );
}
