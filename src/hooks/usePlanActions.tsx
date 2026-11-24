import { useState } from "react";
import { CalendarCheck, Link2, Pencil, X } from "lucide-react";
import { formatPlanDate as formatShort, planTitle, plannedAsTransaction, type PlannedOp } from "../lib/plannedOps";
import { usePlannedDeletionsStore } from "../store/usePlannedDeletionsStore";
import { toast } from "../store/useToastStore";
import { EditTransactionModal } from "../components/EditTransactionModal";
import { MenuItem } from "../components/MenuItem";
import { Popover } from "../components/Popover";
import { PlanLinkModal } from "../components/operations/PlanLinkModal";
import { PlanEditModal } from "../components/operations/PlanEditModal";

/**
 * Меню запланированной операции и его окна: «Сохранить как факт», «Связать план
 * с фактом», «Изменить», удаление.
 *
 * Одно на всё приложение: им пользуются и строки ленты, и виджет на главной.
 * `overlay` ставится в разметку один раз — там живут меню и окна.
 */
export function usePlanActions() {
  const [menu, setMenu] = useState<{ op: PlannedOp; anchor: HTMLElement } | null>(null);
  const [fact, setFact] = useState<PlannedOp | null>(null);
  const [link, setLink] = useState<PlannedOp | null>(null);
  const [edit, setEdit] = useState<PlannedOp | null>(null);

  // Удаление плана сначала встаёт в очередь на отправку, поэтому окно-вопрос
  // не нужно: «Отменить» на плашке снимает его из очереди (или возвращает
  // прежний выбор, если план там уже стоял).
  async function queueDeletion(p: PlannedOp, wholePlan: boolean, text: string) {
    const store = usePlannedDeletionsStore.getState();
    const before = store.deletions[p.id];
    await store.remove({ id: p.id, wholePlan, date: p.date, title: planTitle(p) });
    toast(text, {
      undo: async () => {
        const cur = usePlannedDeletionsStore.getState();
        if (before) await cur.remove(before);
        else await cur.restore(p.id);
      },
    });
  }

  async function removeDate(p: PlannedOp) {
    const oneOff = p.repeating === false;
    await queueDeletion(p, oneOff, oneOff ? "План удалён" : `План на ${formatShort(p.date)} удалён`);
  }

  async function removeChain(p: PlannedOp) {
    await queueDeletion(p, true, "Цепочка плана удалена");
  }

  const anchorRef = { current: menu?.anchor ?? null };
  const m = menu?.op;

  const overlay = (
    <>
      <Popover
        open={!!menu}
        anchorRef={anchorRef}
        onClose={() => setMenu(null)}
        align="right"
        className="card p-1 w-max text-[13px] [&_button]:py-1"
      >
        {m && (
          <>
            <MenuItem
              icon={CalendarCheck}
              onClick={() => {
                setMenu(null);
                setFact(m);
              }}
            >
              Сохранить как факт
            </MenuItem>
            <MenuItem
              icon={Link2}
              onClick={() => {
                setMenu(null);
                setLink(m);
              }}
            >
              Связать план с фактом
            </MenuItem>
            <MenuItem
              icon={Pencil}
              onClick={() => {
                setMenu(null);
                setEdit(m);
              }}
            >
              Изменить
            </MenuItem>
            <div className="border-t border-border my-1" />
            <MenuItem
              icon={X}
              danger
              onClick={() => {
                setMenu(null);
                void removeDate(m);
              }}
            >
              {m.repeating === false ? "Удалить план" : `Удалить план на ${formatShort(m.date)}`}
            </MenuItem>
            {m.repeating !== false && (
              <MenuItem
                icon={X}
                danger
                onClick={() => {
                  setMenu(null);
                  void removeChain(m);
                }}
              >
                Удалить всю цепочку
              </MenuItem>
            )}
          </>
        )}
      </Popover>

      {fact && (
        <EditTransactionModal
          key={`fact-${fact.id}`}
          template={plannedAsTransaction(fact)}
          planMarker={{ id: fact.id, date: fact.date, title: planTitle(fact) }}
          onClose={() => setFact(null)}
        />
      )}
      {link && <PlanLinkModal plan={link} title={planTitle(link)} onClose={() => setLink(null)} />}
      {edit && <PlanEditModal plan={edit} title={planTitle(edit)} onClose={() => setEdit(null)} />}
    </>
  );

  return {
    openMenu: (op: PlannedOp, anchor: HTMLElement) => setMenu({ op, anchor }),
    /** План, у которого сейчас открыто меню: его строка подсвечена. */
    menuOpId: menu?.op.id ?? null,
    overlay,
  };
}
