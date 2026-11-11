import { useEffect, useMemo, useState, useRef } from "react";
import { BackupSettings } from "./settings/BackupSettings";
import { ProcessingSettings } from "./settings/ProcessingSettings";
import { InterfaceSettings } from "./settings/InterfaceSettings";
import { formatSyncResult } from "../hooks/useSyncCommands";
import { Checkbox } from "../components/Checkbox";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Upload, CheckCircle2, AlertTriangle, Trash2, Replace, Layers, Database, Cloud, RefreshCw, Loader2, KeyRound, ExternalLink, Eye, EyeOff, Link as LinkIcon, Unlink, Settings, History, CloudDownload, CloudUpload, Calculator, ALargeSmall, ArrowLeftRight, ArrowRight } from "lucide-react";
import { parseCsv } from "../lib/csv";
import { isOAuthConfigured, startOAuth } from "../lib/oauth";
import { SyncLog } from "../components/SyncLog";
import { SyncDiagnostics } from "../components/SyncDiagnostics";
import { isAuthExpired } from "../lib/syncDiagnostics";
import clsx from "clsx";
import { OperationsSettings } from "../components/OperationsSettings";
import { SettingsSectionHeader } from "../components/SettingsSectionHeader";
import { AccountsSettings } from "../components/AccountsSettings";
import { PendingChangesModal } from "../components/PendingChangesModal";
import { CloudSettingsCard } from "../components/CloudSettingsCard";
import { InfoPopover, InfoTerm } from "../components/InfoPopover";
import { Segmented } from "../components/Segmented";
import { Select } from "../components/Select";
import { useDeletedStore } from "../store/useDeletedStore";
import { useDataStore } from "../store/useDataStore";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { useCloudSnapshotStore } from "../store/useCloudSnapshotStore";
import { useEditsStore } from "../store/useEditsStore";
import { useDraftsStore } from "../store/useDraftsStore";
import { confirm } from "../store/useConfirmStore";
import { toast } from "../store/useToastStore";
import { editUndo } from "../lib/undoable";
import { pluralRu } from "../lib/plural";
import { useBackupStore } from "../store/useBackupStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { usePayeeAliasStore } from "../store/usePayeeAliasStore";
import { UsersSettings } from "../components/UsersSettings";
import { PageHeader } from "../components/PageHeader";
import { formatNum, formatDate } from "../lib/format";
import { usePendingChanges } from "../hooks/usePendingChanges";
import * as db from "../lib/db";
import { ImportXlsxCard } from "../components/ImportXlsxCard";

type Mode = "replace" | "merge";

/** CSV прочитался, но ни одной операции в нём не нашлось. */
const CSV_NO_ROWS = "В файле не нашлось ни одной операции. Проверьте, что это CSV-выгрузка из Дзен-мани.";

/**
 * One row of the auto-grouping table. Shows `from → effectiveTo` where
 * the target is inline-editable. Editing commits a manual alias
 * (override) keyed by the original `from`; resetting removes it so the
 * fuzzy auto target applies again. Local input state keeps typing
 * snappy across hundreds of rows.
 */

/* Отключено вместе с блоком «Группировка получателей» — см. ниже.
function AutoGroupRow({
  from,
  autoTo,
  overridden,
  effectiveTo,
  onCommit,
  onReset,
}: {
  from: string;
  autoTo: string;
  overridden: boolean;
  effectiveTo: string;
  onCommit: (from: string, to: string) => void;
  onReset: (from: string) => void;
}) {
  const [val, setVal] = useState(effectiveTo);
  // Re-seed when the effective target changes externally (e.g. reset
  // elsewhere, or a re-grouping pass).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVal(effectiveTo);
  }, [effectiveTo]);

  function commit() {
    const next = val.trim();
    if (!next || next === effectiveTo) {
      setVal(effectiveTo);
      return;
    }
    if (next === autoTo) {
      // Back to the fuzzy default → drop any manual override.
      if (overridden) onReset(from);
    } else {
      onCommit(from, next);
    }
  }

  return (
    <div className="flex items-center gap-2 py-1 border-b border-border/40 last:border-b-0">
      <span className="truncate flex-1 min-w-0 text-muted" title={from}>
        {from}
      </span>
      <span className="text-muted shrink-0">→</span>
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setVal(effectiveTo);
        }}
        className={`input text-xs !py-1 flex-1 min-w-0 ${
          overridden ? "border-accent/50 text-text" : "text-text"
        }`}
        title={overridden ? "Изменено вручную" : "Автогруппировка"}
      />
      {/* Fixed-width slot so the row width doesn't jump when the reset
          button appears/disappears on override. *\/}
      <span className="w-7 shrink-0 flex items-center justify-center">
        {overridden && (
          <button
            onClick={() => onReset(from)}
            className="btn-icon btn-icon-sm"
            title="Сбросить к автогруппировке"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
      </span>
    </div>
  );
}
*/

export function ImportPage() {
  const nav = useNavigate();
  const setTransactions = useDataStore((s) => s.setTransactions);
  const mergeTransactions = useDataStore((s) => s.mergeTransactions);
  const clearAll = useDataStore((s) => s.clearAll);
  const rates = useDataStore((s) => s.rates);
  const transactions = useDataStore((s) => s.transactions);
  const meta = useDataStore((s) => s.importMeta);

  // Zenmoney API sync state
  const zenToken = useZenmoneyStore((s) => s.token);
  const zenStatus = useZenmoneyStore((s) => s.status);
  const zenError = useZenmoneyStore((s) => s.error);
  const zenLastSyncAt = useZenmoneyStore((s) => s.lastSyncAt);


  const zenLoaded = useZenmoneyStore((s) => s.loaded);
  const zenHydrate = useZenmoneyStore((s) => s.hydrate);
  const zenValidateAndSave = useZenmoneyStore((s) => s.validateAndSaveToken);
  const zenPullFailure = useZenmoneyStore((s) => s.pullFailure);
  const zenPushFailure = useZenmoneyStore((s) => s.pushFailure);
  const zenSync = useZenmoneyStore((s) => s.sync);
  const zenRemoveToken = useZenmoneyStore((s) => s.removeToken);
  const autoSyncEnabled = useZenmoneyStore((s) => s.autoSyncEnabled);
  const autoSyncValue = useZenmoneyStore((s) => s.autoSyncValue);
  const autoSyncUnit = useZenmoneyStore((s) => s.autoSyncUnit);
  const setAutoSync = useZenmoneyStore((s) => s.setAutoSync);

  // Push (Phase 1) — opt-in two-way sync state from useZenmoneyStore.
  const pushMode = useZenmoneyStore((s) => s.pushMode);
  const pushStatus = useZenmoneyStore((s) => s.pushStatus);
  // Push errors and per-push results aren't mirrored here any more — each push
  // writes a journal row (with a red «Ошибка» badge / expandable reasons), so
  // repeating them above the table only made the block jump around.
  const lastPushAt = useZenmoneyStore((s) => s.lastPushAt);
  const setPushMode = useZenmoneyStore((s) => s.setPushMode);
  const pushPendingEdits = useZenmoneyStore((s) => s.pushPendingEdits);
  const snapshotPolicy = useZenmoneyStore((s) => s.snapshotPolicy);
  const setSnapshotPolicy = useZenmoneyStore((s) => s.setSnapshotPolicy);
  // Pending-edit count drives the push button label / disabled state.
  const editsMap = useEditsStore((s) => s.edits);
  const editsLoaded = useEditsStore((s) => s.loaded);
  const editsHydrate = useEditsStore((s) => s.hydrate);
  const clearManyEdits = useEditsStore((s) => s.clearMany);
  useEffect(() => {
    if (!editsLoaded) editsHydrate();
  }, [editsLoaded, editsHydrate]);
  const pendingEditCount = Object.keys(editsMap).length;
  // Locally-created drafts (new operations) also go out on a Push, so the
  // button/queue counts must include them — otherwise "4 new operations"
  // reads as "Нет правок для отправки".
  const draftsMap = useDraftsStore((s) => s.drafts);
  const pendingDraftCount = Object.keys(draftsMap).length;
  // Local deletions also push (and revert from the pending-changes modal), so
  // they're part of the headline count — otherwise a delete-only state reads as
  // «Нет изменений для отправки» yet the rollback button counts it (issue #19: 4, 5).
  // Count ONLY deletions still backed by a cloud-cache row: those are the ones
  // that still need a push AND that the rollback modal lists. Once pushed, the
  // row drops out of `transactionsRaw`, but its id lingers in `deletedIds` as a
  // permanent tombstone — counting the raw id-set overstated «pending» and
  // disagreed with the modal, which showed an empty list while the button said N.
  const deletedIds = useDeletedStore((s) => s.deletedIds);
  const transactionsRaw = useDataStore((s) => s.transactionsRaw);
  const deletedCount = useMemo(() => {
    if (deletedIds.length === 0) return 0;
    const rawIds = new Set(transactionsRaw.map((t) => t.id));
    return deletedIds.reduce((n, id) => n + (rawIds.has(id) ? 1 : 0), 0);
  }, [deletedIds, transactionsRaw]);
  // Transaction-level queue — this is what the «посмотреть и откатить» modal
  // lists, so it must stay exactly the set that modal can act on.
  const pendingTotal = pendingEditCount + pendingDraftCount + deletedCount;
  // Справочники ride the SAME push, but the rollback modal doesn't cover them,
  // so they're counted apart and only folded into the headline/button. Without
  // this, dictionary-only changes read as «Нет изменений для отправки» while the
  // push would in fact send them. Count from the shared hook — a local copy here
  // once missed accounts and budgets, and a plan-only change never left (#113).
  const dictPendingCount = usePendingChanges().dictionaries;
  const pendingAll = pendingTotal + dictPendingCount;
  const [pendingModalOpen, setPendingModalOpen] = useState(false);
  // Orphaned edits: overrides whose transaction no longer exists in the data
  // (e.g. edits made on a CSV import, then switched to API — ids changed). They
  // can never apply or push, and a re-sync won't clear them, so we offer to
  // prune them. Only meaningful once the dataset is loaded (avoid flagging
  // everything as orphaned during an empty initial render).
  const orphanEditIds = useMemo(() => {
    if (transactions.length === 0) return [];
    const ids = new Set(transactions.map((t) => t.id));
    return Object.keys(editsMap).filter((id) => !ids.has(id));
  }, [editsMap, transactions]);

  useEffect(() => {
    if (!zenLoaded) zenHydrate();
  }, [zenLoaded, zenHydrate]);

  // Cloud snapshots — safety net for future push-to-cloud work.
  // Available only in API mode (no point taking a snapshot of nothing).
  const cloudSnapshots = useCloudSnapshotStore((s) => s.snapshots);
  const cloudSnapshotsLoaded = useCloudSnapshotStore((s) => s.loaded);
  const hydrateCloudSnapshots = useCloudSnapshotStore((s) => s.hydrate);
  const pruneForeignSnapshots = useCloudSnapshotStore((s) => s.pruneForeign);
  // Current Zenmoney user id — read from the local cache. Lets us
  // filter the snapshot list to "snapshots for the currently
  // connected account only", so switching accounts doesn't surface
  // foreign data. Null when there's no cache yet (CSV-only mode).
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    import("../lib/zenmoneyCache").then(({ loadZenCache }) => {
      loadZenCache().then((cache) => {
        if (!cancelled) setCurrentUserId(cache?.user?.[0]?.id ?? null);
      });
    });
    return () => {
      cancelled = true;
    };
    // `cloudSnapshots` is in the deps so we refresh the lookup when
    // a sync or restore alters the cache user record.
  }, [cloudSnapshots, zenLastSyncAt]);
  // Подключили другой аккаунт — снимки прежнего выбрасываем. Слотов пять, и
  // занимать их копиями чужой базы незачем: восстановить в текущий аккаунт из
  // них всё равно нельзя без переноса, а место под свою страховку они съедают.
  // Копии без привязки к аккаунту (старые) не трогаем — они могут быть своими.
  useEffect(() => {
    if (currentUserId == null || !cloudSnapshotsLoaded) return;
    const foreign = cloudSnapshots.some(
      (s) => s.userId != null && s.userId !== currentUserId
    );
    if (foreign) void pruneForeignSnapshots(currentUserId);
  }, [cloudSnapshots, cloudSnapshotsLoaded, currentUserId, pruneForeignSnapshots]);
  useEffect(() => {
    if (!cloudSnapshotsLoaded) hydrateCloudSnapshots();
  }, [cloudSnapshotsLoaded, hydrateCloudSnapshots]);

  const [tokenDraft, setTokenDraft] = useState("");
  const [tokenVisible, setTokenVisible] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState<string | null>(null);

  // Top-level horizontal tab on the Settings page. Groups the five
  // long sections (data source, currency, data-processing,
  // reporting period, backups) into four logical buckets so the
  // page stops being a 2000-line scroll.
  type SettingsTab = "source" | "operations" | "interface" | "processing" | "backups";
  // Вкладку можно открыть ссылкой: /settings?tab=operations. Так карточка
  // «Разрезы данных» уводит прямо в справочник категорий, а не просто
  // перезагружает ту же страницу.
  const [searchParams] = useSearchParams();
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(() => {
    const q = searchParams.get("tab");
    return q === "operations" || q === "interface" || q === "processing" || q === "backups"
      ? q
      : "source";
  });
  // Ссылка на другую вкладку с этой же страницы меняет только query — маршрут
  // остаётся прежним, компонент не перемонтируется, и начального значения
  // мало: без этого «справочник категорий» из карточки разрезов менял адрес,
  // но оставлял открытой ту же вкладку.
  useEffect(() => {
    const q = searchParams.get("tab");
    if (q === "source" || q === "operations" || q === "interface" || q === "processing" || q === "backups") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSettingsTab(q);
    }
  }, [searchParams]);

  // Inner tab inside the Бэкапы section — local files vs cloud
  // snapshots. Mirrors the Источник данных card pattern.


  // Active tab in the unified "data source" card. Defaults to
  // whichever source the user is most likely interested in:
  //   • API tab — if the token is connected (online sync is in use)
  //   • CSV tab — if there's CSV-imported data and no token
  //   • API tab — for fresh installs (most users connect via API)
  type SourceTab = "api" | "csv";
  const [sourceTab, setSourceTab] = useState<SourceTab>(() => {
    // The empty-state cards deep-link here with ?source=api|csv — honour
    // that first so the user lands on the source they picked.
    const q = searchParams.get("source");
    if (q === "api" || q === "csv") return q;
    if (zenToken) return "api";
    if (meta?.source === "csv" && transactions.length > 0) return "csv";
    return "api";
  });
  // Ссылка из шапки («Войти заново») ведёт сюда же, когда страница уже открыта.
  useEffect(() => {
    const q = searchParams.get("source");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (q === "api" || q === "csv") setSourceTab(q);
  }, [searchParams]);
  // Дзен-мани перестал принимать токен — предлагаем войти заново, не отключая.
  const zenAuthExpired =
    isAuthExpired(zenPullFailure) || isAuthExpired(zenPushFailure);

  /**
   * Спросить, можно ли заменить CSV-данные на API.
   * `false` — CSV нет, спрашивать не о чем; `true` — согласились; `null` —
   * отказались.
   */
  async function confirmReplaceCsv(): Promise<boolean | null> {
    if (!(meta?.source === "csv" && transactions.length > 0)) return false;
    const ok = await confirm({
      title: "Заменить данные из CSV?",
      message: `У вас сейчас ${formatNum(transactions.length)} ${pluralRu(transactions.length, ["операция", "операции", "операций"])} из CSV (${meta.fileName}). Синхронизация заменит их данными из Дзен-мани. Бюджеты, цели и правила сохранятся.`,
      confirmLabel: "Заменить",
      tone: "warning",
    });
    return ok ? true : null;
  }

  /** Подготовить подключение по токену: при согласии CSV стирается сразу. */
  async function prepareApiSource(): Promise<boolean> {
    const replace = await confirmReplaceCsv();
    if (replace === null) return false;
    if (replace) await clearAll();
    return true;
  }

  async function connectToken() {
    setSyncSuccess(null);
    if (!(await prepareApiSource())) return;
    const ok = await zenValidateAndSave(tokenDraft);
    if (ok) {
      setTokenDraft("");
      try {
        const r = await zenSync({ force: true });
        setSyncSuccess(formatSyncResult(r));
      } catch {
        /* error already in store */
      }
    }
  }

  /** Новый токен вместо непринятого: тот же аккаунт, кэш и правки на месте. */
  async function replaceToken() {
    setSyncSuccess(null);
    const ok = await zenValidateAndSave(tokenDraft, "token");
    if (!ok) return;
    setTokenDraft("");
    await runSync();
  }

  async function connectProvider() {
    setSyncSuccess(null);
    // Только спрашиваем: стирать CSV здесь нельзя — вход у провайдера может
    // сорваться. Согласие уходит вместе с попыткой входа, а данные стираются
    // после возврата с проверенным токеном (`main.tsx`).
    const replace = await confirmReplaceCsv();
    if (replace === null) return;
    startOAuth({ replaceCsv: replace });
  }

  async function runSync() {
    setSyncSuccess(null);
    try {
      const r = await zenSync();
      setSyncSuccess(formatSyncResult(r));
    } catch {
      /* error already in store */
    }
  }

  async function runFullSync() {
    setSyncSuccess(null);
    const ok = await confirm({
      title: "Полная синхронизация?",
      message:
        "Сбросит локальный кэш и заново скачает все данные. Используйте, если данные не сходятся или после массовых переименований категорий в Дзен-мани.",
      confirmLabel: "Полная синхронизация",
      tone: "warning",
    });
    if (!ok) return;
    try {
      const r = await zenSync({ force: true });
      setSyncSuccess(formatSyncResult(r));
    } catch {
      /* error already in store */
    }
  }

  async function disconnectToken() {
    // Считаем очередь ДО отключения: она будет очищена вместе с подключением,
    // и человек должен увидеть, сколько именно правок он теряет.
    const pendingNow = pendingAll;
    const ok = await confirm({
      title: "Отключить токен Дзен-мани?",
      message:
        "Операции останутся в этом браузере, но синхронизация станет недоступна. " +
        "Локальный кэш Дзен-мани будет очищен: балансы счетов, банки, типы счетов " +
        "и признаки категорий пропадут до следующего подключения." +
        (pendingNow > 0
          ? ` Неотправленных изменений: ${pendingNow} — они будут удалены, ` +
            "потому что относятся к этому подключению. В облаке Дзен-мани ничего не тронется."
          : ""),
      confirmLabel: "Отключить",
      tone: "danger",
    });
    if (!ok) return;
    await zenRemoveToken();
    setSyncSuccess(null);
  }

  // Manual payee aliases — user-curated overrides on top of (or in
  // place of) the fuzzy auto-grouping above.
  // Отключено вместе с блоком «Группировка получателей»: сами алиасы никуда
  // не делись и продолжают применяться в пайплайне, но править их отсюда
  // больше нельзя.
  // const manualAliases = usePayeeAliasStore((s) => s.aliases);
  // const aliasesLoaded = usePayeeAliasStore((s) => s.loaded);
  // const aliasesHydrate = usePayeeAliasStore((s) => s.hydrate);
  // const addAlias = usePayeeAliasStore((s) => s.add);
  // const removeAlias = usePayeeAliasStore((s) => s.remove);
  // Гидратацию оставляем: сохранённые алиасы продолжают применяться к данным.
  const aliasesLoaded = usePayeeAliasStore((s) => s.loaded);
  const aliasesHydrate = usePayeeAliasStore((s) => s.hydrate);
  useEffect(() => {
    if (!aliasesLoaded) aliasesHydrate();
  }, [aliasesLoaded, aliasesHydrate]);
  // const [aliasFrom, setAliasFrom] = useState("");
  // const [aliasTo, setAliasTo] = useState("");

  // Distinct payees from the current dataset — used as datalist options
  // for the manual alias inputs so the user can pick existing names by
  // typing a few letters.
/* Отключено вместе с блоком «Группировка получателей».
  const allPayeeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) {
      if (t.payee) set.add(t.payee);
      if (t.payeeOriginal) set.add(t.payeeOriginal);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
  }, [transactions]);
*/


  // Manual aliases as a from→to lookup, for marking which auto-grouping
  // rows the user has overridden.
/* Отключено вместе с блоком «Группировка получателей».
  const manualAliasMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of manualAliases) m.set(a.from, a.to);
    return m;
  }, [manualAliases]);
*/


/* Отключено вместе с блоком «Группировка получателей».
  async function submitAlias() {
    const f = aliasFrom.trim();
    const t = aliasTo.trim();
    if (!f || !t || f === t) return;
    await addAlias(f, t);
    await reapplyRules();
    setAliasFrom("");
    setAliasTo("");
  }
*/


/* Отключено вместе с блоком «Группировка получателей».
  async function dropAlias(from: string) {
    await removeAlias(from);
    await reapplyRules();
  }
*/


  const reportPeriodLoaded = useReportPeriodStore((s) => s.loaded);
  const reportPeriodHydrate = useReportPeriodStore((s) => s.hydrate);
  useEffect(() => {
    if (!reportPeriodLoaded) reportPeriodHydrate();
  }, [reportPeriodLoaded, reportPeriodHydrate]);

  // Scheduled backup
  const backupLoaded = useBackupStore((s) => s.loaded);
  const backupHydrate = useBackupStore((s) => s.hydrate);
  useEffect(() => {
    if (!backupLoaded) backupHydrate();
  }, [backupLoaded, backupHydrate]);

  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(transactions.length > 0 ? "merge" : "replace");
  const fileRef = useRef<HTMLInputElement>(null);




  async function handleFile(file: File) {
    setError(null);
    setSuccess(null);
    // Guard: API token connected → confirm before mixing.
    if (zenToken) {
      const ok = await confirm({
        title: "Импортировать CSV поверх данных Дзен-мани?",
        message:
          "У вас подключён Дзен-мани. Импорт CSV может затереть синхронизированные данные. Если импорт нужен, советуем сначала отключить Дзен-мани на этой странице, чтобы избежать путаницы.",
        confirmLabel: "Продолжить",
        tone: "warning",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      const result = await parseCsv(text, rates);
      if (result.parsed === 0) {
        throw new Error(CSV_NO_ROWS);
      }
      const importMeta = {
        importedAt: new Date().toISOString(),
        fileName: file.name,
        totalRows: result.totalRows,
        parsed: result.parsed,
        skipped: result.skipped,
        source: "csv" as const,
      };
      if (mode === "merge" && transactions.length > 0) {
        const r = await mergeTransactions(result.transactions, importMeta);
        setSuccess(
          `Добавлено ${r.added} новых, пропущено ${r.duplicates} дубликатов. Всего: ${formatNum(transactions.length + r.added)}.`
        );
      } else {
        await setTransactions(result.transactions, importMeta);
        setSuccess(`Загружено ${formatNum(result.parsed)} ${pluralRu(result.parsed, ["операция", "операции", "операций"])}.`);
      }
      setTimeout(() => nav("/"), 1500);
    } catch (e) {
      setError(
        e instanceof Error && e.message === CSV_NO_ROWS
          ? CSV_NO_ROWS
          : `Файл не прочитался. Проверьте, что это CSV-выгрузка из Дзен-мани, и попробуйте ещё раз${
              e instanceof Error && e.message ? ` (${e.message})` : ""
            }`
      );
    } finally {
      setBusy(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

/* Отключено вместе с блоком «Группировка получателей».
  const aliasPreview = (() => {
    if (transactions.length === 0) return null;
    const allPayees = transactions.map((t) => t.payeeOriginal || t.payee).filter(Boolean);
    const aliases = buildPayeeAliasMap(allPayees);
    return aliases;
  })();
*/


  return (
    <div className="space-y-6">
      <PageHeader
        icon={Settings}
        title="Настройки"
      />

      {/* Horizontal tab bar — top-level grouping for the long
          Settings page. Each tab shows one logical bucket of
          sections; sub-headings inside each tab keep their own
          structure (e.g. "Резервные копии" → "Облачный снимок" +
          "Push в облако"). */}
      {/* Разделы настроек — общим `Segmented` крупной ступени, как
          переключатели разделов на других страницах. `max-w-full` — чтобы на
          телефоне дорожка листалась внутри себя, а не растягивала страницу:
          без него прокрутка не включалась, и пять вкладок уходили за край. */}
      <Segmented
        tabs
        label="Разделы настроек"
        value={settingsTab}
        onChange={setSettingsTab}
        className="self-start -mt-1 scroll-soft-x max-w-full"
        options={[
          { value: "source", label: "Данные", icon: Database },
          { value: "backups", label: "Бэкапы", icon: History },
          { value: "interface", label: "Оформление", icon: ALargeSmall },
          { value: "processing", label: "Расчёты", icon: Calculator },
          { value: "operations", label: "Справочники", icon: ArrowLeftRight },
        ]}
      />

      {settingsTab === "source" && (<>
      {/* Unified data-source card. Replaces what used to be three
          separate islands (API status, CSV import, current database
          summary) — they all answered "where's your data coming
          from and what state is it in?". Now: source tabs at the
          top, panel for the active source, current-data footer at
          the bottom. */}
      <section data-tour="source" className="card-tray card-pad space-y-5">
        {/* Source tabs. A small green dot on the tab whose source
            is actually populated lets the user tell at a glance
            which mode they're in even if the active tab is the
            other one (e.g. browsing CSV settings while connected
            via API). */}
        <SettingsSectionHeader
          icon={Database}
          title="Источник данных"
          right={
          <Segmented
            size="sm"
            tabs
            label="Источник данных"
            value={sourceTab}
            onChange={setSourceTab}
            options={[
              {
                value: "api",
                label: "Дзен-мани API",
                icon: Cloud,
                title: "Онлайн-синхронизация с Дзен-мани по токену",
                dot: zenToken ? "Источник активен" : undefined,
              },
              {
                value: "csv",
                label: "CSV-файл",
                icon: Upload,
                title: "Офлайн-импорт CSV-выгрузки из мобильного приложения",
                dot:
                  meta?.source === "csv" && transactions.length > 0
                    ? "Источник активен"
                    : undefined,
              },
            ]}
          />
          }
        />

        {/* ── API panel ────────────────────────────────────────── */}
        {sourceTab === "api" && (
          <div className="rounded-xl border border-border bg-panel2/30 p-4 space-y-3">
            {/* Заголовок, а справа — состояние и расписание. Описание уехало под
                знак вопроса: читают его один раз, а место занимало всегда. */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="font-medium text-sm flex items-center gap-2 min-w-0">
                <Cloud className="w-4 h-4 text-accent" />
                Дзен-мани API{" "}
                <span className="text-muted text-xs font-normal">
                  (онлайн-синхронизация)
                </span>
                <InfoPopover label="Что даёт синхронизация">
                  <p>
                    Качает данные напрямую из вашего аккаунта Дзен-мани. Кроме
                    операций получим курсы валют, баланс счетов, регулярные
                    платежи и иерархию категорий — без выгрузки CSV.
                  </p>
                  <p>
                    <InfoTerm>Токен</InfoTerm> хранится только в этом браузере и
                    никуда не отправляется, кроме самого Дзен-мани.{" "}
                    <InfoTerm>Полная синхронизация</InfoTerm> сбрасывает локальный
                    кэш и качает всё заново — нужна, если данные разошлись.
                  </p>
                </InfoPopover>
              </div>
              {zenToken && (
                <div data-tour="autosync" className="flex items-center gap-3 flex-wrap text-xs text-muted">
                  <span className="flex items-center gap-1.5 text-text">
                    <CheckCircle2 className="w-3.5 h-3.5 text-income shrink-0" />
                    Подключено
                  </span>
                  {/* Расписание рядом с состоянием: «Подключено · каждые 30 мин»
                      читается одной строкой. */}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={autoSyncEnabled}
                      onChange={(on) =>
                        setAutoSync(on, autoSyncValue, autoSyncUnit)
                      }
                      label="Автосинхронизация"
                    />
                    <span>Автосинхронизация каждые</span>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={autoSyncValue}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n) && n > 0) {
                          setAutoSync(autoSyncEnabled, n, autoSyncUnit);
                        }
                      }}
                      className="input text-xs !px-2.5 w-14 tabular-nums"
                    />
                    <Select
                      size="sm"
                      className="w-24"
                      value={autoSyncUnit}
                      onChange={(v) => setAutoSync(autoSyncEnabled, autoSyncValue, v)}
                      options={[
                        { value: "min" as const, label: "мин" },
                        { value: "hour" as const, label: "час" },
                        { value: "day" as const, label: "день" },
                      ]}
                      ariaLabel="Единица интервала синхронизации"
                    />
                  </label>
                </div>
              )}
            </div>

        {!zenToken ? (
          <div className="space-y-3">
            {isOAuthConfigured() && (
              <button onClick={connectProvider} className="btn-primary text-sm">
                Войти через Дзен-мани
              </button>
            )}
            <div className="text-xs text-muted">
              <KeyRound className="w-3.5 h-3.5 inline align-text-bottom mr-1" />
              Личный токен получите в{" "}
              <a
                href="https://zerro.app/token"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline inline-flex items-center gap-0.5"
              >
                zerro.app/token <ExternalLink className="w-3 h-3" />
              </a>{" "}
              — войдите своим логином от Дзен-мани и скопируйте строку.
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <input
                  type={tokenVisible ? "text" : "password"}
                  value={tokenDraft}
                  onChange={(e) => setTokenDraft(e.target.value)}
                  placeholder="Вставьте токен"
                  className="input text-sm pr-9 w-full font-mono"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={zenStatus === "checking" || zenStatus === "syncing"}
                />
                <button
                  type="button"
                  onClick={() => setTokenVisible((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"
                  title={tokenVisible ? "Скрыть" : "Показать"}
                >
                  {tokenVisible ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
              <button
                onClick={connectToken}
                disabled={
                  !tokenDraft.trim() ||
                  zenStatus === "checking" ||
                  zenStatus === "syncing"
                }
                className="btn-primary text-sm whitespace-nowrap"
              >
                {zenStatus === "checking" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : zenStatus === "syncing" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <LinkIcon className="w-3.5 h-3.5" />
                )}
                {zenStatus === "checking"
                  ? "Проверяю…"
                  : zenStatus === "syncing"
                    ? "Качаю данные…"
                    : "Подключить и синхронизировать"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Row 1: token field (read-only) + action buttons. */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[220px]">
                <input
                  type={tokenVisible ? "text" : "password"}
                  value={zenToken}
                  readOnly
                  aria-label="Текущий токен Дзен-мани"
                  className="input text-sm pr-9 w-full font-mono opacity-70 cursor-default"
                />
                <button
                  type="button"
                  onClick={() => setTokenVisible((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"
                  title={tokenVisible ? "Скрыть" : "Показать"}
                >
                  {tokenVisible ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
              <button
                onClick={runSync}
                disabled={zenStatus === "syncing"}
                className="btn-primary text-sm"
              >
                {zenStatus === "syncing" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                {zenStatus === "syncing" ? "Синхронизирую…" : "Синхронизировать"}
              </button>
              <button
                onClick={runFullSync}
                disabled={zenStatus === "syncing"}
                className="btn-ghost text-sm text-muted"
                title="Сбросить локальный кэш и скачать всё заново"
              >
                <CloudDownload className="w-4 h-4" />
                Полная синхронизация
              </button>
              <button
                onClick={disconnectToken}
                disabled={zenStatus === "syncing"}
                className="btn-danger text-sm"
                title="Удалить токен из браузера"
              >
                <Unlink className="w-3.5 h-3.5" />
                Отключить
              </button>
            </div>

            {/* Токен перестал приниматься: войти заново, не отключая. «Отключить»
                стёр бы кэш и очередь неотправленных правок — из-за этого люди
                сидели со сломанной синхронизацией, а не переподключались. */}
            {zenAuthExpired && (
              <div className="space-y-2">
                {!zenError && (
                  <div className="text-xs text-expense flex items-start gap-2">
                    <KeyRound className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>
                      Дзен-мани больше не принимает этот токен. Войдите заново — данные и
                      неотправленные правки сохранятся.
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  {isOAuthConfigured() && (
                    <button
                      onClick={() => startOAuth({ replaceCsv: false })}
                      disabled={zenStatus === "checking" || zenStatus === "syncing"}
                      className="btn-primary text-sm"
                    >
                      Войти через Дзен-мани
                    </button>
                  )}
                  <input
                    type="password"
                    value={tokenDraft}
                    onChange={(e) => setTokenDraft(e.target.value)}
                    placeholder={isOAuthConfigured() ? "Или вставьте новый токен" : "Вставьте новый токен"}
                    aria-label="Новый токен Дзен-мани"
                    className="input text-sm flex-1 min-w-[220px] font-mono"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={zenStatus === "checking" || zenStatus === "syncing"}
                  />
                  <button
                    onClick={replaceToken}
                    disabled={!tokenDraft.trim() || zenStatus === "checking" || zenStatus === "syncing"}
                    className={clsx(isOAuthConfigured() ? "btn-ghost" : "btn-primary", "text-sm whitespace-nowrap")}
                  >
                    {zenStatus === "checking" ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <KeyRound className="w-3.5 h-3.5" />
                    )}
                    Заменить токен
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {zenError && (
          <div className="mt-3 text-xs text-expense flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{zenError}</span>
          </div>
        )}
        {syncSuccess && !syncSuccess.startsWith("Полная синхронизация") && (
          <div className="mt-3 text-xs text-income flex items-start gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{syncSuccess}</span>
          </div>
        )}
          </div>
        )}

        {/* ── CSV panel ────────────────────────────────────────── */}
        {sourceTab === "csv" && (
          <div className="rounded-xl border border-border bg-panel2/30 p-4 space-y-3">
            {/* Заголовок, а справа — режим и сколько уже в базе. Пояснения про
                формат и про то, чем «Дополнить» отличается от «Заменить», ушли
                под знак вопроса и в подсказки самих кнопок. */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="font-medium text-sm flex items-center gap-2 min-w-0">
                <Upload className="w-4 h-4 text-accent" />
                Импорт CSV-выгрузки{" "}
                <span className="text-muted text-xs font-normal">
                  (офлайн-синхронизация)
                </span>
                <InfoPopover label="Как это работает">
                  <p>
                    Офлайн-путь для тех, кому не нужен токен: берём CSV-выгрузку
                    из приложения Дзен-мани. Файл разбирается прямо в браузере и
                    никуда не отправляется — ни к нам, ни в Дзен-мани.
                  </p>
                  <p>
                    <InfoTerm>Что за файл.</InfoTerm> CSV с шапкой, разделитель —
                    точка с запятой. Колонки читаются по названиям:{" "}
                    <code className="pill">date</code>,{" "}
                    <code className="pill">categoryName</code>,{" "}
                    <code className="pill">payee</code>,{" "}
                    <code className="pill">outcome</code> /{" "}
                    <code className="pill">income</code>,{" "}
                    <code className="pill">outcomeAccountName</code> /{" "}
                    <code className="pill">incomeAccountName</code> и валюты этих
                    счетов. Строки без даты и без сумм пропускаются.
                  </p>
                  <p>
                    <InfoTerm>Дополнить</InfoTerm> — возьмёт из файла только те
                    строки, которых ещё нет. Своих номеров у операций в выгрузке
                    нет, поэтому строка узнаётся по дате, месту в файле и
                    получателю: повторная загрузка того же файла ничего не
                    задвоит, а вот та же операция из ДРУГОЙ выгрузки приедет
                    второй раз.
                  </p>
                  <p>
                    <InfoTerm>Заменить</InfoTerm> — сотрёт загруженные операции и
                    положит вместо них файл целиком. Настройки, правила и бюджеты
                    останутся; локальные правки операций держатся за их номера,
                    поэтому часть из них после замены может остаться без своей
                    операции.
                  </p>
                  <p>
                    Если подключена онлайн-синхронизация, класть CSV поверх неё не
                    стоит — приложение переспросит перед загрузкой.
                  </p>
                </InfoPopover>
              </div>
              {transactions.length > 0 && (
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs text-muted">
                    Записей в базе:{" "}
                    <strong className="text-text tabular-nums">
                      {formatNum(transactions.length)}
                    </strong>
                  </span>
                  <Segmented
                    size="sm"
                    label="Как загрузить файл"
                    value={mode}
                    onChange={setMode}
                    options={[
                      {
                        value: "merge",
                        label: "Дополнить",
                        icon: Layers,
                        title: "Добавить новые операции, дубликаты по id отбрасываются",
                      },
                      {
                        value: "replace",
                        label: "Заменить",
                        icon: Replace,
                        title: "Удалить все текущие данные и загрузить файл с нуля",
                      },
                    ]}
                  />
                </div>
              )}
            </div>

            {/* Dropzone — full-width bar styled like the API token
                input. Click anywhere on the bar opens the file picker;
                drag-and-drop still works on the whole surface. The
                dashed border keeps the drop-target affordance. */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              className={`cursor-pointer transition-colors w-full flex items-center justify-center gap-2 px-3 py-3 rounded-lg border-2 border-dashed text-sm ${
                dragOver
                  ? "border-accent bg-accent/5 text-accent"
                  : "border-border hover:border-accent/50 hover:bg-panel2/40 text-muted"
              }`}
            >
              <Upload className="w-4 h-4" />
              <span className="font-medium">
                {busy ? "Обрабатываю…" : "Перетащите CSV или кликните"}
              </span>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
            </div>

            {/* CSV-specific status messages. Lifted into the CSV
                panel so they stay contextual to the action that
                produced them. */}
            {error && (
              <div className="mt-3 text-xs text-expense flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            {success && (
              <div className="mt-3 text-xs text-income flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{success}</span>
              </div>
            )}
          </div>
        )}

        {/* Импорт из Excel — отдельной карточкой, а не внутри переключателя
            источника: он ничего не заменяет, а добавляет новые операции. */}
        <ImportXlsxCard />

        {/* ── Current data footer ─────────────────────────────────
            Shows what's already in the local IndexedDB plus the
            primary actions (open the dashboard / clear local data).
            Replaces the standalone "Текущая база" card. */}
        {meta && transactions.length > 0 ? (
          <div className="border-t border-border pt-4">
            <div className="flex items-start justify-between flex-wrap gap-x-8 gap-y-3 text-sm">
              <div>
                <div className="label mb-1">Источник данных</div>
                <div className="flex items-center gap-1.5 min-w-0">
                  {meta.source === "api" ? (
                    <>
                      <Cloud className="w-3.5 h-3.5 text-accent shrink-0" />
                      <span>Дзен-мани API</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-3.5 h-3.5 text-accent shrink-0" />
                      <span>CSV-файл</span>
                    </>
                  )}
                </div>
              </div>
              <div>
                <div className="label mb-1">Импортировано</div>
                <div>
                  {meta.source === "csv" ? formatDate(meta.importedAt) : "—"}
                </div>
              </div>
              <div>
                <div className="label mb-1">Последняя синхронизация</div>
                <div>
                  {meta.source === "api" && zenLastSyncAt
                    ? new Date(zenLastSyncAt).toLocaleString("ru-RU")
                    : "—"}
                </div>
              </div>
              <div>
                <div className="label mb-1">Всего операций</div>
                <div>{formatNum(transactions.length)}</div>
              </div>
              <div>
                <div className="label mb-1">Период</div>
                <div>
                  {formatDate(
                    transactions.reduce(
                      (m, t) => (t.date < m ? t.date : m),
                      transactions[0].date
                    )
                  )}
                  {" — "}
                  {formatDate(
                    transactions.reduce(
                      (m, t) => (t.date > m ? t.date : m),
                      transactions[0].date
                    )
                  )}
                </div>
              </div>
              <button
                onClick={async () => {
                  const ok = await confirm({
                    title: "Очистить локальные данные?",
                    message:
                      "Удалятся ВСЕ локальные данные из этого браузера: операции, кэш, правки, черновики, исключения дубликатов, калибровка, бюджеты, правила и т. п. Подключение к Дзен-мани и настройки сохранятся, данные в облаке НЕ пострадают. Страница перезагрузится.",
                    confirmLabel: "Очистить",
                    tone: "danger",
                  });
                  if (!ok) return;
                  // Allow-list: keep only the connection + preferences. Everything
                  // else (incl. duplicate exclusions, categoryMeta, server
                  // timestamp & cache) is wiped, so the next sync is a clean FULL
                  // re-pull and nothing «resurrects».
                  await db.clearAllExcept([
                    "zenmoneyToken",
                    "zenmoneyPushEnabled",
                    "zenmoneyPushMode",
                    "zenmoneySnapshotPolicy",
                    "zenmoneyAutoSyncEnabled",
                    "zenmoneyAutoSyncValue",
                    "zenmoneyAutoSyncUnit",
                    "displaySettings",
                    "columnWidths",
                    "diffModes",
                    "dashboardLayout",
                    "reportPeriod",
                    "includeOffBalance",
                    "payeeGrouping",
                    "backupInterval",
                    "backupLastAt",
                    "rates",
                  ]);
                  window.location.reload();
                }}
                className="btn-danger text-sm ml-auto self-center"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Очистить локальные данные
              </button>
            </div>
          </div>
        ) : (
          <div className="border-t border-border pt-4 text-xs text-muted">
            База пуста — подключите Дзен-мани или загрузите CSV выше, чтобы
            увидеть аналитику.
          </div>
        )}
      </section>

      {/* Аккаунты — сразу под источником данных: это тот же вопрос «чьи
          данные на экране», только на уровень выше. */}
      <AccountsSettings />

      </>)}

      {settingsTab === "operations" && <OperationsSettings />}

      {settingsTab === "interface" && <InterfaceSettings />}

      {/* Currency (base + rates) lives in the «Расчёты» tab — it's an input to
          how every amount is computed, alongside the reporting period and
          data-scope toggles. Rendered before the main processing block below, so
          it sits first in the tab. */}
      {settingsTab === "processing" && <ProcessingSettings />}

      {settingsTab === "backups" && (
        <BackupSettings currentUserId={currentUserId} onOpenSource={() => setSettingsTab("source")} />
      )}

      {/* Люди на общем аккаунте (#92). Сама карточка прячется, когда человек
          один, — на личном аккаунте настраивать нечего. */}
      {settingsTab === "source" && zenToken && sourceTab === "api" && <UsersSettings />}

      {/* Перенос своих настроек между устройствами через Дзен-мани — перед
          отправкой правок: это тоже про то, что уходит в Дзен-мани. */}
      {settingsTab === "source" && zenToken && sourceTab === "api" && <CloudSettingsCard />}

      {/* Push в облако — Phase 1, opt-in via the toggle below.
          Only visible when an API token is connected; the safety-net
          snapshot (in the Бэкапы tab) is the prerequisite. */}
      {settingsTab === "source" && zenToken && sourceTab === "api" && (
        <div className="card-tray card-pad">
            <SettingsSectionHeader
              icon={CloudUpload}
              title="Двусторонняя синхронизация с Дзен-мани"
              className="mb-3"
              right={
                /* Общий знак вопроса, а не своя кнопка с панелью: самодельная
                   была на 20px против 16 у всех прочих на настройках, со своим
                   позиционированием и своим закрытием по клику мимо. Один
                   компонент — один размер и одно поведение. */
                <InfoPopover label="Как это работает">
                  <p>
                    По умолчанию сервис работает в <InfoTerm>режиме чтения</InfoTerm>:
                    локальные правки остаются только в этом браузере. Выберите
                    режим отправки, чтобы они уходили в облако.
                  </p>
                  <p>
                    <InfoTerm>Что отправляется:</InfoTerm> дата, получатель,
                    бренд, комментарий, сумма, валюта, категория, подкатегория,
                    смена типа между Расход / Доход / Возврат и на/с «Перевод»,
                    смена счёта (в том числе счетов перевода), мультивалютные
                    операции.
                  </p>
                  <p>
                    <InfoTerm>Безопасность:</InfoTerm> перед отправкой делается
                    снимок аккаунта — он появится в{" "}
                    <button
                      type="button"
                      onClick={() => setSettingsTab("backups")}
                      className="text-accent hover:underline"
                    >
                      списке облачных снимков
                    </button>
                    , его можно скачать или восстановить.
                  </p>
                  <p>
                    <InfoTerm>Конфликты:</InfoTerm> сервер решает их по правилу
                    «последний выиграл» (поле <code>changed</code>): если ту же
                    операцию изменили в облаке позже, ваша отправка для неё может
                    проиграть. На этот случай и есть снимок.
                  </p>
                </InfoPopover>
              }
            />

            {/* Controls row — mode + snapshot policy, both compact. The verbose
                per-mode descriptions moved into tooltips; the prose into «?». */}
            {/* Both settings live in one inset panel with the active choice
                explained right under it — three loose label/control lines read
                as unrelated scraps, and the modes' meaning was hover-only. */}
            <div data-tour="push-mode" className="rounded-xl border border-border bg-panel2/30 p-4 mb-3 space-y-3">
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm font-medium w-44 shrink-0">
                    Отправка правок в облако
                  </span>
                  <Segmented
                    size="sm"
                    label="Отправка правок в облако"
                    value={pushMode}
                    onChange={setPushMode}
                    options={[
                      { value: "off", label: "Выключена" },
                      { value: "manual", label: "Вручную" },
                      { value: "auto", label: "Авто" },
                      { value: "on-sync", label: "При синхронизации" },
                    ]}
                  />
                  {/* Always present, so the row never changes shape — it just
                      enables in «Вручную», where sending is a manual act. */}
                  <button
                    onClick={async () => {
                      if (pendingAll === 0) return;
                      const confirmed = await confirm({
                        title: `Отправить ${pendingAll} ${pluralRu(pendingAll, ["изменение", "изменения", "изменений"])} в Дзен-мани?`,
                        message:
                          "Перед отправкой автоматически сохранится копия облачного состояния и пройдёт проверка на конфликты (операции, изменённые в облаке после вашей синхронизации, не перезатираются). Неподдерживаемые правки будут пропущены — вы увидите их список после операции.",
                        confirmLabel: "Отправить",
                        tone: "warning",
                      });
                      if (!confirmed) return;
                      try {
                        await pushPendingEdits();
                      } catch {
                        /* error already in store */
                      }
                    }}
                    disabled={
                      pushMode !== "manual" ||
                      pushStatus === "syncing" ||
                      pendingAll === 0 ||
                      !zenToken
                    }
                    title={
                      pushMode !== "manual"
                        ? "Доступно в режиме «Вручную» — в остальных правки уходят сами"
                        : pendingAll === 0
                          ? "Нет накопленных правок"
                          : "Отправить накопленные правки в Дзен-мани"
                    }
                    className="btn-primary text-xs sm:ml-auto"
                  >
                    {pushStatus === "syncing" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CloudUpload className="w-3.5 h-3.5" />
                    )}
                    {pushStatus === "syncing" ? "Отправляю…" : "Отправить в облако"}
                  </button>
                </div>
                <p className="text-xs text-muted mt-1.5 sm:ml-[calc(11rem+0.75rem)]">
                  {pushMode === "off"
                    ? "Правки остаются только в этом браузере. Безопасный режим по умолчанию."
                    : pushMode === "manual"
                      ? "Правки копятся и уходят по кнопке «Отправить» — полный контроль."
                      : pushMode === "auto"
                        ? "Правка уезжает в облако через 2 секунды после изменения."
                        : "Правки отправляются вместе с каждой синхронизацией — ручной и по расписанию."}
                </p>
              </div>

              <div className="border-t border-border/60 pt-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm font-medium w-44 shrink-0">
                    Копия облака перед отправкой
                  </span>
                  <Segmented
                    size="sm"
                    label="Копия облака перед отправкой"
                    value={snapshotPolicy}
                    onChange={setSnapshotPolicy}
                    options={[
                      { value: "always", label: "Каждый раз" },
                      { value: "daily", label: "Раз в день" },
                      { value: "never", label: "Никогда" },
                    ]}
                  />
                </div>
                <p className="text-xs text-muted mt-1.5 sm:ml-[calc(11rem+0.75rem)]">
                  Сохраняем состояние облака до отправки — если что-то пойдёт не
                  так, из копии можно восстановиться.{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setSettingsTab("backups");
                    }}
                    className="text-accent hover:underline inline-flex items-center gap-0.5"
                  >
                    Снимки во вкладке «Бэкапы»
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </p>
              </div>
            </div>


            {/* Sync history, merged into this card. Rendered as an inset panel
                (the same nested-block treatment the Бэкапы tab uses) so the
                table reads as its own thing instead of blending into the
                settings rows above. */}
            <div className="rounded-xl border border-border bg-panel2/30 p-4 mt-4">
              <SyncLog
                embedded
                status={
                  <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span>
                      В очереди:{" "}
                      <strong className="text-text tabular-nums">
                        {pendingAll}
                      </strong>{" "}
                      {pluralRu(pendingAll, [
                        "изменение",
                        "изменения",
                        "изменений",
                      ])}
                      {pendingDraftCount > 0 && (
                        <> (новых операций: {pendingDraftCount})</>
                      )}
                      {dictPendingCount > 0 && (
                        <> (справочники: {dictPendingCount})</>
                      )}
                      {/* The rollback action lives with the number it acts on,
                          inline — so it never adds a row to the layout. It covers
                          operations only, hence the pendingTotal guard. */}
                      {pendingTotal > 0 && (
                        <>
                          {" · "}
                          <button
                            onClick={() => setPendingModalOpen(true)}
                            className="text-accent hover:underline"
                            title="Просмотр и откат локальных изменений, ещё не отправленных в облако"
                          >
                            посмотреть и откатить
                          </button>
                        </>
                      )}
                      {/* Зависшие правки — в этой же строке, а не плашкой над
                          журналом: плашка появлялась и меняла высоту карточки. */}
                      {orphanEditIds.length > 0 && (
                        <span className="text-warn">
                          {" · "}
                          {formatNum(orphanEditIds.length)}{" "}
                          {pluralRu(orphanEditIds.length, ["правка зависла", "правки зависли", "правок зависли"])}
                          <InfoPopover label="Что такое зависшие правки">
                            <p>
                              Подходящей операции в данных нет. Обычно остаётся после
                              перехода с CSV на подключённый Дзен-мани (меняются id): такие правки не
                              применяются и не уходят в облако, а повторная синхронизация их не убирает.
                              Убрать их можно здесь — на облако это не влияет.
                            </p>
                          </InfoPopover>{" "}
                          <button
                            type="button"
                            className="text-expense hover:underline"
                            onClick={async () => {
                              // Без вопроса: правки вернёт «Отменить» на плашке.
                              const n = orphanEditIds.length;
                              const undo = editUndo(orphanEditIds);
                              await clearManyEdits(orphanEditIds);
                              await useDataStore.getState().refresh();
                              toast(`${pluralRu(n, ["Убрана", "Убраны", "Убрано"])} ${n} ${pluralRu(n, ["зависшая правка", "зависшие правки", "зависших правок"])}`, { undo });
                            }}
                          >
                            убрать
                          </button>
                        </span>
                      )}
                    </span>
                    {pushStatus === "syncing" ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Отправка…
                      </span>
                    ) : (
                      <span>
                        Последняя отправка:{" "}
                        {lastPushAt
                          ? new Date(lastPushAt).toLocaleString("ru-RU")
                          : "—"}
                      </span>
                    )}
                  </span>
                }
              />
            </div>

            {/* Что с синхронизацией и отчёт для автора — под журналом. */}
            <SyncDiagnostics />
          </div>
      )}

      {/* The log belongs to syncing, so it only lives on the API source: with a
          token it's folded into the sync card above; without one it stands
          alone (past syncs are still worth seeing on the connect screen). In
          CSV mode nothing syncs, so there's no log at all. */}
      {settingsTab === "source" && sourceTab === "api" && !zenToken && <SyncLog />}

      {pendingModalOpen && (
        <PendingChangesModal onClose={() => setPendingModalOpen(false)} />
      )}
    </div>
  );
}
