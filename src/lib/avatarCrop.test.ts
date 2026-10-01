import { describe, it, expect } from "vitest";
import { clampOffset, cropRect, initialCrop, panBy, zoomTo } from "./avatarCrop";

describe("кадр аватара", () => {
  it("новое фото — по центру, короткая сторона во всё окно", () => {
    const s = initialCrop(1600, 900, 240);
    expect(s.zoom).toBe(1);
    expect(s.y).toBe(0);
    expect(cropRect(s)).toEqual({ sx: 350, sy: 0, side: 900 });
  });

  it("сдвиг не открывает пустой край", () => {
    const s = initialCrop(1600, 900, 240);
    const left = panBy(s, 10_000, 10_000);
    expect(left.x).toBe(0);
    expect(left.y).toBe(0);
    expect(cropRect(left)).toEqual({ sx: 0, sy: 0, side: 900 });
    const right = panBy(s, -10_000, 0);
    expect(cropRect(right).sx).toBeCloseTo(700);
  });

  it("масштаб вокруг центра: середина кадра остаётся серединой", () => {
    const s = initialCrop(1000, 1000, 200);
    const z = zoomTo(s, 2);
    const r = cropRect(z);
    expect(r.side).toBeCloseTo(500);
    expect(r.sx + r.side / 2).toBeCloseTo(500);
    expect(r.sy + r.side / 2).toBeCloseTo(500);
  });

  it("масштаб в пределах 1…4", () => {
    const s = initialCrop(1000, 1000, 200);
    expect(zoomTo(s, 0.2).zoom).toBe(1);
    expect(zoomTo(s, 10).zoom).toBe(4);
  });

  it("уменьшение у края возвращает фото на место", () => {
    const s = panBy(zoomTo(initialCrop(1000, 1000, 200), 3), -10_000, -10_000);
    const back = zoomTo(s, 1);
    expect(clampOffset(back)).toEqual(back);
    expect(cropRect(back)).toEqual({ sx: 0, sy: 0, side: 1000 });
  });
});
