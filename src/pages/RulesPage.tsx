import { useEffect, useMemo, useState } from "react";
import { accountKindLabel } from "../lib/accountType";
import { getLiveAccountsFromCache, getBrandTitlesFromCache } from "../store/useZenmoneyStore";
import {
  Wand2,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  HelpCircle,
  Pencil,
  ListChecks,
} from "lucide-react";
import clsx from "clsx";
import {
  useCategoryRulesStore,
  type StoredCategoryRule,
} from "../store/useCategoryRulesStore";
import {
  actionTarget,
  compileRuleV2,
  describeRule,
  ruleHasEffect,
  ruleMatchesV2,
  type RuleActionKind,
  type RuleTargetField,
} from "../lib/ruleEngine";
import { confirm } from "../store/useConfirmStore";
import { useDataStore } from "../store/useDataStore";
import { useDrillStore } from "../store/useDrillStore";
import { useEditsStore } from "../store/useEditsStore";
import { useDeletedStore } from "../store/useDeletedStore";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { makeCategoryChecker } from "../lib/zenmoneyPush";
import { loadZenCache } from "../lib/zenmoneyCache";
import type { ZenTag } from "../lib/zenmoney";
import { groupByCategory } from "../lib/aggregations";
import { formatNum } from "../lib/format";
import { pluralRu } from "../lib/plural";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { Stat } from "../components/Stat";
import { RuleEditModal, type RuleDraft } from "../components/RuleEditModal";
import { RulePreviewModal } from "../components/RulePreviewModal";
import { buildRulePlan, type RuleRow } from "../lib/rulePlan";

/** Подпись поля, которое занимает действие, — для колонки «Что меняет». */
const TARGET_LABELS: Record<RuleTargetField, string> = {
  category: "Категория",
  payee: "Получатель",
  comment: "Комментарий",
};

/**
 * «Правила категоризации» — справочник правил в том же виде, что «Счета» и
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
export function RulesPage() {
  const transactions = useDataStore((s) => s.transactions);
  const transactionsRaw = useDataStore((s) => s.transactionsRaw);
  const reapplyRules = useDataStore((s) => s.reapplyRules);
  const showDrill = useDrillStore((s) => s.show);
  const edits = useEditsStore((s) => s.edits);
  const setEditEach = useEditsStore((s) => s.setEditEach);
  const deletedSet = useDeletedStore((s) => s.deletedSet);
  const token = useZenmoneyStore((s) => s.token);
  const pushMode = useZenmoneyStore((s) => s.pushMode);

  const rules = useCategoryRulesStore((s) => s.rules);
  const add = useCategoryRulesStore((s) => s.add);
  const update = useCategoryRulesStore((s) => s.update);
  const remove = useCategoryRulesStore((s) => s.remove);
  const move = useCategoryRulesStore((s) => s.move);
  const hydrate = useCategoryRulesStore((s) => s.hydrate);
  const loaded = useCategoryRulesStore((s) => s.loaded);

  useEffect(() => {
    if (!loaded) hydrate();
  }, [loaded, hydrate]);

  /** null — окно закрыто, «create» — новое правило, иначе редактируем. */
  const [editing, setEditing] = useState<StoredCategoryRule | "create" | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [zenTags, setZenTags] = useState<ZenTag[] | null>(null);
  /** Окно «Что изменят правила» — разбор и запись за один заход. */
  const [preview, setPreview] = useState(false);

  /**
   * Правила, по которым считается план, — просто ВКЛЮЧЁННЫЕ.
   *
   * Рядом с «Включено» была ещё колонка «Выбор»: она отбирала правила для
   * предпросмотра, ничего не меняя в данных. Два очень похожих переключателя в
   * соседних колонках читались как одно и то же, а разницу приходилось
   * объяснять в справке. Отбор «применить только это правило» вернём отдельным
   * действием в строке (issue #61) — оно и точнее, и не спорит с «Включено».
   */
  const selectedIds = useMemo(
    () => new Set(rules.filter((r) => r.enabled).map((r) => r.id)),
    [rules]
  );

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
    if (!token) {
      setZenTags(null);
      return;
    }
    let cancelled = false;
    void loadZenCache().then((cache) => {
      if (!cancelled) setZenTags(cache?.tags ?? []);
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

  /** План по ВЫБРАННЫМ правилам — то, что показывает окно и то, что запишется. */
  const plan = useMemo(
    () =>
      buildRulePlan(
        transactionsRaw,
        rules,
        selectedIds,
        edits,
        deletedSet,
        categoryOk,
        payeeOk
      ),
    [transactionsRaw, rules, selectedIds, edits, deletedSet, categoryOk, payeeOk]
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
    await setEditEach(patches);
    await reapplyRules();
  }

  if (transactions.length === 0) return <EmptyState />;

  // Дешёвые O(n) проходы — живут после раннего return, поэтому без useMemo.
  const enabledCount = rules.filter((r) => r.enabled).length;
  const totalAffected = transactions.filter(
    (t) => t.categoryFullOriginal && t.categoryFullOriginal !== t.categoryFull
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
    <div className="space-y-4">
      <PageHeader
        icon={Wand2}
        title="Правила категоризации"
        hint="Меняют категорию, получателя и комментарий операций по условию"
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Stat
          label="Активных правил"
          value={
            <>
              {enabledCount}{" "}
              <span className="text-muted text-sm font-normal">из {rules.length}</span>
            </>
          }
        />
        <Stat
          label="Изменено операций"
          tone="accent"
          value={formatNum(totalAffected)}
          hint={
            totalAffected > 0 && waiting === 0 ? "Всё записано в операции" : undefined
          }
        />
        <Stat
          label="Ждут записи"
          tone={waiting > 0 ? "warn" : "default"}
          value={formatNum(waiting)}
          hint="Результат выбранных правил, ещё не ставший правкой операции"
        />
      </div>

      <div className="card card-pad">
        {/* Панель действий — как в справочниках: заголовок со счётчиком,
            пояснение под «?», действия справа. */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <div className="font-semibold flex items-center gap-2 mr-1">
            <Wand2 className="w-4 h-4 shrink-0" />
            <span>
              Правила (<span className="tabular-nums">{rules.length}</span>)
            </span>
          </div>

          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setInfoOpen((v) => !v)}
              aria-expanded={infoOpen}
              aria-label="Как это работает"
              title="Как это работает"
              className={clsx(
                "p-1.5 rounded-md",
                infoOpen
                  ? "text-accent bg-accent/10"
                  : "text-muted hover:text-accent hover:bg-panel2"
              )}
            >
              <HelpCircle className="w-5 h-5" />
            </button>
            {infoOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setInfoOpen(false)} />
                <div className="absolute left-0 z-30 mt-2 w-96 max-w-[calc(100vw-2rem)] border border-border rounded-xl bg-panel p-4 shadow-xl space-y-2 text-xs text-muted">
                  <p>
                    Правило отбирает операции по условиям (несколько условий
                    объединяются <strong className="text-text">И</strong> или{" "}
                    <strong className="text-text">ИЛИ</strong>) и меняет у них
                    категорию, получателя и комментарий.
                  </p>
                  <p>
                    <strong className="text-text">Порядок важен:</strong> сверху вниз.
                    Поле занимает первое высказавшееся о нём правило: если верхнее
                    правило поставило категорию, нижнее может ещё дописать
                    комментарий. Двигать — стрелками в колонке «№».
                  </p>
                  <p>
                    <strong className="text-text">
                      Само по себе правило ничего не меняет.
                    </strong>{" "}
                    Категория, получатель и комментарий попадают в операции только
                    через кнопку{" "}
                    <strong className="text-text">«Проверить и применить»</strong> и
                    только у тех операций, что отмечены в окне.
                  </p>
                  <p>
                    <strong className="text-text">Автоприменение</strong> — та же
                    запись, но без кнопки и только для операций, которых раньше не
                    было: пришли синхронизацией или импортом. Уже имеющиеся оно не
                    трогает никогда, для них есть кнопка.
                  </p>
                  <p>
                    Записанное становится обычной правкой операции: отменяется
                    построчно в списке изменений, а не выключением правила.
                  </p>
                  <p>
                    <strong className="text-text">«Проверить и применить»</strong>{" "}
                    открывает разбор: сначала строки, которые правила изменят, —
                    переключателем в окне можно посмотреть и остальные совпадения.
                    Записывается только отмеченное. Считается по всем включённым
                    правилам; у каждого изменения подписано, чьё оно.
                  </p>
                  <p>
                    Правила создаются и со страницы{" "}
                    <strong className="text-text">«Без категории»</strong> — это самый
                    быстрый способ заполнить пробелы.
                  </p>
                </div>
              </>
            )}
          </div>

          <span className="flex-1 min-w-2" />

          {/* Одна кнопка на оба сценария: окно и раньше было одно, а две кнопки
              отличались лишь тем, отмечены ли строки заранее. Разницу
              приходилось объяснять абзацем в справке — значит её и не было. */}
          <button
            type="button"
            onClick={() => setPreview(true)}
            disabled={selectedIds.size === 0}
            className="btn-ghost text-sm shrink-0"
            title="Показать, что сделают выбранные правила, и записать отмеченное"
          >
            <ListChecks className="w-4 h-4" aria-hidden />
            Проверить и применить ({formatNum(plan.pending.length)})
          </button>
          <button
            type="button"
            onClick={() => setEditing("create")}
            className="btn-primary text-sm shrink-0"
          >
            <Plus className="w-4 h-4" />
            Добавить
          </button>
        </div>

        {selectedIds.size === 0 && rules.length > 0 && (
          <div className="mb-3 rounded-lg border border-border bg-panel2/50 px-3 py-2 text-xs text-muted">
            Все правила выключены — включите нужные, чтобы проверить и применить их.
          </div>
        )}

        {plan.skippedCount > 0 && (
          <div className="mb-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            {formatNum(plan.skippedCount)}{" "}
            {pluralRu(plan.skippedCount, ["операция", "операции", "операций"])}{" "}
            {pluralRu(plan.skippedCount, ["не уедет", "не уедут", "не уедут"])} в
            Дзен-мани — там нет категории{" "}
            {plan.skipped
              .slice(0, 2)
              .map((x) => `«${x.category}»`)
              .join(", ")}
            {plan.skipped.length > 2 ? ` и ещё ${plan.skipped.length - 2}` : ""}.
            Заведите её в справочнике категорий.
          </div>
        )}

        {rules.length === 0 ? (
          <div className="text-center py-12">
            <Wand2 className="w-10 h-10 text-muted mx-auto mb-3" />
            <div className="font-medium mb-1">Нет правил</div>
            <div className="text-sm text-muted">
              Создайте первое правило кнопкой <strong>«Добавить»</strong> — оно
              будет автоматически менять категорию, получателя и комментарий
              операций по условию
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full" style={{ fontSize: "var(--tbl-font)" }}>
              <thead>
                <tr>
                  {/* Сначала СУТЬ правила, потом переключатели: читают строку
                      слева направо, и «что это за правило» важнее, чем его
                      состояние. Ширина «Что меняет» фиксирована по трём
                      возможным ярлыкам — больше полей у правила не бывает. */}
                  {/* Ширина у всех колонок своя, а `w-full` у «Правила» —
                      приём для авторазметки таблицы: колонка забирает ВЕСЬ
                      остаток. Название правила бывает длинной фразой из его же
                      условий, и место нужно именно ему. */}
                  <th className="table-th w-20">№</th>
                  <th className="table-th w-full">Правило</th>
                  <th className="table-th w-72 min-w-[18rem]">Что меняет</th>
                  <th className="table-th w-24 text-center">Включено</th>
                  <th className="table-th w-32 text-center">Автоприменение</th>
                  <th className="table-th w-28 text-center">Совпадений</th>
                  <th className="table-th text-center w-24">Действия</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule, idx) => {
                  const count = matchCounts.get(rule.id) ?? 0;
                  const checked = selectedIds.has(rule.id);
                  const targets = Array.from(
                    new Set(
                      rule.actions
                        .filter((a) => (a.value ?? "").trim())
                        .map((a) => actionTarget(a.kind as RuleActionKind))
                    )
                  );
                  return (
                    <tr
                      key={rule.id}
                      onDoubleClick={() => setEditing(rule)}
                      className={clsx(
                        "align-middle cursor-pointer group hover:bg-panel2/50",
                        checked && "bg-accent/5",
                        !rule.enabled && "opacity-60"
                      )}
                    >
                      <td className="table-td">
                        <div className="flex items-center gap-1">
                          <span className="tabular-nums text-muted w-5">{idx + 1}</span>
                          <span className="flex flex-col">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void move(rule.id, -1).then(reapplyRules);
                              }}
                              disabled={idx === 0}
                              className="text-muted hover:text-accent disabled:opacity-30"
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
                              className="text-muted hover:text-accent disabled:opacity-30"
                              title="Ниже"
                              aria-label="Опустить правило"
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        </div>
                      </td>
                      {/* `max-w-0` в паре с `w-full` у заголовка — то, что
                          заставляет колонку ЗАНЯТЬ остаток и при этом обрезать
                          длинное название, а не растягивать таблицу за край
                          экрана. Правило без своего имени описывается фразой из
                          собственных условий, и она бывает очень длинной;
                          целиком её показывает подсказка. */}
                      <td className="table-td max-w-0">
                        <div
                          className="truncate font-medium group-hover:text-accent"
                          title={describeRule(rule)}
                        >
                          {describeRule(rule) || "Правило не дописано"}
                        </div>
                        {!ruleHasEffect(rule) && (
                          <div className="text-xs text-warn mt-0.5">
                            Ни одно действие не заполнено — правило ничего не делает
                          </div>
                        )}
                      </td>
                      <td className="table-td whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {targets.length === 0 ? (
                            <span className="text-muted">—</span>
                          ) : (
                            // Раньше получатель с комментарием выделялись
                            // предупреждающим цветом: они, в отличие от
                            // категории, менялись только после записи. Теперь
                            // так работают все три поля — выделять нечего.
                            targets.map((t) => (
                              <span
                                key={t}
                                className="pill"
                                title={`${TARGET_LABELS[t]} изменится после кнопки «Проверить и применить»`}
                              >
                                {TARGET_LABELS[t]}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="table-td text-center">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            void update(rule.id, { enabled: e.target.checked }).then(
                              reapplyRules
                            )
                          }
                          className="accent-accent w-4 h-4 align-middle"
                          title={rule.enabled ? "Выключить правило" : "Включить правило"}
                          aria-label="Правило включено"
                        />
                      </td>
                      <td className="table-td text-center">
                        {/* Автоприменение работает только у включённого правила —
                            у выключенного галочка ничего не значит и потому
                            недоступна. */}
                        <input
                          type="checkbox"
                          checked={!!rule.autoApply && rule.enabled}
                          disabled={!rule.enabled}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            void update(rule.id, { autoApply: e.target.checked })
                          }
                          className="accent-accent w-4 h-4 align-middle disabled:opacity-40"
                          title={
                            !rule.enabled
                              ? "Сначала включите правило"
                              : rule.autoApply
                                ? "Не применять к новым операциям автоматически"
                                : "Применять к новым операциям автоматически, без кнопки"
                          }
                          aria-label="Автоприменение к новым операциям"
                        />
                      </td>
                      <td className="table-td text-center tabular-nums">
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
                      <td className="table-td">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditing(rule);
                            }}
                            className="btn-ghost !p-1.5 text-muted hover:text-accent"
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
                            className="btn-ghost !p-1.5 text-muted hover:text-expense"
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
          payees={allPayees}
          accounts={allAccounts}
          accountGroups={accountGroups}
          onClose={() => setEditing(null)}
          onSave={saveRule}
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
