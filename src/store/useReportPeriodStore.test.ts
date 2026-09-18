import { describe, it, expect, beforeEach, vi } from "vitest";

// Диск в памяти: проверяем и то, что день уезжает на диск, и то, что читается.
const disk = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../lib/db", () => ({
  loadJSON: async (key: string) => disk.get(key) ?? null,
  saveJSON: async (key: string, value: unknown) => {
    disk.set(key, value === null ? null : JSON.parse(JSON.stringify(value)));
  },
}));

import { useReportPeriodStore } from "./useReportPeriodStore";

const reset = () => {
  disk.clear();
  useReportPeriodStore.setState({ monthStartDay: 1, ownDay: 1, ownSet: false, zenDay: null, loaded: false });
};

describe("первый день месяца: свой или из Дзен-мани", () => {
  beforeEach(reset);

  it("своего дня нет — действует день из Дзен-мани", async () => {
    await useReportPeriodStore.getState().hydrate();
    useReportPeriodStore.getState().adoptZenDay(28);
    const s = useReportPeriodStore.getState();
    expect(s.monthStartDay).toBe(28);
    expect(s.ownSet).toBe(false);
  });

  it("свой день перебивает день из Дзен-мани", async () => {
    useReportPeriodStore.getState().adoptZenDay(28);
    await useReportPeriodStore.getState().setMonthStartDay(1);
    const s = useReportPeriodStore.getState();
    expect(s.monthStartDay).toBe(1);
    // День Дзен-мани помним — по нему показываем предупреждение о расхождении.
    expect(s.zenDay).toBe(28);
    expect(s.ownSet).toBe(true);
  });

  it("выбранный день не затирается новой сверкой с Дзен-мани", async () => {
    await useReportPeriodStore.getState().setMonthStartDay(11);
    useReportPeriodStore.getState().adoptZenDay(28);
    expect(useReportPeriodStore.getState().monthStartDay).toBe(11);
  });

  it("«Как в Дзен-мани» возвращает день приложения и забывает свой", async () => {
    useReportPeriodStore.getState().adoptZenDay(28);
    await useReportPeriodStore.getState().setMonthStartDay(5);
    await useReportPeriodStore.getState().followZenDay();
    const s = useReportPeriodStore.getState();
    expect(s.monthStartDay).toBe(28);
    expect(s.ownSet).toBe(false);
    // После перезапуска день по-прежнему из Дзен-мани, а не сохранённые 5.
    useReportPeriodStore.setState({ monthStartDay: 1, ownDay: 1, ownSet: false, zenDay: 28 });
    await useReportPeriodStore.getState().hydrate();
    expect(useReportPeriodStore.getState().monthStartDay).toBe(28);
  });

  it("выбранный день переживает перезапуск", async () => {
    await useReportPeriodStore.getState().setMonthStartDay(11);
    useReportPeriodStore.setState({ monthStartDay: 1, ownDay: 1, ownSet: false, zenDay: 28 });
    await useReportPeriodStore.getState().hydrate();
    expect(useReportPeriodStore.getState().monthStartDay).toBe(11);
    expect(useReportPeriodStore.getState().ownSet).toBe(true);
  });

  it("отключили Дзен-мани — остаётся свой день", async () => {
    await useReportPeriodStore.getState().setMonthStartDay(11);
    useReportPeriodStore.getState().adoptZenDay(28);
    useReportPeriodStore.getState().adoptZenDay(null);
    expect(useReportPeriodStore.getState().monthStartDay).toBe(11);
    expect(useReportPeriodStore.getState().zenDay).toBeNull();
  });

  // Дзен-мани разрешает 29, 30 и 31 — берём как есть. Раньше такой день молча
  // превращался в 28-й, и отчёты расходились с приложением на три дня.
  it("день Дзен-мани 29–31 сохраняется, мусор — «не подключён»", () => {
    useReportPeriodStore.getState().adoptZenDay(31);
    expect(useReportPeriodStore.getState().monthStartDay).toBe(31);
    useReportPeriodStore.getState().adoptZenDay(40);
    expect(useReportPeriodStore.getState().monthStartDay).toBe(31);
    useReportPeriodStore.getState().adoptZenDay(undefined);
    expect(useReportPeriodStore.getState().zenDay).toBeNull();
  });
});
