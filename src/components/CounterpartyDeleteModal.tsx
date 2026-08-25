// «Удалить контрагента» и «Перенести операции» — одно окно на две задачи.
//
// A bare deletion is destructive in a way that isn't obvious: the server
// cascades it onto every referencing operation and nulls BOTH `merchant` and
// the free-text `payee`, and re-attaching the counterparty afterwards brings
// back only the reference — the text is gone for good. So the dialog leads with
// the safe option: move the operations to another counterparty first.
//
// Словарь окна — «контрагент», а не «получатель». Разница в приложении есть:
// «Получатель» — текст, который прислал банк, «Контрагент» — запись справочника.
// Но здесь речь именно о записи справочника и её связи с операцией, и мешать
// два слова в одном окне про контрагента нельзя. Свободный текст банка при
// удалении гибнет вместе со ссылкой — об этом сказано отдельной фразой.
//
// «Перенести» is the same machinery as duplicate merging (buildMerchantMergePush)
// pointed at an arbitrary target rather than a same-named twin — which is also
// what «замена контрагента» means (issue #46).
//
// Тот же перенос нужен и сам по себе, без удаления: «эти операции на самом деле
// вот этого контрагента». Раньше до него добирались только через корзину, и
// догадаться об этом было нельзя. Режим `transfer` — то же окно с убранным
// вариантом «не переносить»: цель обязательна, и кнопка говорит «Перенести».

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, ChevronDown, Combine, X } from "lucide-react";
import clsx from "clsx";
import { useCounterpartyEditsStore } from "../store/useCounterpartyEditsStore";
import { formatNum } from "../lib/format";
import { pluralRu } from "../lib/plural";

/** A counterparty offered as the new home for the deleted one's operations. */
export interface TransferTarget {
  id: string;
  title: string;
  count: number;
}

interface Props {
  /**
   * `delete` — удаление с необязательным переносом; `transfer` — только перенос,
   * запись при этом складывается в выбранную, как при объединении дублей.
   */
  mode?: "delete" | "transfer";
  /** Rows being deleted — one from the trash button, many from the bulk bar. */
  targets: { id: string; title: string; count: number; isNew: boolean }[];
  /** Where the operations may go. Must already exclude the doomed rows. */
  options: TransferTarget[];
  onClose: () => void;
}

export function CounterpartyDeleteModal({
  mode = "delete",
  targets,
  options,
  onClose,
}: Props) {
  const [transferTo, setTransferTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const moving = mode === "transfer";
  const affected = targets.reduce((n, t) => n + t.count, 0);
  const many = targets.length > 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    return () => {
      if (prev && document.contains(prev)) prev.focus();
    };
  }, []);

  async function apply() {
    if (busy) return;
    // В режиме переноса цель обязательна: без неё это было бы удаление, а его
    // человек здесь не просил.
    if (moving && !transferTo) return;
    setBusy(true);
    const store = useCounterpartyEditsStore.getState();
    // An unpushed draft has no cloud row and no operations — it's just dropped,
    // never merged (merging it would point operations at a row that isn't there).
    const drafts = targets.filter((t) => t.isNew);
    const cached = targets.filter((t) => !t.isNew);
    for (const d of drafts) await store.remove(d.id);
    if (transferTo) {
      await store.mergeMany(
        cached.map((t) => ({ id: t.id, survivorId: transferTo }))
      );
    } else {
      for (const t of cached) await store.remove(t.id);
    }
    onClose();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cp-del-title"
        className="w-full max-w-md rounded-2xl border border-border bg-panel shadow-2xl outline-none"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border rounded-t-2xl">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={clsx(
                "p-1.5 rounded-lg shrink-0",
                moving ? "bg-accent/10 text-accent" : "bg-expense/10 text-expense"
              )}
            >
              {moving ? <Combine className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            </span>
            <div className="min-w-0">
              <div id="cp-del-title" className="font-semibold truncate">
                {moving
                  ? "Перенести операции?"
                  : many
                    ? `Удалить ${formatNum(targets.length)} ${pluralRu(targets.length, ["контрагента", "контрагента", "контрагентов"])}?`
                    : "Удалить контрагента?"}
              </div>
              <div className="text-xs text-muted truncate">
                {many
                  ? targets.map((t) => t.title).join(", ")
                  : targets[0]?.title}
              </div>
            </div>
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

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="label block mb-1">
              {affected > 0 ? (
                <>
                  Куда перенести {formatNum(affected)}{" "}
                  {pluralRu(affected, ["операцию", "операции", "операций"])}
                </>
              ) : moving ? (
                "Куда перенести"
              ) : (
                "Куда переносить операции"
              )}
            </label>
            <TransferSelect
              value={transferTo}
              options={options}
              allowNone={!moving}
              onChange={setTransferTo}
            />
            {moving ? (
              <p className="text-xs text-muted mt-1">
                {affected === 0
                  ? "Операций у контрагента нет — переедет одна запись справочника. "
                  : `Контрагент сменится у ${formatNum(affected)} ${pluralRu(affected, ["операции", "операций", "операций"])}. `}
                Запись «{targets[0]?.title}» после переноса исчезнет из справочника: в
                Дзен-мани перенос — это объединение двух записей в одну.
              </p>
            ) : affected === 0 ? (
              <p className="text-xs text-muted mt-1">
                {many ? "У выбранных контрагентов нет операций" : "Операций у контрагента нет"}
                {" "}— переносить нечего.
              </p>
            ) : transferTo === null ? (
              <p className="text-xs text-warn mt-1">
                У {formatNum(affected)}{" "}
                {pluralRu(affected, ["операции", "операций", "операций"])} очистится
                контрагент — вместе с текстом, который прислал банк. После отправки
                в облако это не отменить.
              </p>
            ) : (
              <p className="text-xs text-muted mt-1">
                Операции переедут на выбранного контрагента — связь со справочником
                сохранится. Эти записи удалятся.
              </p>
            )}
          </div>

          <p className="text-xs text-muted">
            Правка копится локально и уйдёт в Дзен-мани при отправке в облако — до
            этого момента её можно отменить.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border rounded-b-2xl">
          <button type="button" onClick={onClose} className="btn-ghost text-sm">
            Отмена
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={busy || (moving && !transferTo)}
            className={clsx(
              "text-sm",
              transferTo || moving ? "btn-primary" : "btn-danger",
              moving && !transferTo && "opacity-40 cursor-not-allowed"
            )}
          >
            {moving ? "Перенести" : transferTo ? "Перенести и удалить" : "Удалить"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Counterparty picker in the app's style, defaulting to «не переносить».
 *  Searchable — a real dictionary runs to hundreds of rows. */
function TransferSelect({
  value,
  options,
  allowNone,
  onChange,
}: {
  value: string | null;
  options: TransferTarget[];
  /** Есть ли вариант «не переносить». При чистом переносе цель обязательна. */
  allowNone: boolean;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const current = useMemo(
    () => (value ? options.find((o) => o.id === value) ?? null : null),
    [value, options]
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? options.filter((o) => o.title.toLowerCase().includes(q)) : options;
    return list.slice(0, 200); // the dropdown is a picker, not a directory
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="input h-10 flex items-center justify-between gap-2 w-full text-left"
      >
        <span className={clsx("truncate text-sm", !current && "text-muted")}>
          {current
            ? current.title
            : allowNone
              ? "— не переносить, очистить контрагента —"
              : "— выберите контрагента —"}
        </span>
        <ChevronDown
          className={clsx(
            "w-4 h-4 text-muted shrink-0 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-30 mt-2 border border-border rounded-lg bg-panel p-1 shadow-xl">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск контрагента…"
            autoFocus
            className="input w-full text-sm mb-1"
          />
          <div className="max-h-56 overflow-y-auto">
            {allowNone && (
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className={clsx(
                  "w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm text-left",
                  value === null ? "bg-accent/10 text-accent" : "text-muted hover:bg-panel2"
                )}
              >
                <span className="truncate">— не переносить, очистить контрагента —</span>
                {value === null && <Check className="w-3.5 h-3.5 shrink-0" />}
              </button>
            )}
            {shown.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
                className={clsx(
                  "w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm text-left",
                  value === o.id ? "bg-accent/10 text-accent" : "text-text hover:bg-panel2"
                )}
              >
                <span className="truncate">{o.title}</span>
                <span className="text-muted tabular-nums text-xs shrink-0">
                  {o.count || "—"}
                </span>
              </button>
            ))}
            {shown.length === 0 && (
              <div className="text-sm text-muted py-3 text-center">Ничего не найдено.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
