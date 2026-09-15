import clsx from "clsx";
import { ArrowDown, ArrowUp, Minus, PanelTop, Plus } from "lucide-react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "./Modal";
import { headerSections, isDefaultHeaderNav, moreGroups } from "../lib/headerNav";
import type { NavSection } from "../lib/navSections";
import { useHeaderNavStore } from "../store/useHeaderNavStore";

/**
 * Окно «Основное меню»: какие разделы стоят в дорожке меню шапки и в каком порядке.
 *
 * Слева — то, что в шапке, со стрелками порядка и кнопкой «убрать в „Ещё“».
 * Справа — всё остальное теми же группами, что в панели «Ещё», с кнопкой
 * «в меню». Правка применяется сразу: шапка видна над окном.
 */
export function HeaderNavModal() {
  const open = useHeaderNavStore((s) => s.editorOpen);
  const close = useHeaderNavStore((s) => s.closeEditor);
  if (!open) return null;
  return <HeaderNavModalContent onClose={close} />;
}

function HeaderNavModalContent({ onClose }: { onClose: () => void }) {
  const items = useHeaderNavStore((s) => s.items);
  const add = useHeaderNavStore((s) => s.add);
  const remove = useHeaderNavStore((s) => s.remove);
  const move = useHeaderNavStore((s) => s.move);
  const reset = useHeaderNavStore((s) => s.reset);

  const inHeader = headerSections(items);
  const rest = moreGroups(items);

  return (
    <Modal onClose={onClose} width="3xl" className="h-[min(760px,calc(100dvh-2rem))]">
      <ModalHeader
        icon={PanelTop}
        title="Основное меню"
        subtitle="Какие разделы стоят в основном меню, а какие — в «Ещё»"
      />
      <ModalBody scroll gap={0}>
        <div className="grid gap-6 md:grid-cols-2 md:gap-8">
          <section>
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <h3 className="text-sm font-semibold">В меню</h3>
              <span className="text-xs text-muted tabular-nums">{inHeader.length}</span>
            </div>
            {inHeader.length === 0 ? (
              <p className="text-sm text-muted py-2">
                Все разделы — в «Ещё». Добавьте нужные кнопкой «+» справа.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {inHeader.map((s, i) => (
                  <SectionRow key={s.to} section={s} framed>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => move(s.to, -1)}
                      disabled={i === 0}
                      aria-label={`«${s.label}» левее`}
                      title="Левее"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => move(s.to, 1)}
                      disabled={i === inHeader.length - 1}
                      aria-label={`«${s.label}» правее`}
                      title="Правее"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      className="btn-icon-danger"
                      onClick={() => remove(s.to)}
                      aria-label={`Убрать «${s.label}» в «Ещё»`}
                      title="Убрать в «Ещё»"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                  </SectionRow>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted mt-3">
              Порядок сверху вниз — это порядок слева направо. Если на узком
              экране разделы не помещаются, последние сами уходят в «Ещё».
            </p>
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-2">В «Ещё»</h3>
            <div className="space-y-4">
              {rest.map((group) => (
                <div key={group.title}>
                  <div className="caps-label mb-1">{group.title}</div>
                  <ul className="space-y-0.5">
                    {group.items.map((s) => (
                      <SectionRow key={s.to} section={s}>
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={() => add(s.to)}
                          aria-label={`Поставить «${s.label}» в основное меню`}
                          title="В меню"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </SectionRow>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </div>
      </ModalBody>
      <ModalFooter justify="between">
        <button
          type="button"
          className="btn-ghost"
          onClick={reset}
          disabled={isDefaultHeaderNav(items)}
        >
          Стандартный вид
        </button>
        <button type="button" className="btn-primary" onClick={onClose}>
          Готово
        </button>
      </ModalFooter>
    </Modal>
  );
}

/** Строка раздела: значок, название, пояснение и кнопки справа. */
function SectionRow({
  section: { label, hint, icon: Icon },
  framed = false,
  children,
}: {
  section: NavSection;
  /** Строка основного меню — в рамке: это набор, который собирают. */
  framed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li
      className={clsx(
        "flex items-center gap-3 px-2.5 py-1.5 rounded-xl",
        framed ? "border border-border bg-panel2/40" : "hover:bg-panel2/60"
      )}
    >
      <Icon className="w-4 h-4 shrink-0 text-muted" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{label}</span>
        <span className="block truncate text-xs text-muted">{hint}</span>
      </span>
      <span className="shrink-0 flex items-center gap-0.5">{children}</span>
    </li>
  );
}
