/**
 * Своя ширина столбцов — одна механика на все таблицы и ленты.
 *
 * Включается в «Оформлении» («Своя ширина столбцов»). Пока ширины никто не
 * трогал, таблица выглядит ровно как без настройки: в шапке появляются только
 * границы, за которые можно тянуть. Первое же движение снимает текущие ширины
 * всех колонок, и дальше таблица живёт по ним: тянешь правый край колонки —
 * меняется только она, остальные сдвигаются. Шире карточки таблица не
 * становится: расширять можно за счёт свободного места справа (модель — в
 * `lib/columnResize.ts`).
 *
 * Во время перетаскивания React не перерисовывает строки: ширина меняется
 * прямо в DOM — у `<col>` и самой таблицы или CSS-переменной сетки ленты. В
 * хранилище уходит только итог, когда кнопку мыши отпустили.
 */
import { useCallback, useMemo, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useDisplayStore } from "../store/useDisplayStore";
import { useColumnWidthsStore } from "../store/useColumnWidthsStore";
import { scaledWidth } from "../components/table/tableKit";
import {
  clampWidth,
  gridTemplateWith,
  hasWidthsFor,
  liveVarName,
  pxToRem,
  tableLayout,
  type ColumnWidthMap,
  type TableLayout,
} from "../lib/columnResize";

export interface ResizeColumn {
  key: string;
  /** Подпись — для скринридера у границы. */
  label?: string;
  /** Тип колонки таблицы (для справки; ширину не определяет). */
  type?: string;
  /** Ширина по умолчанию (CSS) — у таблицы. */
  width?: string;
  /** Дорожка сетки по умолчанию — у ленты. */
  size?: string;
  /** Тянуть можно? У чекбокса выбора и кнопок действий ширина своя. */
  resizable?: boolean;
}

interface Options {
  /** `grid` — лента на CSS-сетке (`size` у колонок), иначе таблица. */
  mode?: "table" | "grid";
  /** Ширины колонок таблицы перед колонками хука — чекбокс выбора. */
  lead?: readonly string[];
}

export interface ColumnResize {
  /** Настройка включена и у таблицы есть имя. */
  enabled: boolean;
  /** Действуют свои ширины — таблице нужна фиксированная раскладка. */
  custom: boolean;
  /** CSS-ширина колонки таблицы: своя (доля таблицы) или по умолчанию; `undefined` — без ширины. */
  widthOf: (key: string) => string | undefined;
  /** Шаблон сетки ленты (в режиме `grid`). */
  template: string;
  /**
   * Стиль таблицы при своих ширинах: шириной в сумму колонок, но не шире
   * карточки. `minWidth` — прежний минимум таблицы (CSS): он остаётся, но не
   * больше суммы колонок, иначе сузить колонку было бы нельзя. `undefined` —
   * своих ширин нет: таблица как была.
   */
  tableStyle: (minWidth?: string) => { width: string; minWidth?: string } | undefined;
  /** Граница у правого края колонки — ставится внутрь её ячейки шапки. */
  handle: (key: string) => ReactNode;
  /**
   * `<colgroup>` для таблицы со своей разметкой — только при своих ширинах
   * (иначе `null`, и таблица размечается как раньше). `className` — классы
   * `<col>`: колонке, которая прячется на узком экране, нужен тот же
   * `hidden xl:table-column`, иначе ячейки строк съедут на её место.
   */
  colgroup: (opts?: { className?: Record<string, string> }) => ReactNode;
  /** Ширина колонки перед колонками хука (`lead`): доля при своих ширинах, иначе как задана. */
  leadWidth: (index: number) => string | undefined;
}

/** Шаг стрелки на клавиатуре; с Shift — втрое больше. */
const KEY_STEP_PX = 16;

function units(): { remPx: number; scale: number } {
  const cs = getComputedStyle(document.documentElement);
  const remPx = parseFloat(cs.fontSize) || 16;
  const scale = parseFloat(cs.getPropertyValue("--tbl-scale")) || 1;
  return { remPx, scale };
}

/**
 * Сколько места нужно подписи шапки без обрезки. Ячейку копируем в
 * невидимую таблицу (или строку списка) без ширины и меряем — так в замер
 * попадают поля ячейки, значок сортировки и кнопки перед подписью.
 */
function naturalWidth(cell: HTMLElement): number {
  const clone = cell.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-col-handle]").forEach((n) => n.remove());
  clone.className = clone.className
    .split(/\s+/)
    .filter((c) => !/^(?:[a-z]+:)?(?:min-|max-)?w-/.test(c))
    .join(" ");
  clone.style.width = "auto";
  clone.style.minWidth = "0";
  clone.style.maxWidth = "none";

  let host: HTMLElement;
  if (cell.tagName === "TH") {
    const table = document.createElement("table");
    table.className = (cell.closest("table")?.className ?? "").replace(/\b(?:w-full|table-fixed)\b/g, "");
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    tr.appendChild(clone);
    thead.appendChild(tr);
    table.appendChild(thead);
    host = table;
  } else {
    const row = document.createElement("div");
    row.className = cell.parentElement?.className ?? "";
    row.style.display = "inline-flex";
    row.style.gridTemplateColumns = "none";
    row.appendChild(clone);
    host = row;
  }
  Object.assign(host.style, {
    position: "absolute",
    visibility: "hidden",
    pointerEvents: "none",
    left: "-10000px",
    top: "0",
    width: "auto",
    minWidth: "0",
  });
  document.body.appendChild(host);
  const w = clone.getBoundingClientRect().width;
  host.remove();
  return Math.ceil(w) + 1;
}

const RESIZING_CLASS = "col-resizing";

export function useColumnResize(
  id: string | null | undefined,
  columns: readonly ResizeColumn[],
  { mode = "table", lead }: Options = {}
): ColumnResize {
  const option = useDisplayStore((s) => s.columnResize);
  const enabled = option && !!id;
  const saved = useColumnWidthsStore((s) => (enabled && id ? s.tables[id] : undefined));
  const setTable = useColumnWidthsStore((s) => s.setTable);

  const keys = useMemo(() => columns.map((c) => c.key), [columns]);
  const has = enabled && hasWidthsFor(saved, keys);
  const layout = useMemo<TableLayout | null>(
    () => (mode === "table" && has ? tableLayout(columns, saved, lead) : null),
    [mode, has, columns, saved, lead]
  );
  // У таблицы свои ширины действуют, только если раскладку удалось сложить.
  const custom = has && (mode === "grid" || layout !== null);
  const map = custom ? saved : undefined;

  const widthOf = useCallback(
    (key: string) => layout?.cols[key] ?? scaledWidth(columns.find((c) => c.key === key)?.width),
    [layout, columns]
  );
  const leadWidth = useCallback((i: number) => layout?.lead[i] ?? lead?.[i], [layout, lead]);
  const tableStyle = useCallback(
    (minWidth?: string) =>
      layout
        ? {
            width: `min(${layout.total}, 100%)`,
            ...(minWidth ? { minWidth: `min(${minWidth}, ${layout.total})` } : {}),
          }
        : undefined,
    [layout]
  );

  const tracks = useMemo(
    () => columns.map((c) => ({ key: c.key, size: c.size ?? "auto" })),
    [columns]
  );
  const template = useMemo(() => {
    if (mode !== "grid") return "";
    const committed = gridTemplateWith(tracks, map);
    return enabled && id ? `var(${liveVarName(id)}, ${committed})` : committed;
  }, [mode, tracks, map, enabled, id]);


  /**
   * Начать правку колонки `key`: снять ширины, если своих ещё нет, и вернуть
   * сессию — сдвинуть, записать или отменить.
   */
  const begin = useCallback(
    (handleEl: HTMLElement, key: string) => {
      if (!id) return null;
      const targetEl = handleEl.closest<HTMLElement>("[data-col]");
      const row = targetEl?.parentElement;
      if (!targetEl || !row) return null;
      const cells = new Map<string, HTMLElement>();
      row.querySelectorAll<HTMLElement>(":scope > [data-col]").forEach((el) => {
        if (el.dataset.col) cells.set(el.dataset.col, el);
      });

      const { remPx, scale } = units();
      const px = (el: Element) => el.getBoundingClientRect().width;
      const table = handleEl.closest("table");
      const tableStart = table ? px(table) : 0;

      // Свободное место справа: у таблицы — между её краем и краем
      // обёртки, у ленты — между последней колонкой и краем строки. Пока
      // своих ширин нет, таблица во всю ширину и свободного места нет.
      let free = 0;
      if (map) {
        const box = table ? table.parentElement : row;
        if (box) {
          const cs = getComputedStyle(box);
          const inner = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
          let used = tableStart;
          if (!table) {
            const sizes = cs.gridTemplateColumns.split(" ").map(parseFloat);
            const gap = parseFloat(cs.columnGap) || 0;
            used = sizes.reduce((s, v) => s + (v || 0), 0) + gap * Math.max(0, sizes.length - 1);
          }
          free = Math.max(0, Math.floor(inner - used));
        }
      }

      const before = map;
      let base: ColumnWidthMap;
      if (map) {
        base = { ...map };
      } else {
        // Первый раз: запоминаем ширины всех колонок как есть, чтобы ничего
        // не прыгнуло. Колонки без права тянуть (чекбокс, кнопки) остаются
        // своей шириной, если она у них задана.
        base = {};
        for (const c of columns) {
          const locked = c.resizable === false && (mode === "grid" || !!c.width);
          if (locked) continue;
          const el = cells.get(c.key);
          const w = el ? px(el) : 0;
          if (w > 0) base[c.key] = pxToRem(w, remPx, scale);
        }
        setTable(id, base);
      }

      const start = px(targetEl);
      const min = naturalWidth(targetEl);
      let current = start;
      const varName = liveVarName(id);
      const colEls = () => (table ? [...table.querySelectorAll<HTMLElement>(":scope > colgroup > col")] : []);
      // У таблицы колонки — доли её ширины. На время перетаскивания
      // переводим их в пиксели: иначе с шириной таблицы менялись бы все.
      // Делаем это при первом движении — к нему `<colgroup>` уже нарисован.
      let frozen = false;
      const freeze = () => {
        if (frozen || !table) return;
        frozen = true;
        const heads = [...row.children] as HTMLElement[];
        const cols = colEls();
        if (cols.length === heads.length) cols.forEach((c, i) => (c.style.width = `${px(heads[i])}px`));
        table.style.width = `${tableStart}px`;
      };

      const apply = (w: number) => {
        if (mode === "grid") {
          const live = { ...base, [key]: w / (remPx * scale) };
          document.documentElement.style.setProperty(varName, gridTemplateWith(tracks, live));
        } else {
          freeze();
          const col = table?.querySelector<HTMLElement>(`:scope > colgroup > col[data-col="${CSS.escape(key)}"]`);
          if (col) col.style.width = `${w}px`;
          if (table) table.style.width = `${tableStart + (w - start)}px`;
        }
      };
      const settle = (next: ColumnWidthMap | undefined) => {
        if (mode === "grid") {
          // Сетка возвращается к сохранённому шаблону уже после перерисовки
          // (React применяет её в микрозадаче), иначе на кадр мелькнули бы
          // прежние ширины. Таймер, а не кадр анимации: в фоновой вкладке
          // кадров нет, и переменная висела бы до возвращения на неё.
          setTimeout(() => document.documentElement.style.removeProperty(varName), 0);
          return;
        }
        if (!frozen || !table) return;
        // Пиксели, поставленные на время перетаскивания, меняем на те же
        // доли, что рисует React: он перепишет только то, что изменилось у
        // него самого, и оставшиеся пиксели не сжимались бы с окном.
        const next_ = next ? tableLayout(columns, next, lead) : null;
        if (!next_) {
          colEls().forEach((c) => (c.style.width = ""));
          table.style.width = "";
          return;
        }
        let li = 0;
        colEls().forEach((c) => {
          const k = c.dataset.col;
          c.style.width = (k ? next_.cols[k] : next_.lead[li++]) ?? "";
        });
        table.style.width = `min(${next_.total}, 100%)`;
      };

      return {
        /** Сдвинуть край на `delta` пикселей. `true` — упёрлись: места справа больше нет. */
        update(delta: number): boolean {
          current = clampWidth(start, delta, min, free);
          apply(current);
          return delta > 0 && current < start + delta;
        },
        commit() {
          const next = { ...base, [key]: pxToRem(current, remPx, scale) };
          setTable(id, next);
          settle(next);
        },
        cancel() {
          setTable(id, before ?? null);
          settle(before);
        },
      };
    },
    [id, map, columns, mode, setTable, tracks, lead]
  );

  const handle = useCallback(
    (key: string): ReactNode => {
      if (!enabled || !id) return null;
      const index = keys.indexOf(key);
      const col = columns[index];
      if (!col || col.resizable === false) return null;
      const label = col.label ?? col.key;
      const last = index === keys.length - 1;

      const onPointerDown = (e: PointerEvent<HTMLElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const el = e.currentTarget;
        const session = begin(el, key);
        if (!session) return;
        const startX = e.clientX;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // Без захвата граница всё равно тянется, пока мышь над ней.
        }
        el.dataset.active = "";
        document.body.classList.add(RESIZING_CLASS);
        const finish = (ok: boolean) => {
          el.removeEventListener("pointermove", onMove);
          el.removeEventListener("pointerup", onUp);
          el.removeEventListener("pointercancel", onCancel);
          window.removeEventListener("keydown", onKey, true);
          delete el.dataset.active;
          el.removeAttribute("data-limit");
          document.body.classList.remove(RESIZING_CLASS);
          if (ok) session.commit();
          else session.cancel();
        };
        // Упёрлись в край — черта границы краснеет: шире некуда, пока не
        // сузить другую колонку.
        const onMove = (ev: globalThis.PointerEvent) =>
          el.toggleAttribute("data-limit", session.update(ev.clientX - startX));
        const onUp = () => finish(true);
        const onCancel = () => finish(false);
        const onKey = (ev: globalThis.KeyboardEvent) => {
          if (ev.key !== "Escape") return;
          ev.preventDefault();
          ev.stopPropagation();
          finish(false);
        };
        el.addEventListener("pointermove", onMove);
        el.addEventListener("pointerup", onUp);
        el.addEventListener("pointercancel", onCancel);
        window.addEventListener("keydown", onKey, true);
      };

      const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        e.stopPropagation();
        const session = begin(e.currentTarget, key);
        if (!session) return;
        const step = (e.shiftKey ? 3 : 1) * KEY_STEP_PX;
        session.update(e.key === "ArrowRight" ? step : -step);
        session.commit();
      };

      return (
        <span
          data-col-handle
          data-last={last ? "" : undefined}
          role="separator"
          aria-orientation="vertical"
          aria-label={`Ширина столбца «${label}»`}
          tabIndex={0}
          title={
            "Потяните, чтобы изменить ширину. Шире можно за счёт свободного места справа — его даёт сужение другой колонки.\nДвойной щелчок — вернуть как было"
          }
          className="col-resize-handle"
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setTable(id, null);
          }}
        />
      );
    },
    [enabled, id, keys, columns, begin, setTable]
  );

  const colgroup = useCallback(
    (opts: { className?: Record<string, string> } = {}) => {
      if (!custom) return null;
      return (
        <colgroup>
          {lead?.map((_, i) => <col key={`lead-${i}`} style={{ width: leadWidth(i) }} />)}
          {keys.map((k) => {
            const w = widthOf(k);
            return (
              <col key={k} data-col={k} className={opts.className?.[k]} style={w ? { width: w } : undefined} />
            );
          })}
        </colgroup>
      );
    },
    [custom, keys, widthOf, lead, leadWidth]
  );

  return { enabled, custom, widthOf, template, tableStyle, handle, colgroup, leadWidth };
}
