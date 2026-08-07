import { describe, it, expect } from "vitest";
import { buildDigestHistory, buildMonthDigest } from "./digest";
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

describe("buildDigestHistory: недели", () => {
  const day = (iso: string) => tx({ date: iso, amount: 100, kind: "expense" });

  it("недель не меньше, чем месяцев: обе ленты идут до начала данных", () => {
    // На истории в два года было тридцать с лишним месяцев и ровно двадцать
    // шесть недель — лента обрывалась на полугодии.
    const txs = [];
    for (let y = 2024; y <= 2026; y++)
      for (let m = 1; m <= 12; m++)
        for (const d of ["05", "15", "25"])
          txs.push(day(`${y}-${String(m).padStart(2, "0")}-${d}`));
    const hist = buildDigestHistory(txs, new Date(2026, 7, 7));
    const weeks = hist.filter((e) => e.period === "week").length;
    const months = hist.filter((e) => e.period === "month").length;
    expect(months).toBeGreaterThan(26);
    expect(weeks).toBeGreaterThan(months);
  });

  it("недели не уходят раньше первой операции", () => {
    const hist = buildDigestHistory(
      [day("2026-07-15"), day("2026-07-16")],
      new Date(2026, 7, 7)
    );
    const weeks = hist.filter((e) => e.period === "week");
    expect(weeks).toHaveLength(1);
    expect(weeks[0].start >= "2026-07-13").toBe(true);
  });

  it("текущая неделя в ленту не идёт — она ещё не закончилась", () => {
    // 7 августа 2026 — пятница; неделя с 3-го числа неполная.
    const hist = buildDigestHistory([day("2026-08-05")], new Date(2026, 7, 7));
    expect(hist.filter((e) => e.period === "week")).toHaveLength(0);
  });
});

describe("вырезание отрезка двоичным поиском", () => {
  it("даёт ровно тот же результат, что и обычный фильтр", () => {
    // Сенсор на оптимизацию: границы у двоичного поиска легко сдвинуть на
    // единицу, и период тихо потеряет первый или последний день.
    const txs: Transaction[] = [];
    for (let d = 1; d <= 28; d++)
      for (const k of ["expense", "income"] as const)
        txs.push(tx({ date: `2026-06-${String(d).padStart(2, "0")}`, amount: d * 10, kind: k }));
    // Перемешиваем: на вход строителям приходит неотсортированный массив.
    const shuffled = txs.filter((_, i) => i % 3 === 0).concat(txs.filter((_, i) => i % 3 !== 0));
    const start = new Date(2026, 5, 1);
    const end = new Date(2026, 5, 30);

    const plain = buildMonthDigest(shuffled, start, end);
    const sorted = buildMonthDigest(
      [...shuffled].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
      start,
      end,
      true
    );
    expect(sorted?.expense).toBe(plain?.expense);
    expect(sorted?.income).toBe(plain?.income);
    expect(sorted?.txCount).toBe(plain?.txCount);
    expect(sorted?.prevExpense).toBe(plain?.prevExpense);
  });

  it("границы отрезка включительные с обеих сторон", () => {
    const txs = [
      tx({ date: "2026-05-31", amount: 1, kind: "expense" }),
      tx({ date: "2026-06-01", amount: 10, kind: "expense" }),
      tx({ date: "2026-06-30", amount: 100, kind: "expense" }),
      tx({ date: "2026-07-01", amount: 1000, kind: "expense" }),
    ];
    const d = buildMonthDigest(txs, new Date(2026, 5, 1), new Date(2026, 5, 30), true);
    // Первое и последнее число месяца внутри, соседние дни — снаружи.
    expect(d?.expense).toBe(110);
    expect(d?.prevExpense).toBe(1);
  });
});
