import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ComposedChart,
  Line,
  ReferenceLine,
  type TooltipContentProps,
} from "recharts";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import {
  Wallet,
  Landmark,
  ArrowLeftRight,
  List,
  Scale,
  Eye,
  EyeOff,
  PiggyBank,
  Layers,
  SlidersHorizontal,
  ArrowUpDown,
  ChevronDown,
  Check,
  ArrowUp,
  ArrowDown,
  Pencil,
  HelpCircle,
  LineChart as LineChartIcon,
  Settings2,
  Trash2,
  CheckCircle2,
  LayoutGrid,
  Table as TableIcon,
  Archive,
  Users,
} from "lucide-react";
import {
  debtPayeeKey,
  debtsByCounterparty,
  NO_COUNTERPARTY,
  type DebtCounterparty,
} from "../lib/debts";
import { useDataStore } from "../store/useDataStore";
import {
  useFiltersStore,
  applyFilters,
  presetToRange,
  FILTER_NONE,
} from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useDrillStore } from "../store/useDrillStore";
import { useCalibrationStore } from "../store/useCalibrationStore";
import { useSlicesStore, activeSlice } from "../store/useSlicesStore";
import { confirm } from "../store/useConfirmStore";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { getLiveAccountsFromCache } from "../store/useZenmoneyStore";
import { useAccountEditsStore } from "../store/useAccountEditsStore";
import {
  useAccountsViewStore,
  type AccountsSortBy,
  type AccountsSortDir,
  type AccountsGroupBy,
} from "../store/useAccountsViewStore";
import { useDraftsStore } from "../store/useDraftsStore";
import type { LiveAccount } from "../store/useZenmoneyStore";
import {
  balancesByAccount,
  computeKPI,
  dailyBalanceSeries,
  stackedBalanceByAccount,
  accountMonthlyDeltas,
  detectBalanceAnchors,
  cumulativeNetAt,
  lastTransactionDate,
} from "../lib/aggregations";
import { useNetWorthSeries } from "../hooks/useNetWorthSeries";
import {
  formatMoney,
  formatPct,
  formatNum,
  axisFractionDigits,
  formatDate,
  toNum,
  chartTooltipProps,
  chartGridStroke,
  chartAxisStroke,
  chartTotalStroke,
  niceStep,
} from "../lib/format";
import { ChartTooltipCard, TooltipFacts, type TooltipFact } from "../components/TooltipFacts";
import { EmptyState } from "../components/EmptyState";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";
import { Segmented } from "../components/Segmented";
import { InfoPopover } from "../components/InfoPopover";
import { capitalShare, mergeLiveByTitle, positiveBalanceTotal } from "../lib/accountOptions";
import { Stat } from "../components/Stat";
import { Sparkline } from "../components/Sparkline";
import { AccountLogo } from "../components/AccountLogo";
import { MultiSelect } from "../components/MultiSelect";
import { AccountEditModal } from "../components/AccountEditModal";
import { Popover } from "../components/Popover";
import { Tooltip as AppTooltip } from "../components/Tooltip";
import { DateField } from "../components/DateField";
import { ACCOUNT_KINDS, accountKindLabel, DEBT_TYPES } from "../lib/accountType";
import { accountOptions } from "../lib/accountOptions";
import { debtKey, parseDebtKey, withDebtCounterparties } from "../lib/debtFilter";
import { pluralRu } from "../lib/plural";

const STACK_COLORS = [
  "#22D3EE", "#A78BFA", "#F59E0B", "#10B981", "#EC4899",
  "#3B82F6", "#84CC16", "#F97316", "#14B8A6", "#6B7280",
];

/** Доля высоты стопки, которая отводится минусам, если сами они мельче. */
const NEG_ZONE = 0.1;

/** Цвет линии «Совокупного баланса» — и самой линии, и метки в подсказке. */
const NET_STROKE = "#22D3EE";
/** Цвет линии «Изменения по отбору» — там же. */
const FLOW_STROKE = "#A78BFA";

// Типы настроек показа переехали в свой стор вместе с самими настройками:
// страница их только читает. «Капитал» — остатки и их история, «Движение» —
// обороты за период; раньше и то и другое лежало вперемешку на одном полотне.
type SortBy = AccountsSortBy;
type SortDir = AccountsSortDir;
type GroupBy = AccountsGroupBy;

/** Направление по умолчанию при первом клике: у названий — от «А», у чисел —
 *  от большего. Иначе первый же клик по «Балансу» показывает самые бедные счета. */
const DEFAULT_DIR: Record<SortBy, SortDir> = {
  alpha: "asc",
  bank: "asc",
  type: "asc",
  balance: "desc",
  delta: "desc",
  income: "desc",
  expense: "desc",
  count: "desc",
};

/** Bucket for accounts with no bank attached — cash, manual accounts, and
 *  anything imported from CSV (where the bank is simply unknown to us). */


const NO_BANK = "Без банка";
/** Bucket for accounts whose type the local cache doesn't know (CSV imports). */
const NO_TYPE = "Без типа";

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "none", label: "Без группировки" },
  { value: "type", label: "По типу счёта" },
  { value: "bank", label: "По банку" },
];
const GROUP_LABEL: Record<GroupBy, string> = {
  none: "Без группировки",
  type: "По типу счёта",
  bank: "По банку",
};

/** Порядок для карточек. В таблице то же самое делают клики по её шапке,
 *  поэтому список здесь короткий — только то, что осмысленно без колонок. */
const CARD_SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "balance", label: "По сумме" },
  { value: "alpha", label: "По алфавиту" },
  { value: "bank", label: "По банку" },
];
const CARD_SORT_LABEL: Partial<Record<SortBy, string>> = {
  balance: "По сумме",
  alpha: "По алфавиту",
  bank: "По банку",
};

/**
 * Кнопка с выпадающим меню. Одна форма на все три меню шапки — иначе
 * «Признаки», «Группировка» и «Сортировка» разъедутся по виду и поведению,
 * хотя стоят в одной строке.
 */
function DropdownMenu({
  label,
  icon: Icon,
  active,
  badge,
  reserveBadge,
  minWidth,
  title,
  children,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  /** Число активных отборов — показывается кружком у подписи. */
  badge?: number;
  /** Держать место под кружок, даже когда его нет. */
  reserveBadge?: boolean;
  /** Ширина под самую длинную подпись — кнопка не должна расти при выборе. */
  minWidth?: string;
  title: string;
  children: (close: () => void) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        style={minWidth ? { minWidth } : undefined}
        className={`px-3 py-1.5 text-xs rounded-full border flex items-center gap-1.5 whitespace-nowrap transition-colors duration-200 ${
          active
            ? "bg-accent/10 border-accent/40 text-accent"
            : "bg-panel2 border-border text-muted hover:text-text"
        }`}
      >
        <Icon className="w-3.5 h-3.5 shrink-0" />
        {label}
        {/* Кружок со счётчиком занимает место всегда — иначе кнопка дёргается
            при первом же включённом признаке. */}
        {(badge != null || reserveBadge) && (
          <span
            className={`px-1.5 rounded-full text-[10px] leading-4 tabular-nums ${
              badge != null ? "bg-accent text-accent-fg" : "invisible"
            }`}
          >
            {badge ?? 0}
          </span>
        )}
        <ChevronDown className="w-3 h-3 opacity-60 ml-auto shrink-0" />
      </button>
      <Popover
        open={open}
        anchorRef={ref}
        onClose={close}
        align="left"
        className="rounded-lg border border-border bg-panel shadow-xl py-1 min-w-[200px]"
      >
        {children(close)}
      </Popover>
    </div>
  );
}

/**
 * Пометки счёта — «Вне баланса» и «Архив» одинаковыми чипами. Раньше первая
 * была цветным текстом, вторая — серым: два признака одного рода читались как
 * разные сущности. Чип отделяет пометку от названия сам по себе, без точки.
 */
function AccountMarks({
  offBalance,
  archive,
}: {
  offBalance: boolean;
  archive: boolean;
}) {
  if (!offBalance && !archive) return null;
  const chip =
    "text-[10px] leading-4 px-1.5 rounded-full border whitespace-nowrap shrink-0";
  return (
    <span className="flex items-center gap-1 shrink-0">
      {offBalance && (
        <span className={`${chip} border-accent2/40 text-accent2 bg-accent2/10`}>
          Вне баланса
        </span>
      )}
      {archive && (
        <span className={`${chip} border-border text-muted bg-panel2`}>Архив</span>
      )}
    </span>
  );
}

/** Пункт меню с галочкой — независимый признак, меню остаётся открытым. */
function CheckItem({
  checked,
  onChange,
  icon: Icon,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-panel2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="accent-accent shrink-0"
      />
      <Icon className="w-3.5 h-3.5 text-muted shrink-0" />
      <span className="whitespace-nowrap">{label}</span>
    </label>
  );
}

/**
 * Заголовок сортируемой колонки. Стрелка появляется только у активной —
 * шесть постоянных значков «можно сортировать» шумят сильнее, чем помогают.
 */
function SortTh({
  sortKey,
  align = "left",
  active,
  dir,
  onSort,
  children,
}: {
  sortKey: SortBy;
  align?: "left" | "right" | "center";
  active: SortBy;
  dir: SortDir;
  onSort: (key: SortBy) => void;
  children: ReactNode;
}) {
  const on = active === sortKey;
  const Arrow = dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      className={`table-th ${align === "right" ? "text-right" : align === "center" ? "text-center" : ""}`}
      aria-sort={on ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      {/* `uppercase` повторяется здесь не зря: браузер сбрасывает
          text-transform на кнопках, поэтому без него заголовок-кнопка
          выпадает из общего вида таблиц сервиса. */}
      <button
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-text ${
          align === "right" ? "flex-row-reverse" : ""
        } ${on ? "text-accent" : ""}`}
      >
        {children}
        {on && <Arrow className="w-3 h-3 shrink-0" />}
      </button>
    </th>
  );
}

/** Пункт меню с выбором одного варианта — меню закрывается после клика. */
function RadioItem({
  checked,
  onSelect,
  label,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
}) {
  return (
    <button
      role="menuitemradio"
      aria-checked={checked}
      onClick={onSelect}
      className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-panel2 ${
        checked ? "text-accent" : ""
      }`}
    >
      <Check className={`w-3.5 h-3.5 shrink-0 ${checked ? "" : "opacity-0"}`} />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

/** Отбор пройден? Пустое множество = «все», {FILTER_NONE} = «ничего». */
function passesFilter(selected: Set<string>, value: string): boolean {
  if (selected.size === 0) return true;
  if (selected.has(FILTER_NONE)) return false;
  return selected.has(value);
}

/**
 * Почему на «Капитале» половина отборов не работает.
 *
 * Один текст на два места: подсказка у кнопки раздела и подсказка при наведении
 * на сами погашенные контролы. Разъезжаться им нельзя — объясняют они одно и то
 * же правило.
 */
const CAPITAL_FILTERS_HINT =
  "На «Капитале» работает только период: остаток на дату складывается из всей истории до неё. Какие счета показать на графике — в его карточке. Отборы по счетам, категориям и суммам живут на вкладке «Движение».";

export function AccountsPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const rates = useDataStore((s) => s.rates);
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);

  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  // Настройки показа живут в сторе и переживают уход на другую страницу —
  // раньше они были `useState` и обнулялись при каждом возврате сюда.
  const prefs = useAccountsViewStore();
  const patchPrefs = useAccountsViewStore((s) => s.patch);
  const prefsLoaded = useAccountsViewStore((s) => s.loaded);
  const hydratePrefs = useAccountsViewStore((s) => s.hydrate);
  useEffect(() => {
    if (!prefsLoaded) void hydratePrefs();
  }, [prefsLoaded, hydratePrefs]);

  const tab = prefs.tab;
  const setTab = (next: typeof tab) => void patchPrefs({ tab: next });
  const view = prefs.chartView;
  const setView = (next: typeof view) => void patchPrefs({ chartView: next });
  const accountsView = prefs.listView;
  const hideArchived = prefs.hideArchived;
  const balanceScope = prefs.balanceScope;
  const onlySavings = prefs.onlySavings;
  const sortBy = prefs.sortBy;
  const sortDir = prefs.sortDir;
  const groupBy = prefs.groupBy;
  // Множества собираем из хранимых массивов: в IDB `Set` не кладётся, а вся
  // страница ниже работает именно множествами (соглашение MultiSelect —
  // пусто = «все», {FILTER_NONE} = «ничего»).
  const chartAccounts = useMemo(
    () => new Set(prefs.chartAccounts),
    [prefs.chartAccounts]
  );
  const setChartAccounts = (next: Set<string>) =>
    void patchPrefs({ chartAccounts: [...next] });
  const typeFilter = useMemo(() => new Set(prefs.typeFilter), [prefs.typeFilter]);
  const setTypeFilter = (next: Set<string>) =>
    void patchPrefs({ typeFilter: [...next] });
  const bankFilter = useMemo(() => new Set(prefs.bankFilter), [prefs.bankFilter]);
  const setBankFilter = (next: Set<string>) =>
    void patchPrefs({ bankFilter: [...next] });
  // Три состояния вместо двух галочек-антонимов: «в балансе» и «вне баланса»
  // взаимоисключающие, и одновременно включёнными они дали бы пустой список.
  const toggleBalanceScope = (v: "in" | "out") =>
    void patchPrefs({ balanceScope: balanceScope === v ? "all" : v });
  // Клик по колонке: та же — переворачиваем порядок, другая — берём её
  // естественное направление.
  const sortByColumn = (key: SortBy) => {
    if (key === sortBy) {
      void patchPrefs({ sortDir: sortDir === "asc" ? "desc" : "asc" });
    } else {
      void patchPrefs({ sortBy: key, sortDir: DEFAULT_DIR[key] });
    }
  };
  const pickSort = (key: SortBy) =>
    void patchPrefs({ sortBy: key, sortDir: DEFAULT_DIR[key] });
  const sortHead = { active: sortBy, dir: sortDir, onSort: sortByColumn };
  // Редактор счёта. Открывается по карандашу в «Действиях» и по двойному
  // клику по строке — как в справочниках.
  const accountEdits = useAccountEditsStore((s) => s.edits);
  const [editingAccount, setEditingAccount] = useState<LiveAccount | null>(null);
  const openAccountEditor = (id: string | null) => {
    // По id, а не по названию: одноимённых счетов в Дзен-мани сколько угодно,
    // и поиск по названию открывал редактор чужого счёта — правка ложилась на
    // другой идентификатор, а список не показывал изменений.
    if (!id) return;
    const live = (liveAccounts || []).find((a) => a.id === id);
    if (live) setEditingAccount(live);
  };

  // Real per-account balances (API mode only). CSV mode → null, we fall back
  // to the flow-derived delta and label it honestly.
  const [liveAccounts, setLiveAccounts] = useState<LiveAccount[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    getLiveAccountsFromCache().then((data) => {
      if (!cancelled) setLiveAccounts(data);
    });
    return () => {
      cancelled = true;
    };
  }, [transactions]);

  const showDrill = useDrillStore((s) => s.show);
  const calibration = useCalibrationStore((s) => s.calibration);
  const setCalibration = useCalibrationStore((s) => s.set);
  // Активный разрез: галочка «В аналитике» у счёта правит именно его (#14).
  const sliceList = useSlicesStore((s) => s.slices);
  const sliceActiveId = useSlicesStore((s) => s.activeId);
  const setSliceAccounts = useSlicesStore((s) => s.setAccounts);
  const currentSlice = activeSlice({ slices: sliceList, activeId: sliceActiveId });
  const sliceName = currentSlice.name;
  const sliceExcludedAccounts = useMemo(
    () => new Set(currentSlice.excludedAccounts),
    [currentSlice]
  );
  const toggleSliceAccount = (title: string) => {
    const next = new Set(sliceExcludedAccounts);
    if (next.has(title)) next.delete(title);
    else next.add(title);
    return setSliceAccounts(currentSlice.id, [...next]);
  };
  const clearCalibration = useCalibrationStore((s) => s.clear);
  const hydrateCalibration = useCalibrationStore((s) => s.hydrate);
  // API auto-calibrates on every sync — hide the manual UI when connected.
  const zenToken = useZenmoneyStore((s) => s.token);
  const zenHydrate = useZenmoneyStore((s) => s.hydrate);
  const zenLoaded = useZenmoneyStore((s) => s.loaded);
  useEffect(() => {
    if (!zenLoaded) zenHydrate();
  }, [zenLoaded, zenHydrate]);
  const calibLoaded = useCalibrationStore((s) => s.loaded);

  useEffect(() => {
    if (!calibLoaded) hydrateCalibration();
  }, [calibLoaded, hydrateCalibration]);

  const [calibOpen, setCalibOpen] = useState(false);
  const [calibDate, setCalibDate] = useState(calibration?.date || "");
  const [calibAmount, setCalibAmount] = useState(
    calibration ? String(calibration.amount) : ""
  );

  // Re-seed the editable calibration form when the stored calibration
  // changes (e.g. after hydrate or a reset elsewhere). Form inputs must
  // stay editable, so this mirror-into-local-state effect is correct.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setCalibDate(calibration?.date || "");
    setCalibAmount(calibration ? String(calibration.amount) : "");
  }, [calibration]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const filtered = useMemo(() => applyFilters(transactions, filters, monthStartDay), [transactions, filters, monthStartDay]);
  // Набора «операции под отбором» для остатков больше нет: остаток на дату
  // складывается из всей истории до неё, а отбор выбирает лишь окно показа.

  /** Вкладка «Капитал»: список показывает остатки, а не обороты за период. */
  const capitalView = tab === "capital";

  const accounts = useMemo(() => balancesByAccount(filtered), [filtered]);
  const accountsAll = useMemo(() => balancesByAccount(transactions), [transactions]);

  // Merge the flow-derived figures (delta / income / expense / count — these
  // respect the active filters) with the real current balance from the API
  // cache (when connected). `balanceBase` is null in CSV mode / for accounts
  // the cache doesn't know about — the UI then shows the delta instead.
  //
  // The row set is the UNION of (a) accounts with activity under the current
  // filters and (b) every real Zenmoney account that counts toward the
  // balance — so debts / credit cards / deposits with a balance but no
  // operations in the period still show up (their delta/income/expense are
  // just 0). Credit/debt accounts carry their native sign, so a liability
  // renders negative (red) and reduces the totals correctly.
  /** Пересчёт суммы в базовую валюту — нужен и таблице, и якорю графика. */
  const toBase = useCallback(
    (amt: number, cur: string) => (cur === base ? amt : amt * (rates.rates[cur] || 1)),
    [base, rates]
  );

  // Живые счета с наложенными неотправленными правками. Вынесено из мемо
  // строк таблицы, потому что якорь остатков для графика обязан строиться по
  // ВСЕМ счетам, а не по тем, что уцелели после отборов списка.
  const liveList = useMemo(() => {
    // Неотправленная правка накладывается на счёт сразу: пользователь должен
    // видеть результат до синхронизации. Название — исключение: по нему
    // сопоставляются операции, поэтому исходное остаётся ключом, а новое
    // показывается отдельным полем.
    return (liveAccounts ?? []).map((a) => {
      const e = accountEdits[a.id];
      if (!e) return a;
      // Баланс пересобираем по той же формуле, что и Дзен: сдвиг начального
      // остатка сразу виден в списке, иначе правка «баланса» ничего не меняет
      // на экране до синхронизации.
      const ops = a.balance - a.startBalance;
      const startBalance = e.startBalance ?? a.startBalance;
      return {
        ...a,
        balance: startBalance + ops,
        type: e.type ?? a.type,
        inBalance: e.inBalance ?? a.inBalance,
        savings: e.savings ?? a.savings,
        private: e.private ?? a.private,
        archive: e.archive ?? a.archive,
        creditLimit: e.creditLimit ?? a.creditLimit,
        startBalance,
        startDate: e.startDate !== undefined ? e.startDate : a.startDate,
      };
    });
  }, [liveAccounts, accountEdits]);

  /** Раскрытые долговые счета: разбивка по контрагентам под строкой счёта. */
  const [openDebts, setOpenDebts] = useState<Set<string>>(new Set());
  const toggleDebts = (account: string) =>
    setOpenDebts((prev) => {
      const next = new Set(prev);
      if (next.has(account)) next.delete(account);
      else next.add(account);
      return next;
    });

  /** Операции, по которым считаем долги: как и сама строка счёта — вся история
   *  на «Капитале» и отобранный период на «Движении». */
  const debtSource = capitalView ? transactions : filtered;

  /** Названия долговых счетов — по справочнику Дзен-мани. */
  const debtAccountTitles = useMemo(
    () => new Set(liveList.filter((a) => DEBT_TYPES.has(a.type)).map((a) => a.title)),
    [liveList]
  );

  /** Разбивка по контрагентам для каждого долгового счёта. */
  const debtsByAccount = useMemo(() => {
    const m = new Map<string, ReturnType<typeof debtsByCounterparty>>();
    for (const title of debtAccountTitles) {
      m.set(title, debtsByCounterparty(debtSource, new Set([title])));
    }
    return m;
  }, [debtAccountTitles, debtSource]);

  const accountRowsResult = useMemo(() => {
    // Одноимённые счета сводятся в одну строку со СЛОЖЕННЫМ остатком: у
    // Дзен-мани долговых счетов столько, сколько валют, и называются они все
    // «Долги». Карта по названию оставляла последний, и в списке стоял остаток
    // случайной валюты вместо суммы долгов (issue #89).
    const merged = mergeLiveByTitle(liveList, toBase);
    // На «Капитале» список строится по ВСЕЙ истории: остаток на счёте не
    // зависит от того, какие операции сейчас отобраны, и счёт не должен
    // пропадать из перечня только потому, что в выбранном периоде по нему не
    // было движения. На «Движении» наоборот — там показаны обороты за отбор.
    const source = capitalView ? accountsAll : accounts;
    const txByTitle = new Map(source.map((a) => [a.account, a]));

    // Список на этой странице — справочник счетов, поэтому внебалансовые счета
    // в нём есть ВСЕГДА, с пометкой «Вне баланса» и отдельным отбором. Раньше
    // они то появлялись, то нет: строка добавлялась, если у счёта были операции
    // в периоде, и молча пропадала, если операций не было. Глобальная настройка
    // «Счета вне баланса» продолжает управлять расчётами (совокупный баланс,
    // Главная), но прятать сами счета из их же списка ей незачем.
    const titles = new Set<string>();
    for (const a of source) titles.add(a.account);
    // Сколько живых счетов вообще не попало в список: нулевой остаток и ни
    // одной операции в окне фильтра. Нужно, чтобы подпись под итогом честно
    // говорила, что показано не всё.
    let dormant = 0;
    for (const [title, m] of merged) {
      const hasOps = txByTitle.has(title);
      // На «Движении» список отвечает на вопрос «что происходило», и счёт без
      // единой операции в периоде там лишний, даже если на нём лежат деньги:
      // строка из одних нулей ничего не рассказывает. На «Капитале» ровно
      // наоборот — есть остаток, значит счёт в перечне.
      if (!capitalView) {
        if (!hasOps) dormant++;
        continue;
      }
      // Archived (closed) accounts are kept but grouped below active ones
      // (see the sort), so the user can still review them without clutter up top.
      // Skip dormant zero-balance accounts with no activity — they'd be noise.
      // Спящим считается СВОДНЫЙ остаток: два счёта с плюсом и минусом,
      // гасящие друг друга, — это не спящая пара, а одна живая строка с нулём.
      if (Math.abs(m.base) <= 0.005 && !hasOps) {
        dormant += m.count;
        continue;
      }
      titles.add(title);
    }

    const rows = [...titles].map((title) => {
      const m = merged.get(title);
      const live = m?.lead;
      const tx = txByTitle.get(title);
      return {
        account: title,
        delta: tx?.balance ?? 0,
        income: tx?.income ?? 0,
        expense: tx?.expense ?? 0,
        count: tx?.count ?? 0,
        balanceBase: m ? m.base : null,
        // Родная сумма только у строки из одной валюты: у сведённых из разных
        // «родной» суммы не существует, и скобка с ней была бы враньём.
        nativeBalance: m?.native ? m.native.balance : null,
        nativeCurrency: m?.native ? m.native.currency : null,
        type: live?.type ?? "",
        archive: live?.archive ?? false,
        // Only treat as off-balance when the cache actually knows the account;
        // CSV/unknown accounts default to "in balance" (no badge).
        offBalance: live ? !live.inBalance : false,
        savings: live?.savings ?? false,
        /** Идентификатор счёта в Дзен-мани; null у строк, собранных из CSV. */
        id: live?.id ?? null,
        /** Вид счёта одной подписью — с учётом «накопительного». */
        kind: live ? accountKindLabel(live.type, live.savings) : "",
        /** Название с учётом неотправленной правки — только для показа. */
        displayTitle: (live && accountEdits[live.id]?.title) || title,
        /** Есть неотправленная правка — строка помечается в списке. */
        edited: !!(live && accountEdits[live.id]),
        // Null bank ≠ «no bank»: for a CSV account we simply don't know. Both
        // land in the same «Без банка» bucket, which is honest — we have no
        // second source to tell them apart.
        bank: live?.bank ?? null,
      };
    });
    // Active first, archived grouped below; within each group sort by real
    // balance when we have it, otherwise by the flow delta.
    rows.sort((x, y) => {
      if (x.archive !== y.archive) return x.archive ? 1 : -1;
      return (y.balanceBase ?? y.delta) - (x.balanceBase ?? x.delta);
    });
    return { rows, dormant };
  }, [accounts, accountsAll, capitalView, liveList, accountEdits, toBase]);

  /** Спящие счета, не попавшие в список вовсе (нулевой остаток и без операций). */
  const dormantCount = accountRowsResult.dormant;
  const accountRows = accountRowsResult.rows;
  type AccountRow = (typeof accountRows)[number];

  // True when at least one account carries a real (API) balance — drives the
  // headline ("Баланс" vs "Изменение") and the table's column labels.
  const hasRealBalances = accountRows.some((r) => r.balanceBase !== null);

  // Отборы предлагают только те значения, что реально есть у пользователя:
  // список из пяти типов, четыре из которых не встречаются, — это шум.
  const typeOptions = useMemo(() => {
    // Полный набор видов из Дзен-мани показываем ВСЕГДА, даже если счетов
    // такого вида сейчас нет: иначе непонятно, есть ли отбор вообще, и список
    // молча меняется от того, что завели новый счёт. Виды, которых нет в нашем
    // списке выбора (служебные «Долги», «Кошелёк»), добавляем по факту данных.
    const set = new Set(ACCOUNT_KINDS.map((k) => k.label));
    for (const r of accountRows) set.add(r.kind || NO_TYPE);
    const list = [...set].filter((t) => t !== NO_TYPE).sort((a, b) => a.localeCompare(b, "ru"));
    return set.has(NO_TYPE) ? [...list, NO_TYPE] : list;
  }, [accountRows]);
  const bankOptions = useMemo(() => {
    const set = new Set(accountRows.map((r) => r.bank ?? NO_BANK));
    // «Без банка» всегда последним — это не банк, а его отсутствие.
    const list = [...set].filter((b) => b !== NO_BANK).sort((a, b) => a.localeCompare(b, "ru"));
    return set.has(NO_BANK) ? [...list, NO_BANK] : list;
  }, [accountRows]);
  const hasBanks = bankOptions.some((b) => b !== NO_BANK);
  // Переключатель, который у конкретного пользователя ничего не меняет, — это
  // лишний элемент: показываем только когда есть что отбирать.
  // Счёт в валюте показывает вторую сумму в скобках — колонке нужно больше
  // места, но только тем, у кого такие счета есть.
  const hasForeignCurrency = accountRows.some(
    (r) => r.nativeCurrency != null && r.nativeCurrency !== base
  );
  // Признаки спрятаны в меню, поэтому включённые надо показать снаружи —
  // иначе непонятно, почему список короче ожидаемого.
  const effectiveScope = balanceScope;
  const effectiveSavings = onlySavings;
  const effectiveHideArchived = hideArchived;
  const flagsActive =
    (effectiveScope === "all" ? 0 : 1) +
    (effectiveSavings ? 1 : 0) +
    (effectiveHideArchived ? 1 : 0);

  /** Пояснение к колонкам. Раньше висело абзацем над списком и занимало место
   *  каждый раз, хотя нужно один раз при первом знакомстве. */
  const listHint = (
    <div className="space-y-1.5">
      {/* Подсказка называет ровно те колонки, что сейчас на экране: вкладки
          показывают разные наборы, и общий текст описывал половину не того. */}
      {capitalView ? (
        <>
          <div>
            {hasRealBalances
              ? "«Остаток» — текущая сумма на счёте из Дзен-мани."
              : "«Накоплено» — доход минус расход с начала истории: в CSV остатков счетов нет."}
          </div>
          <div>
            «Доля» — процент от суммы положительных остатков. У долгов доли нет.
          </div>
          <div>Клик по строке выбирает счёт для графика на вкладке «Движение».</div>
        </>
      ) : (
        <>
          <div>
            «Поступления» и «Списания» — доход и расход за период, без переводов
            между своими счетами.
          </div>
          <div>«Изменение» — поступления минус списания.</div>
          <div>
            Счета без операций за период в списке не показаны — их остатки
            смотрите на «Капитале».
          </div>
          <div>Клик по строке оставляет на графике только этот счёт.</div>
        </>
      )}
      <div>Кнопка со списком показывает операции счёта.</div>
      {/* Ни карандаша, ни пометок «Вне баланса» в CSV нет: править нечего и
          признак взять неоткуда — обещать их там нельзя. */}
      {hasRealBalances && (
        <>
          <div>
            Карандаш открывает редактор счёта — в таблице ещё и двойной клик по
            строке.
          </div>
          <div>
            Счета вне баланса всегда есть в списке, с пометкой. В совокупный
            баланс они входят только при включённой настройке «Счета вне
            баланса».
          </div>
        </>
      )}
    </div>
  );

  const visibleRows = useMemo(() => {
    const rows = accountRows.filter((r) => {
      if (effectiveHideArchived && r.archive) return false;
      if (effectiveScope === "in" && r.offBalance) return false;
      if (effectiveScope === "out" && !r.offBalance) return false;
      if (effectiveSavings && !r.savings) return false;
      if (!passesFilter(typeFilter, r.kind || NO_TYPE)) return false;
      if (!passesFilter(bankFilter, r.bank ?? NO_BANK)) return false;
      return true;
    });
    // Архивные всегда внизу — при любой сортировке. Закрытый счёт не должен
    // всплывать над рабочим только потому, что его название начинается на «А».
    const byArchive = (x: AccountRow, y: AccountRow) =>
      x.archive === y.archive ? 0 : x.archive ? 1 : -1;
    const headline = (r: AccountRow) => r.balanceBase ?? r.delta;
    const sign = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((x, y) => {
      const arch = byArchive(x, y);
      if (arch !== 0) return arch;
      let cmp = 0;
      // Столбца может не быть на этой вкладке — тогда сортировка по нему
      // читалась бы как случайный порядок. Откатываемся на сумму.
      const flowKeys = ["income", "expense", "delta", "count"];
      const key = capitalView && flowKeys.includes(sortBy) ? "balance" : sortBy;
      switch (key) {
        case "alpha":
          cmp = x.account.localeCompare(y.account, "ru");
          break;
        case "bank": {
          const bx = x.bank ?? "";
          const by = y.bank ?? "";
          // Счета без банка — в конец, а не в начало по пустой строке.
          if (!bx !== !by) return bx ? -1 : 1;
          cmp = bx.localeCompare(by, "ru");
          break;
        }
        case "type":
          cmp = (x.kind || NO_TYPE).localeCompare(y.kind || NO_TYPE, "ru");
          break;
        case "delta":
          cmp = x.delta - y.delta;
          break;
        case "income":
          cmp = x.income - y.income;
          break;
        case "expense":
          cmp = x.expense - y.expense;
          break;
        case "count":
          cmp = x.count - y.count;
          break;
        default:
          cmp = headline(x) - headline(y);
      }
      // Равные значения — вторым ключом сумма, потом название: иначе строки
      // прыгают между перерисовками при сортировке по колонке с нулями.
      if (cmp === 0) cmp = headline(x) - headline(y);
      if (cmp === 0) return x.account.localeCompare(y.account, "ru");
      return cmp * sign;
    });
  }, [
    accountRows,
    effectiveHideArchived,
    effectiveScope,
    effectiveSavings,
    typeFilter,
    bankFilter,
    sortBy,
    sortDir,
    capitalView,
  ]);

  /**
   * Итог по ТОМУ, ЧТО СЕЙЧАС ВИДНО в списке.
   *
   * KPI наверху считает совокупный баланс по всем счетам и отборы не знает,
   * а сумма до сих пор существовала только в заголовке группы. Отобрал
   * накопительные — и сколько на них всего, узнать было негде.
   *
   * Формула та же, что у заголовков групп: реальный остаток, а где его нет
   * (CSV) — изменение за период, иначе строка списка и итог считались бы
   * по-разному.
   */
  /**
   * Сколько счетов НЕ показано: спящие нули, которые в список не попадают
   * вовсе, плюс отсеянные отборами. Без этой цифры итог по списку и KPI
   * «Совокупный баланс» стоят рядом разными числами и выглядят как ошибка.
   */
  const hiddenCount = dormantCount + (accountRows.length - visibleRows.length);
  /**
   * Сколько счетов всего — знаменатель для «N из M» в шапке списка.
   *
   * Раньше здесь стояло число счетов, по которым ЕСТЬ операции, и у кого счетов
   * без движения больше, чем скрыто отборами, выходило «9 из 5». Настоящий
   * знаменатель — все известные счета: показанные, отсеянные отборами и спящие.
   */
  const totalAccounts = accountRows.length + dormantCount;
  /** Почему счёт вообще не попал в список — на вкладках причины разные. */
  const dormantReason = capitalView
    ? "с нулевым остатком и без операций"
    : "без операций за период";

  /**
   * Число, которым строка представлена в итогах и заголовках групп.
   *
   * На «Капитале» это остаток (в CSV, где остатков нет, — накопленное с нуля),
   * на «Движении» — изменение за отобранный период. Раньше формула была одна на
   * оба случая, и на вкладке про обороты в итоге стояли остатки.
   */
  const rowHeadline = useCallback(
    (r: AccountRow) => (capitalView ? r.balanceBase ?? r.delta : r.delta),
    [capitalView]
  );
  const visibleTotal = useMemo(
    () => visibleRows.reduce((sum, r) => sum + rowHeadline(r), 0),
    [visibleRows, rowHeadline]
  );
  /** Знаменатель для доли в капитале — только положительные остатки. */
  const positiveTotal = useMemo(
    () => positiveBalanceTotal(visibleRows.map((r) => r.balanceBase ?? r.delta)),
    [visibleRows]
  );

  /** Плоский список для вывода: заголовки групп вперемешку со счетами.
   *  Плоским он сделан намеренно — так и сетка карточек, и таблица остаются
   *  одним `map`, а заголовок просто занимает всю ширину ряда. */
  type ListItem =
    | {
        kind: "header";
        key: string;
        label: string;
        count: number;
        sum: number;
        /**
         * Сумма ПОЛОЖИТЕЛЬНЫХ остатков группы — числитель доли (issue #90).
         *
         * Не сам `sum`: знаменатель доли на «Капитале» — сумма положительных
         * остатков, и если брать в числителе итог группы с вычтенными долгами,
         * доли перестанут складываться в сто процентов. У группы, где живут
         * одни долги, доли нет — ровно как у отдельного долгового счёта.
         */
        positive: number;
      }
    | { kind: "row"; key: string; row: AccountRow };

  const listItems = useMemo<ListItem[]>(() => {
    if (groupBy === "none") {
      return visibleRows.map((r) => ({ kind: "row", key: r.account, row: r }));
    }
    const keyOf = (r: AccountRow) =>
      groupBy === "bank" ? r.bank ?? NO_BANK : r.kind || NO_TYPE;
    const groups = new Map<string, AccountRow[]>();
    for (const r of visibleRows) {
      const k = keyOf(r);
      const list = groups.get(k);
      if (list) list.push(r);
      else groups.set(k, [r]);
    }
    // Группы по убыванию суммы — сначала то, где лежат деньги. Пустой бакет
    // («Без банка») тонет сам, если он мелкий, и не нуждается в отдельном правиле.
    const ordered = [...groups.entries()]
      .map(([label, rows]) => ({
        label,
        rows,
        sum: rows.reduce((s, r) => s + rowHeadline(r), 0),
        positive: positiveBalanceTotal(rows.map((r) => r.balanceBase ?? r.delta)),
        // Группа целиком из архивных счетов уходит вниз — иначе закрытый вклад
        // с крупным остатком вставал выше рабочих счетов, хотя внутри списка
        // архивные мы как раз опускаем.
        allArchived: rows.every((r) => r.archive),
      }))
      .sort((a, b) => {
        if (a.allArchived !== b.allArchived) return a.allArchived ? 1 : -1;
        return b.sum - a.sum;
      });
    const out: ListItem[] = [];
    for (const g of ordered) {
      out.push({
        kind: "header",
        key: `h:${g.label}`,
        label: g.label,
        count: g.rows.length,
        sum: g.sum,
        positive: g.positive,
      });
      for (const r of g.rows) out.push({ kind: "row", key: r.account, row: r });
    }
    return out;
  }, [visibleRows, groupBy, rowHeadline]);
  // Real current balance per account (base currency) — only in API mode. Lets
  // the stacked chart show actual balances instead of cumulative-flow-from-zero.
  const realBalancesByAccount = useMemo(() => {
    const m: Record<string, number> = {};
    // Именно по живым счетам, а НЕ по строкам таблицы. Строки — это список, из
    // которого намеренно выброшены спящие счета с нулевым остатком и без
    // операций в окне фильтра. Стопка же строится по всей истории, и такой
    // выброшенный счёт оставался без якоря: вместо ровного нуля линия
    // показывала накопленный поток, а «Итого» расходилось с совокупным
    // балансом ровно на эту величину (issue #59).
    for (const a of liveList) m[a.title] = toBase(a.balance, a.currency);
    return m;
  }, [liveList, toBase]);
  const series = useMemo(
    () => dailyBalanceSeries(filtered, selectedAccount ?? undefined),
    [filtered, selectedAccount]
  );
  // Unsynced drafts are walked in the series but are not in the API balances —
  // keep them
  // out of the stacked chart's real-balance anchor so the line isn't shifted
  // by the draft amount (issue #18).
  const drafts = useDraftsStore((s) => s.drafts);
  const unsyncedIds = useMemo(() => new Set(Object.keys(drafts)), [drafts]);
  /**
   * Окно показа для остатков.
   *
   * Остаток на дату складывается из ВСЕЙ истории до неё — отбор не может его
   * изменить, он может только выбрать, какой кусок показать. Раньше графики
   * строились прямо из отобранных операций, а конец всё равно привязывался к
   * сегодняшнему реальному балансу: при периоде «2024» декабрь 2024-го
   * рисовался на уровне остатка за июнь 2026-го, и «Совокупный баланс»
   * показывал сегодняшнее число с подписью «в пределах фильтра».
   *
   * `null` — показываем всё. Иначе — границы выбранного периода.
   *
   * Окно берётся ПРЯМО из периода, а не из отфильтрованных операций. Раньше
   * оно считалось по `applyFilters` с руками занулёнными счетами, категориями,
   * валютами и поиском — и всё, что не попало в этот список, продолжало
   * двигать границы: отбор «сумма от 10 000» в «Дополнительно» менял, какие
   * ДАТЫ видно на графике остатков. Диапазон периода такого сделать не может
   * по устройству, и список полей больше не надо поддерживать руками.
   */
  const viewWindow = useMemo(() => {
    const maxDate = transactions.reduce((m, t) => (t.date > m ? t.date : m), "");
    // «custom» presetToRange не разворачивает — свои даты лежат прямо в отборе.
    const r =
      filters.preset === "custom"
        ? { from: filters.from, to: filters.to }
        : presetToRange(filters.preset, maxDate, filters.monthYM, monthStartDay);
    if (!r.from && !r.to) return null;
    return { from: r.from ?? "", to: r.to ?? "9999-12-31" };
  }, [
    transactions,
    filters.preset,
    filters.from,
    filters.to,
    filters.monthYM,
    monthStartDay,
  ]);
  /** В выбранном периоде нет ни одной операции — подменять это всей историей нельзя. */
  const emptyWindow = useMemo(() => {
    if (!viewWindow || transactions.length === 0) return false;
    return !transactions.some(
      (t) => t.date >= viewWindow.from && t.date <= viewWindow.to
    );
  }, [transactions, viewWindow]);
  const clip = useCallback(
    <T extends { date: string }>(series: T[]): T[] => {
      if (emptyWindow) return [];
      if (!viewWindow) return series;
      return series.filter((p) => p.date >= viewWindow.from && p.date <= viewWindow.to);
    },
    [viewWindow, emptyWindow]
  );

  /**
   * Варианты отбора для графика — тот же перечень счетов, что и в списке под
   * ним, и с теми же группами по виду счёта, что в глобальном отборе. Долговой
   * счёт раскрыт по контрагентам: выбранный человек получает СВОЙ слой на
   * графике — историю того, сколько он должен вам (или вы ему).
   */
  const chartAccountOptions = useMemo(() => {
    // Порядок — как в глобальном отборе: по виду счёта, архивные внизу. Иначе
    // `MultiSelect` рисует заголовок группы столько раз, сколько раз она
    // встретилась в списке, а список счетов сортируется по своим правилам.
    const kinds = new Map(accountRows.map((r) => [r.account, r.kind]));
    const archived = new Set(accountRows.filter((r) => r.archive).map((r) => r.account));
    const base = accountOptions(
      accountRows.map((r) => r.account),
      [],
      { archived, kinds }
    );
    const debts = new Set(
      accountRows.filter((r) => DEBT_TYPES.has(r.type)).map((r) => r.account)
    );
    return withDebtCounterparties(base, debts, transactions);
  }, [accountRows, transactions]);
  /** Вид счёта для заголовков групп — как в глобальном отборе. */
  const chartAccountGroup = useCallback(
    (name: string) => {
      // Контрагент живёт в группе своего счёта — он его ветка, а не раздел.
      const title = parseDebtKey(name)?.account ?? name;
      const row = accountRows.find((r) => r.account === title);
      if (!row || row.archive) return null;
      return row.kind || null;
    },
    [accountRows]
  );
  const chartArchived = useMemo(
    () => new Set(accountRows.filter((r) => r.archive).map((r) => r.account)),
    [accountRows]
  );
  /**
   * Счета, выбранные для стопки. `null` — отбора нет, работает автоматика
   * (восемь крупнейших и «Прочие»). Пустой массив — пользователь снял все
   * галочки: рисовать нечего, и подменять это «всеми» нельзя.
   */
  const chartOnly = useMemo<string[] | null>(() => {
    if (chartAccounts.size === 0) return null;
    if (chartAccounts.has(FILTER_NONE)) return [];
    return [...chartAccounts];
  }, [chartAccounts]);
  const chartFiltered = chartOnly !== null && chartOnly.length > 0;
  const chartNothingPicked = chartOnly !== null && chartOnly.length === 0;

  /**
   * Выбранные контрагенты долговых счетов: счёт → имена.
   *
   * Их операции уходят каждая в свой слой, а сам счёт показывает остальное —
   * иначе одни и те же деньги легли бы в стопку дважды.
   */
  const chartDebtSplit = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const key of chartOnly ?? []) {
      const pair = parseDebtKey(key);
      if (!pair) continue;
      const set = m.get(pair.account) ?? new Set<string>();
      set.add(pair.payee);
      m.set(pair.account, set);
    }
    return m.size > 0 ? m : null;
  }, [chartOnly]);

  /**
   * Якоря для слоёв: у контрагента это его собственный итог по долгу, а у
   * самого долгового счёта — остаток за вычетом выделенных контрагентов.
   *
   * Итоги по контрагентам в сумме дают остаток счёта (см. `debtsByCounterparty`),
   * поэтому «Итого» на графике от разбивки не меняется.
   */
  const chartRealBalances = useMemo(() => {
    if (!hasRealBalances || !chartDebtSplit) return realBalancesByAccount;
    const out: Record<string, number> = { ...realBalancesByAccount };
    for (const [account, payees] of chartDebtSplit) {
      const { rows } = debtsByCounterparty(transactions, new Set([account]));
      let moved = 0;
      for (const row of rows) {
        if (!payees.has(row.payee)) continue;
        out[debtKey(account, row.payee)] = row.amount;
        moved += row.amount;
      }
      if (out[account] != null) out[account] -= moved;
    }
    return out;
  }, [hasRealBalances, chartDebtSplit, realBalancesByAccount, transactions]);

  const stackedAll = useMemo(
    () =>
      stackedBalanceByAccount(
        transactions,
        // Девять слоёв плюс «Прочие» — ровно столько цветов в палитре, так что
        // повторов не будет. Счетов меньше — слоёв меньше.
        9,
        hasRealBalances ? chartRealBalances : null,
        unsyncedIds,
        chartOnly,
        chartDebtSplit
      ),
    [transactions, hasRealBalances, chartRealBalances, unsyncedIds, chartOnly, chartDebtSplit]
  );
  const stacked = useMemo(
    () => ({ ...stackedAll, series: clip(stackedAll.series) }),
    [stackedAll, clip]
  );
  const netWorthAll = useNetWorthSeries(transactions);
  const netWorth = useMemo(() => clip(netWorthAll), [netWorthAll, clip]);

  /**
   * Нижняя граница оси у стопки — ровно сумма отрицательных слоёв (ноль, если
   * долгов в окне нет).
   *
   * Автоматика тут промахивается: она смотрит на минимум ОТДЕЛЬНОГО счёта, а не
   * на сумму отрицательной части, и на пустое место под нулём уходила четверть
   * высоты — стопка при этом упиралась в потолок.
   */
  const stackFloor = useMemo(() => {
    let floor = 0;
    let peak = 0;
    for (const point of stacked.series) {
      let neg = 0;
      let pos = 0;
      for (const acc of stacked.accounts) {
        const v = point[acc] as number;
        if (typeof v !== "number") continue;
        if (v < 0) neg += v;
        else pos += v;
      }
      if (neg < floor) floor = neg;
      if (pos > peak) peak = pos;
      // Итог тоже бывает отрицательным — когда долгов больше, чем денег.
      // Его линия обязана остаться внутри оси.
      const total = point.total as number;
      if (typeof total === "number" && total < floor) floor = total;
    }
    return { floor, peak };
  }, [stacked]);

  /**
   * Ось стопки: деления и границы задаём сами, а мелкий минус РАСТЯГИВАЕМ.
   *
   * Отдать это автоматике нельзя: увидев низ «−14 612 ₽», она округлит его до
   * миллиона вниз и отдаст под пустоту четверть высоты.
   *
   * Но и честного масштаба мало. Перерасход в полторы тысячи против шести
   * миллионов активов — это 0,02 % высоты: полоска тоньше пикселя, и минуса на
   * графике попросту не видно. Поэтому под минусы отводится своя зона внизу
   * (десятая часть высоты), и они рисуются растянутыми на неё.
   *
   * Обман это или нет — решает подпись: у нижнего деления стоит НАСТОЯЩАЯ сумма
   * («−14,6 тыс.»), рядом с нулём, так что разницу масштабов видно прямо на оси.
   * Когда минусы и без растяжения занимают свою зону (долг в треть капитала),
   * коэффициент равен единице и ось честна целиком.
   */
  const stackAxis = useMemo(() => {
    const { floor, peak } = stackFloor;
    const step = niceStep(Math.max(peak, 1) / 4);
    const top = Math.ceil(peak / step) * step || step;
    const ticks: number[] = [];
    for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
    if (floor >= 0) {
      return { domain: [0, top] as [number, number], ticks, scale: 1, floor: 0 };
    }
    const zone = Math.max(-floor, top * NEG_ZONE);
    ticks.unshift(-zone);
    return {
      domain: [-zone, top] as [number, number],
      ticks,
      // Во сколько раз растянуты минусы. Ими же множатся области под нулём.
      scale: zone / -floor,
      floor,
    };
  }, [stackFloor]);

  // Stacked-chart tooltip: per-account rows + a bold «Итого» — the day's net
  // worth, which the chart already carries on each datum as `total` (issue #27).
  const renderStackedTooltip = ({ active, payload, label }: TooltipContentProps) => {
    if (!active || !payload || payload.length === 0) return null;
    // Числа берём из САМОЙ ТОЧКИ, а не из списка нарисованных областей: каждый
    // счёт нарисован двумя областями (плюс и минус, см. ниже), и в списке он
    // встретился бы дважды половинками. В точке лежит его настоящий остаток.
    const datum = (payload[0]?.payload ?? {}) as Record<string, number | undefined>;
    // Крупное — сверху: в стопке десяток слоёв, и порядок отрисовки в подсказке
    // читается как случайный. Сортировка по величине НА ЭТОТ ДЕНЬ ставит первым
    // то, из чего в этот день и состоят деньги, а нулевые слои (счёта тогда ещё
    // не было) сами опускаются вниз, ничего при этом не пряча.
    const rows = stacked.accounts
      .map((acc, i) => ({
        acc,
        value: toNum(datum[acc]),
        color: STACK_COLORS[i % STACK_COLORS.length],
      }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const total =
      datum.total ?? rows.reduce((s, r) => s + r.value, 0);
    const facts: TooltipFact[] = rows.map((r) => ({
      label: parseDebtKey(r.acc)?.payee ?? r.acc,
      value: formatMoney(r.value, base, { signed: true }),
      swatchColor: r.color,
      // Пустой слой — это «счёта тогда ещё не было»: он в списке нужен, но
      // тянуть на себя взгляд наравне с деньгами не должен.
      tone: r.value === 0 ? "muted" : r.value < 0 ? "expense" : undefined,
      strong: r.value !== 0,
    }));
    facts.push({
      label: "Итого",
      value: formatMoney(total, base, { signed: true }),
      icon: <Wallet />,
      tone: total >= 0 ? "income" : "expense",
      strong: true,
    });
    return (
      <ChartTooltipCard>
        <TooltipFacts title={formatDate(label as string)} facts={facts} />
      </ChartTooltipCard>
    );
  };

  /**
   * Подсказка графика с одной линией — «Совокупный баланс» и «Изменение».
   *
   * Своя вместо стандартной от Recharts: у той свой шрифт, свои отступы и своя
   * подача числа, и рядом с подсказкой стопки (а тем более с «Бюджетом») она
   * выглядела чужой. Здесь те же карточка, заголовок-дата и строка со значком.
   */
  const seriesTooltip =
    (rowsOf: (dataKey: string) => { label: string; color: string } | null) =>
    ({ active, payload, label }: TooltipContentProps) => {
      if (!active || !payload || payload.length === 0) return null;
      const facts: TooltipFact[] = [];
      for (const p of payload) {
        const meta = rowsOf(String(p.dataKey));
        if (!meta || p.value == null) continue;
        const v = toNum(p.value);
        facts.push({
          label: meta.label,
          value: formatMoney(v, base, { signed: true }),
          swatchColor: meta.color,
          tone: v > 0 ? "income" : v < 0 ? "expense" : "muted",
          strong: true,
        });
      }
      if (facts.length === 0) return null;
      return (
        <ChartTooltipCard>
          <TooltipFacts title={formatDate(label as string)} facts={facts} />
        </ChartTooltipCard>
      );
    };

  /** Линия совокупного баланса — цвет тот же, что у самой линии на графике. */
  const renderNetTooltip = seriesTooltip((key) =>
    key === "net" ? { label: "Баланс", color: NET_STROKE } : null
  );

  /**
   * «Изменение по отбору»: накоплено с начала периода и сколько дал этот день.
   *
   * Дневная величина в данных была всегда, а показать её было негде: линия
   * нарисована одна, и подсказка от Recharts знала только про неё. Со своей
   * подсказкой вопрос «а что случилось именно в этот день» перестал требовать
   * счёта в уме по соседним точкам.
   */
  const renderFlowTooltip = ({ active, payload, label }: TooltipContentProps) => {
    if (!active || !payload || payload.length === 0) return null;
    const datum = (payload[0]?.payload ?? {}) as { balance?: number; delta?: number };
    if (datum.balance == null) return null;
    const facts: TooltipFact[] = [
      {
        label: "Накоплено",
        value: formatMoney(datum.balance, base, { signed: true }),
        swatchColor: FLOW_STROKE,
        tone: datum.balance > 0 ? "income" : datum.balance < 0 ? "expense" : "muted",
        strong: true,
      },
    ];
    if (datum.delta != null) {
      facts.push({
        label: "За день",
        value: formatMoney(datum.delta, base, { signed: true }),
        icon: <ArrowUpDown />,
        tone: datum.delta > 0 ? "income" : datum.delta < 0 ? "expense" : "muted",
      });
    }
    return (
      <ChartTooltipCard>
        <TooltipFacts title={formatDate(label as string)} facts={facts} />
      </ChartTooltipCard>
    );
  };

  function applyCalibration() {
    const amt = Number(calibAmount);
    if (!calibDate || !Number.isFinite(amt)) return;
    setCalibration({ date: calibDate, amount: amt });
    setCalibOpen(false);
  }

  function calibrateForToday() {
    const lastDate = lastTransactionDate(transactions);
    if (lastDate) setCalibDate(lastDate);
  }

  const lastDateOverall = useMemo(() => lastTransactionDate(transactions), [transactions]);
  const rawAtCalibDate = useMemo(
    () => (calibDate ? cumulativeNetAt(transactions, calibDate) : 0),
    [transactions, calibDate]
  );
  const anchors = useMemo(() => detectBalanceAnchors(transactions), [transactions]);

  function applyAnchor() {
    if (anchors.length === 0) return;
    const a = anchors[0];
    const cum = cumulativeNetAt(transactions, a.tx.date);
    setCalibration({ date: a.tx.date, amount: cum + a.amount });
    setCalibOpen(false);
  }

  function openAccount(account: string) {
    const txs = filtered.filter(
      (t) => t.outcomeAccount === account || t.incomeAccount === account
    );
    showDrill(account, txs, "Операции по счёту");
  }

  /**
   * Долги по людям — то, чего в самом Дзен-мани нет.
   *
   * Там счёт «Долги» один на всех: сколько должны вам и сколько должны вы,
   * свалено в один остаток. Кто за ним стоит, известно из самой операции — в
   * поле «Контрагент», — поэтому строку долгового счёта можно раскрыть и
   * увидеть разбивку. Считаем по тому же набору операций, что и сама строка:
   * на «Капитале» — по всей истории, на «Движении» — за отбор.
   */
  function openDebtCounterparty(account: string, row: DebtCounterparty) {
    // Отбираем по ключу, а не по показанному имени: под одной строкой могут
    // лежать несколько написаний одного контрагента («OZON» и «Ozon»).
    const txs = debtSource.filter(
      (t) =>
        (t.outcomeAccount === account || t.incomeAccount === account) &&
        debtPayeeKey((t.payee || "").trim() || NO_COUNTERPARTY) === row.key
    );
    showDrill(`${account} · ${row.payee}`, txs, "Долги");
  }

  if (transactions.length === 0) return <EmptyState />;

  const totalNet = accounts.reduce((s, a) => s + a.balance, 0);
  // Headline доход/расход = real income/expense, EXCLUDING internal transfers
  // (computeKPI skips kind="transfer"). Summing per-account flows instead would
  // double-count every transfer between own accounts (both legs), inflating the
  // figures to near-equal turnover that has no match in the operations list.
  const kpi = computeKPI(filtered);
  const totalIncome = kpi.income;
  const totalExpense = kpi.expense;

  const totalAllAccounts = accountsAll.reduce((s, a) => s + a.balance, 0);
  // Пик считаем по тому, что в окне, а не «не ниже нуля»: при отборе, где всё
  // время был минус, ноль был бы выдуманным максимумом.
  const peakNetWorth = netWorth.length
    ? netWorth.reduce((m, p) => Math.max(m, p.net), netWorth[0].net)
    : 0;
  const lastNetWorth = netWorth.length ? netWorth[netWorth.length - 1].net : 0;
  /** В окне нет ни одного дня — числа показывать нечем, и ноль тут соврал бы. */
  const noWindowData = netWorth.length === 0;
  // Точность подписей оси у графика «Совокупно»: ось там подстроена под данные,
  // и на узком размахе одного знака не хватает — все деления читаются как одно
  // и то же число.
  const netWorthDigits = noWindowData
    ? 1
    : axisFractionDigits(
        netWorth.reduce((m, p) => Math.min(m, p.net), netWorth[0].net),
        netWorth.reduce((m, p) => Math.max(m, p.net), netWorth[0].net)
      );
  // Мелкие счета стопка сводит в один слой «Прочие». Подпись под графиком
  // обязана это сказать: иначе кажется, что счетов у пользователя ровно
  // столько, сколько слоёв. Раньше там стояло «топ-N счетов», и N включало
  // сам слой «Прочие» — то есть было на единицу больше настоящих счетов.
  const stackHasOther = stacked.accounts.includes("Прочие");
  const stackTopCount = stacked.accounts.length - (stackHasOther ? 1 : 0);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Wallet}
        title="Счета"
        hint="Остатки на счетах, их история и обороты за период"
        right={
          <div className="flex flex-wrap items-center gap-2">
            {/* Переключатели «Вся история / По фильтрам» и «По счетам /
                Совокупно» жили здесь, в шапке страницы, и по ним нельзя было
                понять, на что каждый влияет. Теперь каждый стоит там, где
                действует: первый — над блоком показателей и графиков, которые
                он пересчитывает, второй — в карточке своего графика.

                А вот выбор раздела здесь как раз на месте: он меняет страницу
                целиком, и стоит там же, где такой же выбор на «Категориях». */}
            {/* Значок стоит слева от переключателя, а не между ним и
                «Калибровкой». Ряд прижат к правому краю, поэтому появление и
                исчезновение САМОГО ЛЕВОГО элемента ничего не двигает: короче
                становится только левый край ряда. Стоял бы он в середине — при
                переходе на «Движение» кнопки прыгали бы вбок. */}
            {tab === "capital" && (
              <InfoPopover label="Что делают отборы на «Капитале»">
                <p>{CAPITAL_FILTERS_HINT}</p>
              </InfoPopover>
            )}
            <Segmented
              value={tab}
              onChange={setTab}
              label="Разделы страницы «Счета»"
              options={[
                {
                  value: "capital",
                  label: "Капитал",
                  icon: Landmark,
                  // Не «отбору не подчиняется»: период на этой вкладке работает —
                  // просто выбирает показанный отрезок, а не пересчитывает суммы.
                  title: "Сколько денег на счетах и как менялось",
                },
                {
                  value: "flow",
                  label: "Движение",
                  icon: ArrowLeftRight,
                  title: "Поступления и списания за выбранный период",
                },
              ]}
            />
            {zenLoaded && !zenToken && (
              <button
                onClick={() => setCalibOpen((o) => !o)}
                className={`btn-ghost text-xs ${calibration ? "border-accent2 text-accent2" : ""}`}
                title="Привязать график к фактическому балансу"
              >
                <Settings2 className="w-3.5 h-3.5" />
                {calibration ? "Калибровка вкл." : "Калибровка"}
              </button>
            )}
          </div>
        }
      />
      {/* Панель больше не гаснет: отбор в деле на обеих вкладках. На «Капитале»
          окно показа задаёт ПЕРИОД (в нём есть «Всё» — это и есть вся история),
          на «Движении» работает весь отбор целиком. Отдельный переключатель
          «Считать по» тут когда-то стоял и просто повторял «Всё» из периода. */}
      {/* На «Капитале» живой только период: остаток на дату складывается из
          всей истории до неё, и отборы по счетам, категориям и суммам его не
          меняют. Раз не меняют — гасим, иначе на экране два отбора «Счета»
          (общий и свой у графика) и не понять, какой чем управляет. */}
      <GlobalFilters
        showDataFilters={tab !== "capital"}
        dataFiltersHint={CAPITAL_FILTERS_HINT}
      />

      {tab === "capital" && calibOpen && !zenToken && (
        <div className="card card-pad bg-accent2/5 border-accent2/40">
          <div className="font-semibold mb-2 flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-accent2" />
            Калибровка совокупного баланса
          </div>
          <p className="text-xs text-muted mb-4">
            В CSV нет начальных остатков счетов, поэтому без калибровки график
            показывает <em>изменение</em>, а не реальный баланс. Укажите, сколько
            у вас было на всех счетах в выбранный день, — весь график сдвинется
            на эту разницу.
          </p>

          {anchors.length > 0 && (
            <div className="mb-3 p-3 rounded-lg bg-panel2 border border-border flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">
                  Найдены операции с известным остатком: {anchors.length}
                </div>
                <div className="text-xs text-muted mt-1">
                  Дзен-мани иногда выгружает «Корректировка остатка» и
                  «Начальный остаток» обычными операциями — по ним дату и сумму
                  можно не вводить вручную. Самая свежая: {anchors[0].tx.date} ·{" "}
                  {anchors[0].tx.categoryFull}
                </div>
              </div>
              <button onClick={applyAnchor} className="btn-ghost text-xs whitespace-nowrap">
                Применить
              </button>
            </div>
          )}

          <div className="flex items-center gap-2 mb-2">
            <button onClick={calibrateForToday} className="btn-ghost text-xs">
              Использовать дату последней операции
            </button>
            <span className="text-xs text-muted">
              ({lastDateOverall || "—"})
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div>
              <label className="label block mb-1">На дату</label>
              <DateField
                value={calibDate}
                onChange={(e) => setCalibDate(e.target.value)}
                className="input text-sm"
              />
            </div>
            <div>
              <label className="label block mb-1">У меня было ({base})</label>
              <input
                type="number"
                value={calibAmount}
                onChange={(e) => setCalibAmount(e.target.value)}
                placeholder="2900000"
                className="input text-sm"
              />
              {calibDate && (
                <div className="text-[11px] text-muted mt-1">
                  Сейчас график показывает{" "}
                  <span className="tabular-nums">
                    {formatMoney(rawAtCalibDate, base, { signed: true })}
                  </span>{" "}
                  на эту дату
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={applyCalibration} className="btn-primary text-sm flex-1">
                <CheckCircle2 className="w-4 h-4" />
                Применить
              </button>
              {calibration && (
                <button
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Сбросить калибровку?",
                      message:
                        "Текущая балансовая привязка будет удалена. Можно будет настроить заново.",
                      confirmLabel: "Сбросить",
                      tone: "danger",
                    });
                    if (ok) clearCalibration();
                  }}
                  className="btn-danger text-sm"
                  title="Сбросить"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          <div className="text-xs text-muted mt-3">
            Действует только на график «Совокупно» и на показатель «Совокупный
            баланс». График «По счетам» остаётся от нуля — он показывает
            изменение, а не остатки.
          </div>
        </div>
      )}

      <div
        className={
          tab === "capital" ? "grid grid-cols-2 md:grid-cols-2 gap-4" : "hidden"
        }
      >
        <Stat
          label="Совокупный баланс"
          tone={noWindowData ? "accent" : lastNetWorth >= 0 ? "income" : "expense"}
          value={noWindowData ? "—" : formatMoney(lastNetWorth, base, { signed: true })}
          hint={
            noWindowData
              ? "В выбранном периоде нет операций"
              : viewWindow
                ? "На конец выбранного периода"
                : "На последний день истории"
          }
        />
        <Stat
          label="Наибольший баланс"
          tone="accent"
          value={noWindowData ? "—" : formatMoney(peakNetWorth, base)}
          // То же окно, что и у «Совокупного баланса», — значит и подпись
          // должна честно называть его, а не молчать про период.
          hint={
            noWindowData
              ? "В выбранном периоде нет операций"
              : viewWindow
                ? "В выбранном периоде"
                : "За всю историю"
          }
        />
      </div>

      {/* ── «Движение»: всё, что подчиняется отбору ─────────────────────── */}
      <div
        className={
          tab === "flow" ? "grid grid-cols-2 md:grid-cols-4 gap-4" : "hidden"
        }
      >
        <Stat
          label="Доходы"
          tone="income"
          value={formatMoney(totalIncome, base)}
          hint="Без переводов между счетами"
        />
        <Stat
          label="Расходы"
          tone="expense"
          value={formatMoney(totalExpense, base)}
          hint="Без переводов между счетами"
        />
        <Stat
          label="Изменение по отбору"
          tone={totalNet >= 0 ? "income" : "expense"}
          value={formatMoney(totalNet, base, { signed: true })}
          hint="Доходы минус расходы"
        />
        <Stat
          label="Изменение за всю историю"
          tone={totalAllAccounts >= 0 ? "income" : "expense"}
          value={formatMoney(totalAllAccounts, base, { signed: true })}
          // Стоит рядом с «по отбору» намеренно: эти два числа сравнивают, и в
          // этом весь их смысл. Раньше пара терялась в середине страницы.
          hint="Для сравнения — без отбора"
        />
      </div>

      <div className={tab === "capital" ? "card-tray card-pad" : "hidden"}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="font-semibold">
              {view === "stacked"
                ? hasRealBalances
                  ? "Остатки по счетам"
                  : "Накоплено по счетам"
                : "Совокупный баланс"}
            </div>
            {/* Подпись говорит про период ровно то, что есть на деле. Раньше у
                стопки стояло «без фильтров» всегда — а она строится из того же
                набора операций, что и остальное. */}
            <div className="text-xs text-muted">
              {view === "stacked" && chartNothingPicked ? (
                // Ни одного счёта не отмечено — рисовать нечего, и рассказывать
                // про слои и период тут значило бы описывать пустое место.
                "Счета для показа не выбраны"
              ) : (
                <>
                  {view === "stacked"
                    ? chartFiltered
                      ? // При отборе «Итого» — сумма выбранных счетов, а не
                        // совокупный баланс. Промолчать об этом нельзя: рядом
                        // стоит показатель «Совокупный баланс» с другим числом.
                        "Только выбранные счета · «Итого» — их сумма"
                      : hasRealBalances
                        ? "Каждый счёт своим слоем"
                        : "Накопление с нуля, без начальных остатков"
                    : "Активы минус долги на каждый день"}
                  {/* Про ОТРЕЗОК, а не про способ счёта: остатки всегда из всей
                      истории, период лишь выбирает показанный кусок. */}
                  {viewWindow ? " · выбранный период" : " · вся история"}
                  {/* Без «Прочих» подпись молчит: слои строятся по операциям, и
                      счёт вообще без движения в стопку не попадает — сказать
                      тут «все счета» значило бы соврать. */}
                  {view === "stacked" &&
                    (chartFiltered
                      ? ` · ${chartOnly!.length} из ${chartAccountOptions.length}`
                      : stackHasOther
                        ? ` · ${stackTopCount} ${pluralRu(stackTopCount, [
                            "крупнейший счёт",
                            "крупнейших счёта",
                            "крупнейших счетов",
                          ])}, остальные — в «Прочие»`
                        : "")}
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Отбор счетов — только у стопки: «Совокупно» показывает активы
                минус долги целиком, и выкидывать оттуда счета нельзя, конец
                кривой прибит к сумме ВСЕХ реальных остатков. */}
            {view === "stacked" && chartAccountOptions.length > 1 && (
              <MultiSelect
                className="w-48 shrink-0"
                label="Счета"
                options={chartAccountOptions}
                selected={chartAccounts}
                onChange={setChartAccounts}
                renderIcon={(name) =>
                  parseDebtKey(name) ? (
                    <Users className="w-[18px] h-[18px] text-muted" />
                  ) : (
                    <AccountLogo title={name} size={18} />
                  )
                }
                labelOf={(name) => parseDebtKey(name)?.payee ?? name}
                nestedOf={(name) => parseDebtKey(name) !== null}
                nestedUnitForms={["контрагент", "контрагента", "контрагентов"]}
                groupOf={chartAccountGroup}
                unitForms={["счёт", "счёта", "счетов"]}
                searchPlaceholder="Поиск счёта"
                archivedSet={chartArchived}
                compactSummary
              />
            )}
            <div className="flex gap-0.5 bg-panel2 rounded-full p-1 border border-border shadow-tray shrink-0">
            <button
              onClick={() => setView("stacked")}
              className={`px-3 py-1 text-xs rounded-full flex items-center gap-1 transition-colors duration-200 ${view === "stacked" ? "bg-accent text-accent-fg" : "text-muted"}`}
              title="Разложить по счетам"
            >
              <Layers className="w-3 h-3" />
              По счетам
            </button>
            <button
              onClick={() => setView("single")}
              className={`px-3 py-1 text-xs rounded-full flex items-center gap-1 transition-colors duration-200 ${view === "single" ? "bg-accent text-accent-fg" : "text-muted"}`}
              title="Одной линией: активы минус долги"
            >
              <LineChartIcon className="w-3 h-3" />
              Совокупно
            </button>
            </div>
          </div>
        </div>
        <div className="h-96">
          {view === "stacked" && chartNothingPicked ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-sm text-muted">
              <div>Не выбрано ни одного счёта.</div>
              <button
                onClick={() => setChartAccounts(new Set())}
                className="btn-ghost text-xs"
              >
                Показать все
              </button>
            </div>
          ) : view === "stacked" ? (
            <ResponsiveContainer>
              {/* `stackOffset="sign"`: активы растут вверх от нуля, долги — вниз,
                  каждый от своей стороны. Без него стопка складывается подряд, и
                  долг, нарисованный после активов, утягивает всю ленту вниз, а
                  следующий актив поднимает обратно: нижний край ленты
                  оказывается не итогом, а самой глубокой точкой этого блуждания
                  — и зависит от порядка счетов. Отсюда и брались −5 млн на оси
                  при итоге −3,7 млн. */}
              <ComposedChart
                data={stacked.series}
                // Знак разведён не смещением, а двумя стопками (см. области
                // ниже): «sign» умеет только складывать, а нам нужно ещё и
                // рисовать половинки по отдельности.
                stackOffset="none"
              >
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                <XAxis
                  dataKey="date"
                  stroke={chartAxisStroke}
                  fontSize={11}
                  tickFormatter={(d) => formatDate(d, "short")}
                  minTickGap={50}
                />
                <YAxis
                  stroke={chartAxisStroke}
                  fontSize={11}
                  // У нижнего деления подпись — НАСТОЯЩАЯ сумма минусов, даже
                  // если зона под нулём растянута: иначе растяжение молча врало
                  // бы про масштаб.
                  tickFormatter={(v) =>
                    formatNum(v === stackAxis.domain[0] ? stackAxis.floor : v, {
                      compact: true,
                    })
                  }
                  // Ноль обязателен — высота слоя и есть сумма, от чего-то
                  // другого её отмерять нельзя. Ниже нуля — зона минусов;
                  // пустоты сверх неё ось не держит.
                  domain={stackAxis.domain}
                  ticks={stackAxis.ticks}
                />
                <Tooltip {...chartTooltipProps} content={renderStackedTooltip} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0} stroke={chartAxisStroke} strokeWidth={1} />
                {/* Каждый счёт — ДВЕ области одного цвета: плюс в стопке над
                    нулём, минус в стопке под ним. Одной областью нельзя: в день,
                    когда счёт уходит в минус, его лента ныряет со своего места в
                    стопке к нулю и закрашивает по дороге всё подряд — на графике
                    это выглядело провалом на миллионы из-за перерасхода в
                    полторы тысячи. Разведённые по знаку половинки ведут себя
                    смирно: наверху лента просто сходит на нет, а под нулём
                    появляется полоска ровно на величину минуса. */}
                {stacked.accounts.map((acc, i) => (
                  <Area
                    key={acc}
                    type="monotone"
                    dataKey={(d: Record<string, number>) => Math.max(toNum(d[acc]), 0)}
                    // Слой контрагента подписан человеком, а не служебным
                    // ключом: в легенде и подсказке нужно имя, по которому его
                    // и выбирали.
                    name={parseDebtKey(acc)?.payee ?? acc}
                    stackId="plus"
                    stroke={STACK_COLORS[i % STACK_COLORS.length]}
                    fill={STACK_COLORS[i % STACK_COLORS.length]}
                    fillOpacity={0.7}
                    isAnimationActive={false}
                  />
                ))}
                {stacked.accounts.map((acc, i) => (
                  <Area
                    key={`${acc}\u0000minus`}
                    type="monotone"
                    dataKey={(d: Record<string, number>) =>
                      Math.min(toNum(d[acc]), 0) * stackAxis.scale
                    }
                    // Половинка служебная: в легенде она была бы вторым таким же
                    // названием, а в подсказке — вторым таким же числом.
                    legendType="none"
                    tooltipType="none"
                    stackId="minus"
                    stroke={STACK_COLORS[i % STACK_COLORS.length]}
                    fill={STACK_COLORS[i % STACK_COLORS.length]}
                    fillOpacity={0.7}
                    isAnimationActive={false}
                  />
                ))}
                {/* Итог отдельной линией: в стопке со знаками его негде увидеть —
                    активы и долги разведены по разные стороны от нуля, а разница
                    между ними нигде не нарисована. Раньше число из подсказки не
                    совпадало ни с одним краем ленты, и это выглядело ошибкой. */}
                <Line
                  type="monotone"
                  // Итог живёт на той же оси: если он ушёл в минус, его надо
                  // растянуть так же, как области под нулём, иначе линия
                  // разойдётся с лентой, из которой она и складывается.
                  dataKey={(d: Record<string, number>) => {
                    const v = toNum(d.total);
                    return v < 0 ? v * stackAxis.scale : v;
                  }}
                  name="Итого"
                  stroke={chartTotalStroke}
                  strokeWidth={2}
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer>
              <ComposedChart data={netWorth}>
                <defs>
                  <linearGradient id="netfill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={NET_STROKE} stopOpacity={0.6} />
                    <stop offset="100%" stopColor={NET_STROKE} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                <XAxis
                  dataKey="date"
                  stroke={chartAxisStroke}
                  fontSize={11}
                  tickFormatter={(d) => formatDate(d, "short")}
                  minTickGap={50}
                />
                <YAxis
                  stroke={chartAxisStroke}
                  fontSize={11}
                  // Одна линия — здесь ноль не обязателен, и держать его вредно:
                  // на коротком окне баланс меняется на доли процента, ось от
                  // нуля сплющивает всё движение в прямую под потолком. Ось
                  // подстраивается под данные — видно, что происходило.
                  // У стопки так нельзя: там высота слоя и есть сумма.
                  domain={["auto", "auto"]}
                  tickFormatter={(v) =>
                    formatNum(v, {
                      compact: true,
                      fractionDigits: netWorthDigits,
                    })
                  }
                />
                <Tooltip {...chartTooltipProps} content={renderNetTooltip} />
                <Area
                  type="monotone"
                  dataKey="net"
                  stroke={NET_STROKE}
                  strokeWidth={2}
                  fill="url(#netfill)"
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className={tab === "flow" ? "card-tray card-pad" : "hidden"}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="font-semibold">
              {selectedAccount
                ? `Изменение по счёту: ${selectedAccount}`
                : "Изменение по отбору"}
            </div>
            <div className="text-xs text-muted">
              Нарастающим итогом с начала периода
            </div>
          </div>
          {selectedAccount && (
            <button onClick={() => setSelectedAccount(null)} className="btn-ghost text-xs">
              Все счета
            </button>
          )}
        </div>
        <div className="h-64">
          <ResponsiveContainer>
            <AreaChart data={series}>
              <defs>
                <linearGradient id="bal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={FLOW_STROKE} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={FLOW_STROKE} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
              <XAxis
                dataKey="date"
                stroke={chartAxisStroke}
                fontSize={11}
                tickFormatter={(d) => formatDate(d, "short")}
                minTickGap={40}
              />
              <YAxis
                stroke={chartAxisStroke}
                fontSize={11}
                tickFormatter={(v) => formatNum(v, { compact: true })}
              />
              {/* Линия идёт от нуля и копит изменение за период — это не
                  остаток на счёте, и называть её «Балансом» нельзя: число
                  расходилось бы с колонкой «Остаток» в списке под графиком. */}
              <Tooltip {...chartTooltipProps} content={renderFlowTooltip} />
              <Area
                type="monotone"
                dataKey="balance"
                stroke={FLOW_STROKE}
                strokeWidth={2}
                fill="url(#bal)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Список счетов виден на ОБЕИХ вкладках: это опора страницы, и прятать
          его за вкладкой — значит отвечать на вопрос «сколько у меня есть» без
          перечня счетов. Вкладка меняет не наличие списка, а его столбцы:
          остаток и доля против оборотов за период. */}
      <div className="card-tray card-pad">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {/* Два показателя строки набраны одинаково: жирная подпись — значение
              обычным. Так строка читается парами «что : сколько», а не гонкой
              за самым заметным числом. Ширина не резервируется: при мелком
              кегле запас под трёхзначный счётчик читался бы дырой. */}
          <div className="text-sm flex items-center gap-1.5 mr-1">
            <Wallet className="w-4 h-4 shrink-0" />
            <span className="font-semibold">Счета:</span>
            {/* «11 из 29» — части одного числа, поэтому одним стилем.
                «из N» появляется, только когда отбор часть счетов прячет. */}
            <span className="tabular-nums">
              {visibleRows.length}
              {visibleRows.length !== totalAccounts && <> из {totalAccounts}</>}
            </span>
          </div>
          {/* Итог по видимому списку. Показываем всегда, когда есть что
              складывать: при включённых отборах это ответ на «сколько всего
              на накопительных», а без них — просто сумма всех счетов. */}
          {visibleRows.length > 0 && (
            <span
              className="text-sm tabular-nums shrink-0 mr-1"
              title={
                (capitalView
                  ? hasRealBalances
                    ? "Сумма остатков по счетам из списка"
                    : "Сумма накопленного по счетам из списка"
                  : "Сумма изменений за период по счетам из списка") +
                (hiddenCount > 0
                  ? hiddenCount === dormantCount
                    ? `. Не показано ещё ${hiddenCount} — ${dormantReason}`
                    : dormantCount > 0
                      ? `. Не показано ещё ${hiddenCount}: ${dormantCount} ${dormantReason}, остальные скрыты отборами`
                      : `. Не показано ещё ${hiddenCount} — скрыты отборами`
                  : "")
              }
            >
              <span className="font-semibold">
                {capitalView
                  ? hasRealBalances
                    ? "Общий остаток"
                    : "Всего накоплено"
                  : "Общее изменение"}
                :
              </span>{" "}
              {formatMoney(visibleTotal, base)}
            </span>
          )}
          <MultiSelect
            label="Тип"
            options={typeOptions}
            selected={typeFilter}
            onChange={setTypeFilter}
            unitForms={["тип", "типа", "типов"]}
            menuMinWidth={220}
            compactSummary
            summaryMinWidth="3.6rem"
          />
          {hasBanks && (
            <MultiSelect
              label="Банк"
              options={bankOptions}
              selected={bankFilter}
              onChange={setBankFilter}
              unitForms={["банк", "банка", "банков"]}
              menuMinWidth={240}
              compactSummary
              summaryMinWidth="4.6rem"
            />
          )}
          <DropdownMenu
              label="Признаки"
              icon={SlidersHorizontal}
              active={flagsActive > 0}
              badge={flagsActive || undefined}
              reserveBadge
              title="Отбор по признакам счёта"
            >
              {() => (
                <>
                  <CheckItem
                    checked={effectiveScope === "in"}
                    onChange={() => toggleBalanceScope("in")}
                    icon={Scale}
                    label="Только в балансе"
                  />
                  <CheckItem
                    checked={effectiveScope === "out"}
                    onChange={() => toggleBalanceScope("out")}
                    icon={EyeOff}
                    label="Только вне баланса"
                  />
                  <CheckItem
                    checked={effectiveSavings}
                    onChange={() => void patchPrefs({ onlySavings: !onlySavings })}
                    icon={PiggyBank}
                    label="Только накопительные"
                  />
                  <CheckItem
                    checked={effectiveHideArchived}
                    onChange={() =>
                      void patchPrefs({ hideArchived: !hideArchived })
                    }
                    icon={Archive}
                    label="Скрыть архивные"
                  />
                </>
              )}
            </DropdownMenu>
          <DropdownMenu
            label={groupBy === "none" ? "Группировка" : GROUP_LABEL[groupBy]}
            icon={Layers}
            active={groupBy !== "none"}
            minWidth="10.5rem"
            title="Группировка списка счетов"
          >
            {(close) =>
              GROUP_OPTIONS.filter((o) => o.value !== "bank" || hasBanks).map((o) => (
                <RadioItem
                  key={o.value}
                  checked={groupBy === o.value}
                  onSelect={() => {
                    void patchPrefs({ groupBy: o.value });
                    close();
                  }}
                  label={o.label}
                />
              ))
            }
          </DropdownMenu>
          {/* Сортировка живёт в шапке таблицы. У карточек шапки нет — там и
              только там нужно отдельное меню. */}
          {accountsView === "cards" && (
            <DropdownMenu
              label={CARD_SORT_LABEL[sortBy] ?? "Сортировка"}
              icon={ArrowUpDown}
              active={sortBy !== "balance"}
              minWidth="9.5rem"
              title="Порядок счетов"
            >
              {(close) =>
                CARD_SORT_OPTIONS.filter((o) => o.value !== "bank" || hasBanks).map((o) => (
                  <RadioItem
                    key={o.value}
                    checked={sortBy === o.value}
                    onSelect={() => {
                      pickSort(o.value);
                      close();
                    }}
                    label={o.label}
                  />
                ))
              }
            </DropdownMenu>
          )}
          <div
            role="group"
            aria-label="Вид списка счетов"
            className="ml-auto flex gap-0.5 bg-panel2 rounded-full p-1 border border-border shadow-tray"
          >
            <button
              onClick={() =>
                void patchPrefs({
                  listView: "table",
                  // В таблице колонки «Банк» нет: заголовки не подсветятся, и
                  // порядок будет выглядеть случайным. Возвращаемся к сумме.
                  ...(sortBy === "bank"
                    ? { sortBy: "balance" as const, sortDir: DEFAULT_DIR.balance }
                    : {}),
                })
              }
              aria-pressed={accountsView === "table"}
              className={`px-3 py-1 text-xs rounded-full flex items-center gap-1 transition-colors duration-200 ${
                accountsView === "table" ? "bg-accent text-accent-fg" : "text-muted"
              }`}
            >
              <TableIcon className="w-3 h-3" />
              Таблица
            </button>
            <button
              onClick={() =>
                void patchPrefs({
                  listView: "cards",
                  // «Поступления», «Опер.» и прочие колонки в карточках выбрать
                  // нечем, поэтому меню сортировки показывало бы порядок,
                  // которого в нём нет. Возвращаемся к сумме — она есть на
                  // каждой карточке.
                  ...(CARD_SORT_OPTIONS.some((o) => o.value === sortBy)
                    ? {}
                    : { sortBy: "balance" as const, sortDir: DEFAULT_DIR.balance }),
                })
              }
              aria-pressed={accountsView === "cards"}
              className={`px-3 py-1 text-xs rounded-full flex items-center gap-1 transition-colors duration-200 ${
                accountsView === "cards" ? "bg-accent text-accent-fg" : "text-muted"
              }`}
            >
              <LayoutGrid className="w-3 h-3" />
              Карточки
            </button>
          </div>
          <AppTooltip content={listHint} placement="bottom">
            <button
              className="btn-icon shrink-0"
              aria-label="Как читать список счетов"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
          </AppTooltip>
        </div>

        {visibleRows.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted">
            <div>Ни один счёт не подошёл под отбор.</div>
            <button
              onClick={() =>
                void patchPrefs({
                  typeFilter: [],
                  bankFilter: [],
                  balanceScope: "all",
                  onlySavings: false,
                  hideArchived: false,
                })
              }
              className="btn-ghost text-xs mt-3"
            >
              Сбросить отборы
            </button>
          </div>
        ) : accountsView === "cards" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {listItems.map((item) => {
              if (item.kind === "header") {
                return (
                  <div
                    key={item.key}
                    className="col-span-full flex items-baseline gap-2 min-w-0 pt-2 first:pt-0"
                  >
                    {/* Сумма стоит сразу за названием, а не у правого края
                        сетки: там её отделяла от группы пустая полоса во всю
                        ширину, и было неясно, к чему она относится. */}
                    <span className="font-semibold text-sm truncate">{item.label}</span>
                    <span className="text-xs text-muted whitespace-nowrap">
                      {formatNum(item.count)}{" "}
                      {pluralRu(item.count, ["счёт", "счёта", "счетов"])}
                    </span>
                    <span className="text-xs text-muted">·</span>
                    <span
                      className={`text-sm tabular-nums font-semibold whitespace-nowrap ${
                        item.sum < 0 ? "text-expense" : "text-text"
                      }`}
                    >
                      {formatMoney(item.sum, base)}
                    </span>
                    {capitalView &&
                      (() => {
                        const share = capitalShare(item.positive, positiveTotal);
                        if (share == null) return null;
                        return (
                          <span
                            className="text-xs text-muted tabular-nums whitespace-nowrap"
                            title="Доля от суммы положительных остатков"
                          >
                            · {formatPct(share)}
                          </span>
                        );
                      })()}
                  </div>
                );
              }
              const a = item.row;
              const isSel = selectedAccount === a.account;
              const hasReal = a.balanceBase !== null;
              // На «Движении» крупное число карточки — изменение за период, а
              // не остаток: иначе оно отвечало бы на вопрос соседней вкладки.
              const headline = capitalView ? (hasReal ? a.balanceBase! : a.delta) : a.delta;
              const headlineNeg = headline < 0;
              // Real balances are neutral when positive (match dashboard);
              // a flow delta keeps income/expense colouring.
              const headlineColor = headlineNeg
                ? "text-expense"
                : hasReal
                  ? "text-text"
                  : "text-income";
              const sparkColor = headlineNeg
                ? "rgb(var(--c-expense))"
                : "rgb(var(--c-income))";
              return (
                <div
                  key={a.account}
                  className={`p-4 rounded-lg border transition-colors ${
                    isSel
                      ? "bg-accent/10 border-accent"
                      : "bg-panel2 border-border hover:border-accent/50"
                  } ${a.archive ? "opacity-60" : ""}`}
                >
                  <div className="flex items-start justify-between mb-2 gap-2">
                    <button
                      onClick={() => setSelectedAccount(isSel ? null : a.account)}
                      className="flex items-center gap-2 min-w-0 text-left flex-1"
                      title={a.displayTitle}
                    >
                      <AccountLogo title={a.account} type={a.type} />
                      <span className="min-w-0">
                        <span className="font-medium text-sm truncate block">
                          {a.displayTitle}
                        </span>
                        {hasReal && (
                          <span className="text-[10px] text-muted flex items-center gap-1.5">
                            {a.kind}
                            <AccountMarks offBalance={a.offBalance} archive={a.archive} />
                          </span>
                        )}
                      </span>
                    </button>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {a.edited && (
                        <span
                          className="text-[10px] leading-4 px-1.5 rounded-full border border-warn/40 text-warn bg-warn/10 whitespace-nowrap"
                          title="Правка ещё не отправлена в Дзен-мани"
                        >
                          Изменён
                        </span>
                      )}
                      <span
                        className="pill text-[10px]"
                        title={
                          capitalView
                            ? "Операций за всю историю"
                            : "Операций за период"
                        }
                      >
                        {a.count}
                      </span>
                      {hasReal && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openAccountEditor(a.id);
                          }}
                          className="btn-ghost !p-1 text-muted hover:text-accent"
                          title="Изменить счёт"
                          aria-label="Изменить счёт"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedAccount(isSel ? null : a.account)}
                    className="block text-left w-full"
                  >
                    <div className="text-[10px] uppercase tracking-wider text-muted">
                      {capitalView ? (hasReal ? "Остаток" : "Накоплено") : "Изменение"}
                    </div>
                    <div className="flex items-end justify-between gap-2">
                      <div className="min-w-0">
                        <div
                          className={`text-xl font-bold tabular-nums truncate ${headlineColor}`}
                          title={formatMoney(headline, base, { decimals: 2 })}
                        >
                          {formatMoney(headline, base, { signed: !hasReal })}
                        </div>
                        {hasReal &&
                          a.nativeCurrency &&
                          a.nativeCurrency !== base && (
                            <div
                              className="text-[11px] text-muted tabular-nums"
                              title={formatMoney(a.nativeBalance!, a.nativeCurrency, {
                                decimals: 2,
                              })}
                            >
                              {formatMoney(a.nativeBalance!, a.nativeCurrency)}
                            </div>
                          )}
                      </div>
                      <Sparkline
                        data={accountMonthlyDeltas(transactions, a.account, 12)}
                        color={sparkColor}
                        width={70}
                        height={20}
                      />
                    </div>
                    <div className="text-xs text-muted flex justify-between mt-2 mb-3">
                      {capitalView ? (
                        <>
                          <span title="Доля от суммы положительных остатков. У долгов доли нет">
                            {(() => {
                              const share = capitalShare(
                                a.balanceBase ?? a.delta,
                                positiveTotal
                              );
                              return share == null ? "" : `Доля ${formatPct(share)}`;
                            })()}
                          </span>
                          <span />
                        </>
                      ) : (
                        // Изменение за период — это и есть крупное число
                        // карточки на этой вкладке, поэтому строкой ниже оно
                        // стояло второй раз. Осталась пара, которой в заголовке
                        // нет: сколько пришло и сколько ушло.
                        <>
                          <span className="text-income" title="Поступления за период">
                            +{formatMoney(a.income, base)}
                          </span>
                          <span className="text-expense" title="Списания за период">
                            −{formatMoney(a.expense, base)}
                          </span>
                        </>
                      )}
                    </div>
                  </button>
                  <button
                    onClick={() => openAccount(a.account)}
                    className="btn-ghost text-xs w-full !py-1.5"
                  >
                    <List className="w-3 h-3" />
                    Операции
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto">
            {/* table-fixed + colgroup keep column widths stable, so changing
                the filter (different rows/content) never reflows the columns.
                Numeric columns are sized to fit million-ruble values so nothing
                overflows its cell (which would force a horizontal scrollbar). */}
            <table
              className={`w-full text-base table-fixed ${
                // Минимум под НАБОР столбцов этой вкладки: на «Капитале» их
                // пять, и ширина от восьми растянула бы таблицу пустотой.
                capitalView
                  ? hasForeignCurrency ? "min-w-[760px]" : "min-w-[670px]"
                  : hasForeignCurrency ? "min-w-[1212px]" : "min-w-[1122px]"
              }`}
            >
              <colgroup>
                <col />
                {/* 170px = самая длинная подпись вида счёта («Накопительный
                    счёт», замер 140px) плюс отступы ячейки: иначе она режется
                    многоточием у большинства счетов. */}
                <col style={{ width: 170 }} />
                {capitalView ? (
                  <>
                    <col style={{ width: hasForeignCurrency ? 230 : 140 }} />
                    <col style={{ width: 110 }} />
                  </>
                ) : (
                  <>
                    <col style={{ width: 130 }} />
                    <col style={{ width: 130 }} />
                    <col style={{ width: 126 }} />
                    <col style={{ width: 96 }} />
                  </>
                )}
                <col style={{ width: 120 }} />
              </colgroup>
              <thead>
                <tr>
                  <SortTh sortKey="alpha" {...sortHead}>
                    Счёт
                  </SortTh>
                  <SortTh sortKey="type" {...sortHead}>
                    Тип
                  </SortTh>
                  {/* Столбцы по вкладке: на «Капитале» — сколько лежит и какая
                      это доля, на «Движении» — что происходило за период. Раньше
                      и то и другое стояло в одной таблице, из-за чего строка
                      отвечала сразу на два разных вопроса. */}
                  {capitalView ? (
                    <>
                      <SortTh sortKey="balance" align="right" {...sortHead}>
                        {hasRealBalances ? "Остаток" : "Накоплено"}
                      </SortTh>
                      <SortTh sortKey="balance" align="right" {...sortHead}>
                        Доля
                      </SortTh>
                    </>
                  ) : (
                    <>
                      <SortTh sortKey="income" align="right" {...sortHead}>
                        Поступления
                      </SortTh>
                      <SortTh sortKey="expense" align="right" {...sortHead}>
                        Списания
                      </SortTh>
                      <SortTh sortKey="delta" align="right" {...sortHead}>
                        Изменение
                      </SortTh>
                      <SortTh sortKey="count" align="center" {...sortHead}>
                        Операции
                      </SortTh>
                    </>
                  )}
                  <th className="table-th text-center">Действия</th>
                </tr>
              </thead>
              <tbody>
                {listItems.map((item) => {
                  if (item.kind === "header") {
                    return (
                      <tr key={item.key} className="bg-panel2/60">
                        <td className="table-td font-semibold">
                          <span className="inline-block max-w-[240px] truncate align-bottom">
                            {item.label}
                          </span>
                          <span className="ml-2 text-xs text-muted font-normal">
                            {formatNum(item.count)}{" "}
                            {pluralRu(item.count, ["счёт", "счёта", "счетов"])}
                          </span>
                        </td>
                        <td className="table-td" />
                        {/* Сумма группы стоит ровно под колонкой с деньгами:
                            на «Капитале» это остаток, на «Движении» — поступления.
                            Хвост добивается пустыми ячейками до конца строки. */}
                        <td
                          className={`table-td text-right tabular-nums font-semibold whitespace-nowrap ${
                            item.sum < 0 ? "text-expense" : "text-text"
                          }`}
                        >
                          {formatMoney(item.sum, base)}
                        </td>
                        {/* Доля группы встаёт ровно под колонкой «Доля» —
                            иначе процент повис бы над чужим столбцом. */}
                        {capitalView ? (
                          <>
                            <td
                              className="table-td text-right tabular-nums text-muted whitespace-nowrap"
                              title="Доля от суммы положительных остатков"
                            >
                              {(() => {
                                const share = capitalShare(item.positive, positiveTotal);
                                return share == null ? "" : formatPct(share);
                              })()}
                            </td>
                            <td className="table-td" />
                          </>
                        ) : (
                          <td className="table-td" colSpan={4} />
                        )}
                      </tr>
                    );
                  }
                  const a = item.row;
                  const isSel = selectedAccount === a.account;
                  const hasReal = a.balanceBase !== null;
                  const headline = hasReal ? a.balanceBase! : a.delta;
                  const headlineNeg = headline < 0;
                  const headlineColor = headlineNeg
                    ? "text-expense"
                    : hasReal
                      ? "text-text"
                      : "text-income";
                  // Долговой счёт раскрывается по контрагентам; если долговых
                  // операций нет вовсе, раскрывать нечего — шеврона тоже нет.
                  //
                  // На «Капитале» рассчитавшихся не показываем: там разбивка
                  // отвечает на вопрос «кто кому должен СЕЙЧАС», а закрытый
                  // долг вносит ноль и только топит живые строки — так же, как
                  // это устроено в самом Дзен-мани (issue #80). На «Движении»
                  // окно своё, и нулевой итог за период — тоже ответ: там
                  // видно, что с человеком за месяц рассчитались.
                  const allDebtRows = debtsByAccount.get(a.account)?.rows ?? [];
                  const debtRows = capitalView
                    ? allDebtRows.filter((d) => !d.settled)
                    : allDebtRows;
                  const debt = debtRows.length > 0;
                  const debtsOpen = debt && openDebts.has(a.account);
                  return (
                    <Fragment key={a.account}>
                    <tr
                      onClick={() => setSelectedAccount(isSel ? null : a.account)}
                      onDoubleClick={() => openAccountEditor(a.id)}
                      className={`align-middle cursor-pointer group ${
                        isSel ? "bg-accent/10" : "hover:bg-panel2/50"
                      } ${a.archive ? "opacity-60" : ""}`}
                    >
                      <td className="table-td">
                        {/* Пометки состояния идут за названием: тип уехал в свою
                            колонку, а «вне баланса» и «архив» — свойства самого
                            счёта, не его типа. */}
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="self-center shrink-0">
                            <AccountLogo title={a.account} type={a.type} />
                          </span>
                          <span
                            className="font-medium truncate group-hover:text-accent"
                            title={a.displayTitle}
                          >
                            {a.displayTitle}
                          </span>
                          {/* У долгового счёта остаток — это сумма по разным
                              людям, и сам по себе он мало что говорит. Шеврон
                              раскрывает, кто должен вам и кому должны вы.
                              Стоит ПОСЛЕ названия: слева он сдвигал бы все
                              строки списка вправо от заголовка колонки ради
                              одной. */}
                          {debt && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleDebts(a.account);
                              }}
                              aria-expanded={debtsOpen}
                              aria-label={
                                debtsOpen ? "Свернуть контрагентов" : "Показать контрагентов"
                              }
                              title={
                                debtsOpen ? "Свернуть контрагентов" : "Показать контрагентов"
                              }
                              className="self-center shrink-0 -my-1 p-1 rounded text-muted hover:text-accent hover:bg-panel2"
                            >
                              <ChevronDown
                                className={`w-3.5 h-3.5 transition-transform ${
                                  debtsOpen ? "" : "-rotate-90"
                                }`}
                              />
                            </button>
                          )}
                          {a.edited && (
                            <span
                              className="text-[10px] leading-4 px-1.5 rounded-full border border-warn/40 text-warn bg-warn/10 whitespace-nowrap shrink-0"
                              title="Правка ещё не отправлена в Дзен-мани"
                            >
                              Изменён
                            </span>
                          )}
                          {hasReal && (
                            <AccountMarks offBalance={a.offBalance} archive={a.archive} />
                          )}
                        </div>
                      </td>
                      <td className="table-td text-muted truncate">{a.kind}</td>
                      {capitalView && (
                        <td
                          className={`table-td text-right tabular-nums font-semibold whitespace-nowrap ${headlineColor}`}
                          title={formatMoney(headline, base, { decimals: 2 })}
                        >
                          {formatMoney(headline, base, { signed: !hasReal })}
                          {/* Валюта счёта — в скобках рядом, а не второй строкой:
                              строка таблицы не должна расти из-за одной суммы. */}
                          {hasReal && a.nativeCurrency && a.nativeCurrency !== base && (
                            <span className="text-[13px] text-muted font-normal">
                              {" "}
                              ({formatMoney(a.nativeBalance!, a.nativeCurrency)})
                            </span>
                          )}
                        </td>
                      )}
                      {capitalView ? (
                        <td
                          className="table-td text-right tabular-nums text-muted whitespace-nowrap"
                          title="Доля от суммы положительных остатков. У долгов доли нет"
                        >
                          {(() => {
                            const share = capitalShare(
                              a.balanceBase ?? a.delta,
                              positiveTotal
                            );
                            return share == null ? "—" : formatPct(share);
                          })()}
                        </td>
                      ) : (
                        <>
                          <td className="table-td text-right tabular-nums text-income whitespace-nowrap">
                            {formatMoney(a.income, base)}
                          </td>
                          <td className="table-td text-right tabular-nums text-expense whitespace-nowrap">
                            {formatMoney(a.expense, base)}
                          </td>
                          <td
                            className={`table-td text-right tabular-nums whitespace-nowrap ${
                              a.delta >= 0 ? "text-income" : "text-expense"
                            }`}
                          >
                            {formatMoney(a.delta, base, { signed: true })}
                          </td>
                          <td className="table-td text-center tabular-nums text-muted">
                            {formatNum(a.count)}
                          </td>
                        </>
                      )}
                      <td className="table-td">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openAccount(a.account);
                            }}
                            className="btn-icon"
                            title="Список операций"
                            aria-label="Список операций"
                          >
                            <List className="w-4 h-4" />
                          </button>
                          {/* Исключение счёта из сводной аналитики — та же
                              галочка «В аналитике», что у категорий, и правит
                              она активный разрез (#14). */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void toggleSliceAccount(a.account);
                            }}
                            aria-pressed={sliceExcludedAccounts.has(a.account)}
                            className={clsx(
                              "btn-icon",
                              sliceExcludedAccounts.has(a.account) &&
                                "text-warn bg-warn/10 hover:text-warn"
                            )}
                            title={
                              sliceExcludedAccounts.has(a.account)
                                ? `Не учитывается в аналитике (Разрез «${sliceName}»)`
                                : `Учитывается в аналитике (Разрез «${sliceName}»)`
                            }
                            aria-label={
                              sliceExcludedAccounts.has(a.account)
                                ? "Вернуть счёт в аналитику"
                                : "Исключить счёт из аналитики"
                            }
                          >
                            {sliceExcludedAccounts.has(a.account) ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                          {/* Редактор счёта — следующая итерация. Кнопка стоит
                              только у настоящих счетов из Дзен-мани: у строки,
                              собранной из CSV, править нечего. */}
                          {hasReal && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openAccountEditor(a.id);
                              }}
                              className="btn-icon"
                              title="Изменить счёт"
                              aria-label="Изменить счёт"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Разбивка долгового счёта по людям: знак — со стороны
                        владельца счетов, плюс значит «должны вам». Клик по
                        строке открывает операции этого контрагента. */}
                    {debtsOpen &&
                      debtRows.map((d) => (
                        <tr
                          key={`${a.account} ${d.payee}`}
                          onClick={() => openDebtCounterparty(a.account, d)}
                          title={`Операции: ${d.payee}`}
                          className="cursor-pointer bg-panel2/30 hover:bg-panel2/70"
                        >
                          {/* Имя и «сколько раз» — одной ячейкой, чтобы длинный
                              хвост не лез под колонку действий и не обрезался.
                              Отступ и полоска слева говорят, что строка
                              подчинена счёту выше. */}
                          <td className="table-td !py-1.5">
                            <div className="pl-6 ml-2 border-l-2 border-border min-w-0">
                              <div
                                className={`text-sm truncate ${d.settled ? "text-muted" : ""}`}
                              >
                                {d.payee}
                              </div>
                              <div className="text-[11px] text-muted">
                                {formatNum(d.count)}{" "}
                                {pluralRu(d.count, ["операция", "операции", "операций"])} ·
                                последняя {formatDate(d.last)}
                              </div>
                            </div>
                          </td>
                          <td className="table-td !py-1.5 text-xs text-muted whitespace-nowrap align-middle">
                            {d.settled
                              ? "Рассчитались"
                              : d.amount > 0
                                ? "Должны вам"
                                : "Должны вы"}
                          </td>
                          {/* Сумма встаёт под ту же колонку, что и у счёта:
                              на «Капитале» это остаток, на «Движении» —
                              изменение за период. */}
                          {!capitalView && <td className="table-td !py-1.5" colSpan={2} />}
                          <td
                            className={`table-td !py-1.5 text-right tabular-nums whitespace-nowrap align-middle ${
                              d.settled
                                ? "text-muted"
                                : d.amount > 0
                                  ? "text-income"
                                  : "text-expense"
                            }`}
                          >
                            {formatMoney(Math.abs(d.amount), base)}
                          </td>
                          {/* Хвост до конца строки — ровно две колонки на обеих
                              вкладках: «Доля» и «Действия» на «Капитале»,
                              «Операции» и «Действия» на «Движении». Раньше здесь
                              стояло три, и раскрытый долговой счёт добавлял
                              таблице ВОСЬМОЙ столбец: `table-fixed` делил
                              свободную ширину между ним и колонкой «Счёт», та
                              ужималась вдвое, и таблица на глазах съезжала
                              влево, оставляя пустое поле справа (issue #80). */}
                          <td className="table-td !py-1.5" colSpan={2} />
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editingAccount && (
        <AccountEditModal
          key={editingAccount.id}
          account={editingAccount}
          pending={accountEdits[editingAccount.id]}
          onClose={() => setEditingAccount(null)}
        />
      )}
    </div>
  );
}
