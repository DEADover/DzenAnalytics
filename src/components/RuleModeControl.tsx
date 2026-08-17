import { useRef, useState, type ReactNode } from "react";
import {
  Ban,
  CalendarClock,
  ChevronDown,
  HelpCircle,
  MousePointerClick,
  Play,
  Zap,
} from "lucide-react";
import clsx from "clsx";
import { Popover } from "./Popover";
import { Select } from "./Select";
import { pluralRu } from "../lib/plural";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { pushNote } from "../lib/ruleMode";
import { Tooltip } from "./Tooltip";
import {
  depthCount,
  everyCount,
  nextRunLabel,
  scheduleLabel,
  scheduleShort,
  type RuleRun,
} from "../lib/ruleSchedule";
import type { RuleMode } from "../lib/ruleMode";
import type { RuleSchedule, ScheduleDepth, ScheduleEvery } from "../lib/ruleSchedule";

/**
 * Режим правила — одним контролом вместо трёх сегментов и кнопки расписания.
 *
 * Сегменты не давали места объяснению: смысл каждого лежал в `title`, то есть
 * открывался по наведению — и только тому, кто догадался навести. Три равных по
 * весу варианта рядом при этом читались как отбор, а не как состояние правила.
 * Расписание же было ВТОРЫМ контролом той же ячейки и уезжало на вторую строку,
 * из-за чего строки таблицы прыгали по высоте.
 *
 * Здесь выбор и объяснение лежат в одном месте: в таблице — значок состояния
 * словами («Авто · Ежедневно»), в его окне — строки с пояснениями; в карточке
 * правила те же строки развёрнуты сразу. Расписание стало свойством «Авто» и
 * живёт внутри него, поэтому второй строке взяться неоткуда.
 */

const MODES: {
  value: RuleMode;
  label: string;
  hint: string;
  Icon: typeof Ban;
}[] = [
  {
    value: "off",
    label: "Выкл",
    hint: "Правило не работает нигде — ни кнопкой, ни само",
    Icon: Ban,
  },
  {
    value: "manual",
    label: "По кнопке",
    hint: "Работает только через «Проверить и применить»",
    Icon: MousePointerClick,
  },
  {
    value: "auto",
    label: "Авто",
    hint: "Само размечает операции при синхронизации, без кнопки",
    Icon: Zap,
  },
];

/** Единицы частоты. Число к ним задаётся полем рядом — кроме «Только новых». */
const EVERY_UNITS: { value: ScheduleEvery | "off"; label: string }[] = [
  { value: "off", label: "Только новые" },
  { value: "minute", label: "мин." },
  { value: "hour", label: "ч." },
  { value: "day", label: "дн." },
  { value: "month", label: "мес." },
];

/** Единицы глубины. Число к ним задаётся полем рядом — кроме «всего времени». */
const DEPTH_UNITS: { value: ScheduleDepth; label: string }[] = [
  { value: "day", label: "дн." },
  { value: "month", label: "мес." },
  { value: "year", label: "лет" },
  { value: "all", label: "всё время" },
];

export interface RuleModeValue {
  mode: RuleMode;
  schedule: RuleSchedule | undefined;
}

/** Полная фраза о состоянии — для подсказки значка. */
function modeSentence({ mode, schedule }: RuleModeValue): string {
  const meta = MODES.find((m) => m.value === mode)!;
  return mode === "auto" ? `${meta.hint}. ${scheduleLabel(schedule)}` : meta.hint;
}

/**
 * Выбор режима: три плитки в ряд, под ними — пояснение выбранной.
 *
 * Раньше это были три карточки в столбик, каждая со своей строкой пояснения:
 * понятно, но высоко — в карточке правила блок занимал пол-экрана, а главное
 * там не он. Ряд плиток занимает одну строку, а пояснение нужно только у
 * выбранного режима: остальные два человек прочитает, когда до них дотянется.
 */
export function RuleModePanel({
  value,
  onChange,
  onPick,
  run,
  onRunNow,
  className,
}: {
  value: RuleModeValue;
  onChange: (next: RuleModeValue) => void;
  /** Режим выбран — окну пора закрыться. У «Авто» не зовётся: под ним ещё
   *  раскрывается расписание, и закрыть окно значило бы прятать его. */
  onPick?: () => void;
  /** Когда правило отработало в прошлый раз и сколько операций поправило. */
  run?: RuleRun;
  /** Прогнать правило сейчас. Нет — кнопки не будет (правило ещё не создано). */
  onRunNow?: () => Promise<number>;
  className?: string;
}) {
  const [running, setRunning] = useState(false);
  const push = pushNote(useZenmoneyStore((s) => s.pushMode));
  const { mode, schedule } = value;
  const every: ScheduleEvery | "off" = schedule?.every ?? "off";
  const everyN = everyCount(schedule);
  const depth: ScheduleDepth = schedule?.depth ?? "month";
  const count = depthCount(schedule);
  const meta = MODES.find((m) => m.value === mode)!;

  const setMode = (next: RuleMode) => {
    // Расписание переживает выключение правила: человек вернёт «Авто» и не
    // будет настраивать его заново. Работать оно при этом не работает —
    // автоприменение смотрит на сам режим.
    onChange({ mode: next, schedule });
    if (next !== "auto") onPick?.();
  };
  const setSchedule = (patch: {
    every?: ScheduleEvery | "off";
    everyN?: number;
    depth?: ScheduleDepth;
    depthN?: number;
  }) => {
    const nextEvery = patch.every ?? every;
    if (nextEvery === "off") return onChange({ mode, schedule: undefined });
    onChange({
      mode,
      schedule: {
        every: nextEvery,
        everyN: patch.everyN ?? everyN,
        depth: patch.depth ?? depth,
        depthN: patch.depthN ?? count,
      },
    });
  };

  return (
    <div className={clsx("space-y-2", className)}>
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Режим правила">
        {MODES.map((m) => {
          const on = m.value === mode;
          return (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setMode(m.value)}
              className={clsx(
                "flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-sm transition-colors",
                on
                  ? "border-accent bg-accent/10 text-accent font-semibold"
                  : "border-border text-muted hover:border-accent/40 hover:text-text"
              )}
            >
              <m.Icon className="w-4 h-4 shrink-0" />
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Пояснение только к выбранному: три подписи разом — та же стена текста,
          из-за которой блок и был высоким. */}
      <p className="text-xs text-muted">{meta.hint}</p>

      {mode === "auto" && (
        <div className="pt-0.5 space-y-1.5">
          {/* Частота и глубина — ОДНОЙ строкой: две строки с подписями слева и
              контролами справа занимали столько же места, сколько сам выбор
              режима, хотя отвечают на один вопрос — «когда и как далеко». */}
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted">
            <FieldLabel
              title="Как часто"
              help={
                <>
                  <p>
                    Минуты и часы идут сами, пока приложение открыто: вкладку
                    закрыли — отсчёт встал, и правило сработает при следующем
                    заходе. Дни и месяцы считаются по календарю: «раз в день»
                    значит «в новый день», а не «через 24 часа».
                  </p>
                  <p>
                    «Только новые» — прежнее поведение: правило трогает лишь то,
                    что пришло последней синхронизацией.
                  </p>
                </>
              }
            />
            {every !== "off" && (
              <input
                type="number"
                min={1}
                max={999}
                value={everyN}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n > 0)
                    setSchedule({ everyN: Math.min(999, Math.round(n)) });
                }}
                aria-label="Как часто, число"
                className="input h-8 text-xs !px-2 !py-1 w-14 tabular-nums"
              />
            )}
            <Select
              value={every}
              options={EVERY_UNITS}
              onChange={(next) => setSchedule({ every: next })}
              ariaLabel="Как часто"
              portal
              size="sm"
              className="!w-auto min-w-[7rem]"
            />

            {/* Глубина спрашивается только у правила с расписанием: без него
                смотреть в прошлое нечем — трогаются лишь новые операции. */}
            {every !== "off" && (
              <>
                <FieldLabel
                  title="Глубина"
                  help={
                    <>
                      <p>
                        За какой отрезок правило проверит операции. Нужно для случая,
                        когда операция уже лежит в истории, а подходить под правило
                        стала позже — например, вы поправили у неё комментарий.
                      </p>
                      <p>
                        «За 1 день» — это сегодня, «за 3 дня» — сегодня и два
                        предыдущих. Месяц считается за 30 дней, год — за 365.
                      </p>
                    </>
                  }
                />
                {depth !== "all" && (
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={count}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n > 0)
                        setSchedule({ depthN: Math.min(999, Math.round(n)) });
                    }}
                    aria-label="Глубина, число"
                    className="input h-8 text-xs !px-2 !py-1 w-14 tabular-nums"
                  />
                )}
                <Select
                  value={depth}
                  options={DEPTH_UNITS}
                  onChange={(next) => setSchedule({ depth: next })}
                  ariaLabel="Единица глубины"
                  portal
                  size="sm"
                  className="!w-auto min-w-[6rem]"
                />
              </>
            )}
          </div>

          {depth === "all" && every !== "off" && (
            <p className="text-xs text-warn">
              Правило пройдёт по всей истории операций. Если включена отправка в
              Дзен-мани, правки уедут в облако.
            </p>
          )}

          {/* Что «Авто» уже сделало и когда сделает снова. Без этого включённый
              режим выглядит как обещание: правило где-то работает, а увидеть
              этого нельзя — ни срока, ни следа.

              РОВНО ТРИ СТРОКИ, каждая в одну строку: блок стоит под настройками
              и разрастаться в простыню не должен. Всё, что не поместилось,
              живёт в подсказке у знака вопроса. */}
          <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-1.5">
            <div className="text-xs text-muted min-w-0 flex-1 space-y-0.5">
              <div className="truncate">
                <span className="text-text">Последний раз:</span>{" "}
                {run ? runWords(run) : "ещё ни разу"}
              </div>
              <div className="truncate">
                <span className="text-text">Сработает:</span>{" "}
                {nextRunLabel(schedule, run?.at, new Date())}
              </div>
              <div className={clsx("truncate", push.tone === "warn" && "text-warn")}>
                {push.text}
              </div>
            </div>
            <Tooltip
              content={
                <>
                  <p>
                    Новые операции правило в режиме «Авто» размечает при каждой
                    синхронизации, даже когда расписание стоит на «Только новые».
                    Расписание и глубина — только про то, что уже лежит в истории.
                  </p>
                  <p>
                    Минуты и часы идут сами, пока приложение открыто. Дни и месяцы
                    ждут захода в приложение или синхронизации: браузерное
                    приложение ночью не работает.
                  </p>
                  <p>
                    Записанное правилом — обычная правка операции: видно в списке
                    изменений, откатывается построчно. В облако она уедет по
                    правилам вашего режима отправки — о нём третья строка.
                  </p>
                </>
              }
            >
              <span className="shrink-0 text-muted hover:text-accent cursor-help">
                <HelpCircle className="w-4 h-4" />
              </span>
            </Tooltip>
            {onRunNow && every !== "off" && (
              <button
                type="button"
                disabled={running}
                onClick={async () => {
                  setRunning(true);
                  try {
                    await onRunNow();
                  } finally {
                    setRunning(false);
                  }
                }}
                className="btn-ghost !px-3 !py-2 text-xs shrink-0 whitespace-nowrap"
                title="Пройти по операциям сейчас, не дожидаясь срока"
              >
                <Play className="w-3.5 h-3.5" />
                {running ? "Идёт…" : "Прогнать сейчас"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** «17 августа, 11:42 · 5 правок» — след прошлого захода. */
function runWords(run: RuleRun): string {
  const d = new Date(run.at);
  if (Number.isNaN(d.getTime())) return "ещё ни разу";
  const when = d.toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  if (run.changed === undefined) return when;
  return run.changed > 0
    ? `${when} · ${run.changed} ${pluralRu(run.changed, ["правка", "правки", "правок"])}`
    : `${when} · без правок`;
}

/** Подпись поля: пояснение живёт в подсказке, чтобы не занимать собой строку. */
function FieldLabel({ title, help }: { title: string; help: ReactNode }) {
  return (
    <Tooltip content={help}>
      <span className="text-xs text-muted whitespace-nowrap border-b border-dotted border-border cursor-help">
        {title}
      </span>
    </Tooltip>
  );
}

/**
 * Значок режима для строки таблицы: одна строка, что бы ни было выбрано.
 *
 * Цвет отвечает за состояние — выключенное правило приглушено, «Авто» выделено
 * акцентом, — а частота дописана в тот же значок: без неё два правила «Авто»
 * выглядят одинаково, хотя одно ходит по истории каждый день, а другое трогает
 * только новое. Глубина «Всё время» подсвечена цветом предупреждения: это самая
 * дорогая настройка, и видеть её надо не открывая окно.
 */
export function RuleModeChip({
  value,
  onChange,
  run,
  onRunNow,
}: {
  value: RuleModeValue;
  onChange: (next: RuleModeValue) => void;
  run?: RuleRun;
  onRunNow?: () => Promise<number>;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const { mode, schedule } = value;
  const meta = MODES.find((m) => m.value === mode)!;

  return (
    <div ref={anchorRef} className="inline-block">
      <Tooltip content={`${modeSentence(value)}. Нажмите, чтобы изменить`}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={clsx(
            "inline-flex items-center gap-1.5 rounded-full border pl-2 pr-1.5 py-1 text-xs whitespace-nowrap transition-colors max-w-full",
            mode === "off" && "border-border bg-panel2 text-muted hover:text-text",
            mode === "manual" && "border-border bg-panel2 text-text hover:border-accent/40",
            mode === "auto" && "border-accent/40 bg-accent/10 text-accent hover:bg-accent/15"
          )}
        >
          <meta.Icon className="w-3.5 h-3.5 shrink-0" />
          <span className="font-medium shrink-0">{meta.label}</span>
          {mode === "auto" && (
            <span
              className={clsx(
                "inline-flex items-center gap-1 min-w-0",
                schedule?.depth === "all" ? "text-warn" : "opacity-70"
              )}
            >
              <CalendarClock className="w-3 h-3 shrink-0" />
              <span className="truncate">{scheduleShort(schedule)}</span>
            </span>
          )}
          <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
        </button>
      </Tooltip>
      <Popover
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        align="right"
        className="w-[34rem] card p-3 shadow-lg"
      >
        <div className="label mb-2">Режим правила</div>
        <RuleModePanel
          value={value}
          onChange={onChange}
          onPick={() => setOpen(false)}
          run={run}
          onRunNow={onRunNow}
        />
      </Popover>
    </div>
  );
}
