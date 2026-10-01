import { describe, it, expect } from "vitest";
import { centerSquare } from "./avatarImage";

describe("centerSquare", () => {
  it("широкое фото — квадрат по центру по высоте", () => {
    expect(centerSquare(1600, 900)).toEqual({ sx: 350, sy: 0, side: 900 });
  });
  it("высокое фото — по ширине", () => {
    expect(centerSquare(900, 1600)).toEqual({ sx: 0, sy: 350, side: 900 });
  });
  it("квадрат — целиком", () => {
    expect(centerSquare(500, 500)).toEqual({ sx: 0, sy: 0, side: 500 });
  });
});
