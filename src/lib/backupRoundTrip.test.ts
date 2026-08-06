import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Полный круг бэкапа: собрали → сериализовали → разобрали → восстановили.
 *
 * Отдельно от `backup.test.ts` (там проверка разбора файла) и от
 * `backupCoverage.test.ts` (там полнота СПИСКА ключей). Здесь — что данные
 * доезжают БЕЗ ПОТЕРЬ, потому что список может быть полным, а значение по
 * дороге всё равно испортиться: санитайзер режет глубокую вложенность, а у
 * правил с группами условий она приличная.
 */

// Хранилище в памяти вместо IndexedDB.
const meta = new Map<string, unknown>();
let transactions: unknown[] = [];
let rates: unknown = null;
let importMeta: unknown = null;

vi.mock("./db", () => ({
  loadJSON: async (k: string) => (meta.has(k) ? meta.get(k) : null),
  saveJSON: async (k: string, v: unknown) => {
    meta.set(k, v);
  },
  loadTransactions: async () => transactions,
  saveTransactions: async (v: unknown[]) => {
    transactions = v;
  },
  loadRates: async () => rates,
  saveRates: async (v: unknown) => {
    rates = v;
  },
  loadImportMeta: async () => importMeta,
  saveImportMeta: async (v: unknown) => {
    importMeta = v;
  },
}));

import {
  buildBackupPayload,
  parseAndValidateBackup,
  restoreBackupPayload,
  BACKUP_META_KEYS,
} from "./backup";

/** Пронести данные через файл: собрать, записать в JSON, разобрать, вернуть. */
async function roundTrip(): Promise<void> {
  const json = JSON.stringify(await buildBackupPayload(), null, 2);
  meta.clear();
  transactions = [];
  rates = null;
  importMeta = null;
  await restoreBackupPayload(
    parseAndValidateBackup(json) as unknown as Record<string, unknown>
  );
}

beforeEach(() => {
  meta.clear();
  transactions = [];
  rates = null;
  importMeta = null;
});

describe("бэкап — курсы", () => {
  it("таблица курсов возвращается как была", () => {
    rates = { base: "RUB", rates: { USD: 90.5, EUR: 99.1234, KZT: 0.19 } };
    const before = structuredClone(rates);
    return roundTrip().then(() => expect(rates).toEqual(before));
  });

  it("исторические курсы ЦБ по датам восстанавливаются полностью", async () => {
    // Их пере-загрузка идёт не быстрее запроса в секунду — потерять их значит
    // обречь человека на минуты ожидания, а при лежащем зеркале на неверные
    // суммы.
    const hist: Record<string, Record<string, number>> = {};
    for (let i = 1; i <= 40; i++) {
      const day = `2026-01-${String(i).padStart(2, "0")}`;
      hist[day] = { USD: 80 + i / 10, EUR: 90 + i / 10, KZT: 0.1712 };
    }
    // Пропуск (выходной) — записан как «курса нет» и должен таким и остаться.
    hist["2026-02-01"] = {};
    meta.set("histDayRates", hist);

    await roundTrip();
    const after = meta.get("histDayRates") as typeof hist;
    expect(Object.keys(after)).toHaveLength(41);
    expect(after).toEqual(hist);
    // Дробная часть — это курс; округление сломало бы суммы.
    expect(after["2026-01-07"].USD).toBe(80.7);
    expect(after["2026-02-01"]).toEqual({});
  });

  it("исторические курсы входят в список бэкапа", () => {
    expect(BACKUP_META_KEYS as readonly string[]).toContain("histDayRates");
  });
});

describe("бэкап — правила категоризации", () => {
  /** Правила всех поколений: они лежат вперемешку у давних пользователей. */
  const rules = [
    // V1: плоское, старейшее.
    { id: "r1", enabled: true, field: "payee", op: "contains", value: "кофе", category: "Еда" },
    // V2 плоское: массив условий без групп.
    {
      id: "r2",
      name: "Такси",
      enabled: true,
      conditions: [
        { field: "payee", op: "contains", value: "яндекс" },
        { field: "amount", op: "lt", value: 2000 },
      ],
      join: "and",
      set: { category: "Транспорт", subcategory: "Такси" },
    },
    // V2 с группами условий — самая глубокая структура, что у нас есть.
    {
      id: "r3",
      name: "Кафе по выходным",
      enabled: false,
      autoApply: true,
      join: "or",
      groups: [
        {
          id: "g1",
          join: "and",
          conditions: [
            { field: "payee", op: "contains", value: "кафе" },
            { field: "comment", op: "notContains", value: "рабочий" },
          ],
        },
        {
          id: "g2",
          join: "and",
          conditions: [{ field: "category", op: "eq", value: "Развлечения" }],
        },
      ],
      set: { category: "Еда", subcategory: "Кафе", payee: "Кафе", comment: "выходные" },
    },
  ];

  it("все поколения правил переживают круг без потерь", async () => {
    meta.set("categoryRules", rules);
    await roundTrip();
    expect(meta.get("categoryRules")).toEqual(rules);
  });

  it("группы условий не срезаются ограничением вложенности", async () => {
    // Санитайзер обрубает всё глубже двенадцати уровней, возвращая null. У
    // правила с группами уровней около десяти — впритык, и молчаливая потеря
    // условий выглядела бы как «правило перестало срабатывать».
    meta.set("categoryRules", rules);
    await roundTrip();
    const restored = meta.get("categoryRules") as typeof rules;
    const deep = restored.find((r) => r.id === "r3")!;
    expect(deep.groups).toHaveLength(2);
    expect(deep.groups![0].conditions).toHaveLength(2);
    expect(deep.groups![0].conditions[0].value).toBe("кафе");
    expect(deep.groups![1].conditions[0].field).toBe("category");
  });

  it("до предела вложенности остаётся запас", async () => {
    // Санитайзер режет глубже двенадцати уровней, возвращая null. Сейчас
    // правило с группами укладывается с запасом — тест фиксирует это, чтобы
    // следующее усложнение структуры не обрубило условия молча.
    const depth = (v: unknown, d = 0): number =>
      v && typeof v === "object"
        ? Math.max(d, ...Object.values(v as object).map((x) => depth(x, d + 1)))
        : d;
    // Считаем от корня файла — санитайзер меряет так же.
    const fromRoot = depth({ categoryRules: rules });
    expect(fromRoot).toBeLessThanOrEqual(8);
  });

  it("автоприменение и выключенность сохраняются", async () => {
    // `autoApply` уже терялся однажды при нормализации — поле необязательное,
    // и его легко не заметить.
    meta.set("categoryRules", rules);
    await roundTrip();
    const restored = meta.get("categoryRules") as typeof rules;
    const r3 = restored.find((r) => r.id === "r3")!;
    expect(r3.autoApply).toBe(true);
    expect(r3.enabled).toBe(false);
    expect(restored.find((r) => r.id === "r1")!.enabled).toBe(true);
  });

  it("порядок правил сохраняется — от него зависит, какое сработает первым", async () => {
    meta.set("categoryRules", rules);
    await roundTrip();
    expect((meta.get("categoryRules") as typeof rules).map((r) => r.id)).toEqual([
      "r1",
      "r2",
      "r3",
    ]);
  });

  it("пустой набор правил не превращается в «правил нет»", async () => {
    meta.set("categoryRules", []);
    await roundTrip();
    expect(meta.get("categoryRules")).toEqual([]);
  });
});

describe("бэкап — круг целиком", () => {
  it("ни один ключ из списка не теряется по дороге", async () => {
    // Значения нарочно разной формы: массив, объект, число, строка, булево.
    const sample: Record<string, unknown> = {};
    BACKUP_META_KEYS.forEach((k, i) => {
      sample[k] = i % 4 === 0 ? [{ id: `${k}-1` }] : i % 4 === 1 ? { [k]: i } : i % 4 === 2 ? i : true;
      meta.set(k, sample[k]);
    });
    transactions = [{ id: "t1", date: "2026-08-01" }];
    rates = { base: "RUB", rates: { USD: 90 } };

    await roundTrip();
    const lost = BACKUP_META_KEYS.filter(
      (k) => JSON.stringify(meta.get(k)) !== JSON.stringify(sample[k])
    );
    expect(lost).toEqual([]);
    expect(transactions).toHaveLength(1);
    expect(rates).toEqual({ base: "RUB", rates: { USD: 90 } });
  });

  it("ключ со значением null восстанавливается как null, а не пропадает", async () => {
    meta.set("categoryRules", null);
    await roundTrip();
    expect(meta.get("categoryRules")).toBeNull();
  });
});
