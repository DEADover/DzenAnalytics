import { useState } from "react";
import { Tags, Users, ArrowLeftRight } from "lucide-react";
import { CategoryManager } from "./CategoryManager";
import { CounterpartyManager } from "./CounterpartyManager";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { useDictionaryCounts } from "../hooks/useDictionaries";
import { Segmented } from "./Segmented";

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

      {/* Вкладки внутри карточки — ступенью `sm`: крупная дорожка уже стоит
          над карточкой и переключает сами разделы настроек. Число записей —
          сразу на обеих вкладках: сколько всего в справочнике, видно не
          открывая его. Без кэша Дзен-мани справочника нет вовсе, тогда и числа
          нет. */}
      <Segmented
        tabs
        size="sm"
        label="Разделы справочников"
        value={sub}
        onChange={setSub}
        options={tabs.map((t) => ({
          value: t.id,
          label: t.label,
          icon: t.icon,
          count: t.count ?? undefined,
        }))}
        className="mb-4"
      />

      {sub === "categories" && <CategoryManager />}
      {sub === "counterparties" && <CounterpartyManager />}
    </div>
  );
}
