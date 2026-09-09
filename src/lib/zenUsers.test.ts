import { describe, it, expect } from "vitest";
import {
  guessOwnerId,
  userLabel,
  usersInData,
  zenUsers,
  type ZenUserOption,
} from "./zenUsers";

const u = (id: number, login: string | null = null, parent: number | null = null):
  ZenUserOption => ({ id, login, parent });

describe("userLabel", () => {
  it("псевдоним важнее логина", () => {
    expect(userLabel(7, [u(7, "kilometrix")], { "7": "Жена" })).toBe("Жена");
  });

  it("без псевдонима берёт логин", () => {
    expect(userLabel(7, [u(7, "kilometrix")])).toBe("kilometrix");
  });

  it("без логина показывает номер — это лучше пустоты", () => {
    // По номеру хотя бы видно, что людей несколько и они разные.
    expect(userLabel(7, [u(7)])).toBe("Пользователь 7");
  });

  it("пробельный псевдоним не считается заданным", () => {
    expect(userLabel(7, [u(7, "kilometrix")], { "7": "   " })).toBe("kilometrix");
  });

  it("незнакомый номер не роняет подпись", () => {
    expect(userLabel(99, [u(7, "kilometrix")])).toBe("Пользователь 99");
  });
});

describe("zenUsers", () => {
  it("разбирает список из ответа API", () => {
    const out = zenUsers([
      { id: 1, currency: 2, login: "main" },
      { id: 5, currency: 2, login: "wife", parent: 1 },
    ]);
    expect(out).toEqual([
      { id: 1, login: "main", parent: null },
      { id: 5, login: "wife", parent: 1 },
    ]);
  });

  it("нестроковый логин игнорируется", () => {
    // Тип поля в API — «что угодно», так что доверять ему нельзя.
    const out = zenUsers([{ id: 1, currency: 2, login: 42 as unknown as string }]);
    expect(out[0].login).toBeNull();
  });

  it("пустой ответ даёт пустой список", () => {
    expect(zenUsers(undefined)).toEqual([]);
  });
});

describe("usersInData", () => {
  it("по убыванию числа операций", () => {
    const txs = [{ user: 2 }, { user: 1 }, { user: 2 }, { user: 2 }, { user: 1 }];
    expect(usersInData(txs)).toEqual([2, 1]);
  });

  it("при равенстве порядок по номеру — список не должен прыгать", () => {
    expect(usersInData([{ user: 9 }, { user: 3 }])).toEqual([3, 9]);
  });

  it("операции без пометки не создают пользователя", () => {
    // Так выглядят данные из CSV: понятия «чей» там нет.
    expect(usersInData([{}, { user: undefined }])).toEqual([]);
  });
});

describe("guessOwnerId", () => {
  it("хозяин — тот, у кого нет родителя", () => {
    expect(guessOwnerId([u(5, "wife", 1), u(1, "main")])).toBe(1);
  });

  it("явный выбор перебивает догадку", () => {
    // Догадка не проверена на живом общем аккаунте, поэтому последнее слово
    // за человеком.
    expect(guessOwnerId([u(5, "wife", 1), u(1, "main")], 5)).toBe(5);
  });

  it("выбор несуществующего игнорируется", () => {
    // Так бывает после восстановления бэкапа с другого аккаунта.
    expect(guessOwnerId([u(1, "main")], 999)).toBe(1);
  });

  it("если родителя нет ни у кого — берём первого", () => {
    expect(guessOwnerId([u(5, null, 1), u(7, null, 1)])).toBe(5);
  });

  it("пустой список — некого назначать", () => {
    expect(guessOwnerId([])).toBeNull();
  });
});
