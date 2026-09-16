import { describe, it, expect, beforeEach } from "vitest";
import { useReportPeriodStore } from "./useReportPeriodStore";

describe("первый день месяца: свой или из Дзен-мани", () => {
  beforeEach(() => {
    useReportPeriodStore.setState({ monthStartDay: 11, ownDay: 11, zenDay: null });
  });

  it("при подключённом Дзен-мани действует его день", () => {
    useReportPeriodStore.getState().adoptZenDay(25);
    const s = useReportPeriodStore.getState();
    expect(s.monthStartDay).toBe(25);
    expect(s.zenDay).toBe(25);
    // Свой день не теряется.
    expect(s.ownDay).toBe(11);
  });

  it("отключили Дзен-мани — снова свой день", () => {
    useReportPeriodStore.getState().adoptZenDay(25);
    useReportPeriodStore.getState().adoptZenDay(null);
    expect(useReportPeriodStore.getState().monthStartDay).toBe(11);
    expect(useReportPeriodStore.getState().zenDay).toBeNull();
  });

  it("день Дзен-мани 29–31 прижимается к 28, мусор — «не подключён»", () => {
    useReportPeriodStore.getState().adoptZenDay(31);
    expect(useReportPeriodStore.getState().monthStartDay).toBe(28);
    useReportPeriodStore.getState().adoptZenDay(undefined);
    expect(useReportPeriodStore.getState().monthStartDay).toBe(11);
  });
});
