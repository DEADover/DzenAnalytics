import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search as SearchIcon,
  ArrowRight,
  LayoutDashboard,
  LineChart,
  ListChecks,
  PieChart,
  Wallet,
  Activity,
  Target,
  HeartPulse,
  CalendarDays,
  TrendingUp,
  Hash,
  Repeat,
  Zap,
  Copy,
  Tag,
  GitFork,
  Bookmark,
  GitCompare,
  Upload,
  HelpCircle,
  Wand2,
  Search as SearchPageIcon,
  Sun,
  Moon,
  Monitor,
  Trash2,
} from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useDrillStore } from "../store/useDrillStore";
import { useThemeStore } from "../store/useThemeStore";
import { useFiltersStore } from "../store/useFiltersStore";
import { useSavedViewsStore } from "../store/useSavedViewsStore";
import { groupByCategory, topPayees, NO_PAYEE_LABEL } from "../lib/aggregations";
import { monthLabel, ymKey } from "../lib/format";

interface Item {
  id: string;
  group: string;
  title: string;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const PAGE_ITEMS: { path: string; title: string; icon: React.ComponentType<{ className?: string }>; aliases: string[] }[] = [
  { path: "/", title: "Главная", icon: LayoutDashboard, aliases: ["dashboard", "home", "обзор"] },
  { path: "/transactions", title: "Операции", icon: ListChecks, aliases: ["transactions", "лента", "операции", "operations"] },
  { path: "/cashflow", title: "Cash-flow", icon: LineChart, aliases: ["кешфлоу", "cashflow", "потоки"] },
  { path: "/categories", title: "Категории", icon: PieChart, aliases: ["categories"] },
  { path: "/accounts", title: "Счета", icon: Wallet, aliases: ["accounts"] },
  { path: "/trends", title: "Тренды", icon: Activity, aliases: ["trends"] },
  { path: "/budgets", title: "Бюджеты", icon: Target, aliases: ["budgets"] },
  { path: "/goals", title: "Цели", icon: Target, aliases: ["goals", "цели"] },
  { path: "/health", title: "Финансовое здоровье", icon: HeartPulse, aliases: ["health", "fire", "здоровье", "мж", "месяцы жизни"] },
  { path: "/calendar", title: "Календарь", icon: CalendarDays, aliases: ["calendar"] },
  { path: "/top", title: "Топ", icon: TrendingUp, aliases: ["top"] },
  { path: "/tags", title: "Теги", icon: Hash, aliases: ["tags"] },
  { path: "/recurring", title: "Регулярные", icon: Repeat, aliases: ["recurring", "subscriptions"] },
  { path: "/anomalies", title: "Аномалии", icon: Zap, aliases: ["anomalies"] },
  { path: "/duplicates", title: "Дубликаты", icon: Copy, aliases: ["duplicates"] },
  { path: "/uncategorized", title: "Без категории", icon: Tag, aliases: ["uncategorized"] },
  { path: "/trash", title: "Удалённые", icon: Trash2, aliases: ["trash", "корзина", "удалённые", "удаленные", "deleted", "restore"] },
  { path: "/sankey", title: "Потоки (Sankey)", icon: GitFork, aliases: ["sankey", "flow"] },
  { path: "/wordcloud", title: "Облако слов", icon: Hash, aliases: ["wordcloud", "слова"] },
  { path: "/compare", title: "Сравнение", icon: GitCompare, aliases: ["compare"] },
  { path: "/search", title: "Поиск", icon: SearchPageIcon, aliases: ["search", "поиск"] },
  { path: "/rules", title: "Правила", icon: Wand2, aliases: ["rules"] },
  { path: "/help", title: "Справка", icon: HelpCircle, aliases: ["help", "docs"] },
  {
    path: "/settings",
    title: "Настройки",
    icon: Upload,
    aliases: ["settings", "настройки", "импорт", "import", "токен", "бэкап", "синхронизация"],
  },
];

function score(query: string, text: string, aliases: string[] = []): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(q)) return 60;
  for (const a of aliases) {
    if (a.toLowerCase().includes(q)) return 50;
  }
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  if (qi === q.length) return 30;
  return 0;
}

export function CommandPalette({ open, onClose }: Props) {
  const nav = useNavigate();
  const transactions = useDataStore((s) => s.transactions);
  const showDrill = useDrillStore((s) => s.show);
  const setMode = useThemeStore((s) => s.setMode);
  const setMonth = useFiltersStore((s) => s.setMonth);
  const views = useSavedViewsStore((s) => s.views);
  const filtersStore = useFiltersStore;

  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo<Item[]>(() => {
    const list: Item[] = [];

    for (const p of PAGE_ITEMS) {
      list.push({
        id: `page:${p.path}`,
        group: "Страницы",
        title: p.title,
        icon: p.icon,
        action: () => nav(p.path),
      });
    }

    list.push(
      { id: "theme:light", group: "Действия", title: "Светлая тема", icon: Sun, action: () => setMode("light") },
      { id: "theme:dark", group: "Действия", title: "Тёмная тема", icon: Moon, action: () => setMode("dark") },
      { id: "theme:auto", group: "Действия", title: "Тема: авто", icon: Monitor, action: () => setMode("auto") },
      {
        id: "filter:reset",
        group: "Действия",
        title: "Сбросить фильтры",
        action: () => filtersStore.getState().reset(),
      },
      {
        id: "filter:no-transfers",
        group: "Действия",
        title: "Тоггл «без переводов»",
        action: () =>
          filtersStore.getState().setExcludeTransfers(!filtersStore.getState().excludeTransfers),
      }
    );

    if (transactions.length > 0) {
      const months = new Set<string>();
      for (const t of transactions) {
        if (t.date) months.add(ymKey(t.date));
      }
      const sortedMonths = Array.from(months).sort().reverse().slice(0, 24);
      for (const ym of sortedMonths) {
        list.push({
          id: `month:${ym}`,
          group: "Месяцы",
          title: monthLabel(ym),
          hint: ym,
          icon: CalendarDays,
          action: () => setMonth(ym),
        });
      }

      const cats = groupByCategory(transactions, "top").slice(0, 25);
      for (const c of cats) {
        list.push({
          id: `cat:${c.category}`,
          group: "Категории",
          title: c.category,
          hint: `${c.count} оп.`,
          icon: PieChart,
          action: () => {
            const txs = transactions.filter((t) => t.category === c.category && t.kind !== "transfer");
            showDrill(c.category, txs, "Категория");
          },
        });
      }

      const payeesAll = topPayees(transactions, "expense", 25);
      for (const p of payeesAll) {
        list.push({
          id: `payee:${p.payee}`,
          group: "Получатели",
          title: p.payee,
          hint: `${p.count} оп.`,
          icon: TrendingUp,
          action: () => {
            const txs = transactions.filter((t) => (t.payee || NO_PAYEE_LABEL) === p.payee);
            showDrill(p.payee, txs, "Получатель");
          },
        });
      }
    }

    for (const v of views) {
      list.push({
        id: `view:${v.id}`,
        group: "Виды",
        title: v.name,
        icon: Bookmark,
        action: () => {
          const f = filtersStore.getState();
          if (v.preset === "month" && v.monthYM) f.setMonth(v.monthYM);
          else {
            f.setPreset(v.preset);
            f.setRange(v.from, v.to);
          }
          f.resetSet("accounts");
          f.resetSet("categories");
          f.resetSet("currencies");
          for (const a of v.accounts) f.toggleSet("accounts", a);
          for (const c of v.categories) f.toggleSet("categories", c);
          for (const c of v.currencies) f.toggleSet("currencies", c);
          f.setSearch(v.search);
          f.setExcludeTransfers(v.excludeTransfers);
        },
      });
    }

    return list;
  }, [transactions, views, nav, setMode, setMonth, showDrill, filtersStore]);

  const filtered = useMemo(() => {
    if (!query) return items.slice(0, 80);
    const scored = items
      .map((i) => ({
        item: i,
        s:
          score(query, i.title) +
          (i.hint ? score(query, i.hint) * 0.3 : 0) +
          (i.id.includes(query.toLowerCase()) ? 5 : 0),
      }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 50);
    return scored.map((x) => x.item);
  }, [items, query]);

  // Reset query+activeIdx every time the palette re-opens, and reset activeIdx
  // when the query changes. Both done during render via the "adjust state on
  // prior props" pattern so we don't trigger setState-in-effect lint.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setQuery("");
      setActiveIdx(0);
    }
  }

  const [prevQuery, setPrevQuery] = useState(query);
  if (query !== prevQuery) {
    setPrevQuery(query);
    setActiveIdx(0);
  }

  // Real DOM side-effects (focus, body scroll-lock) belong in an effect.
  useEffect(() => {
    if (open) {
      const id = setTimeout(() => inputRef.current?.focus(), 30);
      document.body.style.overflow = "hidden";
      return () => {
        clearTimeout(id);
        document.body.style.overflow = "";
      };
    }
    document.body.style.overflow = "";
  }, [open]);

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${activeIdx}"]`);
    if (el) (el as HTMLElement).scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  function exec(item: Item) {
    item.action();
    onClose();
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[activeIdx];
      if (item) exec(item);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  if (!open) return null;

  let lastGroup: string | null = null;

  return (
    <>
      {/* Plain dim scrim — no backdrop-filter. A full-viewport blur over
          the chart page intermittently flashes the white root background
          on open (Chromium snapshots the page to blur it). */}
      <div
        className="fixed inset-0 bg-black/50 z-50 animate-fade"
        onClick={onClose}
      />
      <div
        className="fixed top-[12%] left-1/2 -translate-x-1/2 w-[92vw] max-w-[640px] z-50 card flex flex-col"
        style={{ maxHeight: "70vh" }}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <SearchIcon className="w-5 h-5 text-muted shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Команда / страница / категория / получатель…"
            className="flex-1 bg-transparent text-base outline-none placeholder:text-muted"
          />
          <kbd className="kbd hidden md:inline-block">Esc</kbd>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="text-center text-sm text-muted py-8">Ничего не найдено</div>
          ) : (
            filtered.map((item, idx) => {
              const Icon = item.icon;
              const showGroup = item.group !== lastGroup;
              lastGroup = item.group;
              const isActive = idx === activeIdx;
              return (
                <div key={item.id}>
                  {showGroup && (
                    <div className="text-[10px] uppercase tracking-wider text-muted px-4 pt-3 pb-1">
                      {item.group}
                    </div>
                  )}
                  <button
                    data-idx={idx}
                    onClick={() => exec(item)}
                    onMouseEnter={() => setActiveIdx(idx)}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-sm text-left ${
                      isActive ? "bg-accent/15 text-accent" : "hover:bg-panel2/40"
                    }`}
                  >
                    {Icon && <Icon className="w-4 h-4 shrink-0" />}
                    <span className="truncate flex-1">{item.title}</span>
                    {item.hint && (
                      <span className="text-xs text-muted shrink-0">{item.hint}</span>
                    )}
                    {isActive && <ArrowRight className="w-3.5 h-3.5 shrink-0" />}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="px-4 py-2 border-t border-border flex items-center gap-3 text-[10px] text-muted">
          <span>
            <kbd className="kbd">↑↓</kbd> навигация
          </span>
          <span>
            <kbd className="kbd">↵</kbd> выбрать
          </span>
          <span>
            <kbd className="kbd">Esc</kbd> закрыть
          </span>
          <span className="ml-auto">{filtered.length} из {items.length}</span>
        </div>
      </div>
    </>
  );
}

// `useGlobalShortcuts` lives in `../hooks/useGlobalShortcuts.ts` so this file
// only exports React components — required for fast-refresh.
