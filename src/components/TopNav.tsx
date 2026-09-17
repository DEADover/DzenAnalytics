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
  Pencil,
  Heart,
  SlidersHorizontal,
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
import { FiltersDock } from "./FiltersDock";
import { headerSections, iconButtonWidth, moreGroups } from "../lib/headerNav";
import { useHeaderNavStore } from "../store/useHeaderNavStore";
import { useDisplayStore } from "../store/useDisplayStore";
import { useFiltersDockStore } from "../store/useFiltersDockStore";
import { SUPPORT_TITLE, SUPPORT_URL } from "../lib/support";
import logoDa from "../assets/logo-da.png";

/**
 * Пункт меню и кнопка-значок в дорожке — общими классами `.seg-*`: та же
 * пилюля, что у `Segmented`, и та же ступень 42, что у дорожек значков рядом.
 * Прежде меню выходило 43, а дорожка значков — 38.
 */
const navItem = (active: boolean, iconsOnly = false) =>
  clsx("seg-item seg-item-nav", iconsOnly && "seg-item-nav-icon", active && "seg-on");

/**
 * Содержимое пункта меню. С названиями — значок и подпись (значок до `xl`
 * прячется, иначе меню налезало на кнопки справа). Одними значками — значок в
 * строке высотой с подпись, чтобы дорожка не стала ниже, а название уходит в
 * подсказку и для скринридера.
 */
function NavItemBody({
  icon: Icon,
  label,
  iconsOnly,
}: {
  icon: typeof MoreHorizontal;
  label: string;
  iconsOnly: boolean;
}) {
  if (iconsOnly) {
    return (
      <>
        <span className="h-5 inline-flex items-center">
          <Icon className="w-4 h-4" aria-hidden />
        </span>
        <span className="sr-only">{label}</span>
      </>
    );
  }
  return (
    <>
      <Icon className="w-4 h-4 max-xl:hidden" />
      {label}
    </>
  );
}
const iconItem = (active = false) => clsx("seg-icon seg-icon-md group relative", active && "seg-on");
/** Строка меню телефона — раздел или действие. */
const sheetRow = (active = false) =>
  clsx(
    "flex items-center gap-3 px-4 py-2.5 text-sm text-left",
    active ? "bg-accent/10 text-accent" : "text-muted hover:text-text hover:bg-panel2"
  );

export function TopNav({ onOpenPalette }: { onOpenPalette?: () => void }) {
  const [moreOpenState, setMoreOpen] = useState(false);
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
  const hideThanks = useDisplayStore((s) => s.hideThanks);
  const filtersDocked = useDisplayStore((s) => s.filtersMode) === "button";
  const filtersOpen = useFiltersDockStore((s) => s.open);
  const filtersAvailable = useFiltersDockStore((s) => s.clients) > 0;
  const filtersActive = useFiltersDockStore((s) => s.active);
  const toggleFilters = useFiltersDockStore((s) => s.toggle);
  const { busy: syncBusy, runFull } = useSyncCommands();

  // Разделы шапки — из настройки (`lib/headerNav`). Все стоят в меню: если по
  // ширине не помещаются, полоса разделов листается вбок, а не отдаёт лишнее в
  // «Ещё» — выбранный человеком раздел должен оставаться там, куда его поставили.
  const headerNav = useHeaderNavStore((s) => s.items);
  const iconsOnly = useHeaderNavStore((s) => s.iconsOnly);
  // Ширина кнопок-значков — своя ступень из окна настройки; у стандартной её
  // задают поля кнопки. Одна на все кнопки дорожки, чтобы ряд был ровным.
  const iconWidthLevel = useHeaderNavStore((s) => s.iconWidth);
  const iconWidthPx = iconsOnly ? iconButtonWidth(iconWidthLevel) : null;
  const iconStyle = iconWidthPx ? { width: iconWidthPx } : undefined;
  const openHeaderEditor = useHeaderNavStore((s) => s.openEditor);
  const headerItems = headerSections(headerNav);
  const groups = moreGroups(headerNav);
  const inMore = groups.some((g) => g.items.some((s) => s.to === loc.pathname));
  // Все разделы переехали в меню — «Ещё» больше нет, и открытой панели тоже:
  // пустую панель не показываем, даже если её открыли до последней правки.
  const moreOpen = moreOpenState && groups.length > 0;

  const navScrollRef = useRef<HTMLDivElement>(null);
  /** Есть ли разделы за левым и правым краем полосы — для затухания краёв. */
  const [navEdges, setNavEdges] = useState({ left: false, right: false });
  useLayoutEffect(() => {
    const el = navScrollRef.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      setNavEdges((prev) => {
        const next = { left: el.scrollLeft > 1, right: max - el.scrollLeft > 1 };
        return prev.left === next.left && prev.right === next.right ? prev : next;
      });
    };
    // Колесо мыши над меню листает его вбок: у мыши горизонтального колеса нет,
    // а Shift+колесо никто не угадает. Страница при этом не прокручивается —
    // поэтому слушатель не пассивный. Когда листать некуда, колесо работает как
    // обычно.
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      el.removeEventListener("wheel", onWheel);
      ro.disconnect();
    };
  }, [headerNav, iconsOnly, iconWidthLevel]);

  // Открытый раздел подъезжает в видимую часть полосы: иначе после перехода с
  // палитры или из «Ещё» подсвеченный пункт мог остаться за краем.
  useEffect(() => {
    const el = navScrollRef.current;
    const active = el?.querySelector<HTMLElement>("[aria-current=page]");
    if (!el || !active) return;
    const a = active.offsetLeft - el.offsetLeft;
    if (a < el.scrollLeft) el.scrollLeft = a - 8;
    else if (a + active.offsetWidth > el.scrollLeft + el.clientWidth)
      el.scrollLeft = a + active.offsetWidth - el.clientWidth + 8;
  }, [loc.pathname, headerNav, iconsOnly, iconWidthLevel]);

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
      className="relative sticky top-0 z-30"
    >
      {/* Вторым ярусом шапки — панель общих фильтров по кнопке (FiltersDock).
          Стоит `absolute` под нижним краем, поэтому высоту шапки не меняет и
          страницу не сдвигает, но едет вместе с ней. */}
      <FiltersDock />

      {/* Подложка и метка плавного перехода (`app-header`) — не на самой
          шапке, а на её строке. Панель фильтров ниже носит такую же подложку.

          Обе вещи на `<header>` ломали стекло панели. Элемент с
          `view-transition-name` (как и с `backdrop-filter`) — корень для
          размытия всех своих потомков: оно берёт фоном только то, что внутри
          него, а не страницу. Под панелью оставались чёткие, лишь бледные цифры
          таблицы. На строке метка ничему не мешает — внутри строки размытия нет.

          Подложка — общее матовое стекло (`.glass`), та же, что у панели
          фильтров. */}
      <div className="app-header w-full px-4 md:px-6 py-3 flex items-center gap-2 sm:gap-3 md:gap-6 border-b border-border glass">
        {/* Знак «DA» (проба 16.09.2026). От `lg` он первым пунктом стоит в
            дорожке меню, перед «Главной», а меню прижато к левому краю. Ниже
            `lg` меню разделов в шапке нет — оно в кнопке справа, — и знак стоит
            слева сам по себе, иначе шапка осталась бы без опознавательного знака. */}
        <img src={logoDa} alt="DzenAnalytics" className="lg:hidden h-9 w-auto shrink-0" />

        {/* Обёртка держит свободное место и на узком экране, где само меню
            спрятано: без неё кнопки справа сползались бы к знаку. */}
        <div className="relative flex-1 flex justify-start min-w-0">
        {/* Desktop nav.

            Меню собрано в одну дорожку — подложка, кант, мягкая тень, — а не
            рассыпано отдельными надписями. Ровно так же набраны переключатели
            разделов на «Счетах» и «Категориях», и это не совпадение: и там, и
            здесь выбирают один вариант из нескольких, значит и выглядеть должно
            одинаково. Выбранный пункт залит целиком, а не десятью процентами
            цвета, — прежнюю бледную заливку на светлой теме приходилось искать
            глазами.

            Знак, «Ещё» и карандаш настройки стоят по краям дорожки всегда, а
            разделы между ними — в полосе, которая листается вбок, если все не
            помещаются. Края полосы, за которыми есть ещё разделы, затухают. */}
        {/* До `xl` у пунктов меню с названиями нет значков: при ширине
            1024–1279 меню со значками налезало на кнопки справа. Подписи
            короткие и без значков читаются. */}
        <nav className="seg-track hidden lg:inline-flex min-w-0 max-w-full">
          <img
            src={logoDa}
            alt="DzenAnalytics"
            className="h-[26px] w-auto shrink-0 mx-2.5"
          />
          {/* `-my-1 py-1` — место под свечение выбранного пункта: полоса с
              прокруткой обрезает всё, что выходит за её край. */}
          <div
            ref={navScrollRef}
            className="scroll-soft-x flex items-center gap-0.5 min-w-0 -my-1 py-1"
            style={
              navEdges.left || navEdges.right
                ? {
                    maskImage: `linear-gradient(to right, ${navEdges.left ? "transparent" : "#000"}, #000 24px, #000 calc(100% - 24px), ${navEdges.right ? "transparent" : "#000"})`,
                  }
                : undefined
            }
          >
            {headerItems.map(({ to, label, icon }) => (
              <SmoothNavLink
                key={to}
                to={to}
                end={to === "/"}
                onNavigate={() => setMoreOpen(false)}
                className={({ isActive }) => clsx(navItem(isActive, iconsOnly), "shrink-0")}
                style={iconStyle}
                title={iconsOnly ? label : undefined}
              >
                <NavItemBody icon={icon} label={label} iconsOnly={iconsOnly} />
              </SmoothNavLink>
            ))}
            {/* Настройка меню — последним пунктом той же полосы, но только когда
                «Ещё» нет: иначе карандаш уже стоит в углу панели «Ещё», и второй
                в дорожке лишь отнимал бы место у разделов. */}
            {groups.length === 0 && (
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  openHeaderEditor();
                }}
                className={clsx(navItem(false, true), "shrink-0 text-muted")}
                style={iconStyle}
                title="Настроить основное меню"
                aria-label="Настроить основное меню"
              >
                <NavItemBody icon={Pencil} label="Настроить основное меню" iconsOnly />
              </button>
            )}
          </div>

          {/* «Ещё» — только когда в нём что-то есть: если все разделы стоят в
              меню, кнопка открывала бы пустую панель. */}
          {groups.length > 0 && (
            <div className="shrink-0">
              <button
                onClick={() => setMoreOpen((o) => !o)}
                aria-expanded={moreOpen}
                aria-haspopup="true"
                className={navItem(moreOpen || inMore, iconsOnly)}
                style={iconStyle}
                title={iconsOnly && !moreOpen ? "Ещё" : undefined}
              >
                <NavItemBody icon={MoreHorizontal} label="Ещё" iconsOnly={iconsOnly} />
              </button>
            </div>
          )}
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
        {/* Общие фильтры — первой кнопкой (только в режиме «По кнопке»: во
            втором режиме панель стоит на самой странице, и кнопка не нужна): панель выезжает из-под шапки поверх
            страницы с любого места прокрутки (`FiltersDock`). Точка — заданы
            фильтры, есть что сбросить; на страницах без фильтров кнопка
            погашена, а не пропадает, как «Настроить главную». */}
        {filtersDocked && (
        <button
          type="button"
          onClick={() => {
            setMoreOpen(false);
            toggleFilters();
          }}
          aria-disabled={!filtersAvailable}
          aria-pressed={filtersOpen}
          aria-label={filtersOpen ? "Скрыть фильтры" : "Показать фильтры"}
          title={
            filtersAvailable
              ? filtersOpen
                ? "Скрыть фильтры"
                : `Фильтры · клавиша F\nПериод, счета, категории и поиск${filtersActive ? " — заданы" : ""}`
              : "Фильтры\nНа этой странице их нет"
          }
          className={iconItem(filtersOpen && filtersAvailable)}
        >
          <SlidersHorizontal className="w-4 h-4" />
          {filtersActive && filtersAvailable && !filtersOpen && (
            <span
              aria-hidden
              className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-accent ring-2 ring-panel2"
            />
          )}
        </button>
        )}
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

        {/* Благодарность автору — рядом со справкой: там же, где всё «про
            приложение». Прежде ссылка жила в подвале, куда мало кто
            долистывал. Серая в покое, как соседи, сердце краснеет под
            курсором. Убирается в «Настройки → Оформление». */}
        {!hideThanks && (
          <a
            href={SUPPORT_URL}
            target="_blank"
            rel="noopener noreferrer"
            title={SUPPORT_TITLE}
            aria-label={SUPPORT_TITLE}
            className={iconItem()}
          >
            <Heart className="w-4 h-4 transition-[color,fill,transform] duration-300 ease-out group-hover:text-expense group-hover:fill-current group-hover:scale-110" />
          </a>
        )}
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
            <div className="card-tray relative p-5 3xl:p-6">
              {/* Настройка основного меню — значком в углу панели: тут видно,
                  чего не хватает в шапке, и значок не отнимает места у разделов.
                  Верх угла свободен при любом числе столбцов — заголовки групп
                  короткие и прижаты влево. */}
              <button
                type="button"
                className="btn-icon absolute top-3 right-3"
                onClick={() => {
                  setMoreOpen(false);
                  openHeaderEditor();
                }}
                title="Настроить основное меню"
                aria-label="Настроить основное меню"
              >
                <Pencil className="w-4 h-4" />
              </button>
              {/* Колонки не шире 64rem и прижаты влево, под меню, а не растянуты
                  по всей ширине: на мониторе в 1800 пикселей колонка выходила по
                  539, а текста в ней на 250 — строки повисали в пустоте и
                  переставали читаться как список. */}
              {/* Каждая группа — свой столбец: столбцов ровно столько, сколько
                  групп (от трёх до пяти). Колонки CSS укладывали короткие группы
                  друг под другом — «Планы» и «Инструменты» оказывались в одном
                  столбце, и границы групп переставали читаться. При четырёх и
                  пяти группах промежуток уже, чтобы столбцы не сжимались. */}
              <div
                className={clsx("grid items-start", groups.length > 3 ? "gap-x-6" : "gap-x-10")}
                style={{
                  gridTemplateColumns: `repeat(${groups.length}, minmax(0, 1fr))`,
                  maxWidth: `${groups.length * 21.5}rem`,
                }}
              >
                {groups.map((group) => (
                  <div key={group.title} className="min-w-0">
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
                          <span className="block leading-tight break-words">{label}</span>
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
              {!hideThanks && (
                <a
                  href={SUPPORT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMobileOpen(false)}
                  className={sheetRow()}
                >
                  <Heart className="w-4 h-4" />
                  Отблагодарить автора
                </a>
              )}
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
