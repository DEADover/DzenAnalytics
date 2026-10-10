import clsx from "clsx";
import { ArrowRight, Check, FlaskConical, GraduationCap } from "lucide-react";
import { useDataStore } from "../../store/useDataStore";
import { startDemo } from "../../hooks/useDemo";
import { TOUR_CHAPTERS, chapterDuration } from "../../lib/tour";
import { pluralRu } from "../../lib/plural";
import { tourProgress, useTourStore } from "../../store/useTourStore";
import { Modal, ModalBody, ModalHeader } from "../Modal";

/**
 * Центр обучения: все главы карточками — значок, о чём, какие темы внутри,
 * сколько займёт и пройдена ли. Сверху — общий прогресс кольцом. Щелчок по главе закрывает
 * окно и запускает тур прямо по живой панели.
 */
export function TourHub() {
  const open = useTourStore((s) => s.hubOpen);
  const done = useTourStore((s) => s.done);
  const close = useTourStore((s) => s.closeHub);
  const startNow = useTourStore((s) => s.start);
  const startWhenReady = useTourStore((s) => s.startWhenReady);
  const hasData = useDataStore((s) => s.transactions.length > 0);
  // Без данных учиться не на чем: подсвечивать нечего, кроме пустых мест.
  // Тогда глава идёт на демо-данных — выдуманная семья в отдельном аккаунте,
  // настоящий не задевается. Демо перезагружает страницу; глава запустится,
  // как только данные загрузятся (`pending` в сторе обучения).
  const start = (id: string) => {
    if (hasData) return startNow(id);
    startWhenReady(id);
    void startDemo();
  };
  if (!open) return null;
  const p = tourProgress(done);
  const share = p.total ? p.done / p.total : 0;
  const R = 22;
  const C = 2 * Math.PI * R;

  return (
    <Modal onClose={close} width="2xl">
      <ModalHeader icon={GraduationCap} title="Центр обучения" />
      <ModalBody gap={4}>
        <div className="flex items-center gap-4">
          <svg viewBox="0 0 52 52" className="w-14 h-14 shrink-0 -rotate-90" aria-hidden>
            <circle cx="26" cy="26" r={R} fill="none" strokeWidth="5" className="stroke-border" />
            <circle
              cx="26"
              cy="26"
              r={R}
              fill="none"
              strokeWidth="5"
              strokeLinecap="round"
              className="stroke-accent transition-[stroke-dashoffset] duration-700"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - share)}
            />
          </svg>
          <div>
            <div className="font-semibold">
              Пройдено {p.done} из {p.total}
            </div>
            <p className="text-sm text-muted">
              Туры прямо по интерфейсу сервиса: подсвечиваем нужное место и объясняем, что оно умеет. Любую главу можно
              пройти ещё раз.
            </p>
          </div>
        </div>

        {!hasData && (
          <div className="rounded-2xl border border-accent/30 bg-accent/5 p-4 flex gap-3 text-sm">
            <FlaskConical className="w-5 h-5 text-accent shrink-0 mt-0.5" aria-hidden />
            <p>
              <span className="font-medium">Данных пока нет — обучение пройдёт на демо-данных.</span>{" "}
              <span className="text-muted">
                Это выдуманная семья в отдельном аккаунте: ваши данные он не затрагивает. Выбранная глава
                начнётся, как только демо загрузится, а выйти из демо можно кнопкой на плашке сверху.
              </span>
            </p>
          </div>
        )}

        <div className="space-y-3">
          {TOUR_CHAPTERS.map((c, i) => {
            const passed = done.includes(c.id);
            const Icon = c.icon;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => start(c.id)}
                className="tour-hub-card group w-full text-left rounded-2xl border border-border bg-panel2/40 p-4 flex gap-4 transition-colors hover:border-accent/60 hover:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <span
                  className={clsx(
                    "relative w-11 h-11 shrink-0 rounded-xl flex items-center justify-center",
                    passed ? "bg-income/10 text-income" : "bg-accent/10 text-accent"
                  )}
                >
                  <Icon className="w-5 h-5" />
                  {passed && (
                    <span className="absolute -right-1 -bottom-1 w-4 h-4 rounded-full bg-income text-on-tone flex items-center justify-center">
                      <Check className="w-3 h-3" strokeWidth={3} />
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">{c.title}</span>
                    <span className="text-xs text-muted shrink-0 tabular-nums">
                      {chapterDuration(c)} · {c.steps.length} {pluralRu(c.steps.length, ["шаг", "шага", "шагов"])}
                    </span>
                  </span>
                  <span className="block text-sm text-muted mt-0.5">{c.summary}</span>
                  <span className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    {c.topics.map((t) => (
                      <span key={t} className="chip chip-sm">
                        {t}
                      </span>
                    ))}
                    <span className="ml-auto inline-flex items-center gap-1 text-sm text-accent font-medium">
                      {!hasData ? "Начать на демо" : passed ? "Пройти ещё раз" : "Начать"}
                      <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </ModalBody>
    </Modal>
  );
}
