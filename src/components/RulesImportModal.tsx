import { useMemo, useState } from "react";
import { Upload } from "lucide-react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "./Modal";
import { WizardSteps } from "./WizardSteps";
import { RulePickList, type RulePickItem } from "./RulePickList";
import { Segmented } from "./Segmented";
import { Callout } from "./Callout";
import { FactList } from "./FactList";
import {
  planRulesImport,
  ruleImportStatuses,
  useCategoryRulesStore,
  type RuleImportStatus,
  type RulesImportMode,
  type RulesImportPlan,
} from "../store/useCategoryRulesStore";
import {
  MODE_OVERRIDE_OPTIONS,
  countRuleModes,
  withRuleMode,
  type RuleModeOverride,
  type RulesFileParse,
} from "../lib/rulesTransfer";
import { formatNum } from "../lib/format";
import { pluralRu } from "../lib/plural";

const STEPS = [
  { id: "file", title: "Файл" },
  { id: "pick", title: "Правила" },
  { id: "check", title: "Проверка" },
  { id: "done", title: "Готово" },
] as const;

const RULES: [string, string, string] = ["правило", "правила", "правил"];
const n = (count: number) => `${formatNum(count)} ${pluralRu(count, RULES)}`;

const STATUS: Record<RuleImportStatus, NonNullable<RulePickItem["status"]>> = {
  new: { label: "Новое", tone: "accent" },
  exists: {
    label: "Уже есть",
    tone: "neutral",
    hint: "Такое же правило уже есть в списке — второй раз не добавится",
  },
  repeat: {
    label: "Повтор",
    tone: "neutral",
    hint: "Повторяет правило выше в этом же файле",
  },
};

/**
 * Мастер импорта правил из файла JSON (файл уже прочитан и разобран в
 * `lib/rulesTransfer`).
 *
 * 1. «Файл» — что в нём нашлось и что сделать со своими правилами: добавить к
 *    ним (по умолчанию — свои не пострадают) или заменить.
 * 2. «Правила» — какие взять. Такие, что уже есть, отметить нельзя: импорт их
 *    всё равно пропустил бы.
 * 3. «Проверка» — в каком режиме правила встанут и что получится в итоге.
 * 4. «Готово».
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
  const incoming = useMemo(() => (parsed.ok ? parsed.rules : []), [parsed]);

  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<RulesImportMode>("add");
  const [modeOverride, setModeOverride] = useState<RuleModeOverride>("keep");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RulesImportPlan | null>(null);

  // Пометки и сводка считаются по правилам, какими они были при открытии окна:
  // после записи список меняется, и «Новое» стало бы «Уже есть» прямо на
  // итоговом шаге.
  const [baseline] = useState(existing);
  const statuses = useMemo(
    () => ruleImportStatuses(baseline, incoming, mode),
    [baseline, incoming, mode]
  );
  const items = useMemo<RulePickItem[]>(
    () =>
      incoming.map((rule, i) => ({
        key: String(i),
        rule,
        status: STATUS[statuses[i]],
        disabled: statuses[i] !== "new",
      })),
    [incoming, statuses]
  );

  // Отмечено всё новое. Смена «добавить / заменить» меняет, что считается
  // новым, — отметки пересчитываются вместе с ней.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(items.filter((it) => !it.disabled).map((it) => it.key))
  );
  function changeMode(next: RulesImportMode) {
    setMode(next);
    const nextStatuses = ruleImportStatuses(baseline, incoming, next);
    setSelected(new Set(nextStatuses.flatMap((s, i) => (s === "new" ? [String(i)] : []))));
  }

  const picked = useMemo(
    () =>
      withRuleMode(
        incoming.filter((_, i) => statuses[i] === "new" && selected.has(String(i))),
        modeOverride
      ),
    [incoming, selected, statuses, modeOverride]
  );
  const plan = useMemo(() => planRulesImport(baseline, picked, mode), [baseline, picked, mode]);
  const counts = {
    new: statuses.filter((s) => s === "new").length,
    exists: statuses.filter((s) => s === "exists").length,
    repeat: statuses.filter((s) => s === "repeat").length,
  };
  const modes = countRuleModes(picked);

  async function run() {
    if (busy || picked.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await importRules(picked, mode));
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const done = step === 3;

  return (
    <Modal onClose={onClose} busy={busy} width="2xl">
      <ModalHeader
        icon={Upload}
        title="Импорт правил"
        subtitle={<span className="block truncate">{fileName}</span>}
      />
      {parsed.ok && <WizardSteps steps={STEPS} active={step} done={done} />}

      <ModalBody scroll gap={3} className="text-sm max-h-[60vh]">
        {!parsed.ok && <Callout tone="expense">{parsed.error}</Callout>}

        {parsed.ok && step === 0 && (
          <>
            <FactList
              facts={[
                {
                  label: "Правил в файле",
                  value: formatNum(incoming.length + parsed.invalid),
                  strong: true,
                },
                { label: "Новых", value: formatNum(counts.new) },
                ...(counts.exists > 0
                  ? [{ label: "Уже есть в списке", value: formatNum(counts.exists) }]
                  : []),
                ...(counts.repeat > 0
                  ? [{ label: "Повторяются в файле", value: formatNum(counts.repeat) }]
                  : []),
                ...(parsed.invalid > 0
                  ? [
                      {
                        label: "Не удалось разобрать",
                        value: formatNum(parsed.invalid),
                        tone: "warn" as const,
                      },
                    ]
                  : []),
              ]}
            />
            {parsed.invalid > 0 && (
              <Callout tone="warn">
                Не удалось разобрать: {n(parsed.invalid)} — с непонятным условием
                или действием, из более новой версии или поправленные вручную. Их
                пропустим целиком: без части условий правило ловило бы лишние
                операции.
              </Callout>
            )}

            <div>
              <div className="label mb-2">Что сделать с текущими правилами</div>
              <Segmented
                block
                size="sm"
                label="Что сделать с текущими правилами"
                value={mode}
                onChange={changeMode}
                options={[
                  { value: "add", label: "Добавить к ним" },
                  { value: "replace", label: "Заменить все", disabled: baseline.length === 0 },
                ]}
              />
              <p className="text-xs text-muted mt-2">
                {mode === "add"
                  ? `Ваши правила (${formatNum(baseline.length)}) останутся как есть, новые встанут в конец списка.`
                  : `Ваши правила (${formatNum(baseline.length)}) удалятся, останутся только выбранные из файла.`}
              </p>
            </div>
          </>
        )}

        {parsed.ok && step === 1 && (
          <>
            <p className="text-muted">
              Отметьте правила, которые нужно взять из файла.
              {counts.exists + counts.repeat > 0 &&
                " Помеченные «Уже есть» и «Повтор» отметить нельзя — второй раз они не добавятся."}
            </p>
            <RulePickList items={items} selected={selected} onChange={setSelected} />
          </>
        )}

        {parsed.ok && step === 2 && (
          <>
            <div>
              <div className="label mb-2">Режим импортированных правил</div>
              <Segmented
                block
                size="sm"
                label="Режим импортированных правил"
                value={modeOverride}
                onChange={setModeOverride}
                options={MODE_OVERRIDE_OPTIONS}
              />
              <p className="text-xs text-muted mt-2">
                {modeOverride === "keep"
                  ? "Каждое правило встанет в режиме из файла."
                  : modeOverride === "manual"
                    ? "Правила будут работать только по кнопке «Проверить и применить» — сначала можно посмотреть, что они изменят."
                    : "Правила встанут выключенными — включите нужные в списке."}
              </p>
            </div>

            <FactList
              facts={[
                { label: "Добавится правил", value: formatNum(plan.added), strong: true },
                { label: "По кнопке", value: formatNum(modes.manual) },
                {
                  label: "Авто",
                  value: formatNum(modes.auto),
                  tone: modes.auto > 0 ? "warn" : undefined,
                },
                { label: "Выключены", value: formatNum(modes.off) },
                mode === "add"
                  ? { label: "Ваши правила", value: `${formatNum(baseline.length)} — без изменений` }
                  : {
                      label: "Ваши правила",
                      value: `${formatNum(baseline.length)} — удалятся`,
                      tone: "expense",
                    },
                { label: "Станет всего", value: formatNum(plan.rules.length), strong: true },
              ]}
            />

            {mode === "replace" && (
              <Callout tone="warn">
                Текущие правила ({formatNum(baseline.length)}) удалятся. Правки
                операций, которые они уже записали, останутся.
              </Callout>
            )}
            {modes.auto > 0 && (
              <Callout tone="accent">
                В режиме «Авто»: {n(modes.auto)}. Такие правила применяются при
                синхронизации без нажатия кнопки.
              </Callout>
            )}
            {error && <Callout tone="expense">Не удалось сохранить: {error}</Callout>}
          </>
        )}

        {parsed.ok && done && result && (
          <Callout tone="income">
            {mode === "replace" ? "Правила заменены" : "Добавлено"}: {n(result.added)}.
            {mode === "add" && " Новые правила — в конце списка."}
            {modes.auto > 0 && ` В режиме «Авто»: ${formatNum(modes.auto)}.`}
          </Callout>
        )}
      </ModalBody>

      <ModalFooter justify="between">
        <div>
          {parsed.ok && (step === 1 || step === 2) && (
            <button
              type="button"
              className="btn-ghost text-sm"
              onClick={() => setStep(step - 1)}
              disabled={busy}
            >
              Назад
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-ghost text-sm" onClick={onClose} disabled={busy}>
            {!parsed.ok || done ? "Закрыть" : "Отмена"}
          </button>
          {parsed.ok && step === 0 && (
            <button
              type="button"
              className="btn-primary text-sm"
              disabled={counts.new === 0}
              onClick={() => setStep(1)}
            >
              {counts.new === 0 ? "Нечего импортировать" : "Далее"}
            </button>
          )}
          {parsed.ok && step === 1 && (
            <button
              type="button"
              className="btn-primary text-sm"
              disabled={picked.length === 0}
              onClick={() => setStep(2)}
            >
              {picked.length === 0 ? "Отметьте правила" : "Далее"}
            </button>
          )}
          {parsed.ok && step === 2 && (
            <button
              type="button"
              className={mode === "replace" ? "btn-danger text-sm" : "btn-primary text-sm"}
              disabled={busy || plan.added === 0}
              onClick={() => void run()}
            >
              {mode === "replace" ? `Заменить на ${n(plan.added)}` : `Добавить ${n(plan.added)}`}
            </button>
          )}
        </div>
      </ModalFooter>
    </Modal>
  );
}
