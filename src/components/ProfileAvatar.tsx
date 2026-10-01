import clsx from "clsx";
import { profileLabel, type Profile } from "../lib/profiles";
import { hueFromString } from "../lib/colorHash";

/** Буквы аккаунта без фото: первые буквы двух первых слов, иначе одна. */
function initials(label: string): string {
  const words = label.trim().split(/[\s@._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  const two = words.length > 1 ? words[0][0] + words[1][0] : words[0][0];
  return two.toUpperCase();
}

/**
 * Круглый аватар аккаунта: фото, если его поставили, иначе буквы на цвете —
 * оттенок постоянный для аккаунта (по id), как буквенные значки счетов.
 */
export function ProfileAvatar({
  profile,
  size = 24,
  className,
}: {
  profile: Pick<Profile, "id" | "name" | "login" | "avatar">;
  size?: number;
  className?: string;
}) {
  const label = profileLabel(profile);
  const box = clsx("rounded-full shrink-0 inline-block overflow-hidden", className);
  if (profile.avatar) {
    return (
      <img
        src={profile.avatar}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={clsx(box, "object-cover bg-panel2")}
        style={{ width: size, height: size }}
      />
    );
  }
  const hue = hueFromString(profile.id + label);
  return (
    <span
      aria-hidden="true"
      className={clsx(box, "inline-flex items-center justify-center font-semibold leading-none select-none")}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * (initials(label).length > 1 ? 0.38 : 0.44)),
        background: `hsl(${hue} 70% 90%)`,
        color: `hsl(${hue} 50% 32%)`,
      }}
    >
      {initials(label)}
    </span>
  );
}
