// App-level error boundary. Without one, a render error in any single page
// (e.g. a chart receiving a degenerate size, or a data edge case) unmounts the
// WHOLE React tree — the user gets a blank white screen, nav and all. This
// catches the error, keeps the rest of the app (TopNav) alive, and shows a
// friendly fallback with the option to retry or reload.
//
// Error boundaries must be class components (no hooks equivalent). Wrap it with
// a `key` that changes on navigation so moving to another page clears the error.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to the console for debugging; the UI shows a friendly fallback.
    console.error("Ошибка отрисовки страницы:", error, info.componentStack);
  }

  handleRetry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="card-tray card-pad max-w-2xl mx-auto mt-8 space-y-4">
        <div className="flex items-center gap-2 font-semibold text-expense">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          Не удалось отобразить эту страницу
        </div>
        <p className="text-sm text-muted">
          Что-то пошло не так при построении этой страницы. Остальное приложение
          работает — попробуйте открыть её заново или вернуться на другую вкладку.
          Ваши данные не пострадали.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={this.handleRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-accent text-accent-fg"
          >
            <RotateCcw className="w-4 h-4" /> Попробовать снова
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-3 py-1.5 text-sm rounded-lg bg-panel2 border border-border text-muted hover:text-text"
          >
            Перезагрузить
          </button>
        </div>
        {error.message && (
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">Подробности ошибки</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] opacity-80">
              {error.message}
            </pre>
          </details>
        )}
      </div>
    );
  }
}
