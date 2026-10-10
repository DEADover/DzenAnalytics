import clsx from "clsx";
import { ArrowRight, Check, GraduationCap } from "lucide-react";
import { TOUR_CHAPTERS, chapterDuration } from "../../lib/tour";
import { pluralRu } from "../../lib/plural";
import { tourProgress, useTourStore } from "../../store/useTourStore";
import { Modal, ModalBody, ModalHeader } from "../Modal";

/**
 * Центр обучения: все главы карточками — значок, о чём, сколько займёт и
 * пройдена ли. Сверху — общий прогресс кольцом. Щелчок по главе закрывает
 * окно и запускает тур прямо по живой панели.
 */
export function TourHub() {
  const open = useTourStore((s) => s.hubOpen);
  const done = useTourStore((s) => s.done);
  const close = useTourStore((s) => s.closeHub);
  const start = useTourStore((s) => s.start);
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
              Короткие туры прямо по панели: подсвечиваем нужное место и объясняем. Любую главу можно пройти
              ещё раз.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {TOUR_CHAPTERS.map((c, i) => {
            const passed = done.includes(c.id);
            const Icon = c.icon;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => start(c.id)}
                className="tour-hub-card group text-left rounded-2xl border border-border bg-panel2/40 p-4 flex gap-3 transition-colors hover:border-accent/60 hover:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <span
                  className={clsx(
                    "relative w-10 h-10 shrink-0 rounded-xl flex items-center justify-center",
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
                  <span className="block font-medium text-sm">{c.title}</span>
                  <span className="block text-xs text-muted mt-0.5">{c.summary}</span>
                  <span className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                    {chapterDuration(c)} · {c.steps.length} {pluralRu(c.steps.length, ["шаг", "шага", "шагов"])}
                    <span className="ml-auto inline-flex items-center gap-1 text-accent font-medium">
                      {passed ? "Ещё раз" : "Начать"}
                      <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
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
