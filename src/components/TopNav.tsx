import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  PieChart,
  Wallet,
  ListChecks,
  MoreHorizontal,
  LayoutDashboard,
  Search,
  HelpCircle,
  Settings,
  LayoutTemplate,
  Menu,
  X,
} from "lucide-react";
import clsx from "clsx";
import { useThemeStore } from "../store/useThemeStore";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { HeaderSyncActions } from "./HeaderSyncActions";
import { SliceSwitcher } from "./SliceSwitcher";
import { useSlicesStore } from "../store/useSlicesStore";
import { useDashboardLayoutStore } from "../store/useDashboardLayoutStore";
import { SECONDARY, SECONDARY_GROUPS } from "../lib/navSections";
import logoHorizontal from "../assets/logo-horizontal.svg";
import logoHorizontalDark from "../assets/logo-horizontal-dark.svg";

const PRIMARY = [
  { to: "/", label: "Главная", icon: LayoutDashboard },
  { to: "/transactions", label: "Операции", icon: ListChecks },
  { to: "/accounts", label: "Счета", icon: Wallet },
  { to: "/categories", label: "Категории", icon: PieChart },
];



/**
 * Пункт меню и кнопка-значок в дорожке — общими классами `.seg-*`: та же
 * пилюля, что у `Segmented`, и та же ступень 42, что у дорожек значков рядом.
 * Прежде меню выходило 43, а дорожка значков — 38.
 */
const navItem = (active: boolean) => clsx("seg-item seg-item-nav", active && "seg-on");
const iconItem = (active = false) => clsx("seg-icon seg-icon-md group relative", active && "seg-on");

export function TopNav({ onOpenPalette }: { onOpenPalette?: () => void }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  const editingLayout = useDashboardLayoutStore((s) => s.editing);
  const setEditingLayout = useDashboardLayoutStore((s) => s.setEditing);
  const onDashboard = loc.pathname === "/";
  // Переключатель разреза появляется только со второго разреза — от этого
  // зависит, нужен ли разделитель внутри панели.
  const hasSlices = useSlicesStore((s) => s.slices.length) > 1;
  const theme = useThemeStore((s) => s.resolved);

  const inSecondary = SECONDARY.some((s) => loc.pathname === s.to);

  // ←/→ листают основные разделы: Главная → Операции → Счета → Категории.
  //
  // Стрелки — клавиши занятые, поэтому обработчик молчит, когда они нужны
  // кому-то другому: при фокусе в поле (там они двигают курсор), при открытом
  // окне или боковом списке (в карточке операции те же стрелки листают
  // операции), при раскрытой панели «Ещё» и с любым модификатором.
  //
  // Работает только на самих четырёх разделах: с «Отчёта» или «Календаря»
  // прыжок в «Операции» был бы неожиданностью. Кольца нет — на «Главной» левая
  // стрелка ничего не делает, иначе с края экрана улетаешь на другой край.
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (moreOpen || mobileOpen) return;
      const ae = document.activeElement as HTMLElement | null;
      if (
        ae &&
        (ae.tagName === "INPUT" ||
          ae.tagName === "TEXTAREA" ||
          ae.tagName === "SELECT" ||
          ae.isContentEditable)
      ) {
        return;
      }
      if (document.querySelector('[role="dialog"], aside')) return;
      const i = PRIMARY.findIndex((p) => p.to === loc.pathname);
      if (i === -1) return;
      const next = i + (e.key === "ArrowRight" ? 1 : -1);
      if (next < 0 || next >= PRIMARY.length) return;
      e.preventDefault();
      // Снимаем фокус с пункта, по которому кликали раньше: иначе на нём
      // остаётся кольцо подсветки, и рядом с залитым текущим разделом это
      // выглядит как два выбранных пункта сразу. Обработчик висит на окне и
      // фокуса не требует — листать это не мешает.
      if (ae && ae.closest("nav")) ae.blur();
      navigate(PRIMARY[next].to);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen, mobileOpen, loc.pathname, navigate]);

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
        <nav className="seg-track hidden lg:inline-flex shrink-0">
          {PRIMARY.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) => navItem(isActive)}
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
              className={navItem(moreOpen || inSecondary)}
            >
              <MoreHorizontal className="w-4 h-4" />
              Ещё
            </button>
          </div>
        </nav>
        </div>

        {/* Правая зона. Тот же вес, что и у левой, — этим и держится середина.
            Внутри ровно две дорожки, набранные как меню: слева данные (разрез
            и обмен с облаком), справа система (поиск, тема, настройки,
            справка). Прежде их было четыре предмета в четырёх видах — обойма
            со скруглением 8, обойма-пилюля, пилюля темы и два голых значка, —
            и правый край читался собранным из разных наборов. */}
        <div className="flex items-center gap-2 md:gap-3 shrink-0">
        <HeaderSyncActions leading={hasSlices ? <SliceSwitcher /> : undefined} />

        {/* Системная дорожка. Поиск живёт здесь же: он открывает палитру
            команд, то есть тоже про приложение, а не про данные на экране. */}
        <div className="seg-track shrink-0">
        <button
          onClick={onOpenPalette}
          className={iconItem()}
          title="Команды и поиск (⌘K / Ctrl+K)"
          aria-label="Команды и поиск"
        >
          <Search className="w-4 h-4" />
        </button>
        <ThemeSwitcher />

        {/* Settings — gear icon. Выбранный — той же заливкой, что пункт меню. */}
        <NavLink
          to="/settings"
          title="Настройки"
          className={({ isActive }) => iconItem(isActive)}
        >
          <Settings
            className="w-4 h-4 transition-transform duration-500 ease-out group-hover:rotate-90"
          />
        </NavLink>

        {/* Настройка главной. Стоит здесь, а не на самой странице: это действие
            над экраном, как тема и настройки, а не ещё один его блок. Работает
            только на главной — переставлять там нечего, если ты не там, — и
            потому на других страницах гаснет, а не исчезает: пропадающая
            кнопка заставляла бы гадать, куда она делась.

            Значок — «раскладка страницы», а не решётка: решётка стоит рядом у
            «Главной» в меню, и два одинаковых значка в одной шапке читались бы
            как одно и то же действие. */}
        <button
          onClick={() => onDashboard && setEditingLayout(!editingLayout)}
          // Именно `aria-disabled`, а не `disabled`: выключенная кнопка в
          // браузере не получает событий мыши, и подсказка о том, почему она
          // погасла, не показалась бы как раз тогда, когда она нужнее всего.
          aria-disabled={!onDashboard}
          title={
            onDashboard
              ? "Настроить главную\nПорядок, ширина и состав виджетов"
              : "Настроить главную\nДоступно на главной странице"
          }
          aria-label="Настроить главную"
          aria-pressed={editingLayout}
          className={iconItem(!!onDashboard && editingLayout)}
        >
          <LayoutTemplate className="w-4 h-4" />
        </button>

        {/* Help — question icon. Same active treatment as Settings. */}
        <NavLink
          to="/help"
          title="Справка"
          className={({ isActive }) => iconItem(isActive)}
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
                className="btn-icon"
                aria-label="Закрыть меню"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto py-2">
              <div className="overline px-4 pt-2 pb-1">
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
                  <div className="overline px-4 pt-3 pb-1">
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
