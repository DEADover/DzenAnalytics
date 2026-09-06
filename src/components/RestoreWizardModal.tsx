import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  History,
  Info,
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
  // Ушли ли дальше выбора снимка. Раньше шаг выводился только из сверки, и
  // «Далее» сразу её запускало: человек попадал на «Подготовку» уже с
  // результатом, не успев прочитать, что вообще надо сделать.
  const [entered, setEntered] = useState(false);
  const [accepted, setAccepted] = useState(false);
  // Когда в последний раз нажимали «Проверить»: между нажатиями проходят
  // минуты (очистка доходит до облака не мгновенно), и без отметки времени
  // непонятно, свежий ли перед тобой ответ.
  const [checkedTs, setCheckedTs] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = busyOp !== null;

  const chosen = snapshots.find((s) => s.id === pickedId) ?? snapshots[0] ?? null;
  const chosenId = chosen?.id ?? null;
  const fresh = preflight && preflightId === chosenId ? preflight : null;
  // На «Подготовке» два разных положения: аккаунт ещё не очищен — или очищен, и
  // остались только справочники. Вопросы разные, и текст тоже.
  const dictionariesOnly =
    !!fresh && !fresh.ready && !fresh.blockers.some((b) => b.kind === "notEmpty");
  const checkedAt = checkedTs
    ? new Date(checkedTs).toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;

  const step: Step = restored
    ? "done"
    : !entered
      ? "pick"
      : fresh?.ready
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
                <Upload className="w-3.5 h-3.5" />
                {busyOp === "import" ? "Загружаю…" : "Загрузить файл"}
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

          {step === "prepare" && (
            <>
              {/* Пока сверка не нажата, показываем ЧТО НАДО СДЕЛАТЬ. Раньше
                  «Далее» само запускало проверку, и человек первым делом читал
                  её вывод про свои 7 660 операций, ещё не поняв, зачем он тут. */}
              {!dictionariesOnly && (
                <>
                  <p>
                    Перед восстановлением аккаунт в Дзен-мани нужно полностью
                    очистить — иначе снимок не заменит нынешние данные, а
                    добавится к ним, и всё задвоится.
                  </p>
                  <p>
                    Откройте Дзен-мани и выберите{" "}
                    <strong>Ещё → Настройки аккаунта → Начать всё сначала</strong>.
                    На сайте то же самое в настройках профиля.
                  </p>
                  <div className="flex items-start gap-2 p-3 rounded-xl border border-accent/30 bg-accent/5">
                    <Info className="w-4 h-4 shrink-0 mt-0.5 text-accent" />
                    <span className="text-xs">
                      Очистка доходит до облака не сразу — это может занять до
                      пяти минут. Счёт «Долги» после неё остаётся: он у вас один
                      и удалить его нельзя, снимок с ним сойдётся.
                    </span>
                  </div>
                  {fresh && (
                    <div className="flex items-start gap-2 text-warn">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span className="text-text">
                        {fresh.blockers.find((b) => b.kind === "notEmpty")?.text ??
                          "Аккаунт ещё не пуст."}
                      </span>
                    </div>
                  )}
                </>
              )}

              {dictionariesOnly && fresh && (
                <>
                  <p>
                    Аккаунт очищен, но категории и контрагенты в Дзен-мани
                    остались: команда «Начать всё сначала» их не удаляет.
                  </p>
                  <p className="text-xs text-muted">
                    Если их не удалить, после восстановления рядом с категориями
                    из снимка окажутся нынешние — одинаковые по названию, но
                    разные для Дзен-мани.
                  </p>
                  <ul className="space-y-1">
                    {fresh.blockers.map((b) => (
                      <li key={b.kind} className="flex items-start gap-2 text-warn">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span className="text-text">{b.text}</span>
                      </li>
                    ))}
                  </ul>
                  {cleanupProgress && cleanupProgress.phase !== "done" ? (
                    <div className="space-y-1">
                      <p className="text-xs text-muted tabular-nums">
                        {cleanupProgress.phase === "tags"
                          ? "Удаляю категории"
                          : "Удаляю контрагентов"}
                        : {formatNum(cleanupProgress.current)} из{" "}
                        {formatNum(cleanupProgress.total)}
                      </p>
                      <div className="h-1 rounded-full bg-border overflow-hidden">
                        <div
                          className="h-full bg-accent transition-all"
                          style={{
                            width: `${cleanupProgress.total > 0 ? Math.round((cleanupProgress.current / cleanupProgress.total) * 100) : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted">
                      Удаление идёт небыстро: Дзен-мани проверяет каждую
                      категорию по всем операциям. На несколько десятков уйдёт
                      несколько минут — окно можно не закрывать.
                    </p>
                  )}
                  {cleanupResult && cleanupResult.failures.length > 0 && (
                    <p className="text-xs text-warn">
                      Часть удалить не удалось. Нажмите ещё раз — остаток
                      удалится, уже удалённое не пострадает.
                    </p>
                  )}
                </>
              )}

              {checkedAt && (
                <p className="text-xs text-muted">Проверено в {checkedAt}</p>
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

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border">
          {/* Назад — чтобы можно было вернуться и выбрать другой снимок. */}
          <div>
            {step === "prepare" && (
              <button
                onClick={() => setEntered(false)}
                disabled={busy}
                className="btn-ghost text-sm"
              >
                Назад
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button onClick={onClose} disabled={busy} className="btn-ghost text-sm">
              {step === "done" ? "Закрыть" : "Отмена"}
            </button>

            {step === "pick" && (
              <button
                onClick={() => setEntered(true)}
                disabled={busy || !chosen}
                className="btn-primary text-sm"
              >
                Далее
              </button>
            )}

            {step === "prepare" && (
              <button
                onClick={() => {
                  if (!chosen) return;
                  if (dictionariesOnly) {
                    onCleanup();
                  } else {
                    setCheckedTs(Date.now());
                    onCheck(chosen.id);
                  }
                }}
                disabled={busy}
                className="btn-primary text-sm"
              >
                {/* Ширина кнопки не пляшет: подпись меняется целиком, а
                    крутилку не подставляем сбоку — от неё кнопки раздвигались
                    на долю секунды и дёргали весь ряд. */}
                {busyOp === "cleanup"
                  ? "Удаление данных…"
                  : busyOp === "check"
                    ? "Проверяю…"
                    : dictionariesOnly
                      ? "Удалить данные"
                      : "Проверить"}
              </button>
            )}

            {step === "confirm" && chosen && (
              <button
                onClick={() => onRestore(chosen)}
                disabled={busy || !accepted}
                className="btn-primary text-sm !bg-warn hover:!bg-warn/90"
              >
                {busyOp === "restore" ? "Восстанавливаю…" : "Восстановить"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
