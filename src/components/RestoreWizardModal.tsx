import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  History,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { formatNum } from "../lib/format";
import { pluralRu } from "../lib/plural";
import { snapshotSummary } from "../lib/snapshotLabel";
import { InfoPopover } from "./InfoPopover";
import type { CloudSnapshotSummary } from "../lib/cloudSnapshots";
import type { CleanupProgress, CleanupResult } from "../lib/accountCleanup";
import type { RestorePreflight } from "../lib/restorePreflight";

/**
 * Восстановление из снимка — мастером в отдельном окне (issue #93).
 *
 * На экране настроек это была простыня: список снимков, свод сверки, пять
 * пунктов порядка действий со всеми пояснениями сразу. Человек, пришедший
 * вернуть свои данные, читал заодно и то, что ему сейчас не нужно.
 *
 * Здесь за раз показывается один шаг и один вопрос. Объяснения «почему так»
 * убраны под знаки вопроса: они нужны один раз и не всем, а место занимали
 * всегда.
 *
 * Шаг определяется СОСТОЯНИЕМ аккаунта, а не нажатиями «далее»: пока в нём
 * есть операции, показывается очистка; остались справочники — уборка; чисто —
 * заливка. Кнопки «назад» нет: вернуться значит сверить заново.
 */

type Step = "pick" | "prepare" | "confirm" | "done";

const STEPS: { id: Step; title: string }[] = [
  { id: "pick", title: "Снимок" },
  { id: "prepare", title: "Подготовка" },
  { id: "confirm", title: "Заливка" },
  { id: "done", title: "Готово" },
];

export function RestoreWizardModal({
  snapshots,
  preflight,
  preflightId,
  restored,
  busyOp,
  cleanupProgress,
  cleanupResult,
  error,
  onCheck,
  onCleanup,
  onRestore,
  onImportFile,
  onClose,
}: {
  snapshots: CloudSnapshotSummary[];
  preflight: RestorePreflight | null;
  /** Снимок, к которому относится сверка. */
  preflightId: string | null;
  restored: boolean;
  busyOp: "snapshot" | "import" | "check" | "restore" | "cleanup" | null;
  cleanupProgress: CleanupProgress | null;
  cleanupResult: CleanupResult | null;
  error: string | null;
  onCheck: (id: string) => void;
  onCleanup: () => void;
  onRestore: (s: CloudSnapshotSummary) => void;
  onImportFile: (file: File) => void;
  onClose: () => void;
}) {
  // Выбор — не состояние, а предпочтение поверх списка: пока человек ничего не
  // трогал (или загрузил файл), берём самый свежий снимок. Так подгруженный
  // файл выбирается сам, без эффекта, который правил бы состояние после
  // отрисовки.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = busyOp !== null;

  const chosen = snapshots.find((s) => s.id === pickedId) ?? snapshots[0] ?? null;
  const chosenId = chosen?.id ?? null;
  const fresh = preflight && preflightId === chosenId ? preflight : null;

  const step: Step = restored
    ? "done"
    : !fresh
      ? "pick"
      : fresh.ready
        ? "confirm"
        : "prepare";

  const activeIndex = STEPS.findIndex((s) => s.id === step);

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="restore-wizard-title"
        className="w-full max-w-lg rounded-2xl border border-border bg-panel shadow-2xl outline-none"
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
          {STEPS.map((s, i) => (
            <li key={s.id} className="flex-1 min-w-0">
              <div
                className={`h-1 rounded-full ${
                  i < activeIndex ? "bg-income" : i === activeIndex ? "bg-accent" : "bg-border"
                }`}
              />
              <div
                className={`text-[11px] mt-1 truncate ${
                  i === activeIndex ? "text-text font-medium" : "text-muted"
                }`}
              >
                {s.title}
              </div>
            </li>
          ))}
        </ol>

        <div className="px-5 py-4 text-sm space-y-3 max-h-[60vh] overflow-y-auto">
          {step === "pick" && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="font-medium">Что восстанавливаем</span>
                <InfoPopover label="Как это работает">
                  <p>
                    Снимок заливается обратно в Дзен-мани <strong>под новыми
                    номерами</strong>: под прежними сервис не пускает обратно
                    удалённые строки — принимает запрос и молча ничего не меняет.
                  </p>
                  <p>
                    Отсюда всё остальное. Снимок ничего не перезаписывает, а
                    ложится рядом, поэтому аккаунт должен быть пуст — иначе
                    данные задвоятся. И поэтому же теряется привязка операций к
                    банковским выпискам: строки заводятся заново.
                  </p>
                </InfoPopover>
              </div>

              {snapshots.length === 0 ? (
                <p className="text-muted">
                  Снимков нет. Загрузите файл, который скачивали раньше.
                </p>
              ) : (
                <div className="space-y-1">
                  {snapshots.map((s) => (
                    <label
                      key={s.id}
                      className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer ${
                        chosenId === s.id
                          ? "border-accent bg-accent/5"
                          : "border-border hover:bg-panel2/60"
                      }`}
                    >
                      <input
                        type="radio"
                        name="snapshot"
                        checked={chosenId === s.id}
                        onChange={() => setPickedId(s.id)}
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

              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="btn-ghost text-xs inline-flex items-center gap-2"
              >
                {busyOp === "import" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                Загрузить файл
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  // Сбрасываем выбор: загруженный файл встаёт первым и
                  // становится выбранным сам.
                  if (f) {
                    setPickedId(null);
                    onImportFile(f);
                  }
                  e.target.value = "";
                }}
              />
            </>
          )}

          {step === "prepare" && fresh && (
            <>
              {/* Показываем только то препятствие, которым заняты СЕЙЧАС.
                  Пока в аккаунте операции, справочники не к спеху, а три
                  предупреждения разом читаются как «всё плохо». */}
              {(fresh.blockers.some((b) => b.kind === "notEmpty")
                ? fresh.blockers.filter((b) => b.kind === "notEmpty")
                : fresh.blockers
              ).map((b) => (
                <div key={b.kind} className="flex items-start gap-2 text-warn">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="text-text">{b.text}</span>
                </div>
              ))}

              {fresh.blockers.some((b) => b.kind === "notEmpty") ? (
                <div className="space-y-2">
                  <p>
                    Очистите аккаунт в Дзен-мани:{" "}
                    <strong>Ещё → Настройки аккаунта → Начать всё сначала</strong>.
                  </p>
                  <p className="text-xs text-muted">
                    До облака доходит за пару минут. Счёт «Долги» остаётся — так и надо.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted">
                    «Начать всё сначала» их не уносит. Удаление категорий идёт
                    медленно — несколько минут на полсотни.
                  </p>
                  {cleanupProgress && cleanupProgress.phase !== "done" && (
                    <p className="text-xs text-muted tabular-nums">
                      {cleanupProgress.phase === "tags" ? "Категории" : "Контрагенты"}:{" "}
                      {formatNum(cleanupProgress.current)} из{" "}
                      {formatNum(cleanupProgress.total)}
                    </p>
                  )}
                  {cleanupResult && cleanupResult.failures.length > 0 && (
                    <p className="text-xs text-muted">
                      Часть партий не прошла — нажмите ещё раз, остаток доснесётся.
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {step === "confirm" && chosen && (
            <>
              <div className="flex items-start gap-2 text-income">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="text-text">Аккаунт пуст — можно заливать.</span>
              </div>
              <p className="text-xs text-muted">
                В Дзен-мани уйдёт {formatNum(chosen.counts.transactions)}{" "}
                {pluralRu(chosen.counts.transactions, [
                  "операция",
                  "операции",
                  "операций",
                ])}
                , {chosen.counts.accounts}{" "}
                {pluralRu(chosen.counts.accounts, ["счёт", "счёта", "счетов"])},{" "}
                {chosen.counts.tags}{" "}
                {pluralRu(chosen.counts.tags, ["категория", "категории", "категорий"])}
                , {chosen.counts.merchants}{" "}
                {pluralRu(chosen.counts.merchants, [
                  "контрагент",
                  "контрагента",
                  "контрагентов",
                ])}
                .
              </p>

              {/* Предупреждение об ответственности — галочкой, а не абзацем:
                  прочитанным считается то, что человек подтвердил, а не то,
                  мимо чего он проскроллил. */}
              <label className="flex items-start gap-2.5 p-3 rounded-xl border border-warn/40 bg-warn/5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                  className="mt-0.5 shrink-0"
                />
                <span className="text-xs">
                  Отменить восстановление нельзя. Данные в Дзен-мани — ваши, и
                  отвечаете за них тоже вы: DzenAnalytics ответственности за
                  результат не несёт. Убедитесь, что снимок сохранён файлом.
                </span>
              </label>
            </>
          )}

          {step === "done" && (
            <>
              <div className="flex items-start gap-2 text-income">
                <Check className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="text-text">Снимок отправлен в Дзен-мани.</span>
              </div>
              <p className="text-xs text-muted">
                Сделайте полную синхронизацию (⤓ в шапке) и сверьте числа: операций
                должно стать столько же, сколько в снимке.
              </p>
            </>
          )}

          {error && (
            <div className="flex items-start gap-2 text-expense text-xs">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button onClick={onClose} disabled={busy} className="btn-ghost text-sm">
            {step === "done" ? "Закрыть" : "Отмена"}
          </button>

          {step === "pick" && (
            <button
              onClick={() => chosen && onCheck(chosen.id)}
              disabled={busy || !chosen}
              className="btn-primary text-sm inline-flex items-center gap-2"
            >
              {busyOp === "check" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Далее
            </button>
          )}

          {step === "prepare" && fresh && (
            <button
              onClick={() =>
                fresh.blockers.some((b) => b.kind === "notEmpty")
                  ? chosen && onCheck(chosen.id)
                  : onCleanup()
              }
              disabled={busy}
              className="btn-primary text-sm inline-flex items-center gap-2"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {fresh.blockers.some((b) => b.kind === "notEmpty")
                ? "Проверить"
                : "Убрать и продолжить"}
            </button>
          )}

          {step === "confirm" && chosen && (
            <button
              onClick={() => onRestore(chosen)}
              disabled={busy || !accepted}
              className="btn-primary text-sm inline-flex items-center gap-2 !bg-warn hover:!bg-warn/90"
            >
              {busyOp === "restore" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Восстановить
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
