import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  type TooltipContentProps,
} from "recharts";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import {
  Wallet,
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
} from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useFiltersStore, applyFilters, FILTER_NONE } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useDrillStore } from "../store/useDrillStore";
import { useCalibrationStore } from "../store/useCalibrationStore";
import { useSlicesStore, activeSlice } from "../store/useSlicesStore";
import { confirm } from "../store/useConfirmStore";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { getLiveAccountsFromCache } from "../store/useZenmoneyStore";
import { useAccountEditsStore } from "../store/useAccountEditsStore";
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
  chartTooltipStyle,
  formatNum,
  formatDate,
  toNum,
  chartTooltipProps,
  chartGridStroke,
  chartAxisStroke,
} from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";
import { Stat } from "../components/Stat";
import { Sparkline } from "../components/Sparkline";
import { AccountLogo } from "../components/AccountLogo";
import { MultiSelect } from "../components/MultiSelect";
import { AccountEditModal } from "../components/AccountEditModal";
import { Popover } from "../components/Popover";
import { Tooltip as AppTooltip } from "../components/Tooltip";
import { DateField } from "../components/DateField";
import { ACCOUNT_KINDS, accountKindLabel } from "../lib/accountType";
import { pluralRu } from "../lib/plural";

const STACK_COLORS = [
  "#22D3EE", "#A78BFA", "#F59E0B", "#10B981", "#EC4899",
  "#3B82F6", "#84CC16", "#F97316", "#14B8A6", "#6B7280",
];

type View = "stacked" | "single";
type Scope = "filtered" | "all";
type AccountsView = "cards" | "table";
/** Что сортируем. Ключи совпадают с колонками таблицы — по клику в её шапке,
 *  как в остальных таблицах сервиса; «bank» колонки не имеет и задаётся из
 *  меню сортировки (оно нужно карточкам, где шапки нет). */
type SortBy =
  | "balance"
  | "alpha"
  | "bank"
  | "type"
  | "delta"
  | "income"
  | "expense"
  | "count";
type SortDir = "asc" | "desc";
type GroupBy = "none" | "type" | "bank";

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
        className={`px-3 py-1.5 text-xs rounded-lg border flex items-center gap-1.5 whitespace-nowrap ${
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

export function AccountsPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const rates = useDataStore((s) => s.rates);
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);

  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [view, setView] = useState<View>("stacked");
  const [scope, setScope] = useState<Scope>("all");
  const [accountsView, setAccountsView] = useState<AccountsView>("table");
  const [hideArchived, setHideArchived] = useState(false);
  // Отборы и порядок вывода списка счетов. Пустое множество = «все»
  // (соглашение MultiSelect), поэтому по умолчанию ничего не отфильтровано.
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [bankFilter, setBankFilter] = useState<Set<string>>(new Set());
  // Три состояния вместо двух галочек-антонимов: «в балансе» и «вне баланса»
  // взаимоисключающие, и одновременно включёнными они дали бы пустой список.
  const [balanceScope, setBalanceScope] = useState<"all" | "in" | "out">("all");
  const toggleBalanceScope = (v: "in" | "out") =>
    setBalanceScope((cur) => (cur === v ? "all" : v));
  const [onlySavings, setOnlySavings] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("balance");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  // Клик по колонке: та же — переворачиваем порядок, другая — берём её
  // естественное направление.
  const sortByColumn = (key: SortBy) => {
    if (key === sortBy) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(key);
      setSortDir(DEFAULT_DIR[key]);
    }
  };
  const pickSort = (key: SortBy) => {
    setSortBy(key);
    setSortDir(DEFAULT_DIR[key]);
  };
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
  const baseTxs = scope === "all" ? transactions : filtered;

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

  const accountRowsResult = useMemo(() => {
    const liveByTitle = new Map(liveList.map((a) => [a.title, a]));
    const txByTitle = new Map(accounts.map((a) => [a.account, a]));

    // Список на этой странице — справочник счетов, поэтому внебалансовые счета
    // в нём есть ВСЕГДА, с пометкой «Вне баланса» и отдельным отбором. Раньше
    // они то появлялись, то нет: строка добавлялась, если у счёта были операции
    // в периоде, и молча пропадала, если операций не было. Глобальная настройка
    // «Счета вне баланса» продолжает управлять расчётами (совокупный баланс,
    // Главная), но прятать сами счета из их же списка ей незачем.
    const titles = new Set<string>();
    for (const a of accounts) titles.add(a.account);
    // Сколько живых счетов вообще не попало в список: нулевой остаток и ни
    // одной операции в окне фильтра. Нужно, чтобы подпись под итогом честно
    // говорила, что показано не всё.
    let dormant = 0;
    for (const a of liveList) {
      // Archived (closed) accounts are kept but grouped below active ones
      // (see the sort), so the user can still review them without clutter up top.
      // Skip dormant zero-balance accounts with no activity — they'd be noise.
      if (Math.abs(a.balance) <= 0.005 && !txByTitle.has(a.title)) {
        dormant++;
        continue;
      }
      titles.add(a.title);
    }

    const rows = [...titles].map((title) => {
      const live = liveByTitle.get(title);
      const tx = txByTitle.get(title);
      return {
        account: title,
        delta: tx?.balance ?? 0,
        income: tx?.income ?? 0,
        expense: tx?.expense ?? 0,
        count: tx?.count ?? 0,
        balanceBase: live ? toBase(live.balance, live.currency) : null,
        nativeBalance: live ? live.balance : null,
        nativeCurrency: live ? live.currency : null,
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
  }, [accounts, liveList, accountEdits, toBase]);

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
      <div>
        {hasRealBalances
          ? "«Баланс» — актуальная сумма из Дзен-мани."
          : "В CSV нет остатков счетов, поэтому показано «Изменение» — доход минус расход по фильтрам."}
      </div>
      <div>«Δ Период» — изменение по текущим фильтрам.</div>
      <div>Клик по карточке или строке — фильтр графика «Дельта».</div>
      <div>Кнопка со списком в «Действиях» открывает операции счёта.</div>
      <div>
        Список показывает все счета, включая внебалансовые, — они помечены
        чипом. В расчёты совокупного баланса они попадают только при включённой
        настройке «Счета вне баланса».
      </div>
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
      switch (sortBy) {
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

  const visibleTotal = useMemo(
    () => visibleRows.reduce((sum, r) => sum + (r.balanceBase ?? r.delta), 0),
    [visibleRows]
  );

  /** Плоский список для вывода: заголовки групп вперемешку со счетами.
   *  Плоским он сделан намеренно — так и сетка карточек, и таблица остаются
   *  одним `map`, а заголовок просто занимает всю ширину ряда. */
  type ListItem =
    | { kind: "header"; key: string; label: string; count: number; sum: number }
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
        sum: rows.reduce((s, r) => s + (r.balanceBase ?? r.delta), 0),
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
      });
      for (const r of g.rows) out.push({ kind: "row", key: r.account, row: r });
    }
    return out;
  }, [visibleRows, groupBy]);
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
  // Unsynced drafts live in `baseTxs` but not in the API balances — keep them
  // out of the stacked chart's real-balance anchor so the line isn't shifted
  // by the draft amount (issue #18).
  const drafts = useDraftsStore((s) => s.drafts);
  const unsyncedIds = useMemo(() => new Set(Object.keys(drafts)), [drafts]);
  const stacked = useMemo(
    () =>
      stackedBalanceByAccount(
        baseTxs,
        8,
        hasRealBalances ? realBalancesByAccount : null,
        unsyncedIds
      ),
    [baseTxs, hasRealBalances, realBalancesByAccount, unsyncedIds]
  );
  const netWorth = useNetWorthSeries(baseTxs);

  // Stacked-chart tooltip: per-account rows + a bold «Итого» — the day's net
  // worth, which the chart already carries on each datum as `total` (issue #27).
  const renderStackedTooltip = ({ active, payload, label }: TooltipContentProps) => {
    if (!active || !payload || payload.length === 0) return null;
    const datum = payload[0]?.payload as { total?: number } | undefined;
    const total = datum?.total ?? payload.reduce((s, p) => s + toNum(p.value), 0);
    return (
      <div style={chartTooltipStyle}>
        <div className="text-xs text-muted mb-1">{formatDate(label as string)}</div>
        <div className="space-y-0.5">
          {payload.map((p) => (
            <div key={String(p.dataKey)} className="flex items-center gap-3 text-sm">
              <span
                className="w-2.5 h-2.5 rounded-[2px] shrink-0"
                style={{ background: p.color as string }}
              />
              <span className="flex-1 min-w-0 truncate">{p.name}</span>
              <span className="tabular-nums">
                {formatMoney(toNum(p.value), base, { signed: true })}
              </span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 text-sm font-semibold mt-1 pt-1 border-t border-border">
          <span className="w-2.5 shrink-0" />
          <span className="flex-1">Итого</span>
          <span className="tabular-nums">{formatMoney(total, base, { signed: true })}</span>
        </div>
      </div>
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
  const peakNetWorth = netWorth.reduce((m, p) => Math.max(m, p.net), 0);
  const lastNetWorth = netWorth.length ? netWorth[netWorth.length - 1].net : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Wallet}
        title="Счета"
        hint="Данные по всем счетам, их балансы и другая аналитика."
        right={
          <div className="flex flex-wrap gap-2">
            <div className="flex bg-panel2 rounded-lg p-1 border border-border">
              <button
                onClick={() => setScope("all")}
                className={`px-3 py-1 text-xs rounded-md ${scope === "all" ? "bg-accent text-accent-fg" : "text-muted"}`}
              >
                Вся история
              </button>
              <button
                onClick={() => setScope("filtered")}
                className={`px-3 py-1 text-xs rounded-md ${scope === "filtered" ? "bg-accent text-accent-fg" : "text-muted"}`}
              >
                По фильтрам
              </button>
            </div>
            <div className="flex bg-panel2 rounded-lg p-1 border border-border">
              <button
                onClick={() => setView("stacked")}
                className={`px-3 py-1 text-xs rounded-md flex items-center gap-1 ${view === "stacked" ? "bg-accent text-accent-fg" : "text-muted"}`}
              >
                <Layers className="w-3 h-3" />
                По счетам
              </button>
              <button
                onClick={() => setView("single")}
                className={`px-3 py-1 text-xs rounded-md flex items-center gap-1 ${view === "single" ? "bg-accent text-accent-fg" : "text-muted"}`}
              >
                <LineChartIcon className="w-3 h-3" />
                Совокупно
              </button>
            </div>
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
      <GlobalFilters />

      {calibOpen && !zenToken && (
        <div className="card card-pad bg-accent2/5 border-accent2/40">
          <div className="font-semibold mb-2 flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-accent2" />
            Калибровка совокупного баланса
          </div>
          <p className="text-xs text-muted mb-4">
            CSV не содержит начальных остатков счетов — поэтому без калибровки график показывает
            <em> изменение</em> богатства, а не реальный баланс. Введите вашу <b>текущую</b> сумму
            на всех счетах — весь график сдвинется так, чтобы на эту дату показал указанное
            значение.
          </p>

          {anchors.length > 0 && (
            <div className="mb-3 p-3 rounded-lg bg-panel2 border border-border flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">
                  В данных найдены {anchors.length} «якорных» операций
                </div>
                <div className="text-xs text-muted mt-1">
                  Дзен-мани иногда экспортирует «Корректировка остатка» / «Начальный остаток» как
                  обычные транзакции. Самая свежая:{" "}
                  {anchors[0].tx.date} · {anchors[0].tx.categoryFull}
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
            Применяется только к графику «Совокупно» и KPI-карточке «Совокупный баланс».
            Сток-чарт «По счетам» остаётся «от нуля» — он показывает изменения, не остатки.
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat
          label="Совокупный баланс"
          tone={lastNetWorth >= 0 ? "income" : "expense"}
          value={formatMoney(lastNetWorth, base, { signed: true })}
          hint={scope === "all" ? "Вся история" : "В пределах фильтра"}
        />
        <Stat
          label="Пиковое значение"
          tone="accent"
          value={formatMoney(peakNetWorth, base)}
          hint="Максимум за период графика"
        />
        <Stat
          label="Доходы (фильтр)"
          tone="income"
          value={formatMoney(totalIncome, base)}
          hint="Без переводов между счетами"
        />
        <Stat
          label="Расходы (фильтр)"
          tone="expense"
          value={formatMoney(totalExpense, base)}
          hint="Без переводов между счетами"
        />
      </div>

      <div className="card card-pad">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="font-semibold">
              {view === "stacked"
                ? hasRealBalances
                  ? "Баланс по счетам (стопкой)"
                  : "Накопленный поток по счетам (стопкой)"
                : "Совокупный баланс (одной линией)"}
            </div>
            <div className="text-xs text-muted">
              {view === "stacked"
                ? hasRealBalances
                  ? "Реальные остатки по счетам · вся история, без фильтров"
                  : "Накопление с нуля, без стартовых остатков · без фильтров"
                : scope === "all"
                  ? "Все транзакции, без учёта фильтров"
                  : "С учётом фильтров"}
              {view === "stacked" && ` · топ-${stacked.accounts.length} счетов`}
            </div>
          </div>
        </div>
        <div className="h-96">
          {view === "stacked" ? (
            <ResponsiveContainer>
              <AreaChart data={stacked.series}>
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
                  tickFormatter={(v) => formatNum(v, { compact: true })}
                />
                <Tooltip {...chartTooltipProps} content={renderStackedTooltip} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {stacked.accounts.map((acc, i) => (
                  <Area
                    key={acc}
                    type="monotone"
                    dataKey={acc}
                    stackId="1"
                    stroke={STACK_COLORS[i % STACK_COLORS.length]}
                    fill={STACK_COLORS[i % STACK_COLORS.length]}
                    fillOpacity={0.7}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer>
              <ComposedChart data={netWorth}>
                <defs>
                  <linearGradient id="netfill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22D3EE" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="#22D3EE" stopOpacity={0} />
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
                  tickFormatter={(v) => formatNum(v, { compact: true })}
                />
                <Tooltip
                  {...chartTooltipProps}
                  labelFormatter={(d) => formatDate(d as string)}
                  formatter={(v: unknown) => [
                    formatMoney(toNum(v), base, { signed: true }),
                    "Баланс",
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="net"
                  stroke="#22D3EE"
                  strokeWidth={2}
                  fill="url(#netfill)"
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="card card-pad">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="font-semibold">
              {selectedAccount ? `Дельта по счёту: ${selectedAccount}` : "Дельта по фильтру"}
            </div>
            <div className="text-xs text-muted">
              Изменение баланса за период (нарастающим итогом)
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
                  <stop offset="0%" stopColor="#A78BFA" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#A78BFA" stopOpacity={0} />
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
              <Tooltip
                {...chartTooltipProps}
                labelFormatter={(d) => formatDate(d as string)}
                formatter={(v: unknown, n: unknown) => [
                  formatMoney(toNum(v), base, { signed: true }),
                  n === "balance" ? "Баланс" : "Дельта",
                ]}
              />
              <Area
                type="monotone"
                dataKey="balance"
                stroke="#A78BFA"
                strokeWidth={2}
                fill="url(#bal)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat
          label="Чистая дельта (фильтр)"
          tone={totalNet >= 0 ? "income" : "expense"}
          value={formatMoney(totalNet, base, { signed: true })}
          hint="По текущим фильтрам"
        />
        <Stat
          label="Чистая дельта (вся история)"
          tone={totalAllAccounts >= 0 ? "income" : "expense"}
          value={formatMoney(totalAllAccounts, base, { signed: true })}
          hint="Без фильтров"
        />
        <Stat
          label="Счетов"
          value={accountsAll.length}
          hint={`${accounts.length} в фильтре`}
        />
      </div>

      <div className="card card-pad">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {/* Ширина заголовка зафиксирована ровно под трёхзначный счётчик
              (замер: «Счета (999)» — 115 px): иначе переход с «Счета (1)» на
              «Счета (999)» сдвигает всю строку кнопок прямо под курсором.
              Больше не резервируем — лишний запас читается как дыра. */}
          <div className="font-semibold flex items-center gap-2 mr-1 min-w-[7.5rem]">
            <Wallet className="w-4 h-4 shrink-0" />
            <span>
              Счета (<span className="tabular-nums">{visibleRows.length}</span>)
            </span>
          </div>
          {/* Итог по видимому списку. Показываем всегда, когда есть что
              складывать: при включённых отборах это ответ на «сколько всего
              на накопительных», а без них — просто сумма всех счетов. */}
          {visibleRows.length > 0 && (
            <span
              className="text-xs text-muted tabular-nums shrink-0 mr-1"
              title={
                (hasRealBalances
                  ? "Сумма остатков по счетам из списка"
                  : "Сумма изменений за период по счетам из списка") +
                (hiddenCount > 0
                  ? hiddenCount === dormantCount
                    ? `. Не показано счетов: ${hiddenCount} — с нулевым остатком и без операций`
                    : dormantCount > 0
                      ? `. Не показано счетов: ${hiddenCount}, из них ${dormantCount} с нулевым остатком и без операций, остальные отсеяны отборами`
                      : `. Не показано счетов: ${hiddenCount} — отсеяны отборами`
                  : "")
              }
            >
              {hasRealBalances ? "Остаток" : "Изменение"}:{" "}
              <span className="text-text font-medium">
                {formatMoney(visibleTotal, base)}
              </span>
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
                    onChange={() => setOnlySavings((v) => !v)}
                    icon={PiggyBank}
                    label="Только накопительные"
                  />
                  <CheckItem
                    checked={effectiveHideArchived}
                    onChange={() => setHideArchived((v) => !v)}
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
                    setGroupBy(o.value);
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
            className="ml-auto flex bg-panel2 rounded-lg p-1 border border-border"
          >
            <button
              onClick={() => {
                setAccountsView("table");
                // В таблице колонки «Банк» нет: заголовки не подсветятся, и
                // порядок будет выглядеть случайным. Возвращаемся к сумме.
                if (sortBy === "bank") pickSort("balance");
              }}
              aria-pressed={accountsView === "table"}
              className={`px-3 py-1 text-xs rounded-md flex items-center gap-1 ${
                accountsView === "table" ? "bg-accent text-accent-fg" : "text-muted"
              }`}
            >
              <TableIcon className="w-3 h-3" />
              Таблица
            </button>
            <button
              onClick={() => {
                setAccountsView("cards");
                // «Поступления», «Опер.» и прочие колонки в карточках выбрать
                // нечем, поэтому меню сортировки показывало бы порядок, которого
                // в нём нет. Возвращаемся к сумме — она есть на каждой карточке.
                if (!CARD_SORT_OPTIONS.some((o) => o.value === sortBy)) pickSort("balance");
              }}
              aria-pressed={accountsView === "cards"}
              className={`px-3 py-1 text-xs rounded-md flex items-center gap-1 ${
                accountsView === "cards" ? "bg-accent text-accent-fg" : "text-muted"
              }`}
            >
              <LayoutGrid className="w-3 h-3" />
              Карточки
            </button>
          </div>
          <AppTooltip content={listHint} placement="bottom">
            <button
              className="btn-ghost !p-1.5 text-muted hover:text-accent shrink-0"
              aria-label="Как читать список счетов"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
          </AppTooltip>
        </div>

        {visibleRows.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted">
            <div>Под текущие отборы не подошёл ни один счёт.</div>
            <button
              onClick={() => {
                setTypeFilter(new Set());
                setBankFilter(new Set());
                setBalanceScope("all");
                setOnlySavings(false);
                setHideArchived(false);
              }}
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
                  </div>
                );
              }
              const a = item.row;
              const isSel = selectedAccount === a.account;
              const hasReal = a.balanceBase !== null;
              // Headline = real balance when known, else the flow delta.
              const headline = hasReal ? a.balanceBase! : a.delta;
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
                      <span className="pill text-[10px]">{a.count}</span>
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
                      {hasReal ? "Баланс" : "Изменение"}
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
                      {hasReal ? (
                        <span title="Изменение по текущим фильтрам">
                          Δ {formatMoney(a.delta, base, { signed: true })}
                        </span>
                      ) : (
                        <span />
                      )}
                      <span className="flex gap-2">
                        <span className="text-income">
                          +{formatMoney(a.income, base)}
                        </span>
                        <span className="text-expense">
                          −{formatMoney(a.expense, base)}
                        </span>
                      </span>
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
                hasForeignCurrency ? "min-w-[1212px]" : "min-w-[1122px]"
              }`}
            >
              <colgroup>
                <col />
                {/* 170px = самая длинная подпись вида счёта («Накопительный
                    счёт», замер 140px) плюс отступы ячейки: иначе она режется
                    многоточием у большинства счетов. */}
                <col style={{ width: 170 }} />
                <col style={{ width: hasForeignCurrency ? 230 : 140 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 126 }} />
                <col style={{ width: 96 }} />
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
                  <SortTh sortKey="balance" align="right" {...sortHead}>
                    {hasRealBalances ? "Баланс" : "Изменение"}
                  </SortTh>
                  <SortTh sortKey="income" align="right" {...sortHead}>
                    Поступления
                  </SortTh>
                  <SortTh sortKey="expense" align="right" {...sortHead}>
                    Списания
                  </SortTh>
                  <SortTh sortKey="delta" align="right" {...sortHead}>
                    Δ Период
                  </SortTh>
                  <SortTh sortKey="count" align="center" {...sortHead}>
                    Операции
                  </SortTh>
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
                        {/* Сумма группы стоит ровно под колонкой баланса —
                            иначе её пришлось бы искать глазами. */}
                        <td
                          className={`table-td text-right tabular-nums font-semibold whitespace-nowrap ${
                            item.sum < 0 ? "text-expense" : "text-text"
                          }`}
                        >
                          {formatMoney(item.sum, base)}
                        </td>
                        <td className="table-td" colSpan={5} />
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
                  return (
                    <tr
                      key={a.account}
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
                      <td className="table-td">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openAccount(a.account);
                            }}
                            className="btn-ghost !p-1.5 text-muted hover:text-accent"
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
                              "btn-ghost !p-1.5",
                              sliceExcludedAccounts.has(a.account)
                                ? "text-warn bg-warn/10"
                                : "text-muted hover:text-accent"
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
                              className="btn-ghost !p-1.5 text-muted hover:text-accent"
                              title="Изменить счёт"
                              aria-label="Изменить счёт"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
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
