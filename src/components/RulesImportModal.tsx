import { useMemo, useState } from "react";
import { Upload } from "lucide-react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "./Modal";
import { Segmented } from "./Segmented";
import { Callout } from "./Callout";
import {
  planRulesImport,
  useCategoryRulesStore,
  type RulesImportMode,
  type RulesImportPlan,
} from "../store/useCategoryRulesStore";
import type { RulesFileParse } from "../lib/rulesTransfer";
import { formatNum } from "../lib/format";
import { pluralRu } from "../lib/plural";

const RULES: [string, string, string] = ["правило", "правила", "правил"];
const n = (count: number) => `${formatNum(count)} ${pluralRu(count, RULES)}`;

/**
 * Импорт правил из JSON-файла. Файл уже прочитан и разобран
 * (`lib/rulesTransfer`); окно показывает, что из него получится, и пишет
 * только по кнопке.
 *
 * По умолчанию правила ДОБАВЛЯЮТСЯ к своим: так свои не пострадают, что бы
 * ни лежало в файле. Замена — отдельный выбор с предупреждением, сколько
 * правил уйдёт.
 */
export function RulesImportModal({
  fileName,
  parsed,
  onClose,
}: {
  fileName: string;
  parsed: RulesFileParse;
  onClose: () => void;
}) {
  const existing = useCategoryRulesStore((s) => s.rules);
  const importRules = useCategoryRulesStore((s) => s.importRules);
  const [mode, setMode] = useState<RulesImportMode>("add");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ plan: RulesImportPlan; mode: RulesImportMode } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plan = useMemo(
    () => (parsed.ok ? planRulesImport(existing, parsed.rules, mode) : null),
    [parsed, existing, mode]
  );

  async function run() {
    if (!parsed.ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      setDone({ plan: await importRules(parsed.rules, mode), mode });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const canRun = !!plan && plan.added > 0;

  return (
    <Modal onClose={onClose} busy={busy} width="lg">
      <ModalHeader
        icon={Upload}
        title="Импорт правил"
        subtitle={<span className="block truncate">{fileName}</span>}
      />

      <ModalBody>
        {!parsed.ok ? (
          <Callout tone="expense">{parsed.error}</Callout>
        ) : done ? (
          <Callout tone="income">
            {done.plan.added > 0
              ? `${done.mode === "replace" ? "Правила заменены" : "Добавлено"}: ${n(done.plan.added)}.`
              : "Все правила из файла уже есть — ничего не добавлено."}
            {done.plan.duplicates > 0 && ` Пропущены как повторы: ${formatNum(done.plan.duplicates)}.`}
            {done.mode === "add" && done.plan.added > 0 && " Новые правила — в конце списка."}
          </Callout>
        ) : (
          <>
            <div>
              <div className="label mb-2">Что сделать с текущими правилами</div>
              <Segmented
                block
                size="sm"
                label="Что сделать с текущими правилами"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "add", label: "Добавить к ним" },
                  { value: "replace", label: "Заменить все", disabled: existing.length === 0 },
                ]}
              />
            </div>

            {plan && (
              <ul className="space-y-1.5 text-sm">
                <li className="flex justify-between gap-3">
                  <span className="text-muted">Правил в файле</span>
                  <span className="tabular-nums">{formatNum(parsed.rules.length + parsed.invalid)}</span>
                </li>
                <li className="flex justify-between gap-3">
                  <span className="text-muted">
                    {mode === "replace" ? "Станет правил" : "Будет добавлено"}
                  </span>
                  <span className="tabular-nums font-medium">{formatNum(plan.added)}</span>
                </li>
                {plan.duplicates > 0 && (
                  <li className="flex justify-between gap-3">
                    <span className="text-muted">
                      {mode === "replace" ? "Повторы в файле — пропустим" : "Уже есть — пропустим"}
                    </span>
                    <span className="tabular-nums">{formatNum(plan.duplicates)}</span>
                  </li>
                )}
                {parsed.invalid > 0 && (
                  <li className="flex justify-between gap-3">
                    <span className="text-muted">Не удалось разобрать — пропустим</span>
                    <span className="tabular-nums text-warn">{formatNum(parsed.invalid)}</span>
                  </li>
                )}
              </ul>
            )}

            {mode === "replace" && existing.length > 0 && (
              <Callout tone="warn">
                Текущие правила ({formatNum(existing.length)}) будут удалены. Правки операций,
                которые правила уже записали, останутся.
              </Callout>
            )}
            {plan && plan.auto > 0 && (
              <Callout tone="accent">
                В режиме «Авто»: {n(plan.auto)}. Такие правила применяются при
                синхронизации без нажатия кнопки. Режим можно сменить в списке после импорта.
              </Callout>
            )}
            {error && <Callout tone="expense">Не удалось сохранить: {error}</Callout>}
          </>
        )}
      </ModalBody>

      <ModalFooter>
        <button type="button" className="btn-ghost text-sm" onClick={onClose} disabled={busy}>
          {parsed.ok && !done ? "Отмена" : "Закрыть"}
        </button>
        {parsed.ok && !done && (
          <button
            type="button"
            className={mode === "replace" ? "btn-danger text-sm" : "btn-primary text-sm"}
            onClick={() => void run()}
            disabled={!canRun || busy}
          >
            {!plan || plan.added === 0
              ? "Нечего импортировать"
              : mode === "replace"
                ? `Заменить на ${n(plan.added)}`
                : `Добавить ${n(plan.added)}`}
          </button>
        )}
      </ModalFooter>
    </Modal>
  );
}
