/**
 * Сетка виджетов с настройкой раскладки — общая для главной и «Обзора месяца».
 *
 * Сетка одна на всю страницу, в три колонки; виджет занимает треть, две трети
 * или всю ширину. Что внутри виджета, решает страница (`body`); порядок,
 * состав, перетаскивание и пустые клетки — здесь. Чья это раскладка, говорит
 * `LayoutSurfaceContext`: без него — главной.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import { EmptyDashboard, LayoutToolbar, WidgetGap, WidgetShell } from "./WidgetLayout";
import { useLayoutSurface } from "./layoutSurface";
import { useWidgetDrag } from "../../hooks/useWidgetDrag";
import {
  isBareWidget,
  maxOffset,
  packLayout,
  widgetMeta,
  widgetView,
  type LayoutCell,
  type WidgetPlacement,
} from "../../lib/dashboardLayout";

export function WidgetBoard({
  body,
}: {
  /** Содержимое виджета. Обойму, ширину и ручки надевает `WidgetShell`. */
  body: (placement: WidgetPlacement) => ReactNode;
}) {
  const surface = useLayoutSurface();
  const layout = surface.useStore((s) => s.layout);
  const editing = surface.useStore((s) => s.editing);
  const setEditing = surface.useStore((s) => s.setEditing);
  const move = surface.useStore((s) => s.move);
  const shift = surface.useStore((s) => s.shift);
  const dropInGap = surface.useStore((s) => s.dropInGap);

  const drag = useWidgetDrag(
    (dragKey, overKey) => void move(dragKey, overKey),
    (dragKey, beforeKey, gapCol) => void dropInGap(dragKey, beforeKey, gapCol)
  );

  // Режим настройки не переживает уход со страницы: вернувшись на страницу,
  // человек ждёт готовый экран, а не разложенные ручки.
  useEffect(() => () => setEditing(false), [setEditing]);

  // Escape — выход из режима, как из любого другого временного состояния.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector('[role="dialog"]')) return;
      setEditing(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, setEditing]);

  /**
   * Виджет, только что поставленный из пустой клетки, — его и подсвечиваем
   * появлением. Ключ сбрасывается сам: анимация одноразовая, и держать её
   * включённой после того, как она отыграла, значит повторять её на каждой
   * следующей перерисовке.
   */
  const [justAdded, setJustAdded] = useState<string | null>(null);
  useEffect(() => {
    if (!justAdded) return;
    const t = setTimeout(() => setJustAdded(null), 600);
    return () => clearTimeout(t);
  }, [justAdded]);

  /** Ширина того, что сейчас везут: дырка уже не примет виджет шире себя. */
  const dragSpan = useMemo(() => {
    if (!drag.dragKey) return 0;
    const p = layout.find((x) => x.key === drag.dragKey);
    return p ? widgetMeta(p.kind)?.span ?? 1 : 0;
  }, [drag.dragKey, layout]);

  const visible = layout.filter((p) => !p.hidden);
  // Дырки в рядах считаем сами: сетка их оставляет, но в разметке их нет, а
  // значит и уронить в них виджет нельзя. Считаем ВСЕГДА, а не только в режиме
  // настройки: пустая клетка слева от виджета — часть раскладки, и без неё
  // сдвинутый виджет возвращался бы к левому краю, стоило выйти из настройки.
  const cells = useMemo(() => {
    const packed = packLayout(visible);
    // В режиме настройки в конце всегда есть куда поставить: если ряды сошлись
    // ровно, пустой клетки не остаётся вовсе — и «плюсу» негде жить. Полоса во
    // всю ширину заодно принимает бросок любого виджета, даже самого широкого.
    if (!editing || packed[packed.length - 1]?.type === "gap") return packed;
    return [...packed, { type: "gap" as const, span: 3, before: null }];
  }, [visible, editing]);

  /**
   * Номер ряда для каждой ячейки раскладки.
   *
   * Нужен ровно для одного: дырку нельзя закрыть виджетом ИЗ ЭТОГО ЖЕ РЯДА. Он
   * не встанет на её место, а поменяется местами с соседом, и дырка останется
   * там же — со стороны это выглядит как «перетаскивание не работает».
   */
  /**
   * С какой колонки ряда начинается каждая ячейка.
   *
   * Нужна дыркам: бросок ставит виджет ровно в ту клетку, куда целились, а для
   * этого надо знать её номер в ряду (см. `dropIntoGap`).
   */
  const colOf = (() => {
    const out = new Map<LayoutCell, number>();
    let col = 0;
    for (const cell of cells) {
      const span =
        cell.type === "gap" ? cell.span : widgetMeta(cell.placement.kind).span;
      out.set(cell, col);
      col = (col + span) % 3;
    }
    return out;
  })();

  return (
    <div className="flex flex-col gap-5 3xl:gap-6">
      <LayoutToolbar layout={layout} />

      {visible.length === 0 ? (
        <EmptyDashboard />
      ) : (
        <section data-tour="widgets" className="grid grid-cols-1 lg:grid-cols-3 gap-5 3xl:gap-6">
          {cells.map((cell, ci) => {
            if (cell.type === "gap") {
              // В ряду дырок бывает две: перенос на новый ряд и отступ слева от
              // виджета. Ключ по одному лишь соседу их бы склеил — подсвечивались
              // бы обе разом.
              const gapKey = `gap:${ci}:${cell.before ?? "end"}`;
              // Помещается ли виджет, если начать его с этой клетки. Считаем
              // до конца РЯДА, а не по ширине самой дырки: виджет, который
              // бросают в собственный отступ, занимает и то место, где стоял.
              const gapCol = colOf.get(cell) ?? 0;
              const accepts = drag.dragKey !== null && gapCol + dragSpan <= 3;
              const refusal =
                drag.dragKey !== null && !accepts
                  ? "Не поместится — двигайте стрелками"
                  : null;
              // Вне настройки дырка — просто пустое место: ни рамки, ни
              // приглашения, ни обработчиков.
              if (!editing) {
                return (
                  <div
                    key={gapKey}
                    aria-hidden
                    className={clsx("hidden lg:block", cell.span === 2 && "lg:col-span-2")}
                  />
                );
              }
              return (
                <WidgetGap
                  key={gapKey}
                  span={cell.span}
                  dragging={drag.dragKey !== null}
                  accepts={accepts}
                  refusal={refusal}
                  highlight={drag.overKey === gapKey}
                  layout={layout}
                  beforeKey={cell.before}
                  onEnter={() => drag.enter(gapKey)}
                  onDrop={(sourceKey) => drag.dropBefore(sourceKey, cell.before, gapCol)}
                  onAdded={setJustAdded}
                />
              );
            }
            const p = cell.placement;
            const i = visible.indexOf(p);
            return (
            <WidgetShell
              key={p.key}
              placement={p}
              meta={widgetMeta(p.kind)}
              bare={isBareWidget(widgetMeta(p.kind), p.view)}
              sunken={widgetView(widgetMeta(p.kind), p.view)?.sunken === true}
              editing={editing}
              appearing={justAdded === p.key}
              dragging={drag.dragKey === p.key}
              dropTarget={
                drag.overKey === p.key && drag.dragKey !== null && drag.dragKey !== p.key
              }
              onDragStart={() => drag.start(p.key)}
              onDragEnter={() => drag.enter(p.key)}
              onDragEnd={drag.end}
              onDrop={(sourceKey) => drag.drop(sourceKey, p.key)}
              onShift={(dir) => void shift(p.key, dir)}
              // Шаг — это клетка, а не сосед: у крайнего виджета он ещё есть,
              // пока в ряду остаётся пустое место.
              canBack={i > 0 || (p.offset ?? 0) > 0}
              canForward={
                i < visible.length - 1 ||
                (p.offset ?? 0) < maxOffset(widgetMeta(p.kind))
              }
            >
              {body(p)}
            </WidgetShell>
            );
          })}
        </section>
      )}


    </div>
  );
}
