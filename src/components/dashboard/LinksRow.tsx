/**
 * Полоска с кнопками на главной: быстрые переходы в разделы, выбранные человеком.
 *
 * Дублировать меню — намеренно: меню отвечает на «куда я могу пойти», а эти
 * кнопки — на «куда я хожу каждый день». Поэтому и состав свой: у одного это
 * бюджеты и цели, у другого — дубликаты и правила.
 *
 * В полоске ровно шесть мест, и место может пустовать. Ряд из шести плиток ещё
 * читается с одного взгляда, а где в нём стоят кнопки и где дырки — дело
 * человека: пустое место между кнопками разделяет их не хуже заголовка. Кому
 * нужно больше шести, тот ставит вторую полоску.
 *
 * В режиме настройки полоска правится на месте: пустое место зовёт плюсом,
 * кнопка перетаскивается на любое другое место, крестик её снимает. Настраивать
 * полоску в отдельном окне было бы дальше от того, что человек видит.
 */

import { useState, type DragEvent } from "react";
import clsx from "clsx";
import { Link } from "react-router-dom";
import { Plus, X } from "lucide-react";
import { SECONDARY_GROUPS, navSection, type NavSection } from "../../lib/navSections";
import { LINK_SLOTS, type LinkSlots } from "../../lib/dashboardLayout";

/** Сетка ряда. Шесть колонок на большом экране — по числу мест в полоске. */
const GRID = "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4";

/** Обойма плитки: тот же двойной кант, что у карточек. */
const TILE = "group block w-full rounded-[18px] p-1.5 bg-panel2/70 border border-border/70 shadow-tray";

/**
 * Та же плитка живой ссылкой. В режиме настройки она никуда не ведёт, и
 * подсветка под курсором обещала бы переход, которого не будет.
 */
const TILE_LINK =
  TILE +
  " transition-colors duration-200 hover:border-accent/40" +
  " focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

function TileFace({ section }: { section: NavSection }) {
  const Icon = section.icon;
  return (
    <span className="rounded-[12px] bg-panel px-4 py-3.5 flex items-center gap-3">
      <Icon className="w-5 h-5 text-accent shrink-0" aria-hidden="true" />
      <span className="font-semibold text-[14.5px] group-hover:text-accent truncate">
        {section.label}
      </span>
    </span>
  );
}

/** Метка перетаскиваемой кнопки: своя, чтобы её не спутали с плиткой виджета. */
const DRAG_PREFIX = "dzen-link:";

export function LinksRow({
  links,
  editing,
  onChange,
}: {
  links: LinkSlots;
  editing: boolean;
  onChange: (links: LinkSlots) => void;
}) {
  /** Для какого места открыт список разделов. */
  const [picking, setPicking] = useState<number | null>(null);
  /** Какую кнопку сейчас везут и над каким местом держат. */
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const slots: LinkSlots = Array.from(
    { length: LINK_SLOTS },
    (_, i) => links[i] ?? null
  );
  const filled = slots.filter(Boolean).length;

  if (!editing) {
    return (
      <div className={GRID}>
        {slots.map((to, i) => {
          const section = to ? navSection(to) : undefined;
          // Пустое место занимает свою колонку и в обычном виде: иначе кнопки
          // сползлись бы влево, и дырка, которую человек оставил нарочно,
          // исчезла бы.
          if (!section) return <div key={i} aria-hidden="true" />;
          return (
            // Подпись в плитке узкая и длинные названия обрезает — полное имя и
            // строчку о том, что внутри, даёт подсказка.
            <Link
              key={i}
              to={section.to}
              title={`${section.label}\n${section.hint}`}
              className={TILE_LINK}
            >
              <TileFace section={section} />
            </Link>
          );
        })}
      </div>
    );
  }

  /** Положить раздел на место, освободив то, где он стоял раньше. */
  const put = (at: number, to: string) => {
    const next = slots.map((v, i) => (v === to && i !== at ? null : v));
    next[at] = to;
    onChange(next);
  };

  /** Перенести кнопку на другое место; занятое — меняется с ней местами. */
  const swap = (from: number, at: number) => {
    if (from === at) return;
    const next = slots.slice();
    [next[from], next[at]] = [next[at], next[from]];
    onChange(next);
  };

  const dropProps = (at: number) => ({
    onDragEnter: (e: DragEvent) => {
      e.stopPropagation();
      setDragOver(at);
    },
    onDragOver: (e: DragEvent) => {
      // Без этого браузер бросок не разрешит. Остановка всплытия — чтобы жест
      // не считала своим ещё и плитка виджета: она тоже умеет принимать броски.
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(null);
      setDragFrom(null);
      const raw = e.dataTransfer.getData("text/plain");
      if (!raw.startsWith(DRAG_PREFIX)) return;
      const from = Number(raw.slice(DRAG_PREFIX.length));
      if (Number.isInteger(from) && from >= 0 && from < LINK_SLOTS) swap(from, at);
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <div className={GRID}>
        {slots.map((to, i) => {
          const section = to ? navSection(to) : undefined;
          const target = dragOver === i && dragFrom !== null && dragFrom !== i;

          if (!section) {
            return (
              <button
                key={i}
                type="button"
                {...dropProps(i)}
                onClick={() => setPicking((v) => (v === i ? null : i))}
                // Строкой в кавычках перевод строки не пройдёт: JSX не
                // разбирает в атрибуте escape-последовательности.
                title={"Поставить кнопку\nИли перетащите сюда соседнюю"}
                aria-label="Поставить кнопку на это место"
                className={clsx(
                  "rounded-[18px] border border-dashed grid place-items-center min-h-[68px]",
                  "transition-colors duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                  target
                    ? "border-accent bg-accent/10 text-accent"
                    : picking === i
                      ? "border-accent text-accent"
                      : "border-border text-muted hover:border-accent/50 hover:text-accent"
                )}
              >
                <Plus className="w-5 h-5" aria-hidden="true" />
              </button>
            );
          }

          return (
            <div
              key={i}
              {...dropProps(i)}
              draggable
              onDragStart={(e) => {
                e.stopPropagation();
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", `${DRAG_PREFIX}${i}`);
                setDragFrom(i);
              }}
              onDragEnd={(e) => {
                e.stopPropagation();
                setDragFrom(null);
                setDragOver(null);
              }}
              className={clsx(
                "relative rounded-[18px] cursor-grab active:cursor-grabbing",
                dragFrom === i && "opacity-30",
                target && "ring-2 ring-accent"
              )}
            >
              {/* Не ссылка: в режиме настройки нажатие на кнопку должно её
                  менять, а не уводить со страницы посреди перестановки. */}
              <button
                type="button"
                onClick={() => setPicking((v) => (v === i ? null : i))}
                title={`${section.label}\nПеретащите на другое место или нажмите, чтобы заменить`}
                className={clsx(
                  TILE,
                  "text-left transition-colors duration-200",
                  picking === i ? "border-accent" : "hover:border-accent/40",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                )}
              >
                <TileFace section={section} />
              </button>
              <button
                type="button"
                disabled={filled <= 1}
                title={
                  filled <= 1
                    ? "Последнюю кнопку убрать нельзя\nБез единой кнопки полоска превращается в пустое место; уберите её целиком"
                    : `Убрать «${section.label}» из полоски`
                }
                aria-label={`Убрать «${section.label}» из полоски`}
                onClick={() => onChange(slots.map((v, j) => (j === i ? null : v)))}
                className="absolute -top-2 right-0 w-6 h-6 rounded-full grid place-items-center
                           bg-panel border border-border shadow-tray text-muted
                           transition-colors duration-200
                           hover:text-expense hover:border-expense/40
                           disabled:opacity-40 disabled:hover:text-muted disabled:hover:border-border
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>

      {picking !== null && (
        <div className="rounded-[14px] border border-border bg-panel p-4 flex flex-col gap-3">
          {SECONDARY_GROUPS.map((group) => (
            <div key={group.title}>
              <div className="flex items-center gap-3 mb-2">
                <h4 className="text-[11.5px] uppercase tracking-[0.12em] text-muted font-medium">
                  {group.title}
                </h4>
                <span className="flex-1 h-px bg-border" />
              </div>
              <div className="flex flex-wrap gap-2">
                {group.items.map((s) => {
                  const here = slots[picking] === s.to;
                  const Icon = s.icon;
                  return (
                    <button
                      key={s.to}
                      type="button"
                      disabled={here}
                      title={here ? `«${s.label}» уже стоит на этом месте` : s.hint}
                      onClick={() => {
                        put(picking, s.to);
                        setPicking(null);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border
                                 bg-panel2/60 px-3 py-1.5 text-[13px] font-medium
                                 transition-colors duration-200
                                 hover:border-accent/50 hover:text-accent
                                 disabled:opacity-40 disabled:hover:text-text disabled:hover:border-border
                                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    >
                      <Icon className="w-3.5 h-3.5 text-accent shrink-0" aria-hidden="true" />
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
