import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CloudDownload,
  History,
  Upload,
  X,
} from "lucide-react";
import { formatNum } from "../lib/format";
import { pluralRu } from "../lib/plural";
import { snapshotSummary } from "../lib/snapshotLabel";
import { InfoPopover } from "./InfoPopover";
import { useRestoreWizardStore } from "../store/useRestoreWizardStore";
import type { CloudSnapshotSummary } from "../lib/cloudSnapshots";

/**
 * Мастер восстановления из снимка (#93).
 *
 * Окно — чистое отображение: шаг, кнопки и тексты берутся из фазы в сторе
 * (`useRestoreWizardStore`). Своего состояния здесь нет намеренно: раньше
 * выбор, согласие и время сверки жили локально и пропадали вместе с окном,
 * а работа продолжала идти в фоне.
 */

const STEPS = [
  { id: "pick", title: "Снимок" },
  { id: "clear", title: "Очистка" },
  { id: "dictionaries", title: "Справочники" },
  { id: "ready", title: "Заливка" },
  { id: "done", title: "Готово" },
] as const;

/** Какой сегмент полосы считать текущим для данной фазы. */
const SEGMENT: Record<string, number> = {
  pick: 0,
  clear: 1,
  dictionaries: 2,
  ready: 3,
  restoring: 3,
  partial: 3,
  done: 4,
};

export function RestoreWizardModal({
  snapshots,
  onImportFile,
  onTakeSnapshot,
  takingSnapshot,
  onClose,
}: {
  snapshots: CloudSnapshotSummary[];
  onImportFile: (file: File) => void;
  onTakeSnapshot: () => void;
  takingSnapshot: boolean;
  onClose: () => void;
}) {
  const w = useRestoreWizardStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const busy = w.running !== null || takingSnapshot;

  // Esc закрывает, фокус приходит в окно. Раньше не было ни того, ни другого:
  // мастер закрывался только случайным кликом по фону — тем самым, которого
  // человек не хотел.
  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const chosen = snapshots.find((s) => s.id === w.snapshotId) ?? null;
  const active = SEGMENT[w.phase] ?? 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="restore-wizard-title"
        tabIndex={-1}
        className="w-full max-w-2xl rounded-2xl border border-border bg-panel shadow-2xl outline-none"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <span className="p-1.5 rounded-lg bg-accent2/10 text-accent2 shrink-0">
              <History className="w-4 h-4" />
            </span>
            <div id="restore-wizard-title" className="font-semibold">
              Восстановление из снимка
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-muted hover:text-text shrink-0 disabled:opacity-40"
            aria-label="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <ol className="flex items-start gap-1.5 px-5 pt-4">
          {STEPS.map((s, i) => {
            const passed = w.phase === "done" || i < active;
            const current = i === active && w.phase !== "done";
            return (
              <li key={s.id} className="flex-1 min-w-0">
                <div
                  className={`h-1 rounded-full ${passed ? "bg-income" : current ? "bg-accent" : "bg-border"}`}
                />
                <div
                  className={`text-[11px] mt-1 truncate ${current || (passed && i === 4) ? "text-text font-medium" : "text-muted"}`}
                >
                  {s.title}
                </div>
              </li>
            );
          })}
        </ol>

        {/* Ошибка — вверху: внизу прокручиваемой области она уходила под сгиб. */}
        {w.error && (
          <div className="mx-5 mt-4 flex items-start gap-2 rounded-xl border border-expense/40 bg-expense/5 p-3 text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-expense" />
            <span>{w.error}</span>
          </div>
        )}

        <div className="px-5 py-4 text-sm space-y-3 max-h-[55vh] overflow-y-auto">
          {w.phase === "pick" && (
            <PickStep
              snapshots={snapshots}
              chosen={chosen}
              onPick={w.pick}
              accepted={w.accepted}
              onAccept={w.accept}
              onUpload={() => fileRef.current?.click()}
              onTakeSnapshot={onTakeSnapshot}
              takingSnapshot={takingSnapshot}
            />
          )}

          {w.phase === "clear" && <ClearStep preflight={w.preflight} checkedAt={w.checkedAt} />}

          {w.phase === "dictionaries" && (
            <DictionariesStep
              preflight={w.preflight}
              progress={w.cleanupProgress}
              rejected={w.cleanupResult?.rejected.length ?? 0}
            />
          )}

          {(w.phase === "ready" || w.phase === "restoring") && chosen && (
            <ReadyStep snapshot={chosen} progress={w.restoreProgress} />
          )}

          {w.phase === "partial" && <PartialStep />}

          {w.phase === "done" && <DoneStep result={w.restoreResult} />}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border">
          <div>
            {(w.phase === "clear" || w.phase === "dictionaries") && (
              <button onClick={w.back} disabled={busy} className="btn-ghost text-sm">
                Назад
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} disabled={busy} className="btn-ghost text-sm">
              {w.phase === "done" || w.phase === "partial" ? "Закрыть" : "Отмена"}
            </button>
            <PrimaryButton chosen={chosen} busy={busy} />
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImportFile(f);
            e.target.value = "";
          }}
        />
      </div>
    </div>,
    document.body
  );
}

/** Главная кнопка шага. Подпись меняется целиком — от крутилки сбоку ряд дёргался. */
function PrimaryButton({
  chosen,
  busy,
}: {
  chosen: CloudSnapshotSummary | null;
  busy: boolean;
}) {
  const w = useRestoreWizardStore();
  if (w.phase === "done" || w.phase === "partial") return null;

  if (w.phase === "pick") {
    return (
      <button
        onClick={w.begin}
        disabled={busy || !chosen || !w.accepted}
        title={!w.accepted ? "Отметьте согласие выше" : undefined}
        className="btn-primary text-sm"
      >
        Далее
      </button>
    );
  }
  if (w.phase === "clear") {
    return (
      <button onClick={() => void w.check()} disabled={busy} className="btn-primary text-sm">
        {w.running === "check" ? "Проверяю…" : "Проверить"}
      </button>
    );
  }
  if (w.phase === "dictionaries") {
    return (
      <button onClick={() => void w.cleanup()} disabled={busy} className="btn-primary text-sm">
        {w.running === "cleanup"
          ? "Удаляю…"
          : w.running === "check"
            ? "Проверяю…"
            : "Удалить"}
      </button>
    );
  }
  return (
    <button
      onClick={() => void w.restore()}
      disabled={busy}
      className="btn-primary text-sm !bg-warn hover:!bg-warn/90"
    >
      {w.running === "restore" ? "Восстанавливаю…" : "Восстановить"}
    </button>
  );
}

function PickStep({
  snapshots,
  chosen,
  onPick,
  accepted,
  onAccept,
  onUpload,
  onTakeSnapshot,
  takingSnapshot,
}: {
  snapshots: CloudSnapshotSummary[];
  chosen: CloudSnapshotSummary | null;
  onPick: (id: string) => void;
  accepted: boolean;
  onAccept: (v: boolean) => void;
  onUpload: () => void;
  onTakeSnapshot: () => void;
  takingSnapshot: boolean;
}) {
  return (
    <>
      <div className="flex items-center gap-1.5">
        <span className="font-medium">К какому состоянию вернуть аккаунт</span>
        <InfoPopover label="Как это работает">
          <p>
            Снимок заводится в Дзен-мани заново, под новыми номерами: вернуть
            удалённые записи под прежними сервис не даёт — принимает запрос и
            молча ничего не меняет.
          </p>
          <p>
            Поэтому снимок не заменяет содержимое аккаунта, а добавляется к нему.
            Аккаунт должен быть пуст, иначе данные задвоятся. По той же причине
            теряется связь операций с банковскими выписками.
          </p>
        </InfoPopover>
      </div>

      {snapshots.length === 0 ? (
        <p className="text-muted">Снимков нет. Загрузите файл, сохранённый раньше.</p>
      ) : (
        <div className="space-y-1">
          {snapshots.map((s) => (
            <label
              key={s.id}
              className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer ${
                chosen?.id === s.id
                  ? "border-accent bg-accent/5"
                  : "border-border hover:bg-panel2/60"
              }`}
            >
              <input
                type="radio"
                name="snapshot"
                checked={chosen?.id === s.id}
                onChange={() => onPick(s.id)}
                className="mt-1 shrink-0"
              />
              <span className="min-w-0">
                <span className="block font-medium">
                  {new Date(s.createdAt).toLocaleString("ru-RU", {
                    day: "numeric",
                    month: "long",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="block text-xs text-muted tabular-nums">
                  {snapshotSummary(s.counts, s.approxBytes)}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}

      <button onClick={onUpload} className="btn-ghost text-xs inline-flex items-center gap-2">
        <Upload className="w-3.5 h-3.5" />
        Загрузить файл
      </button>

      {/* Страховка — это снимок ТЕКУЩЕГО состояния, а не тот, который сейчас
          зальют. Раньше здесь предлагалось «сохранить снимок файлом», и
          сохранялся ровно тот, к которому возвращаются: отыграть назад им
          нельзя было в принципе. */}
      <div className="rounded-xl border border-warn/40 bg-warn/5 p-3 space-y-2">
        <p className="text-xs">
          Аккаунт вернётся к выбранному состоянию. Всё, что появилось после,
          пропадёт, и отменить это будет нечем.
        </p>
        <button
          onClick={onTakeSnapshot}
          disabled={takingSnapshot}
          className="btn-ghost text-xs inline-flex items-center gap-2"
        >
          <CloudDownload className="w-3.5 h-3.5" />
          {takingSnapshot ? "Снимаю…" : "Снять снимок нынешнего состояния"}
        </button>
        <label className="flex items-start gap-2.5 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => onAccept(e.target.checked)}
            className="mt-0.5 shrink-0"
          />
          <span className="text-xs">
            Действую на свой страх и риск. За данные в Дзен-мани отвечаю я:
            DzenAnalytics такой ответственности не несёт.
          </span>
        </label>
      </div>
    </>
  );
}

function ClearStep({
  preflight,
  checkedAt,
}: {
  preflight: import("../lib/restorePreflight").RestorePreflight | null;
  checkedAt: number | null;
}) {
  const left = preflight?.blockers.find((b) => b.kind === "notEmpty")?.count ?? null;
  return (
    <>
      <p>
        Очистите аккаунт в Дзен-мани: <strong>Ещё → Настройки аккаунта → Начать
        всё сначала</strong>. На сайте — то же в настройках профиля.
      </p>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
        <span className="text-xs text-muted">Операций в аккаунте</span>
        <span className="tabular-nums font-medium">
          {left === null ? "—" : formatNum(left)}
        </span>
      </div>
      <p className="text-xs text-muted">
        Дзен-мани обновляет облако до пяти минут, поэтому сразу после очистки
        число может не измениться. Нажмите «Проверить» ещё раз через минуту.
      </p>
      {checkedAt && (
        <p className="text-xs text-muted">
          Проверено в{" "}
          {new Date(checkedAt).toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      )}
    </>
  );
}

function DictionariesStep({
  preflight,
  progress,
  rejected,
}: {
  preflight: import("../lib/restorePreflight").RestorePreflight | null;
  progress: import("../lib/accountCleanup").CleanupProgress | null;
  rejected: number;
}) {
  const tags = preflight?.blockers.find((b) => b.kind === "leftoverTags")?.count ?? 0;
  const merchants =
    preflight?.blockers.find((b) => b.kind === "leftoverMerchants")?.count ?? 0;
  return (
    <>
      <p>
        Операции и счета удалены, но категории и контрагенты остались: команда
        «Начать всё сначала» их не затрагивает. Удалим их, иначе рядом с теми,
        что приедут из снимка, останутся нынешние.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border p-3">
          <div className="text-xs text-muted">Категории</div>
          <div className="tabular-nums font-medium">{formatNum(tags)}</div>
        </div>
        <div className="rounded-xl border border-border p-3">
          <div className="text-xs text-muted">Контрагенты</div>
          <div className="tabular-nums font-medium">{formatNum(merchants)}</div>
        </div>
      </div>
      {progress && progress.phase !== "done" && (
        <div className="space-y-1">
          <p className="text-xs text-muted tabular-nums">
            {progress.phase === "tags" ? "Удаляю категории" : "Удаляю контрагентов"}:{" "}
            {formatNum(progress.sent)} из {formatNum(progress.total)}
          </p>
          <div className="h-1 rounded-full bg-border overflow-hidden">
            <div
              className="h-full bg-accent transition-all"
              style={{
                width: `${progress.total > 0 ? Math.round((progress.sent / progress.total) * 100) : 0}%`,
              }}
            />
          </div>
        </div>
      )}
      <p className="text-xs text-muted">
        Категории удаляются по одной, Дзен-мани сверяет каждую со всеми
        операциями. На несколько десятков уйдёт пара минут — окно можно не
        закрывать.
      </p>
      {rejected > 0 && (
        <p className="text-xs text-warn">
          {formatNum(rejected)}{" "}
          {pluralRu(rejected, ["запись", "записи", "записей"])} Дзен-мани удалить
          отказался. Их придётся удалить вручную в самом Дзен-мани.
        </p>
      )}
    </>
  );
}

function ReadyStep({
  snapshot,
  progress,
}: {
  snapshot: CloudSnapshotSummary;
  progress: import("../lib/cloudSnapshots").RestoreProgress | null;
}) {
  const c = snapshot.counts;
  return (
    <>
      {!progress && (
        <div className="flex items-start gap-2 text-income">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="text-text">Аккаунт пуст, можно восстанавливать.</span>
        </div>
      )}
      {/* Счётчики видны и во время заливки: именно тогда по ним и сверяют. */}
      <div className="grid grid-cols-4 gap-3">
        <Cell label="Операции" value={c.transactions} />
        <Cell label="Счета" value={c.accounts} />
        <Cell label="Категории" value={c.tags} />
        <Cell label="Контрагенты" value={c.merchants} />
      </div>
      {progress && (
        <div className="space-y-1">
          <p className="text-xs text-muted tabular-nums">
            {progress.phase === "accounts"
              ? "Переношу счета"
              : progress.phase === "tags"
                ? "Переношу категории"
                : progress.phase === "merchants"
                  ? "Переношу контрагентов"
                  : progress.phase === "transactions"
                    ? "Переношу операции"
                    : "Заканчиваю"}
            {progress.total > 0 && (
              <>
                : {formatNum(progress.current)} из {formatNum(progress.total)}
              </>
            )}
          </p>
          <div className="h-1 rounded-full bg-border overflow-hidden">
            <div
              className="h-full bg-accent2 transition-all"
              style={{
                width: `${progress.total > 0 ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : 0}%`,
              }}
            />
          </div>
          <p className="text-xs text-muted">Займёт минуту-другую. Окно можно не закрывать.</p>
        </div>
      )}
    </>
  );
}

function Cell({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="tabular-nums font-medium">{formatNum(value)}</div>
    </div>
  );
}

/**
 * Заливка прервалась. Повторять нельзя: часть данных уже в облаке, и вторая
 * попытка добавила бы их ещё раз — под новыми номерами, то есть задвоила.
 */
function PartialStep() {
  return (
    <>
      <div className="flex items-start gap-2 text-warn">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span className="text-text">Восстановление прервалось на середине.</span>
      </div>
      <p className="text-xs text-muted">
        Часть данных уже в Дзен-мани. Повторять сейчас нельзя: снимок зальётся
        заново и то, что успело пройти, задвоится.
      </p>
      <p className="text-xs text-muted">
        Очистите аккаунт в Дзен-мани ещё раз («Ещё → Настройки аккаунта → Начать
        всё сначала») и начните восстановление сначала — снимок остался на месте.
      </p>
    </>
  );
}

function DoneStep({
  result,
}: {
  result: import("../lib/cloudSnapshots").RestoreResult | null;
}) {
  const dropped = result?.skipped.transactions ?? 0;
  return (
    <>
      <div className="flex items-start gap-2 text-income">
        <Check className="w-4 h-4 shrink-0 mt-0.5" />
        <span className="text-text">Данные отправлены в Дзен-мани.</span>
      </div>
      {dropped > 0 && (
        <p className="text-xs text-warn">
          {formatNum(dropped)}{" "}
          {pluralRu(dropped, ["операция", "операции", "операций"])} перенести не
          удалось: в снимке они ссылались на счёт или категорию, которых там нет.
        </p>
      )}
      <p className="text-xs text-muted">
        Проверьте результат в Дзен-мани: число операций должно совпасть со
        снимком. Здесь данные появятся после синхронизации.
      </p>
    </>
  );
}
