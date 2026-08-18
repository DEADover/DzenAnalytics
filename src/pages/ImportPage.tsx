import { useEffect, useMemo, useState, useRef, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Upload,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Palette,
  Replace,
  Layers,
  Download,
  Database,
  Cloud,
  RefreshCw,
  Loader2,
  KeyRound,
  ExternalLink,
  Eye,
  EyeOff,
  Link as LinkIcon,
  Unlink,
  Clock,
  Settings,
  History,
  CloudDownload,
  CloudUpload,
  Info,
  ChevronDown,
  Calculator,
  HardDrive,
  ALargeSmall,
  ArrowLeftRight,
  HelpCircle,
  ArrowRight,
} from "lucide-react";
import { parseCsv } from "../lib/csv";
import { SyncLog } from "../components/SyncLog";
import { OperationsSettings } from "../components/OperationsSettings";
import { SettingsSectionHeader } from "../components/SettingsSectionHeader";
import { PendingChangesModal } from "../components/PendingChangesModal";
import { SlicesSettings } from "../components/SlicesSettings";
import { SettingRow } from "../components/SettingRow";
import { InfoPopover, InfoTerm } from "../components/InfoPopover";
import { Switch } from "../components/Switch";
import { Segmented } from "../components/Segmented";
import { Select } from "../components/Select";
import { useDeletedStore } from "../store/useDeletedStore";
import { useDataStore } from "../store/useDataStore";
import { useZenmoneyStore, recalcBalanceCalibration } from "../store/useZenmoneyStore";
import { useOffBalanceStore } from "../store/useOffBalanceStore";
import { useCloudSnapshotStore } from "../store/useCloudSnapshotStore";
import { useEditsStore } from "../store/useEditsStore";
import { useDraftsStore } from "../store/useDraftsStore";
import { confirm } from "../store/useConfirmStore";
import { pluralRu } from "../lib/plural";
import { useBackupStore, type BackupInterval } from "../store/useBackupStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { usePayeeAliasStore } from "../store/usePayeeAliasStore";
import { Combobox } from "../components/Combobox";
import { PageHeader } from "../components/PageHeader";
import { formatNum, formatDate, formatMoney } from "../lib/format";
import { useDisplayStore, type TableFontLevel } from "../store/useDisplayStore";
import { useThemeStore } from "../store/useThemeStore";
import { parseAndValidateBackup, restoreBackupPayload } from "../lib/backup";
import { useTagEditsStore } from "../store/useTagEditsStore";
import { useNewCategoriesStore } from "../store/useNewCategoriesStore";
import { useTagDeletionsStore } from "../store/useTagDeletionsStore";
import { usePlannedDeletionsStore } from "../store/usePlannedDeletionsStore";
import {
  useCounterpartyEditsStore,
  countCounterpartyPending,
} from "../store/useCounterpartyEditsStore";
import * as db from "../lib/db";
import { ImportXlsxCard } from "../components/ImportXlsxCard";

type Mode = "replace" | "merge";

/**
 * One row of the auto-grouping table. Shows `from → effectiveTo` where
 * the target is inline-editable. Editing commits a manual alias
 * (override) keyed by the original `from`; resetting removes it so the
 * fuzzy auto target applies again. Local input state keeps typing
 * snappy across hundreds of rows.
 */
const TABLE_FONT_LABELS: Record<TableFontLevel, string> = {
  1: "Мелкий",
  2: "Компактный",
  3: "Обычный",
  4: "Крупный",
  5: "Очень крупный",
};

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
        title={overridden ? "Изменено вручную" : "Авто-группировка"}
      />
      {/* Fixed-width slot so the row width doesn't jump when the reset
          button appears/disappears on override. *\/}
      <span className="w-7 shrink-0 flex items-center justify-center">
        {overridden && (
          <button
            onClick={() => onReset(from)}
            className="text-muted hover:text-text p-1"
            title="Сбросить к авто-группировке"
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
  const setRate = useDataStore((s) => s.setRate);
  const setBase = useDataStore((s) => s.setBase);
  const transactions = useDataStore((s) => s.transactions);
  const meta = useDataStore((s) => s.importMeta);
  // Отключено вместе с блоком «Группировка получателей»:
  // const payeeGrouping = useDataStore((s) => s.payeeGroupingEnabled);
  // const setPayeeGrouping = useDataStore((s) => s.setPayeeGrouping);
  // Тема: в шапке переключаются только светлая и тёмная, а «как в системе»
  // до этого нигде не выбиралась — жила в хранилище без интерфейса.
  const themeMode = useThemeStore((s) => s.mode);
  const resolvedTheme = useThemeStore((s) => s.resolved);
  const setThemeMode = useThemeStore((s) => s.setMode);
  const fractionDigits = useDisplayStore((s) => s.fractionDigits);
  const statementLine = useDisplayStore((s) => s.statementLine);
  const setStatementLine = useDisplayStore((s) => s.setStatementLine);
  const setFractionDigits = useDisplayStore((s) => s.setFractionDigits);
  const tableFontLevel = useDisplayStore((s) => s.tableFontLevel);
  const setTableFontLevel = useDisplayStore((s) => s.setTableFontLevel);
  const includeOffBalance = useOffBalanceStore((s) => s.includeOffBalance);
  const setIncludeOffBalance = useOffBalanceStore((s) => s.setIncludeOffBalance);

  // Zenmoney API sync state
  const zenToken = useZenmoneyStore((s) => s.token);
  const zenStatus = useZenmoneyStore((s) => s.status);
  const zenError = useZenmoneyStore((s) => s.error);
  const zenLastSyncAt = useZenmoneyStore((s) => s.lastSyncAt);
  const zenLoaded = useZenmoneyStore((s) => s.loaded);
  const zenHydrate = useZenmoneyStore((s) => s.hydrate);
  const zenValidateAndSave = useZenmoneyStore((s) => s.validateAndSaveToken);
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
  // push would in fact send them (the editors no longer have their own button).
  const tagEditsMap = useTagEditsStore((s) => s.edits);
  const newCatsItems = useNewCategoriesStore((s) => s.items);
  const tagDeletionsMap = useTagDeletionsStore((s) => s.deletions);
  const cpRenames = useCounterpartyEditsStore((s) => s.renames);
  const cpCreated = useCounterpartyEditsStore((s) => s.created);
  const cpDeleted = useCounterpartyEditsStore((s) => s.deleted);
  const cpMerges = useCounterpartyEditsStore((s) => s.merges);
  const plannedDeletionsMap = usePlannedDeletionsStore((s) => s.deletions);
  const dictPendingCount =
    Object.keys(tagEditsMap).length +
    newCatsItems.length +
    Object.keys(tagDeletionsMap).length +
    Object.keys(plannedDeletionsMap).length +
    countCounterpartyPending({
      renames: cpRenames,
      created: cpCreated,
      deleted: cpDeleted,
      merges: cpMerges,
    });
  const pendingAll = pendingTotal + dictPendingCount;
  const [pendingModalOpen, setPendingModalOpen] = useState(false);
  // «?» popover next to the sync section header (holds what used to be four
  // paragraphs of prose inside the card).
  const [syncInfoOpen, setSyncInfoOpen] = useState(false);
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
  const cloudSnapshotsBusy = useCloudSnapshotStore((s) => s.busy);
  const cloudSnapshotsError = useCloudSnapshotStore((s) => s.error);
  const hydrateCloudSnapshots = useCloudSnapshotStore((s) => s.hydrate);
  const takeCloudSnapshot = useCloudSnapshotStore((s) => s.takeSnapshot);
  const deleteCloudSnapshot = useCloudSnapshotStore((s) => s.deleteSnapshot);
  const downloadCloudSnapshot = useCloudSnapshotStore((s) => s.download);
  const importCloudSnapshot = useCloudSnapshotStore((s) => s.importFromFile);
  const restoreCloudSnapshot = useCloudSnapshotStore((s) => s.restore);
  const lastRestoreResult = useCloudSnapshotStore((s) => s.lastRestoreResult);
  const restoreProgress = useCloudSnapshotStore((s) => s.restoreProgress);
  const snapshotImportRef = useRef<HTMLInputElement>(null);
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
  // Visible snapshots: belong to the currently connected account
  // (matching userId) plus legacy snapshots without a userId (so we
  // don't silently hide pre-feature backups). Snapshots from other
  // accounts are surfaced as a count below the list.
  const visibleSnapshots = useMemo(() => {
    if (currentUserId == null) return cloudSnapshots;
    return cloudSnapshots.filter(
      (s) => s.userId == null || s.userId === currentUserId
    );
  }, [cloudSnapshots, currentUserId]);
  const otherAccountSnapshotCount =
    cloudSnapshots.length - visibleSnapshots.length;
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
    if (q === "operations" || q === "interface" || q === "processing" || q === "backups") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSettingsTab(q);
    }
  }, [searchParams]);

  // Inner tab inside the Бэкапы section — local files vs cloud
  // snapshots. Mirrors the Источник данных card pattern.
  type BackupTab = "local" | "cloud";
  const [backupTab, setBackupTab] = useState<BackupTab>("local");

  // "Show all rates" toggle for the currency-rates grid in CSV
  // mode. By default only the 4 most-common currencies are shown
  // (RUB / USD / EUR / GBP) — the rest live behind an expand
  // button so this section doesn't dominate the page on first open.
  const [showAllRates, setShowAllRates] = useState(false);

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

  function formatSyncResult(r: {
    count: number;
    full: boolean;
    delta: { transactions: number; deletions: number };
  }): string {
    if (r.full) return `Полный синк: ${formatNum(r.count)} операций.`;
    if (r.delta.transactions === 0 && r.delta.deletions === 0) {
      return `Свежее: ничего нового. Всего ${formatNum(r.count)} операций.`;
    }
    const parts: string[] = [];
    if (r.delta.transactions > 0)
      parts.push(`+${formatNum(r.delta.transactions)} новых/изменённых`);
    if (r.delta.deletions > 0)
      parts.push(`${formatNum(r.delta.deletions)} удалено`);
    return `Синхронизировано: ${parts.join(", ")}. Всего ${formatNum(r.count)} операций.`;
  }

  async function connectToken() {
    setSyncSuccess(null);
    // Guard: existing CSV data will be replaced by API sync.
    if (meta?.source === "csv" && transactions.length > 0) {
      const ok = await confirm({
        title: "Заменить CSV-данные на API?",
        message: `У вас сейчас ${formatNum(transactions.length)} операций из CSV (${meta.fileName}). API-синк заменит их данными из Дзен-мани. Бюджеты, цели и правила сохранятся.`,
        confirmLabel: "Заменить",
        tone: "warning",
      });
      if (!ok) return;
      await clearAll();
    }
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
  const reapplyRules = useDataStore((s) => s.reapplyRules);
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


  // Report period (reporting month start day)
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const reportPeriodLoaded = useReportPeriodStore((s) => s.loaded);
  const reportPeriodHydrate = useReportPeriodStore((s) => s.hydrate);
  const setMonthStartDay = useReportPeriodStore((s) => s.setMonthStartDay);
  useEffect(() => {
    if (!reportPeriodLoaded) reportPeriodHydrate();
  }, [reportPeriodLoaded, reportPeriodHydrate]);

  // Scheduled backup
  const backupInterval = useBackupStore((s) => s.interval);
  const backupLastAt = useBackupStore((s) => s.lastBackupAt);
  const backupLoaded = useBackupStore((s) => s.loaded);
  const backupHydrate = useBackupStore((s) => s.hydrate);
  const setBackupInterval = useBackupStore((s) => s.setInterval);
  const runBackupNow = useBackupStore((s) => s.runNow);
  useEffect(() => {
    if (!backupLoaded) backupHydrate();
  }, [backupLoaded, backupHydrate]);

  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(transactions.length > 0 ? "merge" : "replace");
  const fileRef = useRef<HTMLInputElement>(null);

  const backupRef = useRef<HTMLInputElement>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);

  /**
   * Скачать бэкап руками.
   *
   * Тот же путь, что у расписания (`runNow`), — раньше рядом жили две кнопки,
   * скачивавшие ОДИН И ТОТ ЖЕ файл, и разница между «Скачать бэкап» и
   * «Скачать сейчас» была понятна только по коду. Теперь кнопка одна, и она
   * же двигает отсчёт расписания: свежая копия только что скачана, повторять
   * её через час незачем.
   */
  async function exportBackup() {
    setBackupBusy(true);
    setBackupMsg(null);
    try {
      const res = await runBackupNow();
      setBackupMsg(`Скачано: ${res.fileName} (${Math.round(res.size / 1024)} КБ)`);
    } catch (e) {
      setBackupMsg(e instanceof Error ? `Ошибка: ${e.message}` : "Ошибка экспорта");
    } finally {
      setBackupBusy(false);
    }
  }

  async function importBackup(file: File) {
    const ok = await confirm({
      title: "Восстановить из бэкапа?",
      message: "Текущие данные будут заменены.",
      confirmLabel: "Восстановить",
      tone: "warning",
    });
    if (!ok) return;
    setBackupBusy(true);
    setBackupMsg(null);
    try {
      const text = await file.text();
      // Validate + sanitize (type checks, prototype-pollution stripping,
      // size/depth bounds) before anything touches IndexedDB.
      const dump = parseAndValidateBackup(text) as unknown as Record<string, unknown>;
      // Write every section back to IndexedDB (shared key list with the
      // builder — incl. local edits/drafts/deletions/rules so un-pushed work
      // survives a restore).
      await restoreBackupPayload(dump);
      const restoredCount = Array.isArray(dump.transactions)
        ? dump.transactions.length
        : 0;
      setBackupMsg(
        `Восстановлено: ${formatNum(restoredCount)} операций. Обновляем страницу…`
      );
      // Перезагрузка, а не поимённое пере-чтение сторов.
      //
      // Раньше здесь был список из полутора десятков `hydrate()`, и он молча
      // отставал ровно так же, как список ключей бэкапа: восстановленные
      // настройки бюджета, разрезы и оформление не появлялись до ручной
      // перезагрузки. Перезагрузка снимает этот класс ошибок целиком — все
      // сторы поднимаются штатным путём, и забыть что-то физически нельзя.
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setBackupMsg(e instanceof Error ? `Ошибка: ${e.message}` : "Ошибка импорта backup'а");
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleFile(file: File) {
    setError(null);
    setSuccess(null);
    // Guard: API token connected → confirm before mixing.
    if (zenToken) {
      const ok = await confirm({
        title: "Импорт CSV поверх API?",
        message:
          "У вас подключён API Дзен-мани. CSV-импорт может затереть синхронизированные данные. Если импорт нужен, советуем сначала отключить API на этой странице, чтобы избежать путаницы.",
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
        throw new Error("Не удалось распарсить ни одной строки. Проверьте формат файла.");
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
        setSuccess(`Загружено ${formatNum(result.parsed)} операций.`);
      }
      setTimeout(() => nav("/"), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка чтения файла");
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
        hint="Данные, расчёты, оформление и бэкапы."
      />

      {/* Horizontal tab bar — top-level grouping for the long
          Settings page. Each tab shows one logical bucket of
          sections; sub-headings inside each tab keep their own
          structure (e.g. "Резервные копии" → "Облачный снимок" +
          "Push в облако"). */}
      <div
        role="tablist"
        aria-label="Разделы настроек"
        className="border-b border-border flex items-center gap-1 -mt-2 overflow-x-auto overflow-y-hidden"
      >
        {([
          { id: "source", label: "Данные", icon: Database },
          { id: "operations", label: "Справочники", icon: ArrowLeftRight },
          { id: "processing", label: "Расчёты", icon: Calculator },
          { id: "interface", label: "Оформление", icon: ALargeSmall },
          { id: "backups", label: "Бэкапы", icon: History },
        ] as const).map((t) => {
          const active = settingsTab === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setSettingsTab(t.id)}
              className={[
                "inline-flex items-center gap-2 px-4 py-2 text-sm font-medium",
                "border-b-2 -mb-px transition-colors whitespace-nowrap",
                active
                  ? "border-accent text-text"
                  : "border-transparent text-muted hover:text-text",
              ].join(" ")}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {settingsTab === "source" && (<>
      {/* Unified data-source card. Replaces what used to be three
          separate islands (API status, CSV import, current database
          summary) — they all answered "where's your data coming
          from and what state is it in?". Now: source tabs at the
          top, panel for the active source, current-data footer at
          the bottom. */}
      <section className="card card-pad space-y-5">
        {/* Source tabs. A small green dot on the tab whose source
            is actually populated lets the user tell at a glance
            which mode they're in even if the active tab is the
            other one (e.g. browsing CSV settings while connected
            via API). */}
        <SettingsSectionHeader
          icon={Database}
          title="Источник данных"
          right={
          <div className="inline-flex bg-panel2 border border-border rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setSourceTab("api")}
              className={`px-3 py-1.5 text-sm rounded-md inline-flex items-center gap-1.5 transition-colors ${
                sourceTab === "api"
                  ? "bg-accent/10 text-accent"
                  : "text-muted hover:text-text"
              }`}
              title="Онлайн-синхронизация с Дзен-мани через токен API"
            >
              <Cloud className="w-3.5 h-3.5" />
              Дзен-мани API
              {zenToken && (
                <span
                  className="ml-1 w-1.5 h-1.5 rounded-full bg-income"
                  title="Источник активен"
                />
              )}
            </button>
            <button
              type="button"
              onClick={() => setSourceTab("csv")}
              className={`px-3 py-1.5 text-sm rounded-md inline-flex items-center gap-1.5 transition-colors ${
                sourceTab === "csv"
                  ? "bg-accent/10 text-accent"
                  : "text-muted hover:text-text"
              }`}
              title="Офлайн-импорт CSV-выгрузки из мобильного приложения"
            >
              <Upload className="w-3.5 h-3.5" />
              CSV-файл
              {meta?.source === "csv" && transactions.length > 0 && (
                <span
                  className="ml-1 w-1.5 h-1.5 rounded-full bg-income"
                  title="Источник активен"
                />
              )}
            </button>
          </div>
          }
        />

        {/* ── API panel ────────────────────────────────────────── */}
        {sourceTab === "api" && (
          <div className="rounded-lg border border-border bg-panel2/30 p-4 space-y-3">
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
                <div className="flex items-center gap-3 flex-wrap text-xs text-muted">
                  <span className="flex items-center gap-1.5 text-text">
                    <CheckCircle2 className="w-3.5 h-3.5 text-income shrink-0" />
                    Подключено
                  </span>
                  {/* Расписание рядом с состоянием: «Подключено · каждые 30 мин»
                      читается одной строкой. */}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoSyncEnabled}
                      onChange={(e) =>
                        setAutoSync(e.target.checked, autoSyncValue, autoSyncUnit)
                      }
                      className="accent-accent w-3.5 h-3.5"
                    />
                    <span>Авто-синхронизация каждые</span>
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
                      className="input text-xs !py-1 !px-2 w-14 tabular-nums"
                    />
                    <select
                      value={autoSyncUnit}
                      onChange={(e) =>
                        setAutoSync(
                          autoSyncEnabled,
                          autoSyncValue,
                          e.target.value as typeof autoSyncUnit
                        )
                      }
                      className="input text-xs !py-1 !px-2 !w-auto"
                    >
                      <option value="min">мин</option>
                      <option value="hour">час</option>
                      <option value="day">день</option>
                    </select>
                  </label>
                </div>
              )}
            </div>

        {!zenToken ? (
          <div className="space-y-3">
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
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : zenStatus === "syncing" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <LinkIcon className="w-3.5 h-3.5" />
                )}
                {zenStatus === "checking"
                  ? "Проверяю..."
                  : zenStatus === "syncing"
                    ? "Качаю данные..."
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
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                {zenStatus === "syncing" ? "Синхронизирую..." : "Синхронизировать"}
              </button>
              <button
                onClick={runFullSync}
                disabled={zenStatus === "syncing"}
                className="btn-ghost text-sm text-muted"
                title="Сбросить локальный кэш и скачать всё заново"
              >
                <CloudDownload className="w-3.5 h-3.5" />
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

          </div>
        )}

        {zenError && (
          <div className="mt-3 text-xs text-expense flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{zenError}</span>
          </div>
        )}
        {syncSuccess && !syncSuccess.startsWith("Полный синк") && (
          <div className="mt-3 text-xs text-income flex items-start gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{syncSuccess}</span>
          </div>
        )}
          </div>
        )}

        {/* ── CSV panel ────────────────────────────────────────── */}
        {sourceTab === "csv" && (
          <div className="rounded-lg border border-border bg-panel2/30 p-4 space-y-3">
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
                  <div className="inline-flex bg-panel2 border border-border rounded-lg p-0.5">
                    <button
                      onClick={() => setMode("merge")}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors ${
                        mode === "merge"
                          ? "bg-accent text-accent-fg"
                          : "text-muted hover:text-text"
                      }`}
                      title="Добавить новые операции, дубликаты по id отбрасываются"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      Дополнить
                    </button>
                    <button
                      onClick={() => setMode("replace")}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors ${
                        mode === "replace"
                          ? "bg-accent text-accent-fg"
                          : "text-muted hover:text-text"
                      }`}
                      title="Удалить все текущие данные и загрузить файл с нуля"
                    >
                      <Replace className="w-3.5 h-3.5" />
                      Заменить
                    </button>
                  </div>
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
                {busy ? "Обрабатываю..." : "Перетащите CSV или кликните"}
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
                      "Удалятся ВСЕ локальные данные из этого браузера: операции, кэш, правки, черновики, исключения дубликатов, калибровка, бюджеты, правила и т.п. Подключение к Дзен-мани и настройки сохранятся, данные в облаке НЕ пострадают. Страница перезагрузится.",
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

      </>)}

      {settingsTab === "operations" && <OperationsSettings />}

      {settingsTab === "interface" && (<>

      {/* Одна карточка вместо трёх отдельных: настройки вида короткие, а
          каждая со своим абзацем пояснений занимала пол-экрана. */}
      <div className="card card-pad">
        <SettingsSectionHeader icon={Palette} title="Внешний вид" className="mb-1" />
        <p className="text-xs text-muted mb-3">
          Как сервис выглядит и в каком виде показывает суммы.
        </p>

        <SettingRow
          title="Тема"
          status={
            themeMode === "auto"
              ? `Как в системе — сейчас ${resolvedTheme === "dark" ? "тёмная" : "светлая"}`
              : themeMode === "dark"
                ? "Тёмная"
                : "Светлая"
          }
          help={
            <p>
              «Как в системе» следует за настройкой оформления в вашей ОС и
              переключается вместе с ней — в том числе по расписанию, если оно
              там настроено. Кнопка в шапке переключает между светлой и тёмной
              напрямую.
            </p>
          }
          control={
            <Segmented
              label="Тема оформления"
              value={themeMode}
              onChange={(m) => setThemeMode(m)}
              options={[
                { value: "light", label: "Светлая" },
                { value: "dark", label: "Тёмная" },
                { value: "auto", label: "Как в системе" },
              ]}
            />
          }
        />

        <SettingRow
          title="Дробная часть сумм"
          status={`Например: ${formatMoney(1234.1, rates.base)}`}
          help={
            <p>
              Показывать ли копейки, центы и прочую мелочь. Влияет на все суммы:
              KPI, карточки, таблицы, операции и подсказки. На осях графиков
              суммы всегда компактные — там дробная часть только мешает.
            </p>
          }
          control={
            <Segmented
              label="Дробная часть сумм"
              value={fractionDigits}
              onChange={(v) => setFractionDigits(v)}
              options={[
                { value: 0, label: "1 234", title: "Без дробной части" },
                { value: 2, label: "1 234,10", title: "С дробной частью" },
              ]}
            />
          }
        />

        <SettingRow
          title="Строка из выписки"
          status={
            statementLine
              ? "Показывается под контрагентом"
              : "Скрыта — только название контрагента"
          }
          help={
            <>
              <p>
                Под названием контрагента можно показывать то, что напечатал
                банк, — поле <InfoTerm>«В выписке»</InfoTerm> из редактора
                операции. Строка появляется только у операций с заполненным{" "}
                <InfoTerm>«Местом платежа»</InfoTerm> и только когда текст банка
                отличается от названия контрагента.
              </p>
              <p>
                Пригодится, когда банк печатает не то, что вы видите в
                контрагенте: у магазина в выписке может стоять номер терминала
                («MARKET 1234 MOSCOW»), а у перевода по СБП — тот, кому деньги
                ушли на самом деле. Если это только мешает — выключите, и в
                списках останется одно название.
              </p>
            </>
          }
          control={
            <Switch
              checked={statementLine}
              label="Показывать строку из выписки"
              onChange={(next) => setStatementLine(next)}
            />
          }
        />

        <SettingRow
          title="Размер текста в таблицах"
          status={`${TABLE_FONT_LABELS[tableFontLevel]} (${tableFontLevel}/5)`}
          help={
            <p>
              Размер шрифта в списках операций: лента «Операции», поиск, окно
              операций, дубликаты, корзина и подобные таблицы. Остальной
              интерфейс не меняется.
            </p>
          }
          control={
            <div className="flex items-center gap-2">
              <span className="text-muted text-[12px]" aria-hidden>
                А
              </span>
              <input
                type="range"
                min={1}
                max={5}
                step={1}
                value={tableFontLevel}
                onChange={(e) =>
                  setTableFontLevel(Number(e.target.value) as TableFontLevel)
                }
                className="w-40 accent-accent cursor-pointer"
                aria-label="Размер текста в таблицах"
              />
              <span className="text-muted text-[18px]" aria-hidden>
                А
              </span>
            </div>
          }
        >
          {/* Живой пример — на той же CSS-переменной, что и таблицы, поэтому
              масштабируется прямо во время перетаскивания. */}
          <div className="mt-3 rounded-lg border border-border bg-panel2/40 px-3 py-2 flex items-center justify-between gap-3">
            <span
              className="text-muted truncate"
              style={{ fontSize: "var(--tbl-font)" }}
            >
              01.06.2026 · Пятёрочка · Еда дома
            </span>
            <span
              className="tabular-nums font-medium text-expense whitespace-nowrap"
              style={{ fontSize: "var(--tbl-font)" }}
            >
              {formatMoney(-1234, rates.base)}
            </span>
          </div>
        </SettingRow>
      </div>

      </>)}

      {/* Currency (base + rates) lives in the «Расчёты» tab — it's an input to
          how every amount is computed, alongside the reporting period and
          data-scope toggles. Rendered before the main processing block below, so
          it sits first in the tab. */}
      {settingsTab === "processing" && (<>

      {/* Одна карточка на всю вкладку: раньше это были три отдельных блока,
          каждый с абзацем пояснений над контролом, и вкладка читалась как
          стена текста. Здесь строки, а подробности — за знаками вопроса. */}
      <div className="card card-pad">
        <SettingsSectionHeader
          icon={Calculator}
          title="Как считать"
          className="mb-1"
        />
        <p className="text-xs text-muted mb-3">
          Базовые правила, по которым собираются все KPI, графики и отчёты.
        </p>

        <SettingRow
          title="Базовая валюта"
          status={`Все суммы и графики показываются в ${rates.base}`}
          help={
            <>
              <p>
                Валюта, в которую сводятся операции всех остальных валют. Меняя
                её, вы меняете только представление — сами операции остаются в
                своих валютах.
              </p>
              <p>
                {zenToken
                  ? "Курсы приходят из Дзен-мани при каждой синхронизации, настраивать их вручную не нужно."
                  : "В режиме CSV курсы задаются вручную ниже — по ним и сводятся суммы."}
              </p>
            </>
          }
          control={
            /* Код валюты — всегда три буквы: поле шире только съедает строку. */
            <div className="w-24">
              <Combobox
                value={rates.base}
                options={Object.keys(rates.rates).sort()}
                onChange={(next) => {
                  setBase(next).catch((err: Error) => alert(err.message));
                }}
                allowCustom={false}
                maxHeight="min(40vh, 280px)"
              />
            </div>
          }
        />

        <SettingRow
          title="Первый день отчётного месяца"
          status={
            monthStartDay === 1
              ? "Календарный месяц"
              : `С ${monthStartDay}-го числа по ${monthStartDay - 1}-е следующего`
          }
          help={
            <>
              <p>
                Многие ведут учёт не «с 1-го по последнее», а от зарплаты до
                зарплаты — например с 11-го по 10-е. Здесь задаётся день, с
                которого начинается ваш расчётный месяц.
              </p>
              <p>
                Влияет на фильтр «Месяц», бары и таблицу Cash-flow, KPI «Доход /
                Расход за …», «Топ-10 категорий» и переход в операции месяца.
                «Год к году» и сезонность остаются по календарю: там месяц имеет
                смысл только как календарный.
              </p>
              <p>
                Допустимы значения 1–28. Числа 29, 30 и 31 есть не в каждом
                месяце, поэтому их не предлагаем.
              </p>
            </>
          }
          control={
            <input
              type="number"
              min={1}
              max={28}
              value={monthStartDay}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) setMonthStartDay(n);
              }}
              aria-label="День начала расчётного месяца"
              /* Значение — 1–28, то есть максимум два знака; по центру, чтобы
                 однозначное число не висело у левого края. */
              className="input text-sm w-16 tabular-nums text-center"
            />
          }
        />

        <SettingRow
          title="Счета вне баланса"
          status={
            includeOffBalance
              ? "Учитываются в списках и в совокупном балансе"
              : "Скрыты из списков и не входят в совокупный баланс"
          }
          help={
            <>
              <p>
                В Дзен-мани счёт можно пометить как «вне баланса» — накопительные,
                брокерские, всё, что вы не держите в повседневном балансе. По
                умолчанию мы это повторяем: такие счета не мешаются в списках и
                не попадают в «Совокупный баланс».
              </p>
              <p>
                Переключатель влияет на списки счетов (Главная, «Счета») и на
                совокупный баланс с графиком капитала. Цель FIRE настраивается
                отдельно — там свой выбор счетов.
              </p>
            </>
          }
          control={
            <Switch
              checked={includeOffBalance}
              label="Учитывать счета вне баланса"
              onChange={async (next) => {
                await setIncludeOffBalance(next);
                // Пересобираем привязку баланса, чтобы «Совокупный баланс»
                // обновился сразу (только режим API; для CSV — no-op).
                await recalcBalanceCalibration();
              }}
            />
          }
        />

        {!zenToken && (
          <SettingRow
            title="Курсы валют"
            status={`Заданы вручную, к ${rates.base}`}
            help={
              <p>
                В режиме CSV курсы неоткуда взять автоматически. Задайте те, по
                которым хотите сводить суммы; при подключении Дзен-мани они
                начнут приходить сами.
              </p>
            }
          >
            {(() => {
              // Ходовые валюты сверху, остальные — за кнопкой: иначе строка
              // разрастается редкими валютами при первом же открытии.
              const priority = ["RUB", "USD", "EUR", "GBP"];
              const allEntries = Object.entries(rates.rates).sort(([a], [b]) => {
                const pa = priority.indexOf(a);
                const pb = priority.indexOf(b);
                if (pa !== -1 && pb !== -1) return pa - pb;
                if (pa !== -1) return -1;
                if (pb !== -1) return 1;
                return a.localeCompare(b);
              });
              const visible = showAllRates ? allEntries : allEntries.slice(0, 4);
              const hiddenCount = allEntries.length - visible.length;
              return (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                    {visible.map(([cur, val]) => (
                      <div key={cur}>
                        <label className="label block mb-1">1 {cur} =</label>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="0.01"
                            value={val}
                            onChange={(e) => setRate(cur, Number(e.target.value) || 0)}
                            disabled={cur === rates.base}
                            className="input text-sm"
                          />
                          <span className="text-xs text-muted">{rates.base}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {(hiddenCount > 0 || showAllRates) && (
                    <button
                      type="button"
                      onClick={() => setShowAllRates((v) => !v)}
                      className="mt-3 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                    >
                      <ChevronDown
                        className={`w-3.5 h-3.5 transition-transform ${
                          showAllRates ? "rotate-180" : ""
                        }`}
                      />
                      {showAllRates
                        ? "Свернуть"
                        : `Показать ещё ${hiddenCount} ${
                            hiddenCount === 1
                              ? "валюту"
                              : hiddenCount < 5
                                ? "валюты"
                                : "валют"
                          }`}
                    </button>
                  )}
                </>
              );
            })()}
          </SettingRow>
        )}
      </div>

      {/* «Группировка получателей» отключена (2026-08).
          Её задачу лучше решает справочник контрагентов: там получатель —
          настоящая запись Дзен-мани, переименование уезжает в облако и
          действует у всех операций сразу, а «Без контрагента» разбирает
          строки от банка адресно. Авто-нормализация же склеивала по догадке
          и жила только в этом браузере.

          Блок оставлен закомментированным: если решим вернуть — код здесь,
          вместе с ним в `useDataStore` живут `payeeGroupingEnabled`,
          `applyPayeeGrouping` и ручные алиасы.


      {/* Группировка получателей — единый блок: авто-нормализация +
          ручные правила. Раньше были две отдельные карточки, теперь
          объединены, потому что обе работают с одним и тем же
          концептом (один и тот же payee, несколько написаний). *\/}
      {transactions.length > 0 && (
        <div className="card card-pad">
          <SettingsSectionHeader
            icon={Users}
            title="Группировка получателей"
            className="mb-3"
          />
          <p className="text-xs text-muted mb-4">
            Объединяет варианты одного и того же получателя.
            Авто-нормализация работает по умолчанию (удаление номеров,
            пробелов, форм. суффиксов, лидирующих банков — «Магнит #1234»
            и «MAGNIT-MOSCOW» → один payee). Ручные правила применяются
            <em> поверх</em> авто-группировки и работают независимо от
            её переключателя.
          </p>

          {/* — Auto grouping toggle — *\/}
          <label className="flex items-center gap-3 p-3 bg-panel2 rounded-lg border border-border cursor-pointer">
            <input
              type="checkbox"
              checked={payeeGrouping}
              onChange={(e) => setPayeeGrouping(e.target.checked)}
              className="accent-accent w-4 h-4"
            />
            <div className="flex-1">
              <div className="font-medium text-sm">
                Авто-группировка получателей
              </div>
              <div className="text-xs text-muted">
                {aliasPreview && aliasPreview.size > 0
                  ? `Найдено вариантов: ${aliasPreview.size}. Переключатель обратимый — можно вернуть оригинальные имена.`
                  : "Похожих получателей не найдено в текущих данных."}
              </div>
            </div>
          </label>
          {payeeGrouping && aliasPreview && aliasPreview.size > 0 && (
            <details className="mt-3">
              <summary className="text-xs text-accent cursor-pointer hover:underline">
                Показать применённые объединения ({aliasPreview.size})
              </summary>
              <p className="text-[11px] text-muted mt-2">
                Цель объединения можно изменить прямо здесь — впишите своё
                название. Правка сохранится как ручное правило (помечено
                рамкой); кнопка ↺ вернёт авто-значение.
              </p>
              <div className="mt-2 max-h-72 overflow-y-auto pr-1">
                {Array.from(aliasPreview.entries())
                  .sort((a, b) => a[0].localeCompare(b[0], "ru"))
                  .map(([from, autoTo]) => {
                    const manualTo = manualAliasMap.get(from);
                    const overridden = manualTo !== undefined;
                    return (
                      <AutoGroupRow
                        key={from}
                        from={from}
                        autoTo={autoTo}
                        overridden={overridden}
                        effectiveTo={manualTo ?? autoTo}
                        onCommit={(f, to) => {
                          addAlias(f, to).then(reapplyRules);
                        }}
                        onReset={(f) => {
                          removeAlias(f).then(reapplyRules);
                        }}
                      />
                    );
                  })}
              </div>
            </details>
          )}

          {/* — Manual aliases — *\/}
          <div className="mt-5 pt-5 border-t border-border">
            <div className="text-sm font-medium mb-3">Ручные правила</div>

            {/* Add new alias. Combobox (not a native <input list>) so the
                suggestions dropdown is width- and height-bounded — the
                native datalist popup spilled across the whole viewport. *\/}
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto] items-center gap-2 mb-3">
              <Combobox
                value={aliasFrom}
                options={allPayeeOptions}
                onChange={setAliasFrom}
                placeholder="Откуда (как сейчас называется)"
                maxHeight="240px"
              />
              <span className="text-muted hidden md:inline">→</span>
              <Combobox
                value={aliasTo}
                options={allPayeeOptions}
                onChange={setAliasTo}
                placeholder="Куда (как должно стать)"
                maxHeight="240px"
              />
              <button
                onClick={submitAlias}
                disabled={
                  !aliasFrom.trim() ||
                  !aliasTo.trim() ||
                  aliasFrom.trim() === aliasTo.trim()
                }
                className="btn-primary text-sm whitespace-nowrap"
              >
                Добавить
              </button>
            </div>

            {/* Existing aliases *\/}
            {manualAliases.length === 0 ? (
              <div className="text-xs text-muted">
                Пока нет ручных правил. Используйте поля выше, чтобы добавить
                первое — например, <code className="pill">Pyaterochka</code> →{" "}
                <code className="pill">Пятёрочка</code>.
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto text-xs space-y-1 -mx-1 px-1">
                {manualAliases.map((a) => (
                  <div
                    key={a.from}
                    className="flex items-center gap-2 py-1 border-b border-border/40 last:border-b-0"
                  >
                    <span className="truncate flex-1 text-text" title={a.from}>
                      {a.from}
                    </span>
                    <span className="text-muted">→</span>
                    <span
                      className="truncate flex-1 text-text font-medium"
                      title={a.to}
                    >
                      {a.to}
                    </span>
                    <button
                      onClick={() => dropAlias(a.from)}
                      className="text-muted hover:text-expense p-1"
                      title="Удалить правило"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      */}

      {/* Разрезы — в самом низу: настройка редкая, а места занимает больше
          остальных. Сверху то, что трогают чаще. */}
      <SlicesSettings />

      </>)}

      {settingsTab === "backups" && (
      <section className="card card-pad space-y-5">
        {/* Header + Локальные/Облачные tab selector. Mirrors the
            Источник данных card structure. */}
        <SettingsSectionHeader
          icon={History}
          title="Резервные копии"
          right={
          <div className="inline-flex bg-panel2 border border-border rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setBackupTab("local")}
              className={`px-3 py-1.5 text-sm rounded-md inline-flex items-center gap-1.5 transition-colors ${
                backupTab === "local"
                  ? "bg-accent/10 text-accent"
                  : "text-muted hover:text-text"
              }`}
              title="Скачивание JSON-бэкапов на ваше устройство"
            >
              <HardDrive className="w-3.5 h-3.5" />
              Локальные
            </button>
            <button
              type="button"
              onClick={() => setBackupTab("cloud")}
              className={`px-3 py-1.5 text-sm rounded-md inline-flex items-center gap-1.5 transition-colors ${
                backupTab === "cloud"
                  ? "bg-accent/10 text-accent"
                  : "text-muted hover:text-text"
              }`}
              title="Снимки облачного состояния Дзен-мани"
            >
              <Cloud className="w-3.5 h-3.5" />
              Облачные
            </button>
          </div>
          }
        />

        {backupTab === "local" && (<>
        <div className="rounded-lg border border-border bg-panel2/30 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Database className="w-5 h-5 text-accent" />
            <span className="font-medium">Бэкап всех данных</span>
          </div>
        <p className="text-xs text-muted mb-3">
          Экспортирует JSON со всем, что живёт только здесь: операции, бюджеты и их
          настройки, цели, калибровка, виды, разрезы данных, оформление и тема,
          правила категоризации, иконки и цвета категорий, курсы валют по датам,
          настройки страниц — и <strong>несинхронизированные изменения</strong>:
          правки операций, счетов, контрагентов, категорий и планов, созданные
          операции, заведённые контрагенты и категории, удаления. Токен Дзен-мани
          и кэш облака в файл не попадают. Восстановление возвращает всё одним
          файлом и обновляет страницу.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={exportBackup}
            disabled={backupBusy || transactions.length === 0}
            className="btn-primary text-sm"
          >
            <Download className="w-4 h-4" />
            Скачать бэкап
          </button>
          <button
            onClick={() => backupRef.current?.click()}
            disabled={backupBusy}
            className="btn-ghost text-sm"
          >
            <Upload className="w-4 h-4" />
            Восстановить из бэкапа
          </button>
          <input
            ref={backupRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importBackup(f);
              e.target.value = "";
            }}
          />
          {backupMsg && (
            <span className="text-xs text-muted self-center">{backupMsg}</span>
          )}
        </div>
      </div>

      {/* Scheduled backup. Заголовок, периодичность и кнопка — в одну строку:
          четыре кнопки во всю ширину занимали ряд ради выбора из четырёх слов,
          а объяснение читают один раз и убирают под знак вопроса. */}
      <div className="rounded-lg border border-border bg-panel2/30 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <Clock className="w-5 h-5 text-accent shrink-0" />
            <span className="font-medium">Бэкап по расписанию</span>
            <InfoPopover label="Как работает расписание">
              <p>
                Автоматически скачивает тот же JSON-бэкап с выбранной
                периодичностью. Проверка запускается при открытии приложения и
                каждые ~10 минут. Файл уходит в стандартную папку загрузок
                браузера, к имени добавляется «-auto».
              </p>
              <p>
                Срок считается от <InfoTerm>последней копии</InfoTerm>, включая
                скачанную руками кнопкой «Скачать бэкап»: если копия только что
                сделана, повторять её через час незачем.
              </p>
              <p>
                <InfoTerm>Важно:</InfoTerm> работает, только пока вкладка открыта
                — браузер не умеет запускать нас по будильнику. Уведомление о
                скачивании при этом нормально, его показывает сам браузер.
              </p>
            </InfoPopover>
            <span className="text-xs text-muted">
              {backupLastAt
                ? `Последняя копия: ${new Date(backupLastAt).toLocaleString("ru-RU")}`
                : "Копий ещё не было"}
            </span>
          </div>
          <div className="w-44 shrink-0">
            <Select
              size="sm"
              ariaLabel="Как часто делать бэкап"
              value={backupInterval}
              onChange={(v) => setBackupInterval(v)}
              options={[
                { value: "off" as BackupInterval, label: "Не делать" },
                { value: "hour" as BackupInterval, label: "Каждый час" },
                { value: "day" as BackupInterval, label: "Каждый день" },
                { value: "week" as BackupInterval, label: "Каждую неделю" },
              ]}
            />
          </div>
        </div>
      </div>
        </>)}

        {/* Cloud snapshot — Phase 0 of two-way sync. Only available with
            an API token connected (there's nothing to snapshot in CSV
            mode). Stores up to 5 raw responses of POST /v8/diff/ so we
            can fall back to a known-good cloud state if a future push
            operation goes wrong. */}
        {backupTab === "cloud" && (zenToken ? (
          <div className="rounded-lg border border-border bg-panel2/30 p-4">
            <div className="flex items-center gap-2 mb-3">
              <History className="w-5 h-5 text-accent2" />
              <span className="font-medium">Снимки данных из Дзен-мани</span>
            </div>
            <p className="text-xs text-muted mb-3">
              Полный «слепок» того, что сейчас лежит в облаке Дзена. Сохраняется
              локально в браузере и доступен для скачивания. Страховка на случай
              сбоев двусторонней синхронизации — если что-то пойдёт не так,
              всегда можно восстановить состояние из снимка. Хранятся последние{" "}
              <strong>5 снимков</strong> — старые автоматически вытесняются.
            </p>
            <p className="text-xs text-muted mb-3">
              Эти снимки особенно важны при включённой{" "}
              <button
                type="button"
                onClick={() => setSettingsTab("source")}
                className="text-accent hover:underline"
              >
                двусторонней синхронизации
              </button>{" "}
              — каждый Push автоматически создаёт снимок по выбранной политике.
            </p>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <button
                onClick={() => takeCloudSnapshot()}
                disabled={cloudSnapshotsBusy}
                className="btn-primary text-sm inline-flex items-center gap-2"
              >
                {cloudSnapshotsBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CloudDownload className="w-3.5 h-3.5" />
                )}
                {cloudSnapshotsBusy ? "Делаю снимок…" : "Сделать снимок сейчас"}
              </button>
              {/* Import snapshot from a JSON file — file you previously
                  downloaded via the per-row Download button, or copied
                  from another machine. Goes into the same rolling
                  5-slot index as fresh snapshots. */}
              <button
                onClick={() => snapshotImportRef.current?.click()}
                disabled={cloudSnapshotsBusy}
                className="btn-ghost text-sm inline-flex items-center gap-2"
              >
                <Upload className="w-3.5 h-3.5" />
                Загрузить из файла
              </button>
              <input
                ref={snapshotImportRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importCloudSnapshot(f);
                  e.target.value = "";
                }}
              />
              <span className="text-xs text-muted">
                {cloudSnapshots.length === 0
                  ? "Снимков ещё не было"
                  : `${visibleSnapshots.length}${
                      otherAccountSnapshotCount > 0
                        ? ` (+${otherAccountSnapshotCount} с других аккаунтов)`
                        : ""
                    } из 5 слотов занято`}
              </span>
            </div>

            {/* Live restore-progress bar — only visible while a
                restore is in flight. Shows current phase + counter so
                the user knows the operation is moving and where it is. */}
            {restoreProgress && (
              <div className="text-xs mb-3 p-3 rounded-lg bg-accent2/10 border border-accent2/30">
                <div className="flex items-center gap-2 mb-1.5 text-accent2 font-medium">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Восстановление:{" "}
                  {restoreProgress.phase === "accounts"
                    ? "Счета"
                    : restoreProgress.phase === "tags"
                      ? "Теги"
                      : restoreProgress.phase === "merchants"
                        ? "Мерчанты"
                        : restoreProgress.phase === "transactions"
                          ? "Транзакции"
                          : "Готово"}
                  {restoreProgress.total > 0 && (
                    <span className="text-muted tabular-nums">
                      {restoreProgress.current} / {restoreProgress.total}
                    </span>
                  )}
                </div>
                {restoreProgress.total > 0 && (
                  <div className="h-1 bg-panel2 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent2 transition-all"
                      style={{
                        width: `${Math.min(100, Math.round((restoreProgress.current / restoreProgress.total) * 100))}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {cloudSnapshotsError && (
              <div className="text-xs text-expense flex items-start gap-2 mb-3">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{cloudSnapshotsError}</span>
              </div>
            )}

            {visibleSnapshots.length > 0 && (
              <div className="text-xs space-y-1 -mx-1 px-1 max-h-72 overflow-y-auto">
                {visibleSnapshots.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-3 py-2 border-b border-border/40 last:border-b-0"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">
                        {new Date(s.createdAt).toLocaleString("ru-RU")}
                      </div>
                      <div className="text-[11px] text-muted tabular-nums truncate">
                        {formatNum(s.counts.transactions)} оп. ·{" "}
                        {s.counts.accounts} счёт. · {s.counts.tags} тег. ·{" "}
                        {s.counts.instruments} вал. ·{" "}
                        {Math.round(s.approxBytes / 1024)} КБ
                      </div>
                    </div>
                    <button
                      onClick={() => downloadCloudSnapshot(s.id)}
                      className="btn-ghost !px-2 !py-1 text-xs"
                      title="Скачать как JSON-файл"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    {/* Restore — pushes the snapshot's contents back
                        into Zenmoney via /v8/diff/. Destructive
                        (overwrites cloud state by `changed` timestamp),
                        gated behind a clear confirm dialog. */}
                    <button
                      onClick={async () => {
                        const confirmed = await confirm({
                          title: `Восстановить облако из снимка от ${new Date(s.createdAt).toLocaleString("ru-RU")}?`,
                          message:
                            `В Дзен-мани (на текущий токен) уйдут:\n` +
                            `• ${formatNum(s.counts.transactions)} транзакций\n` +
                            `• ${s.counts.accounts} счетов\n` +
                            `• ${s.counts.tags} тегов\n` +
                            `• ${s.counts.merchants} контрагентов\n\n` +
                            `Каждая сущность будет «обновлена» в облаке: победит та версия, у которой свежее поле changed. Операции, созданные в облаке ПОСЛЕ снимка, останутся на месте (это не полный откат, а upsert).\n\n` +
                            `⚠️ Если снимок сделан с другого аккаунта — операция может провалиться или привести к смешению данных. Перед действием убедитесь, что подключён нужный токен.`,
                          confirmLabel: "Восстановить",
                          tone: "warning",
                        });
                        if (!confirmed) return;
                        try {
                          await restoreCloudSnapshot(s.id);
                        } catch {
                          /* error already in store */
                        }
                      }}
                      className="text-muted hover:text-warn p-1"
                      title="Восстановить в облако (загрузить содержимое снимка обратно в Дзен-мани)"
                      disabled={cloudSnapshotsBusy || !zenToken}
                    >
                      <CloudUpload className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={async () => {
                        const ok = await confirm({
                          title: "Удалить снимок?",
                          message: `Снимок от ${new Date(s.createdAt).toLocaleString("ru-RU")} будет удалён из локальной базы.`,
                          confirmLabel: "Удалить",
                          tone: "danger",
                        });
                        if (ok) deleteCloudSnapshot(s.id);
                      }}
                      className="text-muted hover:text-expense p-1"
                      title="Удалить снимок"
                      disabled={cloudSnapshotsBusy}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Restore result — shown after a successful restore call.
                Counts of accepted entities + cross-user warning if the
                snapshot was for a different account than the current
                token. */}
            {lastRestoreResult && (
              <div className="text-xs mt-3 space-y-2">
                <div
                  className={`flex items-start gap-2 ${
                    lastRestoreResult.crossUser ? "text-warn" : "text-income"
                  }`}
                >
                  {lastRestoreResult.crossUser ? (
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  )}
                  <span>
                    {lastRestoreResult.crossUser ? (
                      <>
                        Восстановление выполнено в <strong>другой</strong>{" "}
                        Дзен-аккаунт. Сущностям сгенерированы новые ID,
                        ссылки на системные банки и валюты сброшены.
                        Облако приняло:
                      </>
                    ) : (
                      <>Восстановление прошло. Облако приняло:</>
                    )}{" "}
                    <strong>
                      {lastRestoreResult.accepted.transactions.visible +
                        lastRestoreResult.accepted.transactions.hidden}
                    </strong>{" "}
                    транзакций (
                    {lastRestoreResult.accepted.transactions.visible} видимых в
                    приложении
                    {lastRestoreResult.accepted.transactions.hidden > 0 && (
                      <>
                        {" + "}
                        {lastRestoreResult.accepted.transactions.hidden}{" "}
                        удалённых / без суммы
                      </>
                    )}
                    ) ·{" "}
                    <strong>
                      {lastRestoreResult.accepted.accounts.active +
                        lastRestoreResult.accepted.accounts.archived}
                    </strong>{" "}
                    счетов (
                    {lastRestoreResult.accepted.accounts.active} активных
                    {lastRestoreResult.accepted.accounts.archived > 0 && (
                      <>
                        {" + "}
                        {lastRestoreResult.accepted.accounts.archived}{" "}
                        архивных
                      </>
                    )}
                    ) ·{" "}
                    <strong>
                      {lastRestoreResult.accepted.tags.active +
                        lastRestoreResult.accepted.tags.archived}
                    </strong>{" "}
                    тегов (
                    {lastRestoreResult.accepted.tags.active} активных
                    {lastRestoreResult.accepted.tags.archived > 0 && (
                      <>
                        {" + "}
                        {lastRestoreResult.accepted.tags.archived}{" "}
                        архивных
                      </>
                    )}
                    ) ·{" "}
                    <strong>{lastRestoreResult.accepted.merchants}</strong>{" "}
                    мерчантов.
                  </span>
                </div>

                {/* Per-category "что не зашло" — only render when we
                    actually skipped something, otherwise the result
                    looks needlessly busy. */}
                {(lastRestoreResult.skipped.transactions > 0 ||
                  lastRestoreResult.skipped.debtAccount > 0) && (
                  <div className="flex items-start gap-2 text-muted">
                    <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>
                      Пропущено:{" "}
                      {(() => {
                        const parts: ReactNode[] = [];
                        if (lastRestoreResult.skipped.transactions > 0) {
                          parts.push(
                            <>
                              <strong>{lastRestoreResult.skipped.transactions}</strong>{" "}
                              транзакций с битыми ссылками на счёт / тег /
                              мерчант
                            </>
                          );
                        }
                        if (lastRestoreResult.skipped.debtAccount > 0) {
                          parts.push(
                            <>
                              <strong>1</strong> системный счёт «Долг» сведён с
                              локальным
                            </>
                          );
                        }
                        return parts.map((p, i) => (
                          <span key={i}>
                            {i > 0 && " · "}
                            {p}
                          </span>
                        ));
                      })()}
                      .
                    </span>
                  </div>
                )}

                {lastRestoreResult.droppedTxReasons.length > 0 && (
                  <details className="text-muted">
                    <summary className="cursor-pointer hover:text-text">
                      Примеры пропущенных транзакций (
                      {lastRestoreResult.droppedTxReasons.length})
                    </summary>
                    <div className="mt-1 max-h-32 overflow-y-auto space-y-0.5 -mx-1 px-1">
                      {lastRestoreResult.droppedTxReasons.map((r) => (
                        <div key={r.id} className="py-0.5">
                          <span className="font-mono text-[10px]">{r.id}</span>
                          {" · "}
                          {r.reason}
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                <div className="text-muted">
                  После восстановления сделайте полную синхронизацию (⤓ в
                  шапке), чтобы локальный кэш подтянул свежие `changed`-метки.
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-panel2/30 p-4 text-sm text-muted">
            Облачные снимки доступны только при подключённом Дзен-мани API.
            Подключите токен на вкладке «Данные».
          </div>
        ))}
      </section>
      )}

      {/* Push в облако — Phase 1, opt-in via the toggle below.
          Only visible when an API token is connected; the safety-net
          snapshot (in the Бэкапы tab) is the prerequisite. */}
      {settingsTab === "source" && zenToken && sourceTab === "api" && (
        <div className="card card-pad">
            <SettingsSectionHeader
              icon={CloudUpload}
              title="Двусторонняя синхронизация с Дзен-мани"
              className="mb-3"
              right={
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setSyncInfoOpen((v) => !v)}
                    aria-expanded={syncInfoOpen}
                    aria-label="Как это работает"
                    title="Как это работает"
                    className={`p-1.5 rounded-md ${
                      syncInfoOpen
                        ? "text-accent bg-accent/10"
                        : "text-muted hover:text-accent hover:bg-panel2"
                    }`}
                  >
                    <HelpCircle className="w-5 h-5" />
                  </button>
                  {syncInfoOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-20"
                        onClick={() => setSyncInfoOpen(false)}
                      />
                      <div className="absolute right-0 z-30 mt-2 w-96 max-w-[calc(100vw-2rem)] border border-border rounded-xl bg-panel p-4 shadow-xl space-y-2 text-xs text-muted text-left font-normal">
                        <p>
                          По умолчанию приложение работает в{" "}
                          <strong className="text-text">режиме чтения</strong>:
                          локальные правки остаются только в этом браузере.
                          Выберите режим отправки, чтобы они уходили в облако.
                        </p>
                        <p>
                          <strong className="text-text">Что отправляется:</strong>{" "}
                          дата, получатель, бренд, комментарий, сумма, валюта,
                          категория, подкатегория, смена типа между Расход /
                          Доход / Возврат и на/с «Перевод», смена счёта (в т.ч.
                          счетов перевода), мультивалютные операции.
                        </p>
                        <p>
                          <strong className="text-text">Безопасность:</strong>{" "}
                          перед отправкой сохраняется копия облачного состояния —
                          она появится в{" "}
                          <button
                            type="button"
                            onClick={() => {
                              setSyncInfoOpen(false);
                              setSettingsTab("backups");
                              setBackupTab("cloud");
                            }}
                            className="text-accent hover:underline"
                          >
                            списке облачных бэкапов
                          </button>
                          , его можно скачать или восстановить.
                        </p>
                        <p>
                          <strong className="text-text">Конфликты:</strong> сервер
                          решает их по правилу «последний выиграл» (поле{" "}
                          <code>changed</code>): если ту же операцию изменили в
                          облаке позже, ваш Push для неё может проиграть. На этот
                          случай и есть снимок.
                        </p>
                      </div>
                    </>
                  )}
                </div>
              }
            />

            {/* Controls row — mode + snapshot policy, both compact. The verbose
                per-mode descriptions moved into tooltips; the prose into «?». */}
            {/* Both settings live in one inset panel with the active choice
                explained right under it — three loose label/control lines read
                as unrelated scraps, and the modes' meaning was hover-only. */}
            <div className="rounded-lg border border-border bg-panel2/30 p-4 mb-3 space-y-3">
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm font-medium w-44 shrink-0">
                    Отправка правок в облако
                  </span>
                  <div className="inline-flex bg-panel border border-border rounded-lg p-0.5">
                    {(
                      [
                        ["off", "Выключена"],
                        ["manual", "Вручную"],
                        ["auto", "Авто"],
                        ["on-sync", "При синке"],
                      ] as const
                    ).map(([value, label]) => {
                      const active = pushMode === value;
                      return (
                        <button
                          key={value}
                          onClick={() => setPushMode(value)}
                          className={`px-3 py-1 text-xs rounded-md transition-colors ${
                            active
                              ? "bg-accent text-accent-fg"
                              : "text-muted hover:text-text"
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
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
                    className="btn-primary text-xs !py-1 inline-flex items-center gap-2 sm:ml-auto disabled:opacity-50"
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
                  <div className="inline-flex bg-panel border border-border rounded-lg p-0.5">
                    {(
                      [
                        ["always", "Каждый раз"],
                        ["daily", "Раз в день"],
                        ["never", "Никогда"],
                      ] as const
                    ).map(([value, label]) => {
                      const active = snapshotPolicy === value;
                      return (
                        <button
                          key={value}
                          onClick={() => setSnapshotPolicy(value)}
                          className={`px-3 py-1 text-xs rounded-md transition-colors ${
                            active
                              ? "bg-accent text-accent-fg"
                              : "text-muted hover:text-text"
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <p className="text-xs text-muted mt-1.5 sm:ml-[calc(11rem+0.75rem)]">
                  Сохраняем состояние облака до отправки — если что-то пойдёт не
                  так, из копии можно восстановиться.{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setSettingsTab("backups");
                      setBackupTab("cloud");
                    }}
                    className="text-accent hover:underline inline-flex items-center gap-0.5"
                  >
                    Копии во вкладке «Бэкапы»
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </p>
              </div>
            </div>

            {orphanEditIds.length > 0 && (
                  <div className="text-xs flex items-start gap-2 mb-3 p-2.5 rounded-lg bg-warn/10 border border-warn/30">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-warn" />
                    <div className="flex-1">
                      <div>
                        <strong>{orphanEditIds.length}</strong>{" "}
                        {pluralRu(orphanEditIds.length, ["правка", "правки", "правок"])}{" "}
                        {pluralRu(orphanEditIds.length, ["зависла", "зависли", "зависли"])}{" "}
                        — подходящей операции в данных нет. Обычно остаётся после
                        перехода с CSV на API (меняются id): такие правки не
                        применяются и не уходят в облако, а ре-синк их не убирает.
                      </div>
                      <button
                        onClick={async () => {
                          const n = orphanEditIds.length;
                          const ok = await confirm({
                            title: "Убрать зависшие правки?",
                            message: `${n} ${pluralRu(n, ["правка", "правки", "правок"])} без подходящей операции ${pluralRu(n, ["будет удалена", "будут удалены", "будут удалены"])} из локального оверлея. На облако не влияет.`,
                            confirmLabel: "Убрать",
                            tone: "danger",
                          });
                          if (!ok) return;
                          await clearManyEdits(orphanEditIds);
                          await reapplyRules();
                        }}
                        className="btn-ghost text-xs mt-2 !py-1 text-warn hover:text-expense"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Убрать {orphanEditIds.length}{" "}
                        {pluralRu(orphanEditIds.length, ["зависшую", "зависшие", "зависших"])}{" "}
                        {pluralRu(orphanEditIds.length, ["правку", "правки", "правок"])}
                      </button>
                    </div>
                  </div>
                )}

            {/* Sync history, merged into this card. Rendered as an inset panel
                (the same nested-block treatment the Бэкапы tab uses) so the
                table reads as its own thing instead of blending into the
                settings rows above. */}
            <div className="rounded-lg border border-border bg-panel2/30 p-4 mt-4">
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
                    </span>
                    {pushStatus === "syncing" ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Отправка…
                      </span>
                    ) : (
                      <span>
                        Последний Push:{" "}
                        {lastPushAt
                          ? new Date(lastPushAt).toLocaleString("ru-RU")
                          : "—"}
                      </span>
                    )}
                  </span>
                }
              />
            </div>
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

