import { useState } from "react";
import { Tags, Users, ArrowLeftRight } from "lucide-react";
import clsx from "clsx";
import { CategoryManager } from "./CategoryManager";
import { CounterpartyManager } from "./CounterpartyManager";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { useDictionaryCounts } from "../hooks/useDictionaries";
import { formatNum } from "../lib/format";

type SubTab = "categories" | "counterparties";

/**
 * «Справочники» settings section — the dictionaries behind operations:
 * категории and контрагенты, each on its own sub-tab.
 *
 * Laid out as ONE card with an icon + title + description header, exactly like
 * every other Settings tab («Источник данных», «Формат сумм», …); the sub-tabs
 * and the active manager live inside it. The managers therefore render bare
 * content (no card of their own) — nesting cards would break that rhythm.
 */
export function OperationsSettings() {
  const [sub, setSub] = useState<SubTab>("categories");
  const counts = useDictionaryCounts();

  const tabs: { id: SubTab; label: string; icon: typeof Tags; count: number | null }[] =
    [
      { id: "categories", label: "Категории", icon: Tags, count: counts.categories },
      {
        id: "counterparties",
        label: "Контрагенты",
        icon: Users,
        count: counts.counterparties,
      },
    ];

  return (
    <div className="card-tray card-pad">
      <SettingsSectionHeader
        icon={ArrowLeftRight}
        title="Справочники операций"
        className="mb-3"
      />
      <p className="text-xs text-muted mb-3">
        Категории и контрагенты ваших операций: редактирование, иерархия, цвет и
        иконки, а также создание новых. Правки уходят в Дзен-мани при отправке в
        облако.
      </p>

      {/* Дорожка-пилюля, как остальные переключатели: подчёркивание было
          последним следом прежнего набора внутри «Настроек». */}
      <div
        role="tablist"
        aria-label="Разделы справочников"
        className="inline-flex items-center gap-0.5 self-start rounded-full p-1 bg-panel2 border border-border shadow-tray mb-4"
      >
        {tabs.map((t) => {
          const active = sub === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setSub(t.id)}
              className={clsx(
                "inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[13.5px] font-medium transition-colors duration-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                active
                  ? "bg-accent text-accent-fg shadow-[0_6px_16px_-8px_rgb(var(--c-accent))]"
                  : "text-muted hover:text-text hover:bg-panel/70"
              )}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
              {/* Число записей — сразу на обеих вкладках: сколько всего в
                  справочнике, видно не открывая его. Без кэша Дзен-мани
                  справочника нет вовсе, тогда и числа нет. */}
              {t.count !== null && (
                <span
                  className={clsx(
                    "text-xs tabular-nums rounded-full px-1.5 py-0.5",
                    active ? "bg-accent/10 text-accent" : "bg-panel2 text-muted"
                  )}
                >
                  {formatNum(t.count)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {sub === "categories" && <CategoryManager />}
      {sub === "counterparties" && <CounterpartyManager />}
    </div>
  );
}
