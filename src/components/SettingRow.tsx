import type { ReactNode } from "react";
import { InfoPopover } from "./InfoPopover";

/**
 * Строка настройки: слева название и короткий статус, справа контрол,
 * подробности — за знаком вопроса.
 *
 * Раньше каждая настройка была отдельной карточкой с абзацем текста над
 * контролом, и вкладка выглядела стеной пояснений. Здесь текста ровно
 * столько, чтобы понять, что настройка делает; «зачем это вообще» и оговорки
 * уходят в подсказку и открываются, когда действительно нужны.
 */
export function SettingRow({
  title,
  status,
  help,
  control,
  children,
}: {
  title: string;
  /** Одна строка о текущем состоянии — что сейчас происходит с этой настройкой. */
  status?: ReactNode;
  /** Подробности за знаком вопроса. Без них строка идёт вовсе без кнопки. */
  help?: ReactNode;
  /** Контрол справа: поле, переключатель, пикер. */
  control?: ReactNode;
  /** Раскрывающееся содержимое под строкой — редактор на всю ширину. */
  children?: ReactNode;
}) {
  return (
    <div className="py-3 border-b border-border/60 last:border-b-0">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-sm">
            <span>{title}</span>
            {help && <InfoPopover label={`${title} — подробнее`}>{help}</InfoPopover>}
          </div>
          {status && <div className="text-xs text-muted mt-0.5">{status}</div>}
        </div>
        {control && <div className="shrink-0">{control}</div>}
      </div>
      {children}
    </div>
  );
}
