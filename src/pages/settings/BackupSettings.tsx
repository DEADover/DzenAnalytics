import { useMemo, useState, useRef } from "react";
import { Upload, AlertTriangle, Trash2, Download, Database, RefreshCw, Loader2, Clock, History, CloudDownload } from "lucide-react";
import { SettingsSectionHeader } from "../../components/SettingsSectionHeader";
import { InfoPopover, InfoTerm } from "../../components/InfoPopover";
import { Select } from "../../components/Select";
import { useDataStore } from "../../store/useDataStore";
import { useZenmoneyStore } from "../../store/useZenmoneyStore";
import { useCloudSnapshotStore } from "../../store/useCloudSnapshotStore";
import { confirm } from "../../store/useConfirmStore";
import { toast } from "../../store/useToastStore";
import { snapshotDeletionUndo } from "../../lib/cloudSnapshots";
import { pluralRu } from "../../lib/plural";
import { useBackupStore, type BackupInterval } from "../../store/useBackupStore";
import { formatNum } from "../../lib/format";
import { parseAndValidateBackup, restoreBackupPayload } from "../../lib/backup";
import { snapshotSummary } from "../../lib/snapshotLabel";
import { readSnapshotFile } from "../../lib/snapshotFile";
import { BackupComparison } from "../../components/BackupComparison";
import { RestoreWizardModal } from "../../components/RestoreWizardModal";
import { useRestoreWizardStore } from "../../store/useRestoreWizardStore";

/**
 * Вкладка «Бэкапы» настроек: копии по расписанию, снимки облака, восстановление. Вынесена из страницы настроек — у каждой вкладки свой файл.
 */
export function BackupSettings({
  currentUserId,
  onOpenSource,
}: {
  /** Кто подключён — снимки облака показываем только его. `null` — кэша нет. */
  currentUserId: number | null;
  /** Перейти на вкладку «Источник» (подключить Дзен-мани). */
  onOpenSource: () => void;
}) {
  const cloudSnapshots = useCloudSnapshotStore((s) => s.snapshots);
  const transactions = useDataStore((s) => s.transactions);
  const zenToken = useZenmoneyStore((s) => s.token);
  const backupInterval = useBackupStore((s) => s.interval);
  const backupLastAt = useBackupStore((s) => s.lastBackupAt);
  const cloudSnapshotsBusy = useCloudSnapshotStore((s) => s.busy);
  const cloudSnapshotsError = useCloudSnapshotStore((s) => s.error);
  const takeCloudSnapshot = useCloudSnapshotStore((s) => s.takeSnapshot);
  const deleteCloudSnapshot = useCloudSnapshotStore((s) => s.deleteSnapshot);
  const downloadCloudSnapshot = useCloudSnapshotStore((s) => s.download);
  const importCloudSnapshot = useCloudSnapshotStore((s) => s.importFromFile);
  const cloudSnapshotsOp = useCloudSnapshotStore((s) => s.busyOp);
  const openRestoreWizard = useRestoreWizardStore((s) => s.open);
  const [restoreWizardOpen, setRestoreWizardOpen] = useState(false);
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
  const setBackupInterval = useBackupStore((s) => s.setInterval);
  const runBackupNow = useBackupStore((s) => s.runNow);
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
      await runBackupNow();
      // Имя файла и его размер не показываем: браузер и так сообщает о
      // скачивании, а строка оставалась висеть рядом с кнопкой навсегда.
      setBackupMsg(null);
    } catch (e) {
      setBackupMsg(
        `Копия не скачалась. Попробуйте ещё раз${e instanceof Error && e.message ? ` (${e.message})` : ""}`
      );
    } finally {
      setBackupBusy(false);
    }
  }
  async function importBackup(file: File) {
    // Разбираем файл ДО вопроса о замене. Раньше сначала спрашивали
    // «текущие данные будут заменены?», человек соглашался — и только потом
    // узнавал, что файл вообще не тот. Страшный вопрос ради ничего.
    let dump: Record<string, unknown>;
    setBackupMsg(null);
    try {
      // Тем же чтением, что и у снимков: копию часто пересылают себе архивом,
      // и «сервис не принял мой же бэкап» — плохой конец истории.
      const text = await readSnapshotFile(file);
      // Validate + sanitize (type checks, prototype-pollution stripping,
      // size/depth bounds) before anything touches IndexedDB.
      dump = parseAndValidateBackup(text) as unknown as Record<string, unknown>;
    } catch (e) {
      // Разбор и распаковка бросают готовые фразы «что не так и что делать».
      setBackupMsg(
        e instanceof Error && e.message
          ? e.message
          : "Файл копии не прочитался. Выберите файл копии сервиса (.json) и попробуйте ещё раз"
      );
      return;
    }

    const count = Array.isArray(dump.transactions) ? dump.transactions.length : 0;
    const ok = await confirm({
      title: "Восстановить из копии?",
      message: `Текущие данные будут заменены. В файле ${formatNum(count)} ${pluralRu(count, ["операция", "операции", "операций"])}.`,
      confirmLabel: "Восстановить",
      tone: "warning",
    });
    if (!ok) return;
    setBackupBusy(true);
    try {
      // Write every section back to IndexedDB (shared key list with the
      // builder — incl. local edits/drafts/deletions/rules so un-pushed work
      // survives a restore).
      await restoreBackupPayload(dump);
      const restoredCount = Array.isArray(dump.transactions)
        ? dump.transactions.length
        : 0;
      setBackupMsg(
        `Восстановлено: ${formatNum(restoredCount)} ${pluralRu(restoredCount, ["операция", "операции", "операций"])}. Обновляем страницу…`
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
      setBackupMsg(
        `Данные из копии не восстановились. Обновите страницу и попробуйте ещё раз${
          e instanceof Error && e.message ? ` (${e.message})` : ""
        }`
      );
    } finally {
      setBackupBusy(false);
    }
  }
  return (
    <>

      <section className="card-tray card-pad space-y-5">
        {/* Обе копии на одной странице, друг под другом: раньше их развели
            вкладками, и рядом они никогда не показывались — а разница между
            ними как раз в том, что одна не заменяет другую. */}
        <SettingsSectionHeader icon={History} title="Резервные копии" />

        <BackupComparison />

        <>
        <div className="rounded-xl border border-border bg-panel2/30 p-4">
          {/* Что именно уезжает в файл — под знаком вопроса: это читают один
              раз, а место занимало постоянно, отодвигая сами кнопки вниз. */}
          <div className="flex items-center gap-2 mb-3">
            <Database className="w-4 h-4 text-accent shrink-0" />
            <span className="text-sm font-medium">Копии данных сервиса</span>
            <InfoPopover label="Что попадает в копию">
              <p>
                Всё, что <InfoTerm>живёт только здесь</InfoTerm> и не приходит
                из Дзен-мани: операции, бюджеты, цели, правила, виды, разрезы
                данных и оформление.
              </p>
              <p>
                И <InfoTerm>правки, которые ещё не ушли в Дзен-мани</InfoTerm>:
                после восстановления их по-прежнему можно отправить.
              </p>
              <p>
                <InfoTerm>Токен Дзен-мани в копию не попадает никогда</InfoTerm>{" "}
                — ему незачем покидать компьютер. Данные из облака тоже: они
                вернутся сами при первой синхронизации.
              </p>
              <p>
                Файл сжат — распаковывать его не нужно, сервис принимает оба
                вида.
              </p>
              <p>
                Восстановление заменяет всё, что сейчас в сервисе, и
                перезагружает страницу. Отправку правок оно переводит в{" "}
                <InfoTerm>ручной режим</InfoTerm>: вернувшиеся правки не должны
                уехать в Дзен-мани, прежде чем вы их увидите.
              </p>
            </InfoPopover>
          </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={exportBackup}
            disabled={backupBusy || transactions.length === 0}
            className="btn-primary"
          >
            <Download className="w-4 h-4" />
            Создать копию
          </button>
          <button
            onClick={() => backupRef.current?.click()}
            disabled={backupBusy}
            className="btn-ghost"
          >
            <Upload className="w-4 h-4" />
            Восстановить
          </button>
          <input
            ref={backupRef}
            type="file"
            accept="application/json,.json,application/zip,.zip,application/gzip,.gz"
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

        {/* Расписание живёт ЗДЕСЬ ЖЕ, а не отдельной карточкой: это тот же
            самый бэкап, только скачанный без нажатия. Двумя блоками подряд он
            читался как вторая, чем-то другая функция. */}
        <div className="flex items-center justify-between gap-3 flex-wrap border-t border-border pt-3 mt-4">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <Clock className="w-4 h-4 text-accent shrink-0" />
            <span className="text-sm font-medium">По расписанию</span>
            <InfoPopover label="Как работает расписание">
              <p>
                Та же копия, только скачивается сама — раз в час, день или
                неделю. Сервис проверяет срок при открытии и дальше примерно
                каждые десять минут. К имени файла добавляется «-auto».
              </p>
              <p>
                Срок считается от <InfoTerm>последней копии</InfoTerm>, в том
                числе сделанной вручную: если копия только что готова,
                повторять её через час незачем.
              </p>
              <p>
                Копия создаётся, только пока сервис открыт: закрытую вкладку
                браузер к сроку не разбудит. О скачивании он покажет
                уведомление — так и должно быть.
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
              ariaLabel="Как часто создавать копию"
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
        </>

        {/* Cloud snapshot — Phase 0 of two-way sync. Only available with
            an API token connected (there's nothing to snapshot in CSV
            mode). Stores up to 5 raw responses of POST /v8/diff/ so we
            can fall back to a known-good cloud state if a future push
            operation goes wrong. */}
        {zenToken ? (
          <div className="rounded-xl border border-border bg-panel2/30 p-4">
            <div className="flex items-center gap-2 mb-3">
              <History className="w-4 h-4 text-accent shrink-0" />
              <span className="text-sm font-medium">Снимки аккаунта Дзен-мани</span>
              <InfoPopover label="Что попадает в снимок">
                <p>
                  Всё, что лежит в Дзен-мани: операции, счета, категории,
                  контрагенты и планы. Снимок остаётся на этом компьютере, в
                  облако не уходит, и его можно скачать файлом.
                </p>
                <p>
                  Восстановление отправляет обратно в Дзен-мани всё, кроме{" "}
                  <InfoTerm>«Планов месяца»</InfoTerm>: суммы бюджета по
                  категориям снимок хранит, но не возвращает — при отправке они
                  теряют подкатегории.
                </p>
                <p>
                  Снимок — страховка перед{" "}
                  <button
                    type="button"
                    onClick={onOpenSource}
                    className="text-accent hover:underline"
                  >
                    двусторонней синхронизацией
                  </button>
                  : если отправка правок что-то испортит, прежнее состояние
                  можно вернуть. Перед отправкой правок снимок делается и сам,
                  а частоту можно настроить на вкладке «Данные».
                </p>
                <p>
                  Хранятся последние <InfoTerm>пять</InfoTerm>: самый старый
                  уступает место новому.
                </p>
              </InfoPopover>
            </div>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <button
                onClick={() => takeCloudSnapshot()}
                disabled={cloudSnapshotsBusy}
                className="btn-primary"
              >
                {cloudSnapshotsOp === "snapshot" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CloudDownload className="w-4 h-4" />
                )}
                {cloudSnapshotsOp === "snapshot" ? "Создаю снимок…" : "Создать снимок"}
              </button>
              {/* Одна кнопка на всё восстановление: выбор снимка, проверка,
                  подготовка и заливка идут шагами внутри окна. На экране они
                  занимали половину страницы и читались все сразу. */}
              <button
                onClick={() => {
                  openRestoreWizard(visibleSnapshots[0]?.id ?? null);
                  setRestoreWizardOpen(true);
                }}
                disabled={cloudSnapshotsBusy}
                className="btn-ghost"
              >
                <RefreshCw className="w-4 h-4" />
                Восстановить
              </button>
            </div>

            {cloudSnapshotsError && (
              <div className="text-xs text-expense flex items-start gap-2 mb-3">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{cloudSnapshotsError}</span>
              </div>
            )}

            {/* Счётчик слотов — заголовком списка, а не подписью у кнопок:
                он описывает список, и рядом с «Создать снимок» читался как
                состояние кнопки. */}
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <span className="caps-label">
                {cloudSnapshots.length === 0 ? "Снимков ещё не было" : "Сохранённые снимки"}
              </span>
              {cloudSnapshots.length > 0 && (
                <span className="text-xs text-muted tabular-nums">
                  Занято {visibleSnapshots.length}{" "}
                  {pluralRu(visibleSnapshots.length, ["слот", "слота", "слотов"])} из 5
                </span>
              )}
            </div>

            {visibleSnapshots.length > 0 && (
              <div className="text-xs space-y-1 -mx-1 px-1 max-h-72 overflow-y-auto">
                {visibleSnapshots.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-3 py-2 border-b border-border/40 last:border-b-0"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">
                        {new Date(s.createdAt).toLocaleString("ru-RU", {
                          day: "numeric",
                          month: "long",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                      <div className="text-xs text-muted tabular-nums">
                        {snapshotSummary(s.counts, s.approxBytes)}
                      </div>
                    </div>
                    <button
                      onClick={() => downloadCloudSnapshot(s.id)}
                      className="btn-icon shrink-0"
                      title="Сохранить снимок файлом"
                      aria-label="Сохранить снимок файлом"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={async () => {
                        // Без вопроса: снимок вернёт «Отменить» на плашке.
                        const undo = await snapshotDeletionUndo(s.id);
                        await deleteCloudSnapshot(s.id);
                        toast("Снимок удалён", {
                          undo: async () => {
                            await undo();
                            await useCloudSnapshotStore.getState().hydrate();
                          },
                        });
                      }}
                      className="btn-icon-danger shrink-0"
                      title="Удалить снимок с этого компьютера"
                      aria-label="Удалить снимок"
                      disabled={cloudSnapshotsBusy}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {restoreWizardOpen && (
              <RestoreWizardModal
                snapshots={visibleSnapshots}
                onImportFile={(f) => importCloudSnapshot(f)}
                onTakeSnapshot={() => takeCloudSnapshot()}
                takingSnapshot={cloudSnapshotsOp === "snapshot"}
                onClose={() => setRestoreWizardOpen(false)}
              />
            )}

          </div>
        ) : (
          <div className="rounded-xl border border-border bg-panel2/30 p-4 text-sm text-muted">
            Снимки аккаунта доступны только при подключённом Дзен-мани.
            Подключите его на вкладке «Данные».
          </div>
        )}
      </section>
    </>
  );
}
