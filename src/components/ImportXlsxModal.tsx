import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Copy, FileSpreadsheet, X } from "lucide-react";
import clsx from "clsx";
import { Segmented } from "./Segmented";
import { Tooltip } from "./Tooltip";
import { formatMoney, formatNum } from "../lib/format";
import { pluralRu } from "../lib/plural";
import type { ImportPlan, PlanRow } from "../lib/importRows";

/**
 * Отчёт проверки файла — единственное место, где импорт можно остановить.
 *
 * Смысл экрана в том, что до кнопки «Создать» в базу не записано НИЧЕГО. Файл
 * разобран, каждая строка проверена тем же кодом, что собирает операцию из
 * формы, и человек видит: что создастся, что отбито и почему, что подозрительно
 * похоже на уже имеющееся. Нынешний импорт CSV применяет файл молча и через
 * полторы секунды уводит на дашборд — с настоящими операциями в облаке так
 * нельзя.
 */

type Filter = "all" | "ready" | "failed" | "dups";

export function ImportXlsxModal({
  fileName,
  plan,
  seenBefore,
  autoPush,
  onCreate,
  onClose,
}: {
  fileName: string;
  plan: ImportPlan;
  /** Этот файл уже загружали — предупреждаем до, а не после. */
  seenBefore?: { at: string; count: number };
  /** Отправка стоит на «Авто»: спрашиваем, придержать ли её. */
  autoPush: boolean;
  /** Создать отмеченные строки. `hold` — придержать автоотправку. */
  onCreate: (rows: PlanRow[], hold: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<number>>(
    () => new Set(plan.rows.filter((r) => r.picked).map((r) => r.excelRow))
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [hold, setHold] = useState(true);
  const [busy, setBusy] = useState(false);

  const shown = useMemo(() => {
    if (filter === "ready") return plan.rows.filter((r) => r.verdict.ok && !r.verdict.duplicateOf);
    if (filter === "failed") return plan.rows.filter((r) => !r.verdict.ok);
    if (filter === "dups") return plan.rows.filter((r) => r.verdict.ok && r.verdict.duplicateOf);
    return plan.rows;
  }, [plan.rows, filter]);

  const canPick = (r: PlanRow) => r.verdict.ok;
  const chosen = plan.rows.filter((r) => picked.has(r.excelRow) && canPick(r));

  const toggle = (row: PlanRow) => {
    if (!canPick(row)) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(row.excelRow)) next.delete(row.excelRow);
      else next.add(row.excelRow);
      return next;
    });
  };

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
        className="card w-full max-w-5xl max-h-[88vh] flex flex-col"
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
          <label className="flex items-center gap-2 cursor-pointer">
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
              className="accent-accent w-4 h-4"
            />
            Отметить показанные
          </label>
          <span className="tabular-nums">Отмечено: {formatNum(chosen.length)}</span>
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
                <th className="table-th w-10" />
                <th className="table-th w-14 text-right">Строка</th>
                <th className="table-th w-32">Дата</th>
                <th className="table-th w-24">Тип</th>
                <th className="table-th">Категория и счёт</th>
                <th className="table-th w-32 text-right">Сумма</th>
                <th className="table-th w-40">Контрагент</th>
                <th className="table-th w-72">Статус</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const dup = r.verdict.ok ? r.verdict.duplicateOf : undefined;
                return (
                  <tr
                    key={r.excelRow}
                    className={clsx(
                      "border-t border-border/60",
                      !r.verdict.ok && "bg-expense/5",
                      dup && "bg-warn/5"
                    )}
                  >
                    <td className="table-td text-center">
                      <input
                        type="checkbox"
                        checked={picked.has(r.excelRow)}
                        disabled={!canPick(r)}
                        onChange={() => toggle(r)}
                        aria-label={`Строка ${r.excelRow}`}
                        className="accent-accent w-4 h-4"
                      />
                    </td>
                    <td className="table-td text-right tabular-nums text-muted">{r.excelRow}</td>
                    <td className="table-td whitespace-nowrap tabular-nums">
                      {r.date || "—"}
                      {r.time && <span className="text-muted"> {r.time}</span>}
                    </td>
                    <td className="table-td whitespace-nowrap">{r.type || "—"}</td>
                    <td className="table-td">
                      <div className="truncate">{r.category || "—"}</div>
                      <div className="text-xs text-muted truncate">
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
                    <td className="table-td truncate">{r.payee || "—"}</td>
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
                  </tr>
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

/** Валюта строки — её разрешил разбор по счёту, гадать в интерфейсе нечего. */
function currencyOf(row: PlanRow): string {
  return row.verdict.ok ? row.verdict.currency : "";
}

function plural(n: number): string {
  return pluralRu(n, ["операцию", "операции", "операций"]);
}
