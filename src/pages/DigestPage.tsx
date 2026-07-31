import { useMemo, useState } from "react";
import {
  Newspaper,
  TrendingUp,
  TrendingDown,
  ArrowUp,
  ArrowDown,
  Calendar,
  ChevronRight,
} from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useAnalyticsTransactions } from "../hooks/useAnalyticsTransactions";
import { useDrillStore } from "../store/useDrillStore";
import { buildDigestHistory, type DigestEntry } from "../lib/digest";
import { formatMoney, formatPct, formatDate } from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { InfoPopover, InfoTerm } from "../components/InfoPopover";

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
    <div className="space-y-6">
      <PageHeader
        icon={Newspaper}
        title="Дайджест"
        hint="Авто-сгенерированные итоги по неделям и месяцам со сравнением с предыдущим периодом и категориями, где «выстрелило»."
        hintWrap
        right={
          <InfoPopover>
            <p>
              Итоги считаются только по <InfoTerm>завершённым периодам</InfoTerm>:
              текущего месяца и текущей недели в списке нет — на середине месяца
              сравнивать не с чем, любые «−40% к прошлому» были бы неправдой.
              Недели считаем с понедельника, храним последние 26.
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

      {/* Tabs */}
      <div className="flex items-center gap-2">
        <TabBtn active={tab === "month"} onClick={() => setTab("month")}>
          По месяцам
        </TabBtn>
        <TabBtn active={tab === "week"} onClick={() => setTab("week")}>
          По неделям
        </TabBtn>
        <div className="text-xs text-muted ml-2">{filtered.length} периодов</div>
      </div>

      {filtered.length === 0 ? (
        <div className="card card-pad text-center text-muted py-12">
          Нет завершённых периодов для дайджеста.
        </div>
      ) : (
        <div className="grid md:grid-cols-[260px_1fr] gap-4">
          {/* Sidebar list */}
          <div className="card p-1.5 max-h-[600px] overflow-y-auto">
            {filtered.map((e) => {
              const isActive = e.id === current?.id;
              return (
                <button
                  key={e.id}
                  onClick={() => setSelected(e.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded text-sm text-left transition-colors ${
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

          {/* Detail */}
          {current && (
            <DigestDetail
              entry={current}
              baseCurrency={baseCurrency}
              onOpenTx={(txs, title) => showDrill(title, txs, "Дайджест")}
            />
          )}
        </div>
      )}
    </div>
  );
}

function TabBtn({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
        active ? "bg-accent/10 text-accent" : "text-muted hover:text-text hover:bg-panel2"
      }`}
    >
      {children}
    </button>
  );
}

function DigestDetail({
  entry,
  baseCurrency,
  onOpenTx,
}: {
  entry: DigestEntry;
  baseCurrency: string;
  onOpenTx: (txs: ReturnType<typeof Array.prototype.filter>, title: string) => void;
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

  return (
    <div className="space-y-4">
      <div className="card card-pad">
        <div className="text-xs uppercase tracking-wider text-muted">
          {entry.label} · {entry.txCount} операций
        </div>
        <div className="grid grid-cols-3 gap-4 mt-3">
          <Hero
            label="Доход"
            value={formatMoney(entry.income, baseCurrency)}
            delta={entry.incomeDelta}
            cls={incCls}
            arrowUp
          />
          <Hero
            label="Расход"
            value={formatMoney(entry.expense, baseCurrency)}
            delta={entry.expenseDelta}
            cls={expCls}
            arrowUp={false}
          />
          <Hero
            label="Чистый поток"
            value={formatMoney(entry.net, baseCurrency, {
              signed: true,
            })}
            delta={
              Math.abs(entry.prevNet) > 0.01
                ? (entry.net - entry.prevNet) / Math.abs(entry.prevNet)
                : 0
            }
            cls={netCls}
            arrowUp
          />
        </div>
      </div>

      {entry.movers.length > 0 && (
        <div className="card card-pad">
          <div className="font-semibold mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-accent" />
            Категории, где &laquo;выстрелило&raquo;
          </div>
          <div className="space-y-2">
            {entry.movers.map((m) => {
              const up = m.current > m.previous;
              const diff = Math.abs(m.current - m.previous);
              return (
                <div key={m.category} className="flex items-center gap-3 text-sm">
                  {up ? (
                    <ArrowUp className="w-3.5 h-3.5 text-expense shrink-0" />
                  ) : (
                    <ArrowDown className="w-3.5 h-3.5 text-income shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="truncate font-medium">{m.category}</div>
                      <div
                        className={`tabular-nums whitespace-nowrap text-xs ml-3 ${up ? "text-expense" : "text-income"}`}
                      >
                        {up ? "+" : "−"}
                        {formatMoney(diff, baseCurrency)}
                      </div>
                    </div>
                    <div className="text-xs text-muted">
                      сейчас {formatMoney(m.current, baseCurrency)} ·
                      раньше {formatMoney(m.previous, baseCurrency)}
                      {m.previous > 0 && (
                        <>
                          {" "}
                          ({m.delta > 0 ? "+" : ""}
                          {formatPct(m.delta, 0)})
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {entry.topTransactions.length > 0 && (
        <div className="card card-pad">
          <div className="font-semibold mb-3 flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-expense" />
            Самое дорогое за период
          </div>
          <div className="space-y-2">
            {entry.topTransactions.map((t) => (
              <button
                key={t.id}
                onClick={() => onOpenTx([t], t.payee || t.categoryFull || "Операция")}
                className="w-full flex items-center gap-3 text-sm hover:bg-panel2/40 p-2 -mx-2 rounded text-left"
              >
                <Calendar className="w-3.5 h-3.5 text-muted shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{t.payee || "—"}</div>
                  <div className="text-xs text-muted truncate">
                    {t.categoryFull} · {formatDate(t.date, "full")}
                  </div>
                </div>
                <div className="text-expense font-semibold tabular-nums">
                  {formatMoney(t.amountBase, baseCurrency)}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Hero({
  label,
  value,
  delta,
  cls,
  arrowUp,
}: {
  label: string;
  value: string;
  delta: number;
  cls: string;
  arrowUp: boolean;
}) {
  const showDelta = Math.abs(delta) > 0.01;
  // For expense, growth is bad → use arrowUp=false meaning "up arrow = bad"
  return (
    <div>
      <div className="label">{label}</div>
      <div className="text-xl font-semibold tabular-nums font-mono tracking-tight [word-spacing:-0.22em]">
        {value}
      </div>
      {showDelta && (
        <div className={`text-xs flex items-center gap-1 mt-1 ${cls}`}>
          {delta > 0 ? (
            arrowUp ? (
              <TrendingUp className="w-3 h-3" />
            ) : (
              <TrendingUp className="w-3 h-3" />
            )
          ) : (
            <TrendingDown className="w-3 h-3" />
          )}
          {delta > 0 ? "+" : ""}
          {formatPct(delta, 0)}
        </div>
      )}
    </div>
  );
}
