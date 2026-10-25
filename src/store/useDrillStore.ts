import type { ReactNode } from "react";
import { create } from "zustand";
import type { Transaction } from "../types";

interface DrillState {
  open: boolean;
  title: string;
  subtitle?: string;
  transactions: Transaction[];
  /**
   * Сводка над списком — например, план и остаток статьи бюджета, когда в неё
   * «проваливаются» (как в «Планах» Дзен-мани). Нет — только операции.
   */
  header?: ReactNode;
  show: (title: string, txs: Transaction[], subtitle?: string, header?: ReactNode) => void;
  close: () => void;
}

export const useDrillStore = create<DrillState>((set) => ({
  open: false,
  title: "",
  subtitle: undefined,
  transactions: [],
  header: undefined,
  show: (title, transactions, subtitle, header) =>
    set({ open: true, title, subtitle, transactions, header }),
  close: () => set({ open: false }),
}));
