import { useState } from "react";
import { Cloud, ExternalLink, Eye, EyeOff, Link as LinkIcon, Loader2, Lock, TriangleAlert } from "lucide-react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "./Modal";
import { useConnectStore } from "../store/useConnectStore";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { toast } from "../store/useToastStore";

/**
 * Подключение Дзен-мани по токену — прямо с первого экрана, без ухода в
 * настройки. Три шага по порядку: открыть страницу токена, скопировать,
 * вставить. Пока идёт первая загрузка, окно остаётся и показывает, что
 * происходит: она бывает долгой, и пустой экран за ним выглядел бы зависшим.
 *
 * Ставится ОДИН раз в корне приложения; открывается через `connectZen()`.
 */
export function ConnectZenDialog() {
  const open = useConnectStore((s) => s.open);
  if (!open) return null;
  return <Dialog />;
}

function Dialog() {
  const hide = useConnectStore((s) => s.hide);
  const status = useZenmoneyStore((s) => s.status);
  const error = useZenmoneyStore((s) => s.error);
  const [token, setToken] = useState("");
  const [visible, setVisible] = useState(false);
  const [running, setRunning] = useState(false);
  // Ошибку стора показываем только после своей попытки: там может лежать
  // прежняя, не про этот токен.
  const [tried, setTried] = useState(false);

  const busy = running || status === "checking" || status === "syncing";

  async function connect() {
    if (!token.trim() || busy) return;
    setRunning(true);
    setTried(true);
    try {
      const zen = useZenmoneyStore.getState();
      if (!(await zen.validateAndSaveToken(token))) return;
      await useZenmoneyStore.getState().sync({ force: true });
      hide();
      toast("Дзен-мани подключён");
    } catch {
      /* ошибка — в сторе, окно её покажет */
    } finally {
      setRunning(false);
    }
  }

  return (
    <Modal onClose={hide} busy={busy} width="lg">
      <ModalHeader icon={Cloud} title="Подключить Дзен-мани" />
      <ModalBody gap={3}>
        <ol className="space-y-3 text-sm">
          <Step n={1}>
            Откройте страницу токена и войдите своим логином от{" "}
            <span className="whitespace-nowrap">Дзен-мани:</span>{" "}
            <a
              href="https://zerro.app/token"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline inline-flex items-center gap-0.5 whitespace-nowrap"
            >
              zerro.app/token <ExternalLink className="w-3 h-3" aria-hidden />
            </a>
          </Step>
          <Step n={2}>Скопируйте строку токена.</Step>
          <Step n={3}>
            Вставьте её сюда:
            <form
              className="relative mt-2"
              onSubmit={(e) => {
                e.preventDefault();
                void connect();
              }}
            >
              <input
                type={visible ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Вставьте токен"
                aria-label="Токен Дзен-мани"
                className="input text-sm pr-9 w-full font-mono"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                disabled={busy}
              />
              <button
                type="button"
                onClick={() => setVisible((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"
                aria-label={visible ? "Скрыть токен" : "Показать токен"}
              >
                {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </form>
          </Step>
        </ol>

        {tried && error && !busy && (
          <p className="flex items-start gap-2 text-sm text-expense" role="alert">
            <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
            <span>{error}</span>
          </p>
        )}
        {busy && (
          <p className="flex items-center gap-2 text-sm text-muted" role="status">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden />
            {status === "syncing"
              ? "Загружаю операции, счета и категории — при первом подключении это может занять минуту"
              : "Проверяю токен…"}
          </p>
        )}

        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Lock className="w-3.5 h-3.5 shrink-0" aria-hidden />
          Токен и данные хранятся только в этом браузере.
        </p>
      </ModalBody>
      <ModalFooter>
        <button type="button" onClick={hide} disabled={busy} className="btn-ghost text-sm">
          Отмена
        </button>
        <button
          type="button"
          onClick={() => void connect()}
          disabled={!token.trim() || busy}
          className="btn-primary text-sm"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <LinkIcon className="w-3.5 h-3.5" aria-hidden />}
          Подключить
        </button>
      </ModalFooter>
    </Modal>
  );
}

/** Шаг по порядку: номер в кружке и текст. Порядок здесь и правда важен. */
function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="w-6 h-6 shrink-0 rounded-full bg-accent/10 text-accent text-xs font-semibold grid place-items-center tabular-nums">
        {n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">{children}</div>
    </li>
  );
}
