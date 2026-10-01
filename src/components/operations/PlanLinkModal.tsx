import { useMemo, useState } from "react";
import { CalendarClock, Check, Link2, X } from "lucide-react";
import clsx from "clsx";
import type { Transaction } from "../../types";
import { formatDate, formatMoney, displayPayee, payeeSearchText } from "../../lib/format";
import { queryMatcher } from "../../lib/keyboardLayout";
import { linkCandidates } from "../../lib/planActions";
import type { PlannedOp } from "../../lib/plannedOps";
import { usePlannedCache } from "../../hooks/useZenPlanned";
import { useDataStore } from "../../store/useDataStore";
import { usePlanActionsStore } from "../../store/usePlanActionsStore";
import { CategoryDot } from "../CategoryDot";
import { InfoPopover } from "../InfoPopover";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "../Modal";
import { SearchInput } from "../SearchInput";

const pad2 = (n: number) => String(n).padStart(2, "0");
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * «Связать план с фактом»: запланированная операция уже случилась — её привёз
 * банк или внесли руками, — и план надо закрыть ею, а не заводить второй факт.
 *
 * Сверху — сам план, ниже — похожие проведённые операции (что считается
 * похожим — `linkCandidates`). Поиск — по всем операциям того же окна дат,
 * если нужной среди похожих нет.
 */
export function PlanLinkModal({
  plan,
  title,
  onClose,
}: {
  plan: PlannedOp;
  title: string;
  onClose: () => void;
}) {
  const transactions = useDataStore((s) => s.transactions);
  const cache = usePlannedCache();
  const queued = usePlanActionsStore((s) => s.actions);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);

  const candidates = useMemo(() => {
    // Связанные с планом — по сырым записям Дзен-мани: в ленте ссылки нет.
    const linked = new Set<string>();
    for (const t of cache?.transactions ?? []) if (t.reminderMarker) linked.add(String(t.id));
    for (const a of Object.values(queued)) if (a.kind === "fact" || a.kind === "link") linked.add(a.txId);
    const input = transactions.map((t) => ({
      id: t.id,
      date: t.date,
      kind: t.kind,
      amount: Math.abs(t.amount),
      category: t.categoryFull,
      account: t.account,
      payee: displayPayee(t),
      linked: linked.has(t.id),
      tx: t,
    }));
    const planForMatch = {
      date: plan.date,
      kind: plan.kind,
      amount: plan.amount,
      category: plan.category,
      account: plan.account,
      payee: plan.payee,
    };
    const q = query.trim();
    // С поиском — все операции окна: человек сам знает, что ищет.
    const pool = linkCandidates(planForMatch, input, localToday(), q ? 1000 : 40, !!q);
    if (!q) return pool.map((c) => c.tx);
    const match = queryMatcher(q);
    return pool
      .map((c) => c.tx)
      .filter((t) => match(`${payeeSearchText(t)} ${t.comment} ${t.categoryFull} ${t.account}`))
      .slice(0, 40);
  }, [transactions, cache, queued, plan, query]);

  async function apply() {
    if (!picked) return;
    await usePlanActionsStore.getState().put({
      kind: "link",
      markerId: plan.id,
      txId: picked,
      date: plan.date,
      title,
    });
    onClose();
  }

  return (
    <Modal onClose={onClose} width="3xl">
      <ModalHeader icon={Link2} title="Связать план с фактом">
        <InfoPopover label="Что значит связать">
          <p>
            Запланированная операция уже случилась — её привёз банк или вы
            внесли её руками. Связь закрывает план этой операцией: план
            пропадает из запланированных, а в Дзен-мани операция помечается
            исполнением плана — как при связывании в самом приложении.
          </p>
          <p>
            Сумма и дата факта могут отличаться от плановых — это нормально.
          </p>
        </InfoPopover>
      </ModalHeader>

      <div className="px-5 pt-4 space-y-3">
        <div className="card-sunken px-4 py-3 flex items-center gap-3">
          <CalendarClock className="w-5 h-5 text-muted shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="truncate">
              {plan.category || (plan.kind === "transfer" ? "Перевод" : "Без категории")}
              {plan.payee && <span className="text-muted"> · {plan.payee}</span>}
            </div>
            <div className="text-xs text-muted truncate">
              {plan.toAccount ? `${plan.account} → ${plan.toAccount}` : plan.account}
              {plan.comment && ` · ${plan.comment}`}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-semibold tabular-nums">{formatMoney(plan.amount, plan.currency)}</div>
            <div className="text-xs text-muted tabular-nums">{formatDate(plan.date, "full")}</div>
          </div>
        </div>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Поиск по контрагенту, комментарию, категории и счёту"
          autoFocus
        />
      </div>

      <ModalBody scroll list className="max-h-[50vh]">
        {candidates.length === 0 ? (
          <p className="text-sm text-muted py-6 text-center">
            Похожих операций не нашлось. Найдите нужную поиском — он ищет
            по всем операциям за две недели до плана и до сегодня.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {candidates.map((t) => (
              <CandidateRow key={t.id} tx={t} picked={picked === t.id} onPick={() => setPicked(t.id)} />
            ))}
          </ul>
        )}
      </ModalBody>

      <ModalFooter>
        <button onClick={onClose} className="btn-ghost text-sm">
          <X className="w-3.5 h-3.5" />
          Отмена
        </button>
        <button onClick={() => void apply()} disabled={!picked} className="btn-primary text-sm">
          <Link2 className="w-3.5 h-3.5" />
          Связать
        </button>
      </ModalFooter>
    </Modal>
  );
}

function CandidateRow({ tx, picked, onPick }: { tx: Transaction; picked: boolean; onPick: () => void }) {
  const out = tx.kind === "expense" || tx.kind === "transfer";
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        aria-pressed={picked}
        className={clsx(
          "w-full text-left flex items-center gap-3 px-2 py-2 rounded-lg",
          picked ? "bg-accent/10" : "hover:bg-panel2"
        )}
      >
        <CategoryDot
          category={tx.subcategory || tx.category}
          parent={tx.subcategory ? tx.category : undefined}
          size="w-7 h-7"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">
            {tx.categoryFull || "Без категории"}
            {displayPayee(tx) && <span className="text-muted"> · {displayPayee(tx)}</span>}
          </span>
          <span className="block truncate text-xs text-muted">
            {tx.account}
            {tx.comment && ` · ${tx.comment}`}
          </span>
        </span>
        <span className="text-right shrink-0">
          <span className={clsx("block tabular-nums text-sm", out ? "text-expense" : "text-income")}>
            {out ? "−" : "+"}
            {formatMoney(Math.abs(tx.amount), tx.currency)}
          </span>
          <span className="block text-xs text-muted tabular-nums">{formatDate(tx.date, "full")}</span>
        </span>
        <Check className={clsx("w-4 h-4 shrink-0", picked ? "text-accent" : "invisible")} aria-hidden />
      </button>
    </li>
  );
}
