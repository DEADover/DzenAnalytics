import { useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ClipboardCheck,
  CloudUpload,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { formatNum } from "../lib/format";
import { pluralRu } from "../lib/plural";
import type { CleanupProgress, CleanupResult } from "../lib/accountCleanup";
import type { RestorePreflight } from "../lib/restorePreflight";

/**
 * Откат на снимок — по одному шагу за раз (issue #93).
 *
 * Раньше здесь лежал список из пяти пунктов со всеми пояснениями сразу, и это
 * была стена текста: человек, пришедший вернуть свои данные, читал заодно и то,
 * что ему сейчас не нужно.
 *
 * Теперь шаг ровно один, а какой — мастер определяет САМ, по состоянию
 * аккаунта: пока в нём есть операции, показывается очистка; остались
 * справочники — уборка; чисто — заливка. Поэтому кнопки «назад» здесь нет:
 * вернуться значит просто сверить заново.
 *
 * ПОЧЕМУ ИМЕННО ТАКОЙ ПОРЯДОК. Снимок заливается под новыми номерами (под
 * прежними Дзен-мани молча не пускает обратно удалённые строки), а значит
 * ничего не перезаписывает и ложится рядом. Отсюда требование пустого
 * аккаунта — и весь порядок шагов.
 */

type StepId = "check" | "clear" | "dictionaries" | "restore" | "done";

const STEPS: { id: StepId; title: string }[] = [
  { id: "check", title: "Сверка" },
  { id: "clear", title: "Очистка" },
  { id: "dictionaries", title: "Справочники" },
  { id: "restore", title: "Заливка" },
];

export function RestoreWizard({
  preflight,
  snapshotDate,
  restored,
  busyOp,
  cleanupProgress,
  cleanupResult,
  disabled,
  onCheck,
  onCleanup,
  onRestore,
}: {
  /** Итог последней сверки; null — ещё не сверяли. */
  preflight: RestorePreflight | null;
  /** Дата снимка, с которым идёт работа. */
  snapshotDate: string | null;
  /** Заливка уже прошла — показываем итоговый шаг. */
  restored: boolean;
  busyOp: "snapshot" | "import" | "check" | "restore" | "cleanup" | null;
  cleanupProgress: CleanupProgress | null;
  cleanupResult: CleanupResult | null;
  disabled: boolean;
  onCheck: () => void;
  onCleanup: () => void;
  onRestore: () => void;
}) {
  const [open, setOpen] = useState(false);

  const step: StepId = restored
    ? "done"
    : !preflight
      ? "check"
      : preflight.blockers.some((b) => b.kind === "notEmpty")
        ? "clear"
        : preflight.blockers.length > 0
          ? "dictionaries"
          : "restore";

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="btn-ghost text-sm inline-flex items-center gap-2"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        Откатиться на снимок
      </button>
    );
  }

  const activeIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="rounded-xl border border-border bg-panel2/30 p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Откат на снимок</div>
          {snapshotDate && (
            <div className="text-xs text-muted mt-0.5 truncate">
              Снимок от {snapshotDate}
            </div>
          )}
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-muted hover:text-text shrink-0"
        >
          Свернуть
        </button>
      </div>

      {/* Полоска шагов: где мы и сколько осталось. */}
      <ol className="flex items-start gap-1.5">
        {STEPS.map((s, i) => {
          const passed = step === "done" || i < activeIndex;
          const current = i === activeIndex && step !== "done";
          return (
            <li key={s.id} className="flex-1 min-w-0">
              <div
                className={`h-1 rounded-full ${
                  passed ? "bg-income" : current ? "bg-accent" : "bg-border"
                }`}
              />
              <div
                className={`text-[11px] mt-1 truncate ${
                  current ? "text-text font-medium" : "text-muted"
                }`}
              >
                {s.title}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="text-xs space-y-2">
        {step === "check" && (
          <Body title="Посмотрим, что сейчас в аккаунте">
            <p>
              Сверка считает по уже загруженным данным и ничего никуда не
              отправляет. Она покажет, можно ли заливать снимок прямо сейчас.
            </p>
            <Action
              onClick={onCheck}
              busy={busyOp === "check"}
              disabled={disabled}
              icon={<ClipboardCheck className="w-3.5 h-3.5" />}
              label="Сверить"
              busyLabel="Сверяю…"
            />
          </Body>
        )}

        {step === "clear" && preflight && (
          <Body title="Очистите аккаунт в Дзен-мани">
            <Blocker preflight={preflight} kind="notEmpty" />
            <p>
              В приложении: <strong>Ещё → Настройки аккаунта → Начать всё
              сначала</strong>. На сайте — то же в настройках профиля. Аккаунт не
              удаляется; операции и счета стираются насовсем.
            </p>
            <p className="text-muted">
              До облака очистка доходит не сразу — обычно за пару минут. Счёт
              «Долги» её переживает, так и должно быть. Отсюда очистку сделать
              нельзя: в Дзен-мани нет такой команды для сторонних программ.
            </p>
            <Action
              onClick={onCheck}
              busy={busyOp === "check"}
              disabled={disabled}
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              label="Проверить ещё раз"
              busyLabel="Проверяю…"
            />
          </Body>
        )}

        {step === "dictionaries" && preflight && (
          <Body title="Уберите категории и контрагентов">
            <Blocker preflight={preflight} kind="leftoverTags" />
            <Blocker preflight={preflight} kind="leftoverMerchants" />
            <p>
              «Начать всё сначала» их не уносит, и после заливки они остались бы
              лишними рядом со своими из снимка.
            </p>
            <p className="text-muted">
              Категории удаляются медленно — Дзен-мани обходит ссылающиеся
              операции. Несколько минут на полсотни это нормально.
            </p>
            <Action
              onClick={onCleanup}
              busy={busyOp === "cleanup"}
              disabled={disabled}
              icon={<Trash2 className="w-3.5 h-3.5" />}
              label="Убрать"
              busyLabel="Убираю…"
              tone="warn"
            />
            {cleanupProgress && cleanupProgress.phase !== "done" && (
              <div className="text-muted tabular-nums">
                {cleanupProgress.phase === "tags" ? "Категории" : "Контрагенты"}:{" "}
                {formatNum(cleanupProgress.current)} из{" "}
                {formatNum(cleanupProgress.total)}
              </div>
            )}
            {cleanupResult && <CleanupSummary result={cleanupResult} />}
          </Body>
        )}

        {step === "restore" && (
          <Body title="Всё готово — можно заливать">
            <p className="text-income flex items-start gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>
                Операций и справочников в аккаунте нет: снимку не с чем
                сталкиваться.
              </span>
            </p>
            <p className="text-muted">
              Снимок зальётся под новыми номерами, поэтому привязка операций к
              банковским выпискам не сохранится. На суммы и аналитику это не
              влияет.
            </p>
            <Action
              onClick={onRestore}
              busy={busyOp === "restore"}
              disabled={disabled}
              icon={<CloudUpload className="w-3.5 h-3.5" />}
              label="Залить снимок"
              busyLabel="Заливаю…"
              tone="warn"
            />
          </Body>
        )}

        {step === "done" && (
          <Body title="Готово">
            <p className="text-income flex items-start gap-1.5">
              <Check className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>Снимок отправлен в Дзен-мани.</span>
            </p>
            <p>
              Сделайте полную синхронизацию (⤓ в шапке) и сравните числа:
              операций должно стать столько же, сколько было в снимке. Отчёт о
              заливке считает отправленное, а не принятое, — верить надо
              синхронизации.
            </p>
          </Body>
        )}
      </div>
    </div>
  );
}

function Body({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-text">{title}</div>
      {children}
    </div>
  );
}

/** Показать препятствие сверки — то, ради которого мы на этом шаге. */
function Blocker({ preflight, kind }: { preflight: RestorePreflight; kind: string }) {
  const b = preflight.blockers.find((x) => x.kind === kind);
  if (!b) return null;
  return (
    <p className="flex items-start gap-1.5 text-warn">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
      <span>{b.text}</span>
    </p>
  );
}

function Action({
  onClick,
  busy,
  disabled,
  icon,
  label,
  busyLabel,
  tone,
}: {
  onClick: () => void;
  busy: boolean;
  disabled: boolean;
  icon: React.ReactNode;
  label: string;
  busyLabel: string;
  tone?: "warn";
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className={`btn-ghost text-xs inline-flex items-center gap-2 ${
        tone === "warn" ? "!text-warn hover:!bg-warn/10" : ""
      }`}
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
      {busy ? busyLabel : label}
    </button>
  );
}

/** Итог уборки. Частичный успех показываем как есть — повторный запуск доснесёт. */
function CleanupSummary({ result }: { result: CleanupResult }) {
  const ok = result.failures.length === 0;
  return (
    <div className="space-y-1">
      <div className={`flex items-start gap-1.5 ${ok ? "text-income" : "text-warn"}`}>
        {ok ? (
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-px" />
        ) : (
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
        )}
        <span>
          Убрано: {formatNum(result.tags)}{" "}
          {pluralRu(result.tags, ["категория", "категории", "категорий"])} и{" "}
          {formatNum(result.merchants)}{" "}
          {pluralRu(result.merchants, ["контрагент", "контрагента", "контрагентов"])}.
        </span>
      </div>
      {!ok && (
        <div className="text-muted">
          Не прошло {formatNum(result.failures.length)}{" "}
          {pluralRu(result.failures.length, ["партия", "партии", "партий"])} — это
          бывает на больших аккаунтах. Уже убранное не пострадало: нажмите ещё раз,
          остаток доснесётся.
        </div>
      )}
    </div>
  );
}
