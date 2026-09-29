import { UserRound } from "lucide-react";
import { profileLabel } from "../lib/profiles";
import { switchProfile, useProfiles } from "../hooks/useProfiles";
import { HeaderSwitcher } from "./HeaderSwitcher";

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
      items={profiles.map((p) => ({
        id: p.id,
        label: profileLabel(p),
        // Логин — вторым рядом, только если название своё: иначе оно и есть логин.
        hint: p.name.trim() && p.login ? p.login : null,
      }))}
      activeId={current.id}
      onPick={switchProfile}
      settings={{ to: "/settings?tab=source#accounts", label: "Управлять аккаунтами" }}
    />
  );
}
