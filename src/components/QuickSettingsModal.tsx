import { ArrowDown, ArrowUp, Minus, Plus, Settings, SlidersHorizontal } from "lucide-react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "./Modal";
import { PickHalfHeader, PickRow } from "./PickEditor";
import { QUICK_SETTINGS, isDefaultQuickSettings, quickSetting, type QuickSetting } from "../lib/quickSettings";
import { useQuickSettingsStore } from "../store/useQuickSettingsStore";

/**
 * Окно «Быстрые настройки»: какие пункты стоят в панели шестерёнки и в каком
 * порядке. Устроено как «Основное меню» — те же половины и строки
 * (`PickEditor`): слева набор со стрелками и «−», справа остальное с «+».
 */
export function QuickSettingsModal() {
  const open = useQuickSettingsStore((s) => s.editorOpen);
  const close = useQuickSettingsStore((s) => s.closeEditor);
  if (!open) return null;
  return <QuickSettingsModalContent onClose={close} />;
}

function QuickSettingsModalContent({ onClose }: { onClose: () => void }) {
  const items = useQuickSettingsStore((s) => s.items);
  const add = useQuickSettingsStore((s) => s.add);
  const remove = useQuickSettingsStore((s) => s.remove);
  const move = useQuickSettingsStore((s) => s.move);
  const reset = useQuickSettingsStore((s) => s.reset);

  const inPanel = items.map(quickSetting).filter((s): s is QuickSetting => !!s);
  const rest = QUICK_SETTINGS.filter((s) => !items.includes(s.id));

  return (
    <Modal onClose={onClose} width="3xl" className="h-[min(720px,calc(100dvh-2rem))]">
      <ModalHeader
        icon={SlidersHorizontal}
        title="Быстрые настройки"
        subtitle="Что доступно в панели быстрых настроек"
      />
      <ModalBody scroll gap={0}>
        <div className="grid gap-4 md:grid-cols-2 items-start">
          <section className="rounded-2xl border border-accent/30 bg-accent/5 p-3">
            <PickHalfHeader icon={SlidersHorizontal} title="В панели" hint="Быстрые настройки" accent />
            {inPanel.length === 0 ? (
              <p className="text-sm text-muted py-2">
                Панель пуста. Добавьте нужное кнопкой «+» справа.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {inPanel.map((s, i) => (
                  <PickRow key={s.id} icon={s.icon} label={s.label} hint={s.hint} framed>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => move(s.id, -1)}
                      disabled={i === 0}
                      aria-label={`«${s.label}» выше`}
                      title="Выше"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => move(s.id, 1)}
                      disabled={i === inPanel.length - 1}
                      aria-label={`«${s.label}» ниже`}
                      title="Ниже"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      className="btn-icon-danger"
                      onClick={() => remove(s.id)}
                      aria-label={`Убрать «${s.label}» из панели`}
                      title="Убрать из панели"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                  </PickRow>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-panel2/40 p-3">
            <PickHalfHeader icon={Settings} title="Остальные" hint="Только в «Настройках»" />
            {rest.length === 0 ? (
              <p className="text-sm text-muted py-2">Все пункты уже в панели.</p>
            ) : (
              <ul className="space-y-0.5">
                {rest.map((s) => (
                  <PickRow key={s.id} icon={s.icon} label={s.label} hint={s.hint}>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => add(s.id)}
                      aria-label={`Поставить «${s.label}» в панель`}
                      title="В панель"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </PickRow>
                ))}
              </ul>
            )}
          </section>
        </div>
      </ModalBody>
      <ModalFooter justify="between">
        <button type="button" className="btn-ghost" onClick={reset} disabled={isDefaultQuickSettings(items)}>
          Стандартный набор
        </button>
        <button type="button" className="btn-primary" onClick={onClose}>
          Готово
        </button>
      </ModalFooter>
    </Modal>
  );
}
