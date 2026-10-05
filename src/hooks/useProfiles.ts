import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  activeProfileId,
  addProfile,
  dbNameFor,
  profileLabel,
  readProfiles,
  removeProfile,
  setActiveProfileId,
  setProfileLogin,
  subscribeProfiles,
  type Profile,
} from "../lib/profiles";
import { loadZenCache } from "../lib/zenmoneyCache";
import { beginSwitch, type SwitchFace } from "../lib/switchOverlay";
import { hueFromString } from "../lib/colorHash";
import { zenUsers } from "../lib/zenUsers";
import { useZenmoneyStore } from "../store/useZenmoneyStore";

/** Снимок для React — строкой: новые массивы на каждый вызов зациклили бы отрисовку. */
function snapshot(): string {
  return JSON.stringify([readProfiles(), activeProfileId()]);
}

/** Список аккаунтов устройства и выбранный — живьём, с соседними вкладками. */
export function useProfiles(): { profiles: Profile[]; activeId: string } {
  const snap = useSyncExternalStore(subscribeProfiles, snapshot, snapshot);
  return useMemo(() => {
    const [profiles, activeId] = JSON.parse(snap) as [Profile[], string];
    return { profiles, activeId };
  }, [snap]);
}

/** Аватар аккаунта для экрана перехода — как у `ProfileAvatar`. */
export function profileFace(p: Profile): SwitchFace {
  const label = profileLabel(p);
  const words = label.trim().split(/[\s@._-]+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : (words[0]?.[0] ?? "?")).toUpperCase();
  return { avatar: p.avatar ?? null, initials, hue: hueFromString(p.id + label) };
}

/**
 * Перейти в другой аккаунт. Страница перезагружается уже на его базе: все
 * сторы, кэши в памяти и открытые окна начинаются заново, и остаток прежнего
 * аккаунта показаться не может.
 */
export function switchProfile(id: string): void {
  if (id === activeProfileId()) return;
  const target = readProfiles().find((p) => p.id === id);
  // Перезагрузка — под плавной заглушкой (`lib/switchOverlay`): страница гаснет,
  // новая стартует с той же заглушки и проявляется, когда данные прочитаны.
  beginSwitch(
    target ? profileLabel(target) : "аккаунт",
    () => {
      setActiveProfileId(id);
      window.location.reload();
    },
    target ? profileFace(target) : null
  );
}

/** Завести аккаунт и сразу перейти в него — там пустой экран подключения. */
export function createProfile(name: string): void {
  const p = addProfile(name);
  switchProfile(p.id);
}

/**
 * Удалить аккаунт вместе с его базой — операциями, токеном, правками и
 * настройками. Выбранный удалить нельзя.
 */
export async function deleteProfile(id: string): Promise<boolean> {
  if (!removeProfile(id)) return false;
  try {
    localStorage.removeItem(`lastOperationAccount:${id}`);
  } catch {
    // ignore
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbNameFor(id));
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  return true;
}

/**
 * Запомнить логин Дзен-мани выбранного аккаунта — после каждой синхронизации.
 * Им подписан аккаунт, у которого нет своего названия, и по нему аккаунты
 * различимы в списке, даже если их не переименовывали.
 */
export function useProfileLoginSync(): void {
  const lastSyncAt = useZenmoneyStore((s) => s.lastSyncAt);
  useEffect(() => {
    let cancelled = false;
    void loadZenCache().then((cache) => {
      if (cancelled || !cache) return;
      const users = zenUsers(cache.user);
      const owner = users.find((u) => u.parent == null) ?? users[0];
      setProfileLogin(activeProfileId(), owner?.login ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [lastSyncAt]);
}
