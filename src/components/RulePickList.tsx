import { useMemo, useState } from "react";
import { Checkbox } from "./Checkbox";
import { SearchInput } from "./SearchInput";
import { Badge, type BadgeTone } from "./Badge";
import { RuleModeBadge } from "./RuleModeControl";
import { SectionEmpty } from "./SectionEmpty";
import {
  RULE_TARGET_LABELS,
  describeRule,
  ruleTargets,
  type CategoryRuleV2,
} from "../lib/ruleEngine";
import { ruleModeOf } from "../lib/ruleMode";
import { formatNum } from "../lib/format";

export interface RulePickItem {
  /** Ключ строки. У правил из файла id может повторяться, поэтому не всегда id. */
  key: string;
  rule: CategoryRuleV2;
  /** Пометка справа: «Новое», «Уже есть». */
  status?: { label: string; tone: BadgeTone; hint?: string };
  /** Отметить нельзя — например, такое правило уже есть. */
  disabled?: boolean;
}

/**
 * Список правил с галочками — отбор в мастерах экспорта и импорта.
 *
 * Строка читается как в таблице правил: суть правила, что оно меняет, режим.
 * Галочка в шапке отмечает всё, что видно по поиску и доступно, — так
 * «найти по слову и выгрузить только их» делается в два действия.
 */
export function RulePickList({
  items,
  selected,
  onChange,
}: {
  items: readonly RulePickItem[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [query, setQuery] = useState("");

  const described = useMemo(
    () =>
      items.map((it) => ({
        ...it,
        text: describeRule(it.rule) || "Правило не дописано",
      })),
    [items]
  );
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? described.filter((it) => it.text.toLowerCase().includes(q))
      : described;
  }, [described, query]);

  const pickable = visible.filter((it) => !it.disabled);
  const pickedVisible = pickable.filter((it) => selected.has(it.key)).length;
  const allVisible = pickable.length > 0 && pickedVisible === pickable.length;

  function toggleVisible(on: boolean) {
    const next = new Set(selected);
    for (const it of pickable) {
      if (on) next.add(it.key);
      else next.delete(it.key);
    }
    onChange(next);
  }

  function toggle(key: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(key);
    else next.delete(key);
    onChange(next);
  }

  const totalPickable = items.filter((it) => !it.disabled).length;
  const totalPicked = items.filter(
    (it) => !it.disabled && selected.has(it.key)
  ).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <Checkbox
            checked={allVisible}
            indeterminate={pickedVisible > 0}
            disabled={pickable.length === 0}
            onChange={toggleVisible}
            label={query ? "Отметить найденные" : "Отметить все"}
          />
          <span>
            Выбрано{" "}
            <span className="tabular-nums font-medium">
              {formatNum(totalPicked)}
            </span>{" "}
            из <span className="tabular-nums">{formatNum(totalPickable)}</span>
          </span>
        </label>
        {items.length > 5 && (
          <SearchInput
            size="sm"
            value={query}
            onChange={setQuery}
            placeholder="Найти правило"
            ariaLabel="Найти правило"
            className="ml-auto w-52 max-w-full"
          />
        )}
      </div>

      <ul className="rounded-xl border border-border divide-y divide-border/60 max-h-[42vh] overflow-y-auto">
        {visible.length === 0 ? (
          <li className="p-3">
            <SectionEmpty variant="inline" title="Ничего не нашлось">
              Поиск идёт по названию и условиям правила
            </SectionEmpty>
          </li>
        ) : (
          visible.map((it) => {
            const targets = ruleTargets(it.rule);
            const checked = !it.disabled && selected.has(it.key);
            return (
              <li key={it.key}>
                <label
                  className={`flex items-center gap-3 px-3 py-2 text-sm ${
                    it.disabled
                      ? "opacity-60 cursor-default"
                      : "cursor-pointer hover:bg-panel2/60"
                  }`}
                >
                  <Checkbox
                    checked={checked}
                    disabled={it.disabled}
                    onChange={(on) => toggle(it.key, on)}
                    label={it.text}
                  />
                  {/* На узком экране пометки уходят под текст: в одну строку с
                      ними от условия оставалось два слова. */}
                  <span className="min-w-0 flex-1 flex flex-col sm:flex-row sm:items-center gap-x-3 gap-y-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate" title={it.text}>
                        {it.text}
                      </span>
                      {targets.length > 0 && (
                        <span className="block text-xs text-muted truncate">
                          Меняет:{" "}
                          {targets
                            .map((t) => RULE_TARGET_LABELS[t].toLowerCase())
                            .join(", ")}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 flex items-center gap-1.5">
                      {it.status && (
                        <Badge tone={it.status.tone} title={it.status.hint}>
                          {it.status.label}
                        </Badge>
                      )}
                      <RuleModeBadge
                        value={{
                          mode: ruleModeOf(it.rule),
                          schedule: it.rule.schedule,
                        }}
                      />
                    </span>
                  </span>
                </label>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
