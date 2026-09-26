import { useRef, useState } from "react";
import { Copy, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { MAX_SCENARIOS, useWhatIfStore } from "../../store/useWhatIfStore";
import { confirm } from "../../store/useConfirmStore";
import { SectionControls } from "../SectionControls";
import { Segmented } from "../Segmented";
import { Select } from "../Select";
import { Popover } from "../Popover";
import { Tooltip } from "../Tooltip";

const NO_COMPARE = "__none__";

/** 0 — «До FIRE»: горизонт сам тянется до точки FIRE. */
const HORIZONS = [0, 1, 3, 5, 10, 15, 20, 30];

/**
 * Ряд контролов раздела: сохранённые сценарии вкладками, действия с открытым,
 * второй сценарий для сравнения и горизонт прогноза.
 */
export function ScenarioBar({ horizonLabel }: { horizonLabel: (y: number) => string }) {
  const s = useWhatIfStore();
  const active = s.scenarios.find((x) => x.id === s.activeId)!;
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const full = s.scenarios.length >= MAX_SCENARIOS;

  function close() {
    setOpen(false);
    setRenaming(null);
  }

  async function remove() {
    close();
    const ok = await confirm({
      title: `Удалить сценарий «${active.name}»?`,
      message: "Его бегунки и события пропадут на всех устройствах.",
      confirmLabel: "Удалить",
      tone: "danger",
    });
    if (ok) await s.removeScenario(active.id);
  }

  const others = s.scenarios.filter((x) => x.id !== s.activeId);

  return (
    <SectionControls>
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
        <Segmented
          tabs
          label="Сценарий"
          value={s.activeId}
          onChange={(id) => void s.setActive(id)}
          options={s.scenarios.map((x) => ({ value: x.id, label: x.name }))}
        />
        <div ref={anchorRef} className="relative">
          <Tooltip content="Сценарий: новый, копия, переименовать, удалить">
            <button
              type="button"
              className="btn-ghost btn-square-lg"
              aria-label="Действия со сценарием"
              onClick={() => (open ? close() : setOpen(true))}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </Tooltip>
          <Popover open={open} anchorRef={anchorRef} onClose={close} className="w-64 card p-2 shadow-lg">
            {renaming !== null ? (
              <form
                className="space-y-2 p-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  void s.renameScenario(active.id, renaming);
                  close();
                }}
              >
                <label className="label block" htmlFor="whatif-rename">
                  Название сценария
                </label>
                <input
                  id="whatif-rename"
                  autoFocus
                  maxLength={40}
                  className="input text-sm w-full"
                  value={renaming}
                  onChange={(e) => setRenaming(e.target.value)}
                />
                <button type="submit" className="btn-primary w-full text-sm" disabled={!renaming.trim()}>
                  Сохранить
                </button>
              </form>
            ) : (
              <div className="flex flex-col">
                <MenuItem
                  icon={Plus}
                  label="Новый сценарий"
                  disabled={full}
                  onClick={() => {
                    close();
                    void s.addScenario(false);
                  }}
                />
                <MenuItem
                  icon={Copy}
                  label="Копия этого"
                  disabled={full}
                  onClick={() => {
                    close();
                    void s.addScenario(true);
                  }}
                />
                <MenuItem icon={Pencil} label="Переименовать" onClick={() => setRenaming(active.name)} />
                <MenuItem
                  icon={Trash2}
                  label="Удалить"
                  danger
                  disabled={s.scenarios.length <= 1}
                  onClick={() => void remove()}
                />
                {full && (
                  <div className="text-xs text-muted px-2 pt-1.5">
                    Сценариев не больше {MAX_SCENARIOS}.
                  </div>
                )}
              </div>
            )}
          </Popover>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {others.length > 0 && (
          <label className="inline-flex items-center gap-2 text-sm text-muted">
            Сравнить с
            <Select
              className="w-48"
              value={s.compareId ?? NO_COMPARE}
              onChange={(v) => void s.setCompare(v === NO_COMPARE ? null : v)}
              options={[
                { value: NO_COMPARE, label: "Только «Как сейчас»" },
                ...others.map((x) => ({ value: x.id, label: x.name })),
              ]}
              ariaLabel="Второй сценарий на графике"
            />
          </label>
        )}
        <label className="inline-flex items-center gap-2 text-sm text-muted">
          Горизонт
          <Select
            className="w-32"
            value={String(s.assumptions.horizonYears)}
            onChange={(v) => void s.updateAssumptions({ horizonYears: Number(v) })}
            options={HORIZONS.map((y) => ({ value: String(y), label: y === 0 ? "До FIRE" : horizonLabel(y) }))}
            ariaLabel="На сколько лет вперёд"
          />
        </label>
      </div>
    </SectionControls>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: typeof Plus;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full flex items-center gap-2 text-left text-sm px-2 py-1.5 rounded hover:bg-panel2 disabled:opacity-40 disabled:pointer-events-none ${
        danger ? "hover:text-expense" : ""
      }`}
    >
      <Icon className="w-4 h-4 shrink-0 text-muted" />
      {label}
    </button>
  );
}
