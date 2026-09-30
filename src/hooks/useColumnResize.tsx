/**
 * Своя ширина столбцов — одна механика на все таблицы и ленты.
 *
 * Включается в «Оформлении» («Своя ширина столбцов»). Пока ширины никто не
 * трогал, таблица выглядит ровно как без настройки: в шапке появляются только
 * границы, за которые можно тянуть. Первое же движение снимает текущие ширины
 * колонок и дальше таблица живёт по ним (модель — в `lib/columnResize.ts`).
 *
 * Во время перетаскивания React не перерисовывает строки: ширина меняется
 * прямо в DOM — у `<col>` таблицы или CSS-переменной сетки ленты. В хранилище
 * уходит только итог, когда кнопку мыши отпустили.
 */
import { useCallback, useMemo, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useDisplayStore } from "../store/useDisplayStore";
import { useColumnWidthsStore } from "../store/useColumnWidthsStore";
import { scaledWidth } from "../components/table/tableKit";
import {
  gridTemplateWith,
  hasWidthsFor,
  liveVarName,
  nextWidth,
  pickFlexIndex,
  pxToRem,
  remWidth,
  resizeTarget,
  type ColumnWidthMap,
} from "../lib/columnResize";

export interface ResizeColumn {
  key: string;
  /** Подпись — для скринридера у границы. */
  label?: string;
  /** Тип колонки таблицы: по нему выбирается резиновая колонка. */
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
  /** Резиновая колонка, если выбор по типам не годится. */
  flexKey?: string;
}

export interface ColumnResize {
  /** Настройка включена и у таблицы есть имя. */
  enabled: boolean;
  /** Действуют свои ширины — таблице нужна фиксированная раскладка. */
  custom: boolean;
  /** CSS-ширина колонки таблицы при своих ширинах; `undefined` — без ширины. */
  widthOf: (key: string) => string | undefined;
  /** Шаблон сетки ленты (в режиме `grid`). */
  template: string;
  /** Не уже этого таблица сжиматься не должна — дальше прокрутка вбок. */
  minWidth: (extraRem?: number) => string | undefined;
  /** Граница справа от колонки — ставится внутрь её ячейки шапки. */
  handle: (key: string) => ReactNode;
  /**
   * `<colgroup>` для таблицы со своей разметкой — только при своих ширинах
   * (иначе `null`, и таблица размечается как раньше). `leading` — ширины
   * колонок перед колонками хука (чекбокс выбора); `className` — классы
   * `<col>`: колонке, которая прячется на узком экране, нужен тот же
   * `hidden xl:table-column`, иначе ячейки строк съедут на её место.
   */
  colgroup: (opts?: { leading?: readonly string[]; className?: Record<string, string> }) => ReactNode;
}

/** Минимум резиновой колонки, когда подпись у неё короткая. */
const FLEX_MIN_PX = 64;
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
  { mode = "table", flexKey: flexKeyOpt }: Options = {}
): ColumnResize {
  const option = useDisplayStore((s) => s.columnResize);
  const enabled = option && !!id;
  const saved = useColumnWidthsStore((s) => (enabled && id ? s.tables[id] : undefined));
  const setTable = useColumnWidthsStore((s) => s.setTable);

  const keys = useMemo(() => columns.map((c) => c.key), [columns]);
  const flexIndex = useMemo(() => {
    const i = flexKeyOpt ? keys.indexOf(flexKeyOpt) : -1;
    return i >= 0 ? i : pickFlexIndex(columns);
  }, [flexKeyOpt, keys, columns]);
  const flexKey = keys[flexIndex];
  const custom = enabled && hasWidthsFor(saved, keys);
  const map = custom ? saved : undefined;

  const widthOf = useCallback(
    (key: string) => {
      if (key === flexKey) return undefined;
      const rem = map?.[key];
      if (rem) return remWidth(rem);
      return scaledWidth(columns.find((c) => c.key === key)?.width);
    },
    [flexKey, map, columns]
  );

  const tracks = useMemo(
    () => columns.map((c) => ({ key: c.key, size: c.size ?? "auto" })),
    [columns]
  );
  const template = useMemo(() => {
    if (mode !== "grid") return "";
    const committed = gridTemplateWith(tracks, map, flexKey);
    return enabled && id ? `var(${liveVarName(id)}, ${committed})` : committed;
  }, [mode, tracks, map, flexKey, enabled, id]);

  const minWidth = useCallback(
    (extraRem = 0) => {
      if (!map) return undefined;
      const sum = keys.reduce((s, k) => s + (k !== flexKey && map[k] ? map[k] : 0), 0);
      const flexRem = FLEX_MIN_PX / 16;
      return remWidth(Math.round((sum + flexRem + extraRem) * 100) / 100);
    },
    [map, keys, flexKey]
  );

  /**
   * Начать правку границы `border`: снять ширины, если своих ещё нет, и
   * вернуть сессию — сдвинуть, записать или отменить.
   */
  const begin = useCallback(
    (handleEl: HTMLElement, border: number) => {
      if (!id) return null;
      const row = handleEl.closest("[data-col]")?.parentElement;
      if (!row) return null;
      const cells = new Map<string, HTMLElement>();
      row.querySelectorAll<HTMLElement>(":scope > [data-col]").forEach((el) => {
        if (el.dataset.col) cells.set(el.dataset.col, el);
      });
      const { index: target, sign } = resizeTarget(border, flexIndex);
      const targetKey = keys[target];
      const targetEl = cells.get(targetKey);
      const flexEl = cells.get(flexKey);
      if (!targetKey || !targetEl || !flexEl) return null;

      const { remPx, scale } = units();
      const px = (el: HTMLElement) => el.getBoundingClientRect().width;
      const before = map;
      let base: ColumnWidthMap;
      if (map) {
        base = { ...map };
      } else {
        // Первый раз: запоминаем ширины как есть, чтобы ничего не прыгнуло.
        // У ленты колонки без права тянуть (чекбокс, кнопки) остаются своей
        // дорожкой; у таблицы — если своя ширина у них есть.
        base = {};
        for (const c of columns) {
          if (c.key === flexKey) continue;
          const locked = c.resizable === false && (mode === "grid" || !!c.width);
          if (locked) continue;
          const el = cells.get(c.key);
          const w = el ? px(el) : 0;
          if (w > 0) base[c.key] = pxToRem(w, remPx, scale);
        }
        setTable(id, base);
      }

      const start = px(targetEl);
      const flexWidth = px(flexEl);
      const min = naturalWidth(targetEl);
      const flexMin = Math.max(naturalWidth(flexEl), FLEX_MIN_PX);
      let current = start;
      const table = handleEl.closest("table");
      const varName = liveVarName(id);

      const apply = (w: number) => {
        if (mode === "grid") {
          const live = { ...base, [targetKey]: w / (remPx * scale) };
          document.documentElement.style.setProperty(varName, gridTemplateWith(tracks, live, flexKey));
        } else {
          const col = table?.querySelector<HTMLElement>(`col[data-col="${CSS.escape(targetKey)}"]`);
          if (col) col.style.width = `${w}px`;
        }
      };
      const settle = (next: ColumnWidthMap | null | undefined) => {
        if (mode === "grid") {
          // Сетка возвращается к сохранённому шаблону уже после перерисовки
          // (React применяет её в микрозадаче), иначе на кадр мелькнули бы
          // прежние ширины. Таймер, а не кадр анимации: в фоновой вкладке
          // кадров нет, и переменная висела бы до возвращения на неё.
          setTimeout(() => document.documentElement.style.removeProperty(varName), 0);
        } else {
          const col = table?.querySelector<HTMLElement>(`col[data-col="${CSS.escape(targetKey)}"]`);
          const rem = next?.[targetKey];
          if (col) col.style.width = rem ? remWidth(rem) : "";
        }
      };

      return {
        update(delta: number) {
          current = nextWidth({ start, delta, sign, min, flexWidth, flexMin });
          apply(current);
        },
        commit() {
          const next = { ...base, [targetKey]: pxToRem(current, remPx, scale) };
          setTable(id, next);
          settle(next);
        },
        cancel() {
          setTable(id, before ?? null);
          settle(before);
        },
      };
    },
    [id, flexIndex, keys, flexKey, map, columns, mode, setTable, tracks]
  );

  const handle = useCallback(
    (key: string): ReactNode => {
      if (!enabled || !id) return null;
      const border = keys.indexOf(key);
      if (border < 0 || border >= keys.length - 1) return null;
      const { index: target } = resizeTarget(border, flexIndex);
      const col = columns[target];
      if (!col || col.resizable === false) return null;
      const label = col.label ?? col.key;

      const onPointerDown = (e: PointerEvent<HTMLElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const el = e.currentTarget;
        const session = begin(el, border);
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
          document.body.classList.remove(RESIZING_CLASS);
          if (ok) session.commit();
          else session.cancel();
        };
        const onMove = (ev: globalThis.PointerEvent) => session.update(ev.clientX - startX);
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
        const session = begin(e.currentTarget, border);
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
          aria-label={`Ширина столбца «${label}»`}
          tabIndex={0}
          title="Потяните, чтобы изменить ширину. Двойной щелчок — вернуть как было"
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
    [enabled, id, keys, flexIndex, columns, begin, setTable]
  );

  const colgroup = useCallback(
    (opts: { leading?: readonly string[]; className?: Record<string, string> } = {}) => {
      if (!custom) return null;
      return (
        <colgroup>
          {opts.leading?.map((w, i) => <col key={`lead-${i}`} style={{ width: w }} />)}
          {keys.map((k) => {
            const w = widthOf(k);
            return (
              <col key={k} data-col={k} className={opts.className?.[k]} style={w ? { width: w } : undefined} />
            );
          })}
        </colgroup>
      );
    },
    [custom, keys, widthOf]
  );

  return { enabled, custom, widthOf, template, minWidth, handle, colgroup };
}
