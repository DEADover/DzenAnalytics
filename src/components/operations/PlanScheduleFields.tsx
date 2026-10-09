import { formatDate } from "../../lib/format";
import {
  WEEKDAY_SHORT,
  scheduleLabel,
  weekdayOf,
  type PlanSchedule,
  type ScheduleUnit,
} from "../../lib/planSchedule";
import { DateField } from "../DateField";
import { Segmented } from "../Segmented";

type EndMode = "never" | "until";

/**
 * Расписание плана: «каждые N дней / недель / месяцев / лет», дни недели,
 * первая и последняя даты, а под ними — какие даты получатся. Одно на «Сделать
 * регулярной» и «Изменить → Вся цепочка»: расписание в обоих окнах одно и то
 * же, и вид у него должен быть один.
 *
 * `preview` — даты, которые получатся (считает окно: ему виднее, с какого дня).
 */
export function PlanScheduleFields({
  value,
  onChange,
  preview,
  startLabel = "Первая дата",
}: {
  value: PlanSchedule;
  onChange: (next: PlanSchedule) => void;
  preview: string[];
  startLabel?: string;
}) {
  const set = (patch: Partial<PlanSchedule>) => onChange({ ...value, ...patch });
  const endMode: EndMode = value.endDate ? "until" : "never";

  function toggleDay(d: number) {
    const on = value.weekdays.includes(d);
    // Ни одного дня — не расписание: последний выбранный не снимается.
    if (on && value.weekdays.length === 1) return;
    set({ weekdays: on ? value.weekdays.filter((x) => x !== d) : [...value.weekdays, d].sort((a, b) => a - b) });
  }

  return (
    <div className="space-y-3">
      <div>
        <span className="label block mb-1">Повторять</span>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted shrink-0">Каждые</span>
          <input
            type="number"
            min={1}
            max={99}
            value={value.every}
            onChange={(e) => set({ every: Math.min(99, Math.max(1, Math.floor(Number(e.target.value)) || 1)) })}
            aria-label="Через сколько периодов"
            className="input w-16 !py-1.5 text-sm tabular-nums text-center"
          />
          <div className="flex-1 min-w-0">
            <Segmented<ScheduleUnit>
              value={value.unit}
              // Неделя без дней — не расписание: начинаем с дня первой даты.
              onChange={(unit) =>
                set(unit === "week" && value.weekdays.length === 0 ? { unit, weekdays: [weekdayOf(value.startDate)] } : { unit })
              }
              label="Период"
              size="sm"
              block
              options={[
                { value: "day", label: "День" },
                { value: "week", label: "Неделя" },
                { value: "month", label: "Месяц" },
                { value: "year", label: "Год" },
              ]}
            />
          </div>
        </div>
      </div>

      {value.unit === "week" && (
        <div>
          <span className="label block mb-1">Дни недели</span>
          <div className="grid grid-cols-7 gap-1" role="group" aria-label="Дни недели">
            {WEEKDAY_SHORT.map((name, d) => (
              <button
                key={name}
                type="button"
                aria-pressed={value.weekdays.includes(d)}
                onClick={() => toggleDay(d)}
                className={`chip chip-sm !px-2 justify-center capitalize ${value.weekdays.includes(d) ? "chip-on" : ""}`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <span className="label block mb-1">{startLabel}</span>
          <DateField
            value={value.startDate}
            onChange={(e) => e.target.value && set({ startDate: e.target.value })}
            typeable
            className="input !py-1.5 text-sm w-full"
          />
        </div>
        <div>
          <span className="label block mb-1">Окончание</span>
          <Segmented<EndMode>
            value={endMode}
            onChange={(m) => set({ endDate: m === "never" ? null : value.endDate ?? preview[preview.length - 1] ?? value.startDate })}
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
          {/* Ряд с переключателем высотой 34 — поле той же высоты. */}
          {value.endDate ? (
            <DateField
              value={value.endDate}
              onChange={(e) => e.target.value && set({ endDate: e.target.value })}
              typeable
              className="input !py-1.5 text-sm w-full"
            />
          ) : (
            <div className="input !py-1.5 w-full text-sm text-muted flex items-center">Не задана</div>
          )}
        </div>
      </div>

      <p className="text-xs text-muted" data-schedule-preview>
        {scheduleLabel(value)}
        {preview.length > 0 ? (
          <>
            {" "}· ближайшие: {preview.slice(0, 3).map((d) => formatDate(d, "short")).join(", ")}
            {preview.length > 3 && ` и ещё ${preview.length - 3}`}
          </>
        ) : (
          " · ни одной даты"
        )}
      </p>
    </div>
  );
}
