import { useEffect, useRef, useState } from "react";
import { Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { TopNav } from "./components/TopNav";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { TransactionsDrawer } from "./components/TransactionsDrawer";
import { CommandPalette } from "./components/CommandPalette";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ChangelogModal } from "./components/ChangelogModal";
import { HistRatesProgress } from "./components/HistRatesProgress";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { DashboardPage } from "./pages/DashboardPage";
import { CashflowPage } from "./pages/CashflowPage";
import { TransactionsPage } from "./pages/TransactionsPage";
import { Budget503020Page } from "./pages/Budget503020Page";
import { CategoriesPage } from "./pages/CategoriesPage";
import { ReportPage } from "./pages/ReportPage";
import { DynamicsPage } from "./pages/DynamicsPage";
import { AccountsPage } from "./pages/AccountsPage";
import { TopPage } from "./pages/TopPage";
import { ComparePage } from "./pages/ComparePage";
import { ImportPage } from "./pages/ImportPage";
import { CalendarPage } from "./pages/CalendarPage";
import { TagsPage } from "./pages/TagsPage";
import { RecurringPage } from "./pages/RecurringPage";
import { TrendsPage } from "./pages/TrendsPage";
import { BudgetsPage } from "./pages/BudgetsPage";
import { AnomaliesPage } from "./pages/AnomaliesPage";
import { SearchPage } from "./pages/SearchPage";
import { GoalsPage } from "./pages/GoalsPage";
import { DuplicatesPage } from "./pages/DuplicatesPage";
import { UncategorizedPage } from "./pages/UncategorizedPage";
import { TrashPage } from "./pages/TrashPage";
import { SankeyPage } from "./pages/SankeyPage";
import { HelpPage } from "./pages/HelpPage";
import { RulesPage } from "./pages/RulesPage";
import { WordcloudPage } from "./pages/WordcloudPage";
import { HealthPage } from "./pages/HealthPage";
import { WhatIfPage } from "./pages/WhatIfPage";
import { YearReviewPage } from "./pages/YearReviewPage";
import { DigestPage } from "./pages/DigestPage";
import { useDataStore } from "./store/useDataStore";
import { useThemeStore } from "./store/useThemeStore";
import { useBackupStore } from "./store/useBackupStore";
import { useZenmoneyStore } from "./store/useZenmoneyStore";
import { useEditsStore } from "./store/useEditsStore";
import { useDeletedStore } from "./store/useDeletedStore";
import { useDeletedPayloadsStore } from "./store/useDeletedPayloadsStore";
import { useDraftsStore } from "./store/useDraftsStore";
import { useTagEditsStore } from "./store/useTagEditsStore";
import { useAccountEditsStore } from "./store/useAccountEditsStore";
import { useBudgetEditsStore } from "./store/useBudgetEditsStore";
import { installNativeTooltips } from "./lib/nativeTooltips";
import { useDisplayStore } from "./store/useDisplayStore";
import { useReportPeriodStore } from "./store/useReportPeriodStore";
import { useOffBalanceStore } from "./store/useOffBalanceStore";
import { useSlicesStore } from "./store/useSlicesStore";
import { useNewCategoriesStore } from "./store/useNewCategoriesStore";
import {
  useCounterpartyEditsStore,
  countCounterpartyPending,
} from "./store/useCounterpartyEditsStore";
import { useTagDeletionsStore } from "./store/useTagDeletionsStore";
import { usePlannedDeletionsStore } from "./store/usePlannedDeletionsStore";
import { useDashboardLayoutStore } from "./store/useDashboardLayoutStore";
import { useFiltersStore } from "./store/useFiltersStore";
import { useImportBatchesStore } from "./store/useImportBatchesStore";

/**
 * All routes use the same outer layout now. Pages that need global filters
 * render `<GlobalFilters />` themselves AFTER `<PageHeader>` — this keeps the
 * page title visually above the filter bar (which the user expects) and makes
 * each route's structure explicit.
 */
function PlainLayout() {
  // Re-key the boundary on the route so a crash on one page is cleared the
  // moment you navigate elsewhere (the boundary remounts fresh).
  const { pathname } = useLocation();
  return (
    <ErrorBoundary key={pathname}>
      {/* Обёртка нужна только ради появления: ключ по адресу заставляет её
          пересоздаваться на каждом переходе, а с новым узлом заново
          проигрывается и анимация. */}
      <div key={pathname} className="page-enter">
        <Outlet />
      </div>
    </ErrorBoundary>
  );
}

function App() {
  const hydrate = useDataStore((s) => s.hydrate);
  const loaded = useDataStore((s) => s.loaded);
  const initTheme = useThemeStore((s) => s.init);
  const backupHydrate = useBackupStore((s) => s.hydrate);
  const backupRunIfDue = useBackupStore((s) => s.runIfDue);
  const backupLoaded = useBackupStore((s) => s.loaded);
  const reportPeriodHydrate = useReportPeriodStore((s) => s.hydrate);
  const reportPeriodLoaded = useReportPeriodStore((s) => s.loaded);
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const resetToCurrentPeriod = useFiltersStore((s) => s.resetToCurrentPeriod);
  // Subscribing here makes the whole tree re-render when the kopecks
  // toggle flips, so every formatMoney call re-evaluates with the new
  // fraction setting (which lives as a module variable in lib/format).
  useDisplayStore((s) => s.fractionDigits);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  useGlobalShortcuts(() => setPaletteOpen(true));

  useEffect(() => {
    // Hydrate the deleted-ids set first so the data store's pipeline
    // filters hidden rows from the very first render. (loadDeletedSet
    // falls back to disk anyway, but this populates the in-memory copy
    // that the UI + auto-push subscription read.)
    useDeletedStore.getState().hydrate();
    useDeletedPayloadsStore.getState().hydrate();
    useDraftsStore.getState().hydrate();
    useImportBatchesStore.getState().hydrate();
    useTagEditsStore.getState().hydrate();
    useAccountEditsStore.getState().hydrate();
    useBudgetEditsStore.getState().hydrate();
    useDisplayStore.getState().hydrate();
    useOffBalanceStore.getState().hydrate();
    useSlicesStore.getState().hydrate();
    useNewCategoriesStore.getState().hydrate();
    useCounterpartyEditsStore.getState().hydrate();
    useTagDeletionsStore.getState().hydrate();
    usePlannedDeletionsStore.getState().hydrate();
    useDashboardLayoutStore.getState().hydrate();
    hydrate();
    backupHydrate();
    reportPeriodHydrate();
    return initTheme();
  }, [hydrate, backupHydrate, reportPeriodHydrate, initTheme]);

  // Ask the browser to keep our IndexedDB as PERSISTENT storage, so it isn't
  // silently evicted on a browser update / "clear site data under pressure"
  // (issue #24 — token + budgets + local edits live only in IDB). Best-effort:
  // the prompt-less grant depends on engagement/heuristics, and a user clearing
  // data manually still wipes it. We only ask once, when not already persisted.
  useEffect(() => {
    const s = navigator.storage;
    if (!s?.persist || !s.persisted) return;
    void s.persisted().then((already) => {
      if (!already) void s.persist().catch(() => {});
    }).catch(() => {});
  }, []);

  // Replace every browser-native `title` tooltip with the app's own bubble —
  // one delegated listener covers the whole app (and absorbs the old rule that
  // a truncating cell only gets a tooltip while its text is actually clipped).
  useEffect(() => installNativeTooltips(), []);

  // Once the report-period setting is known, reset the filter's "current
  // month" to the matching billing period — so that fresh visits always
  // start with the correct window when startDay != 1. We do this only
  // once on first hydrate to avoid stomping over the user's manual
  // month-step navigation later in the session.
  const reportPeriodReconciled = useRef(false);
  useEffect(() => {
    if (!reportPeriodLoaded) return;
    if (reportPeriodReconciled.current) return;
    reportPeriodReconciled.current = true;
    resetToCurrentPeriod(monthStartDay);
  }, [reportPeriodLoaded, monthStartDay, resetToCurrentPeriod]);

  // Once backup settings are loaded, check on mount + every 10 minutes.
  useEffect(() => {
    if (!backupLoaded || !loaded) return;
    backupRunIfDue();
    const id = setInterval(() => backupRunIfDue(), 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [backupLoaded, loaded, backupRunIfDue]);

  // Auto-push debouncer. When pushMode === "auto", we observe the
  // overlay edit count: each change kicks a 2-second timer; if no new
  // edits arrive in that window, we flush the pending edits to Zenmoney.
  //
  // Why 2 s: long enough that filling a modal (date → amount → category
  // → save) coalesces into ONE push, short enough that the user feels
  // the sync is "instant" by the time they look at another screen.
  //
  // Errors don't propagate — pushPendingEdits writes them to the sync
  // log + sets pushError; the UI surfaces them from there.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Shared debounce: any change to either the edit overlay OR the
    // deleted-ids set (re)starts the 2 s countdown and ultimately
    // flushes both via pushPendingEdits (which bundles edits +
    // deletions into one request).
    const schedule = () => {
      const zen = useZenmoneyStore.getState();
      if (zen.pushMode !== "auto" || !zen.token) return;
      const hasEdits =
        Object.keys(useEditsStore.getState().edits).length > 0;
      const hasDeletions =
        useDeletedStore.getState().deletedIds.length > 0;
      const hasDrafts =
        Object.keys(useDraftsStore.getState().drafts).length > 0;
      const hasTagEdits =
        Object.keys(useTagEditsStore.getState().edits).length > 0;
      const hasAccountEdits =
        Object.keys(useAccountEditsStore.getState().edits).length > 0;
      const hasBudgetEdits =
        Object.keys(useBudgetEditsStore.getState().edits).length > 0;
      // Справочники: created categories, category deletions, and every kind of
      // counterparty change (rename / create / delete / merge).
      const hasNewCats = useNewCategoriesStore.getState().items.length > 0;
      const hasTagDeletions =
        Object.keys(useTagDeletionsStore.getState().deletions).length > 0;
      const hasCpEdits =
        countCounterpartyPending(useCounterpartyEditsStore.getState()) > 0;
      const hasPlannedDeletions =
        Object.keys(usePlannedDeletionsStore.getState().deletions).length > 0;
      if (
        !hasEdits &&
        !hasDeletions &&
        !hasDrafts &&
        !hasTagEdits &&
        !hasAccountEdits &&
        !hasBudgetEdits &&
        !hasNewCats &&
        !hasTagDeletions &&
        !hasCpEdits &&
        !hasPlannedDeletions
      )
        return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const live = useZenmoneyStore.getState();
        // Re-check at fire-time: user may have toggled mode off while
        // the debounce was pending.
        if (live.pushMode !== "auto") return;
        if (live.pushStatus === "syncing") return;
        void useZenmoneyStore.getState().pushPendingEdits().catch(() => {
          /* surfaced via pushError + sync log */
        });
      }, 2000);
    };
    // Only schedule on changes that ADD pending work — otherwise the
    // post-push cleanup (clearing an edit from the overlay) would
    // re-trigger and, because the deleted-id set is monotonic, produce
    // spurious "nothing to send" no-op pushes.
    const unsubEdits = useEditsStore.subscribe((s, p) => {
      if (s.edits === p.edits) return;
      // Fire only when there's actually an edit pending right now.
      if (Object.keys(s.edits).length === 0) return;
      schedule();
    });
    const unsubDeleted = useDeletedStore.subscribe((s, p) => {
      if (s.deletedIds === p.deletedIds) return;
      // Fire only when a NEW id was hidden (length grew) — not on
      // restore/clear, and not just because the set is non-empty.
      if (s.deletedIds.length <= p.deletedIds.length) return;
      schedule();
    });
    // New drafts (locally-created operations) push on the same debounce.
    // Fire only when a draft was ADDED (count grew) — the post-push
    // cleanup that clears sent drafts must not re-trigger a no-op push.
    const unsubDrafts = useDraftsStore.subscribe((s, p) => {
      if (s.drafts === p.drafts) return;
      if (Object.keys(s.drafts).length <= Object.keys(p.drafts).length) return;
      schedule();
    });
    // Category-tag edits (the «обязательная» flag) push on the same debounce.
    // Fire on any change to the edits map that leaves something pending — a
    // re-set to the same value still counts as intent to push.
    const unsubTagEdits = useTagEditsStore.subscribe((s, p) => {
      if (s.edits === p.edits) return;
      if (Object.keys(s.edits).length === 0) return;
      schedule();
    });
    // Правки счетов — на том же дебаунсе, что и категории.
    const unsubAccountEdits = useAccountEditsStore.subscribe((s, p) => {
      if (s.edits === p.edits) return;
      if (Object.keys(s.edits).length === 0) return;
      schedule();
    });
    // Plan/budget edits push on the same debounce.
    const unsubBudgetEdits = useBudgetEditsStore.subscribe((s, p) => {
      if (s.edits === p.edits) return;
      if (Object.keys(s.edits).length === 0) return;
      schedule();
    });
    // Справочники — created categories, deleted categories, counterparty
    // changes. These fire only when the queue GREW: a successful push empties
    // it, so a later edit grows it from zero again, while a PARTIAL clear (some
    // entries skipped because they need a re-sync) can't re-trigger itself into
    // a 2-second push loop.
    const unsubNewCats = useNewCategoriesStore.subscribe((s, p) => {
      if (s.items === p.items) return;
      if (s.items.length <= p.items.length) return;
      schedule();
    });
    const unsubTagDeletions = useTagDeletionsStore.subscribe((s, p) => {
      if (s.deletions === p.deletions) return;
      if (Object.keys(s.deletions).length <= Object.keys(p.deletions).length) return;
      schedule();
    });
    const unsubPlannedDeletions = usePlannedDeletionsStore.subscribe((s, p) => {
      if (s.deletions === p.deletions) return;
      if (Object.keys(s.deletions).length <= Object.keys(p.deletions).length) return;
      schedule();
    });
    const unsubCpEdits = useCounterpartyEditsStore.subscribe((s, p) => {
      const now = countCounterpartyPending(s);
      if (now === 0 || now <= countCounterpartyPending(p)) return;
      schedule();
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubEdits();
      unsubDeleted();
      unsubDrafts();
      unsubTagEdits();
      unsubAccountEdits();
      unsubBudgetEdits();
      unsubNewCats();
      unsubTagDeletions();
      unsubPlannedDeletions();
      unsubCpEdits();
    };
  }, []);

  // Auto-sync poller. We tick every 30 s and ask the Zenmoney store
  // whether a sync is due (it knows the interval setting + last
  // sync timestamp). 30 s is a compromise — fine-grained enough for
  // 1-minute intervals to feel responsive, sparse enough that a
  // suspended tab doesn't burn battery.
  //
  // Pause when the tab is hidden: `runAutoSyncIfDue` is a no-op
  // anyway when status === "syncing", but skipping the call avoids
  // racing with throttled timers in background tabs.
  useEffect(() => {
    let cancelled = false;
    const zen = useZenmoneyStore.getState();
    // Eager hydrate so the very first tick has the persisted
    // interval/enabled values instead of defaults.
    if (!zen.loaded) zen.hydrate();
    const tick = () => {
      if (cancelled) return;
      if (document.visibilityState !== "visible") return;
      void useZenmoneyStore.getState().runAutoSyncIfDue();
    };
    // Run once on mount and then every 30 s.
    tick();
    const id = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Правила с расписанием в минутах и часах: срок наступает сам, без
  // синхронизации, — значит кто-то должен на него смотреть, пока вкладка живёт.
  // Дневные и месячные это не трогает: им хватает захода в приложение, а лишний
  // прогон отсекает та же проверка срока.
  //
  // В отличие от авто-синка, фоновую вкладку НЕ пропускаем: там работа местная —
  // ни одного запроса в сеть, — а «каждые 15 минут» человек понимает как «пока
  // приложение открыто», даже если вкладка не поверх остальных. Браузер и так
  // придушит такой таймер до одного срабатывания в минуту.
  useEffect(() => {
    let cancelled = false;
    const id = setInterval(() => {
      if (cancelled) return;
      void useDataStore.getState().runDueRules();
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">
        Загрузка...
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav onOpenPalette={() => setPaletteOpen(true)} />
      <main className="flex-1 w-full px-4 md:px-6 py-4 md:py-6">
        <Routes>
          <Route element={<PlainLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/settings" element={<ImportPage />} />
            {/* Backwards-compat: the settings page used to live at
                /import. Redirect old bookmarks / shortcuts. */}
            <Route path="/import" element={<Navigate to="/settings" replace />} />
            <Route path="/recurring" element={<RecurringPage />} />
            <Route path="/compare" element={<ComparePage />} />
            <Route path="/budgets" element={<BudgetsPage />} />
            <Route path="/anomalies" element={<AnomaliesPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/goals" element={<GoalsPage />} />
            <Route path="/duplicates" element={<DuplicatesPage />} />
            <Route path="/uncategorized" element={<UncategorizedPage />} />
            <Route path="/trash" element={<TrashPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/rules" element={<RulesPage />} />
            <Route path="/health" element={<HealthPage />} />
            <Route path="/whatif" element={<WhatIfPage />} />
            <Route path="/year-review" element={<YearReviewPage />} />
            <Route path="/digest" element={<DigestPage />} />
            {/* Filtered pages: GlobalFilters is rendered INSIDE each page right
                after PageHeader (see TransactionsPage, CashflowPage, etc.) so
                the title sits above the filter bar.

                Раньше они стояли ВНЕ общего слоя — привычка тех времён, когда
                у них была своя обёртка с панелью отборов. Отборы давно
                переехали внутрь самих страниц, а страницы так и остались
                снаружи, мимо перезапуска обработчика ошибок и появления при
                переходе. */}
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/cashflow" element={<CashflowPage />} />
            <Route path="/categories" element={<CategoriesPage />} />
            <Route path="/report" element={<ReportPage />} />
            <Route path="/dynamics" element={<DynamicsPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/tags" element={<TagsPage />} />
            <Route path="/top" element={<TopPage />} />
            <Route path="/trends" element={<TrendsPage />} />
            <Route path="/sankey" element={<SankeyPage />} />
            <Route path="/wordcloud" element={<WordcloudPage />} />
            <Route path="/50-30-20" element={<Budget503020Page />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="border-t border-border mt-4">
        <div className="w-full px-4 md:px-6 py-3 flex items-center justify-center gap-2.5 text-xs text-muted">
          <span>
            DzenAnalytics{" "}
            <span className="tabular-nums">v{__APP_VERSION__}</span>
          </span>
          <span className="text-border">·</span>
          <button
            onClick={() => setChangelogOpen(true)}
            className="hover:text-accent transition-colors"
          >
            Что нового
          </button>
          <span className="text-border">·</span>
          <a
            href="https://pay.cloudtips.ru/p/bbde8948"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-accent transition-colors"
            title="Поддержать автора чаевыми"
          >
            <span aria-hidden>❤️</span>
            Отблагодарить автора
          </a>
        </div>
      </footer>
      <TransactionsDrawer />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
      <ConfirmDialog />
      <HistRatesProgress />
    </div>
  );
}

export default App;
