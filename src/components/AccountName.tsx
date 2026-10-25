import { useAccountDirectory } from "../hooks/useAccountDirectory";

/**
 * Подпись счёта по ключу — одна на все ленты и таблицы. У тёзок с
 * уточнением («Т-Банк · Сбербанк»), у остальных — просто название.
 * `title` — запасная подпись, если ключа нет в справочнике.
 */
export function AccountName({
  accountKey,
  title,
  className,
}: {
  accountKey: string;
  title?: string;
  className?: string;
}) {
  const dir = useAccountDirectory();
  const label = dir.byKey.has(accountKey) ? dir.label(accountKey) : (title ?? accountKey);
  return (
    <span className={className} title={label}>
      {label}
    </span>
  );
}
