/**
 * Дорожка кнопок на главной: быстрые переходы в разделы, выбранные человеком.
 *
 * Дублировать меню — намеренно: меню отвечает на «куда я могу пойти», а эти
 * кнопки — на «куда я хожу каждый день». Поэтому и состав свой: у одного это
 * бюджеты и цели, у другого — дубликаты и правила.
 *
 * Кнопок в дорожке от одной до шести. Шесть — потому что ряд из шести плиток
 * ещё читается с одного взгляда, а из десяти уже нет; кому нужно больше, тот
 * ставит вторую дорожку. Ряд всегда размечен на шесть колонок, даже если кнопок
 * три: тогда плитки одного размера в любой дорожке, а не растягиваются на всю
 * ширину поодиночке.
 *
 * В режиме настройки дорожка правится на месте: у каждой кнопки крестик, под
 * рядом — «Добавить», за ней разворачивается тот же список разделов, что и в
 * «Ещё». Настраивать её в отдельном окне было бы дальше от того, что человек
 * видит.
 */

import { useState } from "react";
import clsx from "clsx";
import { Link } from "react-router-dom";
import { Plus, X } from "lucide-react";
import { SECONDARY_GROUPS, navSection, type NavSection } from "../../lib/navSections";
import { MAX_LINKS, MIN_LINKS } from "../../lib/dashboardLayout";

/** Сетка ряда. Шесть колонок на большом экране — по числу мест в дорожке. */
const GRID = "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4";

/** Обойма плитки: тот же двойной кант, что у карточек. */
const TILE = "group block rounded-[18px] p-1.5 bg-panel2/70 border border-border/70 shadow-tray";

/** Та же плитка живой ссылкой. В режиме настройки она никуда не ведёт, и
 *  подсветка под курсором обещала бы переход, которого не будет. */
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

export function LinksRow({
  links,
  editing,
  onChange,
}: {
  links: readonly string[];
  editing: boolean;
  onChange: (links: string[]) => void;
}) {
  const [picking, setPicking] = useState(false);
  const sections = links
    .map((to) => navSection(to))
    .filter((s): s is NavSection => Boolean(s));

  if (!editing) {
    return (
      <div className={GRID}>
        {sections.map((s) => (
          // Подпись в плитке узкая и длинные названия обрезает — полное имя и
          // строчку о том, что внутри, даёт подсказка.
          <Link key={s.to} to={s.to} title={`${s.label}\n${s.hint}`} className={TILE_LINK}>
            <TileFace section={s} />
          </Link>
        ))}
      </div>
    );
  }

  const full = links.length >= MAX_LINKS;
  const last = links.length <= MIN_LINKS;

  return (
    <div className="flex flex-col gap-3">
      <div className={GRID}>
        {sections.map((s) => (
          <div key={s.to} className="relative">
            {/* Не ссылка: в режиме настройки нажатие на кнопку должно её
                менять, а не уводить со страницы посреди перестановки. */}
            <div className={TILE}>
              <TileFace section={s} />
            </div>
            <button
              type="button"
              disabled={last}
              title={
                last
                  ? "Последнюю кнопку убрать нельзя\nДорожка без кнопок — пустая полоса; уберите её целиком"
                  : `Убрать «${s.label}» из дорожки`
              }
              aria-label={`Убрать «${s.label}» из дорожки`}
              onClick={() => onChange(links.filter((to) => to !== s.to))}
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
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={full}
          title={
            full
              ? `Больше ${MAX_LINKS} кнопок в дорожку не помещается\nЗаведите вторую дорожку на полке внизу`
              : "Выбрать раздел из «Ещё»"
          }
          onClick={() => setPicking((v) => !v)}
          className={clsx(
            "inline-flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1.5",
            "text-[13px] font-medium transition-colors duration-200",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
            "disabled:opacity-40 disabled:hover:text-muted disabled:hover:border-border",
            picking
              ? "border-accent text-accent"
              : "border-border text-muted hover:text-accent hover:border-accent/50"
          )}
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          Добавить кнопку
        </button>
        <span className="text-[12.5px] text-muted">
          {links.length} из {MAX_LINKS}
        </span>
      </div>

      {picking && !full && (
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
                  const already = links.includes(s.to);
                  const Icon = s.icon;
                  return (
                    <button
                      key={s.to}
                      type="button"
                      disabled={already}
                      title={already ? `«${s.label}» уже в этой дорожке` : s.hint}
                      onClick={() => {
                        onChange([...links, s.to]);
                        setPicking(false);
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
