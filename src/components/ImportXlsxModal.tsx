import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Copy, FileSpreadsheet, Pencil, UserPlus, X } from "lucide-react";
import clsx from "clsx";
import { Segmented } from "./Segmented";
import { Tooltip } from "./Tooltip";
import { ImportRowEditor } from "./ImportRowEditor";
import type { CategoryNode } from "./CategoryCascadePicker";
import { formatDate, formatMoney, formatNum } from "../lib/format";
import { pluralRu } from "../lib/plural";
import type { ImportPlan, ParsedRow, PlanRow, RowVerdict } from "../lib/importRows";

/**
 * Отчёт проверки файла — единственное место, где импорт можно остановить.
 *
 * Смысл экрана в том, что до кнопки «Создать» в базу не записано НИЧЕГО. Файл
 * разобран, каждая строка проверена тем же кодом, что собирает операцию из
 * формы создания, и человек видит: что создастся, что отбито и почему, что
 * подозрительно похоже на уже имеющееся. Нынешний импорт CSV применяет файл
 * молча и через полторы секунды уводит на дашборд — с настоящими операциями в
 * облаке так нельзя.
 *
 * Отбитую строку тут же и правят: клик по строке открывает редактор, план
 * пересобирается целиком (потому что правка меняет и дубликаты — не только свою
 * строку), счётчики пересчитываются. Файл при этом не трогается.
 */

type Filter = "all" | "ready" | "failed" | "dups";

/** Сколько колонок в таблице — на столько раскрывается строка-редактор. */
const COLUMNS = 10;

/** Списки, между которыми переключается фильтр, — без «Все». */
type Bucket = Exclude<Filter, "all">;

export function ImportXlsxModal({
  fileName,
  plan: initialPlan,
  seenBefore,
  autoPush,
  accounts,
  payees,
  categories,
  check,
  revise,
  payeeStatus,
  onCreate,
  onClose,
}: {
  fileName: string;
  plan: ImportPlan;
  /** Этот файл уже загружали — предупреждаем до, а не после. */
  seenBefore?: { at: string; count: number };
  /** Отправка стоит на «Авто»: спрашиваем, придержать ли её. */
  autoPush: boolean;
  /** Справочники для редактора строки — выбор только из живого. */
  accounts: string[];
  payees: string[];
  categories: CategoryNode[];
  /** Вердикт по одной строке — редактор показывает его прямо при правке. */
  check: (row: ParsedRow) => RowVerdict;
  /** Пересобрать план целиком: правка строки меняет и картину дубликатов. */
  revise: (rows: ParsedRow[]) => ImportPlan;
  /** Есть ли контрагент в справочнике — для пометки «Новый» в редакторе. */
  payeeStatus: (name: string) => "none" | "existing" | "new";
  /** Создать отмеченные строки. `hold` — придержать автоотправку. */
  onCreate: (rows: PlanRow[], hold: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [plan, setPlan] = useState(initialPlan);
  const [picked, setPicked] = useState<Set<number>>(
    () => new Set(initialPlan.rows.filter((r) => r.picked).map((r) => r.excelRow))
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [hold, setHold] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  // Строка, которая СЕЙЧАС сворачивается: держим её в дереве до конца
  // анимации, иначе закрытие было бы мгновенным рывком. Снимаем по
  // `animationend` — обработчиком события, а не эффектом.
  const [closing, setClosing] = useState<number | null>(null);
  const [fixed, setFixed] = useState<Set<number>>(() => new Set());

  // В каком списке строка живёт — решает ПЕРВЫЙ разбор и больше ничто. Иначе
  // строка исчезала бы из «Ошибок» ровно в момент, когда её починили, унося с
  // собой место в списке: человек правит их подряд и должен видеть, где
  // остановился. Счётчики на вкладках при этом честные, текущие.
  const [home] = useState<Map<number, Bucket>>(() => classify(initialPlan));

  // Esc закрывает окно — но только когда не открыт редактор: там этой же
  // клавишей закрываются списки и календарь, и окно уезжало бы вместе с ними.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && editing === null && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, editing, onClose]);

  const shown = useMemo(
    () =>
      filter === "all"
        ? plan.rows
        : plan.rows.filter((r) => home.get(r.excelRow) === filter),
    [plan.rows, filter, home]
  );

  const canPick = (r: PlanRow) => r.verdict.ok;
  const chosen = plan.rows.filter((r) => picked.has(r.excelRow) && canPick(r));

  /** Открыть редактор строки; повторный клик по той же строке — закрыть. */
  const openEditor = (row: number) => {
    if (editing === row) {
      setClosing(row);
      setEditing(null);
      return;
    }
    if (editing !== null) setClosing(editing);
    setEditing(row);
  };

  const closeEditor = () => {
    setClosing(editing);
    setEditing(null);
  };

  const toggle = (row: PlanRow) => {
    if (!canPick(row)) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(row.excelRow)) next.delete(row.excelRow);
      else next.add(row.excelRow);
      return next;
    });
  };

  /**
   * Сохранить правку строки.
   *
   * План пересобирается по ВСЕМ строкам: исправленная сумма может совпасть с
   * соседней строкой (и обе станут дубликатами) или, наоборот, развести
   * прежнюю пару. Пересчитать одну строку значило бы показать счётчики,
   * которым нельзя верить.
   */
  const saveEdit = (next: ParsedRow) => {
    // `PlanRow` — это `ParsedRow` плюс вердикт; разбор всё равно выставляет
    // вердикт и галочку заново, так что старые поля до плана не доезжают.
    const nextPlan = revise(
      plan.rows.map((r) => (r.excelRow === next.excelRow ? next : r))
    );
    const row = nextPlan.rows.find((r) => r.excelRow === next.excelRow);
    setPlan(nextPlan);
    setFixed((prev) => new Set(prev).add(next.excelRow));
    // Починил — значит хочет создать: возвращаем галочку сами. Если строка
    // после правки стала дубликатом или снова отбита — снимаем.
    setPicked((prev) => {
      const s = new Set(prev);
      if (row?.verdict.ok && !row.verdict.duplicateOf) s.add(next.excelRow);
      else s.delete(next.excelRow);
      return s;
    });
    closeEditor();
  };

  /**
   * Контрагенты, которых заведём. Считаем по ОТМЕЧЕННЫМ строкам: снял галочку
   * — контрагент из неё не нужен, и цифра в шапке обязана это учитывать.
   */
  const newPayees = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of chosen) {
      if (r.verdict.ok && r.verdict.newCounterparty) {
        map.set(r.verdict.newCounterparty.id, r.verdict.newCounterparty.title);
      }
    }
    return [...map.values()];
  }, [chosen]);

  const allShownPicked =
    shown.filter(canPick).length > 0 && shown.filter(canPick).every((r) => picked.has(r.excelRow));

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Проверка файла импорта"
        className="card w-full max-w-7xl max-h-[88vh] flex flex-col"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="p-1.5 rounded-lg bg-accent/10 text-accent shrink-0">
              <FileSpreadsheet className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <div className="font-semibold truncate">Проверка файла</div>
              <div className="text-xs text-muted truncate">
                {fileName} · Готово: {formatNum(plan.ready)} · С ошибками:{" "}
                {formatNum(plan.failed)} · Похоже на дубликаты: {formatNum(plan.duplicates)}
                {newPayees.length > 0 && ` · Новых контрагентов: ${formatNum(newPayees.length)}`}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-muted hover:text-text shrink-0"
            aria-label="Закрыть"
            title="Закрыть (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {seenBefore && (
          <div className="px-5 py-2 border-b border-border shrink-0 text-xs text-warn flex items-start gap-2">
            <Copy className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              Этот файл уже загружали {seenBefore.at} — тогда создали{" "}
              {formatNum(seenBefore.count)}{" "}
              {pluralRu(seenBefore.count, ["операцию", "операции", "операций"])}. Похожие строки ниже
              отмечены и по умолчанию сняты.
            </span>
          </div>
        )}

        <div className="flex items-center gap-3 px-5 py-2 border-b border-border shrink-0 text-xs text-muted flex-wrap">
          <span className="tabular-nums">Отмечено: {formatNum(chosen.length)}</span>
          <span className="tabular-nums">
            {fixed.size > 0
              ? `Исправлено: ${formatNum(fixed.size)}`
              : "Нажмите на строку, чтобы исправить"}
          </span>
          <span className="flex-1" />
          <Segmented
            size="sm"
            label="Какие строки показывать"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all" as const, label: `Все (${formatNum(plan.rows.length)})` },
              { value: "ready" as const, label: `Готовые (${formatNum(plan.ready)})` },
              { value: "failed" as const, label: `Ошибки (${formatNum(plan.failed)})` },
              { value: "dups" as const, label: `Дубликаты (${formatNum(plan.duplicates)})` },
            ]}
          />
        </div>

        <div className="overflow-auto grow">
          <table className="w-full" style={{ fontSize: "var(--tbl-font)" }}>
            <thead className="sticky top-0 bg-panel z-10">
              <tr>
                <th className="table-th w-10 text-center">
                  {/* Отметить показанные — там же, где галочки строк: в отдельной
                      строке тулбара эта связь читалась не сразу. */}
                  <input
                    type="checkbox"
                    checked={allShownPicked}
                    ref={(el) => {
                      if (el) {
                        el.indeterminate =
                          !allShownPicked && shown.some((r) => picked.has(r.excelRow));
                      }
                    }}
                    onChange={() =>
                      setPicked((prev) => {
                        const next = new Set(prev);
                        for (const r of shown.filter(canPick)) {
                          if (allShownPicked) next.delete(r.excelRow);
                          else next.add(r.excelRow);
                        }
                        return next;
                      })
                    }
                    aria-label="Отметить показанные строки"
                    title="Отметить показанные строки"
                    className="accent-accent w-4 h-4 align-middle"
                  />
                </th>
                <th className="table-th w-12 text-center">#</th>
                <th className="table-th w-32">Дата</th>
                <th className="table-th w-24">Тип</th>
                <th className="table-th">Категория</th>
                <th className="table-th w-56">Счёт</th>
                <th className="table-th w-32 text-right">Сумма</th>
                <th className="table-th w-40">Контрагент</th>
                <th className="table-th w-72">Статус</th>
                <th className="table-th w-10" />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const dup = r.verdict.ok ? r.verdict.duplicateOf : undefined;
                const open = editing === r.excelRow;
                const shutting = closing === r.excelRow && !open;
                return (
                  <Fragment key={r.excelRow}>
                    <tr
                      onClick={() => openEditor(r.excelRow)}
                      className={clsx(
                        "border-t border-border/60 cursor-pointer hover:bg-panel2/40",
                        !r.verdict.ok && "bg-expense/5",
                        dup && "bg-warn/5",
                        open && "bg-panel2/60"
                      )}
                    >
                      <td className="table-td text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={picked.has(r.excelRow)}
                          disabled={!canPick(r)}
                          onChange={() => toggle(r)}
                          aria-label={`Строка ${r.excelRow}`}
                          className="accent-accent w-4 h-4"
                        />
                      </td>
                      <td className="table-td text-center tabular-nums text-muted">
                        <span className="inline-flex items-center justify-center gap-1">
                          {fixed.has(r.excelRow) && (
                            <Tooltip content="Строка исправлена в отчёте — в вашем файле она осталась прежней">
                              <Pencil className="w-3 h-3 text-accent" />
                            </Tooltip>
                          )}
                          {r.excelRow}
                        </span>
                      </td>
                      <td className="table-td whitespace-nowrap tabular-nums">
                        {r.date ? formatDate(r.date, "full") : "—"}
                        {r.time && <span className="text-muted"> {r.time}</span>}
                      </td>
                      <td className="table-td whitespace-nowrap">{r.type || "—"}</td>
                      <td className="table-td">
                        <div className="truncate">{r.category || "—"}</div>
                      </td>
                      <td className="table-td">
                        {/* У перевода счетов два, и стрелка между ними — самая
                            короткая запись «откуда куда». */}
                        <div className="truncate">
                          {[r.outAccount, r.inAccount].filter(Boolean).join(" → ") || "—"}
                        </div>
                      </td>
                      <td className="table-td text-right tabular-nums whitespace-nowrap">
                        {r.verdict.ok
                          ? formatMoney(r.amount ?? 0, currencyOf(r), { signed: false })
                          : r.amount === null
                            ? "—"
                            : formatNum(r.amount)}
                      </td>
                      <td className="table-td">
                        {r.payee ? (
                          <>
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="truncate">{r.payee}</span>
                              {r.verdict.ok && r.verdict.newCounterparty && (
                                <Tooltip content="Такого контрагента нет в справочнике — заведём запись вместе с операциями">
                                  <span className="shrink-0 text-[11px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">
                                    Новый
                                  </span>
                                </Tooltip>
                              )}
                            </div>
                            {r.verdict.ok && r.verdict.payeeHint && (
                              <div className="text-xs text-muted truncate">
                                Похоже на «{r.verdict.payeeHint}»
                              </div>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="table-td">
                        {!r.verdict.ok ? (
                          <span className="text-expense flex items-start gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>{r.verdict.reason}</span>
                          </span>
                        ) : dup ? (
                          <span className="text-warn">Похожая операция уже есть</span>
                        ) : (
                          <span className="text-income flex items-center gap-1.5">
                            <Check className="w-3.5 h-3.5 shrink-0" />
                            Готово к созданию
                          </span>
                        )}
                      </td>
                      <td className="table-td text-center">
                        <span
                          className={clsx(
                            "inline-flex p-1 rounded-md",
                            open ? "bg-accent/15 text-accent" : "text-muted"
                          )}
                          aria-hidden
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </span>
                      </td>
                    </tr>
                    {(open || shutting) && (
                      <tr className="border-t border-border/60">
                        <td colSpan={COLUMNS} className="p-0">
                          {/* Раскрытие и сворачивание: растим и убираем
                              грид-трек 0fr → 1fr, как у под-статей бюджета.
                              Высоту содержимого знать не нужно — а она тут и
                              неизвестна заранее, у перевода полей больше.
                              Списки пикеров рисуются в портале и из-под
                              `overflow-hidden` не обрезаются. */}
                          <div
                            className={clsx(
                              "grid grid-rows-[1fr]",
                              open
                                ? "animate-row-expand"
                                : "animate-row-collapse pointer-events-none"
                            )}
                            onAnimationEnd={() => shutting && setClosing(null)}
                          >
                            <div className="overflow-hidden">
                              <ImportRowEditor
                                row={r}
                                accounts={accounts}
                                payees={payees}
                                categories={categories}
                                check={check}
                                payeeStatus={payeeStatus}
                                onSave={saveEdit}
                                onCancel={closeEditor}
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {shown.length === 0 && (
            <div className="text-center text-sm text-muted py-10">Таких строк нет</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border shrink-0 space-y-2">
          {autoPush && (
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={hold}
                onChange={(e) => setHold(e.target.checked)}
                className="accent-accent w-4 h-4 mt-0.5"
              />
              <span>
                <span className="text-text">Придержать отправку до моей проверки</span>
                <span className="block text-muted">
                  Отправка стоит на «Авто» — без этого созданные операции уедут в
                  Дзен-мани через пару секунд. Режим переключится на «Вручную», вернуть
                  можно там же.
                </span>
              </span>
            </label>
          )}
          {newPayees.length > 0 && (
            <div className="text-xs text-muted flex items-start gap-2">
              <UserPlus className="w-3.5 h-3.5 shrink-0 mt-0.5 text-accent" />
              <span>
                {/* Единственное место, где полный список виден ДО нажатия:
                    запись в справочнике переживёт отмену импорта труднее, чем
                    операция, и человек вправе увидеть, что именно заведётся. */}
                Заведём в справочнике{" "}
                {pluralRu(newPayees.length, ["контрагента", "контрагентов", "контрагентов"])}:{" "}
                <span className="text-text">{newPayees.slice(0, 6).join(", ")}</span>
                {newPayees.length > 6 && ` и ещё ${formatNum(newPayees.length - 6)}`}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <Tooltip content="Операции появятся в приложении сразу и будут ждать отправки в Дзен-мани. Отменить импорт можно одной кнопкой, пока он не отправлен">
              <span className="text-xs text-muted cursor-help border-b border-dotted border-border">
                Что произойдёт
              </span>
            </Tooltip>
            <div className="flex items-center gap-2">
              <button onClick={onClose} disabled={busy} className="btn-ghost text-sm">
                Отмена
              </button>
              <button
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onCreate(chosen, hold);
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy || chosen.length === 0}
                className="btn-primary text-sm"
              >
                {busy
                  ? "Создаю…"
                  : `Создать ${formatNum(chosen.length)} ${plural(chosen.length)}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Разложить строки по спискам фильтра — один раз, по первому разбору файла. */
function classify(plan: ImportPlan): Map<number, Bucket> {
  const map = new Map<number, Bucket>();
  for (const r of plan.rows) {
    map.set(
      r.excelRow,
      !r.verdict.ok ? "failed" : r.verdict.duplicateOf ? "dups" : "ready"
    );
  }
  return map;
}

/** Валюта строки — её разрешил разбор по счёту, гадать в интерфейсе нечего. */
function currencyOf(row: PlanRow): string {
  return row.verdict.ok ? row.verdict.currency : "";
}

function plural(n: number): string {
  return pluralRu(n, ["операцию", "операции", "операций"]);
}
