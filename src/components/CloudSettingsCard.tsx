import { MonitorSmartphone } from "lucide-react";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { SettingRow } from "./SettingRow";
import { Switch } from "./Switch";
import { InfoTerm } from "./InfoPopover";
import { useCloudSettingsStore } from "../store/useCloudSettingsStore";
import { SERVICE_ACCOUNT_TITLE } from "../lib/cloudSettings";

/**
 * «Настройки на всех устройствах» — перенос своих настроек через Дзен-мани
 * (`useCloudSettingsStore`). Карточка есть только при подключённом Дзен-мани:
 * без него переносить не через что.
 *
 * Общий вид карточки настроек — шапка со значком и строка настройки, — но без
 * абзаца под шапкой: за ним стоял один переключатель, и карточка выходила
 * вдвое выше нужного. Что переносится и как — в «?» у строки.
 */
export function CloudSettingsCard() {
  const enabled = useCloudSettingsStore((s) => s.enabled);
  const busy = useCloudSettingsStore((s) => s.busy);
  const error = useCloudSettingsStore((s) => s.error);
  const lastSyncAt = useCloudSettingsStore((s) => s.lastSyncAt);
  const notice = useCloudSettingsStore((s) => s.notice);
  const setEnabled = useCloudSettingsStore((s) => s.setEnabled);
  const dismissNotice = useCloudSettingsStore((s) => s.dismissNotice);

  const status = notice
    ? "Выключено: служебный счёт удалили в Дзен-мани"
    : !enabled
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
    <div className="card-tray card-pad">
      <SettingsSectionHeader icon={MonitorSmartphone} title="Настройки на всех устройствах" />

      <SettingRow
        title="Переносить через Дзен-мани"
        status={
          notice ? (
            <>
              {status}
              {" · "}
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={() => void dismissNotice()}
              >
                Понятно
              </button>
            </>
          ) : (
            status
          )
        }
        statusTone={notice || (error && !busy && enabled) ? "warn" : undefined}
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
              счёт «{SERVICE_ACCOUNT_TITLE}»: в архиве, вне баланса, с нулём,
              на суммы и отчёты не влияет. В DzenAnalytics он скрыт. Настройки
              лежат в записях на нём и приходят вместе с обычной
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
  );
}
