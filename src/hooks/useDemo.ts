import { activeProfileId, addProfile, readProfiles, setActiveProfileId, DEFAULT_PROFILE_ID } from "../lib/profiles";
import { beginSwitch } from "../lib/switchOverlay";
import { deleteProfile, switchProfile } from "./useProfiles";

/**
 * Демо-данные — отдельный аккаунт панели со своей базой: выдуманная семья, её
 * «Дзен-мани» отвечает прямо из браузера (`lib/demo/demoServer`). Настоящий
 * аккаунт, если он есть, не задевается ничем, а выход из демо стирает демо-базу
 * целиком.
 */
const DEMO_KEY = "dzenanalytics:demoProfile";
/** Куда вернуться из демо — аккаунт, из которого в него пришли. */
const RETURN_KEY = "dzenanalytics:demoReturn";

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function put(key: string, value: string | null): void {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // без localStorage демо не запомнится — не страшно
  }
}

/** Аккаунт демо-данных, если он заведён. */
export function demoProfileId(): string | null {
  const id = get(DEMO_KEY);
  return id && readProfiles().some((p) => p.id === id) ? id : null;
}

/** Открыт ли сейчас аккаунт демо-данных. */
export function isDemoActive(): boolean {
  const id = demoProfileId();
  return !!id && id === activeProfileId();
}

/** Открыть демо-данные: завести их аккаунт (если ещё нет) и перейти в него. */
export function startDemo(): void {
  const existing = demoProfileId();
  if (existing === activeProfileId()) return;
  put(RETURN_KEY, activeProfileId());
  const id = existing ?? addProfile("Демо-данные").id;
  put(DEMO_KEY, id);
  switchProfile(id);
}

/**
 * Выйти из демо: вернуться в прежний аккаунт и стереть демо-базу. `path` —
 * куда открыть панель после возврата (например, подключение Дзен-мани).
 */
export function exitDemo(path = "/"): void {
  const demo = demoProfileId();
  const back = get(RETURN_KEY);
  const target =
    back && back !== demo && readProfiles().some((p) => p.id === back) ? back : DEFAULT_PROFILE_ID;
  beginSwitch("ваш аккаунт", () => {
    setActiveProfileId(target);
    put(DEMO_KEY, null);
    put(RETURN_KEY, null);
    // База ещё открыта этой страницей — браузер сотрёт её, как только
    // страница перезагрузится и закроет соединение.
    const done = demo ? deleteProfile(demo) : Promise.resolve(true);
    void done.finally(() => {
      // Однофайловая сборка ходит по адресам после «#».
      if (__STANDALONE__) {
        window.location.hash = path;
        window.location.reload();
        return;
      }
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      window.location.assign(`${base}${path}`);
    });
  });
}
