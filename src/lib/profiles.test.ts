import { describe, it, expect } from "vitest";
import {
  DEFAULT_PROFILE_ID,
  activeProfileId,
  addProfile,
  dbNameFor,
  profileLabel,
  readProfiles,
  removeProfile,
  renameProfile,
  setActiveProfileId,
  setProfileLogin,
  setProfileAvatar,
} from "./profiles";

function memory() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

describe("аккаунты", () => {
  it("без записей — один основной на прежней базе", () => {
    const kv = memory();
    expect(readProfiles(kv).map((p) => p.id)).toEqual([DEFAULT_PROFILE_ID]);
    expect(activeProfileId(kv)).toBe(DEFAULT_PROFILE_ID);
    expect(dbNameFor(DEFAULT_PROFILE_ID)).toBe("dzenanalytics");
  });

  it("новый аккаунт — своя база, выбирается отдельно", () => {
    const kv = memory();
    const p = addProfile("Работа", kv);
    expect(dbNameFor(p.id)).toBe(`dzenanalytics-${p.id}`);
    expect(activeProfileId(kv)).toBe(DEFAULT_PROFILE_ID);
    setActiveProfileId(p.id, kv);
    expect(activeProfileId(kv)).toBe(p.id);
  });

  it("выбранный аккаунт удалить нельзя, другой — можно", () => {
    const kv = memory();
    const p = addProfile("Работа", kv);
    setActiveProfileId(p.id, kv);
    expect(removeProfile(p.id, kv)).toBe(false);
    expect(removeProfile(DEFAULT_PROFILE_ID, kv)).toBe(true);
    expect(readProfiles(kv).map((x) => x.id)).toEqual([p.id]);
  });

  it("неизвестный выбранный — первый из списка", () => {
    const kv = memory();
    setActiveProfileId("нет-такого", kv);
    expect(activeProfileId(kv)).toBe(DEFAULT_PROFILE_ID);
  });

  it("подпись — своё название, иначе логин Дзен-мани", () => {
    const kv = memory();
    const p = addProfile("", kv);
    setProfileLogin(p.id, "ivan@example.com", kv);
    const saved = readProfiles(kv).find((x) => x.id === p.id)!;
    expect(profileLabel(saved)).toBe("ivan@example.com");
    renameProfile(p.id, "Семья", kv);
    expect(profileLabel(readProfiles(kv).find((x) => x.id === p.id)!)).toBe("Семья");
  });

  it("испорченная запись не ломает список", () => {
    const kv = memory();
    kv.setItem("dzenanalytics:profiles", "{не json");
    expect(readProfiles(kv).map((p) => p.id)).toEqual([DEFAULT_PROFILE_ID]);
  });
});

describe("фото аккаунта", () => {
  it("ставится и убирается, остальное не трогает", () => {
    const kv = memory();
    const p = addProfile("Работа", kv);
    expect(setProfileAvatar(p.id, "data:image/webp;base64,AAA", kv)).toBe(true);
    expect(readProfiles(kv).find((x) => x.id === p.id)).toMatchObject({ name: "Работа", avatar: "data:image/webp;base64,AAA" });
    expect(setProfileAvatar(p.id, null, kv)).toBe(true);
    expect(readProfiles(kv).find((x) => x.id === p.id)).not.toHaveProperty("avatar");
  });

  it("хранилище переполнено — честное «не сохранилось»", () => {
    const kv = memory();
    const p = addProfile("Работа", kv);
    const full = { getItem: kv.getItem.bind(kv), setItem: () => { throw new Error("QuotaExceededError"); } };
    expect(setProfileAvatar(p.id, "data:image/webp;base64,AAA", full)).toBe(false);
  });

  it("неизвестный аккаунт — ничего", () => {
    expect(setProfileAvatar("nope", "x", memory())).toBe(false);
  });
});

