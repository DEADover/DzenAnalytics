import { useRef, useState } from "react";
import clsx from "clsx";
import { Copy, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { MAX_SCENARIOS, useWhatIfStore } from "../../store/useWhatIfStore";
import { confirm } from "../../store/useConfirmStore";
import { SectionControls } from "../SectionControls";
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
  const full = s.scenarios.length >= MAX_SCENARIOS;
  const others = s.scenarios.filter((x) => x.id !== s.activeId);

  return (
    <SectionControls>
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
        {/* Вкладки сценариев. У каждой справа своё меню «⋮» — действия с ЭТИМ
            сценарием стоят на нём самом, а не отдельной кнопкой, по которой
            не понять, к какой вкладке она относится. */}
        <div role="tablist" aria-label="Сценарий" className="seg-track max-sm:max-w-full max-sm:scroll-soft-x">
          {s.scenarios.map((x) => (
            <ScenarioTab key={x.id} id={x.id} name={x.name} active={x.id === s.activeId} single={s.scenarios.length <= 1} full={full} />
          ))}
        </div>
        <Tooltip content={full ? `Сценариев не больше ${MAX_SCENARIOS}` : "Новый сценарий"}>
          <button
            type="button"
            className="btn-ghost btn-square-lg"
            aria-label="Новый сценарий"
            disabled={full}
            onClick={() => void s.addScenario(false)}
          >
            <Plus className="w-4 h-4" />
          </button>
        </Tooltip>
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

/** Вкладка сценария: название и меню «⋮» с действиями над ним. */
function ScenarioTab({
  id,
  name,
  active,
  single,
  full,
}: {
  id: string;
  name: string;
  active: boolean;
  single: boolean;
  full: boolean;
}) {
  const s = useWhatIfStore();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const close = () => {
    setOpen(false);
    setRenaming(null);
  };

  async function remove() {
    close();
    const ok = await confirm({
      title: `Удалить сценарий «${name}»?`,
      message: "Настройки и события этого сценария удалятся на всех устройствах.",
      confirmLabel: "Удалить",
      tone: "danger",
    });
    if (ok) await s.removeScenario(id);
  }

  return (
    <div
      role="tab"
      tabIndex={0}
      aria-selected={active}
      onClick={() => void s.setActive(id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void s.setActive(id);
        }
      }}
      className={clsx("seg-item seg-item-md !pr-1 cursor-pointer", active && "seg-on")}
    >
      {name}
      <span ref={anchorRef} className="inline-flex">
        <button
          type="button"
          aria-label={`Действия со сценарием «${name}»`}
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            if (open) close();
            else setOpen(true);
          }}
          className="w-6 h-6 grid place-items-center rounded-md opacity-60 hover:opacity-100 hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <MoreVertical className="w-4 h-4" />
        </button>
      </span>
      <Popover open={open} anchorRef={anchorRef} onClose={close} className="w-64 card p-2 shadow-lg">
        {/* Щелчок внутри меню не должен переключать вкладку под ним. */}
        <div className="flex flex-col text-text font-normal" onClick={(e) => e.stopPropagation()}>
          {renaming !== null ? (
            <form
              className="space-y-2 p-1"
              onSubmit={(e) => {
                e.preventDefault();
                void s.renameScenario(id, renaming);
                close();
              }}
            >
              <label className="label block" htmlFor={`whatif-rename-${id}`}>
                Название сценария
              </label>
              <input
                id={`whatif-rename-${id}`}
                autoFocus
                // Имя выделено сразу: набор заменяет его, как при
                // переименовании файла.
                onFocus={(e) => e.target.select()}
                maxLength={40}
                className="input text-sm w-full"
                value={renaming}
                onChange={(e) => setRenaming(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <button type="submit" className="btn-primary w-full text-sm" disabled={!renaming.trim()}>
                Сохранить
              </button>
            </form>
          ) : (
            <>
              <MenuItem icon={Pencil} label="Переименовать" onClick={() => setRenaming(name)} />
              <MenuItem
                icon={Copy}
                label="Сделать копию"
                disabled={full}
                onClick={async () => {
                  close();
                  // Копируется открытый сценарий — сначала открываем этот.
                  await s.setActive(id);
                  await s.addScenario(true);
                }}
              />
              <MenuItem icon={Trash2} label="Удалить" danger disabled={single} onClick={() => void remove()} />
            </>
          )}
        </div>
      </Popover>
    </div>
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
