import { describe, expect, it } from "vitest";
import { buildObservations, type DigestObservation } from "./digestObservations";
import { buildMonthDigest } from "./digest";
import { tx } from "../test/fixtures";
import type { Transaction } from "../types";

/** Ноябрь 2026: 1-е — воскресенье. По будням 1 000, по выходным 3 000. */
function november(): Transaction[] {
  const out: Transaction[] = [];
  for (let d = 1; d <= 30; d++) {
    const date = `2026-11-${String(d).padStart(2, "0")}`;
    const w = new Date(2026, 10, d).getDay();
    out.push(tx({ date, amount: w === 0 || w === 6 ? 3000 : 1000, kind: "expense" }));
  }
  return out;
}

function obs(list: DigestObservation[], id: DigestObservation["id"]) {
  return list.find((o) => o.id === id);
}

function monthEntry(txs: Transaction[]) {
  return buildMonthDigest(txs, new Date(2026, 10, 1), new Date(2026, 10, 30))!;
}

describe("buildObservations", () => {
  it("выходные против будней — по стоимости одного дня", () => {
    const txs = november();
    const o = obs(buildObservations(txs, monthEntry(txs)), "weekend");
    expect(o).toMatchObject({ id: "weekend", weekendPerDay: 3000, weekdayPerDay: 1000 });
    expect(o && "ratio" in o && o.ratio).toBeCloseTo(3);
  });

  it("самый дорогой день недели — суббота или воскресенье, дороже среднего дня", () => {
    const txs = november();
    const o = obs(buildObservations(txs, monthEntry(txs)), "weekday");
    expect(o && "weekday" in o && [0, 6]).toContain(o && "weekday" in o ? o.weekday : -1);
    expect(o && "ratio" in o ? o.ratio : 0).toBeGreaterThan(1.5);
  });

  it("пять крупных покупок и средний чек; сравнение — с теми же днями до периода", () => {
    const txs = [
      ...november(),
      // Октябрь: 30 покупок по 500.
      ...Array.from({ length: 30 }, (_, i) => tx({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, amount: 500, kind: "expense" })),
    ];
    const list = buildObservations(txs, monthEntry(txs));
    const sum = november().reduce((s, t) => s + t.amountBase, 0);
    expect(obs(list, "concentration")).toMatchObject({ share: 15000 / sum, count: 5, purchases: 30 });
    expect(obs(list, "avgCheck")).toMatchObject({ avg: sum / 30, count: 30, prevAvg: 500 });
  });

  it("половины месяца — только у завершённого месяца", () => {
    const txs = november();
    const entry = monthEntry(txs);
    expect(obs(buildObservations(txs, entry), "halves")).toMatchObject({ id: "halves" });
    const running = { ...entry, running: { day: 20, days: 30 } };
    const list = buildObservations(txs, running);
    expect(obs(list, "halves")).toBeUndefined();
    // У идущего — только прожитые дни: в среднем чеке 20 покупок, не 30.
    expect(obs(list, "avgCheck")).toMatchObject({ count: 20 });
  });

  it("мало покупок — ни среднего чека, ни «пяти крупных»", () => {
    const txs = november().slice(0, 5);
    const list = buildObservations(txs, monthEntry(txs));
    expect(obs(list, "avgCheck")).toBeUndefined();
    expect(obs(list, "concentration")).toBeUndefined();
  });
});
