import { describe, it, expect } from "vitest";
import { hexToColorInt, colorIntToHex, cssRgbToHex } from "./categoryColor";

describe("category colour codec (Zenmoney packed RGB int)", () => {
  it("hex → int uses low 24 bits (alpha 0, matches Zenmoney)", () => {
    expect(hexToColorInt("#FF0000")).toBe(0xff0000);
    expect(hexToColorInt("#000000")).toBe(0);
    expect(hexToColorInt("112233")).toBe(0x112233); // no leading #
  });

  it("int → hex round-trips", () => {
    for (const hex of ["#FF0000", "#00FF00", "#0000FF", "#123456", "#FBBF24"]) {
      expect(colorIntToHex(hexToColorInt(hex)!)).toBe(hex);
    }
  });

  it("int → hex reads only the low 24 bits (ignores alpha byte)", () => {
    // Zenmoney sometimes stores an alpha byte; the RGB must survive.
    expect(colorIntToHex(0xff112233 | 0)).toBe("#112233");
  });

  it("null / malformed input → null", () => {
    expect(colorIntToHex(null)).toBeNull();
    expect(colorIntToHex(undefined)).toBeNull();
    expect(hexToColorInt("nope")).toBeNull();
    expect(hexToColorInt("#12345")).toBeNull(); // wrong length
  });

  it("cssRgbToHex parses the decoder's rgb() output and passes hex through", () => {
    expect(cssRgbToHex("rgb(255, 191, 36)")).toBe("#FFBF24");
    expect(cssRgbToHex("#abcdef")).toBe("#ABCDEF");
    expect(cssRgbToHex(null)).toBeNull();
    expect(cssRgbToHex("teal")).toBeNull();
  });
});
