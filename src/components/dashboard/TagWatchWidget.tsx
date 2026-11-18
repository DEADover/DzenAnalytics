/**
 * «Тег под наблюдением» — один тег: его расходы и доходы за месяц рядом с
 * обычным уровнем и по месяцам. Тег бывает и на расходах, и на доходах
 * одновременно («Отпуск»: билеты и возврат за бронь), поэтому стороны две.
 *
 * Что считать тегом — хэштег в комментарии или вторая категория операции, —
 * берётся из раздела «Теги» в момент выбора и хранится вместе с тегом.
 */

import { useMemo, useState } from "react";
import { Hash, Pencil } from "lucide-react";
import { BlockTitle } from "./blocks/shared";
import { WatchBars, WatchHead } from "./blocks/watch";
import { Combobox } from "../Combobox";
import { Segmented } from "../Segmented";
import { SectionEmpty } from "../SectionEmpty";
import { useDataStore } from "../../store/useDataStore";
import { useTagModeStore } from "../../store/useTagModeStore";
import { buildTagWatch, inTag, watchAmount, type WatchKind } from "../../lib/categoryWatch";
import { monthTitle } from "../../lib/format";
import { tagLabel, tagsOf, type TagMode } from "../../lib/operationTags";
import { periodKey } from "../../lib/period";
import type { Transaction } from "../../types";

export function TagWatchWidget({
  tag,
  tagMode,
  transactions,
  ym,
  monthStartDay,
  today,
  base,
  onPick,
  onOpen,
}: {
  /** Пусто — тег ещё не выбран. */
  tag: string | undefined;
  tagMode: TagMode | undefined;
  transactions: Transaction[];
  ym: string;
  monthStartDay: number;
  today: string;
  base: string;
  onPick: (tag: string, mode: TagMode) => void;
  onOpen: (title: string, txs: Transaction[], subtitle: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const mode: TagMode = tagMode ?? "hashtags";
  const label = tag ? tagLabel(tag, mode) : "";

  const watch = useMemo(
    () => (tag ? buildTagWatch(transactions, tag, mode, ym, monthStartDay, today) : null),
    [transactions, tag, mode, ym, monthStartDay, today]
  );

  // Сторона, по которой у тега нет ничего — ни в этом месяце, ни раньше, — не
  // показывается: тег «только про расходы» не должен нести пустую колонку
  // доходов. Если пусто с обеих сторон, оставляем расходы — с нулём.
  const sides = useMemo(() => {
    if (!watch) return [];
    const used = (k: WatchKind) => watch[k].bars.some((b) => b.total !== 0);
    const out: WatchKind[] = (["expense", "income"] as const).filter(used);
    return out.length > 0 ? out : (["expense"] as WatchKind[]);
  }, [watch]);

  const openMonth = (month: string, kind?: WatchKind) => {
    if (!tag) return;
    onOpen(
      `${label} · ${monthTitle(month)}`,
      transactions.filter(
        (t) =>
          inTag(t, tag, mode) &&
          periodKey(t.date, monthStartDay) === month &&
          (kind ? watchAmount(t, kind) !== 0 : t.kind !== "transfer")
      ),
      kind === "income" ? "Доходы по тегу" : kind === "expense" ? "Расходы по тегу" : "Операции по тегу"
    );
  };

  const showPicker = !tag || picking;
  const two = sides.length > 1;

  return (
    <>
      <BlockTitle
        title={
          tag ? (
            <span className="inline-flex items-center gap-2 min-w-0 align-middle">
              <span className="w-6 h-6 shrink-0 rounded-full bg-accent/10 text-accent grid place-items-center">
                <Hash className="w-3.5 h-3.5" aria-hidden="true" />
              </span>
              <span className="truncate">{mode === "hashtags" ? tag : label}</span>
            </span>
          ) : (
            "Тег под наблюдением"
          )
        }
        info={
          <p>
            Расходы и доходы с одним тегом: сколько набралось с начала месяца и
            сколько обычно набирается к этому дню — в среднем за последние
            полные месяцы, не больше трёх. Тегом может быть хэштег в комментарии
            или вторая категория операции. Сторона, по которой у тега ничего
            нет, не показывается. Возвраты уменьшают расход, переводы не
            считаются. Клик по числу или столбику открывает операции за месяц.
          </p>
        }
        right={
          tag ? (
            <button
              type="button"
              className="btn-icon p-1 ml-auto"
              title="Сменить тег"
              aria-label="Сменить тег"
              aria-pressed={picking}
              onClick={() => setPicking((v) => !v)}
            >
              <Pencil className="w-4 h-4" aria-hidden="true" />
            </button>
          ) : undefined
        }
      />
      {showPicker && (
        <TagPicker
          tag={tag ?? ""}
          mode={tagMode}
          onChange={(next, nextMode) => {
            onPick(next, nextMode);
            setPicking(false);
          }}
        />
      )}
      {watch && tag && (
        <div className="flex-1 min-h-0 flex flex-col gap-3" data-testid="tag-watch-widget">
          <div className={two ? "grid grid-cols-2 gap-3" : ""}>
            {sides.map((kind) => (
              <WatchHead
                key={kind}
                watch={watch[kind]}
                kind={kind}
                ym={ym}
                today={today}
                base={base}
                onOpen={() => openMonth(ym, kind)}
                label={two ? (kind === "income" ? "Доходы" : "Расходы") : undefined}
              />
            ))}
          </div>
          <WatchBars
            series={sides.map((kind) => ({ kind, watch: watch[kind] }))}
            base={base}
            onOpen={(month) => openMonth(month, two ? undefined : sides[0])}
          />
        </div>
      )}
    </>
  );
}

/**
 * Выбор тега: что считать тегами и сам тег. Отдельным компонентом — список
 * тегов собирается по всем операциям и нужен, только пока поле открыто.
 */
function TagPicker({
  tag,
  mode: saved,
  onChange,
}: {
  tag: string;
  /** Режим уже выбранного тега; у нового виджета — как в разделе «Теги». */
  mode: TagMode | undefined;
  onChange: (tag: string, mode: TagMode) => void;
}) {
  const all = useDataStore((s) => s.transactions);
  const sectionMode = useTagModeStore((s) => s.mode);
  const [mode, setMode] = useState<TagMode>(saved ?? sectionMode);

  const options = useMemo(() => {
    const count = new Map<string, number>();
    for (const t of all) for (const name of tagsOf(t, mode)) count.set(name, (count.get(name) ?? 0) + 1);
    // Частые первыми: за ними и приходят.
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru")).map(([n]) => n);
  }, [all, mode]);

  return (
    <div className="mb-3 flex flex-col gap-2" data-testid="tag-picker">
      <Segmented
        size="sm"
        label="Что считать тегами"
        value={mode}
        onChange={setMode}
        options={[
          { value: "hashtags", label: "Хэштеги" },
          { value: "categories", label: "Вторые категории" },
        ]}
      />
      {options.length === 0 ? (
        <SectionEmpty variant="compact">
          {mode === "hashtags"
            ? "Хэштегов в комментариях операций пока нет"
            : "Операций со второй категорией пока нет"}
        </SectionEmpty>
      ) : (
        <Combobox
          value={mode === saved ? tag : ""}
          options={options}
          onChange={(next) => {
            if (next) onChange(next, mode);
          }}
          placeholder="Выберите тег"
          ariaLabel="Тег"
          allowCustom={false}
          searchable
          portal
          prefix={mode === "hashtags" ? "#" : undefined}
        />
      )}
    </div>
  );
}
