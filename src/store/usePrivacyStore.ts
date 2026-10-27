import { create } from "zustand";
import * as db from "../lib/db";
import { setHideAmounts } from "../lib/format";

/**
 * «Скрыть суммы» — частицы вместо денег во всём сервисе (`lib/format`, `lib/amountSpoiler`).
 *
 * Запоминается на этом устройстве и не переносится на другие: прятать суммы
 * нужно там, где экран видят другие люди, а не везде сразу. Остаётся включённым
 * и после перезагрузки — забытый режим безопаснее забытых цифр.
 */
interface PrivacyState {
  hideAmounts: boolean;
  loaded: boolean;
  hydrate: () => Promise<void>;
  setHideAmounts: (on: boolean) => Promise<void>;
  toggle: () => Promise<void>;
}

const KEY = "hideAmounts";

export const usePrivacyStore = create<PrivacyState>((set, get) => ({
  hideAmounts: false,
  loaded: false,
  hydrate: async () => {
    const on = (await db.loadJSON<boolean>(KEY)) === true;
    setHideAmounts(on); // форматтер — до первой отрисовки с данными
    set({ hideAmounts: on, loaded: true });
  },
  setHideAmounts: async (on) => {
    setHideAmounts(on); // сначала форматтер…
    set({ hideAmounts: on }); // …потом перерисовка
    await db.saveJSON(KEY, on);
  },
  toggle: () => get().setHideAmounts(!get().hideAmounts),
}));
