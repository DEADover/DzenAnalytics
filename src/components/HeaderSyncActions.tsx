import { useEffect, useState, type ReactNode } from "react";
import { RefreshCw, CloudDownload, Check, AlertTriangle, UploadCloud, ListChecks } from "lucide-react";
import clsx from "clsx";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { useSyncFlashStore } from "../store/useSyncFlashStore";
import { useSyncCommands } from "../hooks/useSyncCommands";
import { confirm } from "../store/useConfirmStore";
import { snapshotPromiseText } from "../lib/cloudSnapshots";
import { formatNum } from "../lib/format";
import { pluralRu } from "../lib/plural";
import { usePendingChanges } from "../hooks/usePendingChanges";
import { PendingChangesModal } from "./PendingChangesModal";

/**
 * Header quick-actions for Zenmoney sync.
 *
 * Layout: a single bordered "segmented" container holds the two
 * icon-buttons (incremental + full re-sync), separated by a thin
 * divider. It reads as one cluster, like a button group in
 * the macOS toolbar style.
 *
 *   • RefreshCw — incremental sync (`sync()`), the everyday button.
 *   • CloudDownload — full re-sync (`sync({force: true})`), behind a
 *     confirm() because it drops the local cache. Useful after mass
 *     renames in the mobile app, or when data feels stale.
 *
 * Both buttons are hidden when there's no Zenmoney token configured —
 * the Settings page is where you connect a token, so hiding here
 * keeps the header tidy for CSV-mode users.
 *
 * Result feedback drops down BELOW the buttons as an absolutely-
 * positioned toast — keeps the header row from reflowing and avoids
 * the chip pushing the search box off-screen. Auto-dismisses after
 * five seconds (animated fade-out the last ~180ms).
 */
export function HeaderSyncActions({ leading }: { leading?: ReactNode }) {
  const token = useZenmoneyStore((s) => s.token);
  const error = useZenmoneyStore((s) => s.error);
  const lastSyncAt = useZenmoneyStore((s) => s.lastSyncAt);
  const loaded = useZenmoneyStore((s) => s.loaded);
  const hydrate = useZenmoneyStore((s) => s.hydrate);
  const { busy, runIncremental, runFull } = useSyncCommands();
  // Push side of the header (issue #50): in «Вручную» the only way to send
  // edits used to be a trip into Настройки, which is slow and easy to forget.
  const pushMode = useZenmoneyStore((s) => s.pushMode);
  const pushStatus = useZenmoneyStore((s) => s.pushStatus);
  const pending = usePendingChanges();
  const [reviewOpen, setReviewOpen] = useState(false);

  // Плашка итога живёт в сторе: полную синхронизацию на телефоне запускают из
  // меню, а итог показывает шапка. Исчезает в два шага — пока `closing`,
  // доигрывает затухание, потом снимается.
  const flash = useSyncFlashStore((s) => s.flash);
  const closing = useSyncFlashStore((s) => s.closing);
  const showFlash = useSyncFlashStore((s) => s.show);
  const startClosing = useSyncFlashStore((s) => s.startClosing);
  const clearFlash = useSyncFlashStore((s) => s.clear);

  // Hydrate the token from IndexedDB on first mount so the buttons
  // appear straight away if the user is already connected (header
  // mounts before /import is ever visited).
  useEffect(() => {
    if (!loaded) hydrate();
  }, [loaded, hydrate]);

  // Schedule: 5s visible, then 0.18s fade-out, then unmount.
  useEffect(() => {
    if (!flash) return;
    const tFade = setTimeout(startClosing, 5000);
    const tDrop = setTimeout(clearFlash, 5000 + 200);
    return () => {
      clearTimeout(tFade);
      clearTimeout(tDrop);
    };
  }, [flash, startClosing, clearFlash]);

  if (!loaded || !token) return null;

  const lastSyncHuman = lastSyncAt
    ? `Последняя синхронизация: ${new Date(lastSyncAt).toLocaleString("ru-RU")}`
    : "Ещё не синхронизировано на этом устройстве";

  // One shared class for the inner icon-buttons. They sit inside the
  // bordered container, so they themselves don't carry a border — just
  // a hover/focus background tint and the error-state colour when the
  // store is in `error` and we don't have a flash up at the moment.
  // Кнопки дорожки — общий `.seg-icon`: 32 в дорожке 42, как у значков шапки.
  const innerBtn = "seg-icon seg-icon-md group";

  // Which push controls the header shows, per the mode:
  //   • «Выключено» — nothing: edits never leave the device.
  //   • «Авто»      — nothing: they leave on their own.
  //   • «При синке» — review only; the sync button already sends them.
  //   • «Вручную»   — review + send, the whole point of the issue.
  // В «Вручную» кластер виден ВСЕГДА, даже когда отправлять нечего: кнопка не
  // должна появляться и исчезать, сдвигая привычные иконки под курсором.
  // Ширину компенсирует поле «Команды…» — оно в этом режиме уже (см. TopNav).
  // В «При синке» показываем только просмотр и только когда есть что смотреть.
  const manual = pushMode === "manual";
  const canReview = manual || (pushMode === "on-sync" && pending.total > 0);
  const canPush = manual;
  const nothingToSend = pending.total === 0;
  /** Есть что отправить — панель подсвечивается акцентом. */
  const hasPending = (canReview || canPush) && pending.total > 0;
  const pushing = pushStatus === "syncing";

  async function runPush() {
    // Фразу про копию облака берём из реальной политики снимков: обещать её
    // при политике «никогда» — врать пользователю.
    const snapshotText = await snapshotPromiseText(
      useZenmoneyStore.getState().snapshotPolicy
    );
    const ok = await confirm({
      title: `Отправить ${formatNum(pending.total)} ${pluralRu(pending.total, ["изменение", "изменения", "изменений"])} в Дзен-мани?`,
      message:
        snapshotText +
          "Проверим конфликты. Неподдерживаемые правки будут пропущены — увидите их список в журнале.",
      confirmLabel: "Отправить",
    });
    if (!ok) return;
    try {
      const res = await useZenmoneyStore.getState().pushPendingEdits();
      const parts: string[] = [];
      if (res.pushed > 0) parts.push(`отправлено ${formatNum(res.pushed)}`);
      if (res.created > 0) parts.push(`создано ${formatNum(res.created)}`);
      if (res.skipped.length > 0) parts.push(`пропущено ${formatNum(res.skipped.length)}`);
      showFlash({
        tone: res.skipped.length > 0 ? "err" : "ok",
        text: parts.length ? `Отправка: ${parts.join(", ")}` : "Отправка завершена",
      });
    } catch {
      showFlash({
        tone: "err",
        text: useZenmoneyStore.getState().pushError || "Не удалось отправить",
      });
    }
  }

  return (
    // `inline-flex items-center` on the wrapper instead of plain
    // block — without this the surrounding header `items-center` row
    // aligns the wrapper as a block element and the segmented control
    // ends up a hair higher than the gear/help icons next to it.
    <div className="relative inline-flex items-center shrink-0">
      {/* Одна панель на всё, что общается с облаком: отправку и загрузку.
          Рамка подсвечивается акцентом, только когда есть что отправлять, —
          в спокойном состоянии панель не тянет на себя внимание. */}
      <div
        className={clsx(
          // Дорожка-пилюля, как у меню и переключателей разделов. Прежде это
          // была обойма со скруглением в восемь пикселей — в ряду, где всё
          // остальное уже пилюли, она читалась деталью из другого набора.
          "seg-track",
          error && !busy && !flash
            ? "!border-expense/40"
            : hasPending && "!border-accent/40 !bg-accent/5"
        )}
      >
        {/* Слот в начале дорожки — сюда шапка кладёт переключатель разреза:
            он про те же данные, и держать его отдельной обоймой значило бы
            плодить в ряду ещё один предмет. */}
        {leading}
        {leading && <div className="w-px h-5 bg-border mx-0.5 self-center" />}
        {(canReview || canPush) && (
          <>
            {canReview && (
              <button
                type="button"
                onClick={() => setReviewOpen(true)}
                disabled={nothingToSend}
                title={
                  nothingToSend
                    ? "Нет изменений, ожидающих отправки"
                    : `Просмотреть изменения перед отправкой (${formatNum(pending.total)})`
                }
                className={clsx(innerBtn, "gap-1.5 text-accent")}
              >
                <ListChecks className="w-4 h-4" />
                {/* min-w держит ширину кластера постоянной, чтобы соседние
                    иконки не дёргались при 1 → 10 → 100 изменениях. */}
                <span className="text-xs tabular-nums font-medium min-w-[1.1em] text-left">
                  {formatNum(pending.total)}
                </span>
              </button>
            )}
            {canPush && (
              <button
                type="button"
                onClick={runPush}
                disabled={pushing || nothingToSend}
                title={
                  nothingToSend
                    ? "Нет изменений для отправки"
                    : "Отправить изменения в Дзен-мани"
                }
                className={clsx(innerBtn, "text-accent")}
              >
                <UploadCloud className={clsx("w-4 h-4", pushing && "animate-pulse")} />
              </button>
            )}
            <div className="w-px h-5 bg-border mx-0.5 self-center" />
          </>
        )}
        <button
          type="button"
          onClick={runIncremental}
          disabled={busy}
          title={`Синхронизация с Дзен-мани (только изменения)\n${lastSyncHuman}`}
          className={innerBtn}
        >
          <RefreshCw
            className={clsx("w-4 h-4", busy && "animate-spin")}
          />
        </button>

        {/* На телефоне полная синхронизация — в меню: в шапку шириной 375
            вместе со знаком, поиском и меню она уже не помещалась, а нужна
            редко. Обычная синхронизация остаётся — это главное действие. */}
        <button
          type="button"
          onClick={runFull}
          disabled={busy}
          title="Полная синхронизация (сбросить кэш и заново скачать всё)"
          className={clsx(innerBtn, "max-sm:hidden")}
        >
          <CloudDownload className="w-4 h-4" />
        </button>
      </div>

      {/* Toast — absolutely positioned, right-aligned with the
          button group. Frosted-glass aesthetic (`backdrop-blur` over
          a translucent panel) keeps it readable on top of any page
          content but visually distinct from the solid header bar
          above. The tone (success / error) is carried by a thin
          left-edge accent bar and the icon colour, not by tinting the
          whole background — keeps the chip neutral and quiet. */}
      {reviewOpen && <PendingChangesModal onClose={() => setReviewOpen(false)} />}

      {flash && (
        <div
          role="status"
          aria-live="polite"
          className={clsx(
            "absolute right-0 top-full mt-2 z-30 w-[320px] sm:w-[360px] pointer-events-none",
            closing ? "animate-flash-out" : "animate-flash-in"
          )}
        >
          <div className="flex items-stretch overflow-hidden rounded-lg border border-border bg-panel/70 backdrop-blur-md shadow-lg">
            {/* Tone accent bar — 3px wide, full height. Reads as a
                "status stripe" so the chip itself can stay neutral. */}
            <div
              className={clsx(
                "w-[3px] shrink-0",
                flash.tone === "ok" ? "bg-income" : "bg-expense"
              )}
            />
            <div className="flex items-start gap-2 px-3 py-2 text-xs leading-snug text-text/90">
              {flash.tone === "ok" ? (
                <Check className="w-3.5 h-3.5 shrink-0 mt-0.5 text-income" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-expense" />
              )}
              <span className="whitespace-normal break-words">{flash.text}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
