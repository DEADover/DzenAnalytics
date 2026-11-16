import { describe, expect, it } from "vitest";
import { maskTime, parseTypedTime, shiftTime } from "./timeInput";

describe("maskTime", () => {
  it("ставит двоеточие само", () => {
    expect(maskTime("1")).toBe("1");
    expect(maskTime("12")).toBe("12:");
    expect(maskTime("123")).toBe("12:3");
    expect(maskTime("1234")).toBe("12:34");
    expect(maskTime("12345")).toBe("12:34");
  });
  it("час и минуты из одной цифры дополняет нулём", () => {
    expect(maskTime("9")).toBe("09:");
    expect(maskTime("930")).toBe("09:30");
    expect(maskTime("25")).toBe("02:5");
    expect(maskTime("127")).toBe("12:07");
  });
  it("принимает любой разделитель", () => {
    expect(maskTime("9:3")).toBe("09:3");
    expect(maskTime("9.30")).toBe("09:30");
    expect(maskTime("14 05")).toBe("14:05");
  });
  it("не знает «AM/PM» и прочих букв", () => {
    expect(maskTime("02:30 PM")).toBe("02:30");
    expect(maskTime("abc")).toBe("");
  });
  it("даёт стереть двоеточие", () => {
    expect(maskTime("12", true)).toBe("12");
    expect(maskTime("12:", true)).toBe("12:");
    expect(maskTime("12:3", true)).toBe("12:3");
  });
});

describe("parseTypedTime", () => {
  it("разбирает полное и недописанное", () => {
    expect(parseTypedTime("14:05")).toBe("14:05");
    expect(parseTypedTime("9")).toBe("09:00");
    expect(parseTypedTime("12:")).toBe("12:00");
    expect(parseTypedTime("12:3")).toBe("12:03");
    expect(parseTypedTime("2359")).toBe("23:59");
    expect(parseTypedTime("1")).toBe("01:00");
  });
  it("пустое — не время", () => {
    expect(parseTypedTime("")).toBeNull();
    expect(parseTypedTime("  ")).toBeNull();
  });
});

describe("shiftTime", () => {
  it("идёт по кругу суток", () => {
    expect(shiftTime("23:59", 1)).toBe("00:00");
    expect(shiftTime("00:00", -1)).toBe("23:59");
    expect(shiftTime("09:30", 60)).toBe("10:30");
  });
});
