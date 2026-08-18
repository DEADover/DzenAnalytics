import { useState } from "react";
import { Download, FileSpreadsheet, Undo2, Upload } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useDraftsStore } from "../store/useDraftsStore";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { useImportBatchesStore, fileFingerprint } from "../store/useImportBatchesStore";
import { useCounterpartyEditsStore } from "../store/useCounterpartyEditsStore";
import { loadZenCache } from "../lib/zenmoneyCache";
import { liveCategoryNodes } from "../lib/categoryTree";
import { accountKindLabel } from "../lib/accountType";
import { exportImportTemplate, SHEET_OPS, TEMPLATE_VERSION } from "../lib/importTemplate";
import { readXlsxSheet } from "../lib/xlsxRead";
import { merchantKey } from "../lib/zenmoneyPush";
import { reconcileNewCounterparties } from "../lib/counterparties";
import {
  MAX_ROWS,
  buildImportPlan,
  isBlankRow,
  matchHeader,
  readRow,
  rowToVerdict,
  type ImportDicts,
  type ImportPlan,
  type ParsedRow,
  type PlanRow,
} from "../lib/importRows";
import type { CategoryNode } from "./CategoryCascadePicker";
import type { ZenCache } from "../lib/zenmoneyCache";
import { NO_CATEGORY } from "../lib/zenmoneyMap";
import { ImportXlsxModal } from "./ImportXlsxModal";
import { formatDate, formatNum } from "../lib/format";
import { pluralRu } from "../lib/plural";
import { confirm } from "../store/useConfirmStore";
import { Tooltip } from "./Tooltip";

/**
 * Импорт операций из Excel — карточка на странице настроек.
 *
 * Вся связка живёт здесь: справочники для шаблона, чтение файла, отчёт проверки
 * и запись партии. Логики разбора в компоненте нет — она в `importRows`, потому
 * что DOM в тестах проекта нет, а проверять надо именно разбор.
 *
 * Импорт создаёт НАСТОЯЩИЕ новые операции Дзен-мани (те же черновики, что
 * рождаются кнопкой «Добавить»), поэтому без подключённого облака он невозможен:
 * операцию нужно привязать к настоящим id счёта, категории и валюты.
 */
export function ImportXlsxCard() {
  const token = useZenmoneyStore((s) => s.token);
  const pushMode = useZenmoneyStore((s) => s.pushMode);
  const setPushMode = useZenmoneyStore((s) => s.setPushMode);
  const transactions = useDataStore((s) => s.transactions);
  const refresh = useDataStore((s) => s.refresh);
  const addMany = useDraftsStore((s) => s.addMany);
  const clearMany = useDraftsStore((s) => s.clearMany);
  const batches = useImportBatchesStore((s) => s.batches);
  const cpCreated = useCounterpartyEditsStore((s) => s.created);
  const addCounterparties = useCounterpartyEditsStore((s) => s.addManyNew);
  const removeCounterparties = useCounterpartyEditsStore((s) => s.removeManyNew);
  const addBatch = useImportBatchesStore((s) => s.add);
  const removeBatch = useImportBatchesStore((s) => s.remove);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    fileName: string;
    fingerprint: string;
    plan: ImportPlan;
    seenBefore?: { at: string; count: number };
    // Всё, что нужно отчёту, чтобы перепроверить исправленную строку тем же
    // разбором: справочники, живой кэш и штамп времени. Штамп берётся один раз
    // на файл — иначе правка строки сдвигала бы время создания операций.
    dicts: ImportDicts;
    nodes: CategoryNode[];
    cache: ZenCache;
    stamp: number;
  } | null>(null);

  const lastBatch = batches.find((b) => !b.pushedAt);

  async function dictsFromCache(): Promise<ImportDicts & { base: string; nodes: CategoryNode[]; rich: {
    accounts: { title: string; currency: string; kind: string }[];
  } }> {
    const cache = await loadZenCache();
    if (!cache) throw new Error("Справочники Дзен-мани ещё не загружены — синхронизируйтесь.");
    const instruments = new Map(cache.instruments.map((i) => [i.id, i.shortTitle]));
    const live = cache.accounts.filter((a) => !a.archive);
    const rich = {
      accounts: live.map((a) => ({
        title: a.title,
        currency: instruments.get(a.instrument) ?? "RUB",
        kind: accountKindLabel(a.type, a.savings),
      })),
    };
    const nodes = liveCategoryNodes(cache.tags);
    const categories = nodes.flatMap((n) =>
      n.subs.length > 0 ? [n.name, ...n.subs.map((s) => `${n.name} / ${s}`)] : [n.name]
    );
    return {
      accounts: rich.accounts.map((a) => a.title),
      categories,
      // Первым пунктом «Без категории» — как в форме создания: снять категорию
      // осознанно надо уметь и здесь, а тега для этого в Дзен-мани нет.
      nodes: [{ name: NO_CATEGORY, subs: [] }, ...nodes],
      payees: cache.merchants.map((m) => m.title.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, "ru")),
      base: useDataStore.getState().rates.base,
      rich,
    };
  }

  async function downloadTemplate() {
    setError(null);
    setBusy("template");
    try {
      const d = await dictsFromCache();
      await exportImportTemplate(
        { accounts: d.rich.accounts, categories: d.categories, payees: d.payees, base: d.base },
        new Date().toISOString().slice(0, 10)
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось собрать шаблон");
    } finally {
      setBusy(null);
    }
  }

  async function handleFile(file: File) {
    setError(null);
    setDone(null);
    setBusy("read");
    try {
      const buf = await file.arrayBuffer();
      const sheet = await readXlsxSheet(buf, SHEET_OPS);
      const { columns, missing } = matchHeader(sheet);
      if (missing.length > 0) {
        throw new Error(
          `В файле не хватает колонок: ${missing.join(", ")}. Скачайте шаблон и заполните его.`
        );
      }
      const rows = [];
      for (let r = 2; r <= Math.min(sheet.lastRow, MAX_ROWS + 1); r++) {
        const row = readRow(sheet, columns, r);
        if (!isBlankRow(row)) rows.push(row);
      }
      if (rows.length === 0) throw new Error("На листе «Операции» нет ни одной заполненной строки.");
      if (sheet.lastRow > MAX_ROWS + 1) {
        throw new Error(
          `В файле больше ${formatNum(MAX_ROWS)} строк. Разбейте его на части — так проверку видно целиком.`
        );
      }

      const cache = await loadZenCache();
      if (!cache) throw new Error("Справочники Дзен-мани ещё не загружены — синхронизируйтесь.");
      const d = await dictsFromCache();
      const dicts: ImportDicts = {
        accounts: d.accounts,
        categories: d.categories,
        payees: d.payees,
      };
      const stamp = Math.floor(Date.now() / 1000);
      // Уже заведённые локально контрагенты — чтобы то же имя во второй раз
      // не завело вторую запись.
      const plan = buildImportPlan(
        rows,
        dicts,
        cache,
        transactions,
        stamp,
        undefined,
        useCounterpartyEditsStore.getState().created
      );
      const fingerprint = fileFingerprint(file.name, buf);
      const seen = batches.find((b) => b.id === fingerprint);
      setPending({
        fileName: file.name,
        fingerprint,
        plan,
        seenBefore: seen
          ? { at: formatDate(seen.importedAt), count: seen.draftIds.length }
          : undefined,
        dicts,
        nodes: d.nodes,
        cache,
        stamp,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось прочитать файл");
    } finally {
      setBusy(null);
    }
  }

  async function createRows(rows: PlanRow[], hold: boolean) {
    if (rows.length === 0 || !pending) return;
    // Придерживаем автоотправку ДО записи: подписка срабатывает на появление
    // черновиков, и переключить режим после было бы поздно.
    if (hold && pushMode === "auto") await setPushMode("manual");

    // Контрагенты — только по ОТМЕЧЕННЫМ строкам: снятая галочка не должна
    // заводить запись в справочнике.
    const minted = [
      ...new Map(
        rows.flatMap((r) =>
          r.verdict.ok && r.verdict.newCounterparty
            ? [[r.verdict.newCounterparty.id, r.verdict.newCounterparty] as const]
            : []
        )
      ).values(),
    ];
    // Пока человек смотрел отчёт, того же контрагента могли завести руками или
    // он мог приехать синхронизацией — тогда ссылаемся на него, а не заводим
    // второго.
    const { txs, toCreate } = reconcileNewCounterparties(
      rows.flatMap((r) => (r.verdict.ok ? [r.verdict.zen] : [])),
      minted,
      pending.cache.merchants,
      useCounterpartyEditsStore.getState().created
    );

    // Справочник записываем ПЕРВЫМ: лишняя запись без операций безобидна, а
    // операция со ссылкой в никуда — нет.
    if (toCreate.length > 0) await addCounterparties(toCreate);
    await addMany(txs);
    await addBatch({
      id: pending.fingerprint,
      fileName: pending.fileName,
      importedAt: new Date().toISOString(),
      draftIds: txs.map((z) => z.id),
      counterpartyIds: toCreate.map((c) => c.id),
    });
    await refresh();
    setPending(null);
    setDone(
      `Создано ${formatNum(txs.length)} — операции ждут отправки в Дзен-мани` +
        (toCreate.length > 0
          ? `. Заведено контрагентов: ${formatNum(toCreate.length)}`
          : "")
    );
  }

  async function undoLast() {
    if (!lastBatch) return;
    const cps = lastBatch.counterpartyIds ?? [];
    const ok = await confirm({
      title: "Отменить импорт?",
      message:
        `Удалим ${formatNum(lastBatch.draftIds.length)} ${pluralRu(lastBatch.draftIds.length, ["операцию", "операции", "операций"])} из файла «${lastBatch.fileName}»` +
        (cps.length > 0
          ? ` и ${formatNum(cps.length)} ${pluralRu(cps.length, ["заведённого контрагента", "заведённых контрагента", "заведённых контрагентов"])}`
          : "") +
        ". В Дзен-мани они ещё не уехали, так что след не останется.",
      confirmLabel: "Отменить импорт",
      tone: "danger",
    });
    if (!ok) return;
    await clearMany(lastBatch.draftIds);
    if (cps.length > 0) await removeCounterparties(cps);
    await removeBatch(lastBatch.id);
    await refresh();
    setDone(
      cps.length > 0
        ? "Импорт отменён — операции и заведённые контрагенты удалены"
        : "Импорт отменён — созданные операции удалены"
    );
  }

  /**
   * Есть ли такой контрагент в справочнике — для пометок в отчёте и редакторе.
   *
   * Смотрит и в облачный кэш, и в локально заведённое: контрагент, заведённый
   * пять минут назад в «Справочниках», для человека уже существует.
   */
  const payeeStatus = (name: string): "none" | "existing" | "new" => {
    const key = merchantKey(name);
    if (!key) return "none";
    const known = [...(pending?.cache.merchants ?? []), ...cpCreated];
    return known.some((m) => merchantKey(m.title) === key) ? "existing" : "new";
  };

  return (
    <div className="rounded-lg border border-border bg-panel2/30 p-4 space-y-3">
      {/* Заголовок с текстом слева, кнопки справа в той же строке: так они
          встают в один столбец с кнопками соседних блоков настроек, а карточка
          занимает две строки вместо четырёх. На узком экране ряд переносится. */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="font-medium text-sm flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-accent" />
            Импорт дополнительных операций из Excel шаблона
          </div>
          <div className="text-xs text-muted mt-1">
            Нужно загрузить операции из других источников? — скачайте шаблон,
            заполните и загрузите в DzenAnalytics.
          </div>
        </div>

        {token && (
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <button
              type="button"
              onClick={downloadTemplate}
              disabled={busy !== null}
              className="btn-ghost text-sm"
            >
              <Download className="w-4 h-4" />
              {busy === "template" ? "Собираю…" : "Скачать шаблон"}
            </button>
            <label className="btn-primary text-sm cursor-pointer">
              <Upload className="w-4 h-4" />
              {busy === "read" ? "Читаю…" : "Загрузить заполненный"}
              <input
                type="file"
                accept=".xlsx"
                className="hidden"
                disabled={busy !== null}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Сброс значения: иначе повторный выбор ТОГО ЖЕ файла не
                  // вызовет событие, и кнопка будет выглядеть сломанной.
                  e.target.value = "";
                  if (file) void handleFile(file);
                }}
              />
            </label>
            {lastBatch && (
              <Tooltip content={`Из файла «${lastBatch.fileName}» — ${formatDate(lastBatch.importedAt)}`}>
                <button type="button" onClick={undoLast} className="btn-ghost text-sm text-muted">
                  <Undo2 className="w-4 h-4" />
                  Отменить импорт ({formatNum(lastBatch.draftIds.length)})
                </button>
              </Tooltip>
            )}
          </div>
        )}
      </div>

      {!token && (
        <div className="text-xs text-muted">
          Нужна подключённая синхронизация: импорт создаёт операции в Дзен-мани, а для
          этого их надо привязать к вашим счетам и категориям.
        </div>
      )}

      {error && <div className="text-xs text-expense">{error}</div>}
      {done && <div className="text-xs text-income">{done}</div>}

      {pending && (
        <ImportXlsxModal
          fileName={pending.fileName}
          plan={pending.plan}
          seenBefore={pending.seenBefore}
          autoPush={pushMode === "auto"}
          accounts={pending.dicts.accounts}
          payees={pending.dicts.payees}
          categories={pending.nodes}
          payeeStatus={payeeStatus}
          check={(row: ParsedRow) =>
            rowToVerdict(row, pending.dicts, pending.cache, pending.stamp)
          }
          revise={(rows: ParsedRow[]) =>
            buildImportPlan(rows, pending.dicts, pending.cache, transactions, pending.stamp)
          }
          onCreate={createRows}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}

/** Версия шаблона — показываем в справке, чтобы вопрос «а тот ли файл» имел ответ. */
export const IMPORT_TEMPLATE_VERSION = TEMPLATE_VERSION;
