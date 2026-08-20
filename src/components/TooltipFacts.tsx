import type { ReactNode } from "react";

/** Смысловой цвет значения — тот же, что и у этого числа в интерфейсе. */
export type TooltipTone = "income" | "expense" | "warn" | "accent" | "muted";

const TONE_TEXT: Record<TooltipTone, string> = {
  income: "text-income",
  expense: "text-expense",
  warn: "text-warn",
  accent: "text-accent",
  muted: "text-muted",
};

/** One «подпись → значение» line of a tooltip. */
export interface TooltipFact {
  label: string;
  value: string;
  /**
   * Метка слева от подписи — класс фона (`bg-expense`, можно с `opacity-35`).
   * Ставится, когда строка объясняет КУСОК полоски или диаграммы: цветной
   * квадратик связывает число с тем местом, куда пользователь смотрит.
   */
  swatch?: string;
  /**
   * Та же метка, но цветом из палитры графика (`#22D3EE`, `var(--…)`).
   *
   * У полос бюджета цвет смысловой — «доход», «расход», — и он живёт классом.
   * У слоёв стопки счетов цвет свой у каждого счёта и приходит из палитры уже
   * значением: класса под него нет и быть не может, а связать строку подсказки
   * с областью на графике надо ровно так же.
   */
  swatchColor?: string;
  /**
   * Значок вместо цветной метки — для строк, которым на полосе не
   * соответствует ничего (план, остаток, разница). Место под значок и под
   * метку одно и то же, поэтому подписи стоят в столбик независимо от того,
   * что у строки слева.
   */
  icon?: ReactNode;
  /** Цвет значения. Без него — обычный цвет текста. */
  tone?: TooltipTone;
  /** Главное число подсказки — крупнее и жирнее прочих. */
  strong?: boolean;
}

/**
 * Structured body for a tooltip that explains a number: what it is on top,
 * the figures behind it as an aligned two-column list, and an optional note.
 *
 * Exists because a formula plus three sums written as one sentence — «Формула:
 * (доход − расход) ÷ доход × 100. Средние за последние 6 месяцев: доход
 * 542 149 ₽, расход 428 869 ₽, остаётся 113 279 ₽ в месяц» — is a wall of text
 * you have to parse word by word. Split into rows, the same content is read at
 * a glance, and the numbers line up under each other.
 *
 * Одного разбиения на строки оказалось мало: список одинаковых серых фраз —
 * та же пелена, только столбиком. Поэтому у строки есть цвет значения, метка
 * цвета сегмента и «главное число», а примечание отбито чертой — глаз находит
 * ответ, не читая подсказку целиком.
 */
export function TooltipFacts({
  title,
  facts,
  note,
}: {
  /** What is being measured / the formula, in one short line. */
  title?: ReactNode;
  facts?: TooltipFact[];
  /** Caveats and «where to change it» — smaller, under the numbers. */
  note?: ReactNode;
}) {
  const hasFacts = !!facts && facts.length > 0;
  return (
    <div className="space-y-2">
      {title != null && <div className="font-semibold text-text">{title}</div>}
      {hasFacts && (
        <div className="space-y-1">
          {facts.map((f) => (
            <div key={f.label} className="flex items-center justify-between gap-6">
              <span className="flex items-center gap-1.5 text-muted whitespace-nowrap">
                {(f.swatch || f.swatchColor || f.icon) && (
                  <span className="w-3.5 shrink-0 flex items-center justify-center [&>svg]:w-3.5 [&>svg]:h-3.5">
                    {f.swatch || f.swatchColor ? (
                      <span
                        className={`inline-block w-2.5 h-2 rounded-full ${f.swatch ?? ""}`}
                        style={f.swatchColor ? { background: f.swatchColor } : undefined}
                      />
                    ) : (
                      f.icon
                    )}
                  </span>
                )}
                {f.label}
              </span>
              <span
                className={`tabular-nums whitespace-nowrap ${
                  f.strong ? "font-semibold" : ""
                } ${f.tone ? TONE_TEXT[f.tone] : ""}`}
              >
                {f.value}
              </span>
            </div>
          ))}
        </div>
      )}
      {note != null && (
        <div
          className={`text-muted ${
            // Черта нужна там, где над примечанием есть числа: иначе она отбивала
            // бы его от заголовка, к которому оно и относится.
            hasFacts ? "border-t border-border/60 pt-1.5" : ""
          }`}
        >
          {note}
        </div>
      )}
    </div>
  );
}

/**
 * Готовая подсказка «строка = серия» для графиков recharts.
 *
 * Заведена потому, что почти все подсказки устроены одинаково: заголовок —
 * подпись точки, ниже пары «серия → сумма» с квадратиком в цвет своей полосы.
 * Писать это по разу на каждый график означало десять чуть-чуть разных
 * подсказок; так они одинаковые по построению.
 *
 * Не подходит там, где подсказка объясняет что-то сверх сумм (разница, прогноз,
 * отклонение от среднего) — тем графикам по-прежнему пишут свой `content` на
 * `TooltipFacts`.
 */
export function SeriesTooltip({
  active,
  payload,
  label,
  formatValue,
  formatLabel,
  skipKeys,
  note,
}: {
  active?: boolean;
  payload?: {
    name?: string;
    value?: unknown;
    color?: string;
    dataKey?: string | number;
    payload?: Record<string, unknown>;
  }[];
  label?: unknown;
  /** Как показать число серии. */
  formatValue: (value: number) => string;
  /** Как показать заголовок; по умолчанию — сам `label`. Вторым аргументом
   *  приходят точки: у части графиков подпись лежит в самих данных, а не в
   *  `label` (например, полное название дня недели). */
  formatLabel?: (label: unknown, rows: { payload?: Record<string, unknown> }[]) => string;
  /** Служебные серии, которых в подсказке быть не должно (подложки, границы). */
  skipKeys?: string[];
  note?: ReactNode;
}) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter(
    (p) => !skipKeys?.includes(String(p.dataKey)) && Number.isFinite(Number(p.value))
  );
  if (rows.length === 0) return null;
  return (
    <ChartTooltipCard>
      <TooltipFacts
        title={formatLabel ? formatLabel(label, rows) : String(label ?? "")}
        facts={rows.map((p) => ({
          label: String(p.name ?? p.dataKey ?? ""),
          value: formatValue(Number(p.value)),
          swatchColor: p.color,
        }))}
        note={note}
      />
    </ChartTooltipCard>
  );
}

/**
 * Карточка подсказки графика: та же рамка, фон и отступы, что у подсказок всего
 * интерфейса (`Tooltip`), — чтобы подсказка на графике не выглядела гостьей из
 * другого приложения.
 *
 * Своя обёртка нужна потому, что Recharts со своим `content` рисует голый
 * контейнер: фон и рамку из `contentStyle` он в этом случае не применяет.
 */
export function ChartTooltipCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-panel2 px-3 py-2 text-xs leading-relaxed text-text shadow-lg">
      {children}
    </div>
  );
}
