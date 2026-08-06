import { describe, it, expect } from "vitest";
import { buildDigestHistory } from "./digest";
import { tx } from "../test/fixtures";
import type { Transaction } from "../types";

/** Пара операций в каждом из перечисленных месяцев. */
function monthly(months: string[]): Transaction[] {
  const out: Transaction[] = [];
  for (const m of months) {
    out.push(tx({ date: `${m}-05`, amount: 1000, kind: "expense" }));
    out.push(tx({ date: `${m}-20`, amount: 5000, kind: "income" }));
  }
  return out;
}

const labels = (txs: Transaction[], today: Date) =>
  buildDigestHistory(txs, today)
    .filter((e) => e.period === "month")
    .map((e) => e.label);

describe("buildDigestHistory: месяцы", () => {
  it("последний месяц — прошлый календарный, а не месяц последней операции", () => {
    // Данные идут по август, сегодня 5 августа: в своде должен быть июль.
    // Текущий месяц не берём — он ещё не кончился.
    const out = labels(
      monthly(["2026-05", "2026-06", "2026-07", "2026-08"]),
      new Date(2026, 7, 5)
    );
    expect(out[0]).toBe("Июль 2026");
    expect(out).not.toContain("Август 2026");
  });

  it("месяц с данными не выпадает, если операция в нём одна и первого числа", () => {
    // Границу окна раньше считали от даты, разобранной как UTC, а месяцы — по
    // местному времени. К западу от Гринвича последний месяц с данными из-за
    // этого выпадал целиком.
    const txs = [
      ...monthly(["2026-05", "2026-06"]),
      tx({ date: "2026-07-01", amount: 700, kind: "expense" }),
    ];
    expect(labels(txs, new Date(2026, 7, 5))[0]).toBe("Июль 2026");
  });

  it("месяц без операций просто отсутствует и не обрывает свод", () => {
    // Пропуск в данных — не повод потерять всё, что было раньше.
    const out = labels(monthly(["2026-05", "2026-06", "2026-08"]), new Date(2026, 7, 5));
    expect(out).toEqual(["Июнь 2026", "Май 2026"]);
  });

  it("первого числа последним считается предыдущий месяц", () => {
    const out = labels(monthly(["2026-06", "2026-07"]), new Date(2026, 7, 1));
    expect(out[0]).toBe("Июль 2026");
  });

  it("сортировка — от свежего к старому", () => {
    const out = labels(monthly(["2026-05", "2026-06", "2026-07"]), new Date(2026, 7, 5));
    expect(out).toEqual(["Июль 2026", "Июнь 2026", "Май 2026"]);
  });
});
