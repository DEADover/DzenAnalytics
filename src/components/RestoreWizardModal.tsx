import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CloudDownload,
  History,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { formatNum } from "../lib/format";
import { pluralRu } from "../lib/plural";
import { snapshotSummary } from "../lib/snapshotLabel";
import { InfoPopover, InfoTerm } from "./InfoPopover";
import { useRestoreWizardStore } from "../store/useRestoreWizardStore";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
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
  { id: "ready", title: "Перенос" },
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
              Восстановление снимка Дзен-мани
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
                {/* По центру своей полоски: слева подпись «Справочники»
                    прижималась к началу бара и казалась подписью к промежутку
                    между ним и соседним. */}
                <div
                  className={`text-[11px] mt-1 truncate text-center ${current || (passed && i === 4) ? "text-text font-medium" : "text-muted"}`}
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
              result={w.cleanupResult}
            />
          )}

          {(w.phase === "ready" || w.phase === "restoring") && chosen && (
            <ReadyStep
              snapshot={chosen}
              progress={w.restoreProgress}
              notes={w.preflight?.notes ?? []}
              deleted={w.preflight?.deletedInSnapshot ?? 0}
            />
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

        {/* Принимаем и .gz: партнёрский ZenTable выгружает бэкап Дзен-мани
            пожатым, а внутри — тот же сырой ответ diff. */}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json,application/zip,.zip,application/gzip,.gz"
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
        title={
          !w.accepted ? "Сначала подтвердите, что действуете на свой риск" : undefined
        }
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
      {/* Предупреждение — ПЕРВЫМ, до выбора снимка: сначала человек должен
          понять, что это необратимо, и только потом выбирать, к чему
          возвращаться. Внизу оно читалось как примечание к уже сделанному
          выбору.

          Страховка здесь — снимок ТЕКУЩЕГО состояния, а не тот, который сейчас
          зальют. Раньше предлагалось «сохранить снимок файлом», и сохранялся
          ровно тот, к которому возвращаются: отыграть назад им нельзя было в
          принципе. */}
      <div className="rounded-xl border border-warn/40 bg-warn/5 p-3 space-y-2">
        <p className="text-xs">
          Восстановление вернёт аккаунт к состоянию на момент снимка. Всё, что
          появилось после, пропадёт, и отменить это нельзя.
        </p>
        <button
          onClick={onTakeSnapshot}
          disabled={takingSnapshot}
          className="btn-ghost text-xs inline-flex items-center gap-2"
        >
          <CloudDownload className="w-3.5 h-3.5" />
          {takingSnapshot ? "Сохраняю…" : "Сохранить текущее состояние"}
        </button>
        <label className="flex items-start gap-2.5 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => onAccept(e.target.checked)}
            className="mt-0.5 shrink-0"
          />
          <span className="text-xs">
            Действую на свой страх и риск. DzenAnalytics не отвечает за
            корректность данных снимка и результаты его восстановления.
          </span>
        </label>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="font-medium">К какому состоянию вернуть аккаунт</span>
        <InfoPopover label="Как это работает">
          <p>
            Дзен-мани не даёт вернуть удалённые записи: запрос он принимает,
            но ничего не меняет. Поэтому записи из снимка заводятся заново, под
            новыми номерами.
          </p>
          <p>
            Значит, снимок не заменяет содержимое аккаунта, а добавляется к
            нему. Поэтому аккаунт нужно сначала очистить, иначе данные
            задвоятся. По той же причине теряется связь операций с банковскими
            выписками.
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

      {/* Форматы названы РЯДОМ с кнопкой, а не под ней: бэкап ZenTable
          приходит как `.json.gz`, и без этой строки человек не знает, примем
          ли мы его, пока не попробует. Строкой ниже она отрывалась от кнопки и
          читалась как подпись ко всему шагу. `flex-wrap` — чтобы на узком
          окне подпись ушла под кнопку, а не сжала её. */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={onUpload} className="btn-ghost text-xs shrink-0">
          <Upload className="w-3.5 h-3.5" />
          Загрузить файл
        </button>
        <p className="text-[11px] text-muted">
          Поддерживаются файлы бэкапа DzenAnalytics и ZenTable — в формате json,
          zip или gz.
        </p>
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
      <p>Очистите аккаунт в Дзен-мани:</p>
      {/* Два пути списком, а не одной фразой: человек делает это в своём
          приложении или на сайте, и путь у них разный. Ссылка ведёт прямо в
          профиль — искать его самому незачем. */}
      <ul className="list-disc list-inside space-y-1">
        <li>
          В мобильном приложении — <strong>Ещё → Настройки аккаунта → Начать
          всё сначала</strong>.{" "}
          <InfoPopover label="Очистил в приложении, а число не меняется">
            <p>
              Приложение хранит правки у себя и отправляет их на сервер не
              сразу. Пока очистка не уехала в облако, мы её не увидим — сколько
              ни нажимай «Проверить».
            </p>
            <p>
              Чтобы поторопить: откройте в приложении экран{" "}
              <InfoTerm>«Операции»</InfoTerm> и потяните список вниз
              (Pull-to-Refresh). Это ускорит процесс обновления данных в облаке
              Дзен-мани.
            </p>
          </InfoPopover>
        </li>
        <li>
          На сайте{" "}
          <a
            href="https://zenmoney.ru/a/#profile"
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent hover:underline"
          >
            zenmoney.ru
          </a>{" "}
          — <strong>Профиль → Начать всё сначала</strong>.
        </li>
      </ul>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
        <span className="text-xs text-muted">Операций в аккаунте</span>
        <span className="tabular-nums font-medium">
          {left === null ? "—" : formatNum(left)}
        </span>
      </div>
      <p className="text-xs text-muted">
        Дзен-мани обновляет данные не мгновенно — на это уходит до пяти минут,
        поэтому сразу после очистки число может не измениться. Нажмите
        «Проверить» ещё раз через несколько минут.
      </p>
      {checkedAt && (
        <p className="text-xs text-muted">
          Последняя проверка:{" "}
          {new Date(checkedAt).toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      )}
    </>
  );
}

/**
 * Секундомер работы.
 *
 * Отдельным компонентом, а не состоянием шага: он должен обнуляться при каждом
 * новом запуске, а сброс состояния прямо в эффекте — как раз то, за что ругает
 * линтер (каскадные перерисовки). Монтирование обнуляет его само.
 *
 * Нужен, потому что «сколько удалено» меняется раз в минуту с лишним: без
 * бегущих секунд экран выглядит замершим.
 */
function Elapsed() {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(
      () => setSec(Math.round((Date.now() - started) / 1000)),
      1000
    );
    return () => clearInterval(id);
  }, []);
  return sec > 0 ? <> · {sec} c</> : null;
}

function DictionariesStep({
  preflight,
  progress,
  result,
}: {
  preflight: import("../lib/restorePreflight").RestorePreflight | null;
  progress: import("../lib/accountCleanup").CleanupProgress | null;
  /** Итог последней уборки; null — её ещё не запускали. */
  result: import("../lib/accountCleanup").CleanupResult | null;
}) {
  const rejected = result?.rejected.length ?? 0;
  const tags = preflight?.blockers.find((b) => b.kind === "leftoverTags")?.count ?? 0;
  const merchants =
    preflight?.blockers.find((b) => b.kind === "leftoverMerchants")?.count ?? 0;
  return (
    <>
      <p>
        Операции и счета удалены, но категории и контрагенты остались — команда
        «Начать всё сначала» их не трогает. Для восстановления снимка их нужно
        предварительно удалить.
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
            <Elapsed />
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
        Категории удаляются по нескольку сразу, но всё равно небыстро: на
        полсотни уходит до пяти минут. Контрагенты удаляются быстро. Не
        перезагружайте страницу, пока идёт удаление.
      </p>
      {rejected > 0 && (
        <p className="text-xs text-warn">
          Дзен-мани отказался удалить {formatNum(rejected)}{" "}
          {pluralRu(rejected, ["категорию или контрагента", "категории или контрагентов", "категорий или контрагентов"])} — уберите их вручную.
        </p>
      )}
      {/* Итог ПРОВЕРКИ, а не отправки.
          Дзен-мани умеет ответить 200 и ничего не сделать — на этом стоит вся
          задача. Поэтому после уборки мы синхронизируемся и считаем заново, и
          если что-то осталось, это надо сказать прямо: иначе человек видит те
          же числа, что и до нажатия, и не понимает, сработало или нет. */}
      {result && !progress && tags + merchants > 0 && (
        <p className="text-xs text-warn">
          Запросы ушли без ошибки, но после проверки осталось{" "}
          {formatNum(tags + merchants)}{" "}
          {pluralRu(tags + merchants, ["запись", "записи", "записей"])}: Дзен-мани
          иногда принимает удаление и не выполняет его. Нажмите «Удалить» ещё раз
          — попробуем повторно удалить оставшиеся записи.
        </p>
      )}
    </>
  );
}

function ReadyStep({
  snapshot,
  progress,
  notes,
  deleted,
}: {
  snapshot: CloudSnapshotSummary;
  progress: import("../lib/cloudSnapshots").RestoreProgress | null;
  /** То, что переносу не мешает, но знать полезно — например, лишние счета. */
  notes: string[];
  /** Удалённые записи снимка: их тоже переносим, и счётчик их учитывает. */
  deleted: number;
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
      {/* Плиткам нужна подпись: без неё пять чисел висели в воздухе, и было
          непонятно, это уже в аккаунте или только собирается туда.
          Счётчики видны и во время заливки: именно тогда по ним и сверяют.
          Планы — пятой плиткой и только когда они есть: у аккаунта без планов
          пустая клетка сообщала бы лишь о том, что мы умеем их считать. */}
      <p className="text-sm font-medium">Будут восстановлены:</p>
      <div className={`grid gap-3 ${c.reminders ? "grid-cols-5" : "grid-cols-4"}`}>
        <Cell label="Операции" value={c.transactions} />
        <Cell label="Счета" value={c.accounts} />
        <Cell label="Категории" value={c.tags} />
        <Cell label="Контрагенты" value={c.merchants} />
        {c.reminders ? <Cell label="Планы" value={c.reminders} /> : null}
      </div>
      {/* Число удалённых записей называем ДО переноса. Иначе счётчик по ходу
          уходит выше обещанных операций, и это выглядит ошибкой. */}
      {deleted > 0 && (
        <p className="text-xs text-muted">
          Кроме них перенесутся {formatNum(deleted)}{" "}
          {pluralRu(deleted, [
            "удалённая запись",
            "удалённые записи",
            "удалённых записей",
          ])}
          : снимок — полная копия, и историю удалений он сохраняет. Поэтому по
          ходу переноса счётчик дойдёт не до {formatNum(snapshot.counts.transactions)},
          а до {formatNum(snapshot.counts.transactions + deleted)} — так и должно
          быть.
        </p>
      )}

      {/* Замечания сверки. Раньше они вычислялись и не показывались нигде:
          совет про лишние счета человек не видел никогда. */}
      {!progress &&
        notes.map((n) => (
          <p key={n} className="text-xs text-muted">
            {n}
          </p>
        ))}
      {progress && (
        <div className="space-y-1">
          <p className="text-xs text-muted tabular-nums">
            {progress.phase === "accounts"
              ? "Переношу счета"
              : progress.phase === "tags"
                ? "Переношу категории"
                : progress.phase === "merchants"
                  ? "Переношу контрагентов"
                  : progress.phase === "reminders"
                    ? "Переношу планы"
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
          <p className="text-xs text-muted">
            Займёт минуту-другую. Не перезагружайте страницу, пока идёт перенос.
          </p>
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
        Часть данных уже в Дзен-мани. Повторять сейчас нельзя: снимок
        перенесётся заново, и то, что успело пройти, задвоится.
      </p>
      <p className="text-xs text-muted">
        Очистите аккаунт в Дзен-мани ещё раз («Ещё → Настройки аккаунта →
        Начать всё сначала») и запустите восстановление заново — снимок остался
        на месте.
      </p>
    </>
  );
}

/**
 * Перенос закончен.
 *
 * Синхронизация — кнопкой прямо здесь. Раньше последний шаг заканчивался
 * фразой «здесь данные появятся после синхронизации», и человек оставался с
 * пустым сервисом и заданием, которое надо где-то выполнить самому. Кнопка
 * рядом с сообщением закрывает восстановление целиком.
 */
function DoneStep({
  result,
}: {
  result: import("../lib/cloudSnapshots").RestoreResult | null;
}) {
  const dropped = result?.skipped.transactions ?? 0;
  const sent = result?.accepted;
  const syncing = useZenmoneyStore((z) => z.status === "syncing");
  const lastSyncAt = useZenmoneyStore((z) => z.lastSyncAt);
  const sync = useZenmoneyStore((z) => z.sync);
  const [synced, setSynced] = useState(false);
  return (
    <>
      <div className="flex items-start gap-2 text-income">
        <Check className="w-4 h-4 shrink-0 mt-0.5" />
        <span className="text-text">Снимок перенесён в Дзен-мани.</span>
      </div>

      {sent && (
        <p className="text-xs text-muted">
          Отправлено: {formatNum(sent.transactions.visible + sent.transactions.hidden)}{" "}
          {pluralRu(
            sent.transactions.visible + sent.transactions.hidden,
            ["операция", "операции", "операций"]
          )}
          , {formatNum(sent.accounts.active + sent.accounts.archived)}{" "}
          {pluralRu(
            sent.accounts.active + sent.accounts.archived,
            ["счёт", "счёта", "счетов"]
          )}
          , {formatNum(sent.tags.active + sent.tags.archived)}{" "}
          {pluralRu(sent.tags.active + sent.tags.archived, [
            "категория",
            "категории",
            "категорий",
          ])}
          , {formatNum(sent.merchants)}{" "}
          {pluralRu(sent.merchants, ["контрагент", "контрагента", "контрагентов"])}
          {sent.reminders > 0 && (
            <>
              , {formatNum(sent.reminders)}{" "}
              {pluralRu(sent.reminders, ["план", "плана", "планов"])}
            </>
          )}
          .
        </p>
      )}

      {dropped > 0 && (
        <p className="text-xs text-warn">
          {formatNum(dropped)}{" "}
          {pluralRu(dropped, ["операция", "операции", "операций"])} перенести не
          удалось: они ссылались на счёт или категорию, которых в снимке нет.
        </p>
      )}

      <div className="rounded-xl border border-border p-3 space-y-2">
        <p className="text-xs text-muted">
          Осталось забрать данные обратно: пока в DzenAnalytics пусто, потому
          что аккаунт очищали.
        </p>
        <button
          onClick={async () => {
            await sync({ force: true });
            setSynced(true);
          }}
          disabled={syncing}
          className="btn-primary text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Синхронизирую…" : "Синхронизировать"}
        </button>
        {synced && !syncing && lastSyncAt && (
          <p className="text-xs text-income">
            Готово. Данные снова на месте — окно можно закрыть.
          </p>
        )}
      </div>

      <p className="text-xs text-muted">
        Заодно загляните в Дзен-мани: число операций там должно совпасть с тем,
        что было в снимке.
      </p>
    </>
  );
}
