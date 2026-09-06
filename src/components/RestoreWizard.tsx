import { AlertTriangle, CheckCircle2, Loader2, Trash2 } from "lucide-react";
import { formatNum } from "../lib/format";
import { pluralRu } from "../lib/plural";
import type { CleanupProgress, CleanupResult } from "../lib/accountCleanup";

/**
 * Порядок действий для настоящего отката (issue #93).
 *
 * Одной кнопки «Восстановить» для отката мало, и раньше это выяснялось только
 * постфактум: заливка проходила без ошибок, отчёт рапортовал успех, а в
 * Дзен-мани не менялось ничего.
 *
 * Причина в том, как сервер обходится с удалённым. Проверено на живом API:
 * повторная отправка удалённой строки под её же id возвращает 200 без ошибки и
 * НЕ возвращает строку. Поэтому откат заливается под НОВЫМИ номерами — но
 * тогда он ничего не перезаписывает, а ложится рядом, и работает только в
 * пустой аккаунт.
 *
 * Отсюда порядок: очистить аккаунт средствами самого Дзен-мани, добрать то,
 * что его очистка не уносит (категории и контрагентов), и только потом
 * заливать. Второй шаг делается в самом Дзен-мани: у API нет метода «начать
 * сначала», и подменять его чем-то своим было бы враньём.
 */
export function RestoreWizard({
  onCleanup,
  progress,
  result,
  busy,
  disabled,
}: {
  onCleanup: () => void;
  progress: CleanupProgress | null;
  result: CleanupResult | null;
  busy: boolean;
  disabled: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-panel2/30 p-4 space-y-3">
      <div>
        <div className="text-sm font-medium">Как откатиться на снимок</div>
        <div className="text-xs text-muted mt-1">
          Снимок заливается под новыми номерами — иначе Дзен-мани молча не
          пускает обратно удалённые строки. Значит старое не заменяется, а
          остаётся рядом, и заливать нужно в пустой аккаунт. Порядок такой.
        </div>
      </div>

      <ol className="space-y-3 text-xs">
        <Step n={1} title="Сверьте снимок с аккаунтом">
          Кнопка «Сверить» у нужного снимка выше. Она ничего не отправляет и
          показывает, пуст ли аккаунт. «Аккаунт готов» — остальные шаги не
          нужны, сразу заливайте.
        </Step>

        <Step n={2} title="Очистите аккаунт в самом Дзен-мани">
          В приложении: <strong>Ещё → Настройки аккаунта → Начать всё сначала</strong>.
          На сайте — то же в настройках профиля. Аккаунт при этом не удаляется:
          операции и счета стираются насовсем, а не помечаются удалёнными.
          <div className="text-muted mt-1">
            До облака очистка доходит <strong>не сразу</strong> — обычно за пару
            минут. Если сверка ниже ещё показывает старые числа, подождите и
            нажмите «Сверить» снова.
          </div>
          <div className="text-muted mt-1">
            Счёт «Долги» очистку переживает — так и надо, он у вас ровно один, и
            снимок сведётся с ним. Отсюда очистку сделать нельзя: в API
            Дзен-мани такого метода нет.
          </div>
        </Step>

        <Step n={3} title="Уберите категории и контрагентов">
          «Начать всё сначала» их не трогает — они останутся в аккаунте и будут
          мешаться рядом с теми, что приедут из снимка. Снести их можно отсюда.
          Категории удаляются медленно (Дзен-мани обходит ссылающиеся операции),
          так что несколько минут на полсотни — это нормально.
          <div className="mt-2">
            <button
              onClick={onCleanup}
              disabled={busy || disabled}
              className="btn-ghost text-xs inline-flex items-center gap-2"
            >
              {busy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              {busy ? "Убираю…" : "Убрать категории и контрагентов"}
            </button>
          </div>
          {progress && progress.phase !== "done" && (
            <div className="mt-2 text-muted tabular-nums">
              {progress.phase === "tags" ? "Категории" : "Контрагенты"}:{" "}
              {formatNum(progress.current)} из {formatNum(progress.total)}
            </div>
          )}
          {result && <CleanupSummary result={result} />}
        </Step>

        <Step n={4} title="Залейте снимок">
          Кнопка «Восстановить в облако» у нужного снимка выше. После неё сверка
          станет показывать «заливать рано» — так и должно быть: аккаунт больше
          не пуст, и второй раз тот же снимок лить нельзя, он задвоится.
        </Step>

        <Step n={5} title="Проверьте, что получилось">
          Сделайте полную синхронизацию (⤓ в шапке) и посмотрите на числа: в
          аккаунте должно стать столько же операций, сколько было в снимке.
          Числа в отчёте о восстановлении — это отправленное, а не принятое, им
          верить нельзя.
        </Step>
      </ol>
    </div>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="shrink-0 w-5 h-5 rounded-full bg-panel border border-border flex items-center justify-center text-[11px] font-medium tabular-nums">
        {n}
      </span>
      <div className="min-w-0">
        <div className="font-medium text-text">{title}</div>
        <div className="text-muted mt-0.5">{children}</div>
      </div>
    </li>
  );
}

/** Итог уборки. Частичный успех показываем как есть — повторный запуск доснесёт. */
function CleanupSummary({ result }: { result: CleanupResult }) {
  const ok = result.failures.length === 0;
  return (
    <div className="mt-2 space-y-1">
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
          бывает на больших аккаунтах. Уже удалённое не пострадало: нажмите ещё раз,
          остаток доснесётся.
          <div className="mt-1">
            {result.failures.slice(0, 3).map((f, i) => (
              <div key={i} className="text-[11px]">
                {f.phase === "tags" ? "категории" : "контрагенты"} ×{f.size}: {f.reason}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
