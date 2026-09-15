import { History } from "lucide-react";
import { ChangelogView } from "./ChangelogView";
import { Modal, ModalBody, ModalHeader } from "./Modal";
import { GithubMark } from "./GithubMark";
import { PROJECT_URL } from "../lib/support";

/**
 * История изменений в окне. Открывается ссылкой «Что нового» в шапке «Справки»;
 * текст — ChangelogView (CHANGELOG.md).
 */
export function ChangelogModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <Modal onClose={onClose} width="2xl">
      <ModalHeader
        icon={History}
        tone="accent2"
        title="История изменений"
        actions={
          <a
            href={PROJECT_URL}
            target="_blank"
            rel="noreferrer"
            className="text-muted hover:text-accent transition-colors flex items-center gap-1.5 text-xs"
            title="Проект на GitHub"
          >
            <GithubMark className="w-4 h-4" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
        }
      />
      <ModalBody scroll>
        <ChangelogView />
      </ModalBody>
    </Modal>
  );
}
