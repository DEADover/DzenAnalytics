import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Scale,
  Lock,
  Archive,
  ChevronDown,
  Check,
  Percent,
} from "lucide-react";
import clsx from "clsx";
import type { LiveAccount } from "../store/useZenmoneyStore";
import { useAccountEditsStore, type AccountEdit } from "../store/useAccountEditsStore";
import { ACCOUNT_KINDS, accountKindLabel } from "../lib/accountType";
import type { ZenTermUnit } from "../lib/zenmoney";
import { formatMoney } from "../lib/format";
import { AccountLogo } from "./AccountLogo";
import { DateField } from "./DateField";

/** Единицы срока в том виде, в каком их принимает Дзен-мани. */
const TERM_UNITS: { value: ZenTermUnit; label: string }[] = [
  { value: "day", label: "Дней" },
  { value: "month", label: "Месяцев" },
  { value: "year", label: "Лет" },
];

/**
 * Начисление процентов. В API это пара (payoffStep, payoffInterval) — у всех
 * реальных вкладов тестового аккаунта это «1 раз в month». «В конце срока»
 * выражается тем же шагом, что и сам срок.
 */
type PayoffKind = "month" | "quarter" | "year" | "end";
const PAYOFF_OPTIONS: { value: PayoffKind; label: string }[] = [
  { value: "month", label: "Ежемесячно" },
  { value: "quarter", label: "Ежеквартально" },
  { value: "year", label: "Раз в год" },
  { value: "end", label: "В конце срока" },
];

function payoffKindOf(
  step: number | null | undefined,
  interval: ZenTermUnit | null | undefined
): PayoffKind {
  if (interval === "year" && step === 1) return "year";
  if (interval === "month" && step === 3) return "quarter";
  if (interval === "month" && step === 1) return "month";
  return "end";
}

/** Обратное преобразование: вид начисления → пара полей API. */
/**
 * Обрезает ввод до двух знаков после запятой прямо во время набора. Деньги в
 * Дзен-мани хранятся до копейки, а «1234.5678» в поле создаёт правку, которой
 * пользователь не делал.
 */
/** Разряды пробелами — как во всех суммах сервиса. Применяем только когда поле
 *  не редактируется: во время набора разделители мешают ставить курсор. */
function groupDigits(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  const neg = t.startsWith("-");
  const [int, frac] = t.replace("-", "").split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0");
  return `${neg ? "-" : ""}${grouped}${frac !== undefined ? "," + frac : ""}`;
}

function limitCents(raw: string): string {
  raw = raw.replace(/[\s\u00A0]/g, "");
  const m = raw.match(/^(-?\d*)([.,](\d{0,2}))?/);
  if (!m) return raw;
  const [, int, frac] = m;
  return frac === undefined ? int : `${int}.${m[3] ?? ""}`;
}

function payoffToApi(
  kind: PayoffKind,
  termValue: number,
  termUnit: ZenTermUnit
): { payoffStep: number; payoffInterval: ZenTermUnit } {
  if (kind === "month") return { payoffStep: 1, payoffInterval: "month" };
  if (kind === "quarter") return { payoffStep: 3, payoffInterval: "month" };
  if (kind === "year") return { payoffStep: 1, payoffInterval: "year" };
  return { payoffStep: termValue || 1, payoffInterval: termUnit };
}

interface Props {
  /** Счёт из локального кэша Дзен-мани. */
  account: LiveAccount;
  /** Текущая неотправленная правка, если она уже есть. */
  pending?: AccountEdit;
  onClose: () => void;
}

/**
 * Редактор счёта — по образцу редактора категории: название, тип, признаки и
 * денежные параметры в одной карточке, правка ложится в накладку и уезжает в
 * облако обычным пушем.
 *
 * Чего здесь намеренно нет:
 *   • текущего баланса — Дзен считает его от начального остатка и операций, а
 *     меняет корректирующей операцией; запись числа напрямую разошлась бы с
 *     облаком;
 *   • валюты — её смена переоценивает всю историю счёта;
 *   • ключей банковской синхронизации — они ломают сопоставление при импорте.
 * Эти значения показаны справкой внизу, чтобы было видно, что они известны,
 * но не редактируются.
 */
export function AccountEditModal({ account, pending, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Стартовые значения: кэш плюс уже накопленная правка.
  const eff = {
    title: pending?.title ?? account.title,
    type: pending?.type ?? account.type,
    inBalance: pending?.inBalance ?? account.inBalance,
    savings: pending?.savings ?? account.savings,
    private: pending?.private ?? account.private,
    archive: pending?.archive ?? account.archive,
    creditLimit: pending?.creditLimit ?? account.creditLimit,
    startBalance: pending?.startBalance ?? account.startBalance,
    startDate:
      pending?.startDate !== undefined ? pending.startDate : account.startDate,
    percent: pending?.percent !== undefined ? pending.percent : account.percent,
    capitalization:
      pending?.capitalization !== undefined
        ? pending.capitalization
        : account.capitalization,
    endDateOffset:
      pending?.endDateOffset !== undefined
        ? pending.endDateOffset
        : account.endDateOffset,
    endDateOffsetInterval:
      pending?.endDateOffsetInterval !== undefined
        ? pending.endDateOffsetInterval
        : account.endDateOffsetInterval,
    payoffStep:
      pending?.payoffStep !== undefined ? pending.payoffStep : account.payoffStep,
    payoffInterval:
      pending?.payoffInterval !== undefined
        ? pending.payoffInterval
        : account.payoffInterval,
  };

  const [title, setTitle] = useState(eff.title);
  const [type, setType] = useState(eff.type);
  const [inBalance, setInBalance] = useState(eff.inBalance);
  const [savings, setSavings] = useState(eff.savings);
  const [isPrivate, setIsPrivate] = useState(eff.private);
  const [archive, setArchive] = useState(eff.archive);
  // Пока поле не в фокусе, показываем сумму с разделителями разрядов.
  const [moneyFocus, setMoneyFocus] = useState<"limit" | "balance" | null>(null);
  const [creditLimit, setCreditLimit] = useState(
    String(Math.round((eff.creditLimit || 0) * 100) / 100)
  );
  // Баланс = начальный остаток + операции (проверено на API Дзен-мани). Правим
  // видимую сумму, а в облако уходит сдвинутый начальный остаток — ровно так же
  // это делает приложение Дзена, и корректирующая операция при этом НЕ создаётся.
  const opsSum = account.balance - account.startBalance;
  const shownBalance = eff.startBalance + opsSum;
  const [balance, setBalance] = useState(
    String(Math.round(shownBalance * 100) / 100)
  );
  const [startDate, setStartDate] = useState(eff.startDate || "");
  const [percent, setPercent] = useState(
    eff.percent == null ? "" : String(eff.percent)
  );
  const [capitalization, setCapitalization] = useState(!!eff.capitalization);
  const [termValue, setTermValue] = useState(
    eff.endDateOffset == null ? "" : String(eff.endDateOffset)
  );
  const [termUnit, setTermUnit] = useState<ZenTermUnit>(
    eff.endDateOffsetInterval ?? "month"
  );
  const [payoff, setPayoff] = useState<PayoffKind>(
    payoffKindOf(eff.payoffStep, eff.payoffInterval)
  );
  // Наши четыре варианта не покрывают всё, что бывает в Дзен-мани (например
  // выплата раз в полгода). Такой график сворачивается в «В конце срока», и
  // без этого флага переименование вклада молча переписало бы его.
  const [payoffTouched, setPayoffTouched] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => panelRef.current?.focus(), 30);
    return () => {
      clearTimeout(t);
      if (prev && document.contains(prev)) prev.focus();
    };
  }, []);

  // Округляем до копейки: 6941.17 − 6941.17 в двоичной арифметике даёт не
  // ноль, и без этого редактор сохранял бы «правку» там, где ничего не меняли.
  const cents = (n: number) => Math.round(n * 100) / 100;
  const numOr = (raw: string, fallback: number) => {
    // Пустое поле — это «не трогали», а не «ноль». Иначе стёртый на секунду
    // баланс уезжает в облако нулём вместе со сдвигом начального остатка.
    const t = raw.trim();
    if (!t) return fallback;
    const n = Number(t.replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  };
  const nextCreditLimit = cents(numOr(creditLimit, account.creditLimit));
  const nextBalance = numOr(balance, shownBalance);
  const nextStartBalance = cents(nextBalance - opsSum);
  const startBalanceChanged = nextStartBalance !== cents(account.startBalance);
  // Вклад и кредит — «срочные» счета: у них Дзен-мани хранит дату открытия,
  // ставку и срок. У остальных видов дата игнорируется.
  const isTermAccount = type === "deposit" || type === "loan";
  // У счёта может стоять вид, которого нет в списке выбора («Долги», «Кошелёк»
  // — их заводит сам Дзен-мани). Добавляем его в список, иначе поле окажется
  // пустым и человек не поймёт, что у него за счёт.
  const currentKind = accountKindLabel(type, savings);
  const kindOptions = ACCOUNT_KINDS.some((k) => k.label === currentKind)
    ? ACCOUNT_KINDS.map((k) => ({ value: k.label, label: k.label }))
    : [
        { value: currentKind, label: currentKind },
        ...ACCOUNT_KINDS.map((k) => ({ value: k.label, label: k.label })),
      ];
  // Перевод обычного счёта во вклад/кредит Дзен-мани отвергнет: он требует
  // ставку, срок, капитализацию и периодичность выплат, а их в редакторе нет.
  // Параметры вклада собираем в один патч: они меняются вместе и вместе же
  // проверяются Дзеном.
  const nextPercent = percent === "" ? null : numOr(percent, 0);
  const nextTerm = termValue === "" ? null : Math.max(1, Math.round(numOr(termValue, 0)));
  const nextPayoff = payoffToApi(payoff, nextTerm ?? 1, termUnit);
  const termPatch: AccountEdit = {
    percent: (nextPercent ?? null) !== (account.percent ?? null) ? nextPercent : undefined,
    // Сравниваем с `?? null`, а не с `!!`: у карты капитализации нет (null), и
    // выключенный тумблер обязан попасть в патч — иначе Дзен-мани отвергнет
    // весь вклад из-за незаполненного поля.
    capitalization:
      capitalization !== (account.capitalization ?? null) ? capitalization : undefined,
    endDateOffset:
      (nextTerm ?? null) !== (account.endDateOffset ?? null) ? nextTerm : undefined,
    endDateOffsetInterval:
      termUnit !== (account.endDateOffsetInterval ?? null) ? termUnit : undefined,
    // Пишем график выплат только если пользователь его выбрал сам, либо у
    // счёта его вообще нет (вклад без этого поля Дзен-мани не примет).
    payoffStep:
      (payoffTouched || account.payoffStep == null) &&
      nextPayoff.payoffStep !== (account.payoffStep ?? null)
        ? nextPayoff.payoffStep
        : undefined,
    payoffInterval:
      (payoffTouched || account.payoffInterval == null) &&
      nextPayoff.payoffInterval !== (account.payoffInterval ?? null)
        ? nextPayoff.payoffInterval
        : undefined,
  };
  // Дзен-мани отвергает вклад и кредит с пустыми параметрами — не даём
  // сохранить заведомо отбиваемую правку.
  const termIncomplete =
    isTermAccount && (!startDate || nextTerm == null || nextPercent == null);
  const canSave = title.trim().length > 0 && !termIncomplete;

  async function save() {
    if (!canSave) return;
    // В накладку кладём только реально изменённые поля: правка «в то же
    // значение» иначе висела бы в очереди отправки и уезжала пустым пушем.
    const patch: AccountEdit = {
      title: title.trim() !== account.title ? title.trim() : undefined,
      type: type !== account.type ? type : undefined,
      inBalance: inBalance !== account.inBalance ? inBalance : undefined,
      savings: savings !== account.savings ? savings : undefined,
      private: isPrivate !== account.private ? isPrivate : undefined,
      archive: archive !== account.archive ? archive : undefined,
      creditLimit:
        nextCreditLimit !== cents(account.creditLimit) ? nextCreditLimit : undefined,
      startBalance: startBalanceChanged ? nextStartBalance : undefined,
      startDate:
        (startDate || null) !== (account.startDate ?? null)
          ? startDate || null
          : undefined,
      ...(isTermAccount ? termPatch : {}),
    };
    await useAccountEditsStore.getState().patch(account.id, patch);
    onClose();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="acc-edit-title"
        className="w-full max-w-md rounded-2xl border border-border bg-panel shadow-2xl outline-none max-h-[90vh] flex flex-col overflow-hidden"
      >
        <div className="shrink-0 flex items-center gap-3 px-5 py-4 bg-panel2/50 border-b border-border rounded-t-2xl">
          <AccountLogo
            title={title || account.title}
            type={type}
            size={44}
            className="rounded-xl shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div
              className="text-[11px] uppercase tracking-wider text-muted"
              id="acc-edit-title"
            >
              {accountKindLabel(type, savings)}
            </div>
            <div className="font-semibold truncate">{title || "Без названия"}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-text shrink-0"
            aria-label="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label htmlFor="acc-name" className="label block mb-1">
              Название
            </label>
            <input
              id="acc-name"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input h-10 text-sm"
              placeholder="Название счёта"
              autoComplete="off"
            />
          </div>

          {/* Денежные поля — `type="text"` с числовой клавиатурой: у
              `type="number"` браузер молча стирает значение, как только в нём
              появляется запятая, а её набирают постоянно. */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="acc-limit" className="label block mb-1">
                Кредитный лимит ({account.currency})
              </label>
              <input
                id="acc-limit"
                type="text"
                inputMode="decimal"
                value={moneyFocus === "limit" ? creditLimit : groupDigits(creditLimit)}
                onFocus={() => setMoneyFocus("limit")}
                onBlur={() => setMoneyFocus(null)}
                onChange={(e) => setCreditLimit(limitCents(e.target.value))}
                className="input h-10 text-sm font-mono tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="acc-balance" className="label block mb-1">
                Баланс ({account.currency})
              </label>
              <input
                id="acc-balance"
                type="text"
                inputMode="decimal"
                value={moneyFocus === "balance" ? balance : groupDigits(balance)}
                onFocus={() => setMoneyFocus("balance")}
                onBlur={() => setMoneyFocus(null)}
                onChange={(e) => setBalance(limitCents(e.target.value))}
                className="input h-10 text-sm font-mono tabular-nums"
              />
            </div>
          </div>

          <div>
            <div className="label mb-1">Вид счёта</div>
            {/* Вид — это пара (type, savings): «Накопительный счёт» в Дзен-мани
                хранится как обычный счёт с признаком накопительного, поэтому
                отдельного переключателя «Накопительный» здесь нет. */}
            <Select
              value={accountKindLabel(type, savings)}
              options={kindOptions}
              onChange={(label) => {
                const k = ACCOUNT_KINDS.find((x) => x.label === label);
                if (!k) return;
                setType(k.type);
                setSavings(k.savings);
              }}
            />
          </div>

          {isTermAccount && (
            <div className="rounded-lg border border-border bg-panel2/40 p-3">
              {/* Заголовок раздела НЕ `.label`: рядом сразу идёт подпись поля
                  того же вида, и два одинаковых мелких капса читались как одна
                  двухстрочная надпись. Даём другой вес, размер и отбивку. */}
              <div className="text-sm font-semibold mb-3 pb-2 border-b border-border">
                Параметры {type === "loan" ? "кредита" : "вклада"}
              </div>
              <div className="space-y-3">
              {/* Дату открытия Дзен-мани хранит только у этих двух видов —
                  проверено на API: у наличных запрос проходит, а значение
                  возвращается пустым. */}
              <div>
                <div className="label mb-1">Дата открытия</div>
                {/* `.input` на самой кнопке: без него поле не отличается от
                    фона и читается как подпись, а не как поле ввода. */}
                <DateField
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="input h-10 w-full text-sm"
                />
              </div>
              <div className="flex items-end gap-3">
                <div className="flex-1 min-w-0">
                  <label htmlFor="acc-term" className="label block mb-1">
                    Срок
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="acc-term"
                      type="text"
                      inputMode="numeric"
                      value={termValue}
                      onChange={(e) => setTermValue(e.target.value.replace(/[^\d]/g, ""))}
                      className="input h-10 w-20 shrink-0 text-sm font-mono tabular-nums"
                    />
                    <Select
                      value={termUnit}
                      options={TERM_UNITS}
                      onChange={setTermUnit}
                      className="flex-1 min-w-0"
                    />
                  </div>
                </div>
                <div className="w-24 shrink-0">
                  <label htmlFor="acc-percent" className="label block mb-1">
                    Ставка (%)
                  </label>
                  <input
                    id="acc-percent"
                    type="text"
                    inputMode="decimal"
                    value={percent}
                    onChange={(e) => setPercent(limitCents(e.target.value))}
                    className="input h-10 text-sm font-mono tabular-nums"
                  />
                </div>
              </div>
              <div>
                <div className="label mb-1">Начисление процентов</div>
                <Select
                  value={payoff}
                  options={PAYOFF_OPTIONS}
                  onChange={(v) => {
                    setPayoff(v);
                    setPayoffTouched(true);
                  }}
                />
              </div>
                <FlagRow
                  icon={<Percent className="w-4 h-4" />}
                  label="Капитализация процентов"
                  hint="Проценты добавляются к сумме вклада"
                  on={capitalization}
                  onToggle={() => setCapitalization((v) => !v)}
                />
                {/* 11. Подсказка стоит вплотную к полям, к которым относится,
                    и жёлтая: это «не заполнено», а не ошибка. */}
                {termIncomplete && (
                  <p className="text-xs text-warn">
                    Заполните дату открытия, срок и ставку — Дзен-мани не
                    принимает вклад и кредит без них.
                  </p>
                )}
              </div>
            </div>
          )}


          <div>
            <div className="label mb-1">Признаки</div>
            <div className="space-y-1.5">
              <FlagRow
                icon={<Scale className="w-4 h-4" />}
                label="Учитывать в балансе"
                hint="Счёт входит в совокупный баланс"
                on={inBalance}
                onToggle={() => setInBalance((v) => !v)}
              />
              <FlagRow
                icon={<Lock className="w-4 h-4" />}
                label="Личный"
                hint="Скрыт из общего доступа в Дзен-мани"
                on={isPrivate}
                onToggle={() => setIsPrivate((v) => !v)}
              />
              <FlagRow
                icon={<Archive className="w-4 h-4" />}
                label="Архивный"
                hint="Счёт закрыт, уходит в конец списка"
                on={archive}
                onToggle={() => setArchive((v) => !v)}
              />
            </div>
          </div>

          {/* Что известно, но не правится здесь — чтобы не искать это в другом
              месте и не гадать, почему поля нет. */}
          <div className="rounded-lg border border-border bg-panel2/40 px-3 py-2 space-y-1 text-xs text-muted">
            <div className="label pb-1">Прочие данные (не редактируются)</div>
            <div className="flex justify-between gap-3">
              <span>Начальный остаток</span>
              <span className="tabular-nums text-text">
                {formatMoney(nextStartBalance, account.currency)}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Сумма операций</span>
              <span className="tabular-nums text-text">
                {formatMoney(opsSum, account.currency, { signed: true })}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Валюта</span>
              <span className="text-text">{account.currency}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Банк</span>
              <span className="text-text">{account.bank ?? "не указан"}</span>
            </div>
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-2 px-5 py-4 border-t border-border rounded-b-2xl">
          <button type="button" onClick={onClose} className="btn-ghost text-sm ml-auto">
            Отмена
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="btn-primary text-sm"
          >
            Сохранить
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Пикер в стиле остальных полей сервиса: строка `.input` с текущим значением и
 * раскрывающийся список. Один компонент на вид счёта, срок и начисление
 * процентов — иначе три соседних поля выглядели бы тремя разными элементами.
 */
function Select<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value)?.label ?? "";
  return (
    <div className={clsx("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="input h-10 flex items-center justify-between gap-2 w-full text-left"
      >
        <span className="truncate text-sm">{current}</span>
        <ChevronDown
          className={clsx(
            "w-4 h-4 text-muted shrink-0 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-2 border border-border rounded-lg bg-panel p-1 shadow-xl min-w-max"
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={clsx(
                "w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm text-left whitespace-nowrap",
                o.value === value ? "bg-accent/10 text-accent" : "text-text hover:bg-panel2"
              )}
            >
              <span>{o.label}</span>
              {o.value === value && <Check className="w-3.5 h-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Строка-переключатель признака: подпись с пояснением слева, тумблер справа. */
function FlagRow({
  icon,
  label,
  hint,
  on,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      role="switch"
      aria-checked={on}
      className={clsx(
        "w-full flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
        on
          ? "border-accent bg-accent/10"
          : "border-border hover:bg-panel2/60"
      )}
    >
      <span className={clsx("shrink-0", on ? "text-accent" : "text-muted")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{label}</span>
        <span className="block text-xs text-muted truncate">{hint}</span>
      </span>
      <span
        className={clsx(
          "w-9 h-5 rounded-full shrink-0 relative transition-colors",
          on ? "bg-accent" : "bg-panel2 border border-border"
        )}
      >
        <span
          className={clsx(
            "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all",
            on ? "left-[18px]" : "left-0.5"
          )}
        />
      </span>
    </button>
  );
}
