import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  BarChart3,
  ClipboardList,
  Target,
  Zap,
  Search,
  Copy,
  Tag,
  GitFork,
  Wand2,
  HelpCircle,
  Table,
  Cloud,
  HeartPulse,
  FlaskConical,
  Sparkles,
  Newspaper,
  Percent,
  Settings,
  Menu,
  Trash2,
  X,
} from "lucide-react";
import clsx from "clsx";
import { useThemeStore } from "../store/useThemeStore";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { HeaderSyncActions } from "./HeaderSyncActions";
import { SliceSwitcher } from "./SliceSwitcher";
import { useSlicesStore } from "../store/useSlicesStore";
import logoHorizontal from "../assets/logo-horizontal.svg";
import logoHorizontalDark from "../assets/logo-horizontal-dark.svg";

const PRIMARY = [
  { to: "/", label: "Главная", icon: LayoutDashboard },
  { to: "/transactions", label: "Операции", icon: ListChecks },
  { to: "/accounts", label: "Счета", icon: Wallet },
  { to: "/categories", label: "Категории", icon: PieChart },
];

// «Ещё» разбито на смысловые разделы с заголовками-разделителями. У каждого
// пункта своя строчка-пояснение: в списке из двадцати трёх названий «Динамика»,
// «Тренды» и «Cash-flow» на слух не различаются, а панель во всю ширину как раз
// даёт место объяснить разницу. Тексты сжаты из подзаголовков самих страниц,
// чтобы меню и страница говорили одно и то же.
// Аналитика (смотреть/понять), Планы (цели и бюджеты), Инструменты
// (порядок в данных). «Финансовое здоровье» — первым пунктом.
const SECONDARY_GROUPS = [
  {
    title: "Аналитика",
    items: [
      { to: "/health", label: "Финансовое здоровье", icon: HeartPulse, hint: "Насколько устойчивы финансы сейчас" },
      { to: "/report", label: "Доходы и расходы", icon: Table, hint: "Все категории по периодам, таблицей" },
      { to: "/dynamics", label: "Динамика", icon: Activity, hint: "Операции на временной оси" },
      { to: "/trends", label: "Тренды", icon: BarChart3, hint: "Помесячно и по дням недели" },
      { to: "/cashflow", label: "Cash-flow", icon: LineChart, hint: "Доходы, расходы и чистый поток" },
      { to: "/compare", label: "Сравнение", icon: GitCompare, hint: "Два периода рядом" },
      { to: "/top", label: "Топ", icon: TrendingUp, hint: "Крупнейшие категории и получатели" },
      { to: "/calendar", label: "Календарь", icon: CalendarDays, hint: "Тепловая карта по дням" },
      { to: "/sankey", label: "Потоки", icon: GitFork, hint: "Откуда пришло и куда ушло" },
      { to: "/year-review", label: "Год в цифрах", icon: Sparkles, hint: "Итоги года одной страницей" },
      { to: "/digest", label: "Дайджест", icon: Newspaper, hint: "Сводка по неделям и месяцам" },
    ],
  },
  {
    title: "Планы",
    items: [
      { to: "/goals", label: "Цели", icon: Target, hint: "Накопить к сроку" },
      { to: "/budgets", label: "Бюджеты", icon: ClipboardList, hint: "План и факт по статьям" },
      { to: "/50-30-20", label: "50/30/20", icon: Percent, hint: "Нужды, желания, сбережения" },
      { to: "/whatif", label: "Что-если", icon: FlaskConical, hint: "Прикинуть, как изменится картина" },
    ],
  },
  {
    title: "Инструменты",
    items: [
      { to: "/uncategorized", label: "Без категории", icon: Tag, hint: "Разнести операции без статьи" },
      { to: "/duplicates", label: "Дубликаты", icon: Copy, hint: "Найти задвоенные операции" },
      { to: "/anomalies", label: "Аномалии", icon: Zap, hint: "Необычные траты месяца" },
      { to: "/recurring", label: "Регулярные", icon: Repeat, hint: "Подписки и планы из Дзен-мани" },
      { to: "/rules", label: "Правила", icon: Wand2, hint: "Категории и получатели по условию" },
      { to: "/tags", label: "Теги", icon: Hash, hint: "Хэштеги в комментариях операций" },
      { to: "/wordcloud", label: "Облако слов", icon: Cloud, hint: "Частые слова в комментариях" },
      { to: "/trash", label: "Корзина", icon: Trash2, hint: "Удалённые операции" },
    ],
  },
];

const SECONDARY = SECONDARY_GROUPS.flatMap((g) => g.items);

/** Пункт меню в дорожке: те же размеры и та же пилюля, что у `Segmented`. */
const NAV_ITEM =
  "inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[14px] font-medium whitespace-nowrap transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";
const NAV_ITEM_ACTIVE =
  "bg-accent text-accent-fg shadow-[0_6px_16px_-8px_rgb(var(--c-accent))]";
const NAV_ITEM_IDLE = "text-muted hover:text-text hover:bg-panel/70";

export function TopNav({ onOpenPalette }: { onOpenPalette?: () => void }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  // Переключатель разреза появляется только со второго разреза — от этого
  // зависит, нужен ли разделитель внутри панели.
  const hasSlices = useSlicesStore((s) => s.slices.length) > 1;
  const theme = useThemeStore((s) => s.resolved);

  const inSecondary = SECONDARY.some((s) => loc.pathname === s.to);

  // Панель закрывается по Escape — она большая, накрывает пол-экрана, и уводить
  // руку к мыши ради «передумал» незачем.
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  // Высота шапки уезжает в CSS-переменную: под неё паркуются липкие шапки
  // таблиц. Числом её не задать — она зависит от размера корневого шрифта
  // (у человека с крупным системным шрифтом это уже не 73px, а 90+), от
  // рамки снизу и от переносов на узком экране. Раньше константа стояла
  // прямо в стилях, и при увеличенном шрифте шапка приложения накрывала
  // заголовки столбцов.
  const headerRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const apply = () =>
      document.documentElement.style.setProperty(
        "--app-header-h",
        `${el.getBoundingClientRect().height}px`
      );
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <header
      ref={headerRef}
      className="relative border-b border-border bg-panel/80 backdrop-blur sticky top-0 z-30"
    >
      <div className="w-full px-4 md:px-6 py-3 flex items-center gap-3 md:gap-6">
        {/* Меню стоит посередине СВОБОДНОГО МЕСТА — между знаком и кнопками, —
            а не посередине шапки. Разница видна сразу: знак занимает 275
            пикселей, кнопки справа под 450, и меню, выставленное по центру
            шапки, честно стоит по центру, но читается сдвинутым вправо — слева
            от него пустоты вдвое больше. Глаз меряет просветы, а не координаты,
            поэтому равняем именно их. */}
        <div className="flex items-center shrink-0">
          <img
            src={theme === "dark" ? logoHorizontalDark : logoHorizontal}
            alt="DzenAnalytics"
            className="h-12 w-auto shrink-0"
          />
        </div>

        {/* Обёртка держит свободное место и на узком экране, где само меню
            спрятано: без неё кнопки справа сползались бы к знаку. */}
        <div className="flex-1 flex justify-center min-w-0">
        {/* Desktop nav.

            Меню собрано в одну дорожку — подложка, кант, мягкая тень, — а не
            рассыпано отдельными надписями. Ровно так же набраны переключатели
            разделов на «Счетах» и «Категориях», и это не совпадение: и там, и
            здесь выбирают один вариант из нескольких, значит и выглядеть должно
            одинаково. Выбранный пункт залит целиком, а не десятью процентами
            цвета, — прежнюю бледную заливку на светлой теме приходилось искать
            глазами. */}
        <nav className="hidden lg:inline-flex items-center gap-0.5 shrink-0 rounded-full p-1 bg-panel2 border border-border shadow-tray">
          {PRIMARY.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                clsx(
                  NAV_ITEM,
                  isActive ? NAV_ITEM_ACTIVE : NAV_ITEM_IDLE
                )
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}

          <div>
            <button
              onClick={() => setMoreOpen((o) => !o)}
              aria-expanded={moreOpen}
              aria-haspopup="true"
              className={clsx(
                NAV_ITEM,
                moreOpen || inSecondary ? NAV_ITEM_ACTIVE : NAV_ITEM_IDLE
              )}
            >
              <MoreHorizontal className="w-4 h-4" />
              Ещё
            </button>
          </div>
        </nav>
        </div>

        {/* Правая зона. Тот же вес, что и у левой, — этим и держится середина.
            Внутри: сперва данные (поиск, разрез, обмен с облаком), затем
            системные кнопки. Разделены не рамкой ради рамки, а смыслом. */}
        <div className="flex items-center gap-3 md:gap-6 shrink-0">
        <div className="inline-flex items-stretch shrink-0 rounded-full border border-border bg-panel2 overflow-hidden">
          <button
            onClick={onOpenPalette}
            className="p-1.5 text-muted hover:text-accent hover:bg-accent/10 transition-colors"
            title="Команды и поиск (⌘K / Ctrl+K)"
            aria-label="Команды и поиск"
          >
            <Search className="w-4 h-4" />
          </button>
          {hasSlices && (
            <>
              <div className="w-px bg-border self-stretch" />
              <SliceSwitcher inline />
            </>
          )}
        </div>

        <HeaderSyncActions />

        {/* Системная зона — приглушена и отодвинута к краю: сюда заходят
            изредка. */}
        <div className="flex items-center gap-1.5 shrink-0">
        <ThemeSwitcher />

        {/* Settings — gear icon. Active style matches PRIMARY nav (bg-accent/10
            text-accent) so the whole header speaks one design language. */}
        <NavLink
          to="/settings"
          title="Настройки"
          className={({ isActive }) =>
            clsx(
              "group relative p-1.5 rounded-full transition-colors duration-200",
              isActive
                ? "bg-accent/10 text-accent"
                : "text-muted hover:text-accent hover:bg-accent/10"
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
              "group relative p-1.5 rounded-full transition-colors duration-200",
              isActive
                ? "bg-accent/10 text-accent"
                : "text-muted hover:text-accent hover:bg-accent/10"
            )
          }
        >
          <HelpCircle className="w-4 h-4 transition-transform duration-300 ease-out group-hover:scale-110" />
        </NavLink>
        </div>

        {/* Mobile burger */}
        <button
          onClick={() => setMobileOpen(true)}
          className="lg:hidden p-1.5 rounded-full border border-border bg-panel2 text-muted"
          title="Меню"
        >
          <Menu className="w-4 h-4" />
        </button>
        </div>
      </div>

      {/* ── «Ещё»: панель во всю ширину шапки ──
          Прежде это был столбец в 224 пикселя с прокруткой на семидесяти
          процентах высоты экрана: двадцать три пункта из двадцати семи жили в
          нём, и чтобы дойти до нижних, приходилось скроллить меню. Экран
          широкий — раскладываем их в три колонки и показываем разом.

          Панель считается от ШАПКИ, а не от кнопки: кнопка стоит по центру, и
          привязанная к ней панель уехала бы вбок. */}
      {moreOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setMoreOpen(false)}
            aria-hidden="true"
          />
          <div className="hidden lg:block absolute left-0 right-0 top-full z-20 px-4 md:px-6 pt-1">
            <div className="card-tray p-5 3xl:p-6">
              {/* Колонки прижаты к середине, под меню, а не растянуты по всей
                  ширине: на мониторе в 1800 пикселей колонка выходила по 539, а
                  текста в ней на 250 — строки повисали в пустоте и переставали
                  читаться как список. */}
              <div className="grid grid-cols-3 gap-x-10 gap-y-1 max-w-[64rem] mx-auto">
                {SECONDARY_GROUPS.map((group) => (
                  <div key={group.title}>
                    <div className="text-[11px] uppercase tracking-[0.14em] text-muted font-medium px-2.5 pb-2">
                      {group.title}
                    </div>
                    {group.items.map(({ to, label, hint, icon: Icon }) => (
                      <NavLink
                        key={to}
                        to={to}
                        onClick={() => setMoreOpen(false)}
                        className={({ isActive }) =>
                          clsx(
                            "flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[14px] transition-colors duration-200",
                            isActive
                              ? "bg-accent/10 text-accent"
                              : "text-muted hover:text-text hover:bg-panel2"
                          )
                        }
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="min-w-0">
                          <span className="block truncate leading-tight">{label}</span>
                          {hint && (
                            <span className="block truncate text-[12px] text-muted/80 leading-tight mt-0.5">
                              {hint}
                            </span>
                          )}
                        </span>
                      </NavLink>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

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
