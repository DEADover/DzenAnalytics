import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ShieldOff, X, Search, Trash2 } from "lucide-react";
import { useDuplicateExclusionsStore } from "../store/useDuplicateExclusionsStore";
import { confirm } from "../store/useConfirmStore";
import { formatMoney } from "../lib/format";
import { kindLabel } from "../lib/txKindStyle";

/**
 * Manage the «не дубликаты» exclusion rules. A modal (not an inline list) so a
 * long list scrolls on its own and stays searchable. Mirrors the app's modal
 * shell (portal + solid scrim, Esc / backdrop close).
 */
export function DuplicateExclusionsModal({ onClose }: { onClose: () => void }) {
  const rules = useDuplicateExclusionsStore((s) => s.rules);
  const remove = useDuplicateExclusionsStore((s) => s.remove);
  const clearAll = useDuplicateExclusionsStore((s) => s.clearAll);
  const [search, setSearch] = useState("");
  const backdropMouseDownRef = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const arr = Object.values(rules).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
    if (!q) return arr;
    return arr.filter(
      (r) =>
        (r.payee || "без получателя").toLowerCase().includes(q) ||
        (r.category || "").toLowerCase().includes(q) ||
        String(Math.round(r.amount)).includes(q)
    );
  }, [rules, search]);

  const total = Object.keys(rules).length;

  async function handleClearAll() {
    const ok = await confirm({
      title: "Удалить все исключения?",
      message: `Все ${total} правил «не дубликаты» будут удалены — отмеченные группы снова начнут проверяться.`,
      confirmLabel: "Удалить все",
      tone: "danger",
    });
    if (ok) await clearAll();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => {
        backdropMouseDownRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && backdropMouseDownRef.current) onClose();
        backdropMouseDownRef.current = false;
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-2xl max-h-[85vh] flex flex-col"
        style={{ scrollbarGutter: "stable" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="font-semibold flex items-center gap-2">
            <ShieldOff className="w-4 h-4 text-muted" />
            Исключения «не дубликаты»
            <span className="text-muted font-normal">({total})</span>
          </div>
          <button onClick={onClose} className="text-muted hover:text-text" aria-label="Закрыть">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-border shrink-0 flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по получателю или сумме"
              className="input pl-9 text-sm"
              autoFocus
            />
          </div>
          {total > 0 && (
            <button onClick={handleClearAll} className="btn-ghost text-xs text-expense whitespace-nowrap">
              <Trash2 className="w-3.5 h-3.5" />
              Очистить все
            </button>
          )}
        </div>

        <div className="overflow-y-auto px-5 py-2 flex-1">
          {total === 0 ? (
            <div className="text-center text-muted text-sm py-10">
              Пока нет исключений. Отметьте группу «Не дубликаты» на странице — правило
              появится здесь.
            </div>
          ) : list.length === 0 ? (
            <div className="text-center text-muted text-sm py-10">
              По запросу ничего не найдено.
            </div>
          ) : (
            <table className="w-full text-base">
              <thead>
                <tr>
                  <th className="table-th">Получатель</th>
                  <th className="table-th">Тип</th>
                  <th className="table-th">Категория</th>
                  <th className="table-th text-right">Сумма</th>
                  <th className="table-th text-right whitespace-nowrap">Действия</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.signature} className="align-middle">
                    <td className="table-td max-w-[240px] truncate" title={r.payee || "Без получателя"}>
                      {r.payee || "Без получателя"}
                    </td>
                    <td className="table-td text-muted whitespace-nowrap capitalize">{kindLabel(r.kind)}</td>
                    <td className="table-td max-w-[200px] truncate text-muted" title={r.category || ""}>
                      {r.category || "—"}
                    </td>
                    <td className="table-td text-right tabular-nums whitespace-nowrap">
                      {formatMoney(r.amount, r.currency)}
                    </td>
                    <td className="table-td text-right">
                      <button
                        onClick={() => remove(r.signature)}
                        className="p-1 text-muted hover:text-expense shrink-0"
                        title="Удалить правило — снова проверять эту группу"
                        aria-label="Удалить правило"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
