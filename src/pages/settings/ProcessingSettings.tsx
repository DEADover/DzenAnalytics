import { useState } from "react";
import { ChevronDown, Calculator, Coins } from "lucide-react";
import { SettingsSectionHeader } from "../../components/SettingsSectionHeader";
import { SlicesSettings } from "../../components/SlicesSettings";
import { SettingRow } from "../../components/SettingRow";
import { InfoTerm } from "../../components/InfoPopover";
import { Switch } from "../../components/Switch";
import { Segmented } from "../../components/Segmented";
import { useDataStore } from "../../store/useDataStore";
import { useZenmoneyStore, recalcBalanceCalibration } from "../../store/useZenmoneyStore";
import { useOffBalanceStore } from "../../store/useOffBalanceStore";
import { useReportPeriodStore } from "../../store/useReportPeriodStore";
import { useFreeMoneyStore } from "../../store/useFreeMoneyStore";
import { useTagModeStore } from "../../store/useTagModeStore";
import { Combobox } from "../../components/Combobox";
import { formatMoney } from "../../lib/format";

/**
 * Вкладка «Расчёты» настроек: базовая валюта, отчётный период, счета вне баланса, «Свободные деньги», разрезы. Вынесена из страницы настроек — у каждой вкладки свой файл.
 */
export function ProcessingSettings() {
  const rates = useDataStore((s) => s.rates);
  const includeOffBalance = useOffBalanceStore((s) => s.includeOffBalance);
  const zenToken = useZenmoneyStore((s) => s.token);
  const setRate = useDataStore((s) => s.setRate);
  const setBase = useDataStore((s) => s.setBase);
  const setIncludeOffBalance = useOffBalanceStore((s) => s.setIncludeOffBalance);
  // Совместный доступ: переключатель живёт в «Оформлении», а список участников
  // — в «Данных». Число участников считаем по справочнику аккаунта, чтобы на
  // личном аккаунте строки не было вовсе.
  const freeMethod = useFreeMoneyStore((s) => s.method);
  const setFreeMethod = useFreeMoneyStore((s) => s.setMethod);
  const freeReserve = useFreeMoneyStore((s) => s.reserve);
  const setFreeReserve = useFreeMoneyStore((s) => s.setReserve);
  const tagMode = useTagModeStore((s) => s.mode);
  const setTagMode = useTagModeStore((s) => s.setMode);
  // "Show all rates" toggle for the currency-rates grid in CSV
  // mode. By default only the 4 most-common currencies are shown
  // (RUB / USD / EUR / GBP) — the rest live behind an expand
  // button so this section doesn't dominate the page on first open.
  const [showAllRates, setShowAllRates] = useState(false);
  // Report period (reporting month start day)
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const setMonthStartDay = useReportPeriodStore((s) => s.setMonthStartDay);
  /** День из настроек Дзен-мани; при нём своя настройка не действует. */
  const zenMonthStartDay = useReportPeriodStore((s) => s.zenDay);
  const followZenDay = useReportPeriodStore((s) => s.followZenDay);
  // День расходится с Дзен-мани — отчёты здесь и в приложении будут о разных
  // отрезках. Не запрещаем, но говорим об этом прямо в строке настройки.
  const dayDiffersFromZen = zenMonthStartDay !== null && zenMonthStartDay !== monthStartDay;
  const dayWindow = (day: number) =>
    day === 1
      ? "Календарный месяц"
      : day >= 29
        ? `С ${day}-го числа по предыдущее следующего; в коротком месяце — с последнего дня`
        : `С ${day}-го числа по ${day - 1}-е следующего`;
  return (
    <>

      {/* Одна карточка на всю вкладку: раньше это были три отдельных блока,
          каждый с абзацем пояснений над контролом, и вкладка читалась как
          стена текста. Здесь строки, а подробности — за знаками вопроса. */}
      <div className="card-tray card-pad">
        <SettingsSectionHeader
          icon={Calculator}
          title="Как считать"
          className="mb-1"
        />
        <p className="text-xs text-muted mb-3">
          Базовые правила, по которым собираются все итоги, графики и отчёты.
        </p>

        <SettingRow
          title="Базовая валюта"
          status={`Все суммы и графики показываются в ${rates.base}`}
          help={
            <>
              <p>
                Валюта, в которую сводятся операции всех остальных валют. Меняя
                её, вы меняете только представление — сами операции остаются в
                своих валютах.
              </p>
              <p>
                {zenToken
                  ? "Курсы приходят из Дзен-мани при каждой синхронизации, настраивать их вручную не нужно."
                  : "В режиме CSV курсы задаются вручную ниже — по ним и сводятся суммы."}
              </p>
            </>
          }
          control={
            /* Код валюты — всегда три буквы: поле шире только съедает строку. */
            <div className="w-24">
              <Combobox
                value={rates.base}
                options={Object.keys(rates.rates).sort()}
                onChange={(next) => {
                  setBase(next).catch((err: Error) => alert(err.message));
                }}
                allowCustom={false}
                maxHeight="min(40vh, 280px)"
              />
            </div>
          }
        />

        <SettingRow
          title="Первый день отчётного периода"
          status={
            dayDiffersFromZen ? (
              <>
                {dayWindow(monthStartDay)}
                {` · В Дзен-мани — ${
                  zenMonthStartDay === 1 ? "календарный месяц" : `с ${zenMonthStartDay}-го числа`
                }, отчёты могут не сойтись с приложением · `}
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() => void followZenDay()}
                >
                  Как в Дзен-мани
                </button>
              </>
            ) : (
              (zenMonthStartDay !== null ? "Как в Дзен-мани · " : "") + dayWindow(monthStartDay)
            )
          }
          statusTone={dayDiffersFromZen ? "warn" : undefined}
          help={
            <>
              <p>
                Многие ведут учёт не «с 1-го по последнее», а от зарплаты до
                зарплаты — например с 11-го по 10-е. Здесь задаётся день, с
                которого начинается ваш отчётный период. В Дзен-мани та же
                настройка называется «Дата начала периода».
              </p>
              <p>
                Влияет на фильтр «Месяц», столбцы и таблицу Cash-flow, итоги «Доход /
                Расход за …», «Топ-10 категорий» и переход в операции месяца.
                «Год к году» и сезонность остаются по календарю: там месяц имеет
                смысл только как календарный.
              </p>
              <p>
                Допустимы значения 1–31, как и в Дзен-мани. В месяце, где
                такого числа нет, месяц начинается в его последний день: с днём
                31 февральский период идёт с 28 февраля (29-го в високосный год).
              </p>
              <p>
                При подключённом Дзен-мани день сразу берётся из его настроек,
                чтобы отчёты не расходились с приложением. Поставите здесь
                другой — действовать будет он, а в строке появится
                предупреждение: аналитика тогда считает не тот отрезок, что
                показывает приложение Дзен-мани. «Как в Дзен-мани» возвращает
                день из приложения.
              </p>
            </>
          }
          control={
            <input
              type="number"
              min={1}
              max={31}
              value={monthStartDay}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) setMonthStartDay(n);
              }}
              aria-label="День начала расчётного месяца"
              /* Значение — 1–28, то есть максимум два знака; по центру, чтобы
                 однозначное число не висело у левого края. */
              className="input text-sm w-16 tabular-nums text-center"
            />
          }
        />

        <SettingRow
          title="Счета вне баланса"
          status={
            includeOffBalance
              ? "Считаются везде, как обычные"
              : "Не входят ни в балансы, ни в итоги"
          }
          help={
            <>
              <p>
                В Дзен-мани счёт можно пометить как «вне баланса» — накопительные,
                брокерские, всё, что вы не держите в повседневном балансе. Пока
                переключатель выключен, мы это повторяем — одним правилом на
                весь сервис:
              </p>
              <ul className="list-disc pl-4 space-y-1">
                <li>
                  операции по таким счетам не входят ни в какие итоги: ни на
                  главной, ни в «Категориях», «Cash-flow», «Топе», «Сравнении»,
                  «Доходах и расходах» и остальных разделах аналитики;
                </li>
                <li>
                  бюджет с периметром «все счета» считает только счета в
                  балансе — так же, как сам Дзен-мани. Выбранный явно счёт вне
                  баланса в бюджете остаётся;
                </li>
                <li>
                  «Капитал» на главной и график «Совокупно» в «Счетах» считают
                  только балансовые счета. «Балансы счетов» на главной по
                  умолчанию тоже, но у виджета свой переключатель «В балансе /
                  Все» — он меняет только сам виджет.
                </li>
              </ul>
              <p>
                Списки операций — «Операции», «Поиск» и другие — и сам список
                в «Счетах» показывают всё: это реестр, а не итог. Включите
                переключатель — такие счета и их операции считаются везде, как
                обычные. Цель FIRE настраивается отдельно — там свой выбор
                счетов.
              </p>
              <p>
                На общем аккаунте Дзен-мани переключатель у каждого участника
                свой и на другие устройства переносится только к вам.
              </p>
            </>
          }
          control={
            <Switch
              checked={includeOffBalance}
              label="Учитывать счета вне баланса"
              onChange={async (next) => {
                await setIncludeOffBalance(next);
                // Пересобираем привязку баланса, чтобы «Совокупный баланс»
                // обновился сразу (только режим API; для CSV — no-op).
                await recalcBalanceCalibration();
              }}
            />
          }
        />

        {/* Теги (#69). В «Расчётах», а не в «Оформлении»: от выбора зависит,
            какие операции попадут в суммы раздела «Теги». */}
        <SettingRow
          title="Теги операций"
          status={
            tagMode === "hashtags"
              ? "Хэштеги из комментария: «Ужин #отпуск»"
              : "Вторая и следующие категории операции"
          }
          help={
            <>
              <p>
                Пометить операцию сверх категории в Дзен-мани можно двумя
                способами, и раздел «Теги» умеет оба — выберите тот, которым
                пользуетесь.
              </p>
              <p>
                <InfoTerm>Хэштеги</InfoTerm> — слова с решёткой в комментарии:
                «Ужин #отпуск». Пишутся прямо в тексте, решётка подсказывает уже
                знакомые.
              </p>
              <p>
                <InfoTerm>Вторые категории</InfoTerm> — Дзен-мани разрешает
                поставить операции несколько категорий. Первая остаётся основной
                и по ней считается вся аналитика, а вторую и следующие многие
                ведут как теги: «Отпуск», «Ремонт». В этом режиме их можно
                ставить и снимать прямо в карточке операции.
              </p>
              <p>
                Выбор влияет только на раздел «Теги» и поле тегов в карточке.
                Вторые категории и без него видны в фильтре категорий, находятся
                поиском и считаются в справочнике.
              </p>
            </>
          }
          control={
            <Segmented
              label="Что считать тегами"
              value={tagMode}
              onChange={(v) => void setTagMode(v)}
              options={[
                { value: "hashtags", label: "Хэштеги" },
                { value: "categories", label: "Вторые категории" },
              ]}
            />
          }
        />

        {!zenToken && (
          <SettingRow
            title="Курсы валют"
            status={`Заданы вручную, к ${rates.base}`}
            help={
              <p>
                В режиме CSV курсы неоткуда взять автоматически. Задайте те, по
                которым хотите сводить суммы; при подключении Дзен-мани они
                начнут приходить сами.
              </p>
            }
          >
            {(() => {
              // Ходовые валюты сверху, остальные — за кнопкой: иначе строка
              // разрастается редкими валютами при первом же открытии.
              const priority = ["RUB", "USD", "EUR", "GBP"];
              const allEntries = Object.entries(rates.rates).sort(([a], [b]) => {
                const pa = priority.indexOf(a);
                const pb = priority.indexOf(b);
                if (pa !== -1 && pb !== -1) return pa - pb;
                if (pa !== -1) return -1;
                if (pb !== -1) return 1;
                return a.localeCompare(b);
              });
              const visible = showAllRates ? allEntries : allEntries.slice(0, 4);
              const hiddenCount = allEntries.length - visible.length;
              return (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                    {visible.map(([cur, val]) => (
                      <div key={cur}>
                        <label className="label block mb-1">1 {cur} =</label>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="0.01"
                            value={val}
                            onChange={(e) => setRate(cur, Number(e.target.value) || 0)}
                            disabled={cur === rates.base}
                            className="input text-sm"
                          />
                          <span className="text-xs text-muted">{rates.base}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {(hiddenCount > 0 || showAllRates) && (
                    <button
                      type="button"
                      onClick={() => setShowAllRates((v) => !v)}
                      className="mt-3 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                    >
                      <ChevronDown
                        className={`w-3.5 h-3.5 transition-transform ${
                          showAllRates ? "rotate-180" : ""
                        }`}
                      />
                      {showAllRates
                        ? "Свернуть"
                        : `Показать ещё ${hiddenCount} ${
                            hiddenCount === 1
                              ? "валюту"
                              : hiddenCount < 5
                                ? "валюты"
                                : "валют"
                          }`}
                    </button>
                  )}
                </>
              );
            })()}
          </SettingRow>
        )}
      </div>

      {/* Виджет «Свободные деньги» (#96) — своей карточкой. Это настройки
          одного виджета на главной, а не правила всех расчётов: в общей
          карточке «Как считать» они читались как глобальные. В «Расчётах», а
          не в «Оформлении», потому что меняют само число, а не вид. */}
      <div className="card-tray card-pad">
        <SettingsSectionHeader
          icon={Coins}
          title="Виджет «Свободные деньги»"
          className="mb-1"
        />
        <p className="text-xs text-muted mb-3">
          Действуют только на этот виджет на главной — остальные итоги и
          отчёты не меняют.
        </p>

        <SettingRow
          title="Расчёт на день"
          status={
            freeMethod === "cumulative"
              ? "Накопительный: непотраченное переносится на завтра"
              : "Ежедневный: лимит считается заново каждый день"
          }
          help={
            <>
              <p>
                Виджет «Свободные деньги» на главной делит свободные деньги на
                дни до конца отчётного периода. Делить можно двумя способами —
                теми же, что предлагает Дзен-мани.
              </p>
              <p>
                <InfoTerm>Накопительный</InfoTerm> — лимит на день один на весь
                период, а непотраченное копится отдельной суммой: не потратив
                ничего три дня, на четвёртый можно потратить вчетверо больше.
                Прощает неровные дни, а неровными траты и бывают.
              </p>
              <p>
                <InfoTerm>Ежедневный</InfoTerm> — остаток делится на оставшиеся
                дни заново каждое утро. Вчерашняя экономия не пропадает, но
                отдельно её не видно: она просто чуть поднимает лимит.
              </p>
              <p>
                Переключить метод можно и прямо в виджете — у заголовка «На
                сегодня». Начало периода виджет берёт из настроек самого
                Дзен-мани, а не отсюда: иначе он молча разошёлся бы с
                самим приложением Дзен-мани.
              </p>
            </>
          }
          control={
            <Segmented
              label="Метод расчёта свободных на день"
              value={freeMethod}
              onChange={(v) => void setFreeMethod(v)}
              options={[
                { value: "cumulative", label: "Накопительный" },
                { value: "daily", label: "Ежедневный" },
              ]}
            />
          }
        />

        <SettingRow
          title="Неснижаемый остаток"
          status={
            freeReserve > 0
              ? `${formatMoney(freeReserve, rates.base)} не попадут в свободные`
              : "Не задан — свободными считаются все деньги на счетах"
          }
          help={
            <>
              <p>
                Сумма, которую вы не собираетесь тратить: подушка на счёте,
                отложенное на крупную покупку. Вычитается из свободных денег
                сразу, поэтому виджет не предложит потратить то, что трогать не
                планировалось.
              </p>
              <p>
                Это не то же самое, что счета вне баланса: там вы убираете счёт
                целиком, здесь — часть суммы на обычных счетах.
              </p>
            </>
          }
          control={
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                step={1000}
                value={freeReserve || ""}
                placeholder="0"
                onChange={(e) => {
                  const n = Number(e.target.value);
                  void setFreeReserve(Number.isFinite(n) ? n : 0);
                }}
                aria-label="Неснижаемый остаток"
                className="input text-sm w-32 tabular-nums text-right"
              />
              <span className="text-sm text-muted">{rates.base}</span>
            </div>
          }
        />
      </div>

      {/* «Группировка получателей» отключена (2026-08).
          Её задачу лучше решает справочник контрагентов: там получатель —
          настоящая запись Дзен-мани, переименование уезжает в облако и
          действует у всех операций сразу, а «Без контрагента» разбирает
          строки от банка адресно. Автонормализация же склеивала по догадке
          и жила только в этом браузере.

          Блок оставлен закомментированным: если решим вернуть — код здесь,
          вместе с ним в `useDataStore` живут `payeeGroupingEnabled`,
          `applyPayeeGrouping` и ручные алиасы.


      {/* Группировка получателей — единый блок: автонормализация +
          ручные правила. Раньше были две отдельные карточки, теперь
          объединены, потому что обе работают с одним и тем же
          концептом (один и тот же payee, несколько написаний). *\/}
      {transactions.length > 0 && (
        <div className="card-tray card-pad">
          <SettingsSectionHeader
            icon={Users}
            title="Группировка получателей"
            className="mb-3"
          />
          <p className="text-xs text-muted mb-4">
            Объединяет варианты одного и того же получателя.
            Автонормализация работает по умолчанию (удаление номеров,
            пробелов, форм. суффиксов, лидирующих банков — «Ёлочка #1234»
            и «YOLOCHKA-MOSCOW» → один payee). Ручные правила применяются
            <em> поверх</em> автогруппировки и работают независимо от
            её переключателя.
          </p>

          {/* — Auto grouping toggle — *\/}
          <label className="flex items-center gap-3 p-3 bg-panel2 rounded-lg border border-border cursor-pointer">
            <Checkbox
              checked={payeeGrouping}
              onChange={(on) => setPayeeGrouping(on)}
              label="Группировать по контрагентам"
            />
            <div className="flex-1">
              <div className="font-medium text-sm">
                Автогруппировка получателей
              </div>
              <div className="text-xs text-muted">
                {aliasPreview && aliasPreview.size > 0
                  ? `Найдено вариантов: ${aliasPreview.size}. Переключатель обратимый — можно вернуть оригинальные имена.`
                  : "Похожих получателей не найдено в текущих данных."}
              </div>
            </div>
          </label>
          {payeeGrouping && aliasPreview && aliasPreview.size > 0 && (
            <details className="mt-3">
              <summary className="text-xs text-accent cursor-pointer hover:underline">
                Показать применённые объединения ({aliasPreview.size})
              </summary>
              <p className="text-[11px] text-muted mt-2">
                Цель объединения можно изменить прямо здесь — впишите своё
                название. Правка сохранится как ручное правило (помечено
                рамкой); кнопка ↺ вернёт автозначение.
              </p>
              <div className="mt-2 max-h-72 overflow-y-auto pr-1">
                {Array.from(aliasPreview.entries())
                  .sort((a, b) => a[0].localeCompare(b[0], "ru"))
                  .map(([from, autoTo]) => {
                    const manualTo = manualAliasMap.get(from);
                    const overridden = manualTo !== undefined;
                    return (
                      <AutoGroupRow
                        key={from}
                        from={from}
                        autoTo={autoTo}
                        overridden={overridden}
                        effectiveTo={manualTo ?? autoTo}
                        onCommit={(f, to) => {
                          addAlias(f, to).then(reapplyRules);
                        }}
                        onReset={(f) => {
                          removeAlias(f).then(reapplyRules);
                        }}
                      />
                    );
                  })}
              </div>
            </details>
          )}

          {/* — Manual aliases — *\/}
          <div className="mt-5 pt-5 border-t border-border">
            <div className="text-sm font-medium mb-3">Ручные правила</div>

            {/* Add new alias. Combobox (not a native <input list>) so the
                suggestions dropdown is width- and height-bounded — the
                native datalist popup spilled across the whole viewport. *\/}
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-2 mb-3">
              <Combobox
                value={aliasFrom}
                options={allPayeeOptions}
                onChange={setAliasFrom}
                placeholder="Откуда (как сейчас называется)"
                maxHeight="240px"
              />
              <span className="text-muted hidden md:inline">→</span>
              <Combobox
                value={aliasTo}
                options={allPayeeOptions}
                onChange={setAliasTo}
                placeholder="Куда (как должно стать)"
                maxHeight="240px"
              />
              <button
                onClick={submitAlias}
                disabled={
                  !aliasFrom.trim() ||
                  !aliasTo.trim() ||
                  aliasFrom.trim() === aliasTo.trim()
                }
                className="btn-primary text-sm whitespace-nowrap"
              >
                Добавить
              </button>
            </div>

            {/* Existing aliases *\/}
            {manualAliases.length === 0 ? (
              <div className="text-xs text-muted">
                Пока нет ручных правил. Используйте поля выше, чтобы добавить
                первое — например, <code className="pill">Pyaterochka</code> →{" "}
                <code className="pill">Ёлочка</code>.
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto text-xs space-y-1 -mx-1 px-1">
                {manualAliases.map((a) => (
                  <div
                    key={a.from}
                    className="flex items-center gap-2 py-1 border-b border-border/40 last:border-b-0"
                  >
                    <span className="truncate flex-1 text-text" title={a.from}>
                      {a.from}
                    </span>
                    <span className="text-muted">→</span>
                    <span
                      className="truncate flex-1 text-text font-medium"
                      title={a.to}
                    >
                      {a.to}
                    </span>
                    <button
                      onClick={() => dropAlias(a.from)}
                      className="btn-icon-danger btn-icon-sm"
                      title="Удалить правило"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      */}

      {/* Разрезы — в самом низу: настройка редкая, а места занимает больше
          остальных. Сверху то, что трогают чаще. */}
      <SlicesSettings />

    </>
  );
}
