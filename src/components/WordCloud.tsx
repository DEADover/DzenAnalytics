import type { ReactNode } from "react";
import { Tooltip } from "./Tooltip";

/**
 * Цвета слов — только для удобства чтения: соседние слова разного цвета
 * различаются взглядом. Смысла цвет не несёт.
 */
const PALETTE = [
  "#22D3EE",
  "#A78BFA",
  "#F59E0B",
  "#10B981",
  "#EF4444",
  "#EC4899",
  "#3B82F6",
  "#84CC16",
  "#F97316",
  "#14B8A6",
];

export interface WordCloudItem {
  key: string;
  /** Что написано. */
  text: ReactNode;
  /** Вес — от него размер и жирность: частота, сумма. */
  weight: number;
  /** Подсказка при наведении: числа, которых в самом облаке нет. */
  tip?: ReactNode;
  onClick?: () => void;
}

/**
 * Облако: слова без плашек, размер и жирность — по весу, цвета по кругу.
 *
 * Одно на «Облако слов» и «Облако тегов»: раньше облако тегов было рядом
 * плашек-чипов и на облако не походило, а два разных облака в одном сервисе
 * читались как разные вещи.
 */
export function WordCloud({ items }: { items: WordCloudItem[] }) {
  const weights = items.map((i) => i.weight);
  const max = Math.max(...weights, 1);
  const min = Math.min(...weights, max);

  const size = (w: number) => {
    if (max === min) return 18;
    return Math.round(12 + ((w - min) / (max - min)) * 38);
  };

  return (
    // По левому краю, как текст карточки и её заголовок: облако по центру
    // висело отдельно от шапки блока, с рваными краями с обеих сторон.
    // Минус-поле равно полю слова — первое слово ряда стоит вровень с заголовком.
    <div className="flex flex-wrap gap-2 justify-start items-center -mx-1.5 pt-2 pb-1">
      {items.map((it, i) => {
        const fs = size(it.weight);
        const word = (
          <button
            type="button"
            onClick={it.onClick}
            className="hover:bg-panel2/60 px-1.5 py-0.5 rounded transition-colors"
            style={{
              fontSize: `${fs}px`,
              color: PALETTE[i % PALETTE.length],
              fontWeight: fs > 30 ? 700 : fs > 20 ? 600 : 500,
              lineHeight: 1.1,
            }}
          >
            {it.text}
          </button>
        );
        return it.tip ? (
          <Tooltip key={it.key} content={it.tip}>
            {word}
          </Tooltip>
        ) : (
          <span key={it.key}>{word}</span>
        );
      })}
    </div>
  );
}
