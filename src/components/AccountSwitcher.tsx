import { UserRound } from "lucide-react";
import { profileLabel } from "../lib/profiles";
import { switchProfile, useProfiles } from "../hooks/useProfiles";
import { HeaderSwitcher } from "./HeaderSwitcher";
import { ProfileAvatar } from "./ProfileAvatar";

/**
 * Быстрый переход между аккаунтами — в дорожке данных шапки.
 *
 * Появляется, только когда аккаунтов больше одного: у большинства он один, и
 * лишняя плашка в шапке была бы шумом. Завести второй — в «Настройки →
 * Данные → Аккаунты».
 */
export function AccountSwitcher() {
  const { profiles, activeId } = useProfiles();
  if (profiles.length < 2) return null;
  const current = profiles.find((p) => p.id === activeId) ?? profiles[0];
  const label = profileLabel(current);
  return (
    <HeaderSwitcher
      icon={UserRound}
      current={label}
      title={`Аккаунт: ${label}\nУ каждого аккаунта свои данные`}
      ariaLabel={`Аккаунт: ${label}`}
      heading="Аккаунт"
      // Круглый аватар вместо значка и имени: узнаётся с одного взгляда, а
      // имя — в подсказке и в списке.
      face={<ProfileAvatar profile={current} size={24} />}
      items={profiles.map((p) => ({
        id: p.id,
        label: profileLabel(p),
        // Логин — вторым рядом, только если название своё: иначе оно и есть логин.
        hint: p.name.trim() && p.login ? p.login : null,
        leading: <ProfileAvatar profile={p} size={24} />,
      }))}
      activeId={current.id}
      onPick={switchProfile}
      settings={{ to: "/settings?tab=source#accounts", label: "Управлять аккаунтами" }}
    />
  );
}
