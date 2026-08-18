import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, BadgeCheck, BadgePlus, Check, X } from "lucide-react";
import { Combobox } from "./Combobox";
import { CategoryCascadePicker, type CategoryNode } from "./CategoryCascadePicker";
import { DateField } from "./DateField";
import { Segmented } from "./Segmented";
import { NO_CATEGORY } from "../lib/zenmoneyMap";
import { OP_TYPES, type OpTypeLabel } from "../lib/importTemplate";
import { kindOf, retype, type ParsedRow, type RowVerdict } from "../lib/importRows";

/**
 * Правка одной строки прямо в отчёте проверки.
 *
 * Раньше единственным ответом на опечатку было «поправьте файл и загрузите
 * заново»: из-за одной перепутанной категории человек уходил в Excel, искал там
 * строку по номеру и проходил проверку заново — ради буквы. Здесь та же строка
 * правится на месте, теми же пикерами, что и форма создания операции, поэтому
 * выбрать несуществующую категорию или счёт попросту нечем.
 *
 * Файл при этом не меняется — правка живёт только в отчёте. Иначе пришлось бы
 * или переписывать книгу пользователя, или врать ему, что она переписана.
 *
 * Поля показываются те же и в том же порядке, что колонки шаблона: человек
 * пришёл сюда из таблицы и ищет глазами знакомое. Смена типа переставляет их
 * (`retype`): счёт переезжает из «списания» в «зачисление» и обратно, лишнее
 * снимается — иначе переключение тут же отбивало бы строку остатками прежнего.
 */
export function ImportRowEditor({
  row,
  accounts,
  payees,
  categories,
  check,
  payeeStatus,
  onSave,
  onCancel,
}: {
  row: ParsedRow;
  /** Названия живых счетов — выбор только из них. */
  accounts: string[];
  /** Контрагенты из справочника; свой вписать можно. */
  payees: string[];
  /** Дерево категорий для каскадного пикера, первым пунктом «Без категории». */
  categories: CategoryNode[];
  /** Тот же разбор, что судит строки файла, — вердикт виден сразу при правке. */
  check: (row: ParsedRow) => RowVerdict;
  /** Есть ли контрагент в справочнике: имя можно вписать своё, и это не ошибка. */
  payeeStatus: (name: string) => "none" | "existing" | "new";
  onSave: (row: ParsedRow) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ParsedRow>(row);
  const [amountText, setAmountText] = useState(numText(row.amount));
  const [incomeText, setIncomeText] = useState(numText(row.incomeAmount));

  const set = (patch: Partial<ParsedRow>) => setDraft((d) => ({ ...d, ...patch }));

  const verdict = useMemo(() => check(draft), [check, draft]);
  const kind = kindOf(draft.type);
  const isTransfer = kind === "transfer";
  const toAccount = kind === "income" || kind === "refund" || isTransfer;

  // Категория хранится полным путём («Еда / Кафе»), а пикер работает парой
  // «категория + подкатегория» — разбираем и собираем на лету, без второго
  // состояния, которое пришлось бы держать в согласии с первым.
  const path = draft.category.split(/\s*\/\s*/).filter(Boolean);
  const pickCategory = draft.category ? (path[0] ?? "") : NO_CATEGORY;
  const pickSub = path.slice(1).join(" / ");

  return (
    <div className="px-4 py-3 bg-panel2/40 border-l-2 border-accent space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <Segmented
          size="sm"
          label="Тип операции"
          // Непонятную подпись из файла не подменяем похожей: ни одна кнопка не
          // подсвечена, а вердикт под полями называет причину словами.
          value={draft.type as OpTypeLabel}
          // Смена типа переставляет поля: счёт переезжает следом, лишнее для
          // нового типа снимается — иначе строка отбилась бы остатками прежнего.
          onChange={(t) => setDraft((d) => retype(d, t))}
          options={OP_TYPES.map((t) => ({ value: t, label: t }))}
        />
        <span className="text-xs text-muted">
          Правка живёт в этом отчёте — ваш файл остаётся прежним
        </span>
      </div>

      <div className={isTransfer ? "grid grid-cols-4 gap-3" : "grid grid-cols-3 gap-3"}>
        <Field label="Дата">
          <DateField
            value={draft.date}
            onChange={(e) => set({ date: e.target.value })}
            className="input text-sm w-full"
          />
        </Field>
        <Field label="Время">
          <input
            type="time"
            value={draft.time}
            onChange={(e) => set({ time: e.target.value })}
            aria-label="Время операции"
            className="input text-sm w-full"
          />
        </Field>
        <Field label="Сумма">
          <input
            value={amountText}
            onChange={(e) => {
              setAmountText(e.target.value);
              set({ amount: parseNum(e.target.value) });
            }}
            inputMode="decimal"
            aria-label="Сумма"
            className="input text-sm w-full font-mono tabular-nums"
          />
        </Field>
        {isTransfer && (
          <Field label="Сумма зачисления">
            <input
              value={incomeText}
              onChange={(e) => {
                setIncomeText(e.target.value);
                set({ incomeAmount: parseNum(e.target.value) });
              }}
              inputMode="decimal"
              placeholder="если валюты разные"
              aria-label="Сумма зачисления"
              className="input text-sm w-full font-mono tabular-nums"
            />
          </Field>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {isTransfer ? (
          <Field label="Счёт списания">
            <Combobox
              value={draft.outAccount}
              options={accounts}
              onChange={(v) => set({ outAccount: v })}
              allowCustom={false}
              searchable
              portal
              placeholder="Откуда"
            />
          </Field>
        ) : (
          <Field label="Категория">
            <CategoryCascadePicker
              category={pickCategory}
              subcategory={pickSub}
              categories={categories}
              portal
              onChange={(cat, sub) =>
                set({
                  category:
                    cat === NO_CATEGORY ? "" : sub ? `${cat} / ${sub}` : cat,
                })
              }
            />
          </Field>
        )}
        <Field label={toAccount ? "Счёт зачисления" : "Счёт списания"}>
          <Combobox
            value={toAccount ? draft.inAccount : draft.outAccount}
            options={accounts}
            onChange={(v) => set(toAccount ? { inAccount: v } : { outAccount: v })}
            allowCustom={false}
            searchable
            portal
            placeholder="Выберите счёт"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Контрагент"
          note={
            payeeStatus(draft.payee) === "existing" ? (
              <span className="inline-flex items-center gap-1 text-income normal-case tracking-normal">
                <BadgeCheck className="w-3.5 h-3.5" />
                Есть в справочнике
              </span>
            ) : payeeStatus(draft.payee) === "new" ? (
              <span className="inline-flex items-center gap-1 text-accent normal-case tracking-normal">
                <BadgePlus className="w-3.5 h-3.5" />
                Новый — заведём в справочнике
              </span>
            ) : undefined
          }
        >
          {/* Свободный ввод — это и есть способ завести нового: имя, которого
              нет в справочнике, не ошибка, а запись, которой пока нет. */}
          <Combobox
            value={draft.payee}
            options={payees}
            onChange={(v) => set({ payee: v })}
            searchable
            portal
            placeholder="Необязательно"
          />
        </Field>
        <Field label="Комментарий">
          <input
            value={draft.comment}
            onChange={(e) => set({ comment: e.target.value })}
            aria-label="Комментарий"
            className="input text-sm w-full"
          />
        </Field>
      </div>

      <div className="flex items-center justify-between gap-3">
        {verdict.ok ? (
          <span className="text-xs text-income flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 shrink-0" />
            Готово к созданию
          </span>
        ) : (
          <span className="text-xs text-expense flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
            {verdict.reason}
          </span>
        )}
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={onCancel} className="btn-ghost text-sm">
            <X className="w-4 h-4" />
            Отмена
          </button>
          <button
            type="button"
            onClick={() => onSave(draft)}
            className="btn-primary text-sm"
          >
            <Check className="w-4 h-4" />
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  note,
  children,
}: {
  label: string;
  /** Пометка справа от ярлыка — состояние поля, а не его подпись. */
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1 min-w-0">
        <div className="label">{label}</div>
        {note && <div className="text-[11px] truncate">{note}</div>}
      </div>
      {children}
    </div>
  );
}

/** Число в поле ввода: пусто — это «не заполнено», а не ноль. */
function numText(n: number | null): string {
  return n === null ? "" : String(n);
}

/**
 * Ввод суммы → число.
 *
 * Запятая как разделитель — норма для русской раскладки, пробелы приезжают
 * копипастом из той же таблицы. Мусор даёт «не заполнено»: вердикт скажет об
 * этом теми же словами, что и о пустой ячейке.
 */
function parseNum(text: string): number | null {
  const clean = text.replace(/\s/g, "").replace(",", ".");
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}
