import type { PlannedOp } from "../../lib/plannedOps";
import { useColumnResize, type ResizeColumn } from "../../hooks/useColumnResize";
import { ListHeadCell, OperationListHead } from "./OperationList";
import { PlannedFeedList } from "./PlannedFeedSection";

/**
 * Колонки таблицы планов — те же, что у ленты «Операций» по дням, только
 * действий одна кнопка «⋯». Своя ширина столбцов — своя, отдельно от ленты:
 * здесь нет даты в строке и узкая колонка действий.
 */
const PLAN_COLUMNS: ResizeColumn[] = [
  { key: "select", size: "20px", resizable: false },
  { key: "category", label: "Категория", size: "minmax(0, 1.3fr)" },
  { key: "account", label: "Счёт", size: "minmax(0, 1fr)" },
  { key: "payee", label: "Контрагент", size: "minmax(0, 1.3fr)" },
  { key: "comment", label: "Комментарий", size: "minmax(0, 2.6fr)" },
  { key: "amount", label: "Сумма", size: "140px" },
  { key: "actions", size: "88px", resizable: false },
];

/**
 * Планы Дзен-мани таблицей — для «Регулярных платежей».
 *
 * Та же лента, что «Запланированные» в «Операциях» (`PlannedFeedList`):
 * разделы «Просрочено» и «Предстоящие», шапки дней с итогами, приглушённые
 * будущие и подсвеченные просроченные строки, у каждой — меню «⋯» с теми же
 * действиями: сохранить как факт, связать, изменить, удалить дату или
 * цепочку. Раньше здесь была своя таблица, где с планом можно было только
 * удалить просроченную дату.
 */
export function PlannedOpsTable({ ops, emptyText }: { ops: PlannedOp[]; emptyText?: string }) {
  const resize = useColumnResize("recurring-plans", PLAN_COLUMNS, { mode: "grid" });
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <OperationListHead template={resize.template} pinnable={false}>
        <span />
        {PLAN_COLUMNS.filter((c) => c.label).map((c) => (
          <ListHeadCell
            key={c.key}
            col={c.key}
            resize={c.key === "amount" ? undefined : resize.handle(c.key)}
            className={c.key === "amount" ? "text-right" : undefined}
          >
            {c.label}
          </ListHeadCell>
        ))}
        <div className="text-center">Действия</div>
      </OperationListHead>
      <PlannedFeedList template={resize.template} grouped ops={ops} emptyText={emptyText} />
    </div>
  );
}
