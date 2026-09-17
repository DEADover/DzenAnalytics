import clsx from "clsx";
import { ArrowDown, ArrowUp, Minus, MoreHorizontal, PanelTop, Plus } from "lucide-react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "./Modal";
import { Segmented } from "./Segmented";
import { Slider } from "./Slider";
import {
  ICON_WIDTH_BASE_PX,
  ICON_WIDTH_STEPS,
  headerSections,
  iconButtonWidth,
  isDefaultHeaderNav,
  moreGroups,
} from "../lib/headerNav";
import type { NavSection } from "../lib/navSections";
import { useHeaderNavStore } from "../store/useHeaderNavStore";

/**
 * Окно «Основное меню»: какие разделы стоят в дорожке меню шапки и в каком порядке.
 *
 * Слева — то, что в шапке, со стрелками порядка и кнопкой «убрать в „Ещё“».
 * Справа — всё остальное теми же группами, что в панели «Ещё», с кнопкой
 * «в меню». Над ними — вид меню: с названиями или одними значками (название
 * тогда в подсказке при наведении). Правка применяется сразу: шапка видна над
 * окном.
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
  const iconsOnly = useHeaderNavStore((s) => s.iconsOnly);
  const setIconsOnly = useHeaderNavStore((s) => s.setIconsOnly);
  const iconWidth = useHeaderNavStore((s) => s.iconWidth);
  const setIconWidth = useHeaderNavStore((s) => s.setIconWidth);

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
        {/* Вид меню — одной строкой при любом выборе: подпись, переключатель и
            ширина кнопок. Ширина нужна только значкам, поэтому с названиями
            бегунок погашен, а не спрятан — строка не меняет вид при переключении. */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <h3 className="text-sm font-semibold whitespace-nowrap">Вид меню</h3>
          <Segmented
            size="sm"
            label="Вид меню"
            className="shrink-0"
            value={iconsOnly ? "icons" : "labels"}
            onChange={(v) => setIconsOnly(v === "icons")}
            options={[
              { value: "labels", label: "С названиями" },
              { value: "icons", label: "Только значки" },
            ]}
          />
          <Slider
            size="sm"
            label="Ширина кнопок"
            value={iconWidth}
            min={0}
            max={ICON_WIDTH_STEPS}
            step={1}
            onChange={setIconWidth}
            disabled={!iconsOnly}
            format={(v) => `${iconButtonWidth(v) ?? ICON_WIDTH_BASE_PX} px`}
            className={clsx("ml-auto", !iconsOnly && "opacity-50")}
          />
        </div>
        {/* Две половины — две панели: то, что уже стоит в меню, — в акцентной,
            остальное — в нейтральной. Одним списком с заголовками они читались
            как продолжение друг друга, и было не понять, где кончается меню. */}
        <div className="grid gap-4 md:grid-cols-2 items-start">
          <section className="rounded-2xl border border-accent/30 bg-accent/5 p-3">
            <HalfHeader icon={PanelTop} title="В меню" hint="Стоят в шапке" accent />
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
            <p className="text-xs text-muted mt-3 px-1">
              Порядок сверху вниз — это порядок слева направо. Если разделы не
              помещаются в шапку, меню листается вбок — колесом мыши или тачпадом.
            </p>
          </section>

          <section className="rounded-2xl border border-border bg-panel2/40 p-3">
            <HalfHeader icon={MoreHorizontal} title="В «Ещё»" hint="Открываются из «Ещё»" />
            <div className="space-y-4">
              {rest.map((group) => (
                <div key={group.title}>
                  <div className="caps-label mb-1 px-1">{group.title}</div>
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
          disabled={isDefaultHeaderNav(items) && !iconsOnly && iconWidth === 0}
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

/** Шапка половины окна: значок, название и то, где эти разделы окажутся. */
function HalfHeader({
  icon: Icon,
  title,
  hint,
  accent = false,
}: {
  icon: typeof PanelTop;
  title: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 px-1 mb-3">
      <Icon className={clsx("w-4 h-4 shrink-0", accent ? "text-accent" : "text-muted")} aria-hidden />
      <h3 className="text-sm font-semibold">{title}</h3>
      <span className="text-xs text-muted">· {hint}</span>
    </div>
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
        framed ? "border border-border bg-panel shadow-sm" : "hover:bg-panel"
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
