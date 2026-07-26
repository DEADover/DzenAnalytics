import { useState } from "react";
import { Tags, Users, ArrowLeftRight } from "lucide-react";
import clsx from "clsx";
import { CategoryManager } from "./CategoryManager";
import { CounterpartyManager } from "./CounterpartyManager";
import { SettingsSectionHeader } from "./SettingsSectionHeader";

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
        <button
          role="tab"
          aria-selected={sub === "categories"}
          onClick={() => setSub("categories")}
          className={clsx(
            "inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            sub === "categories"
              ? "border-accent text-text"
              : "border-transparent text-muted hover:text-text"
          )}
        >
          <Tags className="w-4 h-4" />
          Категории
        </button>
        <button
          role="tab"
          aria-selected={sub === "counterparties"}
          onClick={() => setSub("counterparties")}
          className={clsx(
            "inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            sub === "counterparties"
              ? "border-accent text-text"
              : "border-transparent text-muted hover:text-text"
          )}
        >
          <Users className="w-4 h-4" />
          Контрагенты
        </button>
      </div>

      {sub === "categories" && <CategoryManager />}
      {sub === "counterparties" && <CounterpartyManager />}
    </div>
  );
}
