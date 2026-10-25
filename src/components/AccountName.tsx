import { useAccountDirectory } from "../hooks/useAccountDirectory";

/**
 * Подпись счёта по ключу — одна на все ленты и таблицы. У тёзок с
 * уточнением («Т-Банк · Сбербанк»), у остальных — просто название.
 * `title` — запасная подпись, если ключа нет в справочнике. С `toKey` —
 * пара счетов перевода: «Откуда → Куда».
 */
export function AccountName({
  accountKey,
  title,
  toKey,
  toTitle,
  className,
}: {
  accountKey: string;
  title?: string;
  toKey?: string | null;
  toTitle?: string | null;
  className?: string;
}) {
  const dir = useAccountDirectory();
  const name = (key: string, fallback?: string | null) =>
    dir.byKey.has(key) ? dir.label(key) : (fallback ?? key);
  const from = name(accountKey, title);
  const label = toKey || toTitle ? `${from} → ${name(toKey || toTitle || "", toTitle)}` : from;
  return (
    <span className={className} title={label}>
      {label}
    </span>
  );
}
