import { useEffect, useMemo, useState } from "react";
import {
  Wand2,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  CheckCircle2,
  AlertCircle,
  Eye,
} from "lucide-react";
import {
  useCategoryRulesStore,
  type CategoryRule,
  type RuleField,
  type RuleOp,
} from "../store/useCategoryRulesStore";
import { confirm } from "../store/useConfirmStore";
import { useDataStore } from "../store/useDataStore";
import { useDrillStore } from "../store/useDrillStore";
import { groupByCategory } from "../lib/aggregations";
import { formatNum } from "../lib/format";
import { safeCompileRegex, safeTest } from "../lib/safeRegex";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { Stat } from "../components/Stat";

const FIELDS: { value: RuleField; label: string }[] = [
  { value: "payee", label: "Получатель" },
  { value: "comment", label: "Комментарий" },
  { value: "category", label: "Текущая категория" },
];

const OPS: { value: RuleOp; label: string }[] = [
  { value: "contains", label: "содержит" },
  { value: "equals", label: "равно" },
  { value: "starts_with", label: "начинается с" },
  { value: "regex", label: "regex" },
];

export function RulesPage() {
  const transactions = useDataStore((s) => s.transactions);
  const reapplyRules = useDataStore((s) => s.reapplyRules);
  const showDrill = useDrillStore((s) => s.show);

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

  const [adding, setAdding] = useState(false);
  const [field, setField] = useState<RuleField>("payee");
  const [op, setOp] = useState<RuleOp>("contains");
  const [value, setValue] = useState("");
  const [caseInsensitive, setCaseInsensitive] = useState(true);
  const [category, setCategory] = useState("");

  const allCategories = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) {
      if (t.categoryFullOriginal) set.add(t.categoryFullOriginal);
      if (t.categoryFull) set.add(t.categoryFull);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
  }, [transactions]);

  const popularCategories = useMemo(
    () => groupByCategory(transactions, "full").slice(0, 30).map((c) => c.category),
    [transactions]
  );

  function submit() {
    if (!value.trim() || !category.trim()) return;
    add({
      enabled: true,
      field,
      op,
      value: value.trim(),
      caseInsensitive,
      category: category.trim(),
    });
    setValue("");
    setCategory("");
    setAdding(false);
    setTimeout(reapplyRules, 50);
  }

  function preview(rule: CategoryRule) {
    // Pre-compile the regex once (ReDoS-guarded). Unsafe/invalid →
    // null → no matches.
    const re =
      rule.op === "regex"
        ? safeCompileRegex(rule.value, rule.caseInsensitive ? "iu" : "u")
        : null;
    const matches = transactions.filter((t) => {
      let hay = "";
      switch (rule.field) {
        case "payee":
          hay = t.payeeOriginal || t.payee || "";
          break;
        case "comment":
          hay = t.comment || "";
          break;
        case "category":
          hay = t.categoryFullOriginal || t.categoryFull || "";
          break;
      }
      if (rule.op === "regex") {
        return re ? safeTest(re, hay) : false;
      }
      let needle = rule.value;
      let h = hay;
      if (rule.caseInsensitive) {
        h = h.toLowerCase();
        needle = needle.toLowerCase();
      }
      switch (rule.op) {
        case "contains":
          return h.includes(needle);
        case "equals":
          return h === needle;
        case "starts_with":
          return h.startsWith(needle);
      }
      return false;
    });
    showDrill(`Совпадений: ${matches.length}`, matches, `Правило → ${rule.category}`);
  }

  if (transactions.length === 0) return <EmptyState />;

  // Plain derived values (not useMemo) — they live after the early
  // `return <EmptyState />` above, so hooks here would violate
  // rules-of-hooks. Both are cheap O(n) passes.
  const enabledCount = rules.filter((r) => r.enabled).length;
  const totalAffected = transactions.filter(
    (t) => t.categoryFullOriginal && t.categoryFullOriginal !== t.categoryFull
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Wand2}
        title="Правила категоризации"
        hint="Перезаписывают категорию операций при загрузке. Полезно для «Без категории» или для пере-классификации устаревших категорий. Правила обратимы."
        hintWrap
        right={
          <button onClick={() => setAdding(!adding)} className="btn-primary text-sm">
            <Plus className="w-4 h-4" />
            Правило
          </button>
        }
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
        <Stat label="Изменено операций" tone="accent" value={formatNum(totalAffected)} />
        <div className="card card-pad">
          <div className="label mb-1">Порядок применения</div>
          <div className="text-sm text-muted mt-1">
            Сверху вниз. Применяется <strong>первое</strong> подошедшее правило.
          </div>
        </div>
      </div>

      {adding && (
        <div className="card card-pad bg-accent/5 border-accent/40">
          <div className="font-semibold mb-3">Новое правило</div>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
            <div className="md:col-span-2">
              <label className="label block mb-1">Поле</label>
              <select
                value={field}
                onChange={(e) => setField(e.target.value as RuleField)}
                className="input text-sm"
              >
                {FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="label block mb-1">Условие</label>
              <select
                value={op}
                onChange={(e) => setOp(e.target.value as RuleOp)}
                className="input text-sm"
              >
                {OPS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="label block mb-1">Значение</label>
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={op === "regex" ? "^яндекс" : "магнит"}
                className="input text-sm"
              />
            </div>
            <div className="md:col-span-4">
              <label className="label block mb-1">Категория</label>
              <input
                list="all-cats"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Еда дома / Алкоголь"
                className="input text-sm"
              />
              <datalist id="all-cats">
                {allCategories.map((c) => (
                  <option key={c} value={c} />
                ))}
                {popularCategories.map((c) => (
                  <option key={`p-${c}`} value={c} />
                ))}
              </datalist>
            </div>
            <div className="md:col-span-1">
              <button onClick={submit} className="btn-primary text-sm w-full !px-2">
                <CheckCircle2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted mt-3">
            <input
              type="checkbox"
              checked={caseInsensitive}
              onChange={(e) => setCaseInsensitive(e.target.checked)}
              className="accent-accent"
            />
            Без учёта регистра
          </label>
        </div>
      )}

      {rules.length === 0 ? (
        <div className="card card-pad text-center py-12">
          <AlertCircle className="w-10 h-10 text-muted mx-auto mb-3" />
          <div className="font-medium mb-1">Нет правил</div>
          <div className="text-sm text-muted mb-4">
            Создайте первое правило, чтобы автоматически менять категорию операций по
            условию
          </div>
          {!adding && (
            <button onClick={() => setAdding(true)} className="btn-primary text-sm">
              <Plus className="w-4 h-4" />
              Добавить правило
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule, idx) => {
            const fieldLabel = FIELDS.find((f) => f.value === rule.field)?.label;
            const opLabel = OPS.find((o) => o.value === rule.op)?.label;
            return (
              <div
                key={rule.id}
                className={`card card-pad flex items-center gap-3 flex-wrap ${
                  !rule.enabled ? "opacity-60" : ""
                }`}
              >
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => move(rule.id, -1).then(reapplyRules)}
                    disabled={idx === 0}
                    className="text-muted hover:text-accent disabled:opacity-30"
                    title="Выше"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => move(rule.id, 1).then(reapplyRules)}
                    disabled={idx === rules.length - 1}
                    className="text-muted hover:text-accent disabled:opacity-30"
                    title="Ниже"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
                <span className="text-xs text-muted tabular-nums w-6 text-center">
                  #{idx + 1}
                </span>
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(e) =>
                    update(rule.id, { enabled: e.target.checked }).then(reapplyRules)
                  }
                  className="accent-accent w-4 h-4"
                  title="Вкл/выкл"
                />
                <div className="flex-1 min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-xs text-muted">если</span>
                  <span className="text-sm font-medium">{fieldLabel}</span>
                  <span className="text-xs text-muted">{opLabel}</span>
                  <span className="pill text-xs font-mono">«{rule.value}»</span>
                  {rule.caseInsensitive && (
                    <span className="text-[10px] text-muted">aA</span>
                  )}
                  <span className="text-xs text-muted">→</span>
                  <span className="pill text-xs">{rule.category}</span>
                </div>
                <button
                  onClick={() => preview(rule)}
                  className="btn-ghost text-xs !p-1.5"
                  title="Предпросмотр совпадений"
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Удалить правило?",
                      message: "Правило будет удалено, категория переустановится по умолчанию.",
                      confirmLabel: "Удалить",
                      tone: "danger",
                    });
                    if (ok) await remove(rule.id).then(reapplyRules);
                  }}
                  className="btn-ghost !p-1.5 text-muted hover:text-expense"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
