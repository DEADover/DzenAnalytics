import { useEffect, useMemo, useState } from "react";
import { Checkbox } from "../components/Checkbox";
import { Tag, AlertCircle, Sparkles, Wand2, CheckCircle2 } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useDrillStore } from "../store/useDrillStore";
import { useCategoryRulesStore } from "../store/useCategoryRulesStore";
import { confirm } from "../store/useConfirmStore";
import {
  detectUncategorized,
  suggestCategoriesForUncategorized,
  type CategorySuggestion,
} from "../lib/aggregations";
import { formatMoney, formatDate, formatNum, formatPct } from "../lib/format";
import { pluralRu } from "../lib/plural";
import { kindGlyphClass, kindSignGlyph, kindTone } from "../lib/txKindStyle";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { CardHeader } from "../components/CardHeader";
import { StatCell, StatRow } from "../components/SectionCard";
import { Tooltip } from "../components/Tooltip";
import { DataTable } from "../components/DataTable";
import type { Transaction } from "../types";
import type { RuleField } from "../store/useCategoryRulesStore";
import { SectionEmpty } from "../components/SectionEmpty";

/** Build the rule key for a suggestion: by получатель when present, otherwise
 *  by the comment. Some operations (dividend payouts, bank fees) have no payee
 *  but a distinctive comment — without this they couldn't be applied at all.
 *  Returns null when there's nothing to match on. */
function ruleKeyFor(
  s: CategorySuggestion
): { field: RuleField; value: string } | null {
  const payee = (s.payee || "").trim();
  if (payee) return { field: "payee", value: payee };
  const comment = (s.comment || "").trim();
  if (comment) return { field: "comment", value: comment };
  return null;
}

export function UncategorizedPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const showDrill = useDrillStore((s) => s.show);

  const list = useMemo(() => detectUncategorized(transactions), [transactions]);
  const total = list.reduce((s, t) => s + t.amountBase, 0);
  const allTotal = transactions
    .filter((t) => t.kind !== "transfer")
    .reduce((s, t) => s + t.amountBase, 0);
  const share = allTotal > 0 ? total / allTotal : 0;

  const addRule = useCategoryRulesStore((s) => s.add);
  const addManyRules = useCategoryRulesStore((s) => s.addMany);
  const rulesLoaded = useCategoryRulesStore((s) => s.loaded);
  const rulesHydrate = useCategoryRulesStore((s) => s.hydrate);
  const reapplyRules = useDataStore((s) => s.reapplyRules);
  useEffect(() => {
    if (!rulesLoaded) rulesHydrate();
  }, [rulesLoaded, rulesHydrate]);

  const [showSuggestions, setShowSuggestions] = useState(true);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const suggestions = useMemo<CategorySuggestion[]>(
    () => (showSuggestions ? suggestCategoriesForUncategorized(transactions, list, 7) : []),
    [transactions, list, showSuggestions]
  );

  // Suggestions that can actually be applied (have something to key a rule on
  // — payee or comment — and aren't already applied). Selection / «выбрать
  // все» operate on these.
  const selectable = useMemo(
    () => suggestions.filter((s) => ruleKeyFor(s) && !appliedIds.has(s.txId)),
    [suggestions, appliedIds]
  );
  const selectedCount = selectable.filter((s) => selected.has(s.txId)).length;
  const allSelected = selectable.length > 0 && selectedCount === selectable.length;

  function toggleSelect(txId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(txId)) next.delete(txId);
      else next.add(txId);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(selectable.map((s) => s.txId)));
  }
  function selectConfident() {
    setSelected(new Set(selectable.filter((s) => s.confidence >= 0.7).map((s) => s.txId)));
  }

  async function applyOne(s: CategorySuggestion) {
    const key = ruleKeyFor(s);
    if (!key) return;
    setBusy(true);
    await addRule({
      enabled: true,
      field: key.field,
      op: "contains",
      value: key.value,
      caseInsensitive: true,
      category: s.suggested,
    });
    setAppliedIds((prev) => new Set(prev).add(s.txId));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(s.txId);
      return next;
    });
    await reapplyRules();
    setBusy(false);
  }

  async function applySelected() {
    const toApply = selectable.filter((s) => selected.has(s.txId));
    if (toApply.length === 0) return;
    const ok = await confirm({
      title: "Применить выбранные подсказки?",
      message: `Будет создано ${toApply.length} ${pluralRu(toApply.length, ["правило", "правила", "правил"])} (по получателю или комментарию) — выбранные операции категоризируются.`,
      confirmLabel: "Применить",
    });
    if (!ok) return;
    setBusy(true);
    await addManyRules(
      toApply.flatMap((s) => {
        const key = ruleKeyFor(s);
        return key
          ? [{
              enabled: true,
              field: key.field,
              op: "contains" as const,
              value: key.value,
              caseInsensitive: true,
              category: s.suggested,
            }]
          : [];
      })
    );
    setAppliedIds((prev) => {
      const next = new Set(prev);
      for (const s of toApply) next.add(s.txId);
      return next;
    });
    setSelected(new Set());
    await reapplyRules();
    setBusy(false);
  }

  if (transactions.length === 0) return <EmptyState />;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Tag}
        title="Без категории"
        hint="Примите предложенные категории или выберите свои"
      />

      <StatRow>
        <StatCell
          label="Найдено"
          value={formatNum(list.length)}
          note={`из ${formatNum(transactions.length)} всего`}
        />
        <StatCell label="Сумма" value={formatMoney(total, base)} tone="warn" />
        <StatCell label="Доля от всех потоков" value={formatPct(share, 1)} />
      </StatRow>

      {/* Smart suggestions */}
      {list.length > 0 && suggestions.length > 0 && (
        <div className="card card-pad bg-accent2/5 border-accent2/40">
          <CardHeader
            icon={Sparkles}
            tone="accent2"
            title={<>Подсказки категорий ({suggestions.length})</>}
            infoLabel="Как подбираются подсказки"
            info={
              <p>
                Подобраны по похожести получателя, комментария и категории. Применение
                создаёт правило (по получателю, а если его нет — по комментарию) —
                его можно отменить на странице «Правила».
              </p>
            }
            right={
              <>
                <Tooltip content="Создаст правила (по получателю или комментарию) для выбранных подсказок и применит их">
                  <button
                    onClick={applySelected}
                    disabled={busy || selectedCount === 0}
                    className="btn-primary text-xs"
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    Применить подсказки ({selectedCount})
                  </button>
                </Tooltip>
                <Tooltip content="Скрыть подсказки">
                  <button
                    onClick={() => setShowSuggestions(false)}
                    className="btn-ghost text-xs text-muted"
                  >
                    ×
                  </button>
                </Tooltip>
              </>
            }
          />
          {/* Select-all + quick presets. */}
          {selectable.length > 0 && (
            <div className="flex items-center gap-3 px-2 py-1.5 mb-1 text-xs border-b border-border/50">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  indeterminate={selectedCount > 0 && !allSelected}
                  label="Выбрать все предложения"
                />
                <span className="text-muted">Выбрать все ({selectable.length})</span>
              </label>
              <button onClick={selectConfident} className="text-accent hover:underline">
                только надёжные (≥70%)
              </button>
              <span className="ml-auto text-muted">Выбрано: {selectedCount}</span>
            </div>
          )}
          <div className="max-h-96 overflow-y-auto space-y-1">
            {suggestions.slice(0, 50).map((s) => {
              const applied = appliedIds.has(s.txId);
              return (
                <div
                  key={s.txId}
                  className={`flex items-center gap-3 p-2 rounded text-sm ${
                    applied ? "bg-income/10" : "bg-panel2/40 hover:bg-panel2/70"
                  }`}
                >
                  <Checkbox
                    checked={selected.has(s.txId)}
                    disabled={applied || !ruleKeyFor(s)}
                    onChange={() => toggleSelect(s.txId)}
                    title={
                      !ruleKeyFor(s)
                        ? "Нет получателя и комментария — правило не создать"
                        : applied
                          ? "Уже применено"
                          : "Выбрать для применения"
                    }
                    label="Выбрать для применения"
                    className="shrink-0"
                  />
                  <div className="text-xs text-muted whitespace-nowrap tabular-nums w-20">
                    {formatDate(s.date, "full")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{s.payee || "—"}</div>
                    {s.comment && (
                      <div className="text-xs text-muted truncate">{s.comment}</div>
                    )}
                  </div>
                  <div className="text-xs whitespace-nowrap text-expense font-medium tabular-nums">
                    {formatMoney(s.amount, s.currency)}
                  </div>
                  <div className="text-xs text-muted">→</div>
                  <div className="pill text-xs whitespace-nowrap" title={s.suggested}>
                    {s.suggested.length > 28 ? s.suggested.slice(0, 28) + "…" : s.suggested}
                  </div>
                  <div
                    className={`text-xs tabular-nums w-12 text-right ${
                      s.confidence >= 0.7
                        ? "text-income"
                        : s.confidence >= 0.4
                          ? "text-warn"
                          : "text-muted"
                    }`}
                    title={`Похожесть на: ${s.reasonExamples.join(", ") || "—"}`}
                  >
                    {formatPct(s.confidence, 0)}
                  </div>
                  <Tooltip
                    content={
                      applied
                        ? "Применено"
                        : ruleKeyFor(s)
                          ? `Применить как правило (по ${ruleKeyFor(s)!.field === "payee" ? "получателю" : "комментарию"})`
                          : "Нет получателя и комментария — правило не создать"
                    }
                  >
                    <button
                      onClick={() => applyOne(s)}
                      disabled={busy || applied || !ruleKeyFor(s)}
                      className={`btn-icon ${
                        applied ? "text-income hover:text-income" : ""
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </button>
                  </Tooltip>
                </div>
              );
            })}
          </div>
          {suggestions.length > 50 && (
            <div className="text-xs text-muted text-center mt-2">
              Показано 50 из {suggestions.length}
            </div>
          )}
        </div>
      )}

      {list.length === 0 ? (
        <SectionEmpty
          icon={AlertCircle}
          tone="income"
          title="Все операции категоризированы — отлично!"
        >
          Не найдено операций без категории
        </SectionEmpty>
      ) : (
        <DataTable<Transaction>
          icon={Tag}
          title={`Все без категории (${formatNum(list.length)})`}
          actions={
            <button
              type="button"
              onClick={() => showDrill("Незакатегоризованные", list, "Чистка категорий")}
              className="btn-ghost text-xs"
            >
              Открыть в шторке
            </button>
          }
          data={list}
          rowKey={(t) => t.id}
          defaultSortKey="date"
          limit={200}
          exportName="uncategorized"
          fixed
          columns={[
            {
              key: "date",
              type: "date",
              width: "8.5rem",
              label: "Дата",
              sortValue: (t) => t.date,
              render: (t) => formatDate(t.date, "full"),
            },
            {
              key: "category",
              type: "text",
              muted: true,
              width: "12rem",
              label: "Категория",
              sortValue: (t) => t.categoryFull,
              render: (t) => t.categoryFull || "—",
            },
            {
              key: "payee",
              type: "text",
              width: "14rem",
              label: "Получатель",
              sortValue: (t) => t.payee || "",
              render: (t) => t.payee || "—",
            },
            {
              key: "comment",
              type: "text",
              muted: true,
              label: "Комментарий",
              sortValue: (t) => t.comment,
              render: (t) => t.comment,
            },
            {
              key: "amount",
              type: "main",
              tone: (t) => kindTone(t.kind),
              width: "10rem",
              label: "Сумма",
              sortValue: (t) => t.amountBase,
              cellTitle: (t) =>
                t.kind === "refund" ? "Возврат — уменьшает расход категории" : undefined,
              render: (t) => (
                <>
                  <span className={kindGlyphClass(t.kind)}>{kindSignGlyph(t.kind)}</span>
                  {formatMoney(t.amount, t.currency)}
                </>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
