import { describe, it, expect, beforeEach, vi } from "vitest";

// Хранилище в памяти вместо IndexedDB: массовая правка обязана доехать до диска
// целиком — именно на этом стыке она и терялась.
const disk = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../lib/db", () => ({
  loadJSON: async (key: string) => disk.get(key) ?? null,
  saveJSON: async (key: string, value: unknown) => {
    disk.set(key, JSON.parse(JSON.stringify(value)));
  },
}));

import { useBudgetsStore, type PlanUpsert } from "./useBudgetsStore";
import { plannedFor, type BudgetLine } from "../lib/budgets";
import { plannedOpsByTagMonth, zenPlanList } from "../lib/zenBudgets";
import { buildBudgetYear } from "../lib/budgetYear";
import type { ZenBudget, ZenInstrument, ZenReminderMarker, ZenTag } from "../lib/zenmoney";

const KEY = "budgetsV2";

function upsert(p: Partial<PlanUpsert>): PlanUpsert {
  return {
    kind: "expense",
    category: "Еда",
    subcategory: null,
    ym: "2026-08",
    amount: 1000,
    ...p,
  };
}

/** План статьи на месяц ПО ТОМУ, ЧТО ЛЕЖИТ НА ДИСКЕ. */
function stored(
  category: string,
  subcategory: string | null,
  ym: string
): number {
  const lines = (disk.get(KEY) as BudgetLine[] | undefined) ?? [];
  const l = lines.find(
    (x) => x.category === category && (x.subcategory ?? null) === subcategory
  );
  return l ? plannedFor(l, ym) : 0;
}

beforeEach(async () => {
  disk.clear();
  useBudgetsStore.setState({ lines: [], loaded: true });
});

describe("applyPlans", () => {
  it("сохраняет ВСЕ статьи за один вызов, а не последнюю", async () => {
    // Ровно та ошибка, из-за которой «Заполнить по среднему» доносило одну
    // строку из шести: поштучные addLine читали список до записи соседа.
    await useBudgetsStore.getState().applyPlans([
      upsert({ category: "Еда", amount: 20_000 }),
      upsert({ category: "Еда", subcategory: "Кафе", amount: 5000 }),
      upsert({ category: "Дом", subcategory: "Ремонт", amount: 45_000 }),
      upsert({ category: "Зарплата", kind: "income", amount: 200_000 }),
    ]);
    expect(useBudgetsStore.getState().lines).toHaveLength(4);
    expect(stored("Еда", null, "2026-08")).toBe(20_000);
    expect(stored("Еда", "Кафе", "2026-08")).toBe(5000);
    expect(stored("Дом", "Ремонт", "2026-08")).toBe(45_000);
    expect(stored("Зарплата", null, "2026-08")).toBe(200_000);
  });

  it("правит существующую строку, а не заводит вторую", async () => {
    await useBudgetsStore.getState().applyPlans([upsert({ amount: 1000 })]);
    await useBudgetsStore.getState().applyPlans([upsert({ amount: 3000 })]);
    expect(useBudgetsStore.getState().lines).toHaveLength(1);
    expect(stored("Еда", null, "2026-08")).toBe(3000);
  });

  it("не трогает планы других месяцев", async () => {
    await useBudgetsStore.getState().applyPlans([upsert({ ym: "2026-07", amount: 900 })]);
    await useBudgetsStore.getState().applyPlans([upsert({ ym: "2026-08", amount: 1000 })]);
    expect(stored("Еда", null, "2026-07")).toBe(900);
    expect(stored("Еда", null, "2026-08")).toBe(1000);
  });

  it("родитель и под-категория — разные статьи", async () => {
    await useBudgetsStore.getState().applyPlans([
      upsert({ amount: 1000 }),
      upsert({ subcategory: "Кафе", amount: 2000 }),
    ]);
    expect(stored("Еда", null, "2026-08")).toBe(1000);
    expect(stored("Еда", "Кафе", "2026-08")).toBe(2000);
  });

  it("расход и доход под одним тегом не сливаются", async () => {
    await useBudgetsStore.getState().applyPlans([
      upsert({ category: "Банки", amount: 1000 }),
      upsert({ category: "Банки", kind: "income", amount: 1500 }),
    ]);
    const lines = useBudgetsStore.getState().lines;
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => [l.kind, plannedFor(l, "2026-08")])).toEqual([
      ["expense", 1000],
      ["income", 1500],
    ]);
  });

  it("нулевую сумму новой строкой не заводит", async () => {
    await useBudgetsStore.getState().applyPlans([upsert({ amount: 0 })]);
    expect(useBudgetsStore.getState().lines).toEqual([]);
  });

  it("нулевой суммой снимает план с существующей строки", async () => {
    await useBudgetsStore.getState().applyPlans([upsert({ amount: 1000 })]);
    await useBudgetsStore.getState().applyPlans([upsert({ amount: 0 })]);
    expect(stored("Еда", null, "2026-08")).toBe(0);
  });

  it("пустой список ничего не пишет", async () => {
    await useBudgetsStore.getState().applyPlans([]);
    expect(disk.has(KEY)).toBe(false);
  });
});

describe("плановые операции в цифрах бюджета", () => {
  // Дзен-мани считает план незалоченной статьи как «записанная сумма ПЛЮС
  // запланированные операции этого месяца, которые ещё впереди». Мы повторяем
  // это при синхронизации — и здесь проверяем, что результат доезжает и до
  // месячного вида, и до годового: цифры и полосы читают одни и те же строки.
  const rub: ZenInstrument = { id: 2, title: "RUB", shortTitle: "RUB", symbol: "₽", rate: 1 };
  const workTag: ZenTag = {
    id: "work", user: 1, changed: 0, title: "Работа", parent: null, archive: false,
    showIncome: true, showOutcome: false, budgetIncome: true, budgetOutcome: false,
    required: null, color: null, icon: null, picture: null,
  };
  const zenBudget: ZenBudget = {
    user: 1, changed: 0, date: "2026-08-01", tag: "work",
    income: 145_000, incomeLock: false, outcome: 0, outcomeLock: false,
  };
  const advance: ZenReminderMarker = {
    id: "аванс", user: 1, changed: 0, date: "2026-08-25", income: 160_000,
    incomeInstrument: 2, outcome: 0, outcomeInstrument: 2, tag: ["work"],
    reminder: "r1", state: "planned",
  };

  /** Ровно та цепочка, что отрабатывает синхронизация. */
  async function importWithPlanned(markers: ZenReminderMarker[], today: string) {
    const planned = plannedOpsByTagMonth(markers, [rub], 2, today);
    await useBudgetsStore
      .getState()
      .importFromZen(zenPlanList([zenBudget], [workTag], planned));
    return useBudgetsStore.getState().lines;
  }

  it("запланированный аванс входит и в план месяца, и в годовую таблицу", async () => {
    const lines = await importWithPlanned([advance], "2026-08-01");
    // Месячный вид: карточки и полосы считают план через `plannedFor`.
    expect(plannedFor(lines[0], "2026-08")).toBe(305_000);
    // Годовой свод: та же строка, тот же месяц.
    const year = buildBudgetYear(lines, [], 2026);
    const row = year.income.groups[0].total;
    expect(row.cells[7].plan).toBe(305_000); // август
    expect(row.plan).toBe(305_000); // и за год столько же — план только на август
    expect(year.income.totals[7].plan).toBe(305_000);
  });

  it("на факт плановая операция не влияет — она ещё не случилась", async () => {
    const lines = await importWithPlanned([advance], "2026-08-01");
    const year = buildBudgetYear(lines, [], 2026);
    expect(year.income.groups[0].total.fact).toBe(0);
    expect(year.income.totals[7].fact).toBe(0);
  });

  it("исполненный план в цифры второй раз не идёт", async () => {
    // Зарплата пришла 10-го: её план остался в кэше, но место уже занял факт.
    const paid: ZenReminderMarker = { ...advance, id: "зарплата", date: "2026-08-10" };
    const lines = await importWithPlanned([advance, paid], "2026-08-11");
    expect(plannedFor(lines[0], "2026-08")).toBe(305_000);
  });
});

describe("importFromZen — задвоения статей", () => {
  it("КЛЮЧЕВОЕ: переименованная в Дзен-мани статья не заводит вторую строку", async () => {
    // Строка опознаётся ТЕГОМ. Раньше опознавалась именем: после
    // переименования синк не находил строку и создавал новую, а старая
    // оставалась — на экране две одинаковых с виду статьи с разными планами.
    await useBudgetsStore.getState().importFromZen([
      {
        kind: "income",
        tagId: "tag-cashback",
        category: "Банк",
        subcategory: "Cashback",
        ym: "2026-07",
        amount: 3413.55,
      },
    ]);
    expect(useBudgetsStore.getState().lines).toHaveLength(1);

    // тот же тег, новое имя и новый месяц
    await useBudgetsStore.getState().importFromZen([
      {
        kind: "income",
        tagId: "tag-cashback",
        category: "Банк",
        subcategory: "Cash back",
        ym: "2026-08",
        amount: 4209,
      },
    ]);
    const lines = useBudgetsStore.getState().lines;
    expect(lines).toHaveLength(1);
    expect(lines[0].subcategory).toBe("Cash back");
    expect(lines[0].overrides).toEqual({ "2026-07": 3413.55, "2026-08": 4209 });
  });

  it("две РАЗНЫЕ статьи с одинаковым названием остаются разными", async () => {
    // В Дзен-мани так бывает; складывать их планы в одну строку — соврать.
    await useBudgetsStore.getState().importFromZen([
      { kind: "expense", tagId: "t1", category: "Прочее", subcategory: null, ym: "2026-08", amount: 100 },
      { kind: "expense", tagId: "t2", category: "Прочее", subcategory: null, ym: "2026-08", amount: 200 },
    ]);
    const lines = useBudgetsStore.getState().lines;
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.overrides?.["2026-08"]).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      100, 200,
    ]);
  });

  it("строка без тега получает его при первой же синхронизации", async () => {
    await useBudgetsStore.getState().addLine({
      category: "Банк",
      subcategory: "Cash back",
      kind: "income",
      amount: 0,
      recurrence: "monthly",
      startMonth: "2026-08",
      endMonth: null,
      overrides: { "2026-08": 1000 },
    });
    await useBudgetsStore.getState().importFromZen([
      {
        kind: "income",
        tagId: "tag-cashback",
        category: "Банк",
        subcategory: "Cash back",
        ym: "2026-08",
        amount: 4209,
      },
    ]);
    const lines = useBudgetsStore.getState().lines;
    expect(lines).toHaveLength(1);
    expect(lines[0].tagId).toBe("tag-cashback");
  });
});

describe("adoptTags — имена статей вслед за справочником", () => {
  const tag = (id: string, title: string, parent: string | null = null): ZenTag =>
    ({ id, title, parent, archive: false }) as unknown as ZenTag;

  const line = (over: Partial<BudgetLine>): BudgetLine => ({
    id: over.id ?? `l-${Math.random().toString(36).slice(2, 7)}`,
    category: "Еда",
    subcategory: null,
    kind: "expense",
    amount: 1000,
    recurrence: "monthly",
    startMonth: "2026-01",
    endMonth: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  });

  const lines = () => useBudgetsStore.getState().lines;

  it("КЛЮЧЕВОЕ: переименовали РОДИТЕЛЯ — под-строка узнаёт новое имя", async () => {
    // Ровно случай из issue #77: у под-категории свой тег цел, плана у неё в
    // Дзен-мани нет, поэтому синхронизация планов до строки не доходит — и она
    // остаётся с прежним именем родителя, повисая призраком с нулевым фактом.
    useBudgetsStore.setState({
      lines: [line({ id: "l1", tagId: "t-cafe", category: "Еда", subcategory: "Кафе" })],
      loaded: true,
    });
    await useBudgetsStore.getState().adoptTags([
      tag("t-food", "Питание"),
      tag("t-cafe", "Кафе", "t-food"),
    ]);
    expect(lines()[0]).toMatchObject({ category: "Питание", subcategory: "Кафе" });
    expect(lines()).toHaveLength(1);
  });

  it("переименованная строка сливается с уже существующим двойником", async () => {
    // Иначе на экране две одинаковые статьи, а план родителя — их сумма.
    useBudgetsStore.setState({
      lines: [
        line({ id: "old", tagId: "t-food", category: "Еда", overrides: { "2026-08": 5000 } }),
        line({ id: "new", tagId: "t-food", category: "Питание", overrides: { "2026-09": 7000 } }),
      ],
      loaded: true,
    });
    await useBudgetsStore.getState().adoptTags([tag("t-food", "Питание")]);
    expect(lines()).toHaveLength(1);
    expect(lines()[0].overrides).toMatchObject({ "2026-08": 5000, "2026-09": 7000 });
  });

  it("строке без тега проставляется тег живой категории с тем же именем", async () => {
    // После этого следующее переименование её уже не осиротит. Хвостовой
    // пробел совпасть не мешает — его не видно, а вторую статью он делал.
    useBudgetsStore.setState({
      lines: [line({ id: "l1", category: "Еда ", subcategory: null })],
      loaded: true,
    });
    await useBudgetsStore.getState().adoptTags([tag("t-food", "Еда")]);
    expect(lines()[0].tagId).toBe("t-food");
  });

  it("имя в другом регистре — другая категория, тег не проставляем", async () => {
    // Регистр в Дзен-мани различает теги, и склейка строк бюджета считает так
    // же: «еда» и «Еда» — две разные статьи, привязывать вслепую нельзя.
    useBudgetsStore.setState({
      lines: [line({ id: "l1", category: "еда" })],
      loaded: true,
    });
    await useBudgetsStore.getState().adoptTags([tag("t-food", "Еда")]);
    expect(lines()[0].tagId).toBeUndefined();
  });

  it("неоднозначное имя тегом не штампуется", async () => {
    // Два тега с одинаковым путём: угадывать, к какому привязаться, нельзя.
    useBudgetsStore.setState({ lines: [line({ id: "l1", category: "Еда" })], loaded: true });
    await useBudgetsStore.getState().adoptTags([tag("t1", "Еда"), tag("t2", "Еда")]);
    expect(lines()[0].tagId).toBeUndefined();
  });

  it("КЛЮЧЕВОЕ: строку с неизвестным тегом не трогаем и не удаляем", async () => {
    // Тег мог уехать в архив или прийти следующей страницей синхронизации —
    // потерять из-за этого план человека нельзя.
    useBudgetsStore.setState({
      lines: [line({ id: "l1", tagId: "t-gone", category: "Хобби" })],
      loaded: true,
    });
    await useBudgetsStore.getState().adoptTags([tag("t-food", "Еда")]);
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({ tagId: "t-gone", category: "Хобби" });
  });

  it("когда менять нечего — на диск не ходим", async () => {
    useBudgetsStore.setState({
      lines: [line({ id: "l1", tagId: "t-food", category: "Еда" })],
      loaded: true,
    });
    disk.clear();
    await useBudgetsStore.getState().adoptTags([tag("t-food", "Еда")]);
    expect(disk.has(KEY)).toBe(false);
  });
});
