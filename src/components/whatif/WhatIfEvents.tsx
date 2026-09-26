import { useState } from "react";
import { CalendarClock, Pencil, Plus, Trash2 } from "lucide-react";
import type { ScenarioEvent } from "../../lib/whatif";
import { formatMoney } from "../../lib/format";
import { eventWhen } from "../../lib/whatifView";
import { shiftPeriod } from "../../lib/period";
import { parseAmountInput } from "../../lib/splitTransaction";
import { newWhatIfId } from "../../store/useWhatIfStore";
import { SectionCard } from "../SectionCard";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "../Modal";
import { Segmented } from "../Segmented";
import { MonthPicker } from "../MonthPicker";
import { ExprAmountInput } from "../ExprAmountInput";
import { Tooltip } from "../Tooltip";

/** Событие целиком в прошлом: разовое раньше этого месяца или кончившееся. */
function isPast(e: ScenarioEvent, nowYm: string): boolean {
  if (e.kind === "once") return e.start < nowYm;
  return e.months != null && shiftPeriod(e.start, e.months) <= nowYm;
}

/**
 * События сценария: крупная покупка, кредит, премия, новая аренда.
 *
 * Бегунки меняют «обычный» месяц, а жизнь чаще меняется событием с датой —
 * им и посвящён этот блок: без него «что если купить машину через год»
 * приходилось прикидывать в уме.
 */
export function WhatIfEvents({
  events,
  base,
  startYm,
  onChange,
}: {
  events: ScenarioEvent[];
  base: string;
  /** Текущий месяц — раньше него событие поставить нельзя. */
  startYm: string;
  onChange: (next: ScenarioEvent[]) => void;
}) {
  const [editing, setEditing] = useState<ScenarioEvent | "new" | null>(null);
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));

  return (
    <SectionCard
      icon={CalendarClock}
      title="События"
      info="Крупные траты и поступления с датой: покупка машины, ипотека, премия, доход от сдачи квартиры. Бывают разовыми или ежемесячными. Суммы указывайте в сегодняшних ценах."
      right={
        <button type="button" className="btn-ghost text-xs" onClick={() => setEditing("new")}>
          <Plus className="w-3.5 h-3.5" />
          Добавить
        </button>
      }
    >
      {sorted.length === 0 ? (
        <div className="text-sm text-muted">
          Добавьте покупку, кредит, премию или новый доход с датой — график покажет, как
          изменится капитал.
        </div>
      ) : (
        <ul className="divide-y divide-border -my-1">
          {sorted.map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate">
                  {e.title || (e.sign === "income" ? "Поступление" : "Трата")}
                </div>
                <div className="text-xs text-muted truncate">
                  {eventWhen(e)}
                  {isPast(e, startYm) && <span className="text-warn"> · Прошло, не учитывается</span>}
                </div>
              </div>
              <div
                className={`text-sm tabular-nums shrink-0 ${e.sign === "income" ? "text-income" : "text-expense"}`}
              >
                {e.sign === "income" ? "+" : "−"}
                {formatMoney(e.amount, base)}
                {e.kind === "monthly" && <span className="text-muted"> / мес</span>}
              </div>
              <div className="flex shrink-0">
                <Tooltip content="Изменить">
                  <button
                    type="button"
                    className="btn-ghost !p-1.5"
                    aria-label="Изменить событие"
                    onClick={() => setEditing(e)}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
                <Tooltip content="Удалить">
                  <button
                    type="button"
                    className="btn-ghost !p-1.5 hover:text-expense"
                    aria-label="Удалить событие"
                    onClick={() => onChange(events.filter((x) => x.id !== e.id))}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <EventModal
          initial={editing === "new" ? null : editing}
          startYm={startYm}
          onClose={() => setEditing(null)}
          onSave={(ev) => {
            onChange(
              editing === "new" ? [...events, ev] : events.map((x) => (x.id === ev.id ? ev : x))
            );
            setEditing(null);
          }}
        />
      )}
    </SectionCard>
  );
}

type Duration = "forever" | "limited";

function EventModal({
  initial,
  startYm,
  onClose,
  onSave,
}: {
  initial: ScenarioEvent | null;
  startYm: string;
  onClose: () => void;
  onSave: (e: ScenarioEvent) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [sign, setSign] = useState<ScenarioEvent["sign"]>(initial?.sign ?? "expense");
  const [kind, setKind] = useState<ScenarioEvent["kind"]>(initial?.kind ?? "once");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [start, setStart] = useState(initial?.start ?? shiftPeriod(startYm, 1));
  const [duration, setDuration] = useState<Duration>(
    initial?.kind === "monthly" && initial.months == null ? "forever" : "limited"
  );
  const [years, setYears] = useState(initial?.months ? String(Math.floor(initial.months / 12)) : "1");
  const [months, setMonths] = useState(initial?.months ? String(initial.months % 12) : "0");

  const value = parseAmountInput(amount);
  const totalMonths = (Number(years) || 0) * 12 + (Number(months) || 0);
  const valid =
    Number.isFinite(value) && value > 0 && (kind === "once" || duration === "forever" || totalMonths > 0);

  function save() {
    if (!valid) return;
    onSave({
      id: initial?.id ?? newWhatIfId(),
      title: title.trim(),
      sign,
      kind,
      amount: Math.round(value * 100) / 100,
      start,
      months: kind === "monthly" && duration === "limited" ? totalMonths : null,
    });
  }

  return (
    <Modal onClose={onClose} width="md">
      <ModalHeader icon={CalendarClock} title={initial ? "Событие" : "Новое событие"} />
      <ModalBody>
        <form
          id="whatif-event"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div>
            <label className="label block mb-1" htmlFor="whatif-event-title">
              Название
            </label>
            <input
              id="whatif-event-title"
              className="input text-sm w-full"
              placeholder={sign === "income" ? "Например, премия" : "Например, машина"}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Segmented
              size="sm"
              label="Трата или поступление"
              value={sign}
              onChange={setSign}
              options={[
                { value: "expense", label: "Трата", tone: "expense" },
                { value: "income", label: "Поступление", tone: "income" },
              ]}
            />
            <Segmented
              size="sm"
              label="Как часто"
              value={kind}
              onChange={setKind}
              options={[
                { value: "once", label: "Разово" },
                { value: "monthly", label: "Каждый месяц" },
              ]}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label block mb-1" htmlFor="whatif-event-amount">
                {kind === "monthly" ? "Сумма в месяц" : "Сумма"}
              </label>
              <ExprAmountInput
                id="whatif-event-amount"
                className="input text-sm w-full tabular-nums"
                placeholder="0"
                value={amount}
                onChange={setAmount}
              />
            </div>
            <div>
              <div className="label mb-1">{kind === "monthly" ? "С какого месяца" : "Когда"}</div>
              <MonthPicker
                value={start}
                minYM={startYm}
                maxYM={shiftPeriod(startYm, 50 * 12)}
                active
                onSelect={setStart}
                onStep={(d) => setStart((s) => (d < 0 && s <= startYm ? s : shiftPeriod(s, d)))}
              />
            </div>
          </div>
          {kind === "monthly" && (
            <div className="space-y-2">
              <Segmented
                size="sm"
                label="Сколько длится"
                value={duration}
                onChange={setDuration}
                options={[
                  { value: "limited", label: "Срок" },
                  { value: "forever", label: "Без срока" },
                ]}
              />
              {duration === "limited" ? (
                <div className="flex items-center gap-2 text-sm">
                  <input
                    type="number"
                    min={0}
                    max={50}
                    aria-label="Лет"
                    className="input text-sm w-20 tabular-nums"
                    value={years}
                    onChange={(e) => setYears(e.target.value)}
                  />
                  <span className="text-muted">лет</span>
                  <input
                    type="number"
                    min={0}
                    max={11}
                    aria-label="Месяцев"
                    className="input text-sm w-20 tabular-nums"
                    value={months}
                    onChange={(e) => setMonths(e.target.value)}
                  />
                  <span className="text-muted">мес</span>
                </div>
              ) : (
                <div className="text-xs text-muted">
                  Трата без срока увеличит и цель FIRE: её придётся оплачивать с капитала.
                </div>
              )}
            </div>
          )}
        </form>
      </ModalBody>
      <ModalFooter>
        <button type="button" className="btn-ghost" onClick={onClose}>
          Отмена
        </button>
        <button type="submit" form="whatif-event" className="btn-primary" disabled={!valid}>
          {initial ? "Сохранить" : "Добавить"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
