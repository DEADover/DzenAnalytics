import { Link } from "react-router-dom";
import { Cloud, Upload } from "lucide-react";

/**
 * Shown on every analytics page while there are no transactions yet.
 * Offers the two ways to get data in — online sync via the Zenmoney API
 * (recommended) or a one-off CSV import — each deep-linking to the right
 * sub-tab of the settings "source" panel.
 */
export function EmptyState() {
  return (
    <div className="card-tray card-pad flex flex-col items-center justify-center text-center py-14 gap-6">
      <div>
        <div className="text-lg font-semibold mb-1">Нет данных</div>
        <div className="text-sm text-muted">
          Подключите Дзен-мани для онлайн-синхронизации или загрузите
          CSV-выгрузку — и появится аналитика
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-2xl">
        <Link
          to="/settings?source=api"
          className="rounded-xl border border-border bg-panel2/40 p-5 text-left transition-colors hover:border-accent hover:bg-panel2"
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-accent/10 text-accent shrink-0">
              <Cloud className="w-5 h-5" />
            </span>
            <span className="font-semibold">Подключить Дзен-мани</span>
            <span className="ml-auto text-[11px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent shrink-0">
              Рекомендуем
            </span>
          </div>
          <p className="text-sm text-muted">
            Онлайн-синхронизация по токену API: операции, счета и категории
            подтянутся автоматически и будут обновляться.
          </p>
        </Link>
        <Link
          to="/settings?source=csv"
          className="rounded-xl border border-border bg-panel2/40 p-5 text-left transition-colors hover:border-accent hover:bg-panel2"
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-accent/10 text-accent shrink-0">
              <Upload className="w-5 h-5" />
            </span>
            <span className="font-semibold">Загрузить CSV</span>
          </div>
          <p className="text-sm text-muted">
            Офлайн-импорт CSV-выгрузки из приложения Дзен-мани. Подходит для
            разовой аналитики без токена.
          </p>
        </Link>
      </div>
    </div>
  );
}
