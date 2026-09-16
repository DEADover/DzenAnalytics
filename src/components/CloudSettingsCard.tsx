import { MonitorSmartphone, X } from "lucide-react";
import { SettingRow } from "./SettingRow";
import { Switch } from "./Switch";
import { Callout } from "./Callout";
import { InfoTerm } from "./InfoPopover";
import { useCloudSettingsStore } from "../store/useCloudSettingsStore";
import { SERVICE_ACCOUNT_TITLE } from "../lib/cloudSettings";

/**
 * «Настройки на всех устройствах» — перенос своих настроек через Дзен-мани
 * (`useCloudSettingsStore`). Карточка есть только при подключённом Дзен-мани:
 * без него переносить не через что.
 *
 * Одной строкой, без шапки раздела и абзаца под ней: за ними стоял один
 * переключатель, и карточка занимала втрое больше места, чем он сам. Что
 * переносится и как — в «?».
 */
export function CloudSettingsCard() {
  const enabled = useCloudSettingsStore((s) => s.enabled);
  const busy = useCloudSettingsStore((s) => s.busy);
  const error = useCloudSettingsStore((s) => s.error);
  const lastSyncAt = useCloudSettingsStore((s) => s.lastSyncAt);
  const notice = useCloudSettingsStore((s) => s.notice);
  const setEnabled = useCloudSettingsStore((s) => s.setEnabled);
  const dismissNotice = useCloudSettingsStore((s) => s.dismissNotice);

  const status = !enabled
    ? "Выключено — только в этом браузере"
    : busy
      ? "Сверяются с Дзен-мани…"
      : error
        ? `Не удалось сверить: ${error}`
        : lastSyncAt
          ? `Включено · сверено ${new Date(lastSyncAt).toLocaleString("ru-RU", {
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
            })}`
          : "Включено — сверится при следующей синхронизации";

  return (
    <div className="card-tray px-5 py-1">
      {notice && (
        <Callout tone="warn" className="mt-3 mb-1">
          <div className="flex items-start gap-2">
            <span className="flex-1">{notice}</span>
            <button
              type="button"
              className="btn-icon btn-icon-sm shrink-0"
              aria-label="Скрыть пояснение"
              onClick={() => void dismissNotice()}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </Callout>
      )}

      <div className="flex items-center gap-2.5">
        {/* Значок той же ступени, что у шапок соседних карточек, — строка
            читается как свой раздел, а не как хвост карточки над ней. */}
        <MonitorSmartphone className="w-5 h-5 shrink-0 text-accent2" aria-hidden />
        <div className="min-w-0 flex-1">
          <SettingRow
            title="Настройки на всех устройствах"
            status={status}
            help={
              <>
                <p>
                  <InfoTerm>Что переносится</InfoTerm> — только то, чего нет в самом
                  Дзен-мани: правила, настройки расчётов (теги, счета вне баланса,
                  свободные деньги), оформление (тема, копейки, размер текста,
                  строка из выписки, панель фильтров), имена участников, раскладка
                  главной и основное меню.
                </p>
                <p>
                  <InfoTerm>Что нет</InfoTerm> — то, что и так живёт в Дзен-мани
                  (бюджеты, категории, первый день месяца), неотправленные правки
                  операций и настройки этого устройства: режим отправки,
                  автосинхронизация, бэкапы.
                </p>
                <p>
                  <InfoTerm>Как</InfoTerm> — в вашем Дзен-мани появится служебный
                  счёт «{SERVICE_ACCOUNT_TITLE}»: в архиве, вне баланса, с нулём.
                  Настройки лежат в записях на нём и приходят вместе с обычной
                  синхронизацией. Удалите счёт — перенос выключится, в браузере
                  всё останется.
                </p>
                <p>
                  Включать нужно на каждом устройстве. На втором настройки
                  берутся из Дзен-мани, а правила объединяются с теми, что уже
                  есть. Дальше побеждает более поздняя правка — по каждой
                  настройке и каждому правилу отдельно.
                </p>
              </>
            }
            control={
              <Switch
                checked={enabled}
                label="Переносить настройки через Дзен-мани"
                onChange={(on) => void setEnabled(on)}
              />
            }
          />
        </div>
      </div>
    </div>
  );
}
