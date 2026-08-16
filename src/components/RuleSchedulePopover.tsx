import { useRef, useState } from "react";
import { CalendarClock } from "lucide-react";
import { Popover } from "./Popover";
import { Segmented } from "./Segmented";
import { SettingRow } from "./SettingRow";
import { Tooltip } from "./Tooltip";
import { scheduleLabel } from "../lib/ruleSchedule";
import type {
  RuleSchedule,
  ScheduleDepth,
  ScheduleEvery,
} from "../lib/ruleSchedule";

const EVERY: { value: ScheduleEvery | "off"; label: string; title: string }[] = [
  {
    value: "off",
    label: "Только новые",
    title: "Как раньше: правило трогает лишь то, что пришло синхронизацией",
  },
  { value: "day", label: "Раз в день", title: "Первый заход в новый день" },
  { value: "month", label: "Раз в месяц", title: "Первый заход в новом месяце" },
];

const DEPTH: { value: ScheduleDepth; label: string; title: string }[] = [
  { value: "day", label: "День", title: "Операции сегодняшнего дня" },
  { value: "month", label: "Месяц", title: "Операции за последние 30 дней" },
  { value: "year", label: "Год", title: "Операции за последний год" },
  { value: "all", label: "Всё время", title: "Вся история операций" },
];

/**
 * Расписание автоприменения у одного правила (issue #75).
 *
 * Живёт рядом с переключателем режима и открывается кнопкой: два вопроса —
 * «как часто» и «как глубоко» — в ячейку таблицы не помещаются, а нужны они
 * заметно реже, чем сам режим.
 *
 * Про «весь период» окно предупреждает прямо здесь, при выборе, а не при
 * запуске: правило пройдёт по всей истории и, если включена отправка, унесёт
 * правки в Дзен-мани. Спрашивать об этом задним числом поздно.
 */
export function RuleSchedulePopover({
  value,
  onChange,
}: {
  value: RuleSchedule | undefined;
  onChange: (next: RuleSchedule | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const every: ScheduleEvery | "off" = value?.every ?? "off";
  const depth: ScheduleDepth = value?.depth ?? "month";

  const setEvery = (next: ScheduleEvery | "off") =>
    onChange(next === "off" ? undefined : { every: next, depth });
  const setDepth = (next: ScheduleDepth) =>
    onChange(every === "off" ? undefined : { every, depth: next });

  return (
    <div ref={anchorRef} className="inline-block">
      <Tooltip content="Расписание: как часто правило проходит по операциям и как глубоко смотрит">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`btn-ghost !px-2 !py-1 text-xs whitespace-nowrap ${
            value ? "text-accent" : "text-muted"
          }`}
        >
          <CalendarClock className="w-3.5 h-3.5" />
          {scheduleLabel(value)}
        </button>
      </Tooltip>
      <Popover
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        align="right"
        className="w-[26rem] card p-3.5 shadow-lg"
      >
        <div className="label mb-0.5">Расписание правила</div>

        <SettingRow
          dense
          title="Как часто"
          help={
            <>
              <p>
                Приложение работает в браузере, а не на сервере: «раз в день»
                значит «при первом открытии или синхронизации в новый день».
                Ночью само ничего не произойдёт.
              </p>
              <p>
                «Только новые» — прежнее поведение: правило трогает лишь то, что
                пришло последней синхронизацией.
              </p>
            </>
          }
          control={
            <Segmented
              size="sm"
              label="Как часто"
              value={every}
              onChange={setEvery}
              options={EVERY}
            />
          }
        />

        {/* Глубина спрашивается только у правила с расписанием: без него
            смотреть в прошлое нечем — трогаются лишь новые операции. */}
        {every !== "off" && (
        <SettingRow
          dense
          title="Глубина"
          help={
            <>
              <p>
                За какой отрезок правило проверит операции. Нужно для случая,
                когда операция уже лежит в истории, а подходить под правило
                стала позже — например, вы поправили у неё комментарий.
              </p>
              <p>
                Автоприменение никогда не переписывает поле, которое вы правили
                руками, и результат виден в списке изменений — там же его можно
                откатить.
              </p>
            </>
          }
          control={
            <Segmented
              size="sm"
              label="Глубина"
              value={depth}
              onChange={setDepth}
              options={DEPTH}
            />
          }
        />
        )}

        {value?.depth === "all" && (
          <p className="text-xs text-warn pt-2">
            Правило пройдёт по всей истории операций. Если включена отправка в
            Дзен-мани, правки уедут в облако.
          </p>
        )}
      </Popover>
    </div>
  );
}
