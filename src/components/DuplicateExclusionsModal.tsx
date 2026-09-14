import { DataTable } from "./DataTable";
import { useMemo, useState } from "react";
import { ShieldOff, X, Trash2 } from "lucide-react";
import { useDuplicateExclusionsStore } from "../store/useDuplicateExclusionsStore";
import { confirm } from "../store/useConfirmStore";
import { formatMoney } from "../lib/format";
import { kindLabel } from "../lib/txKindStyle";
import { Modal, ModalBody, ModalHeader } from "./Modal";
import { SectionEmpty } from "./SectionEmpty";
import { SearchInput } from "./SearchInput";

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

  return (
    <Modal onClose={onClose} width="2xl">
      <ModalHeader
        icon={ShieldOff}
        tone="muted"
        title="Исключения «не дубликаты»"
        subtitle={`Всего: ${total}`}
      />

      <div className="px-5 py-3 border-b border-border shrink-0 flex items-center gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Поиск по получателю или сумме"
          autoFocus
          className="flex-1"
        />
        {total > 0 && (
          <button onClick={handleClearAll} className="btn-ghost text-xs text-expense whitespace-nowrap">
            <Trash2 className="w-3.5 h-3.5" />
            Очистить все
          </button>
        )}
      </div>

      <ModalBody scroll list gap={0}>
        {total === 0 ? (
          <SectionEmpty variant="inline">
            Пока нет исключений. Отметьте группу «Не дубликаты» на странице — правило
            появится здесь.
          </SectionEmpty>
        ) : list.length === 0 ? (
          <SectionEmpty variant="inline">
            По запросу ничего не найдено.
          </SectionEmpty>
        ) : (
          <DataTable<(typeof list)[number]>
            bare
            fixed
            exportable={false}
            data={list}
            rowKey={(r) => r.signature}
            defaultSortKey="payee"
            columns={[
              {
                key: "payee",
                type: "text",
                label: "Получатель",
                sortValue: (r) => r.payee || "",
                render: (r) => r.payee || "Без получателя",
              },
              {
                key: "kind",
                type: "text",
                muted: true,
                width: "7rem",
                label: "Тип",
                sortValue: (r) => kindLabel(r.kind),
                render: (r) => capitalizeFirst(kindLabel(r.kind)),
              },
              {
                key: "category",
                type: "text",
                muted: true,
                width: "12rem",
                label: "Категория",
                sortValue: (r) => r.category || "",
                render: (r) => r.category || "—",
              },
              {
                key: "amount",
                type: "money",
                width: "8rem",
                label: "Сумма",
                sortValue: (r) => r.amount,
                render: (r) => formatMoney(r.amount, r.currency),
              },
              {
                key: "actions",
                type: "actions",
                width: "6rem",
                label: "Действия",
                render: (r) => (
                  <button
                    onClick={() => remove(r.signature)}
                    className="btn-icon-danger"
                    title="Удалить правило — снова проверять эту группу"
                    aria-label="Удалить правило"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                ),
              },
            ]}
          />
        )}
      </ModalBody>
    </Modal>
  );
}

/** «расход» → «Расход»: вид операции стоит в ячейке самостоятельной подписью. */
function capitalizeFirst(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}
