import { useEffect, useState, useRef } from "react";
import { Palette, ChevronsLeftRight, ChevronsRightLeft, PanelTop, RotateCcw } from "lucide-react";
import { SettingsSectionHeader } from "../../components/SettingsSectionHeader";
import { useColumnWidthsStore } from "../../store/useColumnWidthsStore";
import { SettingRow } from "../../components/SettingRow";
import { InfoTerm } from "../../components/InfoPopover";
import { Switch } from "../../components/Switch";
import { Segmented } from "../../components/Segmented";
import { schemeName } from "../../lib/themeSchemes";
import { useDataStore } from "../../store/useDataStore";
import { useZenmoneyStore, getZenUsersFromCache } from "../../store/useZenmoneyStore";
import { pluralRu } from "../../lib/plural";
import { useMembersStore } from "../../store/useMembersStore";
import { formatNum, formatMoneyExample } from "../../lib/format";
import { useFilterMemoryStore } from "../../store/useFilterMemoryStore";
import { TABLE_FONT_LABELS, useDisplayStore, type TableFontLevel } from "../../store/useDisplayStore";
import { useThemeStore } from "../../store/useThemeStore";
import { useThemeModalStore } from "../../store/useThemeModalStore";
import { useHeaderNavStore } from "../../store/useHeaderNavStore";
import { headerSections } from "../../lib/headerNav";
import { SettingRange } from "../../components/Slider";
import { withViewTransition } from "../../lib/viewTransition";
import {
  CONTENT_WIDTH_MAX,
  CONTENT_WIDTH_MIN,
  CONTENT_WIDTH_SLIDER_FULL,
  CONTENT_WIDTH_STEP,
  contentWidthToSlider,
  formatContentWidth,
  sliderToContentWidth,
} from "../../lib/contentWidth";
import { useMediaQuery } from "../../hooks/useMediaQuery";

/**
 * Вкладка «Оформление» настроек: тема, плотность, шрифт таблиц, ширина сервиса и прочий вид. Вынесена из страницы настроек — у каждой вкладки свой файл.
 */
export function InterfaceSettings() {
  const rates = useDataStore((s) => s.rates);
  const zenLastSyncAt = useZenmoneyStore((s) => s.lastSyncAt);
  const [membersCount, setMembersCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getZenUsersFromCache().then((list) => {
      if (!cancelled) setMembersCount(list?.length ?? 0);
    });
    return () => {
      cancelled = true;
    };
  }, [zenLastSyncAt]);
  // Тема: в шапке переключаются только светлая и тёмная, а «как в системе»
  // до этого нигде не выбиралась — жила в хранилище без интерфейса.
  const themeMode = useThemeStore((s) => s.mode);
  const resolvedTheme = useThemeStore((s) => s.resolved);
  const showThemeModal = useThemeModalStore((s) => s.show);
  const headerNavItems = useHeaderNavStore((s) => s.items);
  const headerNavIconsOnly = useHeaderNavStore((s) => s.iconsOnly);
  const headerNavIconWidth = useHeaderNavStore((s) => s.iconWidth);
  const openHeaderNavEditor = useHeaderNavStore((s) => s.openEditor);
  const lightSchemeName = useThemeStore((s) => schemeName(s.lightScheme));
  const darkSchemeName = useThemeStore((s) => schemeName(s.darkScheme));
  const fractionDigits = useDisplayStore((s) => s.fractionDigits);
  const statementLine = useDisplayStore((s) => s.statementLine);
  const rememberFilters = useFilterMemoryStore((s) => s.enabled);
  const setRememberFilters = useFilterMemoryStore((s) => s.setEnabled);
  const setStatementLine = useDisplayStore((s) => s.setStatementLine);
  const commentWrap = useDisplayStore((s) => s.commentWrap);
  const setCommentWrap = useDisplayStore((s) => s.setCommentWrap);
  const feedPlanned = useDisplayStore((s) => s.feedPlanned);
  const feedPlannedMode = useDisplayStore((s) => s.feedPlannedMode);
  const setFeedPlannedMode = useDisplayStore((s) => s.setFeedPlannedMode);
  const setFeedPlanned = useDisplayStore((s) => s.setFeedPlanned);
  const filtersMode = useDisplayStore((s) => s.filtersMode);
  const setFiltersMode = useDisplayStore((s) => s.setFiltersMode);
  const hideThanks = useDisplayStore((s) => s.hideThanks);
  const quickSettingsOn = useDisplayStore((s) => s.quickSettings);
  const setQuickSettingsOn = useDisplayStore((s) => s.setQuickSettings);
  const hintsOn = useDisplayStore((s) => s.hints);
  const setHintsOn = useDisplayStore((s) => s.setHints);
  const rowClickSelect = useDisplayStore((s) => s.rowClickSelect);
  const setRowClickSelect = useDisplayStore((s) => s.setRowClickSelect);
  const setHideThanks = useDisplayStore((s) => s.setHideThanks);
  const setFractionDigits = useDisplayStore((s) => s.setFractionDigits);
  const tableFontLevel = useDisplayStore((s) => s.tableFontLevel);
  const setTableFontLevel = useDisplayStore((s) => s.setTableFontLevel);
  const columnResize = useDisplayStore((s) => s.columnResize);
  const contentWidth = useDisplayStore((s) => s.contentWidth);
  const setContentWidth = useDisplayStore((s) => s.setContentWidth);
  const contentWidthDraft = useDisplayStore((s) => s.contentWidthDraft);
  const setContentWidthDraft = useDisplayStore((s) => s.setContentWidthDraft);
  // Пока бегунок тянут — показываем выбираемое, иначе — применённое.
  const shownWidth = contentWidthDraft ?? contentWidth;
  const widthCommitTimer = useRef<number | undefined>(undefined);
  // Шире ли экран выбранной колонки: на более узком ограничение ничего не
  // меняет, и об этом честнее сказать в статусе, чем молча двигать бегунок.
  const screenWiderThanColumn = useMediaQuery(`(min-width: ${(shownWidth || CONTENT_WIDTH_MAX) + 1}px)`);
  const setColumnResize = useDisplayStore((s) => s.setColumnResize);
  const customWidthTables = useColumnWidthsStore((s) => Object.keys(s.tables).length);
  const resetColumnWidths = useColumnWidthsStore((s) => s.resetAll);
  const membersOwnerId = useMembersStore((s) => s.ownerId);
  const hideForeignMembers = useMembersStore((s) => s.hideForeignPrivate);
  const setHideForeignMembers = useMembersStore((s) => s.setHideForeignPrivate);
  return (
    <>

      {/* Одна карточка вместо трёх отдельных: настройки вида короткие, а
          каждая со своим абзацем пояснений занимала пол-экрана.

*/}
      <div className="card-tray card-pad">
        <SettingsSectionHeader icon={Palette} title="Внешний вид" className="mb-1" />
        <p className="text-xs text-muted mb-3">
          Как сервис выглядит и как им удобнее пользоваться.
        </p>

        <SettingRow
          title="Тема"
          status={`Светлая — ${lightSchemeName}, тёмная — ${darkSchemeName} · ${
            themeMode === "auto"
              ? `Как в системе, сейчас ${resolvedTheme === "dark" ? "тёмный" : "светлый"} вид`
              : resolvedTheme === "dark"
                ? "Тёмный вид"
                : "Светлый вид"
          }`}
          help={
            <p>
              В окне темы — вид (светлый, тёмный или как в системе) и по шесть
              тем для каждого вида: галочкой отмечается, какая нравится. Плитка
              «Своя» — копия темы, в которой можно поменять любые цвета. «Как в
              системе» переключается вместе с вашей ОС, в том числе по
              расписанию. Кнопка в шапке переключает светлый и тёмный вид
              напрямую, каждый — со своей темой.
            </p>
          }
          control={
            <button type="button" className="btn-ghost" onClick={showThemeModal}>
              <Palette className="w-4 h-4" />
              Выбрать тему
            </button>
          }
        />

        <SettingRow
          title="Основное меню"
          status={
            headerNavItems.length === 0
              ? "Все разделы — в «Ещё»"
              : `${headerNavIconsOnly ? `Только значки${headerNavIconWidth > 0 ? `, ширина ${headerNavIconWidth} из 10` : ""} · ` : ""}${headerSections(headerNavItems)
                  .map((s) => s.label)
                  .join(", ")}`
          }
          help={
            <p>
              Какие разделы стоят в основном меню в шапке и в каком порядке. Любой
              раздел из «Ещё» можно поставить в меню, а основной — убрать в «Ещё».
              Меню можно показывать одними значками — название раздела тогда
              появляется при наведении.
              Если разделы не помещаются в шапку, меню листается вбок. Открыть
              настройку можно и значком с карандашом в панели «Ещё», а если все
              разделы стоят в меню — последним пунктом самого меню.
            </p>
          }
          control={
            <button type="button" className="btn-ghost" onClick={openHeaderNavEditor}>
              <PanelTop className="w-4 h-4" />
              Настроить
            </button>
          }
        />

        <SettingRow
          title="Дробная часть сумм"
          status={`Например: ${formatMoneyExample(1234.1, rates.base)}`}
          help={
            <p>
              Показывать ли копейки, центы и прочую мелочь. Влияет на все суммы:
              итоги, карточки, таблицы, операции и подсказки. На осях графиков
              суммы всегда компактные — там дробная часть только мешает.
            </p>
          }
          control={
            <Segmented
              label="Дробная часть сумм"
              value={fractionDigits}
              onChange={(v) => setFractionDigits(v)}
              options={[
                { value: 0, label: "1 234", title: "Без дробной части" },
                { value: 2, label: "1 234,10", title: "С дробной частью" },
              ]}
            />
          }
        />

        <SettingRow
          tourId="filters-mode"
          title="Панель фильтров"
          status={
            filtersMode === "button"
              ? "По кнопке в шапке — не занимает места"
              : "На странице — всегда на виду"
          }
          help={
            <>
              <p>
                Общие фильтры — период, счета, категории, валюты и поиск —
                работают на всех аналитических страницах. Показывать их можно
                двумя способами.
              </p>
              <p className="mt-2">
                <strong>По кнопке в шапке.</strong> Панель не занимает места на
                странице: открывается кнопкой с ползунками справа в шапке, с
                любого места прокрутки выезжает поверх страницы и ничего не
                сдвигает. Прячется той же кнопкой, клавишей Escape и при
                переходе в другой раздел. Точка на кнопке — фильтры заданы.
              </p>
              <p className="mt-2">
                <strong>На странице.</strong> Так работает по умолчанию:
                панель стоит первым блоком каждой страницы и всегда на виду;
                кнопки в шапке в этом случае нет.
              </p>
            </>
          }
          control={
            <Segmented
              label="Панель фильтров"
              value={filtersMode}
              onChange={(m) => setFiltersMode(m)}
              options={[
                { value: "button", label: "По кнопке" },
                { value: "page", label: "На странице" },
              ]}
            />
          }
        />

        <SettingRow
          title="Запланированные в ленте"
          status={
            !feedPlanned
              ? "Не показываются — они есть в «Запланированных»"
              : feedPlannedMode === "inline"
                ? "В ленте среди операций — до конца выбранного периода"
                : "Строкой над лентой «Операций» — клик показывает одни планы"
          }
          help={
            <>
              <p>
                <strong>Строкой.</strong> Над лентой «Операций» стоит строка
                «Запланировано»: сколько запланированных операций Дзен-мани
                просрочено и сколько осталось до конца месяца, до конца года и
                всего. Клик по ней показывает ленту одних запланированных — все,
                какие есть, как «Будущие» в приложении.
              </p>
              <p>
                <strong>В ленте.</strong> Запланированные стоят прямо среди
                операций, на своих датах, и подчиняются тем же фильтрам. Сколько
                вперёд — решает период: за отчётный месяц видны планы до его
                конца, за год — до конца года, за всё время — все. В итоги ленты
                планы не входят — только проведённые операции.
              </p>
              <p>
                В обоих видах кнопкой «⋯» план можно сохранить как факт, связать
                с уже проведённой операцией, изменить или удалить.
              </p>
            </>
          }
          control={
            <Segmented
              label="Запланированные в ленте"
              value={feedPlanned ? feedPlannedMode : "off"}
              onChange={(v) => {
                if (v === "off") void setFeedPlanned(false);
                else {
                  void setFeedPlannedMode(v);
                  if (!feedPlanned) void setFeedPlanned(true);
                }
              }}
              options={[
                { value: "off" as const, label: "Скрыть", title: "Не показывать запланированные" },
                { value: "bar" as const, label: "Строкой", title: "Строкой «Запланировано» над лентой" },
                { value: "inline" as const, label: "В ленте", title: "Среди операций, до конца выбранного периода" },
              ]}
            />
          }
        />

        <SettingRow
          title="Строка из выписки"
          status={
            statementLine
              ? "Показывается под контрагентом"
              : "Скрыта — только название контрагента"
          }
          help={
            <>
              <p>
                Под названием контрагента можно показывать то, что напечатал
                банк, — поле <InfoTerm>«В выписке»</InfoTerm> из редактора
                операции. Строка появляется только у операций с заполненным{" "}
                <InfoTerm>«Местом платежа»</InfoTerm> и только когда текст банка
                отличается от названия контрагента.
              </p>
              <p>
                Пригодится, когда банк печатает не то, что вы видите в
                контрагенте: у магазина в выписке может стоять номер терминала
                («MARKET 1234 MOSCOW»), а у перевода по СБП — тот, кому деньги
                ушли на самом деле. Если это только мешает — выключите, и в
                списках останется одно название.
              </p>
            </>
          }
          control={
            <Switch
              checked={statementLine}
              label="Показывать строку из выписки"
              onChange={(next) => setStatementLine(next)}
            />
          }
        />

        <SettingRow
          title="Длинные комментарии"
          status={
            commentWrap
              ? "До двух строк, с переносом по словам"
              : "В одну строку — остальное в подсказке"
          }
          help={
            <p>
              В лентах «Операций», «Без категории», «Удалённых», «Дубликатов» и в
              списке операций сбоку длинный комментарий можно показывать в две
              строки — тогда видно, что в нём написано, но строки ленты
              получаются разной высоты. В одну строку лента ровнее, а полный
              текст — в подсказке при наведении.
            </p>
          }
          control={
            <Switch
              checked={commentWrap}
              label="Переносить длинные комментарии на вторую строку"
              onChange={(next) => setCommentWrap(next)}
            />
          }
        />

        <SettingRow
          title="Убрать значок благодарности"
          status={
            hideThanks
              ? "Сердечко скрыто"
              : "Сердечко «Поддержать проект» — в шапке рядом со справкой"
          }
          help={
            <p>
              Значок с сердечком ведёт на страницу, где можно оставить автору
              чаевые. Если он мешает — включите, и значок пропадёт из шапки и из
              меню. Больше ничего не меняется.
            </p>
          }
          control={
            <Switch
              checked={hideThanks}
              label="Убрать значок благодарности"
              onChange={(next) => setHideThanks(next)}
            />
          }
        />

        <SettingRow
          title="Запоминать фильтры"
          status={
            rememberFilters
              ? "Сохраняются между сессиями"
              : "Сбрасываются при перезагрузке"
          }
          help={
            <>
              <p>
                Обычно фильтры живут до перезагрузки вкладки: закрыли — открыли
                чистым. Включите, и выбранные счета, статьи, валюты, поиск и
                всё из <InfoTerm>«Дополнительно»</InfoTerm> вернутся такими же,
                какими вы их оставили. Тогда же они начнут попадать в копию.
              </p>
              <p>
                <strong>Период не запоминается</strong> — ни при включённой
                памяти, ни при выключенной. Приложение всегда открывается на
                текущем месяце: увидеть при запуске позапрошлый август и
                гадать, куда делись деньги, — не то, ради чего его открывают.
                Период, который нужно возвращать, стоит сохранить{" "}
                <InfoTerm>видом</InfoTerm> — там он хранится по желанию.
              </p>
              <p>
                Что выбрано, видно всегда: в панели сверху написано, сколько
                счетов и статей отмечено, а кнопка слева показывает название
                применённого вида или «Без фильтрации».
              </p>
            </>
          }
          control={
            <Switch
              checked={rememberFilters}
              label="Запоминать фильтры между сессиями"
              onChange={(next) => setRememberFilters(next)}
            />
          }
        />

        {/* Совместный доступ: сама настройка про то, ЧТО показывать, поэтому
            живёт здесь, а не рядом со списком участников.

            На личном аккаунте строка остаётся, но не работает: убирать её
            совсем — значит скрывать от человека, что такая возможность вообще
            есть. А без второго участника прятать не у кого. Нет синхронизации
            с Дзен-мани вовсе (`membersCount === 0`) — тогда строки нет: речь о
            чужих счетах в чужом сервисе, к выписке из файла это не относится. */}
        {membersCount > 0 && (
          <SettingRow
            title="Скрывать чужие личные счета"
            status={
              membersCount < 2
                ? "Доступно на общем аккаунте: сейчас в аккаунте вы один"
                : membersOwnerId == null
                  ? "Начнёт действовать, когда вы отметите себя в «Данных»"
                  : hideForeignMembers
                    ? "Операции по личным счетам других участников скрыты"
                    : "Видны операции по всем счетам, включая чужие личные"
            }
            help={
              <>
                <p>
                  К аккаунту Дзен-мани можно подключить несколько человек, и
                  счёт можно пометить <InfoTerm>личным</InfoTerm> — тогда
                  остальные его не видят ни в приложении, ни на сайте. Но
                  в сервис такие счета приходят всем, поэтому прячем их мы.
                </p>
                <p>
                  Выключите, если на общем аккаунте вам нужнее видеть операции
                  всех. Кто из участников вы, задаётся на вкладке{" "}
                  <InfoTerm>«Данные»</InfoTerm> — без этого прятать не от кого
                  и нечего.
                </p>
              </>
            }
            control={
              <Switch
                // Показываем ДЕЙСТВУЮЩЕЕ состояние, а не сохранённое: пока
                // прятать не у кого или человек не отметил себя, не скрыто
                // ничего — и переключатель во «включено» противоречил бы и
                // подписи под ним, и тому, что видно в данных.
                checked={membersCount > 1 && membersOwnerId != null && hideForeignMembers}
                disabled={membersCount < 2 || membersOwnerId == null}
                label="Скрывать личные счета других участников"
                onChange={(next) => setHideForeignMembers(next)}
              />
            }
          />
        )}

        <SettingRow
          title="Своя ширина столбцов"
          status={
            !columnResize
              ? "Выключено — ширины колонок подбираются сами"
              : customWidthTables > 0
                ? `Своя ширина — в ${formatNum(customWidthTables)} ${pluralRu(customWidthTables, [
                    "таблице",
                    "таблицах",
                    "таблицах",
                  ])}`
                : "Потяните границу между колонками в шапке любой таблицы"
          }
          help={
            <>
              <p>
                Когда настройка включена, между колонками в шапке
                таблиц и лент операций видны тонкие границы. Потяните границу
                мышью — две колонки по её сторонам поделят место между собой,
                остальные останутся на месте. Таблица всегда во всю ширину,
                прокрутки вбок нет.
              </p>
              <p className="mt-2">
                Ширины запоминаются для каждой таблицы отдельно и растут вместе
                с размером текста. Уже подписи и сумм колонку не сжать —
                заголовки и числа не обрезаются, а длинный текст сокращается
                многоточием и на вторую строку не переносится (кроме
                комментариев, если включены «Длинные комментарии»). Двойной
                клик по границе возвращает таблице ширины
                по умолчанию, а кнопка здесь — всем таблицам сразу. Границу
                можно двигать и с клавиатуры: Tab до неё, затем стрелки влево и
                вправо.
              </p>
            </>
          }
          control={
            <div className="flex items-center gap-3">
              {columnResize && customWidthTables > 0 && (
                <button type="button" className="btn-ghost text-xs" onClick={resetColumnWidths}>
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden />
                  Сбросить ширины
                </button>
              )}
              <Switch
                checked={columnResize}
                label="Своя ширина столбцов"
                onChange={(next) => setColumnResize(next)}
              />
            </div>
          }
        />

        <SettingRow
          title="Быстрые настройки"
          status={
            quickSettingsOn
              ? "Шестерёнка в шапке открывает панель быстрых настроек"
              : "Шестерёнка в шапке сразу открывает «Настройки»"
          }
          help={
            <p>
              Панель под шестерёнкой — то, что удобно переключать на ходу:
              скрыть суммы, счета вне баланса, дробную часть сумм и другое, что вы
              в неё поставите. Выключите — и шестерёнка снова будет сразу вести
              сюда, в «Настройки». Клавиши H, B и F работают в любом случае.
            </p>
          }
          control={
            <Switch
              checked={quickSettingsOn}
              label="Быстрые настройки"
              onChange={(next) => setQuickSettingsOn(next)}
            />
          }
        />

        <SettingRow
          title="Всплывающие подсказки"
          status={
            hintsOn
              ? "Пояснения появляются при наведении на кнопки и значки"
              : "Пояснений при наведении нет — только значения на графиках"
          }
          help={
            <p>
              Пузырь с пояснением, который появляется, если задержать мышь на
              кнопке, значке или подписи. Освоились — выключите, чтобы не мешали.
              Значения на графиках и полный текст обрезанной подписи остаются:
              это сами данные. Окошки «?» открываются кликом, как и раньше.
            </p>
          }
          control={
            <Switch
              checked={hintsOn}
              label="Всплывающие подсказки"
              onChange={(next) => setHintsOn(next)}
            />
          }
        />

        <SettingRow
          title="Выделение строки кликом"
          status={
            rowClickSelect
              ? "Клик по операции отмечает её, двойной — открывает"
              : "Клик по операции ничего не делает: отмечать — галочкой, открывать — двойным кликом"
          }
          help={
            <p>
              В лентах операций — «Операции», «Без категории», «Дубликаты»,
              «Удалённые» и список операций в шторке — один клик по строке
              отмечает её для действий над выбранными. Если строки
              отмечаются случайно, когда вы просто кликаете по ленте,
              выключите: отмечать можно галочкой в начале строки, открывать
              операцию — двойным кликом, как и раньше.
            </p>
          }
          control={
            <Switch
              checked={rowClickSelect}
              label="Выделение строки кликом"
              onChange={(next) => setRowClickSelect(next)}
            />
          }
        />

        <SettingRow
          title="Ширина сервиса"
          status={
            shownWidth === 0
              ? "Во весь экран"
              : `${formatContentWidth(shownWidth)} — ${
                  screenWiderThanColumn ? "колонкой по центру экрана" : "шире этого экрана, сервис и так во весь экран"
                }`
          }
          help={
            <>
              <p>
                На широком мониторе (например, 21:9) сервис растягивается до
                краёв окна, и строки таблиц и графики приходится читать
                поворотом головы. Сдвиньте бегунок влево — шапка, панель
                фильтров и страница встанут колонкой по центру экрана, а фон и
                подложка шапки останутся во всю ширину.
              </p>
              <p className="mt-2">
                Ширина — от {formatNum(CONTENT_WIDTH_MIN)} до{" "}
                {formatNum(CONTENT_WIDTH_MAX)} пикселей; крайнее правое
                положение — «Во весь экран», как по умолчанию. Пока бегунок
                тянут, края будущей колонки показаны линиями, а сервис стоит
                на месте; отпустите — и он плавно встанет в новую ширину.
                Если экран меньше выбранной ширины, ничего не меняется. Боковая
                панель операций и окна остаются своей ширины.
              </p>
            </>
          }
          control={
            <SettingRange
              value={contentWidthToSlider(shownWidth)}
              min={CONTENT_WIDTH_MIN}
              max={CONTENT_WIDTH_SLIDER_FULL}
              step={CONTENT_WIDTH_STEP}
              onChange={(v) => setContentWidthDraft(sliderToContentWidth(v))}
              onCommit={(v, via) => {
                // Стрелки жмут подряд: применяем, когда человек остановился, —
                // иначе каждое нажатие перестраивало бы вёрстку, а нажатие во
                // время смены кадров терялось. Мышь — сразу при отпускании.
                window.clearTimeout(widthCommitTimer.current);
                const apply = () => {
                  const next = sliderToContentWidth(v);
                  setContentWidthDraft(null);
                  if (next === useDisplayStore.getState().contentWidth) return;
                  withViewTransition(() => void setContentWidth(next));
                };
                if (via === "key") widthCommitTimer.current = window.setTimeout(apply, 400);
                else apply();
              }}
              ariaLabel="Ширина сервиса"
              valueText={formatContentWidth(shownWidth)}
              start={<ChevronsRightLeft className="w-3.5 h-3.5" />}
              end={<ChevronsLeftRight className="w-[18px] h-[18px]" />}
            />
          }
        />

        <SettingRow
          title="Размер текста в таблицах"
          status={`${TABLE_FONT_LABELS[tableFontLevel]} (${tableFontLevel}/5)`}
          help={
            <p>
              Размер шрифта в списках операций: лента «Операции», поиск, окно
              операций, дубликаты, удалённые и подобные таблицы. Остальной
              интерфейс не меняется.
            </p>
          }
          control={
            <SettingRange
              value={tableFontLevel}
              min={1}
              max={5}
              onChange={(v) => setTableFontLevel(v as TableFontLevel)}
              ariaLabel="Размер текста в таблицах"
              valueText={TABLE_FONT_LABELS[tableFontLevel]}
              start={<span className="text-[12px]">А</span>}
              end={<span className="text-[18px]">А</span>}
            />
          }
        >
          {/* Живой пример — на той же CSS-переменной, что и таблицы, поэтому
              масштабируется прямо во время перетаскивания. */}
          <div className="mt-3 rounded-lg border border-border bg-panel2/40 px-3 py-2 flex items-center justify-between gap-3">
            <span
              className="text-muted truncate"
              style={{ fontSize: "var(--tbl-font)" }}
            >
              01.06.2026 · Ёлочка · Еда дома
            </span>
            <span
              className="tabular-nums font-medium text-expense whitespace-nowrap"
              style={{ fontSize: "var(--tbl-font)" }}
            >
              {formatMoneyExample(-1234, rates.base)}
            </span>
          </div>
        </SettingRow>
      </div>

    </>
  );
}
