import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Check, Repeat, X } from "lucide-react";
import type { Transaction } from "../../types";
import type { ZenTransaction } from "../../lib/zenmoney";
import { loadZenCache } from "../../lib/zenmoneyCache";
import { evalAmount, round2 } from "../../lib/splitTransaction";
import { currencySymbol, displayPayee, formatDate, formatMoney } from "../../lib/format";
import {
  buildNewPlan,
  firstOccurrence,
  intervalLabel,
  occurrenceDates,
  addInterval,
  PLAN_HORIZON_MONTHS,
  type PlanInterval,
} from "../../lib/planCreate";
import { usePlanActionsStore } from "../../store/usePlanActionsStore";
import { DateField } from "../DateField";
import { ExprAmountInput } from "../ExprAmountInput";
import { InfoPopover } from "../InfoPopover";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "../Modal";
import { Segmented } from "../Segmented";

const pad2 = (n: number) => String(n).padStart(2, "0");
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

type EndMode = "never" | "until";

/**
 * «Сделать регулярной»: завести в Дзен-мани план по образцу операции —
 * тот же счёт, категория и получатель, своя сумма и периодичность.
 *
 * План уходит в облако обычной отправкой (как и всё остальное, по режиму
 * отправки) и сразу появляется в «Запланированных» ленты. Сумму, счёт и
 * категорию потом можно поправить там же — «Изменить → Вся цепочка».
 */
export function MakeRecurringModal({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const today = localToday();
  const [raw, setRaw] = useState<ZenTransaction | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void loadZenCache().then((c) => {
      if (alive) setRaw(c?.transactions.find((t) => String(t.id) === tx.id && !t.deleted) ?? null);
    });
    return () => {
      alive = false;
    };
  }, [tx.id]);

  const [interval, setIntervalKind] = useState<PlanInterval>("month");
  const [step, setStep] = useState("1");
  const stepN = Math.min(99, Math.max(1, Math.floor(Number(step)) || 1));
  // Первая дата идёт за периодичностью, пока её не поменяли руками.
  const [startOverride, setStartOverride] = useState<string | null>(null);
  const startDate = startOverride ?? firstOccurrence(tx.date, interval, stepN, today);
  const [endMode, setEndMode] = useState<EndMode>("never");
  const [endDate, setEndDate] = useState(() => addInterval(today, "year", 1));
  const [amount, setAmount] = useState(String(Math.abs(tx.amount)));
  const [comment, setComment] = useState(tx.comment ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const horizon = addInterval(today, "month", PLAN_HORIZON_MONTHS);
  const preview = useMemo(
    () => occurrenceDates(startDate, interval, stepN, endMode === "until" ? endDate : null, horizon),
    [startDate, interval, stepN, endMode, endDate, horizon]
  );

  const title = displayPayee(tx) || tx.comment || tx.categoryFull || "План";
  const transfer = tx.kind === "transfer";

  async function save() {
    setError(null);
    const value = evalAmount(amount);
    if (value === null || !(value > 0)) {
      setError("Укажите сумму больше нуля");
      return;
    }
    if (!raw) {
      setError("Операция ещё не в Дзен-мани — сначала отправьте её, потом сделайте регулярной");
      return;
    }
    if (preview.length === 0) {
      setError("Ни одной даты: конец раньше начала");
      return;
    }
    setSaving(true);
    const plan = buildNewPlan(
      {
        tx: raw,
        amount: round2(value),
        interval,
        step: stepN,
        startDate,
        endDate: endMode === "until" ? endDate : null,
        comment: comment.trim() || null,
      },
      { uuid: () => crypto.randomUUID(), today, stamp: Math.floor(Date.now() / 1000) }
    );
    await usePlanActionsStore.getState().put({
      kind: "create",
      markerId: plan.reminder.id,
      date: startDate,
      title,
      reminder: plan.reminder,
      markers: plan.markers,
    });
    setSaving(false);
    onClose();
  }

  const out = tx.kind === "expense" || transfer;

  return (
    <Modal onClose={onClose} width="2xl">
      <ModalHeader icon={Repeat} title="Сделать регулярной">
        <InfoPopover label="Что получится">
          <p>
            В Дзен-мани появится план с тем же счётом, категорией и получателем,
            что у этой операции. Даты плана строятся на год вперёд — как в
            самом приложении; дальше их достроит Дзен-мани.
          </p>
          <p>
            План сразу виден в «Запланированных» над лентой операций, а в
            облако уходит обычной отправкой. Сумму, счёт и категорию потом можно
            поправить там же: «Изменить → Вся цепочка».
          </p>
        </InfoPopover>
      </ModalHeader>

      <ModalBody gap={3}>
        <div className="card-sunken px-4 py-3 flex items-center gap-3">
          <CalendarClock className="w-5 h-5 text-muted shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="truncate">
              {transfer ? "Перевод" : tx.categoryFull || "Без категории"}
              {displayPayee(tx) && <span className="text-muted"> · {displayPayee(tx)}</span>}
            </div>
            <div className="text-xs text-muted truncate">
              {transfer && tx.incomeAccount ? `${tx.account} → ${tx.incomeAccount}` : tx.account}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className={out ? "tabular-nums text-expense" : "tabular-nums text-income"}>
              {out ? "−" : "+"}
              {formatMoney(Math.abs(tx.amount), tx.currency)}
            </div>
            <div className="text-xs text-muted tabular-nums">{formatDate(tx.date, "full")}</div>
          </div>
        </div>

        <div>
          <span className="label block mb-1">Повторять</span>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted shrink-0">Каждые</span>
            <input
              type="number"
              min={1}
              max={99}
              value={step}
              onChange={(e) => setStep(e.target.value)}
              aria-label="Через сколько периодов"
              className="input w-16 !py-1.5 text-sm tabular-nums text-center"
            />
            <div className="flex-1 min-w-0">
              <Segmented<PlanInterval>
                value={interval}
                onChange={setIntervalKind}
                label="Период"
                size="sm"
                block
                options={[
                  { value: "week", label: "Неделя" },
                  { value: "month", label: "Месяц" },
                  { value: "year", label: "Год" },
                ]}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="label block mb-1">Сумма, {currencySymbol(tx.currency)}</span>
            <ExprAmountInput
              value={amount}
              onChange={setAmount}
              inputMode="decimal"
              className="input w-full text-sm tabular-nums"
            />
          </label>
          <div>
            <span className="label block mb-1">Первая дата</span>
            <DateField
              value={startDate}
              onChange={(e) => e.target.value && setStartOverride(e.target.value)}
              typeable
              className="input text-sm w-full"
            />
          </div>
          <div>
            <span className="label block mb-1">Окончание</span>
            <Segmented<EndMode>
              value={endMode}
              onChange={setEndMode}
              label="Окончание"
              size="sm"
              block
              options={[
                { value: "never", label: "Без конца" },
                { value: "until", label: "До даты" },
              ]}
            />
          </div>
          <div>
            <span className="label block mb-1">Последняя дата</span>
            {endMode === "until" ? (
              // Ряд с переключателем высотой 34 — поле той же высоты.
              <DateField
                value={endDate}
                onChange={(e) => e.target.value && setEndDate(e.target.value)}
                typeable
                className="input !py-1.5 text-sm w-full"
              />
            ) : (
              <div className="input !py-1.5 w-full text-sm text-muted flex items-center">Не задана</div>
            )}
          </div>
          <label className="block sm:col-span-2">
            <span className="label block mb-1">Комментарий</span>
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Необязательно"
              className="input w-full text-sm"
            />
          </label>
        </div>

        <p className="text-xs text-muted">
          {intervalLabel(interval, stepN)}
          {preview.length > 0 ? (
            <>
              {" "}· ближайшие: {preview.slice(0, 3).map((d) => formatDate(d, "short")).join(", ")}
              {preview.length > 3 && ` и ещё ${preview.length - 3}`}
            </>
          ) : (
            " · ни одной даты"
          )}
        </p>
      </ModalBody>

      <ModalFooter justify="between" className="flex-wrap">
        {error ? (
          <div className="inline-flex items-start gap-2 max-w-md rounded-lg px-3 py-2 text-xs bg-expense/10 text-expense border border-expense/30">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span>{error}</span>
          </div>
        ) : raw === null ? (
          <span className="text-xs text-muted max-w-xs">
            Операция ещё не в Дзен-мани — план можно будет завести после отправки
          </span>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="btn-ghost text-sm">
            <X className="w-3.5 h-3.5" />
            Отмена
          </button>
          <button
            onClick={() => void save()}
            disabled={saving || !raw}
            className="btn-primary text-sm"
          >
            <Check className="w-3.5 h-3.5" />
            Запланировать
          </button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
