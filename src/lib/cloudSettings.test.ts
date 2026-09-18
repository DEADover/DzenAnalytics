import { describe, it, expect } from "vitest";
import {
  CLOUD_APP,
  EMPTY_RULES_META,
  SERVICE_ACCOUNT_TITLE,
  TOMBSTONE_TTL_MS,
  buildDocReminder,
  envelopeComment,
  findCloudDocs,
  isServiceAccountTitle,
  mergeFields,
  mergeRulesDocs,
  metaFromRulesDoc,
  nextChanged,
  parseEnvelope,
  readCollectionMeta,
  rulesDocFromLocal,
  rulesFromDoc,
  sanitizeFieldMap,
  sanitizeRulesDoc,
  stableStringify,
  stampFieldChanges,
  stampRuleChanges,
  type RulesDoc,
} from "./cloudSettings";
import type { ZenAccount, ZenReminder } from "./zenmoney";

type R = { id: string; createdAt: string; value: string };
const rule = (id: string, value = id, createdAt = "2026-01-01"): R => ({ id, value, createdAt });
const doc = (
  items: Record<string, [number, R]>,
  order: string[],
  orderAt = 0,
  deleted: Record<string, number> = {}
): RulesDoc<R> => ({
  items: Object.fromEntries(Object.entries(items).map(([id, [at, r]]) => [id, { at, rule: r }])),
  order: { ids: order, at: orderAt },
  deleted,
});

describe("формат записи", () => {
  it("своё читается, чужое и битое — нет", () => {
    const own = envelopeComment("settings", { fields: {} }, 5);
    expect(parseEnvelope(own)).toMatchObject({ app: CLOUD_APP, type: "settings", v: 1, at: 5 });
    // Данные Zerro в том же аккаунте.
    expect(parseEnvelope(JSON.stringify({ type: "budgets", payload: {} }))).toBeNull();
    expect(parseEnvelope("{битый")).toBeNull();
    expect(parseEnvelope("Обычный комментарий")).toBeNull();
    expect(parseEnvelope(JSON.stringify({ app: CLOUD_APP, type: "бюджеты", v: 1, at: 1, data: {} }))).toBeNull();
  });

  it("сравнение не зависит от порядка ключей", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [3, 1] } })).toBe(
      stableStringify({ a: { c: [3, 1], d: 2 }, b: 1 })
    );
  });

  it("changed не меньше серверного — иначе сервер молча отбросит правку", () => {
    expect(nextChanged(undefined, 100)).toBe(100);
    expect(nextChanged(50, 100)).toBe(100);
    // Часы устройства отстают от записи на сервере.
    expect(nextChanged(500, 100)).toBe(501);
  });
});

describe("служебный счёт и записи в кэше", () => {
  const acc = (id: string, title: string) => ({ id, title }) as ZenAccount;
  const rem = (id: string, account: string, comment: string) =>
    buildDocReminder({ id, user: 1, accountId: account, instrument: 2, comment, changed: 1 });

  it("находит наши записи по типам и счёт по ним", () => {
    const found = findCloudDocs({
      accounts: [acc("svc", "Переименовали"), acc("card", "Карта")],
      reminders: [
        rem("r1", "svc", envelopeComment("settings", { fields: {} }, 1)),
        rem("r2", "svc", envelopeComment("rules", { items: {} }, 1)),
        rem("z", "card", JSON.stringify({ type: "budgets", payload: {} })),
        { id: "plan", comment: "Аренда" } as ZenReminder,
      ],
    });
    expect(found.byType.settings.map((d) => d.reminder.id)).toEqual(["r1"]);
    expect(found.byType.rules.map((d) => d.reminder.id)).toEqual(["r2"]);
    // Счёт найден по записям, хотя его переименовали.
    expect(found.accountId).toBe("svc");
  });

  it("без записей счёт ищется по названию", () => {
    const found = findCloudDocs({ accounts: [acc("svc", SERVICE_ACCOUNT_TITLE)], reminders: [] });
    expect(found.accountId).toBe("svc");
    expect(findCloudDocs({ accounts: [], reminders: [] }).accountId).toBeNull();
  });

  it("служебные счета — наш и Zerro — узнаются по названию", () => {
    expect(isServiceAccountTitle(SERVICE_ACCOUNT_TITLE)).toBe(true);
    expect(isServiceAccountTitle("🤖 [Zerro Data]")).toBe(true);
    expect(isServiceAccountTitle("Т-Банк")).toBe(false);
  });
});

describe("настройки: слияние по полям", () => {
  it("побеждает более поздняя правка каждого поля", () => {
    const res = mergeFields(
      { theme: { v: "dark", at: 20 }, digits: { v: 0, at: 5 } },
      { theme: { v: "light", at: 10 }, digits: { v: 2, at: 30 } }
    );
    expect(res.merged).toEqual({ theme: { v: "dark", at: 20 }, digits: { v: 2, at: 30 } });
    expect(res.applyLocally).toEqual(["digits"]);
    // Тема на этом устройстве новее — облако надо обновить.
    expect(res.pushNeeded).toBe(true);
  });

  it("новое устройство принимает облачные настройки, а не затирает их стандартными", () => {
    const res = mergeFields({ theme: { v: "auto", at: 0 } }, { theme: { v: "dark", at: 0 } });
    expect(res.merged.theme.v).toBe("dark");
    expect(res.applyLocally).toEqual(["theme"]);
    expect(res.pushNeeded).toBe(false);
  });

  it("облака ещё нет — отправляем всё своё", () => {
    const res = mergeFields({ theme: { v: "dark", at: 0 } }, null);
    expect(res.applyLocally).toEqual([]);
    expect(res.pushNeeded).toBe(true);
  });

  it("поле появилось только в облаке — применяем", () => {
    const res = mergeFields({}, { theme: { v: "dark", at: 3 } });
    expect(res.applyLocally).toEqual(["theme"]);
    expect(res.pushNeeded).toBe(false);
  });

  it("пометка правок трогает только поменявшиеся поля", () => {
    const at = stampFieldChanges({ a: 1, b: { x: [1] } }, { a: 2, b: { x: [1] } }, { b: 7 }, 100);
    expect(at).toEqual({ a: 100, b: 7 });
    const same = { b: 7 };
    expect(stampFieldChanges({ a: 1 }, { a: 1 }, same, 100)).toBe(same);
  });
});

describe("правила: слияние поэлементно", () => {
  const now = 1_000_000_000;

  it("правки разных правил на двух устройствах не затирают друг друга", () => {
    const local = doc({ a: [200, rule("a", "A-мой")], b: [0, rule("b")] }, ["a", "b"]);
    const cloud = doc({ a: [100, rule("a")], b: [300, rule("b", "B-облако")] }, ["a", "b"]);
    const { merged, localChanged, pushNeeded } = mergeRulesDocs(local, cloud, now);
    expect(rulesFromDoc(merged).map((r) => r.value)).toEqual(["A-мой", "B-облако"]);
    expect(localChanged).toBe(true);
    expect(pushNeeded).toBe(true);
  });

  it("новые правила с обоих устройств объединяются", () => {
    const local = doc({ a: [0, rule("a", "a", "2026-01-01")] }, ["a"]);
    const cloud = doc({ b: [0, rule("b", "b", "2026-02-01")] }, ["b"]);
    const { merged } = mergeRulesDocs(local, cloud, now);
    expect(rulesFromDoc(merged).map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("удаление побеждает более раннюю правку и не даёт правилу воскреснуть", () => {
    const local = doc({}, [], 0, { a: 500 });
    const cloud = doc({ a: [400, rule("a")] }, ["a"]);
    const { merged, pushNeeded } = mergeRulesDocs(local, cloud, now);
    expect(rulesFromDoc(merged)).toEqual([]);
    expect(merged.deleted).toEqual({ a: 500 });
    expect(pushNeeded).toBe(true);
  });

  it("правка после удаления возвращает правило", () => {
    const local = doc({}, [], 0, { a: 500 });
    const cloud = doc({ a: [600, rule("a", "вернули")] }, ["a"]);
    const { merged } = mergeRulesDocs(local, cloud, now);
    expect(rulesFromDoc(merged).map((r) => r.value)).toEqual(["вернули"]);
    expect(merged.deleted).toEqual({});
  });

  it("старые пометки об удалении забываются", () => {
    const local = doc({}, [], 0, { old: now - TOMBSTONE_TTL_MS - 1, fresh: now - 1 });
    const { merged } = mergeRulesDocs(local, null, now);
    expect(Object.keys(merged.deleted)).toEqual(["fresh"]);
  });

  it("порядок — с устройства, где его меняли позже", () => {
    const local = doc({ a: [0, rule("a")], b: [0, rule("b")] }, ["b", "a"], 900);
    const cloud = doc({ a: [0, rule("a")], b: [0, rule("b")] }, ["a", "b"], 100);
    expect(rulesFromDoc(mergeRulesDocs(local, cloud, now).merged).map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("ничего не поменялось — ни применять, ни отправлять", () => {
    const d = doc({ a: [5, rule("a")] }, ["a"], 5);
    const res = mergeRulesDocs(d, structuredClone(d), now);
    expect(res.localChanged).toBe(false);
    expect(res.pushNeeded).toBe(false);
  });

  it("документ ↔ правила и метаданные", () => {
    const rules = [rule("a"), rule("b")];
    const d = rulesDocFromLocal(rules, { itemAt: { a: 3 }, orderAt: 4, deleted: { c: 1 } });
    expect(d.items.b.at).toBe(0);
    expect(rulesFromDoc(d)).toEqual(rules);
    expect(metaFromRulesDoc(d)).toEqual({ itemAt: { a: 3, b: 0 }, orderAt: 4, deleted: { c: 1 } });
  });

  it("пометка правок: новое, изменённое, удалённое, порядок", () => {
    const prev = [rule("a"), rule("b"), rule("c")];
    const next = [rule("b", "B2"), rule("a"), rule("d")];
    const meta = stampRuleChanges(prev, next, EMPTY_RULES_META, 777);
    expect(meta.itemAt).toEqual({ b: 777, d: 777 });
    expect(meta.deleted).toEqual({ c: 777 });
    expect(meta.orderAt).toBe(777);
    // Без изменений — тот же объект.
    expect(stampRuleChanges(prev, prev, EMPTY_RULES_META, 1)).toBe(EMPTY_RULES_META);
  });
});

describe("разбор пришедшего из облака", () => {
  it("поля: берёт только похожее на {v, at}", () => {
    expect(
      sanitizeFieldMap({ ok: { v: 2, at: 5 }, noAt: { v: 1 }, badAt: { v: 1, at: "x" }, junk: 3, nul: { v: null, at: 0 } })
    ).toEqual({ ok: { v: 2, at: 5 }, nul: { v: null, at: 0 } });
    expect(sanitizeFieldMap("мусор")).toEqual({});
  });

  it("правила: битые элементы отбрасываются, форма гарантирована", () => {
    const d = sanitizeRulesDoc({
      items: {
        a: { at: 1, rule: { id: "a", createdAt: "" } },
        wrongId: { at: 1, rule: { id: "другой" } },
        noRule: { at: 1 },
      },
      order: { ids: ["a", 5, "b"], at: 3 },
      deleted: { x: 9, y: "вчера" },
    });
    expect(Object.keys(d.items)).toEqual(["a"]);
    expect(d.order).toEqual({ ids: ["a", "b"], at: 3 });
    expect(d.deleted).toEqual({ x: 9 });
    expect(sanitizeRulesDoc(null)).toEqual({ items: {}, order: { ids: [], at: 0 }, deleted: {} });
  });
});

describe("readCollectionMeta", () => {
  it("забирает метку правил из старой формы", () => {
    const meta = readCollectionMeta({ rules: { itemAt: { a: 5 }, orderAt: 7, deleted: { b: 9 } } });
    expect(meta.rules).toEqual({ itemAt: { a: 5 }, orderAt: 7, deleted: { b: 9 } });
  });

  it("новая форма главнее старой", () => {
    const meta = readCollectionMeta({
      collections: { rules: { itemAt: { a: 1 }, orderAt: 1, deleted: {} } },
      rules: { itemAt: { a: 5 }, orderAt: 7, deleted: {} },
    });
    expect(meta.rules?.orderAt).toBe(1);
  });

  it("читает метки всех списков и отбрасывает незнакомые", () => {
    const meta = readCollectionMeta({
      collections: {
        goals: { itemAt: { g: 2 }, orderAt: 0, deleted: {} },
        views: { itemAt: {}, orderAt: 3, deleted: { v: 4 } },
        slices: { itemAt: { s: 1 }, orderAt: 0, deleted: {} },
        something: { itemAt: { x: 1 }, orderAt: 0, deleted: {} },
      },
    });
    expect(meta.goals?.itemAt).toEqual({ g: 2 });
    expect(meta.views?.deleted).toEqual({ v: 4 });
    expect(meta.slices?.itemAt).toEqual({ s: 1 });
    expect(Object.keys(meta)).toEqual(["goals", "views", "slices"]);
  });

  it("битую метку заменяет пустой, а не роняет чтение", () => {
    const meta = readCollectionMeta({ collections: { goals: { itemAt: { g: "вчера" }, orderAt: "нет" } } });
    expect(meta.goals).toEqual(EMPTY_RULES_META);
    expect(readCollectionMeta(null)).toEqual({});
  });
});
