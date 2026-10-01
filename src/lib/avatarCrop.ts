/**
 * Кадр аватара: что из фото попадёт в круг.
 *
 * Окно кадра — квадрат `view` пикселей, в нём фото с масштабом и сдвигом. Фото
 * всегда закрывает окно целиком: при масштабе 1 короткая сторона ровно во всё
 * окно («cover»), сдвинуть его так, чтобы в круге показался пустой край, нельзя.
 * Масштаб меняется вокруг центра окна — то, что в середине круга, остаётся в
 * середине.
 */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

export interface CropState {
  /** Размеры исходного фото в пикселях. */
  w: number;
  h: number;
  /** Сторона окна кадра в пикселях экрана. */
  view: number;
  zoom: number;
  /** Левый верхний угол фото относительно окна, в пикселях экрана (≤ 0). */
  x: number;
  y: number;
}

/** Масштаб, при котором короткая сторона фото — ровно во всё окно. */
export function coverScale(w: number, h: number, view: number): number {
  return view / Math.min(w, h);
}

export function scaleOf(s: Pick<CropState, "w" | "h" | "view" | "zoom">): number {
  return coverScale(s.w, s.h, s.view) * s.zoom;
}

/** Сдвиг, при котором фото закрывает окно: не дальше своих краёв. */
export function clampOffset(s: CropState): CropState {
  const k = scaleOf(s);
  const minX = s.view - s.w * k;
  const minY = s.view - s.h * k;
  return { ...s, x: Math.min(0, Math.max(minX, s.x)), y: Math.min(0, Math.max(minY, s.y)) };
}

/** Новое фото — по центру, масштаб 1. */
export function initialCrop(w: number, h: number, view: number): CropState {
  const k = coverScale(w, h, view);
  return { w, h, view, zoom: 1, x: (view - w * k) / 2, y: (view - h * k) / 2 };
}

/** Масштаб вокруг центра окна (или точки `at` в пикселях окна). */
export function zoomTo(s: CropState, zoom: number, at = { x: s.view / 2, y: s.view / 2 }): CropState {
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  const k0 = scaleOf(s);
  const k1 = scaleOf({ ...s, zoom: z });
  // Точка фото под `at` остаётся под `at`.
  const px = (at.x - s.x) / k0;
  const py = (at.y - s.y) / k0;
  return clampOffset({ ...s, zoom: z, x: at.x - px * k1, y: at.y - py * k1 });
}

export function panBy(s: CropState, dx: number, dy: number): CropState {
  return clampOffset({ ...s, x: s.x + dx, y: s.y + dy });
}

/** Вырез из исходного фото: квадрат под окном, в пикселях фото. */
export function cropRect(s: CropState): { sx: number; sy: number; side: number } {
  const k = scaleOf(s);
  // До тысячных пикселя и без «−0»: хвосты деления в вырез не нужны.
  const r = (v: number) => Math.round(v * 1000) / 1000 + 0;
  return { sx: r(-s.x / k), sy: r(-s.y / k), side: r(s.view / k) };
}
