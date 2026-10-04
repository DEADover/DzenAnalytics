import { useEffect, useState } from "react";
import { Check, ClipboardCopy, Stethoscope } from "lucide-react";
import { useZenmoneyStore, type PushMode } from "../store/useZenmoneyStore";
import { useCloudSettingsStore } from "../store/useCloudSettingsStore";
import { useSyncLogStore } from "../store/useSyncLogStore";
import { usePendingChanges } from "../hooks/usePendingChanges";
import { loadZenCache } from "../lib/zenmoneyCache";
import { readProfiles } from "../lib/profiles";
import {
  STAGE_LABEL,
  formatSyncReport,
  friendlyFailure,
  isFailureActive,
  nextAutoRetryAt,
  type SyncFailure,
} from "../lib/syncDiagnostics";
import { InfoPopover } from "./InfoPopover";

const PUSH_MODE_LABEL: Record<PushMode, string> = {
  off: "Выключена",
  manual: "Вручную",
  auto: "Авто",
  "on-sync": "При синке",
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ru-RU") : "—");

/**
 * «Диагностика синхронизации»: что с синхронизацией прямо сейчас и отчёт,
 * который человек копирует одной кнопкой и присылает автору. В отчёте —
 * состояние и счётчики, без токена, сумм и названий.
 */
export function SyncDiagnostics() {
  const lastSyncAt = useZenmoneyStore((s) => s.lastSyncAt);
  const pullFailure = useZenmoneyStore((s) => s.pullFailure);
  const pushFailure = useZenmoneyStore((s) => s.pushFailure);
  const loginMethod = useZenmoneyStore((s) => s.loginMethod);
  const pending = usePendingChanges();
  const [copied, setCopied] = useState(false);
  const [manualText, setManualText] = useState<string | null>(null);

  // Текущее время — состоянием: «следующая автопопытка» сравнивается с ним, а
  // читать часы прямо при отрисовке нельзя. Раз в 30 секунд — достаточно.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const failing = isFailureActive(pullFailure);
  const retryAt = failing ? nextAutoRetryAt(pullFailure) : null;

  async function buildReport(): Promise<string> {
    const z = useZenmoneyStore.getState();
    const cache = await loadZenCache().catch(() => null);
    let bytes: number | null = null;
    try {
      if (cache) bytes = new Blob([JSON.stringify(cache)]).size;
    } catch {
      /* слишком большой кэш для строки — размер просто не покажем */
    }
    const estimate = await navigator.storage?.estimate?.().catch(() => null);
    return formatSyncReport({
      version: __APP_VERSION__,
      origin: location.origin,
      userAgent: navigator.userAgent,
      now: new Date(),
      loginMethod: z.loginMethod,
      pushMode: PUSH_MODE_LABEL[z.pushMode],
      autoSync: z.autoSyncEnabled ? `каждые ${z.autoSyncValue} ${z.autoSyncUnit === "min" ? "мин" : z.autoSyncUnit === "hour" ? "ч" : "дн"}` : "выключена",
      cloudSettings: useCloudSettingsStore.getState().enabled ? "включён" : "выключен",
      lastSyncAt: z.lastSyncAt,
      serverTimestamp: z.serverTimestamp,
      pullFailure: z.pullFailure,
      pushFailure: z.pushFailure,
      cache: cache
        ? {
            transactions: cache.transactions.length,
            accounts: cache.accounts.length,
            tags: cache.tags.length,
            bytes,
          }
        : null,
      pending: {
        операции: pending.edits,
        новые: pending.drafts,
        удаления: pending.deleted,
        категории: pending.categories,
        контрагенты: pending.counterparties,
        счета: pending.accounts,
        планы: pending.plans,
        бюджеты: pending.budgets,
      },
      storage:
        estimate && typeof estimate.usage === "number" && typeof estimate.quota === "number"
          ? { usage: estimate.usage, quota: estimate.quota }
          : null,
      profiles: Math.max(1, readProfiles().length),
      log: useSyncLogStore.getState().entries,
    });
  }

  async function copyReport() {
    const text = await buildReport();
    try {
      await navigator.clipboard.writeText(text);
      setManualText(null);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Буфер обмена недоступен (нет разрешения, не https) — показываем текст,
      // чтобы скопировать руками.
      setManualText(text);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-panel2/30 p-4 mt-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="font-medium text-sm flex items-center gap-2 min-w-0">
          <Stethoscope className="w-4 h-4 text-accent" />
          Диагностика синхронизации
          <InfoPopover label="Зачем это">
            <p>
              Если синхронизация перестала работать, нажмите «Скопировать отчёт» и пришлите текст автору. В нём
              версия панели, браузер, на каком шаге и с каким ответом сервера случилась ошибка, размеры данных и
              очереди правок.
            </p>
            <p className="mt-2">Токена, сумм и названий в отчёте нет.</p>
          </InfoPopover>
        </div>
        <button type="button" onClick={copyReport} className="btn-ghost text-sm">
          {copied ? <Check className="w-4 h-4 text-income" /> : <ClipboardCopy className="w-4 h-4" />}
          {copied ? "Скопировано" : "Скопировать отчёт"}
        </button>
      </div>

      <div className="flex items-start flex-wrap gap-x-8 gap-y-3 text-sm">
        <div>
          <div className="label mb-1">Последняя удачная</div>
          <div>{when(lastSyncAt)}</div>
        </div>
        <FailureFact title="Ошибка синхронизации" failure={pullFailure} active={failing} />
        <FailureFact
          title="Ошибка отправки"
          failure={pushFailure}
          active={isFailureActive(pushFailure)}
        />
        {retryAt !== null && (
          <div>
            <div className="label mb-1">Следующая автопопытка</div>
            <div>{retryAt > now ? new Date(retryAt).toLocaleTimeString("ru-RU") : "По расписанию"}</div>
          </div>
        )}
        <div>
          <div className="label mb-1">Вход</div>
          <div>{loginMethod === "oauth" ? "Через Дзен-мани" : loginMethod === "token" ? "Токен" : "—"}</div>
        </div>
        <div>
          <div className="label mb-1">Версия</div>
          <div className="tabular-nums">{__APP_VERSION__}</div>
        </div>
      </div>

      {manualText !== null && (
        <textarea
          readOnly
          value={manualText}
          aria-label="Отчёт о синхронизации"
          className="input w-full h-48 font-mono text-[11px]"
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
    </div>
  );
}

/** Факт об ошибке: когда, что и на каком шаге; «Нет» — если не было. */
function FailureFact({
  title,
  failure,
  active,
}: {
  title: string;
  failure: SyncFailure | null;
  active: boolean;
}) {
  return (
    <div className="min-w-0 max-w-[420px]">
      <div className="label mb-1">{title}</div>
      {!failure ? (
        <div>Нет</div>
      ) : (
        <div className={active ? "text-expense" : "text-muted"}>
          <div>
            {when(failure.at)}
            {failure.streak > 1 && active && ` · подряд ${failure.streak}`}
            {!active && " · уже прошла"}
          </div>
          <div className="text-xs mt-0.5">
            {friendlyFailure(failure)}
            <span className="text-muted">
              {" "}
              Шаг: {STAGE_LABEL[failure.stage]}
              {failure.status !== null && `, HTTP ${failure.status}`}.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
