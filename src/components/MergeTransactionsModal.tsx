import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Info, Merge, X } from "lucide-react";
import type { Transaction } from "../types";
import { CategoryCascadePicker } from "./CategoryCascadePicker";
import { Combobox } from "./Combobox";
import { DateField } from "./DateField";
import { HashtagTextarea } from "./HashtagTextarea";
import { InfoPopover, InfoTerm } from "./InfoPopover";
import { extractHashtags } from "../lib/aggregations";
import { formatDate, formatMoney } from "../lib/format";
import { pluralRu } from "../lib/plural";
import { mergeDefaults, mergeProblem, mergedTotal } from "../lib/mergeTransactions";
import { useCategoryNodes } from "../hooks/useCategoryNodes";
import type { MergeChoice } from "../hooks/useMergeTransactions";
import { useDataStore } from "../store/useDataStore";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "./Modal";

const KIND_LABEL: Record<string, string> = {
  expense: "Расход",
  income: "Доход",
  refund: "Возврат",
  transfer: "Перевод",
};

/**
 * Окно «Объединить операции» — обратное разделению.
 *
 * Сверху — какой будет итоговая операция: счёт, вид и сумма (их не правят —
 * они следуют из выбранного), ниже поля, которые можно поменять: дата,
 * категория, контрагент, комментарий. Ещё ниже — что именно объединяется,
 * чтобы перед необратимым на вид действием было видно всё выбранное.
 */
export function MergeTransactionsModal({
  txs,
  onClose,
  onMerge,
}: {
  txs: Transaction[];
  onClose: () => void;
  /** Объединить. Возвращает текст ошибки или `null` при успехе. */
  onMerge: (choice: MergeChoice) => Promise<string | null>;
}) {
  const problem = useMemo(() => mergeProblem(txs), [txs]);
  const total = useMemo(() => mergedTotal(txs), [txs]);
  const defaults = useMemo(() => mergeDefaults(txs), [txs]);
  const isTransfer = total.kind === "transfer";
  const nodes = useCategoryNodes(total.kind);
  const allTransactions = useDataStore((s) => s.transactions);

  const payeeOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const t of allTransactions) {
      const name = t.brand || t.payee;
      if (name) seen.add(name);
    }
    return [...seen].sort((a, b) => a.localeCompare(b, "ru")).slice(0, 500);
  }, [allTransactions]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTransactions) {
      for (const h of extractHashtags(t.comment)) set.add(h);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [allTransactions]);

  const [date, setDate] = useState(defaults.date);
  const [category, setCategory] = useState(defaults.category);
  const [subcategory, setSubcategory] = useState<string | null>(defaults.subcategory);
  const [payee, setPayee] = useState(defaults.payee);
  const [comment, setComment] = useState(defaults.comment);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const first = txs[0];
  const currency = isTransfer ? first?.outcomeCurrency : first?.currency;
  const account = isTransfer
    ? `${first?.outcomeAccount} → ${first?.incomeAccount}`
    : first?.account;
  const blocker = problem ?? (!isTransfer && !category ? "Выберите категорию" : null);

  // Новые сверху, как в ленте: так список читается тем же порядком.
  const list = useMemo(
    () => [...txs].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [txs]
  );

  async function apply() {
    if (blocker) return;
    setSaving(true);
    setError(null);
    const failed = await onMerge({
      date,
      category,
      subcategory,
      payee,
      comment,
      extraCategories: defaults.extraCategories,
    });
    setSaving(false);
    if (failed) setError(failed);
    else onClose();
  }

  return (
    <Modal onClose={onClose} width="3xl">
      <ModalHeader icon={Merge} title="Объединить операции">
        <InfoPopover label="Как работает объединение">
          <p>
            Несколько мелких операций превращаются в одну — например, округления
            в копилку за неделю или десяток поездок на такси за месяц.
          </p>
          <p>
            Суммы складываются <InfoTerm>со знаками</InfoTerm>: покупка на 1 000
            и возврат на 200 дают расход на 800. Объединить можно операции
            одного счёта, а переводы — только между одной и той же парой
            счетов.
          </p>
          <p>
            Итоговая операция создаётся новой, а объединённые уходят в{" "}
            <InfoTerm>«Удалённые»</InfoTerm> — оттуда их можно вернуть. Они
            хранят свои суммы и номера операций в банке, поэтому Дзен-мани не
            заведёт покупки заново из выписки.
          </p>
        </InfoPopover>
      </ModalHeader>

      <div className="px-5 pt-4">
        <div className="card-sunken px-4 py-3 flex items-start gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <span className="label block mb-1">Счёт</span>
            <div className="h-9 leading-9 text-sm truncate">{account}</div>
          </div>
          <div className="shrink-0">
            <span className="label block mb-1">Вид</span>
            <div className="h-9 leading-9 text-sm">{KIND_LABEL[total.kind]}</div>
          </div>
          <div className="shrink-0 text-right pl-5 border-l border-border">
            <span className="label block mb-1">
              {txs.length} {pluralRu(txs.length, ["операция", "операции", "операций"])}
            </span>
            <div
              className={
                "text-2xl font-bold tabular-nums whitespace-nowrap h-9 leading-9 " +
                (total.kind === "expense" ? "text-expense" : total.kind === "transfer" ? "" : "text-income")
              }
            >
              {formatMoney(total.amount, currency ?? "RUB")}
            </div>
          </div>
        </div>
      </div>

      <div className="px-5 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <span className="label block mb-1">Дата</span>
          <DateField
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            typeable
            className="input text-sm w-full"
          />
        </div>
        {!isTransfer && (
          <div>
            <span className="label block mb-1">Категория</span>
            <CategoryCascadePicker
              category={category}
              subcategory={subcategory ?? ""}
              categories={nodes}
              portal
              onChange={(c, s) => {
                setCategory(c);
                setSubcategory(s || null);
              }}
            />
          </div>
        )}
        <div className={isTransfer ? "" : "sm:col-span-2"}>
          <span className="label block mb-1">Контрагент</span>
          <Combobox
            value={payee}
            options={payeeOptions}
            onChange={setPayee}
            placeholder="Кому платили"
            searchable
            portal
          />
        </div>
        <div className="sm:col-span-2">
          <span className="label block mb-1">Комментарий</span>
          <HashtagTextarea
            value={comment}
            onChange={setComment}
            tags={allTags}
            rows={2}
            placeholder="Необязательно"
            className="input w-full text-sm resize-none"
          />
        </div>
      </div>

      <ModalBody scroll gap={0} className="max-h-[40vh]">
        <span className="label block mb-1.5">Что объединяется</span>
        <ul className="rounded-xl border border-border divide-y divide-border text-sm">
          {list.map((t) => {
            const out = t.kind === "expense";
            return (
              <li key={t.id} className="flex items-center gap-3 px-3 py-1.5">
                <span className="w-20 shrink-0 text-muted tabular-nums">{formatDate(t.date, "full")}</span>
                <span className="flex-1 min-w-0 truncate">
                  {t.kind === "transfer" ? "Перевод" : t.categoryFull || "Без категории"}
                  {(t.brand || t.payee) && (
                    <span className="text-muted"> · {t.brand || t.payee}</span>
                  )}
                  {t.comment && <span className="text-muted"> · {t.comment}</span>}
                </span>
                <span
                  className={
                    "shrink-0 tabular-nums " +
                    (t.kind === "transfer" ? "" : out ? "text-expense" : "text-income")
                  }
                >
                  {t.kind === "transfer" ? "" : out ? "−" : "+"}
                  {formatMoney(Math.abs(t.kind === "transfer" ? t.outcomeAmount : t.amount), t.currency)}
                </span>
              </li>
            );
          })}
        </ul>
      </ModalBody>

      <ModalFooter justify="between" className="flex-wrap">
        {error ? (
          <div className="inline-flex items-start gap-2 max-w-md rounded-lg px-3 py-2 text-xs bg-expense/10 text-expense border border-expense/30">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span>{error}</span>
          </div>
        ) : blocker ? (
          <div className="inline-flex items-start gap-2 max-w-md rounded-lg px-3 py-2 text-xs bg-warn/10 text-warn border border-warn/30">
            <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span>{blocker}</span>
          </div>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted">
            <ArrowRight className="w-3.5 h-3.5 shrink-0" />
            Объединённые уйдут в «Удалённые»
          </span>
        )}
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="btn-ghost text-sm">
            <X className="w-3.5 h-3.5" />
            Отмена
          </button>
          <button onClick={apply} disabled={!!blocker || saving} className="btn-primary text-sm">
            <Merge className="w-3.5 h-3.5" />
            {saving ? "Объединяю…" : `Объединить ${txs.length}`}
          </button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
