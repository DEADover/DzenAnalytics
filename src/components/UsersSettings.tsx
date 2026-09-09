import { useEffect, useMemo, useState } from "react";
import { UserRound } from "lucide-react";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { InfoPopover, InfoTerm } from "./InfoPopover";
import { getZenUsersFromCache } from "../store/useZenmoneyStore";
import { guessOwnerId, userLabel, type ZenUserOption } from "../lib/zenUsers";
import { useUserAliasStore } from "../store/useUserAliasStore";
import { useDataStore } from "../store/useDataStore";
import { usersInData } from "../lib/zenUsers";

/**
 * Люди на общем аккаунте Дзен-мани (issue #92).
 *
 * Карточки нет вовсе, пока человек один: на личном аккаунте настраивать нечего,
 * а пустой раздел «Пользователи» только сбивал бы с толку.
 *
 * Здесь две вещи, и обе — про то, как сервис к людям обращается, а не про сами
 * данные: как их звать (в фильтре «Жена» полезнее «user4821») и кто из них вы
 * (от этого зависит, чьи плановые операции показывать). В Дзен-мани отсюда
 * ничего не уезжает.
 */
export function UsersSettings() {
  const transactions = useDataStore((s) => s.transactions);
  const aliases = useUserAliasStore((s) => s.aliases);
  const ownerId = useUserAliasStore((s) => s.ownerId);
  const setAlias = useUserAliasStore((s) => s.setAlias);
  const setOwnerId = useUserAliasStore((s) => s.setOwnerId);
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

  // Показываем тех, кто есть в справочнике аккаунта, — включая человека без
  // единой операции: назвать его и отметить собой всё равно может понадобиться.
  // Порядок берём по числу операций, чтобы самый активный стоял первым.
  const ordered = useMemo(() => {
    const byActivity = usersInData(transactions);
    const rank = new Map(byActivity.map((id, i) => [id, i]));
    return [...users].sort(
      (a, b) => (rank.get(a.id) ?? 1e6) - (rank.get(b.id) ?? 1e6) || a.id - b.id
    );
  }, [users, transactions]);

  const effectiveOwner = guessOwnerId(users, ownerId);

  if (ordered.length < 2) return null;

  return (
    <div className="card-tray card-pad">
      <SettingsSectionHeader
        icon={UserRound}
        title="Пользователи аккаунта"
        className="mb-1"
        right={
          <InfoPopover label="Откуда берутся эти люди">
            <p>
              Дзен-мани разрешает подключить к аккаунту несколько человек, и по
              одному токену приезжают операции всех. Сервис показывает их
              вместе, а <InfoTerm>фильтр «Пользователи»</InfoTerm> в панели над
              списками даёт посмотреть кого-то одного.
            </p>
            <p>
              Имена и пометка «это я» живут <InfoTerm>только здесь</InfoTerm>: в
              Дзен-мани отсюда ничего не уезжает, чужой профиль мы не трогаем.
            </p>
          </InfoPopover>
        }
      />
      <p className="text-xs text-muted mb-3">
        Как звать людей на этом аккаунте и кто из них вы. От второго зависит,
        чьи плановые операции показывать на главной и в «Регулярных» — как в
        мобильном приложении, где чужие не видны.
      </p>

      <div className="space-y-2">
        {ordered.map((u) => {
          const isOwner = u.id === effectiveOwner;
          return (
            <div
              key={u.id}
              className="flex items-center gap-3 flex-wrap rounded-xl border border-border p-3"
            >
              <label className="flex items-center gap-2 cursor-pointer shrink-0">
                <input
                  type="radio"
                  name="zen-owner"
                  checked={isOwner}
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
                aria-label={`Имя для пользователя ${u.id}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
