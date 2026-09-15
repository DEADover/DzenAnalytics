import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import {
  MoreHorizontal,
  Search,
  HelpCircle,
  Settings,
  LayoutTemplate,
  Menu,
  X,
  Moon,
  Sun,
  CloudDownload,
  PanelTop,
} from "lucide-react";
import clsx from "clsx";
import { useThemeStore } from "../store/useThemeStore";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { HeaderSyncActions } from "./HeaderSyncActions";
import { SliceSwitcher } from "./SliceSwitcher";
import { useSlicesStore } from "../store/useSlicesStore";
import { useDashboardLayoutStore } from "../store/useDashboardLayoutStore";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { useSyncCommands } from "../hooks/useSyncCommands";
import { useSmoothNavigate } from "../hooks/useSmoothNavigate";
import { SmoothNavLink } from "./SmoothNavLink";
import { fitCount, headerSections, moreGroups } from "../lib/headerNav";
import { useHeaderNavStore } from "../store/useHeaderNavStore";
import logoDa from "../assets/logo-da.png";

/**
 * Пункт меню и кнопка-значок в дорожке — общими классами `.seg-*`: та же
 * пилюля, что у `Segmented`, и та же ступень 42, что у дорожек значков рядом.
 * Прежде меню выходило 43, а дорожка значков — 38.
 */
const navItem = (active: boolean) => clsx("seg-item seg-item-nav", active && "seg-on");
const iconItem = (active = false) => clsx("seg-icon seg-icon-md group relative", active && "seg-on");
/** Строка меню телефона — раздел или действие. */
const sheetRow = (active = false) =>
  clsx(
    "flex items-center gap-3 px-4 py-2.5 text-sm text-left",
    active ? "bg-accent/10 text-accent" : "text-muted hover:text-text hover:bg-panel2"
  );

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
  const setThemeMode = useThemeStore((s) => s.setMode);
  const zenToken = useZenmoneyStore((s) => s.token);
  const { busy: syncBusy, runFull } = useSyncCommands();

  // Разделы шапки — из настройки (`lib/headerNav`). Сколько из них влезает,
  // меряет скрытая копия дорожки ниже: не поместившиеся уходят в «Ещё» первой
  // группой, а не распирают шапку.
  const headerNav = useHeaderNavStore((s) => s.items);
  const openHeaderEditor = useHeaderNavStore((s) => s.openEditor);
  const headerItems = headerSections(headerNav);
  const navWrapRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(headerItems.length);
  const shownItems = headerItems.slice(0, fit);
  const overflow = headerItems.slice(fit).map((s) => s.to);
  const groups = moreGroups(headerNav, overflow);
  const inMore = groups.some((g) => g.items.some((s) => s.to === loc.pathname));

  useLayoutEffect(() => {
    const wrap = navWrapRef.current;
    const track = measureRef.current;
    if (!wrap || !track) return;
    const measure = () => {
      const kids = Array.from(track.children) as HTMLElement[];
      // Копия спрятана вместе с меню ниже `lg` — там считать нечего.
      if (kids.length < 2 || track.offsetWidth === 0) return;
      const [logo, ...rest] = kids;
      const more = rest.pop()!;
      const widths = rest.map((el) => el.offsetWidth);
      const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      const content = kids.reduce((sum, el) => sum + el.offsetWidth, 0) + gap * (kids.length - 1);
      // Поля и кант дорожки + знак + «Ещё» — есть в шапке всегда.
      const fixed = track.offsetWidth - content + logo.offsetWidth + gap + more.offsetWidth;
      setFit(fitCount(widths, wrap.clientWidth, fixed, gap));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    ro.observe(track);
    return () => ro.disconnect();
  }, [headerNav]);

  // ←/→ листают разделы шапки в её порядке (по умолчанию Главная → Операции →
  // Счета → Категории).
  //
  // Стрелки — клавиши занятые, поэтому обработчик молчит, когда они нужны
  // кому-то другому: при фокусе в поле (там они двигают курсор), при открытом
  // окне или боковом списке (в карточке операции те же стрелки листают
  // операции), при раскрытой панели «Ещё» и с любым модификатором.
  //
  // Работает только на разделах из шапки: с «Отчёта» или «Календаря»
  // прыжок в «Операции» был бы неожиданностью. Кольца нет — на «Главной» левая
  // стрелка ничего не делает, иначе с края экрана улетаешь на другой край.
  const smoothNavigate = useSmoothNavigate();
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
      const i = headerItems.findIndex((p) => p.to === loc.pathname);
      if (i === -1) return;
      const next = i + (e.key === "ArrowRight" ? 1 : -1);
      if (next < 0 || next >= headerItems.length) return;
      e.preventDefault();
      // Снимаем фокус с пункта, по которому кликали раньше: иначе на нём
      // остаётся кольцо подсветки, и рядом с залитым текущим разделом это
      // выглядит как два выбранных пункта сразу. Обработчик висит на окне и
      // фокуса не требует — листать это не мешает.
      if (ae && ae.closest("nav")) ae.blur();
      smoothNavigate(headerItems[next].to);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen, mobileOpen, loc.pathname, smoothNavigate, headerItems]);

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
      className="app-header relative border-b border-border bg-panel/80 backdrop-blur sticky top-0 z-30"
    >
      <div className="w-full px-4 md:px-6 py-3 flex items-center gap-2 sm:gap-3 md:gap-6">
        {/* Знак «DA» (проба 16.09.2026). От `lg` он первым пунктом стоит в
            дорожке меню, перед «Главной», а меню прижато к левому краю. Ниже
            `lg` меню разделов в шапке нет — оно в кнопке справа, — и знак стоит
            слева сам по себе, иначе шапка осталась бы без опознавательного знака. */}
        <img src={logoDa} alt="DzenAnalytics" className="lg:hidden h-9 w-auto shrink-0" />

        {/* Обёртка держит свободное место и на узком экране, где само меню
            спрятано: без неё кнопки справа сползались бы к знаку. */}
        <div ref={navWrapRef} className="relative flex-1 flex justify-start min-w-0">
        {/* Desktop nav.

            Меню собрано в одну дорожку — подложка, кант, мягкая тень, — а не
            рассыпано отдельными надписями. Ровно так же набраны переключатели
            разделов на «Счетах» и «Категориях», и это не совпадение: и там, и
            здесь выбирают один вариант из нескольких, значит и выглядеть должно
            одинаково. Выбранный пункт залит целиком, а не десятью процентами
            цвета, — прежнюю бледную заливку на светлой теме приходилось искать
            глазами. */}
        {/* До `xl` у пунктов меню нет значков: при ширине 1024–1279 меню со
            значками налезало на кнопки справа. Подписи короткие и без значков
            читаются. */}
        <nav className="seg-track hidden lg:inline-flex shrink-0">
          <img
            src={logoDa}
            alt="DzenAnalytics"
            className="h-[26px] w-auto shrink-0 mx-2.5"
          />
          {shownItems.map(({ to, label, icon: Icon }) => (
            <SmoothNavLink
              key={to}
              to={to}
              end={to === "/"}
              onNavigate={() => setMoreOpen(false)}
              className={({ isActive }) => navItem(isActive)}
            >
              <Icon className="w-4 h-4 max-xl:hidden" />
              {label}
            </SmoothNavLink>
          ))}

          <div>
            <button
              onClick={() => setMoreOpen((o) => !o)}
              aria-expanded={moreOpen}
              aria-haspopup="true"
              className={navItem(moreOpen || inMore)}
            >
              <MoreHorizontal className="w-4 h-4 max-xl:hidden" />
              Ещё
            </button>
          </div>
        </nav>

        {/* Копия дорожки со ВСЕМИ разделами шапки — только для замера. Лежит в
            коробке нулевого размера, поэтому не видна, не ловит нажатий и не
            раздвигает страницу; разметка и классы — те же, что у меню. */}
        <div aria-hidden className="absolute left-0 top-0 h-0 w-0 overflow-hidden invisible pointer-events-none">
          <div ref={measureRef} className="seg-track hidden lg:inline-flex w-max">
            <img src={logoDa} alt="" className="h-[26px] w-auto shrink-0 mx-2.5" />
            {headerItems.map(({ to, label, icon: Icon }) => (
              <span key={to} className={navItem(false)}>
                <Icon className="w-4 h-4 max-xl:hidden" />
                {label}
              </span>
            ))}
            <span className={navItem(false)}>
              <MoreHorizontal className="w-4 h-4 max-xl:hidden" />
              Ещё
            </span>
          </div>
        </div>
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
        {/* Тема, настройки, главная и справка — ниже `md` в меню: вместе с
            обменом с облаком они не помещались в узкую шапку. На месте
            остаются поиск и само меню. */}
        <div className="hidden md:contents">
        <ThemeSwitcher />

        {/* Settings — gear icon. Выбранный — той же заливкой, что пункт меню. */}
        <SmoothNavLink
          to="/settings"
          onNavigate={() => setMoreOpen(false)}
          title="Настройки"
          className={({ isActive }) => iconItem(isActive)}
        >
          <Settings
            className="w-4 h-4 transition-transform duration-500 ease-out group-hover:rotate-90"
          />
        </SmoothNavLink>

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
        <SmoothNavLink
          to="/help"
          onNavigate={() => setMoreOpen(false)}
          title="Справка"
          className={({ isActive }) => iconItem(isActive)}
        >
          <HelpCircle className="w-4 h-4 transition-transform duration-300 ease-out group-hover:scale-110" />
        </SmoothNavLink>
        </div>

        {/* Меню узкого экрана — последним значком той же дорожки. Отдельной
            кнопкой оно было ниже соседних (30 против 42) и занимало лишний
            промежуток. */}
        <button
          onClick={() => setMobileOpen(true)}
          className={clsx(iconItem(mobileOpen), "lg:hidden")}
          title="Меню"
          aria-label="Меню"
          aria-expanded={mobileOpen}
        >
          <Menu className="w-4 h-4" />
        </button>
        </div>
        </div>
      </div>

      {/* ── «Ещё»: панель во всю ширину шапки ──
          Прежде это был столбец в 224 пикселя с прокруткой на семидесяти
          процентах высоты экрана: двадцать три пункта из двадцати семи жили в
          нём, и чтобы дойти до нижних, приходилось скроллить меню. Экран
          широкий — раскладываем их в три колонки и показываем разом.

          Панель считается от ШАПКИ, а не от кнопки: у кнопки место зависит от
          того, сколько разделов в шапке, и панель ездила бы вслед за ним.
          Группы — из `moreGroups`: не поместившиеся в шапку, убранные из неё
          основные разделы и прежние группы без того, что стоит в шапке. */}
      {moreOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setMoreOpen(false)}
            aria-hidden="true"
          />
          <div className="hidden lg:block absolute left-0 right-0 top-full z-20 px-4 md:px-6 pt-1">
            <div className="card-tray p-5 3xl:p-6">
              {/* Колонки не шире 64rem и прижаты влево, под меню, а не растянуты
                  по всей ширине: на мониторе в 1800 пикселей колонка выходила по
                  539, а текста в ней на 250 — строки повисали в пустоте и
                  переставали читаться как список. */}
              {/* Колонками, а не сеткой: групп бывает до пяти, и в сетке пятая
                  вставала вторым рядом под самую длинную «Аналитику», оставляя
                  под короткими группами пустоту. Колонки укладывают группы
                  плотно друг под другом. */}
              <div
                className="gap-x-10"
                style={{
                  columnCount: Math.min(Math.max(groups.length, 3), 4),
                  maxWidth: `${Math.min(Math.max(groups.length, 3), 4) * 21.5}rem`,
                }}
              >
                {groups.map((group) => (
                  <div key={group.title} className="break-inside-avoid pb-4">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-muted font-medium px-2.5 pb-2">
                      {group.title}
                    </div>
                    {group.items.map(({ to, label, hint, icon: Icon }) => (
                      <SmoothNavLink
                        key={to}
                        to={to}
                        onNavigate={() => setMoreOpen(false)}
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
                      </SmoothNavLink>
                    ))}
                  </div>
                ))}
              </div>
              {/* Настройка — тут же, где видно, чего не хватает в шапке. */}
              <div className="mt-4 pt-3 border-t border-border/60 flex">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => {
                    setMoreOpen(false);
                    openHeaderEditor();
                  }}
                >
                  <PanelTop className="w-3.5 h-3.5" />
                  Настроить меню в шапке
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Меню узкого экрана — порталом в body. Внутри шапки `fixed` считался
          бы от неё, а не от окна: размытие фона (`backdrop-blur`) делает
          шапку контейнером для фиксированных потомков, и меню сжималось до её
          высоты — 66 пикселей вместо всего экрана. */}
      {mobileOpen && createPortal(
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
              {/* Первыми — разделы из шапки, в её порядке: на телефоне меню
                  разделов в шапке нет, и настройка работает как «основное». */}
              {headerItems.length > 0 && (
                <div className="caps-label px-4 pt-2 pb-1">
                  Основное
                </div>
              )}
              {headerItems.map(({ to, label, icon: Icon }) => (
                <SmoothNavLink
                  key={to}
                  to={to}
                  end={to === "/"}
                  onNavigate={() => setMobileOpen(false)}
                  className={({ isActive }) => sheetRow(isActive)}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </SmoothNavLink>
              ))}
              {moreGroups(headerNav).map((group) => (
                <div key={group.title}>
                  <div className="caps-label px-4 pt-3 pb-1">
                    {group.title}
                  </div>
                  {group.items.map(({ to, label, icon: Icon }) => (
                    <SmoothNavLink
                      key={to}
                      to={to}
                      onNavigate={() => setMobileOpen(false)}
                      className={({ isActive }) => sheetRow(isActive)}
                    >
                      <Icon className="w-4 h-4" />
                      {label}
                    </SmoothNavLink>
                  ))}
                </div>
              ))}
            </nav>

            {/* Что не поместилось в узкую шапку. Прижато к низу, чтобы не
                листать до него через два десятка разделов. */}
            <div className="md:hidden border-t border-border py-2">
              {zenToken && (
                <div className="sm:hidden">
                  <div className="caps-label px-4 pt-1 pb-1">Дзен-мани</div>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileOpen(false);
                      void runFull();
                    }}
                    disabled={syncBusy}
                    className={clsx(sheetRow(), "w-full disabled:opacity-40")}
                  >
                    <CloudDownload className="w-4 h-4" />
                    Полная синхронизация
                  </button>
                </div>
              )}
              <div className="caps-label px-4 pt-1 pb-1">Приложение</div>
              <SmoothNavLink
                to="/settings"
                onNavigate={() => setMobileOpen(false)}
                className={({ isActive }) => sheetRow(isActive)}
              >
                <Settings className="w-4 h-4" />
                Настройки
              </SmoothNavLink>
              <SmoothNavLink
                to="/help"
                onNavigate={() => setMobileOpen(false)}
                className={({ isActive }) => sheetRow(isActive)}
              >
                <HelpCircle className="w-4 h-4" />
                Справка
              </SmoothNavLink>
              {/* Подпись — то, на что переключит, как значок в шапке. Меню не
                  закрывается: смену темы видно сразу за ним. */}
              <button
                type="button"
                onClick={() => setThemeMode(theme === "dark" ? "light" : "dark")}
                className={clsx(sheetRow(), "w-full")}
              >
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                {theme === "dark" ? "Светлая тема" : "Тёмная тема"}
              </button>
              {/* Как в шапке: вне главной пункт не пропадает, а гаснет — и
                  говорит, где он работает. */}
              <button
                type="button"
                onClick={() => {
                  if (!onDashboard) return;
                  setEditingLayout(!editingLayout);
                  setMobileOpen(false);
                }}
                aria-disabled={!onDashboard}
                aria-pressed={onDashboard && editingLayout}
                className={clsx(
                  sheetRow(onDashboard && editingLayout),
                  "w-full",
                  !onDashboard && "opacity-40 cursor-not-allowed"
                )}
              >
                <LayoutTemplate className="w-4 h-4 shrink-0" />
                <span>
                  Настроить главную
                  {!onDashboard && <span className="block text-xs">Доступно на главной</span>}
                </span>
              </button>
            </div>
          </aside>
        </div>,
        document.body
      )}
    </header>
  );
}
