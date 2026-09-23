import { useEffect, useMemo, useRef, useState } from "react";
import { accountKindLabel } from "../lib/accountType";
import { getLiveAccountsFromCache, getBrandTitlesFromCache } from "../store/useZenmoneyStore";
import {
  Wand2,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  GripVertical,
  Pencil,
  ListChecks,
  Download,
  Upload,
} from "lucide-react";
import clsx from "clsx";
import {
  useCategoryRulesStore,
  type StoredCategoryRule,
} from "../store/useCategoryRulesStore";
import {
  RULE_TARGET_LABELS,
  ruleTargets,
  compileRuleV2,
  describeRule,
  ruleHasEffect,
  ruleMatchesV2,
} from "../lib/ruleEngine";
import { confirm } from "../store/useConfirmStore";
import { useDataStore } from "../store/useDataStore";
import { useDrillStore } from "../store/useDrillStore";
import { useEditsStore } from "../store/useEditsStore";
import { useDeletedStore } from "../store/useDeletedStore";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { makeCategoryChecker, makeKindChecks } from "../lib/zenmoneyPush";
import { loadZenCache } from "../lib/zenmoneyCache";
import { liveCategoryNodes } from "../lib/categoryTree";
import { NO_CATEGORY } from "../lib/zenmoneyMap";
import type { CategoryNode } from "../components/CategoryCascadePicker";
import type { ZenTag } from "../lib/zenmoney";
import { groupByCategory } from "../lib/aggregations";
import { formatNum } from "../lib/format";
import { pluralRu } from "../lib/plural";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { StatCell, StatRow } from "../components/SectionCard";
import { Tooltip } from "../components/Tooltip";
import { Checkbox } from "../components/Checkbox";
import { HeadCell } from "../components/table/TableParts";
import { cellClass } from "../components/table/tableKit";
import { CardHeader } from "../components/CardHeader";
import { RuleEditModal, type RuleDraft } from "../components/RuleEditModal";
import { RulePreviewModal } from "../components/RulePreviewModal";
import { buildRulePlan, type KindChecks, type RuleRow } from "../lib/rulePlan";
import { AlertTriangle } from "lucide-react";
import { rulesView } from "../lib/rulesView";
import { RuleModeChip } from "../components/RuleModeControl";
import { ruleModeFields, ruleModeOf, type RuleMode } from "../lib/ruleMode";
import type { RuleSchedule } from "../lib/ruleSchedule";
import { userEdits } from "../lib/editOrigins";
import { SectionEmpty } from "../components/SectionEmpty";
import { RulesImportModal } from "../components/RulesImportModal";
import { RulesExportModal } from "../components/RulesExportModal";
import { RULES_FILE_MAX_BYTES, parseRulesFile, type RulesFileParse } from "../lib/rulesTransfer";

/**
 * «Правила» — справочник правил в том же виде, что «Счета» и
 * справочники операций: карточка с панелью действий сверху и таблицей ниже,
 * иконки-действия в колонке «Действия», создание и правка — в модалке.
 *
 * Одна кнопка, один план. Раньше кнопок было две — «Проверить правила» и
 * «Применить правила», — но открывали они одно и то же окно с одним и тем же
 * расчётом (`buildRulePlan`), различаясь лишь тем, отмечены ли строки заранее;
 * разницу приходилось объяснять абзацем в справке. Теперь «Проверить и
 * применить» открывает разбор, а запись живёт внутри окна — перед необратимым
 * действием список всегда на глазах. Все числа на странице считаются из ОДНОГО
 * плана: два независимых расчёта разошлись бы, и объяснить разницу было бы нечем.
 */
/**
 * Что рассказывает подсказка над галочками.
 *
 * Заголовка у колонки нет намеренно: одно слово («Выбор», «Прогнать») смысла не
 * добавляло — из него всё равно не понять, чем галочка отличается от режима и
 * зачем она нужна. Объяснять надо сценарий, а он в заголовок не влезает.
 */
const PICK_HELP = (
  <span className="block space-y-1.5">
    <span className="block font-medium">Какие правила прогнать сейчас</span>
    <span className="block">
      «Проверить и применить» разбирает только отмеченные — так прогоняют одно
      правило, не выключая остальные. Отметки сбрасываются при перезагрузке и на
      сами правила не влияют.
    </span>
  </span>
);



export function RulesPage() {
  const transactions = useDataStore((s) => s.transactions);
  const transactionsRaw = useDataStore((s) => s.transactionsRaw);
  const reapplyRules = useDataStore((s) => s.reapplyRules);
  const ruleRuns = useDataStore((s) => s.ruleRuns);
  const loadRuleRuns = useDataStore((s) => s.loadRuleRuns);
  const runRuleNow = useDataStore((s) => s.runRuleNow);
  const showDrill = useDrillStore((s) => s.show);
  const edits = useEditsStore((s) => s.edits);
  const editOrigins = useEditsStore((s) => s.origins);
  const setEditEach = useEditsStore((s) => s.setEditEach);
  const deletedSet = useDeletedStore((s) => s.deletedSet);
  const token = useZenmoneyStore((s) => s.token);
  const pushMode = useZenmoneyStore((s) => s.pushMode);

  const rules = useCategoryRulesStore((s) => s.rules);
  const add = useCategoryRulesStore((s) => s.add);
  const update = useCategoryRulesStore((s) => s.update);
  const remove = useCategoryRulesStore((s) => s.remove);
  const move = useCategoryRulesStore((s) => s.move);
  const reorder = useCategoryRulesStore((s) => s.reorder);
  const hydrate = useCategoryRulesStore((s) => s.hydrate);
  const loaded = useCategoryRulesStore((s) => s.loaded);

  useEffect(() => {
    if (!loaded) hydrate();
  }, [loaded, hydrate]);

  // Журнал заходов лежит на диске: страница правил — единственное место, где он
  // нужен, поэтому читаем его здесь, а не при загрузке всего приложения.
  useEffect(() => {
    void loadRuleRuns();
  }, [loadRuleRuns]);

  /** null — окно закрыто, «create» — новое правило, иначе редактируем. */
  const [editing, setEditing] = useState<StoredCategoryRule | "create" | null>(null);
  const [loadedZenTags, setZenTags] = useState<ZenTag[] | null>(null);
  /** Проверки смены типа: долговые счета, валюты, категории (#98). */
  const [loadedKindChecks, setKindChecks] = useState<KindChecks | null>(null);
  // Отключились от Дзен-мани — справочника нет, и это видно прямо здесь.
  // Раньше состояние обнулял эффект: он срабатывал уже после отрисовки, и
  // один кадр список категорий показывался по справочнику, которого больше
  // нет.
  const zenTags = token ? loadedZenTags : null;
  const kindChecks = token ? loadedKindChecks : null;
  /** Окно «Что изменят правила» — разбор и запись за один заход. */
  const [preview, setPreview] = useState(false);
  /** Прочитанный файл правил — пока открыто окно импорта. */
  const [importing, setImporting] = useState<{ fileName: string; parsed: RulesFileParse } | null>(
    null
  );
  const importInputRef = useRef<HTMLInputElement>(null);
  /** Мастер экспорта открыт. */
  const [exporting, setExporting] = useState(false);

  async function openImportFile(file: File) {
    const parsed: RulesFileParse =
      file.size > RULES_FILE_MAX_BYTES
        ? { ok: false, error: "Файл слишком большой для файла правил." }
        : parseRulesFile(await file.text());
    setImporting({ fileName: file.name, parsed });
  }

  /**
   * Правила, отобранные для прогона, — по ним считается план и по ним же
   * работает кнопка «Проверить и применить».
   *
   * Фильтр и «Включено» — разные вещи, и путать их нельзя: выключенное правило
   * не действует вообще, а невыбранное просто не участвует в ЭТОМ прогоне.
   * Один раз колонку «Выбор» убрали — именно из-за того, что две соседние
   * галочки читались как одно и то же, — и вместе с ней пропала возможность
   * прогнать часть правил (issue #61). Вернули, но «Включено» теперь
   * переключатель-пилюля: спутать его с галочкой фильтра уже нельзя.
   *
   * `null` — «ничего руками не трогали», и тогда отобраны все включённые.
   * Так новое правило само попадает в прогон, а не молча выпадает из него.
   */
  const [picked, setPicked] = useState<Set<string> | null>(null);
  /** Перетаскиваемое правило и строка, над которой оно сейчас висит. */
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const enabledIds = useMemo(
    () => rules.filter((r) => r.enabled).map((r) => r.id),
    [rules]
  );
  const selectedIds = useMemo(() => {
    if (!picked) return new Set(enabledIds);
    // Выключенное правило из фильтра выпадает само: держать его отмеченным
    // значило бы обещать прогон, которого не будет.
    return new Set(enabledIds.filter((id) => picked.has(id)));
  }, [picked, enabledIds]);
  const allPicked = enabledIds.length > 0 && selectedIds.size === enabledIds.length;
  const togglePicked = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev ?? enabledIds);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const allCategories = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) {
      if (t.categoryFullOriginal) set.add(t.categoryFullOriginal);
      if (t.categoryFull) set.add(t.categoryFull);
    }
    // Популярные — первыми в подсказках: их выбирают чаще всего.
    const popular = groupByCategory(transactions, "full")
      .slice(0, 30)
      .map((c) => c.category);
    const rest = Array.from(set)
      .filter((c) => !popular.includes(c))
      .sort((a, b) => a.localeCompare(b, "ru"));
    return [...popular, ...rest];
  }, [transactions]);

  /**
   * Счета для условия «Счёт»: плоский список и разбивка по виду счёта.
   *
   * Вид («Карта», «Депозит», «Долги») берётся из справочника Дзен-мани, как в
   * панели фильтров, — чтобы список читался одинаково в обоих местах. В режиме
   * CSV метаданных нет, тогда группировки просто не будет.
   */
  const [accountKinds, setAccountKinds] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let cancelled = false;
    void getLiveAccountsFromCache().then((live) => {
      if (cancelled || !live) return;
      const m = new Map<string, string>();
      for (const a of live) m.set(a.title, accountKindLabel(a.type, a.savings));
      setAccountKinds(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const allAccounts = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) {
      for (const a of [t.account, t.outcomeAccount, t.incomeAccount]) {
        if (a) set.add(a);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [transactions]);

  const accountGroups = useMemo(() => {
    if (accountKinds.size === 0) return undefined;
    const byKind = new Map<string, string[]>();
    for (const title of allAccounts) {
      const kind = accountKinds.get(title) || "Прочие";
      const list = byKind.get(kind);
      if (list) list.push(title);
      else byKind.set(kind, [title]);
    }
    return [...byKind.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "ru"))
      .map(([label, items]) => ({ label, items }));
  }, [allAccounts, accountKinds]);

  const allPayees = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) {
      const v = t.brand?.trim() || t.payee?.trim();
      if (v) set.add(v);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
  }, [transactions]);

  /** Сколько операций подходит под условия каждого правила — считаем тем же
   *  движком, что и применение, по исходникам: у уже сработавшего правила счёт
   *  по текущим значениям показал бы ноль. */
  /**
   * Записать режим и расписание одной правкой — их и выбирают одним окном.
   *
   * Оба поля режима задаём явно: иначе у выключенного правила осталось бы
   * висеть `autoApply: true`, невидимое на экране. Расписание при этом не
   * стирается — работать оно всё равно не будет, а вернувшись в «Авто»,
   * человек не станет настраивать его заново.
   */
  const setModeValue = (id: string, next: { mode: RuleMode; schedule?: RuleSchedule }) =>
    update(id, { ...ruleModeFields(next.mode), schedule: next.schedule }).then(reapplyRules);

  const matchCounts = useMemo(() => {
    const out = new Map<string, number>();
    for (const r of rules) {
      const compiled = compileRuleV2(r);
      let n = 0;
      for (const t of transactionsRaw) if (ruleMatchesV2(t, r, compiled)) n++;
      out.set(r.id, n);
    }
    return out;
  }, [rules, transactionsRaw]);

  // Справочник тегов Дзен-мани — чтобы заранее отсеять категории, под которые
  // в облаке нет тега. Без подключения проверять нечем.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void loadZenCache().then((cache) => {
      if (cancelled) return;
      setZenTags(cache?.tags ?? []);
      setKindChecks(cache ? makeKindChecks(cache) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const categoryOk = useMemo(
    () => (zenTags ? makeCategoryChecker(zenTags) : null),
    [zenTags]
  );

  /**
   * Категории для ДЕЙСТВИЯ правила — по живому справочнику Дзен-мани.
   *
   * Условие правила по-прежнему выбирается из истории (`allCategories`): туда
   * и нужны старые имена, иначе не поймать операции с категорией, которой уже
   * нет. А вот записать правило может только то, что примет отправка, — иначе
   * правка навсегда зависнет с «Категория не найдена в Дзен-мани».
   *
   * Без подключения (`zenTags === null`) живого справочника нет — тогда список
   * остаётся прежним, из истории.
   */
  const liveCategories = useMemo<CategoryNode[] | null>(() => {
    if (!zenTags) return null;
    // «Без категории» — это очистка тега, а не поиск по справочнику: правило
    // «убрать категорию» должно оставаться возможным.
    return [{ name: NO_CATEGORY, subs: [] }, ...liveCategoryNodes(zenTags)];
  }, [zenTags]);

  /**
   * Названия контрагентов из справочника — чтобы отличить живое правило от
   * устаревшего. Правило хранит получателя текстом; после переименования или
   * удаления контрагента имя в правиле может уже никому не соответствовать.
   */
  const [brandTitles, setBrandTitles] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getBrandTitlesFromCache().then((list) => {
      if (!cancelled) setBrandTitles(list);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const payeeOk = useMemo(() => {
    if (!brandTitles) return null;
    const set = new Set(brandTitles.map((t) => t.trim().toLowerCase()));
    return (title: string) => set.has(title.trim().toLowerCase());
  }, [brandTitles]);

  /**
   * Операции глазами правил: исходник плюс ПРАВКИ РУКАМИ.
   *
   * Из-за этого правило замечает то, что человек поправил сам: поменяли
   * комментарий — операция стала подходить, и она появляется в разборе. Своих
   * записей правило по-прежнему не видит, иначе счётчик совпадений обнулялся
   * бы сразу после применения (issue #75).
   */
  const matchable = useMemo(
    () => rulesView(transactionsRaw, userEdits(edits, editOrigins)),
    [transactionsRaw, edits, editOrigins]
  );

  /** План по ВЫБРАННЫМ правилам — то, что показывает окно и то, что запишется. */
  const plan = useMemo(
    () =>
      buildRulePlan(
        matchable,
        rules,
        selectedIds,
        edits,
        deletedSet,
        categoryOk,
        payeeOk,
        kindChecks
      ),
    [matchable, rules, selectedIds, edits, deletedSet, categoryOk, payeeOk, kindChecks]
  );

  function openMatches(rule: StoredCategoryRule) {
    const compiled = compileRuleV2(rule);
    const ids = new Set(
      transactionsRaw.filter((t) => ruleMatchesV2(t, rule, compiled)).map((t) => t.id)
    );
    const matches = transactions.filter((t) => ids.has(t.id));
    showDrill(`Совпадений: ${matches.length}`, matches, describeRule(rule));
  }

  async function saveRule(draft: RuleDraft) {
    const patch = {
      enabled: draft.enabled,
      autoApply: draft.autoApply,
      schedule: draft.schedule,
      title: draft.title,
      groups: draft.groups,
      join: draft.join,
      actions: draft.actions,
    };
    if (editing && editing !== "create") await update(editing.id, patch);
    else await add(patch);
    await reapplyRules();
  }

  async function removeRule(rule: StoredCategoryRule) {
    const ok = await confirm({
      title: "Удалить правило?",
      message:
        "Правило перестанет предлагать изменения. То, что уже записано кнопкой «Проверить и применить», останется — это обычные правки операций, их отменяют построчно в списке изменений.",
      confirmLabel: "Удалить",
      tone: "danger",
    });
    if (ok) {
      await remove(rule.id);
      await reapplyRules();
    }
  }

  async function applyRows(rows: RuleRow[]) {
    const patches: Record<string, import("../store/useEditsStore").TransactionEdit> = {};
    for (const r of rows) patches[r.tx.id] = r.patch;
    // «rule» — чтобы автоприменение потом не спорило с человеком: поля,
    // записанные правилом, остаются его, а правленные руками — неприкосновенны.
    await setEditEach(patches, "rule");
    await reapplyRules();
  }

  if (transactions.length === 0) return <EmptyState />;

  // Дешёвые O(n) проходы — живут после раннего return, поэтому без useMemo.
  const enabledCount = rules.filter((r) => r.enabled).length;
  // Операции, в которых правила что-то записали, — по отметкам «записано
  // правилом» в слое правок. Раньше считались только операции со сменённой
  // категорией, и правила про комментарий, получателя или тип в плитку не
  // попадали вовсе: записали 599 — плитка показывала 59.
  const totalAffected = Object.keys(edits).filter(
    (id) => (editOrigins[id]?.length ?? 0) > 0
  ).length;
  // Всё, что показано числом на этой странице, считается из одного `plan` —
  // иначе плитка и кнопка разошлись бы, и объяснить разницу было бы нечем.
  const waiting = plan.pending.length + plan.skippedCount;

  const previewNotes = [
    token
      ? pushMode === "off"
        ? "Отправка в Дзен-мани сейчас выключена — правки останутся на этом устройстве, пока вы её не включите."
        : "Дальше правки уедут в Дзен-мани тем же путём, что и правки из редактора операции."
      : "Дзен-мани не подключён — правки останутся только на этом устройстве.",
    "Отменить можно построчно в списке изменений. Выключение правила записанное не отменяет: правки живут отдельно от правил.",
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Wand2}
        title="Правила"
      />

      <StatRow>
        <StatCell
          label="Активных правил"
          value={
            <>
              {formatNum(enabledCount)}{" "}
              <span className="text-muted text-sm font-normal">из {formatNum(rules.length)}</span>
            </>
          }
        />
        <StatCell
          label="Изменено операций"
          tone="accent"
          value={formatNum(totalAffected)}
          note={
            totalAffected > 0 && waiting === 0 ? "Всё записано в операции" : undefined
          }
        />
        <StatCell
          label="Ждут записи"
          tone={waiting > 0 ? "warn" : "default"}
          value={formatNum(waiting)}
          note="Результат выбранных правил, ещё не ставший правкой операции"
        />
      </StatRow>

      <div className="card-tray card-pad">
        {/* Панель действий — как в справочниках: заголовок со счётчиком,
            пояснение под «?», действия справа. */}
        <CardHeader
          icon={Wand2}
          title={
            <>
              Правила (<span className="tabular-nums">{rules.length}</span>)
            </>
          }
          infoLabel="Как это работает"
          info={
            <>
              <p>
                <strong className="text-text">Правило</strong> отбирает операции
                по условиям и меняет у них категорию, получателя или
                комментарий. Само по себе оно ничего не переписывает.
              </p>
              <p>
                <strong className="text-text">«Режим»</strong> — что правило
                делает вообще:
              </p>
              <ul className="list-disc list-inside space-y-0.5 pl-1">
                <li>
                  <strong className="text-text">Выкл</strong> — не работает
                  нигде;
                </li>
                <li>
                  <strong className="text-text">По кнопке</strong> — только
                  через «Проверить и применить»;
                </li>
                <li>
                  <strong className="text-text">Авто</strong> — само, при
                  синхронизации. По умолчанию трогает лишь операции, которых
                  раньше не было; с расписанием — проходит и по истории.
                </li>
              </ul>
              <p>
                <strong className="text-text">Галочки слева</strong> — какие
                правила разобрать кнопкой сейчас. Так прогоняют одно правило,
                не выключая остальные. Они сбрасываются при перезагрузке и на
                сами правила не влияют.
              </p>
              <p>
                <strong className="text-text">Порядок важен:</strong> поле
                занимает первое высказавшееся о нём правило — верхнее поставит
                категорию, нижнее ещё допишет комментарий. Двигать — стрелками
                в колонке «№».
              </p>
              <p>
                Записанное становится обычной правкой операции: откатывается
                построчно в списке изменений, а не выключением правила.
              </p>
            </>
          }
          right={
            <>
              {/* Оба замечания стоят В ШАПКЕ, а не полосой над таблицей: полоса
                  появлялась и исчезала при каждом переключении режима и двигала
                  таблицу на свою высоту — строки прыгали под курсором. Подробности
                  замечания живут в подсказке, а высота шапки не меняется. */}
              {plan.skippedCount > 0 && (
                <Tooltip
                  content={
                    <>
                      Правило хочет поставить категорию, которой нет в справочнике
                      Дзен-мани: {plan.skipped.map((x) => `«${x.category}»`).join(", ")}.
                      Такую правку облако не примет — заведите категорию в справочнике
                      или поправьте правило.
                    </>
                  }
                >
                  <span className="inline-flex items-center gap-1 text-xs text-warn whitespace-nowrap">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    {formatNum(plan.skippedCount)}{" "}
                    {pluralRu(plan.skippedCount, ["операция", "операции", "операций"])} без
                    категории в Дзен-мани
                  </span>
                </Tooltip>
              )}

              {/* «Нечего применять» стоит В ШАПКЕ, а не полосой над таблицей: полоса
                  появлялась и исчезала при каждом выключении последнего правила и
                  двигала таблицу на свою высоту — строки прыгали под курсором. */}
              {enabledIds.length === 0 && rules.length > 0 && (
                <Tooltip content="Включите нужные правила режимом «По кнопке» или «Авто» — тогда их будет что проверить и применить">
                  <span className="text-xs text-muted whitespace-nowrap">
                    Все правила выключены
                  </span>
                </Tooltip>
              )}

              {/* Одна кнопка на оба сценария: окно и раньше было одно, а две кнопки
                  отличались лишь тем, отмечены ли строки заранее. Разницу
                  приходилось объяснять абзацем в справке — значит её и не было. */}
              <button
                type="button"
                onClick={() => setPreview(true)}
                disabled={selectedIds.size === 0}
                className="btn-ghost text-xs shrink-0"
                title="Показать, что сделают выбранные правила, и записать отмеченное"
              >
                <ListChecks className="w-4 h-4" aria-hidden />
                Проверить и применить ({formatNum(plan.pending.length)})
              </button>
              <Tooltip content="Экспорт правил в файл JSON — выбрать, какие, и скачать">
                <button
                  type="button"
                  onClick={() => setExporting(true)}
                  disabled={rules.length === 0}
                  className="btn-ghost btn-square shrink-0"
                  aria-label="Экспорт правил в JSON"
                >
                  <Download className="w-4 h-4" aria-hidden />
                </button>
              </Tooltip>
              <Tooltip content="Импорт правил из файла JSON — выбрать, какие взять, и проверить перед записью">
                <button
                  type="button"
                  onClick={() => importInputRef.current?.click()}
                  className="btn-ghost btn-square shrink-0"
                  aria-label="Импорт правил из JSON"
                >
                  <Upload className="w-4 h-4" aria-hidden />
                </button>
              </Tooltip>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void openImportFile(f);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => setEditing("create")}
                className="btn-primary text-xs shrink-0"
              >
                <Plus className="w-4 h-4" />
                Добавить
              </button>
            </>
          }
        />

        {rules.length === 0 ? (
          <SectionEmpty
            variant="inline"
            icon={Wand2}
            title="Нет правил"
          >
            Создайте первое правило кнопкой <strong>«Добавить»</strong> или
            загрузите готовые из файла JSON. Правило отбирает операции по
            условиям и меняет у них категорию, получателя, комментарий или тип —
            по кнопке «Проверить и применить» или само, в режиме «Авто»
          </SectionEmpty>
        ) : (
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full">
              <thead>
                <tr>
                  {/* Сначала СУТЬ правила, потом переключатели: читают строку
                      слева направо, и «что это за правило» важнее, чем его
                      состояние. Ярлыков в «Что меняет» бывает до четырёх
                      (категория, получатель, комментарий, тип) — лишние
                      переносятся. Уже `xl` шесть колонок не помещаются, и
                      «Правило» сжималось до пары слов: там колонка прячется, а
                      ярлыки встают под названием правила. */}
                  {/* Ширина у всех колонок своя, а `w-full` у «Правила» —
                      приём для авторазметки таблицы: колонка забирает ВЕСЬ
                      остаток. Название правила бывает длинной фразой из его же
                      условий, и место нужно именно ему. */}
                  {/* Колонка без подписи: короткое слово над галочками смысла
                      не добавляло, а объяснить нужно не одно слово, а зачем эти
                      галочки вообще. Всё объяснение — в подсказке; галочка в
                      шапке заодно отмечает и снимает все разом. */}
                  <th className="table-th w-12 text-center">
                    <Tooltip content={PICK_HELP} placement="bottom">
                      <Checkbox
                        checked={allPicked}
                        indeterminate={selectedIds.size > 0}
                        disabled={enabledIds.length === 0}
                        onChange={(on) => setPicked(on ? new Set(enabledIds) : new Set())}
                        label={allPicked ? "Снять все правила" : "Отметить все правила"}
                      />
                    </Tooltip>
                  </th>
                  {/* Порядок правил — это порядок, в котором они срабатывают:
                      его задают перетаскиванием, поэтому сортировки у таблицы нет. */}
                  <HeadCell type="mark" label="№" width="6rem" />
                  <HeadCell type="text" label="Правило" className="w-full" />
                  <HeadCell
                    type="text"
                    label="Что меняет"
                    width="18rem"
                    className="hidden xl:table-cell"
                  />
                  <HeadCell type="mark" label="Режим" width="13rem" />
                  <HeadCell type="count" label="Совпадений" width="6.5rem" />
                  <HeadCell type="actions" label="Действия" width="6rem" />
                </tr>
              </thead>
              <tbody>
                {rules.map((rule, idx) => {
                  const count = matchCounts.get(rule.id) ?? 0;
                  const checked = selectedIds.has(rule.id);
                  const targets = ruleTargets(rule);
                  // Раньше получатель с комментарием выделялись
                  // предупреждающим цветом: они, в отличие от категории,
                  // менялись только после записи. Теперь так работают все
                  // поля — выделять нечего.
                  const targetPills = targets.map((t) => (
                    <span
                      key={t}
                      className="pill whitespace-nowrap"
                      title={`${RULE_TARGET_LABELS[t]} изменится после кнопки «Проверить и применить»`}
                    >
                      {RULE_TARGET_LABELS[t]}
                    </span>
                  ));
                  return (
                    <tr
                      key={rule.id}
                      draggable
                      onDragStart={(e) => {
                        setDragId(rule.id);
                        e.dataTransfer.effectAllowed = "move";
                        // Без этого Firefox не начинает перетаскивание вовсе.
                        e.dataTransfer.setData("text/plain", rule.id);
                      }}
                      onDragOver={(e) => {
                        if (dragId === rule.id) return;
                        e.preventDefault(); // разрешаем бросить сюда
                        e.dataTransfer.dropEffect = "move";
                        setDragOver(rule.id);
                      }}
                      onDragLeave={() => setDragOver((v) => (v === rule.id ? null : v))}
                      onDrop={(e) => {
                        e.preventDefault();
                        // Id берём из самого события, а не из состояния: между
                        // началом перетаскивания и броском состояние может ещё
                        // не обновиться, и бросок молча ничего бы не сделал.
                        const from = e.dataTransfer.getData("text/plain") || dragId;
                        setDragId(null);
                        setDragOver(null);
                        if (from && from !== rule.id) void reorder(from, idx).then(reapplyRules);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDragOver(null);
                      }}
                      onDoubleClick={() => setEditing(rule)}
                      className={clsx(
                        "cursor-pointer group hover:bg-panel2/50",
                        checked && "bg-accent/5",
                        !rule.enabled && "opacity-60",
                        dragId === rule.id && "opacity-40",
                        dragOver === rule.id && "outline outline-2 -outline-offset-2 outline-accent"
                      )}
                    >
                      <td className={cellClass("mark")}>
                        <Checkbox
                          checked={checked}
                          disabled={!rule.enabled}
                          stopPropagation
                          onChange={(on) => togglePicked(rule.id, on)}
                          title={
                            !rule.enabled
                              ? "Режим «Выкл» — правило не сработает, прогонять нечего"
                              : checked
                                ? "Не прогонять это правило по кнопке «Проверить и применить»"
                                : "Прогнать это правило по кнопке «Проверить и применить»"
                          }
                          label="Прогнать это правило"
                        />
                      </td>
                      <td className={cellClass("mark", { muted: true, className: "tabular-nums" })}>
                        <div className="flex items-center justify-center gap-0.5">
                          {/* Ручка — подсказка, что строку можно тащить. Тянется
                              вся строка, но без видимого захвата об этом никто
                              не догадается. */}
                          <GripVertical
                            className="w-3.5 h-3.5 text-muted/50 group-hover:text-muted cursor-grab shrink-0"
                            aria-hidden
                          />
                          <span className="w-5 text-center">{idx + 1}</span>
                          {/* Стрелки в строку, а не столбиком: столбик из двух
                              значков делал строку выше стандартных 37 px. */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void move(rule.id, -1).then(reapplyRules);
                            }}
                            disabled={idx === 0}
                            className="btn-icon btn-icon-sm"
                            title="Выше"
                            aria-label="Поднять правило"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void move(rule.id, 1).then(reapplyRules);
                            }}
                            disabled={idx === rules.length - 1}
                            className="btn-icon btn-icon-sm"
                            title="Ниже"
                            aria-label="Опустить правило"
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                      {/* `max-w-0` в паре с `w-full` у заголовка — то, что
                          заставляет колонку ЗАНЯТЬ остаток и при этом обрезать
                          длинное название, а не растягивать таблицу за край
                          экрана. Правило без своего имени описывается фразой из
                          собственных условий, и она бывает очень длинной;
                          целиком её показывает подсказка. */}
                      <td className={cellClass("text", { className: "max-w-0" })}>
                        <div className="flex items-center gap-1.5 min-w-0">
                          {/* Пустое правило помечено значком с подсказкой, а не
                              второй строкой: строка таблицы остаётся одной. */}
                          {!ruleHasEffect(rule) && (
                            <Tooltip content="Ни одно действие не заполнено — правило ничего не делает">
                              <AlertTriangle
                                className="w-3.5 h-3.5 shrink-0 text-warn"
                                aria-label="Правило ничего не делает"
                              />
                            </Tooltip>
                          )}
                          <span className="truncate group-hover:text-accent" title={describeRule(rule)}>
                            {describeRule(rule) || "Правило не дописано"}
                          </span>
                        </div>
                        {targets.length > 0 && (
                          <div className="xl:hidden flex flex-wrap items-center gap-1 mt-1">
                            {targetPills}
                          </div>
                        )}
                      </td>
                      <td className={cellClass("text", { className: "hidden xl:table-cell" })}>
                        {/* Минимальная ширина — на два ярлыка в строке. У
                            «Правила» ширина 100%, и таблица ужимает остальные
                            колонки до минимума содержимого: без неё ярлыки
                            вставали столбиком по одному. */}
                        <div className="flex flex-wrap items-center gap-1 min-w-[12rem]">
                          {targets.length === 0 ? (
                            <span className="text-muted">—</span>
                          ) : (
                            targetPills
                          )}
                        </div>
                      </td>
                      <td className={cellClass("mark")} onClick={(e) => e.stopPropagation()}>
                        {/* Место под значок отведено ЗАРАНЕЕ и не зависит от
                            режима: без этого «Выкл» ужимал колонку, «Авто ·
                            Каждые 30 мин.» растягивал, и соседние столбцы
                            разъезжались при каждом переключении. */}
                        <div className="w-[13rem] max-w-full mx-auto flex justify-center">
                          <RuleModeChip
                            value={{ mode: ruleModeOf(rule), schedule: rule.schedule }}
                            onChange={(next) => void setModeValue(rule.id, next)}
                            run={ruleRuns[rule.id]}
                            onRunNow={() => runRuleNow(rule.id)}
                          />
                        </div>
                      </td>
                      <td className={cellClass("count")}>
                        {count > 0 ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openMatches(rule);
                            }}
                            className="text-muted hover:text-accent hover:underline px-1 rounded"
                            title="Показать совпадения"
                          >
                            {formatNum(count)}
                          </button>
                        ) : (
                          <span className="text-muted px-1">—</span>
                        )}
                      </td>
                      <td className={cellClass("actions")}>
                        <div className="flex items-center justify-center gap-0.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditing(rule);
                            }}
                            className="btn-icon"
                            title="Изменить правило"
                            aria-label="Изменить правило"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void removeRule(rule);
                            }}
                            className="btn-icon-danger"
                            title="Удалить правило"
                            aria-label="Удалить правило"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
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

      {editing && (
        <RuleEditModal
          rule={editing === "create" ? undefined : editing}
          transactions={transactionsRaw}
          categories={allCategories}
          liveCategories={liveCategories}
          payees={allPayees}
          accounts={allAccounts}
          accountGroups={accountGroups}
          onClose={() => setEditing(null)}
          onSave={saveRule}
        />
      )}

      {exporting && <RulesExportModal rules={rules} onClose={() => setExporting(false)} />}

      {importing && (
        <RulesImportModal
          fileName={importing.fileName}
          parsed={importing.parsed}
          onClose={() => setImporting(null)}
        />
      )}

      {preview && (
        <RulePreviewModal
          plan={plan}
          ruleCount={selectedIds.size}
          notes={previewNotes}
          onApply={applyRows}
          onClose={() => setPreview(false)}
        />
      )}
    </div>
  );
}
