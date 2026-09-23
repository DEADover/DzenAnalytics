import { useState } from "react";
import { Target } from "lucide-react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "./Modal";
import { MultiSelect } from "./MultiSelect";
import { AccountLogo } from "./AccountLogo";
import { DateField } from "./DateField";
import { FILTER_NONE } from "../store/useFiltersStore";
import { goalSources, type GoalProgress } from "../lib/goals";
import { formatMoney } from "../lib/format";
import type { Goal } from "../store/useGoalsStore";

/** Поля цели, которые задаёт окно. */
export type GoalDraft = Omit<Goal, "id" | "createdAt">;

/**
 * Источники цели ↔ выбор в `MultiSelect`. У списка соглашение фильтров:
 * пусто = все, {FILTER_NONE} = ничего. У цели «ничего» — ручная сумма, а «все»
 * — это просто все счета поимённо.
 */
function sourcesToSet(sources: readonly string[], all: readonly string[]): Set<string> {
  const known = sources.filter((t) => all.includes(t));
  if (known.length === 0) return new Set([FILTER_NONE]);
  if (known.length >= all.length) return new Set();
  return new Set(known);
}

function setToSources(next: Set<string>, all: readonly string[]): string[] {
  if (next.has(FILTER_NONE)) return [];
  if (next.size === 0) return [...all];
  return all.filter((t) => next.has(t));
}

/**
 * Сумма из поля: пробелы между разрядами и запятая вместо точки — обычный
 * ввод, а не ошибка. `type="number"` молча стёр бы значение с запятой, поэтому
 * поле текстовое с цифровой клавиатурой — как в окне счёта.
 */
function parseAmount(raw: string): number {
  const v = Number(raw.replace(/[\s\u00a0]/g, "").replace(",", "."));
  return Number.isFinite(v) ? v : Number.NaN;
}

const amountText = (n: number | null | undefined) => (n && n > 0 ? String(n) : "");

/**
 * Окно цели — создание и правка одной формой.
 *
 * Раньше новая цель заводилась подкрашенной панелью над списком, а правка
 * открывалась поверх самой карточки: две разные формы одной сущности, и обе не
 * походили на остальные окна сервиса. Теперь это обычное окно, как у счёта и
 * правила: шапка с тем, что правится, поля, кнопки внизу.
 */
export function GoalEditModal({
  goal,
  accountTitles,
  progressOf,
  base,
  onSave,
  onClose,
}: {
  /** Правим существующую; нет — заводим новую. */
  goal?: Goal;
  accountTitles: string[];
  /** Сколько сейчас на выбранных счетах в базовой валюте; `null` — счетов нет. */
  progressOf: (titles: readonly string[]) => GoalProgress | null;
  base: string;
  onSave: (draft: GoalDraft) => void | Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(amountText(goal?.target));
  const [current, setCurrent] = useState(amountText(goal?.current));
  const [deadline, setDeadline] = useState(goal?.deadline ?? "");
  const [sources, setSources] = useState<string[]>(() => (goal ? goalSources(goal) : []));
  const [monthly, setMonthly] = useState(amountText(goal?.monthlyContribution));

  const targetNum = parseAmount(target);
  const monthlyNum = parseAmount(monthly);
  const bound = sources.length > 0;
  const progress = bound ? progressOf(sources) : null;
  const canSave = name.trim().length > 0 && targetNum > 0;

  async function save() {
    if (!canSave) return;
    await onSave({
      name: name.trim(),
      target: targetNum,
      // У привязанной к счетам цели ручное поле не показывается — сохраняем
      // прежнее значение: к нему цель вернётся, если счета отвязать.
      current: bound ? (goal?.current ?? 0) : parseAmount(current) > 0 ? parseAmount(current) : 0,
      deadline: deadline || null,
      accountTitle: sources[0] ?? null,
      accountTitles: sources,
      monthlyContribution: monthlyNum > 0 ? monthlyNum : null,
    });
    onClose();
  }

  return (
    <Modal onClose={onClose} width="md">
      <ModalHeader
        icon={Target}
        overline={goal ? "Цель" : "Новая цель"}
        title={name.trim() || (goal ? goal.name : "Без названия")}
      />

      <ModalBody scroll>
        <div>
          <label htmlFor="goal-name" className="label block mb-1">
            Название
          </label>
          <input
            id="goal-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void save()}
            placeholder="Например, подушка безопасности"
            className="input text-sm"
            autoComplete="off"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="goal-target" className="label block mb-1">
              Сумма цели ({base})
            </label>
            <input
              id="goal-target"
              type="text"
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="0"
              className="input text-sm tabular-nums"
              autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor="goal-deadline" className="label block mb-1">
              Дедлайн
            </label>
            <DateField
              id="goal-deadline"
              placeholder="Необязательно"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="input text-sm"
            />
          </div>
        </div>

        <div>
          <label htmlFor="goal-sources" className="label block mb-1">
            Где копится
          </label>
          <MultiSelect
            id="goal-sources"
            variant="field"
            label="Счета"
            options={accountTitles}
            selected={sourcesToSet(sources, accountTitles)}
            onChange={(next) => setSources(setToSources(next, accountTitles))}
            renderIcon={(title) => <AccountLogo title={title} size={18} />}
            unitForms={["счёт", "счёта", "счетов"]}
            searchPlaceholder="Поиск счёта"
            noneSummary="Сумма вручную"
            namesInSummary
          />
          <p className="text-xs text-muted mt-1.5">
            {bound
              ? "Прогресс — сумма балансов этих счетов, обновляется на каждой синхронизации. Счета в другой валюте пересчитаны по курсу ЦБ на сегодня."
              : accountTitles.length > 0
                ? "Выберите один или несколько счетов — прогресс будет считаться по их балансам. Или введите накопленное вручную."
                : "Счета появятся после подключения Дзен-мани; пока накопленное вводится вручную."}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="goal-current" className="label block mb-1">
              Уже накоплено
            </label>
            {bound ? (
              <div
                id="goal-current"
                className="input text-sm flex items-center text-muted bg-panel2/60 tabular-nums cursor-default"
              >
                {progress?.bound ? formatMoney(progress.current, base) : "по балансу счетов"}
              </div>
            ) : (
              <input
                id="goal-current"
                type="text"
                inputMode="decimal"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                placeholder="0"
                className="input text-sm tabular-nums"
                autoComplete="off"
              />
            )}
          </div>
          <div>
            <label htmlFor="goal-monthly" className="label block mb-1">
              Откладывать в месяц
            </label>
            <input
              id="goal-monthly"
              type="text"
              inputMode="decimal"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
              placeholder="Необязательно"
              className="input text-sm tabular-nums"
              autoComplete="off"
            />
          </div>
        </div>
        <p className="text-xs text-muted -mt-2">
          Без суммы в месяц срок считается по вашему среднему темпу сбережений. С ней —
          появится второй прогноз, именно по этим отчислениям.
        </p>
      </ModalBody>

      <ModalFooter>
        <button type="button" onClick={onClose} className="btn-ghost text-sm ml-auto">
          Отмена
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canSave}
          className="btn-primary text-sm"
        >
          {goal ? "Сохранить" : "Создать"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
