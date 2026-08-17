import { describe, it, expect } from "vitest";
import { pushNote, ruleModeFields, ruleModeOf } from "./ruleMode";

describe("ruleModeOf — три состояния из двух полей", () => {
  it("выключенное правило — «Выкл», что бы ни стояло в автоприменении", () => {
    expect(ruleModeOf({ enabled: false })).toBe("off");
    expect(ruleModeOf({ enabled: false, autoApply: true })).toBe("off");
  });

  it("включённое без автоприменения — «По кнопке»", () => {
    expect(ruleModeOf({ enabled: true })).toBe("manual");
    expect(ruleModeOf({ enabled: true, autoApply: false })).toBe("manual");
  });

  it("включённое с автоприменением — «Авто»", () => {
    expect(ruleModeOf({ enabled: true, autoApply: true })).toBe("auto");
  });
});

describe("ruleModeFields — обратно в поля хранилища", () => {
  it("КЛЮЧЕВОЕ: «Выкл» гасит и автоприменение", () => {
    // Иначе у выключенного правила осталось бы висеть `autoApply: true`,
    // невидимое на экране и оживающее при включении.
    expect(ruleModeFields("off")).toEqual({ enabled: false, autoApply: false });
  });

  it("«По кнопке» и «Авто» отличаются одним полем", () => {
    expect(ruleModeFields("manual")).toEqual({ enabled: true, autoApply: false });
    expect(ruleModeFields("auto")).toEqual({ enabled: true, autoApply: true });
  });

  it("перевод туда и обратно ничего не теряет", () => {
    for (const mode of ["off", "manual", "auto"] as const) {
      expect(ruleModeOf(ruleModeFields(mode))).toBe(mode);
    }
  });
});

describe("pushNote — что будет с записанным при текущей отправке", () => {
  it("отправка выключена — правки остаются на устройстве", () => {
    expect(pushNote("off").text).toContain("Останется на устройстве");
    expect(pushNote("off").tone).toBeUndefined();
  });

  it("вручную — правки ждут кнопки", () => {
    expect(pushNote("manual").text).toContain("Отправить");
    expect(pushNote("manual").tone).toBeUndefined();
  });

  it("при синке — уедут со следующей синхронизацией", () => {
    expect(pushNote("on-sync").text).toContain("синхронизацией");
  });

  it("КЛЮЧЕВОЕ: «Авто» предупреждает цветом", () => {
    // Единственный режим, в котором правило пишет в чужое облако без единого
    // нажатия, — про него подпись обязана бросаться в глаза.
    expect(pushNote("auto").tone).toBe("warn");
    expect(pushNote("auto").text).toContain("само");
  });
});
