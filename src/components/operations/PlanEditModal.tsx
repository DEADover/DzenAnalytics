import { useMemo, useState } from "react";
import { AlertTriangle, Check, Pencil, X } from "lucide-react";
import { buildDraftTransaction, newDraftId } from "../../lib/zenmoneyPush";
import { loadZenCache } from "../../lib/zenmoneyCache";
import { evalAmount, round2 } from "../../lib/splitTransaction";
import { extractHashtags } from "../../lib/aggregations";
import { currencySymbol } from "../../lib/format";
import type { PlanPatch } from "../../lib/planActions";
import type { PlannedOp } from "../../lib/plannedOps";
import { useCategoryNodes } from "../../hooks/useCategoryNodes";
import { useLiveAccounts } from "../../hooks/useLiveAccounts";
import { useDataStore } from "../../store/useDataStore";
import { usePlanActionsStore } from "../../store/usePlanActionsStore";
import { useCounterpartyEditsStore } from "../../store/useCounterpartyEditsStore";
import { CategoryCascadePicker } from "../CategoryCascadePicker";
import { Combobox } from "../Combobox";
import { DateField } from "../DateField";
import { ExprAmountInput } from "../ExprAmountInput";
import { HashtagTextarea } from "../HashtagTextarea";
import { InfoPopover } from "../InfoPopover";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "../Modal";
import { Segmented } from "../Segmented";

type Scope = "date" | "chain";

/**
 * «Изменить» у запланированной операции: только эту дату или всю цепочку.
 *
 * Цепочка — это правило плана и все его даты с этой и дальше; прошедшие не
 * трогаем. День у цепочки не меняется: даты плана строит само приложение
 * Дзен-мани по правилу, и переставить их все значит пересоздать серию — на
 * этом и рождались дубли при переносе (issue #99). Перенести одну дату можно.
 *
 * Названия счёта, категории и контрагента превращаются в id Дзен-мани тем же
 * сборщиком, что и новая операция (`buildDraftTransaction`), — у плана те же
 * ноги, что у операции, и своя копия этой логики разошлась бы с ней.
 */
export function PlanEditModal({
  plan,
  title,
  onClose,
}: {
  plan: PlannedOp;
  title: string;
  onClose: () => void;
}) {
  const transfer = plan.kind === "transfer";
  const debt = plan.category === "Долг";
  const nodes = useCategoryNodes(plan.kind);
  const allTransactions = useDataStore((s) => s.transactions);
  const liveAccounts = useLiveAccounts();
  const newMerchants = useCounterpartyEditsStore((s) => s.created);

  const [original] = useState(() => {
    const [category, ...rest] = plan.category.split(" / ");
    return {
      amount: String(plan.amount),
      toAmount: plan.toAmount != null ? String(plan.toAmount) : "",
      date: plan.date,
      category: transfer ? "" : category,
      subcategory: transfer ? "" : rest.join(" / "),
      account: plan.account,
      toAccount: plan.toAccount ?? "",
      payee: plan.payee,
      comment: plan.comment,
    };
  });
  const [form, setForm] = useState(original);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const [scope, setScope] = useState<Scope>("date");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accountOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const a of liveAccounts ?? []) if (!a.archive) seen.add(a.title);
    return [...seen].sort((a, b) => a.localeCompare(b, "ru"));
  }, [liveAccounts]);
  const payeeOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const t of allTransactions) {
      const name = t.brand || t.payee;
      if (name) seen.add(name);
    }
    return [...seen].sort((a, b) => a.localeCompare(b, "ru")).slice(0, 500);
  }, [allTransactions]);
  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const t of allTransactions) for (const h of extractHashtags(t.comment)) s.add(h);
    return [...s].sort((a, b) => a.localeCompare(b, "ru"));
  }, [allTransactions]);

  const changed = (Object.keys(form) as (keyof typeof form)[]).some((k) => form[k] !== original[k]);

  async function save() {
    setError(null);
    const amount = evalAmount(form.amount);
    if (amount === null || !(amount > 0)) {
      setError("Укажите сумму больше нуля");
      return;
    }
    const cache = await loadZenCache();
    if (!cache) {
      setError("Изменение планов работает только при подключённом Дзен-мани");
      return;
    }
    // Собираем операцию с полями формы — только чтобы перевести названия в
    // id. В облако она не уходит.
    const built = buildDraftTransaction(
      {
        id: newDraftId(),
        kind: plan.kind,
        date: form.date,
        amount: round2(amount),
        account: form.account,
        incomeAccount: transfer ? form.toAccount : undefined,
        incomeAmount: transfer ? evalAmount(form.toAmount) ?? undefined : undefined,
        category: transfer ? undefined : form.category || "Без категории",
        subcategory: transfer ? undefined : form.subcategory || null,
        payee: form.payee.trim() || undefined,
        comment: form.comment.trim() || undefined,
      },
      cache,
      Math.floor(Date.now() / 1000),
      newMerchants
    );
    if (!built.zen) {
      setError(built.skip ?? "Не удалось разобрать поля");
      return;
    }
    const z = built.zen;
    const patch: PlanPatch = {};
    if (form.amount !== original.amount || form.toAmount !== original.toAmount) {
      patch.amount = transfer || plan.kind === "expense" ? z.outcome : z.income;
      if (transfer) patch.incomeAmount = z.income;
    }
    if (form.account !== original.account) {
      patch.account = plan.kind === "income" ? z.incomeAccount : z.outcomeAccount;
    }
    if (transfer && form.toAccount !== original.toAccount) patch.toAccount = z.incomeAccount;
    if (form.category !== original.category || form.subcategory !== original.subcategory) {
      patch.tag = z.tag;
    }
    if (form.payee !== original.payee) {
      patch.payee = form.payee.trim() || null;
      patch.merchant = z.merchant;
    }
    if (form.comment !== original.comment) patch.comment = form.comment.trim() || null;
    if (scope === "date" && form.date !== original.date) patch.date = form.date;

    setSaving(true);
    await usePlanActionsStore.getState().put({
      kind: "edit",
      scope,
      markerId: plan.id,
      patch,
      date: plan.date,
      title,
    });
    setSaving(false);
    onClose();
  }

  return (
    <Modal onClose={onClose} width="2xl">
      <ModalHeader icon={Pencil} title="Изменить запланированную операцию">
        <InfoPopover label="Эта дата или вся цепочка">
          <p>
            <strong>Только эта дата</strong> — меняется одно повторение плана,
            остальные остаются как были. Дату можно перенести.
          </p>
          <p>
            <strong>Вся цепочка</strong> — меняется сам план и все его даты с
            этой и дальше; прошедшие не трогаются. День повторения здесь не
            меняется — периодичность и дату начала правьте в приложении
            Дзен-мани.
          </p>
        </InfoPopover>
      </ModalHeader>

      <ModalBody gap={3}>
        {plan.repeating && (
          <Segmented<Scope>
            value={scope}
            onChange={setScope}
            label="Что менять"
            size="sm"
            block
            options={[
              { value: "date", label: "Только эта дата" },
              { value: "chain", label: "Вся цепочка" },
            ]}
          />
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="label block mb-1">Сумма, {currencySymbol(plan.currency)}</span>
            <ExprAmountInput
              value={form.amount}
              onChange={(v) => set("amount", v)}
              inputMode="decimal"
              className="input w-full text-sm tabular-nums"
            />
          </label>
          <div>
            <span className="label block mb-1">Дата</span>
            {scope === "chain" ? (
              <div
                className="input w-full text-sm text-muted flex items-center"
                title="У цепочки день не меняется — только у одной даты"
              >
                Как в плане
              </div>
            ) : (
              <DateField
                value={form.date}
                onChange={(e) => e.target.value && set("date", e.target.value)}
                typeable
                className="input text-sm w-full"
              />
            )}
          </div>
          {transfer && plan.toCurrency && plan.toCurrency !== plan.currency && (
            <label className="block sm:col-span-2">
              <span className="label block mb-1">Зачисление, {currencySymbol(plan.toCurrency)}</span>
              <ExprAmountInput
                value={form.toAmount}
                onChange={(v) => set("toAmount", v)}
                inputMode="decimal"
                className="input w-full text-sm tabular-nums"
              />
            </label>
          )}
          {!transfer && !debt && (
            <div className="sm:col-span-2">
              <span className="label block mb-1">Категория</span>
              <CategoryCascadePicker
                category={form.category}
                subcategory={form.subcategory}
                categories={nodes}
                portal
                onChange={(c, s) => setForm((f) => ({ ...f, category: c, subcategory: s || "" }))}
              />
            </div>
          )}
          <div>
            <span className="label block mb-1">{transfer ? "Со счёта" : "Счёт"}</span>
            <Combobox
              value={form.account}
              options={accountOptions}
              onChange={(v) => set("account", v)}
              allowCustom={false}
              searchable
              portal
            />
          </div>
          {transfer ? (
            <div>
              <span className="label block mb-1">На счёт</span>
              <Combobox
                value={form.toAccount}
                options={accountOptions}
                onChange={(v) => set("toAccount", v)}
                allowCustom={false}
                searchable
                portal
              />
            </div>
          ) : (
            <div>
              <span className="label block mb-1">Контрагент</span>
              <Combobox
                value={form.payee}
                options={payeeOptions}
                onChange={(v) => set("payee", v)}
                placeholder="Кому платите"
                searchable
                portal
              />
            </div>
          )}
          <div className="sm:col-span-2">
            <span className="label block mb-1">Комментарий</span>
            <HashtagTextarea
              value={form.comment}
              onChange={(v) => set("comment", v)}
              tags={allTags}
              rows={2}
              placeholder="Необязательно"
              className="input w-full text-sm resize-none"
            />
          </div>
        </div>
      </ModalBody>

      <ModalFooter justify="between" className="flex-wrap">
        {error ? (
          <div className="inline-flex items-start gap-2 max-w-md rounded-lg px-3 py-2 text-xs bg-expense/10 text-expense border border-expense/30">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span>{error}</span>
          </div>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="btn-ghost text-sm">
            <X className="w-3.5 h-3.5" />
            Отмена
          </button>
          <button onClick={() => void save()} disabled={!changed || saving} className="btn-primary text-sm">
            <Check className="w-3.5 h-3.5" />
            {scope === "chain" ? "Сохранить для цепочки" : "Сохранить"}
          </button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
