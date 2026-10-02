/**
 * Перенос настроек на общем (семейном) аккаунте Дзен-мани: личное у каждого
 * участника своё (#116).
 *
 * Раньше «Счета вне баланса» и «Это я» лежали в общих полях: выбор одного
 * члена семьи приезжал другому, и у того «Балансы счетов» на главной вдруг
 * показывали внебалансовые счета.
 */
import type { Page } from "@playwright/test";
import { test, expect, connectZen, type FakeZen } from "./harness";
import { USER } from "./fixtures/zenAccount";
import { CLOUD_APP, SERVICE_ACCOUNT_TITLE, buildDocReminder, buildServiceAccount } from "../src/lib/cloudSettings";
import type { ZenReminder } from "../src/lib/zenmoney";

const SPOUSE = 1002;
const RUB = 2;
const SERVICE = "acc-cloud";

/** Семейный аккаунт со служебной записью настроек, оставленной супругом. */
function familyWithCloud(zen: FakeZen, data: unknown) {
  zen.patchFull = (diff) => {
    const comment = JSON.stringify({ app: CLOUD_APP, type: "settings", v: 1, at: 9, data });
    return {
      ...diff,
      user: [...diff.user, { ...diff.user[0], id: SPOUSE, login: "spouse" }],
      account: [
        ...diff.account,
        { ...buildServiceAccount({ id: SERVICE, user: SPOUSE, instrument: RUB, nowSec: 1 }), title: SERVICE_ACCOUNT_TITLE },
      ],
      reminder: [
        ...(diff.reminder ?? []),
        buildDocReminder({ id: "rem-cloud", user: SPOUSE, accountId: SERVICE, instrument: RUB, comment, changed: 5 }),
      ],
    };
  };
}

/** «Это я» = вы, включить перенос и дождаться его шага. */
async function enableCloudAsMe(page: Page) {
  await page.evaluate(async (me) => {
    type S = { getState: () => Record<string, (...a: unknown[]) => Promise<void>> & { lastSyncAt: string | null } };
    const store = (window as unknown as { __store: (n: string) => Promise<Record<string, S>> }).__store;
    const { useMembersStore } = await store("useMembersStore");
    await useMembersStore.getState().setOwnerId(me);
    const { useCloudSettingsStore } = await store("useCloudSettingsStore");
    await useCloudSettingsStore.getState().setEnabled(true);
  }, USER);
  await page.waitForFunction(async () => {
    type S = { getState: () => { lastSyncAt: string | null; busy: boolean } };
    const store = (window as unknown as { __store: (n: string) => Promise<Record<string, S>> }).__store;
    const { useCloudSettingsStore } = await store("useCloudSettingsStore");
    const s = useCloudSettingsStore.getState();
    return !!s.lastSyncAt && !s.busy;
  });
}

async function localState(page: Page) {
  return page.evaluate(async () => {
    type S = { getState: () => Record<string, unknown> };
    const store = (window as unknown as { __store: (n: string) => Promise<Record<string, S>> }).__store;
    const { useOffBalanceStore } = await store("useOffBalanceStore");
    const { useMembersStore } = await store("useMembersStore");
    return {
      includeOffBalance: useOffBalanceStore.getState().includeOffBalance,
      owner: useMembersStore.getState().ownerId,
    };
  });
}

/** Что ушло в облако последней записью настроек. */
function pushedSettings(zen: FakeZen) {
  const rems = zen.pushes.flatMap((p) => (p.reminder ?? []) as ZenReminder[]);
  const last = rems.filter((r) => r.comment?.includes('"type":"settings"')).at(-1);
  return last ? (JSON.parse(last.comment!).data as { fields: Record<string, unknown>; people: Record<string, Record<string, { v: unknown }>> }) : null;
}

test("выбор супруга не приезжает: ни «Счета вне баланса», ни «Это я»", async ({ page, zen }) => {
  // Так лежит запись, оставленная старой версией на устройстве супруга.
  familyWithCloud(zen, {
    fields: {
      includeOffBalance: { v: true, at: 9 },
      "members.owner": { v: SPOUSE, at: 9 },
      "members.hideForeignPrivate": { v: false, at: 9 },
    },
    people: { [SPOUSE]: { includeOffBalance: { v: true, at: 9 } } },
  });
  await connectZen(page);
  await enableCloudAsMe(page);

  expect(await localState(page)).toEqual({ includeOffBalance: false, owner: USER });
  const sent = pushedSettings(zen);
  expect(sent).not.toBeNull();
  // Своё ушло под своим номером, супруга — не тронуто, старые общие поля —
  // на месте: их ждёт старая версия на другом устройстве.
  expect(sent!.people[USER].includeOffBalance.v).toBe(false);
  expect(sent!.people[SPOUSE].includeOffBalance.v).toBe(true);
  expect(sent!.fields.includeOffBalance).toEqual({ v: true, at: 9 });
});

test("своё со второго устройства — приезжает", async ({ page, zen }) => {
  familyWithCloud(zen, {
    fields: {},
    people: { [USER]: { includeOffBalance: { v: true, at: 9 } } },
  });
  await connectZen(page);
  await enableCloudAsMe(page);
  expect(await localState(page)).toEqual({ includeOffBalance: true, owner: USER });
});
