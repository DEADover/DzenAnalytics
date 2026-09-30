/**
 * Своя ширина столбцов — одна механика на все таблицы и ленты.
 *
 * Включается в «Оформлении» («Своя ширина столбцов»). Пока ширины никто не
 * трогал, таблица выглядит ровно как без настройки: в шапке появляются только
 * границы, за которые можно тянуть. Граница двигается как перегородка: две
 * колонки по её сторонам делят место между собой, остальные стоят на месте,
 * таблица всегда во всю ширину (модель — в `lib/columnResize.ts`).
 *
 * Во время перетаскивания React не перерисовывает строки: ширина меняется
 * прямо в DOM — у `<col>` таблицы или CSS-переменной сетки ленты. В
 * хранилище уходит только итог, когда кнопку мыши отпустили.
 */
import { useCallback, useMemo, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useDisplayStore } from "../store/useDisplayStore";
import { useColumnWidthsStore } from "../store/useColumnWidthsStore";
import { COLUMN_TYPES, scaledWidth, type ColumnType } from "../components/table/tableKit";
import {
  gridTemplateWith,
  hasWidthsFor,
  liveVarName,
  pxToRem,
  splitWidths,
  tableLayout,
  type ColumnWidthMap,
  type TableLayout,
} from "../lib/columnResize";

export interface ResizeColumn {
  key: string;
  /** Подпись — для скринридера у границы. */
  label?: string;
  /** Тип колонки таблицы: по нему видно, к какому краю прижато содержимое. */
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
  /** Ширина колонки перед колонками хука (`lead`): доля при своих ширинах, иначе как задана. */
  leadWidth: (index: number) => string | undefined;
  /** Шаблон сетки ленты (в режиме `grid`). */
  template: string;
  /** Граница справа от колонки — ставится внутрь её ячейки шапки. */
  handle: (key: string) => ReactNode;
  /**
   * `<colgroup>` для таблицы со своей разметкой — только при своих ширинах
   * (иначе `null`, и таблица размечается как раньше). `className` — классы
   * `<col>`: колонке, которая прячется на узком экране, нужен тот же
   * `hidden xl:table-column`, иначе ячейки строк съедут на её место.
   */
  colgroup: (opts?: { className?: Record<string, string> }) => ReactNode;
}

/** К какому краю прижато содержимое колонки — по её типу из табличного стандарта. */
function alignOfColumn(c: ResizeColumn): string | undefined {
  return c.type && c.type in COLUMN_TYPES ? COLUMN_TYPES[c.type as ColumnType].align : undefined;
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
   * Начать правку границы справа от колонки `key`: снять ширины всех колонок
   * как они есть на этом окне и вернуть сессию — сдвинуть, записать или
   * отменить.
   */
  const begin = useCallback(
    (handleEl: HTMLElement, key: string) => {
      if (!id) return null;
      const leftKey = key;
      const rightKey = keys[keys.indexOf(key) + 1];
      const leftEl = handleEl.closest<HTMLElement>("[data-col]");
      const row = leftEl?.parentElement;
      if (!rightKey || !leftEl || !row) return null;
      const cells = new Map<string, HTMLElement>();
      row.querySelectorAll<HTMLElement>(":scope > [data-col]").forEach((el) => {
        if (el.dataset.col) cells.set(el.dataset.col, el);
      });
      const rightEl = cells.get(rightKey);
      if (!rightEl) return null;

      const { remPx, scale } = units();
      const px = (el: Element) => el.getBoundingClientRect().width;
      const toRem = (w: number) => pxToRem(w, remPx, scale);

      // Ширины снимаем каждый раз заново, а не берём сохранённые: сохранены
      // доли, и на другом окне в пикселях они другие. Колонки без права
      // тянуть (чекбокс, кнопки) остаются своей шириной, если она задана.
      // Прежние ширины колонок, которых сейчас не видно (дата в ленте по
      // дням), не теряем.
      const base: ColumnWidthMap = { ...(map ?? {}) };
      for (const c of columns) {
        const locked = c.resizable === false && (mode === "grid" || !!c.width);
        if (locked) continue;
        const el = cells.get(c.key);
        const w = el ? px(el) : 0;
        if (w > 0) base[c.key] = toRem(w);
      }
      const before = map;
      if (!map) setTable(id, base);

      const leftStart = px(leftEl);
      const rightStart = px(rightEl);
      const minLeft = naturalWidth(leftEl);
      const minRight = naturalWidth(rightEl);
      let left = leftStart;
      let right = rightStart;
      const table = handleEl.closest("table");
      const varName = liveVarName(id);
      const colEls = () => (table ? [...table.querySelectorAll<HTMLElement>(":scope > colgroup > col")] : []);
      const colOf = (k: string) =>
        table?.querySelector<HTMLElement>(`:scope > colgroup > col[data-col="${CSS.escape(k)}"]`);

      // У таблицы колонки — доли. На время перетаскивания переводим их в
      // пиксели, как они есть сейчас. Делаем это при первом движении — к
      // нему `<colgroup>` уже нарисован.
      let frozen = false;
      const freeze = () => {
        if (frozen || !table) return;
        frozen = true;
        const heads = [...row.children] as HTMLElement[];
        const cols = colEls();
        if (cols.length === heads.length) cols.forEach((c, i) => (c.style.width = `${px(heads[i])}px`));
      };

      const apply = () => {
        if (mode === "grid") {
          const live = { ...base, [leftKey]: left / (remPx * scale), [rightKey]: right / (remPx * scale) };
          document.documentElement.style.setProperty(varName, gridTemplateWith(tracks, live));
        } else {
          freeze();
          const l = colOf(leftKey);
          const r = colOf(rightKey);
          if (l) l.style.width = `${left}px`;
          if (r) r.style.width = `${right}px`;
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
        if (!frozen) return;
        // Пиксели, поставленные на время перетаскивания, меняем на те же
        // доли, что рисует React: он перепишет только то, что изменилось у
        // него самого, а оставшиеся пиксели не тянулись бы с окном.
        const next_ = next ? tableLayout(columns, next, lead) : null;
        let li = 0;
        colEls().forEach((c) => {
          const k = c.dataset.col;
          c.style.width = next_ ? ((k ? next_.cols[k] : next_.lead[li++]) ?? "") : "";
        });
      };

      return {
        /** Сдвинуть границу на `delta` пикселей. `true` — упёрлись в подпись колонки. */
        update(delta: number): boolean {
          const s = splitWidths(leftStart, rightStart, delta, minLeft, minRight);
          left = s.left;
          right = s.right;
          apply();
          return s.clamped;
        },
        commit() {
          const next = { ...base, [leftKey]: toRem(left), [rightKey]: toRem(right) };
          setTable(id, next);
          settle(next);
        },
        cancel() {
          setTable(id, before ?? null);
          settle(before);
        },
      };
    },
    [id, keys, map, columns, mode, setTable, tracks, lead]
  );

  const handle = useCallback(
    (key: string): ReactNode => {
      if (!enabled || !id) return null;
      const index = keys.indexOf(key);
      const leftCol = columns[index];
      const rightCol = columns[index + 1];
      // Граница — между двумя колонками, и обе должны уметь меняться. У
      // правого края таблицы границы нет: таблица всегда во всю ширину.
      if (!leftCol || !rightCol || leftCol.resizable === false || rightCol.resizable === false) return null;
      // Слева числа прижаты вправо, справа текст — влево: содержимое обеих
      // липнет к этой самой границе и двигалось бы только вместе («# | Слово»,
      // «Сумма | Отмечено»). Развести их перетаскиванием нельзя — границы нет.
      if (alignOfColumn(leftCol) === "right" && alignOfColumn(rightCol) === "left") return null;
      const label = `${leftCol.label ?? leftCol.key} и ${rightCol.label ?? rightCol.key}`;

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
        // Упёрлись в подпись соседней колонки — черта границы подсвечивается.
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
          role="separator"
          aria-orientation="vertical"
          aria-label={`Граница между столбцами «${label}»`}
          tabIndex={0}
          title="Потяните, чтобы поделить место между соседними столбцами. Двойной щелчок — вернуть как было"
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

  return { enabled, custom, widthOf, leadWidth, template, handle, colgroup };
}
