import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatNum } from "../lib/format";
import type { EntityDelta, RestorePreflight } from "../lib/restorePreflight";

/**
 * Итог предполётной сверки снимка с аккаунтом (issue #93).
 *
 * Отвечает на один вопрос: если сейчас нажать «Восстановить», что из снимка
 * доедет, а что нет. До этого узнать было негде — заливка проходила, отчёт
 * говорил «восстановлено N», а в Дзен-мани не менялось ничего.
 */
export function RestorePreflightCard({ result }: { result: RestorePreflight }) {
  return (
    <div className="rounded-xl border border-border bg-panel2/40 p-3 text-xs space-y-3">
      <div
        className={`flex items-start gap-2 font-medium ${
          result.ready ? "text-income" : "text-warn"
        }`}
      >
        {result.ready ? (
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" />
        ) : (
          <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
        )}
        <span>
          {result.ready
            ? "Аккаунт готов — снимок ляжет целиком."
            : "Заливать рано: снимок ляжет рядом со старым."}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
        <Row label="Операции" d={result.transactions} />
        <Row label="Счета" d={result.accounts} />
        <Row label="Категории" d={result.tags} />
        <Row label="Контрагенты" d={result.merchants} />
      </div>

      {result.blockers.length > 0 && (
        <ul className="space-y-2">
          {result.blockers.map((b) => (
            <li key={b.kind} className="border-l-2 border-warn/60 pl-2.5">
              <div className="text-text">{b.text}</div>
              <div className="text-muted mt-0.5">{b.fix}</div>
            </li>
          ))}
        </ul>
      )}

      {result.ready && (
        <div className="text-muted">
          Аккаунт пуст — снимку не с чем сталкиваться, заливать можно.
        </div>
      )}
    </div>
  );
}

/** Одна колонка свода: сколько живого сейчас в аккаунте против снимка. */
function Row({ label, d }: { label: string; d: EntityDelta }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="tabular-nums">
        {formatNum(d.inAccount)}
        <span className="text-muted"> → </span>
        {formatNum(d.inSnapshot)}
      </div>
    </div>
  );
}
