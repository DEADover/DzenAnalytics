import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Cloud, FlaskConical, Lock, Upload, type LucideIcon } from "lucide-react";
import { Badge } from "./Badge";
import { startDemo } from "../hooks/useDemo";

/** Карточка одного способа начать: значок, название, пояснение, действие внизу. */
function StartCard({
  icon: Icon,
  title,
  badge,
  action,
  children,
}: {
  icon: LucideIcon;
  title: string;
  badge?: string;
  /** Подпись действия внизу карточки: «Подключить», «Загрузить»… */
  action: string;
  children: ReactNode;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-accent/10 text-accent shrink-0">
          <Icon className="w-5 h-5" />
        </span>
        {badge && <Badge tone="accent">{badge}</Badge>}
      </div>
      <div className="mt-4 font-semibold text-[15px]">{title}</div>
      <p className="mt-1.5 text-sm text-muted flex-1">{children}</p>
      <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent">
        {action}
        <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </>
  );
}

const CARD =
  "group flex flex-col text-left rounded-[18px] border border-border bg-panel2/40 p-5 transition-colors " +
  "hover:border-accent/60 hover:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

/**
 * Пустая панель — на каждом разделе, пока данных нет. Три способа начать
 * одинаковыми карточками: подключить Дзен-мани (рекомендуем), загрузить
 * CSV-выгрузку или посмотреть демо-данные выдуманной семьи. Подключение и CSV
 * ведут в нужную вкладку «Настройки → Источник данных», демо открывается сразу.
 */
export function EmptyState() {
  return (
    <div className="card-tray card-pad flex flex-col items-center text-center py-12 md:py-16 gap-8">
      {/* Без знака сервиса: он уже стоит в шапке, второй на экране — лишний. */}
      <div className="flex flex-col items-center gap-4 max-w-xl">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">С чего начнём?</h1>
          <p className="mt-2 text-sm text-muted text-balance">
            Подключите свой аккаунт Дзен-мани для онлайн-синхронизации по API или
            загрузите CSV-выгрузку из приложения.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-4xl">
        <Link to="/settings?source=api" className={CARD}>
          <StartCard icon={Cloud} title="Подключить Дзен-мани" badge="Рекомендуем" action="Подключить">
            Онлайн-синхронизация по API: операции, счета и категории подтянутся
            сами и будут обновляться.
          </StartCard>
        </Link>
        <Link to="/settings?source=csv" className={CARD}>
          <StartCard icon={Upload} title="Загрузить CSV" action="Загрузить">
            Выгрузка из приложения Дзен-мани — для разовой аналитики без
            подключения.
          </StartCard>
        </Link>
        <button type="button" onClick={startDemo} className={CARD}>
          <StartCard icon={FlaskConical} title="Посмотреть демо" action="Открыть демо-данные">
            Выдуманная семья: почти два года операций, бюджеты и планы. Ничего
            никуда не отправляется.
          </StartCard>
        </button>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-muted">
        <Lock className="w-3.5 h-3.5" aria-hidden="true" />
        Данные хранятся только в вашем браузере и не попадают на наш сервер.
      </div>
    </div>
  );
}
