import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, UserRound } from "lucide-react";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { InfoPopover, InfoTerm } from "./InfoPopover";
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
        title="Совместный доступ"
        className="mb-1"
        right={
          <InfoPopover label="Откуда берутся участники">
            <p>
              К аккаунту Дзен-мани можно подключить несколько человек. По одному
              токену загружаются данные всех — включая счета, которые кто-то из
              них пометил <InfoTerm>личными</InfoTerm>.
            </p>
            <p>
              Сам Дзен-мани такие счета от остальных прячет: их не видно ни в
              приложении, ни на сайте. Но по API они приходят всем — поэтому
              прячем их мы. Для этого и нужно знать, кто из списка вы.
            </p>
            <p>
              Имя и отметка живут <InfoTerm>только здесь</InfoTerm>: в Дзен-мани
              отсюда ничего не уезжает, чужой профиль мы не трогаем.
            </p>
          </InfoPopover>
        }
      />
      <p className="text-xs text-muted mb-3">
        Здесь сервис узнаёт, какие личные счета и операции ваши, а какие —
        других участников совместного доступа. Имя любого из них можно изменить
        прямо в строке: щёлкните по нему.
      </p>

      {ownerId == null && (
        <div className="flex items-start gap-2 rounded-xl border border-warn/40 bg-warn/5 p-3 text-xs mb-3">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-warn" />
          <span>
            <strong>Отметьте себя.</strong> Пока отметки нет, видны личные счета
            всех участников: по данным Дзен-мани не определить, чей это токен, а
            угадывать здесь нельзя — ошибка открыла бы чужие счета и спрятала
            ваши.
            {suggested != null && (
              <> Похоже, что вы {userLabel(suggested, users, aliases)}.</>
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
            <input
              type="radio"
              name="zen-owner"
              checked={u.id === ownerId}
              onChange={() => setOwnerId(u.id)}
              className="shrink-0 cursor-pointer"
              aria-label={`Это я — ${userLabel(u.id, users, aliases)}`}
            />
            <div className="min-w-0 flex-1">
              {/* Имя правится на месте, а не в отдельном поле справа: поле
                  дублировало ту же строку в полуметре от неё, и было неясно,
                  какая из двух настоящая. Пустое значение показывает логин
                  подсказкой — то же, что видно и без правки. */}
              <input
                // Подсказка набрана как обычный текст, а не бледным: пустое
                // поле значит «звать по логину», и логин в нём — не намёк, а
                // то самое имя, которое человек увидит везде. Бледным он
                // выглядел незаполненным рядом с соседом, у кого имя задано.
                className="w-full bg-transparent text-sm font-medium rounded px-1 -mx-1
                           border border-transparent hover:border-border
                           focus:outline-none focus:border-accent focus:bg-panel2
                           placeholder:text-text placeholder:font-medium
                           transition-colors"
                placeholder={u.login ?? `Пользователь ${u.id}`}
                defaultValue={aliases[String(u.id)] ?? ""}
                onBlur={(e) => setAlias(u.id, e.target.value)}
                aria-label={`Как называть участника ${u.id}`}
              />
              <div className="text-[11px] text-muted tabular-nums px-1 -mx-1">
                {u.login ? `${u.login} · ` : ""}
                {u.id}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Сам переключатель переехал в «Оформление» — он про то, ЧТО
          показывать. Здесь остаётся указатель: человек, отметивший себя,
          логично ищет продолжение рядом. */}
      <p className="text-[11px] text-muted border-t border-border pt-3 mt-4">
        {hideForeign
          ? "Личные счета других участников сейчас скрыты."
          : "Личные счета других участников сейчас видны."}{" "}
        Переключается на вкладке «Оформление».
      </p>
    </div>
  );
}
