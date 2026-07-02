import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  PieChart,
  Wallet,
  TrendingUp,
  GitCompare,
  LineChart,
  ListChecks,
  CalendarDays,
  Hash,
  Repeat,
  MoreHorizontal,
  LayoutDashboard,
  Activity,
  Target,
  Zap,
  Search,
  Copy,
  Tag,
  GitFork,
  Wand2,
  HelpCircle,
  Cloud,
  HeartPulse,
  FlaskConical,
  Sparkles,
  Newspaper,
  Percent,
  Settings,
  Menu,
  X,
} from "lucide-react";
import clsx from "clsx";
import { useThemeStore } from "../store/useThemeStore";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { HeaderSyncActions } from "./HeaderSyncActions";
import logoHorizontal from "../assets/logo-horizontal.svg";
import logoHorizontalDark from "../assets/logo-horizontal-dark.svg";

const PRIMARY = [
  { to: "/", label: "Главная", icon: LayoutDashboard },
  { to: "/transactions", label: "Операции", icon: ListChecks },
  { to: "/accounts", label: "Счета", icon: Wallet },
  { to: "/categories", label: "Категории", icon: PieChart },
];

// «Ещё» разбито на смысловые разделы с заголовками-разделителями:
// Аналитика (смотреть/понять), Планы (цели и бюджеты), Инструменты
// (порядок в данных). «Финансовое здоровье» — первым пунктом.
const SECONDARY_GROUPS = [
  {
    title: "Аналитика",
    items: [
      { to: "/health", label: "Финансовое здоровье", icon: HeartPulse },
      { to: "/trends", label: "Тренды", icon: Activity },
      { to: "/cashflow", label: "Cash-flow", icon: LineChart },
      { to: "/compare", label: "Сравнение", icon: GitCompare },
      { to: "/top", label: "Топ", icon: TrendingUp },
      { to: "/calendar", label: "Календарь", icon: CalendarDays },
      { to: "/sankey", label: "Потоки", icon: GitFork },
      { to: "/year-review", label: "Год в цифрах", icon: Sparkles },
      { to: "/digest", label: "Дайджест", icon: Newspaper },
    ],
  },
  {
    title: "Планы",
    items: [
      { to: "/goals", label: "Цели", icon: Target },
      { to: "/budgets", label: "Бюджеты", icon: Target },
      { to: "/50-30-20", label: "50/30/20", icon: Percent },
      { to: "/whatif", label: "Что-если", icon: FlaskConical },
    ],
  },
  {
    title: "Инструменты",
    items: [
      { to: "/uncategorized", label: "Без категории", icon: Tag },
      { to: "/duplicates", label: "Дубликаты", icon: Copy },
      { to: "/anomalies", label: "Аномалии", icon: Zap },
      { to: "/recurring", label: "Регулярные", icon: Repeat },
      { to: "/rules", label: "Правила", icon: Wand2 },
      { to: "/tags", label: "Теги", icon: Hash },
      { to: "/wordcloud", label: "Облако слов", icon: Cloud },
    ],
  },
];

const SECONDARY = SECONDARY_GROUPS.flatMap((g) => g.items);

export function TopNav({ onOpenPalette }: { onOpenPalette?: () => void }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  const theme = useThemeStore((s) => s.resolved);

  const inSecondary = SECONDARY.some((s) => loc.pathname === s.to);

  return (
    <header className="border-b border-border bg-panel/80 backdrop-blur sticky top-0 z-30">
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-3 flex items-center gap-3 md:gap-6">
        <img
          src={theme === "dark" ? logoHorizontalDark : logoHorizontal}
          alt="DzenAnalytics"
          className="h-12 w-auto shrink-0"
        />

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-1 ml-2 flex-1">
          {PRIMARY.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
                  isActive
                    ? "bg-accent/10 text-accent"
                    : "text-muted hover:text-text hover:bg-panel2"
                )
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}

          <div className="relative">
            <button
              onClick={() => setMoreOpen((o) => !o)}
              className={clsx(
                "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
                inSecondary
                  ? "bg-accent/10 text-accent"
                  : "text-muted hover:text-text hover:bg-panel2"
              )}
            >
              <MoreHorizontal className="w-4 h-4" />
              Ещё
            </button>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMoreOpen(false)} />
                <div className="absolute z-20 mt-1 w-56 card p-1.5 left-0 max-h-[70vh] overflow-y-auto">
                  {SECONDARY_GROUPS.map((group, gi) => (
                    <div
                      key={group.title}
                      className={gi > 0 ? "mt-1 pt-1 border-t border-border" : ""}
                    >
                      <div className="text-[10px] uppercase tracking-wider text-muted px-3 pt-1 pb-0.5">
                        {group.title}
                      </div>
                      {group.items.map(({ to, label, icon: Icon }) => (
                        <NavLink
                          key={to}
                          to={to}
                          onClick={() => setMoreOpen(false)}
                          className={({ isActive }) =>
                            clsx(
                              "flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors",
                              isActive
                                ? "bg-accent/10 text-accent"
                                : "text-muted hover:text-text hover:bg-panel2"
                            )
                          }
                        >
                          <Icon className="w-4 h-4" />
                          {label}
                        </NavLink>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </nav>

        {/* Spacer on mobile pushes right group to the end */}
        <div className="flex-1 lg:hidden" />

        {/* Command palette trigger. Widened (min/max width with
            `justify-between`) so it reads more as a search field than
            a button — the ⌘K hotkey sits flush right, leaving room for
            the placeholder text to feel airier. */}
        <button
          onClick={onOpenPalette}
          className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs border bg-panel2 text-muted hover:text-text border-border min-w-[220px] lg:min-w-[260px] justify-between"
          title="Командная палитра (Ctrl+K)"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Search className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Команды…</span>
          </span>
          <kbd className="kbd hidden lg:inline-block shrink-0">⌘K</kbd>
        </button>
        <button
          onClick={onOpenPalette}
          className="md:hidden p-1.5 rounded-lg border border-border bg-panel2 text-muted"
          title="Командная палитра"
        >
          <Search className="w-4 h-4" />
        </button>

        <ThemeSwitcher />

        {/* Zenmoney sync quick actions — incremental + full re-sync.
            Hidden when no token is configured (CSV-mode users see a
            clean header without dangling icons). Lives next to the
            gear because that's where the token gets connected. */}
        <HeaderSyncActions />

        {/* Settings — gear icon. Active style matches PRIMARY nav (bg-accent/10
            text-accent) so the whole header speaks one design language. */}
        <NavLink
          to="/settings"
          title="Настройки"
          className={({ isActive }) =>
            clsx(
              "group relative p-1.5 rounded-lg border transition-colors",
              isActive
                ? "bg-accent/10 border-accent/30 text-accent"
                : "border-border bg-panel2 text-muted hover:text-accent hover:border-accent/50"
            )
          }
        >
          <Settings
            className="w-4 h-4 transition-transform duration-500 ease-out group-hover:rotate-90"
          />
        </NavLink>

        {/* Help — question icon. Same active treatment as Settings. */}
        <NavLink
          to="/help"
          title="Справка"
          className={({ isActive }) =>
            clsx(
              "group relative p-1.5 rounded-lg border transition-colors",
              isActive
                ? "bg-accent/10 border-accent/30 text-accent"
                : "border-border bg-panel2 text-muted hover:text-accent hover:border-accent/50"
            )
          }
        >
          <HelpCircle className="w-4 h-4 transition-transform duration-300 ease-out group-hover:scale-110" />
        </NavLink>

        {/* Mobile burger */}
        <button
          onClick={() => setMobileOpen(true)}
          className="lg:hidden p-1.5 rounded-lg border border-border bg-panel2 text-muted"
          title="Меню"
        >
          <Menu className="w-4 h-4" />
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute right-0 top-0 bottom-0 w-[80vw] max-w-[320px] bg-bg border-l border-border flex flex-col animate-slide">
            <div className="px-4 py-4 border-b border-border flex items-center justify-between">
              <span className="font-semibold">Меню</span>
              <button
                onClick={() => setMobileOpen(false)}
                className="p-1.5 text-muted hover:text-text"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto py-2">
              <div className="text-[10px] uppercase tracking-wider text-muted px-4 pt-2 pb-1">
                Основное
              </div>
              {PRIMARY.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === "/"}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    clsx(
                      "flex items-center gap-3 px-4 py-2.5 text-sm",
                      isActive
                        ? "bg-accent/10 text-accent"
                        : "text-muted hover:text-text hover:bg-panel2"
                    )
                  }
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </NavLink>
              ))}
              {SECONDARY_GROUPS.map((group) => (
                <div key={group.title}>
                  <div className="text-[10px] uppercase tracking-wider text-muted px-4 pt-3 pb-1">
                    {group.title}
                  </div>
                  {group.items.map(({ to, label, icon: Icon }) => (
                    <NavLink
                      key={to}
                      to={to}
                      onClick={() => setMobileOpen(false)}
                      className={({ isActive }) =>
                        clsx(
                          "flex items-center gap-3 px-4 py-2.5 text-sm",
                          isActive
                            ? "bg-accent/10 text-accent"
                            : "text-muted hover:text-text hover:bg-panel2"
                        )
                      }
                    >
                      <Icon className="w-4 h-4" />
                      {label}
                    </NavLink>
                  ))}
                </div>
              ))}
            </nav>
          </aside>
        </div>
      )}
    </header>
  );
}
