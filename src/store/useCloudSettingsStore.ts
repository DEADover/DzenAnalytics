import { create } from "zustand";
import * as db from "../lib/db";
import { pushDiff, type PushPayload, type ZenDeletion } from "../lib/zenmoney";
import { applyDiff, type ZenCache } from "../lib/zenmoneyCache";
import {
  CLOUD_FORMAT_VERSION,
  EMPTY_RULES_META,
  SERVICE_ACCOUNT_TITLE,
  buildDocReminder,
  buildServiceAccount,
  envelopeComment,
  findCloudDocs,
  mergeFields,
  mergeRulesDocs,
  metaFromRulesDoc,
  nextChanged,
  rulesDocFromLocal,
  rulesFromDoc,
  sanitizeFieldMap,
  sanitizeRulesDoc,
  stableStringify,
  stampRuleChanges,
  type CloudDocType,
  type FieldMap,
  type FoundDoc,
  type RulesDoc,
  type RulesSyncMeta,
} from "../lib/cloudSettings";
import { SYNCED_FIELDS, syncedField } from "./cloudSettingsFields";
import { useCategoryRulesStore, type StoredCategoryRule } from "./useCategoryRulesStore";

/**
 * Перенос настроек между устройствами через Дзен-мани (16.09.2026).
 *
 * Чистая часть — формат, поиск, слияние — в `lib/cloudSettings`; какие поля
 * переносятся — в `cloudSettingsFields`. Здесь — связка с приложением:
 *
 *   • СЛЕЖКА. На каждое переносимое поле и на правила — подписка. Правка
 *     помечается временем, и через несколько секунд запускается обычная
 *     синхронизация. Пока хранилище не прочитало своё с диска, его значение не
 *     считается правкой — иначе стандартные значения при запуске затёрли бы
 *     облако.
 *   • ШАГ СИНХРОНИЗАЦИИ (`step`). Его зовёт `useZenmoneyStore.sync` после
 *     применения diff: наши записи из кэша сливаются с локальными, итог
 *     применяется у себя и, если облако отстало, отправляется.
 *
 * ВКЛЮЧАЕТСЯ ЯВНО и на каждом устройстве отдельно: это запись в аккаунт
 * Дзен-мани (служебный счёт в архиве и записи на нём), и режим отправки
 * операций на неё не влияет.
 *
 * УДАЛИЛИ СЛУЖЕБНЫЙ СЧЁТ в Дзен-мани — считаем это отказом: перенос на этом
 * устройстве выключается с пояснением, локальные настройки остаются. Иначе
 * устройства бесконечно воскрешали бы счёт.
 */

const META_KEY = "cloudSettings";
/** Через сколько после правки запускать синхронизацию. */
const PUSH_DELAY_MS = 4000;

interface PersistedMeta {
  enabled: boolean;
  /** Когда какое поле меняли на этом устройстве, мс. */
  fieldAt: Record<string, number>;
  rules: RulesSyncMeta;
  accountId: string | null;
  lastSyncAt: string | null;
  /** Пояснение для человека: почему перенос выключился сам. */
  notice: string | null;
}

const DEFAULT_META: PersistedMeta = {
  enabled: false,
  fieldAt: {},
  rules: EMPTY_RULES_META,
  accountId: null,
  lastSyncAt: null,
  notice: null,
};

interface State extends PersistedMeta {
  loaded: boolean;
  busy: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  setEnabled: (on: boolean) => Promise<void>;
  dismissNotice: () => Promise<void>;
  /** Шаг обычной синхронизации: слить, применить, при нужде отправить. */
  step: (ctx: { token: string; cache: ZenCache; deletions: ZenDeletion[] }) => Promise<ZenCache>;
}

async function persist(patch: Partial<PersistedMeta>): Promise<void> {
  useCloudSettingsStore.setState(patch);
  const s = useCloudSettingsStore.getState();
  const meta: PersistedMeta = {
    enabled: s.enabled,
    fieldAt: s.fieldAt,
    rules: s.rules,
    accountId: s.accountId,
    lastSyncAt: s.lastSyncAt,
    notice: s.notice,
  };
  await db.saveJSON(META_KEY, meta);
}

/* ─────────────────────────────  слежка за правками  ───────────────────────────── */

/** Последнее увиденное значение поля — чтобы отличить правку от шума подписки. */
const baseline = new Map<string, string>();
let rulesBaseline: readonly StoredCategoryRule[] | null = null;
/** Применяем пришедшее из облака — это не правка человека. */
let applyingDepth = 0;
let unsubscribers: (() => void)[] = [];
let pushTimer: ReturnType<typeof setTimeout> | null = null;

async function applying(fn: () => Promise<void>): Promise<void> {
  applyingDepth += 1;
  try {
    await fn();
  } finally {
    // Подписки срабатывают синхронно на `set`, но у некоторых хранилищ `set`
    // идёт после записи на диск — даём им отработать до снятия флага.
    await Promise.resolve();
    observeFields();
    observeRules();
    applyingDepth -= 1;
  }
}

function observeFields(): void {
  const s = useCloudSettingsStore.getState();
  if (!s.loaded) return;
  const now = Date.now();
  let fieldAt = s.fieldAt;
  for (const f of SYNCED_FIELDS) {
    if (!f.ready()) continue;
    const value = stableStringify(f.read());
    const before = baseline.get(f.key);
    baseline.set(f.key, value);
    if (before === undefined || before === value || applyingDepth > 0) continue;
    if (fieldAt === s.fieldAt) fieldAt = { ...s.fieldAt };
    fieldAt[f.key] = now;
  }
  if (fieldAt !== s.fieldAt) {
    void persist({ fieldAt });
    schedulePush();
  }
}

function observeRules(): void {
  const s = useCloudSettingsStore.getState();
  const rs = useCategoryRulesStore.getState();
  if (!s.loaded || !rs.loaded) return;
  if (rulesBaseline === null) {
    rulesBaseline = rs.rules;
    return;
  }
  if (rs.rules === rulesBaseline) return;
  const before = rulesBaseline;
  rulesBaseline = rs.rules;
  if (applyingDepth > 0) return;
  const meta = stampRuleChanges(before, rs.rules, s.rules, Date.now());
  if (meta !== s.rules) {
    void persist({ rules: meta });
    schedulePush();
  }
}

function startWatching(): void {
  for (const off of unsubscribers) off();
  unsubscribers = [
    ...SYNCED_FIELDS.map((f) => f.subscribe(observeFields)),
    useCategoryRulesStore.subscribe(observeRules),
  ];
  observeFields();
  observeRules();
}

function schedulePush(): void {
  if (!useCloudSettingsStore.getState().enabled) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void runSync();
  }, PUSH_DELAY_MS);
}

async function runSync(): Promise<void> {
  // Хранилище синхронизации само зовёт наш шаг — поэтому импорт ленивый, без
  // кольца модулей при загрузке.
  const { useZenmoneyStore } = await import("./useZenmoneyStore");
  const z = useZenmoneyStore.getState();
  if (!z.token) return;
  if (z.status === "syncing" || z.status === "checking") {
    schedulePush();
    return;
  }
  await z.sync().catch(() => {});
}

/* ─────────────────────────────  слияние с облаком  ───────────────────────────── */

/** Каноническая запись типа — с самым поздним `changed`; остальные — дубли. */
function splitDuplicates(docs: FoundDoc[]): { main: FoundDoc | null; extra: FoundDoc[] } {
  if (docs.length === 0) return { main: null, extra: [] };
  const sorted = [...docs].sort((a, b) => (b.reminder.changed ?? 0) - (a.reminder.changed ?? 0));
  return { main: sorted[0], extra: sorted.slice(1) };
}

function newId(): string {
  return crypto.randomUUID();
}

export const useCloudSettingsStore = create<State>((set, get) => ({
  ...DEFAULT_META,
  loaded: false,
  busy: false,
  error: null,

  hydrate: async () => {
    const saved = await db.loadJSON<Partial<PersistedMeta>>(META_KEY);
    set({
      enabled: saved?.enabled === true,
      fieldAt: saved?.fieldAt && typeof saved.fieldAt === "object" ? saved.fieldAt : {},
      rules: saved?.rules && typeof saved.rules === "object" ? { ...EMPTY_RULES_META, ...saved.rules } : EMPTY_RULES_META,
      accountId: typeof saved?.accountId === "string" ? saved.accountId : null,
      lastSyncAt: typeof saved?.lastSyncAt === "string" ? saved.lastSyncAt : null,
      notice: typeof saved?.notice === "string" ? saved.notice : null,
      loaded: true,
    });
    startWatching();
  },

  setEnabled: async (on) => {
    await persist({ enabled: on, notice: null });
    set({ error: null });
    if (on) void runSync();
  },

  dismissNotice: () => persist({ notice: null }),

  step: async ({ token, cache, deletions }) => {
    const s = get();
    if (!s.loaded || !s.enabled) return cache;
    // Пока хранилища не прочитали своё с диска, их значения стандартные: слить
    // их с облаком значило бы затереть облако. Подождём следующей синхронизации.
    if (!SYNCED_FIELDS.every((f) => f.ready()) || !useCategoryRulesStore.getState().loaded) {
      return cache;
    }
    // Правки, сделанные до этой синхронизации, должны быть помечены до слияния.
    observeFields();
    observeRules();

    if (
      s.accountId &&
      deletions.some((d) => d.object === "account" && String(d.id) === s.accountId)
    ) {
      await persist({
        enabled: false,
        accountId: null,
        notice: `Служебный счёт «${SERVICE_ACCOUNT_TITLE}» удалили в Дзен-мани, поэтому перенос настроек на этом устройстве выключен. Настройки в браузере остались.`,
      });
      return cache;
    }

    const user = cache.user?.[0];
    if (!user) return cache;

    set({ busy: true, error: null });
    try {
      const found = findCloudDocs(cache);
      const nowMs = Date.now();
      const nowSec = Math.floor(nowMs / 1000);
      const outgoing: { type: CloudDocType; data: unknown; docs: FoundDoc[] }[] = [];

      // ── Настройки ──
      const settingsDocs = found.byType.settings;
      const settingsNewer = settingsDocs.some((d) => d.env.v > CLOUD_FORMAT_VERSION);
      let cloudFields: FieldMap | null = null;
      for (const d of settingsDocs.filter((x) => x.env.v <= CLOUD_FORMAT_VERSION)) {
        const fields = sanitizeFieldMap((d.env.data as { fields?: unknown }).fields);
        cloudFields = cloudFields ? mergeFields(cloudFields, fields).merged : fields;
      }
      const localFields: FieldMap = {};
      for (const f of SYNCED_FIELDS) {
        localFields[f.key] = { v: f.read(), at: get().fieldAt[f.key] ?? 0 };
      }
      const fieldsRes = mergeFields(localFields, cloudFields);
      if (fieldsRes.applyLocally.length > 0) {
        await applying(async () => {
          for (const key of fieldsRes.applyLocally) {
            await syncedField(key)?.write(fieldsRes.merged[key].v);
          }
        });
      }
      const fieldAt: Record<string, number> = {};
      for (const [key, value] of Object.entries(fieldsRes.merged)) fieldAt[key] = value.at;
      if (!settingsNewer && (fieldsRes.pushNeeded || settingsDocs.length > 1)) {
        outgoing.push({ type: "settings", data: { fields: fieldsRes.merged }, docs: settingsDocs });
      }

      // ── Правила ──
      const rulesDocs = found.byType.rules;
      const rulesNewer = rulesDocs.some((d) => d.env.v > CLOUD_FORMAT_VERSION);
      let cloudRules: RulesDoc | null = null;
      for (const d of rulesDocs.filter((x) => x.env.v <= CLOUD_FORMAT_VERSION)) {
        const parsed = sanitizeRulesDoc(d.env.data);
        cloudRules = cloudRules ? mergeRulesDocs(cloudRules, parsed, nowMs).merged : parsed;
      }
      const localRules = rulesDocFromLocal(useCategoryRulesStore.getState().rules, get().rules);
      const rulesRes = mergeRulesDocs<StoredCategoryRule>(
        localRules,
        cloudRules as RulesDoc<StoredCategoryRule> | null,
        nowMs
      );
      if (rulesRes.localChanged) {
        await applying(() => useCategoryRulesStore.getState().replaceAll(rulesFromDoc(rulesRes.merged)));
      }
      // Нормализация при замене могла чуть поменять правила (ссылки на id):
      // метаданные берём с итога, а не с того, что было до применения.
      const rulesMeta = metaFromRulesDoc(rulesRes.merged);
      if (!rulesNewer && (rulesRes.pushNeeded || rulesDocs.length > 1)) {
        outgoing.push({ type: "rules", data: rulesRes.merged, docs: rulesDocs });
      }

      // ── Отправка ──
      let nextCache = cache;
      let accountId = found.accountId;
      if (outgoing.length > 0) {
        const payload: PushPayload = { reminder: [], deletion: [] };
        if (!accountId) {
          accountId = newId();
          payload.account = [
            buildServiceAccount({ id: accountId, user: user.id, instrument: user.currency, nowSec }),
          ];
        }
        for (const out of outgoing) {
          const { main, extra } = splitDuplicates(out.docs);
          const serverChanged = Math.max(0, ...out.docs.map((d) => d.reminder.changed ?? 0));
          payload.reminder!.push(
            buildDocReminder({
              id: main?.reminder.id ?? newId(),
              user: user.id,
              accountId,
              instrument: user.currency,
              comment: envelopeComment(out.type, out.data, nowMs),
              changed: nextChanged(serverChanged, nowSec),
            })
          );
          for (const dup of extra) {
            payload.deletion!.push({
              id: dup.reminder.id,
              object: "reminder",
              stamp: nowSec,
              user: user.id,
            } as ZenDeletion);
          }
        }
        if (payload.deletion!.length === 0) delete payload.deletion;
        const response = await pushDiff(token, cache.serverTimestamp, payload);
        nextCache = applyDiff(cache, response);
      }

      // Пока шла отправка, человек мог что-то поменять — его пометки уже в
      // состоянии. Итог слияния их не знает, поэтому берём более позднее из
      // двух: иначе правка во время синхронизации терялась бы (у Zerro так).
      const now = get();
      const keepLater = (a: Record<string, number>, b: Record<string, number>) => {
        const out = { ...a };
        for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v);
        return out;
      };
      await persist({
        fieldAt: keepLater(fieldAt, now.fieldAt),
        rules: {
          itemAt: keepLater(rulesMeta.itemAt, now.rules.itemAt),
          deleted: keepLater(rulesMeta.deleted, now.rules.deleted),
          orderAt: Math.max(rulesMeta.orderAt, now.rules.orderAt),
        },
        accountId,
        lastSyncAt: new Date().toISOString(),
      });
      return nextCache;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return cache;
    } finally {
      set({ busy: false });
    }
  },
}));
