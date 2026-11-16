import { describe, expect, it } from "vitest";
import { netTrendVerdict, smoothSeries } from "./netTrend";

describe("smoothSeries", () => {
  it("гасит разовый скачок", () => {
    const s = smoothSeries([100, 100, 1000, 100], 0.4);
    expect(s[0]).toBe(100);
    expect(s[2]).toBeCloseTo(460);
    expect(s[3]).toBeCloseTo(316);
  });
  it("пустой ряд — пустой", () => {
    expect(smoothSeries([])).toEqual([]);
  });
});

describe("netTrendVerdict", () => {
  it("мало месяцев — вывода нет", () => {
    expect(netTrendVerdict([1, 2, 3], 100)).toBeNull();
  });
  it("остаток растёт", () => {
    const v = netTrendVerdict([10_000, 15_000, 22_000, 30_000], 100_000)!;
    expect(v.direction).toBe("up");
    expect(v.tone).toBe("good");
    expect(v.text).toBe("После расходов остаётся всё больше денег");
    expect(v.change).toBe(20_000);
  });
  it("остаток тает", () => {
    const v = netTrendVerdict([30_000, 22_000, 15_000, 10_000], 100_000)!;
    expect(v.direction).toBe("down");
    expect(v.tone).toBe("bad");
  });
  it("изменение меньше 5% среднего расхода — ровно", () => {
    const v = netTrendVerdict([20_000, 21_000, 19_500, 22_000], 100_000)!;
    expect(v.direction).toBe("flat");
    expect(v.tone).toBe("neutral");
  });
  it("в минусе: разрыв сокращается или растёт", () => {
    expect(netTrendVerdict([-40_000, -30_000, -20_000, -10_000], 100_000)!.text).toBe(
      "Расходы всё ещё больше доходов, но разрыв сокращается"
    );
    const worse = netTrendVerdict([-10_000, -20_000, -30_000, -40_000], 100_000)!;
    expect(worse.text).toBe("Расходы больше доходов, и разрыв растёт");
    expect(worse.tone).toBe("bad");
    expect(netTrendVerdict([-20_000, -21_000, -19_000, -20_500], 100_000)!.tone).toBe("bad");
  });
});
