import { useMemo, useState } from "react";
import {
  Newspaper,
  TrendingUp,
  TrendingDown,
  ArrowUp,
  ArrowDown,
  Trophy,
  Coins,
  ChevronRight,
} from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useAnalyticsTransactions } from "../hooks/useAnalyticsTransactions";
import { useDrillStore } from "../store/useDrillStore";
import { buildDigestHistory, type DigestEntry } from "../lib/digest";
import { counterpartyOf } from "../lib/yearReview";
import { formatMoney, formatNum, formatPct, formatDate, truncateWords } from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { InfoPopover, InfoTerm } from "../components/InfoPopover";
import { Segmented } from "../components/Segmented";
import { SectionCard, StatCell } from "../components/SectionCard";
import { MeterRow, MeterHead, type MeterCell } from "../components/MeterRow";
import type { Transaction } from "../types";


type Tab = "week" | "month";

export function DigestPage() {
  // Digest summaries are pure income/expense analytics → strip turnover /
  // off-balance flows the user excluded (#14).
  const transactions = useAnalyticsTransactions();
  const baseCurrency = useDataStore((s) => s.rates.base);
  const showDrill = useDrillStore((s) => s.show);

  const all = useMemo(() => buildDigestHistory(transactions), [transactions]);
  const [tab, setTab] = useState<Tab>("month");
  const [selected, setSelected] = useState<string | null>(null);

  const filtered = useMemo(
    () => all.filter((e) => e.period === tab),
    [all, tab]
  );

  const currentId = selected || filtered[0]?.id || null;
  const current = filtered.find((e) => e.id === currentId) || filtered[0] || null;

  if (transactions.length === 0) return <EmptyState />;

  return (
    <div className="space-y-3">
      <PageHeader
        icon={Newspaper}
        title="Дайджест"
        hint="Итоги завершённых недель и месяцев со сравнением с предыдущим"
        right={
          <InfoPopover>
            <p>
              Итоги считаются только по <InfoTerm>завершённым периодам</InfoTerm>:
              текущего месяца и текущей недели в списке нет — на середине месяца
              сравнивать не с чем, любые «−40% к прошлому» были бы неправдой.
              Недели считаем с понедельника; и недели, и месяцы идут за всю
              историю, до самой первой операции. Периоды без единой операции в
              ленту не попадают.
            </p>
            <p>
              Все сравнения — с <InfoTerm>предыдущим таким же периодом</InfoTerm>:
              месяц с месяцем, неделя с неделей. Проценты в карточках категорий —
              оттуда же: насколько потратили больше или меньше, чем в прошлый раз.
            </p>
            <p>
              Общие фильтры сверху здесь не применяются, но операции, исключённые
              из аналитики на странице «Категории», в дайджест не попадают.
            </p>
          </InfoPopover>
        }
      />

      {/* Переключатель — общий контрол продукта, а не свои пилюли: те же две
          кнопки на других страницах выглядели иначе. */}
      <div className="flex items-center gap-3">
        <Segmented
          value={tab}
          onChange={setTab}
          label="Период дайджеста"
          options={[
            { value: "month" as Tab, label: "По месяцам" },
            { value: "week" as Tab, label: "По неделям" },
          ]}
        />
        <span className="text-xs text-muted">
          {formatNum(filtered.length)}{" "}
          {filtered.length % 10 === 1 && filtered.length % 100 !== 11 ? "период" : "периодов"}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="card-tray card-pad text-center text-muted py-12">
          Нет завершённых периодов для дайджеста.
        </div>
      ) : (
        <div className="grid md:grid-cols-[260px_1fr] gap-4">
          {/* Список периодов. На широком экране панель тянется во всю высоту
              правой колонки: карточка вынута из потока, поэтому длинный список
              не растягивает строку сетки под себя, а прокручивается внутри. С
              фиксированной высотой панель обрывалась заметно выше разборов
              справа, и низ страницы оставался пустым. */}
          <div className="relative min-h-[16rem]">
          <div className="card p-1.5 max-h-[60vh] overflow-y-auto md:max-h-none md:absolute md:inset-0">
            {filtered.map((e) => {
              const isActive = e.id === current?.id;
              return (
                <button
                  key={e.id}
                  onClick={() => setSelected(e.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                    isActive
                      ? "bg-accent/10 text-accent"
                      : "hover:bg-panel2/60 text-muted"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{e.label}</div>
                    <div className="text-[11px] text-muted truncate">
                      {formatMoney(e.expense, baseCurrency)} расход
                    </div>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-50" />
                </button>
              );
            })}
          </div>
          </div>

          {/* Detail */}
          {current && (
            <DigestDetail
              entry={current}
              baseCurrency={baseCurrency}
              onOpenTx={(txs, title) => showDrill(title, txs, "Дайджест")}
              onOpenCategory={(category) =>
                showDrill(
                  category,
                  transactions.filter(
                    (t) =>
                      t.date >= current.start && t.date <= current.end && t.category === category
                  ),
                  current.label
                )
              }
            />
          )}
        </div>
      )}
    </div>
  );
}


/**
 * Колонки движителей. Полоса тут не доля от целого, а величина изменения
 * против самой крупной в списке, поэтому она идёт отдельной дорожкой под
 * именем: заливка во всю высоту строки в таком списке читалась как подсветка
 * выделенной строки, а её правый край обрывался посреди пустоты.
 */
const MOVER_COLUMNS: MeterCell[] = [
  { text: "Доля", width: "w-14" },
  { text: "Было → стало", width: "w-36" },
  { text: "Изменение", width: "w-24" },
];

function DigestDetail({
  entry,
  baseCurrency,
  onOpenTx,
  onOpenCategory,
}: {
  entry: DigestEntry;
  baseCurrency: string;
  onOpenTx: (txs: Transaction[], title: string) => void;
  /** Операции одной статьи за этот период. */
  onOpenCategory: (category: string) => void;
}) {
  const expCls =
    entry.expenseDelta > 0.05
      ? "text-expense"
      : entry.expenseDelta < -0.05
        ? "text-income"
        : "text-muted";
  const incCls =
    entry.incomeDelta > 0.05
      ? "text-income"
      : entry.incomeDelta < -0.05
        ? "text-expense"
        : "text-muted";
  const netCls =
    entry.net > entry.prevNet + 100
      ? "text-income"
      : entry.net < entry.prevNet - 100
        ? "text-expense"
        : "text-muted";

  const maxMove = Math.max(
    ...entry.movers.map((m) => Math.abs(m.current - m.previous)),
    1
  );

  return (
    <div className="space-y-3">
      <div className="tray">
        <div className="tray-core px-5 py-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-4 divide-border lg:divide-x">
            <StatCell
              label="Доход"
              value={formatMoney(entry.income, baseCurrency)}
              icon={<TrendingUp className="w-4 h-4" />}
              tone="income"
              note={deltaNote(entry.incomeDelta)}
              noteCls={incCls}
            />
            <StatCell
              label="Расход"
              value={formatMoney(entry.expense, baseCurrency)}
              icon={<TrendingDown className="w-4 h-4" />}
              tone="expense"
              note={deltaNote(entry.expenseDelta)}
              noteCls={expCls}
              pad
            />
            <StatCell
              label="Чистый поток"
              value={formatMoney(entry.net, baseCurrency, { signed: true })}
              icon={<Trophy className="w-4 h-4" />}
              tone={entry.net >= 0 ? "income" : "expense"}
              note={deltaNote(
                Math.abs(entry.prevNet) > 0.01
                  ? (entry.net - entry.prevNet) / Math.abs(entry.prevNet)
                  : 0
              )}
              noteCls={netCls}
              pad
            />
            {/* Число операций было мелкой служебной строчкой над числами —
                такой же итог периода, просто не в рублях. */}
            <StatCell
              label="Операций"
              value={formatNum(entry.txCount)}
              icon={<Coins className="w-4 h-4" />}
              note={entry.label}
              pad
            />
          </div>
        </div>
      </div>

      {entry.movers.length > 0 && (
        <SectionCard
          icon={<TrendingUp className="w-4 h-4 text-accent" />}
          title="Категории, где «выстрелило»"
          info={
            <p>
              Статьи с самым большим изменением суммы против прошлого такого же
              периода — в рублях, а не в процентах: рост на 200 % у статьи в
              триста рублей не так важен, как рост на 20 % у статьи в сто тысяч.
              Полоса показывает величину изменения, стрелка — сторону. Нажатие
              открывает операции статьи за этот период.
            </p>
          }
        >
          <MeterHead columns={MOVER_COLUMNS} lead="" bar="track" />
          <div className="space-y-0.5">
            {entry.movers.map((m) => {
              const up = m.current > m.previous;
              const diff = Math.abs(m.current - m.previous);
              return (
                <MeterRow
                  key={m.category}
                  bar="track"
                  icon={
                    up ? (
                      <ArrowUp className="w-3.5 h-3.5 text-expense" />
                    ) : (
                      <ArrowDown className="w-3.5 h-3.5 text-income" />
                    )
                  }
                  label={m.category}
                  share={diff / maxMove}
                  barCls={up ? "bg-expense" : "bg-income"}
                  cells={[
                    {
                      text:
                        m.previous > 0
                          ? `${m.delta > 0 ? "+" : ""}${formatPct(m.delta, 0)}`
                          : "—",
                      width: MOVER_COLUMNS[0].width,
                      muted: true,
                    },
                    {
                      text: `${formatMoney(m.previous, baseCurrency, { compact: true })} → ${formatMoney(m.current, baseCurrency, { compact: true })}`,
                      width: MOVER_COLUMNS[1].width,
                      muted: true,
                    },
                    {
                      text: `${up ? "+" : "−"}${formatMoney(diff, baseCurrency)}`,
                      width: MOVER_COLUMNS[2].width,
                    },
                  ]}
                  onClick={() => onOpenCategory(m.category)}
                  title="Показать операции статьи за период"
                />
              );
            })}
          </div>
        </SectionCard>
      )}

      {entry.topTransactions.length > 0 && (
        <SectionCard
          icon={<Coins className="w-4 h-4 text-expense" />}
          title="Самое дорогое за период"
          info={<p>Пять самых крупных расходов периода с комментарием к операции.</p>}
        >
          <div className="space-y-0.5">
            {entry.topTransactions.map((t, i) => (
              <button
                key={t.id}
                onClick={() =>
                  onOpenTx([t], counterpartyOf(t) || t.categoryFull || "Операция")
                }
                title="Показать операцию"
                className="w-full flex items-start gap-2 text-sm rounded-md px-2 py-1.5 text-left hover:bg-panel2/50"
              >
                <span className="text-[11px] text-muted tabular-nums w-4 shrink-0 leading-5">
                  {i + 1}
                </span>
                {/* Имя и комментарий одной колонкой, сумма соседней: комментарий
                    не заезжает под сумму и обрывается там же, где она начинается. */}
                <span className="flex-1 min-w-0">
                  <span className="block font-medium truncate">
                    {counterpartyOf(t) || t.categoryFull || "—"}
                  </span>
                  <span className="block text-xs text-muted truncate">
                    {t.categoryFull} · {formatDate(t.date, "full")}
                    {truncateWords(t.comment, 140) ? ` · ${truncateWords(t.comment, 140)}` : ""}
                  </span>
                </span>
                <span className="text-expense font-semibold tabular-nums shrink-0 leading-5">
                  {formatMoney(t.amountBase, baseCurrency)}
                </span>
              </button>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

/** «+12% к прошлому периоду» — или пусто, если изменение в пределах процента. */
function deltaNote(delta: number): string | undefined {
  if (Math.abs(delta) <= 0.01) return "≈ как в прошлый раз";
  return `${delta > 0 ? "+" : ""}${formatPct(delta, 0)} к прошлому периоду`;
}
