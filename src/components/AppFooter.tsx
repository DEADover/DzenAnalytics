import { useState } from "react";
import { Heart, History, Send } from "lucide-react";
import { ChangelogModal } from "./ChangelogModal";
import { GithubMark } from "./GithubMark";
import { useDisplayStore } from "../store/useDisplayStore";
import { CHANNEL_TITLE, CHANNEL_URL, PROJECT_URL, SUPPORT_TITLE, SUPPORT_URL } from "../lib/support";
import { formatReleaseDate, parseRelease } from "../lib/releaseInfo";
import changelogRaw from "../../CHANGELOG.md?raw";

/**
 * Подвал сервиса: версия, дата выпуска и ссылки — одной тонкой строкой.
 *
 * То же самое лежит в справке, разделом «О сервисе», но туда ещё надо дойти.
 * Здесь это фон: строка не перетягивает внимание — приглушённый текст и серые
 * значки без подписей, — но отвечает на вопросы «какая у меня версия» и «куда
 * написать», не уводя со страницы.
 *
 * Значки без подписей намеренно: четыре кнопки со словами читались бы как
 * панель действий, а подвал — не панель. Что именно за значком, говорит
 * подсказка при наведении.
 */
export function AppFooter() {
  const [changelogOpen, setChangelogOpen] = useState(false);
  const hideThanks = useDisplayStore((s) => s.hideThanks);
  const release = parseRelease(changelogRaw, __APP_VERSION__);

  return (
    <footer className="w-full px-4 md:px-6 pb-4 md:pb-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-3 text-xs text-muted">
        {/* Одной строкой: версия и дата выпуска — это одна мысль, а не два
            факта через разделитель. */}
        <span className="font-medium text-text/80">
          DzenAnalytics <span className="tabular-nums">V{__APP_VERSION__}</span>
          {release?.date && (
            <span className="font-normal text-muted"> ({formatReleaseDate(release.date)})</span>
          )}
        </span>

        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setChangelogOpen(true)}
            className="btn-icon"
            title="Что нового"
            aria-label="Что нового"
          >
            <History className="w-4 h-4" />
          </button>
          <a
            href={PROJECT_URL}
            target="_blank"
            rel="noreferrer"
            className="btn-icon"
            title="Исходный код на GitHub"
            aria-label="Исходный код на GitHub"
          >
            <GithubMark className="w-4 h-4" />
          </a>
          <a
            href={CHANNEL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-icon"
            title={CHANNEL_TITLE}
            aria-label={CHANNEL_TITLE}
          >
            <Send className="w-4 h-4" />
          </a>
          {/* Сердечко подчиняется той же настройке, что и значок в шапке: она
              про «не показывать просьбу на каждой странице», а подвал виден
              всюду. В справке оно остаётся всегда — туда приходят сами. */}
          {!hideThanks && (
            <a
              href={SUPPORT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-icon hover:text-expense"
              title={SUPPORT_TITLE}
              aria-label={SUPPORT_TITLE}
            >
              <Heart className="w-4 h-4" />
            </a>
          )}
        </div>
      </div>

      <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
    </footer>
  );
}
