import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, UserRound } from "lucide-react";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { InfoPopover, InfoTerm } from "./InfoPopover";
import { Switch } from "./Switch";
import { getZenUsersFromCache } from "../store/useZenmoneyStore";
import {
  likelyOwnerId,
  membersInData,
  userLabel,
  type ZenUserOption,
} from "../lib/zenUsers";
import { useMembersStore } from "../store/useMembersStore";
import { useDataStore } from "../store/useDataStore";

/**
 * Участники общего аккаунта Дзен-мани (issues #92, #95).
 *
 * Карточки нет, пока участник один: на личном аккаунте настраивать нечего.
 *
 * ПОЧЕМУ ЗДЕСЬ ВОПРОС, А НЕ ДОГАДКА. По ответу API владельца токена не
 * отличить — `user[]` у разных участников совпадает байт в байт (проверено на
 * живом общем аккаунте). А от ответа зависит приватность: перепутав, сервис
 * спрятал бы своё и показал чужое. Поэтому пока человек не ответил, не
 * прячется ничего и на виду висит предупреждение.
 */
export function UsersSettings() {
  const transactions = useDataStore((s) => s.transactions);
  const aliases = useMembersStore((s) => s.aliases);
  const ownerId = useMembersStore((s) => s.ownerId);
  const hideForeign = useMembersStore((s) => s.hideForeignPrivate);
  const setAlias = useMembersStore((s) => s.setAlias);
  const setOwnerId = useMembersStore((s) => s.setOwnerId);
  const setHideForeign = useMembersStore((s) => s.setHideForeignPrivate);
  const [users, setUsers] = useState<ZenUserOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    getZenUsersFromCache().then((list) => {
      if (!cancelled && list) setUsers(list);
    });
    return () => {
      cancelled = true;
    };
  }, [transactions]);

  // Показываем всех из справочника аккаунта — включая участника без единого
  // личного счёта: назвать его и отметить собой всё равно может понадобиться.
  // Порядок по числу операций на личных счетах, чтобы заметный стоял первым.
  const ordered = useMemo(() => {
    const byActivity = membersInData(transactions);
    const rank = new Map(byActivity.map((id, i) => [id, i]));
    return [...users].sort(
      (a, b) => (rank.get(a.id) ?? 1e6) - (rank.get(b.id) ?? 1e6) || a.id - b.id
    );
  }, [users, transactions]);

  const suggested = likelyOwnerId(users);

  if (ordered.length < 2) return null;

  return (
    <div className="card-tray card-pad">
      <SettingsSectionHeader
        icon={UserRound}
        title="Участники аккаунта"
        className="mb-1"
        right={
          <InfoPopover label="Откуда берутся эти люди">
            <p>
              Дзен-мани разрешает подключить к аккаунту несколько человек. По
              одному токену приезжают данные всех — и те счета, что каждый
              пометил <InfoTerm>личными</InfoTerm>, тоже.
            </p>
            <p>
              Само приложение Дзен-мани чужие личные счета прячет, а по API
              отдаёт. Поэтому прячем их здесь — но для этого сервису нужно
              знать, кто из списка вы.
            </p>
            <p>
              Имена и пометка «Это я» живут <InfoTerm>только здесь</InfoTerm>: в
              Дзен-мани отсюда ничего не уезжает, чужой профиль мы не трогаем.
            </p>
          </InfoPopover>
        }
      />
      <p className="text-xs text-muted mb-3">
        Кто из участников вы и как их называть. От первого зависит, чьи личные
        счета и плановые операции скрывать.
      </p>

      {ownerId == null && (
        <div className="flex items-start gap-2 rounded-xl border border-warn/40 bg-warn/5 p-3 text-xs mb-3">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-warn" />
          <span>
            <strong>Укажите, кто вы.</strong> Пока не указано, сервис показывает
            личные счета всех участников — определить владельца токена по данным
            Дзен-мани нельзя, а угадать значило бы рискнуть чужой приватностью.
            {suggested != null && (
              <> Скорее всего это {userLabel(suggested, users, aliases)}.</>
            )}
          </span>
        </div>
      )}

      <div className="space-y-2">
        {ordered.map((u) => (
          <div
            key={u.id}
            className="flex items-center gap-3 flex-wrap rounded-xl border border-border p-3"
          >
            <label className="flex items-center gap-2 cursor-pointer shrink-0">
              <input
                type="radio"
                name="zen-owner"
                checked={u.id === ownerId}
                onChange={() => setOwnerId(u.id)}
                className="shrink-0"
              />
              <span className="text-xs text-muted">Это я</span>
            </label>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">
                {userLabel(u.id, users, aliases)}
              </div>
              <div className="text-[11px] text-muted tabular-nums">
                {u.login ? `${u.login} · ` : ""}
                {u.id}
              </div>
            </div>
            <input
              className="input w-full sm:w-52 shrink-0"
              placeholder="Как называть"
              defaultValue={aliases[String(u.id)] ?? ""}
              onBlur={(e) => setAlias(u.id, e.target.value)}
              aria-label={`Имя для участника ${u.id}`}
            />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap border-t border-border pt-3 mt-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">Скрывать чужие личные счета</div>
          <div className="text-xs text-muted">
            {ownerId == null
              ? "Заработает, когда вы отметите себя выше."
              : hideForeign
                ? "Операции по личным счетам других участников не показываются — как в Дзен-мани."
                : "Показываются операции всех, включая личные счета других участников."}
          </div>
        </div>
        <Switch
          checked={hideForeign}
          onChange={setHideForeign}
          disabled={ownerId == null}
          label="Скрывать чужие личные счета"
        />
      </div>
    </div>
  );
}
