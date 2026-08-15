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
                {(f.swatch || f.icon) && (
                  <span className="w-3.5 shrink-0 flex items-center justify-center [&>svg]:w-3.5 [&>svg]:h-3.5">
                    {f.swatch ? (
                      <span className={`inline-block w-2.5 h-2 rounded-full ${f.swatch}`} />
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
