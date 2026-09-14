import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Hash } from "lucide-react";
import { extractHashtags } from "../lib/aggregations";
import {
  planHashtagRename,
  rulesMentioningHashtag,
  type HashtagRenamePlan,
} from "../lib/hashtagRename";
import { useEditsStore } from "../store/useEditsStore";
import { useDataStore } from "../store/useDataStore";
import { useCategoryRulesStore } from "../store/useCategoryRulesStore";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { useDraftsStore } from "../store/useDraftsStore";
import { Combobox } from "./Combobox";
import { Segmented } from "./Segmented";
import { InfoPopover, InfoTerm } from "./InfoPopover";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "./Modal";

/** Сколько строк предпросмотра рисуем. Правка идёт по всему списку. */
const PREVIEW_LIMIT = 50;

/** Тот же набор символов, что понимает разбор хэштегов. */
const NAME_RE = /^[\p{L}\p{N}_-]+$/u;

type Mode = "rename" | "merge";

/**
 * Переименование хэштега и перенос его операций в другой тег.
 *
 * У хэштега нет своей сущности в Дзен-мани — он живёт текстом внутри
 * комментария. Поэтому окно показывает не «поле названия», а последствия:
 * сколько комментариев будет переписано и как именно. Предпросмотр считает
 * ровно та же чистая функция, что потом и пишет, — иначе он однажды соврёт.
 */
export function HashtagRenameModal({
  hashtag,
  onClose,
}: {
  /** Переименовываемый тег, без решётки. */
  hashtag: string;
  onClose: () => void;
}) {
  // Все операции, а не отфильтрованные: переименуй мы тег только в текущем
  // периоде — из одного тега получилось бы два, «#налоги» за июль и «#Налоги»
  // за август.
  const transactions = useDataStore((s) => s.transactions);
  const reapplyRules = useDataStore((s) => s.reapplyRules);
  const setEditEach = useEditsStore((s) => s.setEditEach);
  const rules = useCategoryRulesStore((s) => s.rules);
  const pushMode = useZenmoneyStore((s) => s.pushMode);
  const drafts = useDraftsStore((s) => s.drafts);

  const [mode, setMode] = useState<Mode>("rename");
  const [renameTo, setRenameTo] = useState(hashtag);
  const [mergeTo, setMergeTo] = useState("");
  const [busy, setBusy] = useState(false);

  // Фокус в окно и обратно ставит `Modal`. Но при успешном переименовании
  // строка со старым тегом исчезает вместе с карандашом, с которого всё
  // начали, — возвращать фокус некуда, и он молча падает в body. Тогда уводим
  // его на таблицу тегов: клавиатурный пользователь остаётся там, где работал.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    return () => {
      if (prev && document.contains(prev)) return;
      const table = document.querySelector<HTMLElement>("main table");
      table?.focus?.();
      table?.scrollIntoView({ block: "nearest" });
    };
  }, []);

  const target = (mode === "rename" ? renameTo : mergeTo).trim();

  /** Все теги, кроме переименовываемого — варианты для переноса. */
  const otherHashtags = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) {
      for (const tag of extractHashtags(t.comment)) {
        if (tag !== hashtag) set.add(tag);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [transactions, hashtag]);

  const nameValid = NAME_RE.test(target);
  const sameName = target === hashtag;

  const draftIds = useMemo(() => new Set(Object.keys(drafts)), [drafts]);

  const plan: HashtagRenamePlan | null = useMemo(() => {
    if (!nameValid || sameName) return null;
    return planHashtagRename(transactions, hashtag, target, draftIds);
  }, [transactions, hashtag, target, nameValid, sameName, draftIds]);

  /** Правила, которые вернут старый тег обратно на следующем прогоне. */
  const riskyRules = useMemo(
    () => rulesMentioningHashtag(rules as never[], hashtag),
    [rules, hashtag]
  );

  const canApply = !!plan && plan.rows.length > 0 && !busy;

  async function apply() {
    if (!plan || plan.rows.length === 0 || busy) return;
    setBusy(true);
    try {
      const patches: Record<string, { comment: string }> = {};
      for (const row of plan.rows) patches[row.id] = { comment: row.after };
      await setEditEach(patches);
      await reapplyRules();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const count = plan?.rows.length ?? 0;

  return (
    <Modal onClose={onClose} busy={busy} width="2xl">
      <ModalHeader
        icon={Hash}
        overline={mode === "rename" ? "Переименование тега" : "Перенос тега"}
        title={
          <span className="inline-flex items-center gap-2">
            <span>#{hashtag}</span>
            {target && !sameName && nameValid && (
              <>
                <ArrowRight className="w-4 h-4 text-muted shrink-0" />
                <span className="text-accent">#{target}</span>
              </>
            )}
          </span>
        }
      />

      <ModalBody scroll>
        {/* Пояснения к обоим режимам — под знаком вопроса. Под полями их
            держать нельзя: текст у режимов разной длины, и окно от одного
            переключения меняло высоту. */}
        <div className="flex items-center gap-2 flex-wrap">
          <Segmented
            size="sm"
            label="Что сделать с тегом"
            value={mode}
            onChange={(v) => setMode(v as Mode)}
            options={[
              {
                value: "rename",
                label: "Переименовать",
                title: "Задать тегу новое имя",
              },
              {
                value: "merge",
                label: "Перенести в другой",
                title: "Отдать операции этого тега другому, уже существующему",
              },
            ]}
          />
          <InfoPopover label="Как это работает">
            <p>
              У хэштега нет отдельной сущности в Дзен-мани — он живёт текстом
              внутри комментария. Поэтому обе операции переписывают комментарии
              всех операций с этим тегом, и до применения видно, сколько их и
              как изменится каждый.
            </p>
            <p>
              <InfoTerm>Переименовать</InfoTerm> — задать тегу новое имя.
              Регистр важен: «#налоги» и «#Налоги» — разные теги, так что смена
              регистра тоже полноценная правка.
            </p>
            <p>
              <InfoTerm>Перенести в другой</InfoTerm> — отдать операции уже
              существующему тегу, а этот убрать из комментариев. Там, где оба
              тега стоят рядом, останется один: два одинаковых тега считали бы
              операцию дважды.
            </p>
            <p>
              Меняются все операции с тегом, а не только попавшие в выбранный
              период, — иначе из одного тега получилось бы два. Переводы,
              долговые и ещё не отправленные операции пропускаются, их число
              показано отдельно.
            </p>
          </InfoPopover>
        </div>

        {/* Оба режима — одна и та же коробка: ярлык, поле высотой h-10 и
            строка сообщения с зарезервированной высотой. Иначе переключение
            режима двигало бы кнопки внизу. */}
        <div>
          <label
            className="label block mb-1"
            htmlFor={mode === "rename" ? "hashtag-new-name" : undefined}
          >
            {mode === "rename" ? "Новое название" : "Перенести в тег"}
          </label>
          {mode === "rename" ? (
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
                #
              </span>
              <input
                id="hashtag-new-name"
                className="input text-sm w-full pl-7"
                value={renameTo}
                onChange={(e) => setRenameTo(e.target.value.replace(/^#+/, ""))}
                onKeyDown={(e) => e.key === "Enter" && canApply && void apply()}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          ) : (
            <Combobox
              value={mergeTo}
              options={otherHashtags}
              onChange={setMergeTo}
              allowCustom={false}
              // Набор фильтрует список, но значением становится только
              // выбранный тег: тегов бывают десятки, крутить их дольше,
              // чем набрать три буквы.
              searchable
              clearable
              prefix="#"
              // Тело окна прокручиваемое — без портала список тегов
              // обрезался бы им, и из десятка вариантов было видно полтора.
              portal
              placeholder={
                otherHashtags.length > 0
                  ? "Найдите или выберите тег"
                  : "Других тегов пока нет"
              }
            />
          )}
          <p className="text-xs mt-1 min-h-4">
            {mode === "rename" && target && !nameValid ? (
              <span className="text-warn">
                Только буквы, цифры, дефис и подчёркивание.
              </span>
            ) : mode === "rename" && sameName ? (
              <span className="text-muted">Название не изменилось.</span>
            ) : null}
          </p>
        </div>

        {/* Последствия — до нажатия кнопки, а не после. */}
        {plan && (
          <div className="rounded-xl border border-border bg-panel2/30 px-4 py-3 space-y-2">
            {/* Форма «изменено операций: N» выбрана намеренно: любая
                формулировка со связкой числительного и глагола («будет
                изменена 1 операция» / «изменено 4 операции») требует согласования
                сразу по роду и падежу и на каком-нибудь N обязательно врёт. */}
            <div className="text-sm">
              {count > 0 ? (
                <>
                  Будет изменено операций: <strong>{count}</strong>
                </>
              ) : (
                <span className="text-muted">
                  Ни одной операции с этим тегом не нашлось.
                </span>
              )}
            </div>

            {mode === "rename" && plan.isMerge && (
              <div className="text-xs text-warn flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Тег «#{target}» уже существует — операции объединятся с ним, и
                  отдельного «#{hashtag}» больше не будет. Это перенос, а не
                  просто новое имя.
                </span>
              </div>
            )}

            {plan.collapsed > 0 && (
              <div className="text-xs text-muted">
                Комментариев, где оба тега стоят рядом: {plan.collapsed}. Там
                останется один «#{target}» — иначе операция считалась бы дважды.
              </div>
            )}

            {plan.skipped.debts > 0 && (
              <div className="text-xs text-warn flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Долговые операции не трогаем, с этим тегом их:{" "}
                  {plan.skipped.debts}. Дзен-мани принимает такие операции
                  только вместе с плательщиком и может подменить контрагента —
                  поправьте комментарий у них вручную.
                </span>
              </div>
            )}

            {plan.skipped.drafts > 0 && (
              <div className="text-xs text-warn flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Неотправленные операции не трогаем, с этим тегом их:{" "}
                  {plan.skipped.drafts}. Правки к ним не применяются, пока они
                  не уедут в Дзен-мани — поправьте комментарий прямо в операции.
                </span>
              </div>
            )}

            {riskyRules.length > 0 && (
              <div className="text-xs text-warn flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Тег «#{hashtag}» упоминается в{" "}
                  {riskyRules.length === 1 ? "правиле" : "правилах"}:{" "}
                  {riskyRules.join(", ")}. Если правило дописывает его в
                  комментарий, старый тег вернётся при следующем применении
                  правил — поправьте правило.
                </span>
              </div>
            )}

            {pushMode !== "off" && count > 0 && (
              <div className="text-xs text-muted">
                Отправка правок включена — изменённые комментарии уедут в
                Дзен-мани.
              </div>
            )}
          </div>
        )}

        {/* Построчный предпросмотр: было → стало. */}
        {plan && plan.rows.length > 0 && (
          <div>
            <div className="label mb-1">
              Как изменятся комментарии
              {plan.rows.length > PREVIEW_LIMIT && (
                <span className="text-muted font-normal">
                  {" "}
                  · показаны первые {PREVIEW_LIMIT}, изменены будут все
                </span>
              )}
            </div>
            <div className="rounded-xl border border-border divide-y divide-border max-h-64 overflow-y-auto">
              {plan.rows.slice(0, PREVIEW_LIMIT).map((row) => (
                <div key={row.id} className="px-3 py-2 text-xs">
                  <div className="text-muted truncate">
                    {row.date} · {row.payee || "Без получателя"}
                  </div>
                  <div className="mt-0.5 flex items-start gap-2 min-w-0">
                    <span className="line-through text-muted break-words min-w-0 flex-1">
                      {row.before}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 shrink-0 mt-0.5 text-muted" />
                    <span className="break-words min-w-0 flex-1">
                      {row.after || <em className="text-muted">пусто</em>}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="btn-ghost text-sm"
        >
          Отмена
        </button>
        <button
          type="button"
          onClick={() => void apply()}
          disabled={!canApply}
          className="btn-primary text-sm"
        >
          {busy
            ? "Применяем…"
            : count > 0
              ? `Применить (${count})`
              : "Применить"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
