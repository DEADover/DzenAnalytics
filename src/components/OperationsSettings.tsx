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
    <div className="card card-pad">
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

      <div
        role="tablist"
        aria-label="Разделы справочников"
        className="flex items-center gap-1 border-b border-border mb-4"
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
                "inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                active
                  ? "border-accent text-text"
                  : "border-transparent text-muted hover:text-text"
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
                    "text-xs tabular-nums rounded px-1.5 py-0.5",
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
