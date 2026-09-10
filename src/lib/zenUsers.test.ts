import { describe, it, expect } from "vitest";
import {
  hasSharedItems,
  likelyOwnerId,
  membersInData,
  userLabel,
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

describe("membersInData", () => {
  it("по убыванию числа операций", () => {
    const txs = [{ member: 2 }, { member: 1 }, { member: 2 }, { member: 2 }, { member: 1 }];
    expect(membersInData(txs)).toEqual([2, 1]);
  });

  it("при равенстве порядок по номеру — список не должен прыгать", () => {
    expect(membersInData([{ member: 9 }, { member: 3 }])).toEqual([3, 9]);
  });

  it("операции на общих счетах участника не создают", () => {
    // `member: null` — общий счёт, он ничей; `undefined` — данные из CSV.
    expect(membersInData([{ member: null }, { member: undefined }, {}])).toEqual([]);
  });
});

describe("hasSharedItems", () => {
  it("находит операции на общих счетах", () => {
    expect(hasSharedItems([{ member: 1 }, { member: null }])).toBe(true);
  });

  it("операции из CSV считает общими — других сведений о них нет", () => {
    expect(hasSharedItems([{}])).toBe(true);
  });

  it("когда все на личных счетах — общих нет", () => {
    expect(hasSharedItems([{ member: 1 }, { member: 5 }])).toBe(false);
  });
});

describe("likelyOwnerId", () => {
  it("подсказывает владельца подписки — у него пуст parent", () => {
    expect(likelyOwnerId([u(5, "wife", 1), u(1, "main")])).toBe(1);
  });

  it("это ПОДСКАЗКА, а не ответ: для остальных участников она неверна", () => {
    // Проверено на живом общем аккаунте: `user[]` у токенов разных участников
    // совпадает байт в байт, поэтому функция всегда назовёт владельца
    // подписки — кому бы токен ни принадлежал. Решение принимает человек.
    const users = [u(1, "main"), u(5, "wife", 1)];
    expect(likelyOwnerId(users)).toBe(1);
    expect(likelyOwnerId(users)).not.toBe(5);
  });

  it("если родителя нет ни у кого — берём первого", () => {
    expect(likelyOwnerId([u(5, null, 1), u(7, null, 1)])).toBe(5);
  });

  it("пустой список — подсказывать нечего", () => {
    expect(likelyOwnerId([])).toBeNull();
  });
});

describe("hideForeignMembers — правило скрытия (#95)", () => {
  // Само правило живёт в `useDataStore`, но оно в одну строку и стоит того,
  // чтобы быть записанным отдельно: от него зависит чужая приватность.
  const hide = (
    txs: { id: string; member?: number | null }[],
    ownerId: number | null,
    on: boolean
  ) =>
    ownerId == null || !on
      ? txs
      : txs.filter((t) => t.member == null || t.member === ownerId);

  const txs = [
    { id: "своя", member: 5 },
    { id: "чужая", member: 1 },
    { id: "общая", member: null },
    { id: "изCSV" },
  ];

  it("убирает операции по чужим личным счетам", () => {
    expect(hide(txs, 5, true).map((t) => t.id)).toEqual(["своя", "общая", "изCSV"]);
  });

  it("общие счета остаются — они на то и общие", () => {
    expect(hide(txs, 5, true).map((t) => t.id)).toContain("общая");
  });

  it("пока участник не выбран, не прячем ничего", () => {
    // Угадать владельца токена по ответу API нельзя, а ошибка спрятала бы своё
    // и показала чужое.
    expect(hide(txs, null, true)).toEqual(txs);
  });

  it("выключенный режим ничего не трогает", () => {
    expect(hide(txs, 5, false)).toEqual(txs);
  });
});
