import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "./Modal";
import { WizardSteps } from "./WizardSteps";
import { RulePickList, type RulePickItem } from "./RulePickList";
import { Segmented } from "./Segmented";
import { Callout } from "./Callout";
import { FactList } from "./FactList";
import type { StoredCategoryRule } from "../store/useCategoryRulesStore";
import {
  buildRulesFile,
  countRuleModes,
  rulesFileName,
  MODE_OVERRIDE_OPTIONS,
  withRuleMode,
  type RuleModeOverride,
} from "../lib/rulesTransfer";
import { downloadBlob } from "../lib/downloadBlob";
import { formatNum } from "../lib/format";
import { pluralRu } from "../lib/plural";

const STEPS = [
  { id: "pick", title: "Правила" },
  { id: "file", title: "Файл" },
  { id: "done", title: "Готово" },
] as const;

const RULES: [string, string, string] = ["правило", "правила", "правил"];
const n = (count: number) => `${formatNum(count)} ${pluralRu(count, RULES)}`;

/**
 * Мастер экспорта правил: отобрать правила, решить, в каком режиме они
 * уедут, и скачать файл.
 *
 * Отбор по умолчанию — все правила: чаще всего переносят всё. Режим в файле
 * по умолчанию «как сейчас»; «по кнопке» — для файла другому человеку, чтобы
 * правила не начали сами размечать его операции.
 */
export function RulesExportModal({
  rules,
  onClose,
}: {
  rules: readonly StoredCategoryRule[];
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(rules.map((r) => r.id)));
  const [modeOverride, setModeOverride] = useState<RuleModeOverride>("keep");
  const [savedName, setSavedName] = useState<string | null>(null);

  const items = useMemo<RulePickItem[]>(() => rules.map((rule) => ({ key: rule.id, rule })), [rules]);
  const picked = useMemo(() => rules.filter((r) => selected.has(r.id)), [rules, selected]);
  const outgoing = useMemo(() => withRuleMode(picked, modeOverride), [picked, modeOverride]);
  const modes = countRuleModes(outgoing);
  const scheduled = outgoing.filter((r) => r.autoApply && r.enabled && r.schedule).length;
  const fileName = rulesFileName(new Date());

  function download() {
    const now = new Date();
    const name = rulesFileName(now);
    downloadBlob(
      new Blob([JSON.stringify(buildRulesFile(outgoing, now), null, 2)], {
        type: "application/json",
      }),
      name
    );
    setSavedName(name);
    setStep(2);
  }

  return (
    <Modal onClose={onClose} width="2xl">
      <ModalHeader icon={Download} title="Экспорт правил" subtitle="Файл JSON — для другого устройства или человека" />
      <WizardSteps steps={STEPS} active={step} done={step === 2} />

      <ModalBody scroll gap={3} className="text-sm max-h-[60vh]">
        {step === 0 && (
          <>
            <p className="text-muted">
              Отметьте правила, которые попадут в файл экспорта.
            </p>
            <RulePickList items={items} selected={selected} onChange={setSelected} />
          </>
        )}

        {step === 1 && (
          <>
            <div>
              <div className="label mb-2">Режим правил в файле</div>
              <Segmented
                block
                size="sm"
                label="Режим правил в файле"
                value={modeOverride}
                onChange={setModeOverride}
                options={MODE_OVERRIDE_OPTIONS}
              />
              <p className="text-xs text-muted mt-2">
                {modeOverride === "keep"
                  ? "Каждое правило уедет в своём режиме — удобно для переноса на своё устройство."
                  : modeOverride === "manual"
                    ? "Все правила будут работать только по кнопке «Проверить и применить» — удобно, если файл для другого человека."
                    : "Все правила будут выключены — их включат по одному после импорта."}
              </p>
            </div>

            <FactList
              facts={[
                { label: "Правил в файле", value: formatNum(outgoing.length), strong: true },
                { label: "По кнопке", value: formatNum(modes.manual) },
                { label: "Авто", value: formatNum(modes.auto) },
                ...(scheduled > 0 ? [{ label: "Из них с расписанием", value: formatNum(scheduled) }] : []),
                { label: "Выключены", value: formatNum(modes.off) },
                { label: "Имя файла", value: fileName },
              ]}
            />

            <Callout tone="accent">
              В файле — условия, действия, названия и режимы правил. Операций,
              сумм и токена в нём нет. Категории и получатели записаны названиями:
              на другом аккаунте правило сработает, если там есть категория с тем
              же названием.
            </Callout>
          </>
        )}

        {step === 2 && (
          <Callout tone="income">
            Файл «{savedName}» скачан: {n(outgoing.length)}. Чтобы загрузить его на
            другом устройстве, откройте там «Правила» и нажмите кнопку импорта
            рядом с «Добавить».
          </Callout>
        )}
      </ModalBody>

      <ModalFooter justify="between">
        <div>
          {step === 1 && (
            <button type="button" className="btn-ghost text-sm" onClick={() => setStep(0)}>
              Назад
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-ghost text-sm" onClick={onClose}>
            {step === 2 ? "Закрыть" : "Отмена"}
          </button>
          {step === 0 && (
            <button
              type="button"
              className="btn-primary text-sm"
              disabled={picked.length === 0}
              onClick={() => setStep(1)}
            >
              {picked.length === 0 ? "Отметьте правила" : "Далее"}
            </button>
          )}
          {step === 1 && (
            <button type="button" className="btn-primary text-sm" onClick={download}>
              <Download className="w-4 h-4" aria-hidden />
              Скачать {n(outgoing.length)}
            </button>
          )}
        </div>
      </ModalFooter>
    </Modal>
  );
}
