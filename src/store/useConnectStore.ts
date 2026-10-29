import { create } from "zustand";
import { isOAuthConfigured, startOAuth } from "../lib/oauth";

/**
 * Окно «Подключить Дзен-мани» — одно на всё приложение (см. ConnectZenDialog).
 *
 * Раньше подключение с приветственного экрана уводило в «Настройки →
 * Данные»: поле токена там стояло среди импорта из Excel, списка аккаунтов и
 * прочего, что новичку ещё не нужно. Теперь подключают на месте.
 */
interface ConnectState {
  open: boolean;
  show: () => void;
  hide: () => void;
}

export const useConnectStore = create<ConnectState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

/**
 * Подключить Дзен-мани с первого экрана. Где вход через Дзен-мани настроен
 * (свой сайт), сразу уходим на него — одно нажатие вместо окна с выбором.
 * Иначе (архив, Docker, свой сервер) — окно с токеном.
 */
export function connectZen(): void {
  if (isOAuthConfigured()) startOAuth({ replaceCsv: false });
  else useConnectStore.getState().show();
}
