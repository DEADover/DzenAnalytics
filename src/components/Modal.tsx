import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X, type LucideIcon } from "lucide-react";
import clsx from "clsx";

/**
 * Модальное окно — одна оболочка на весь сервис.
 *
 * Прежде каждое окно собирало её само, и за два десятка копий они разошлись:
 * радиус 12 и 16, тень `xl` и `2xl`, высота 85, 88 и 90 % экрана, крестик без
 * полей — шестнадцать пикселей, в которые трудно попасть. Хуже того, каждое
 * окно слушало Escape на `window`, и у вложенных (редактор операции поверх
 * списка правок) одно нажатие закрывало оба — окна поверх приходилось
 * проверять вручную, а где забыли, так и закрывалось.
 *
 * Здесь: Escape закрывает только верхнее окно; щелчок мимо — только если и
 * нажали, и отпустили на подложке (выделение текста, закончившееся за краем
 * окна, его не закрывает); фокус уходит в окно и возвращается туда, откуда
 * пришёл. Пока идёт работа (`busy`), окно не закрывается ничем.
 *
 * Вид — по дизайн-системе: радиус 16, кант, тень `2xl`, поля 20 / 16.
 */

const WIDTH = {
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "5xl": "max-w-5xl",
  "7xl": "max-w-7xl",
} as const;

/** Открытые окна снизу вверх: Escape достаётся только последнему. */
const stack: string[] = [];

interface ModalCtx {
  titleId: string;
  onClose: () => void;
  busy: boolean;
}
const Ctx = createContext<ModalCtx | null>(null);

export function Modal({
  onClose,
  busy = false,
  width = "lg",
  label,
  describedBy,
  tone = "default",
  layer = "modal",
  initialFocus = true,
  closeOnEscape = true,
  className,
  children,
}: {
  onClose: () => void;
  /** Идёт работа — Escape, щелчок мимо и крестик не закрывают окно. */
  busy?: boolean;
  width?: keyof typeof WIDTH;
  /** Подпись для скринридера, если в окне нет `ModalHeader`. */
  label?: string;
  /** id текста, поясняющего окно, — у подтверждений это вопрос целиком. */
  describedBy?: string;
  /** Кант цветом риска — у подтверждений опасных действий. */
  tone?: "default" | "danger" | "warning";
  /** `confirm` — над всеми окнами: подтверждение спрашивают и из них. */
  layer?: "modal" | "confirm";
  /**
   * Переводить фокус в окно. Отключают, когда фокус ставит само окно —
   * например, на кнопку подтверждения.
   */
  initialFocus?: boolean;
  /**
   * Закрываться по Escape. Выключают, пока внутри открыт свой редактор: там
   * этой клавишей закрываются списки и календарь, и окно уезжало бы с ними.
   */
  closeOnEscape?: boolean;
  /** Доп. классы окна: фиксированная высота и т. п. */
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const titleId = `${id}-title`;
  const panelRef = useRef<HTMLDivElement>(null);
  const downOnBackdrop = useRef(false);
  // Свежие значения для слушателя, который вешается один раз.
  const latest = useRef({ onClose, busy, closeOnEscape });
  useEffect(() => {
    latest.current = { onClose, busy, closeOnEscape };
  });

  useEffect(() => {
    stack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || stack[stack.length - 1] !== id) return;
      const { busy: isBusy, closeOnEscape: canEscape, onClose: close } = latest.current;
      if (!isBusy && canEscape) close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const i = stack.lastIndexOf(id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [id]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    // Поле с `autoFocus` уже забрало фокус — не отнимаем его.
    const t = initialFocus
      ? setTimeout(() => {
          const panel = panelRef.current;
          if (panel && !panel.contains(document.activeElement)) panel.focus();
        }, 30)
      : undefined;
    return () => {
      clearTimeout(t);
      if (prev && document.contains(prev)) prev.focus();
    };
    // Только при открытии и закрытии окна.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div
      className={clsx(
        // Подложка — ровное затемнение без размытия: `backdrop-blur` на весь
        // экран поверх графиков заставлял Chromium на кадр показывать белый
        // фон корня при открытии.
        "fixed inset-0 flex items-center justify-center p-4 bg-black/50 animate-fade",
        layer === "confirm" ? "z-[100]" : "z-[60]"
      )}
      onMouseDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnBackdrop.current && !busy) onClose();
        downOnBackdrop.current = false;
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={label ? undefined : titleId}
        aria-label={label}
        aria-describedby={describedBy}
        className={clsx(
          "w-full flex flex-col max-h-[calc(100dvh-2rem)] rounded-2xl border bg-panel shadow-2xl outline-none",
          WIDTH[width],
          tone === "danger"
            ? "border-expense/40"
            : tone === "warning"
              ? "border-warn/40"
              : "border-border",
          className
        )}
      >
        <Ctx.Provider value={{ titleId, onClose, busy }}>{children}</Ctx.Provider>
      </div>
    </div>,
    document.body
  );
}

const CHIP_TONE = {
  accent: "bg-accent/10 text-accent",
  accent2: "bg-accent2/10 text-accent2",
  expense: "bg-expense/10 text-expense",
  warn: "bg-warn/10 text-warn",
  income: "bg-income/10 text-income",
  muted: "bg-panel2 text-muted",
} as const;

/**
 * Шапка окна. Два вида:
 *
 * - окно действия — плашка 28 со значком, заголовок и строка пояснения;
 * - карточка сущности (правило, счёт, категория) — задан `overline`: плашка
 *   44, над названием подпись типа, шапка на `panel2/50`.
 *
 * `badge` заменяет плашку своей — логотипом счёта, цветом категории.
 */
export function ModalHeader({
  icon: Icon,
  tone = "accent",
  badge,
  overline,
  title,
  subtitle,
  actions,
  children,
}: {
  icon?: LucideIcon;
  tone?: keyof typeof CHIP_TONE;
  badge?: ReactNode;
  overline?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Кнопки и подсказки справа, перед крестиком. */
  actions?: ReactNode;
  /** Сразу за заголовком в той же строке — знак вопроса и т. п. */
  children?: ReactNode;
}) {
  const ctx = useContext(Ctx);
  const entity = overline !== undefined;
  const plate =
    badge ??
    (Icon && (
      <span
        className={clsx(
          "shrink-0 flex items-center justify-center",
          entity ? "w-11 h-11 rounded-xl" : "p-1.5 rounded-lg",
          CHIP_TONE[tone]
        )}
      >
        <Icon className={entity ? "w-5 h-5" : "w-4 h-4"} aria-hidden="true" />
      </span>
    ));
  return (
    <div
      className={clsx(
        "shrink-0 flex items-center gap-3 px-5 py-4 border-b border-border rounded-t-2xl",
        entity && "bg-panel2/50"
      )}
    >
      {plate}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          {/* Имя окна для скринридера — подпись типа и название вместе:
              «Заполнение бюджета, сентябрь 2026», а не один месяц. */}
          <div id={ctx?.titleId} className="min-w-0">
            {entity && (
              <div className="text-[11px] uppercase tracking-wider text-muted truncate">{overline}</div>
            )}
            <div className="font-semibold truncate">{title}</div>
          </div>
          {children}
        </div>
        {subtitle && <div className="text-xs text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
      {ctx && (
        <button
          type="button"
          onClick={ctx.onClose}
          disabled={ctx.busy}
          className="btn-icon shrink-0 -mr-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Закрыть"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

const GAP = { 0: "", 2: "space-y-2", 3: "space-y-3", 4: "space-y-4", 5: "space-y-5" } as const;

/**
 * Тело окна: поля 20 / 16, между блоками 16. `scroll` — прокручивается само,
 * шапка и подвал остаются на месте; `list` — поля сверху и снизу 8, для
 * списков, где строки уже со своими полями.
 */
export function ModalBody({
  scroll = false,
  list = false,
  gap = 4,
  className,
  children,
}: {
  scroll?: boolean;
  list?: boolean;
  gap?: keyof typeof GAP;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={clsx(
        "px-5",
        list ? "py-2" : "py-4",
        GAP[gap],
        scroll && "flex-1 min-h-0 overflow-y-auto",
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * Подвал с действиями: главное — справа последним. `between` — когда слева
 * своё: «Удалить», «Назад», итог разбивки.
 */
export function ModalFooter({
  justify = "end",
  className,
  children,
}: {
  justify?: "end" | "between";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={clsx(
        "shrink-0 flex items-center gap-2 px-5 py-4 border-t border-border rounded-b-2xl",
        justify === "between" ? "justify-between" : "justify-end",
        className
      )}
    >
      {children}
    </div>
  );
}
