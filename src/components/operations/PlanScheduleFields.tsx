import {
  WEEKDAY_SHORT,
  weekdayOf,
  type PlanSchedule,
  type ScheduleUnit,
} from "../../lib/planSchedule";
import { DateField } from "../DateField";
import { Segmented } from "../Segmented";
import { X } from "lucide-react";
import { pluralRu } from "../../lib/plural";

/** «1 день, 2 дня, 5 дней» — слово после числа в «Повторять каждые». */
const UNIT_FORMS: Record<ScheduleUnit, [string, string, string]> = {
  day: ["день", "дня", "дней"],
  week: ["неделю", "недели", "недель"],
  month: ["месяц", "месяца", "месяцев"],
  year: ["год", "года", "лет"],
};

/**
 * Расписание плана: периодичность, дни недели, «каждые N», первая дата и
 * «повторять до». Строки с ближайшими датами под блоком нет — как и в самом
 * приложении. Одно на «Сделать
 * регулярной» и «Изменить → Вся цепочка»: расписание в обоих окнах одно и то
 * же, и вид у него должен быть один.
 *
 * `preview` — даты, которые получатся (считает окно: ему виднее, с какого дня);
 * последняя из них подставляется в «Повторять до» по «Выбрать дату».
 */
export function PlanScheduleFields({
  value,
  onChange,
  preview,
  startLabel = "Первая дата",
  hideStart = false,
}: {
  value: PlanSchedule;
  onChange: (next: PlanSchedule) => void;
  preview: string[];
  startLabel?: string;
  /** Первую дату задаёт само окно (поле «Дата» новой операции) — здесь её не дублируем. */
  hideStart?: boolean;
}) {
  const set = (patch: Partial<PlanSchedule>) => onChange({ ...value, ...patch });

  function toggleDay(d: number) {
    const on = value.weekdays.includes(d);
    // Ни одного дня — не расписание: последний выбранный не снимается.
    if (on && value.weekdays.length === 1) return;
    set({ weekdays: on ? value.weekdays.filter((x) => x !== d) : [...value.weekdays, d].sort((a, b) => a - b) });
  }

  const every = value.every;
  const everyLabel = every === 1 ? (value.unit === "week" ? "Повторять каждую" : "Повторять каждый") : "Повторять каждые";
  const unitWord = pluralRu(every, UNIT_FORMS[value.unit]);

  return (
    <div className="space-y-3" data-schedule>
      {/* Порядок и подписи — как в форме операции Дзен-мани: периодичность,
          дни недели, «каждый N», «до». Человек, заводивший планы в приложении,
          узнаёт блок с первого взгляда. */}
      <div>
        <span className="label block mb-1">Периодичность повторения</span>
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

      {value.unit === "week" && (
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
      )}

      <div className={`grid grid-cols-1 gap-3 ${hideStart ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
        <div>
          <span className="label block mb-1">{everyLabel}</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={99}
              value={every}
              onChange={(e) => set({ every: Math.min(99, Math.max(1, Math.floor(Number(e.target.value)) || 1)) })}
              aria-label="Через сколько периодов"
              className="input w-16 !py-1.5 text-sm tabular-nums text-center"
            />
            <span className="text-sm text-muted">{unitWord}</span>
          </div>
        </div>
        {!hideStart && (
          <div>
            <span className="label block mb-1">{startLabel}</span>
            <DateField
              value={value.startDate}
              onChange={(e) => e.target.value && set({ startDate: e.target.value })}
              typeable
              className="input !py-1.5 text-sm w-full"
            />
          </div>
        )}
        <div>
          <span className="label block mb-1">Повторять до</span>
          {value.endDate ? (
            <div className="flex items-center gap-1">
              <DateField
                value={value.endDate}
                onChange={(e) => e.target.value && set({ endDate: e.target.value })}
                typeable
                className="input !py-1.5 text-sm w-full"
              />
              <button
                type="button"
                className="btn-icon btn-icon-sm shrink-0"
                onClick={() => set({ endDate: null })}
                aria-label="Повторять без конца"
                title="Повторять без конца"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            // Пусто — план без конца. Дата по умолчанию — последняя из уже
            // построенных, чтобы поле не открывалось на сегодняшнем дне.
            <button
              type="button"
              className="input !py-1.5 w-full text-sm text-accent text-left"
              onClick={() => set({ endDate: preview[preview.length - 1] ?? value.startDate })}
            >
              Выбрать дату
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
