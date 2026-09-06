import { describe, it, expect } from "vitest";
import { countLive, restorePreflight } from "./restorePreflight";
import type { ZenDiffResponse, ZenMerchant, ZenTag, ZenTransaction } from "./zenmoney";

/**
 * Сущность с тем минимумом полей, который читает сверка: остальные ей не
 * нужны, и заполнять их значило бы делать вид, что они на что-то влияют.
 */
const ent = <T,>(id: string, deleted = false): T =>
  ({ id, deleted }) as unknown as T;

const tx = (id: string, deleted = false) => ent<ZenTransaction>(id, deleted);
const tag = (id: string) => ent<ZenTag>(id);
const merch = (id: string) => ent<ZenMerchant>(id);

const snap = (over: Partial<ZenDiffResponse>): ZenDiffResponse =>
  ({ transaction: [], account: [], tag: [], merchant: [], ...over }) as ZenDiffResponse;

const empty = { transactions: [], accounts: [], tags: [], merchants: [] };

describe("countLive", () => {
  it("считает живых с обеих сторон", () => {
    expect(countLive([tx("a"), tx("b")], [tx("c")])).toEqual({
      inAccount: 1,
      inSnapshot: 2,
    });
  });

  it("удалённых не считает ни там, ни там", () => {
    // В аккаунте тумбстоун заливке не мешает, а из снимка мы его не воскрешаем.
    expect(countLive([tx("a"), tx("b", true)], [tx("c", true)])).toEqual({
      inAccount: 0,
      inSnapshot: 1,
    });
  });

  it("пусто с обеих сторон", () => {
    expect(countLive([], [])).toEqual({ inAccount: 0, inSnapshot: 0 });
  });
});

describe("restorePreflight", () => {
  it("пустой аккаунт готов принять снимок", () => {
    const p = restorePreflight(snap({ transaction: [tx("a")] }), empty);
    expect(p.ready).toBe(true);
    expect(p.blockers).toEqual([]);
    expect(p.transactions).toEqual({ inAccount: 0, inSnapshot: 1 });
  });

  it("живые операции — препятствие: снимок ляжет рядом", () => {
    // Главное отличие от прежней логики: новые id ничего не перезаписывают,
    // поэтому опасность не «не применится», а «удвоится».
    const p = restorePreflight(snap({ transaction: [tx("a")] }), {
      ...empty,
      transactions: [tx("b")],
    });
    expect(p.ready).toBe(false);
    const b = p.blockers.find((x) => x.kind === "notEmpty");
    expect(b?.text).toContain("ляжет РЯДОМ");
    expect(b?.fix).toMatch(/Начать всё сначала/);
  });

  it("тумбстоуны в аккаунте препятствием не считаются", () => {
    // После «Начать всё сначала» строки могут остаться помеченными
    // удалёнными — заливке новыми id это не мешает.
    const p = restorePreflight(snap({ transaction: [tx("a")] }), {
      ...empty,
      transactions: [tx("b", true), tx("c", true)],
    });
    expect(p.ready).toBe(true);
  });

  it("оставшиеся справочники — отдельные препятствия", () => {
    const p = restorePreflight(snap({}), {
      ...empty,
      tags: [tag("t1"), tag("t2")],
      merchants: [merch("m1")],
    });
    expect(p.blockers.map((b) => b.kind).sort()).toEqual([
      "leftoverMerchants",
      "leftoverTags",
    ]);
    expect(p.blockers.find((b) => b.kind === "leftoverTags")?.text).toContain(
      "2 категории"
    );
    expect(p.blockers.find((b) => b.kind === "leftoverMerchants")?.text).toContain(
      "1 контрагент "
    );
  });

  it("склоняет числа по-русски", () => {
    const one = restorePreflight(snap({}), { ...empty, tags: [tag("t")] });
    expect(one.blockers[0].text).toContain("1 категория");

    const many = restorePreflight(snap({}), {
      ...empty,
      tags: Array.from({ length: 11 }, (_, i) => tag(`t${i}`)),
    });
    expect(many.blockers[0].text).toContain("11 категорий");
  });

  it("пустой снимок и пустой аккаунт не роняют расчёт", () => {
    const p = restorePreflight(snap({}), empty);
    expect(p.ready).toBe(true);
    expect(p.transactions.inSnapshot).toBe(0);
  });
});
