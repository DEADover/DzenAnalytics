import { dayAndMonth } from "../../../lib/dayLabel";
import { BlockTitle } from "./shared";
import { pluralRu } from "../../../lib/plural";
import { Segmented } from "../../Segmented";
import { Target, TrendingUp, ArrowUpRight, Clock, Lightbulb, Sigma } from "lucide-react";
import { CategoryDot } from "../../CategoryDot";
import { AccountLogo } from "../../AccountLogo";
import { accountKindLabel } from "../../../lib/accountType";
import { formatMoney, formatPct, formatDate, monthLabel } from "../../../lib/format";
import type { DashboardAccount, DashboardModel } from "../../../hooks/useDashboardModel";
import type { PlannedOp } from "../../../lib/plannedOps";
import { SectionEmpty } from "../../SectionEmpty";
import { ProgressBar } from "../../ProgressBar";


/* ─────────────────────────────  списки  ───────────────────────────── */

/**
 * «Балансы счетов»: совокупный баланс и остаток на каждом счёте.
 *
 * Счета вне баланса здесь включаются своим переключателем в шапке — он меняет
 * только этот виджет (#116: «все счета и так живут в "Капитале"», хочется
 * выбирать). Итоги и отчёты сервиса по-прежнему решает настройка «Счета вне
 * баланса» в «Расчётах»; пока в виджете ничего не выбрано, он следует ей.
 */
export function AccountsBlock({
  m,
  offBalance,
  onOffBalanceChange,
  onAccount,
}: {
  m: DashboardModel;
  /** Выбор виджета; `undefined` — как в «Расчётах». */
  offBalance: boolean | undefined;
  onOffBalanceChange: (next: boolean) => void;
  onAccount?: (key: string, label: string) => void;
}) {
  const show = offBalance ?? m.includeOffBalance;
  const offSum = m.accountsAll.reduce((s, a) => (a.offBalance ? s + a.balanceBase : s), 0);
  const hasOff = m.accountsAll.some((a) => a.offBalance);
  const accounts = show ? m.accountsAll : m.accountsAll.filter((a) => !a.offBalance);
  // Совокупный баланс модели посчитан по настройке; виджет её поправляет на
  // сумму счетов вне баланса, если его выбор другой.
  const total =
    m.netWorth + (show === m.includeOffBalance ? 0 : show ? offSum : -offSum);
  return (
    <>
      <BlockTitle
        title="Балансы счетов"
        info={
          hasOff ? (
            <p>
              Счета вне баланса — накопительные, брокерские, всё, что в Дзен-мани
              помечено «вне баланса». Переключатель в шапке решает, показывать
              ли их здесь и прибавлять ли к сумме, — только в этом виджете. В
              итоги и отчёты они входят по настройке «Счета вне баланса» в
              «Расчётах».
            </p>
          ) : undefined
        }
        right={
          hasOff ? (
            <Segmented
              tight
              label="Какие счета показывать"
              value={show ? "all" : "in"}
              onChange={(v) => onOffBalanceChange(v === "all")}
              options={[
                { value: "in", label: "В балансе", title: "Только счета в балансе" },
                { value: "all", label: "Все", title: "Со счетами вне баланса" },
              ]}
              className="ml-auto"
            />
          ) : undefined
        }
        to="/accounts"
        linkLabel="Счета"
      />
      {/* Черта под итогом — та же, что делит строки списка: без неё
          крупное число и первая строка счёта читались как одно целое. */}
      <div
        className={`font-mono tabular-nums font-semibold text-2xl 3xl:text-3xl leading-none pb-3 mb-1 border-b border-border ${
          total < 0 ? "text-expense" : ""
        }`}
        style={{ wordSpacing: "-0.22em" }}
      >
        {formatMoney(total, m.base)}
      </div>
      <AccountsList m={m} accounts={accounts} onAccount={onAccount} />
    </>
  );
}

export function AccountsList({
  m,
  accounts = m.accounts,
  onAccount,
}: {
  m: DashboardModel;
  /** Какие счета показать; по умолчанию — по настройке «Счета вне баланса». */
  accounts?: DashboardAccount[];
  onAccount?: (key: string, label: string) => void;
}) {
  if (accounts.length === 0) {
    return <SectionEmpty variant="compact">Счетов пока нет</SectionEmpty>;
  }
  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Список прокручивается внутри карточки: счетов бывает и двенадцать, а
          обрезать их числом значило бы врать итогом внизу. */}
      <div className="scroll-soft flex flex-col flex-1 min-h-0 -mx-2 px-2">
      {accounts.map((a) => {
        // Тип известен только из кэша Дзен-мани; в режиме CSV его нет.
        // И не повторяем его, когда он слово в слово совпал с названием счёта
        // («Наличные — Наличные»).
        const label = a.type ? accountKindLabel(a.type, a.savings) : "";
        const kind =
          label && label !== "—" && label.toLowerCase() !== a.title.trim().toLowerCase()
            ? label
            : "";
        return (
        <button
          key={a.key}
          type="button"
          onClick={() => onAccount?.(a.key, a.title)}
          className="flex h-[56px] shrink-0 items-center justify-between gap-3 border-b border-border last:border-0 text-left group rounded-lg px-2 transition-colors duration-200 hover:bg-panel2/70 active:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <span className="flex items-center gap-2.5 min-w-0">
            <AccountLogo title={a.title} type={a.type} size={28} />
            <span className="min-w-0">
              <span className="block truncate text-[15px] group-hover:text-accent">{a.title}</span>
              {/* Тип известен только из кэша Дзен-мани. В режиме CSV его нет, и
                  строка-прочерк была бы шумом — тогда её просто не рисуем. */}
              {kind && (
                <span className="block text-[12px] text-muted truncate">
                  {kind}
                  {a.offBalance && " · Вне баланса"}
                </span>
              )}
            </span>
          </span>
          <span className="text-right shrink-0">
            <span
              className={`block font-mono tabular-nums font-semibold text-[15px] ${
                a.balanceBase < 0 ? "text-expense" : ""
              }`}
            >
              {formatMoney(a.balanceBase, m.base)}
            </span>
            {a.nativeCurrency !== m.base && (
              <span className="block font-mono tabular-nums text-[12px] text-muted">
                {formatMoney(a.nativeBalance, a.nativeCurrency)}
              </span>
            )}
          </span>
        </button>
        );
      })}
      </div>
    </div>
  );
}

/**
 * На что уходит в этом месяце.
 *
 * Точка отвечает за «кто» (её цвет — из справочника категорий), длина и
 * насыщенность полосы — за «сколько». На старой главной эти два кодирования
 * спорили: точка была цветная, а полоса у всех одинаково красная.
 */
export function CategoriesList({
  m,
  onCategory,
}: {
  m: DashboardModel;
  onCategory?: (name: string) => void;
}) {
  const rows = m.categories;
  if (rows.length === 0) {
    return (
      <SectionEmpty variant="compact">
        За {monthLabel(m.ym)} расходов ещё не было
      </SectionEmpty>
    );
  }
  // Полоса меряется от САМОЙ КРУПНОЙ статьи — так видно соотношение между
  // ними, — а процент считается от ВСЕХ расходов месяца, как на «Категориях».
  // Раньше процент тоже шёл от крупнейшей, и у верхней строки всегда стояло
  // «100%»: число, которое ничего не сообщало и расходилось с тем же разрезом
  // на своей странице.
  const top = rows[0].expense || 1;
  const total = rows.reduce((sum, c) => sum + c.expense, 0) || 1;
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="scroll-soft flex flex-col gap-3 flex-1 min-h-0 -mx-2 px-2">
      {rows.map((c) => {
        const frac = c.expense / top;
        return (
          <button
            key={c.category}
            type="button"
            onClick={() => onCategory?.(c.category)}
            // Значок стоит ПЕРЕД полосой, а не над ней: полоса живёт в той же
            // колонке, что и название, и начинается от одного с ним края —
            // так же, как в представлении «Bars» на «Категориях». Раньше она
            // шла во всю ширину строки, подныривая под значок, и левый край у
            // полос и названий не совпадал.
            className="w-full shrink-0 text-left group flex items-center gap-2 py-0.5 rounded-lg px-2 transition-colors duration-200 hover:bg-panel2/70 active:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <CategoryDot category={c.category} size="w-7 h-7" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-[15px] flex-1 group-hover:text-accent">
                  {c.category}
                </span>
                <span className="font-mono tabular-nums text-[12px] text-muted">
                  {formatPct(c.expense / total, 1)}
                </span>
                <span className="font-mono tabular-nums text-[14px] font-medium shrink-0">
                  {formatMoney(c.expense, m.base)}
                </span>
              </div>
              <ProgressBar
                value={frac}
                tone="expense"
                fillStyle={{ opacity: 0.35 + 0.65 * frac }}
                className="mt-1"
              />
            </div>
          </button>
        );
      })}
      </div>
    </div>
  );
}

/** Что ещё спишется до конца месяца. Итог — в базовой валюте. */
export function UpcomingList({ m }: { m: DashboardModel }) {
  if (m.upcoming.length === 0) {
    return (
      <SectionEmpty variant="compact">
        До конца месяца регулярных платежей не ждём
      </SectionEmpty>
    );
  }
  return (
    // Все платежи, а не первые несколько: список обрезался числом, а итог в
    // шапке считался по всем — суммы на экране не сходились.
    <div className="scroll-soft flex flex-col flex-1 min-h-0 -mx-2 px-2">
      {m.upcoming.map((p) => (
        <div
          key={p.payee + p.currency + p.date}
          className="flex h-[56px] shrink-0 items-center justify-between gap-3 border-b border-border last:border-0"
        >
          <span className="flex items-center gap-2.5 min-w-0">
            <i
              className={`w-[3px] h-6 rounded-sm shrink-0 block ${
                p.inDays <= 1 ? "bg-warn" : "bg-border"
              }`}
            />
            <span className="min-w-0">
              <span className="block text-[14.5px] font-medium truncate">{p.payee}</span>
              {/* Дата и комментарий одной строкой: с двумя строка платежа была
                  выше строки счёта, и списки в соседних карточках не сходились. */}
              <span className="block text-[12px] text-muted truncate">
                {formatDate(p.date, "short")} ·{" "}
                {p.inDays === 0 ? "сегодня" : p.inDays === 1 ? "завтра" : `через ${p.inDays} дн.`}
                {p.comment ? ` · ${p.comment}` : ""}
              </span>
            </span>
          </span>
          <span className="text-right shrink-0">
            {/* Без минуса: тратами здесь всё и так, знак повторял бы то, что уже
                сказано красным и самим названием карточки. */}
            <span className="block font-mono tabular-nums font-semibold text-[15px] text-expense">
              {formatMoney(p.amount, p.currency)}
            </span>
            {p.currency !== m.base && (
              <span className="block font-mono tabular-nums text-[12px] text-muted">
                {formatMoney(p.amountBase, m.base)}
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Что заметно: наблюдения одним списком.
 *
 * Раньше это были два разных блока — узкая карточка «Что разогналось» на две
 * строки и панель из шести плиток-наблюдений. Первая пустовала, во второй
 * половина плиток была шумом.
 *
 * Фильтр и порядок задаёт `buildNotices`; здесь только подача.
 */
/**
 * Планы Дзен-мани до конца месяца — второй вид «Запланированных операций».
 *
 * Расход и доход различаем цветом и знаком, как везде в продукте. Переводы не
 * показываем: перекладывание денег между своими счетами не спишется и не
 * придёт, а в списке ожидаемых операций читалось бы и тем и другим.
 *
 * Прогноз Дзен-мани от плана, поставленного руками, отличаем подписью: первое —
 * догадка по регулярному платежу, второе — намерение человека.
 */
export function ZenPlannedList({
  rows,
  base,
  today,
  until,
}: {
  rows: PlannedOp[] | null;
  base: string;
  today: string;
  /** Последний день окна, ISO. Нужен пустому состоянию: без него «планов
   *  нет» звучит как «нет вообще», хотя вперёд мы смотрим только до этой даты. */
  until: string;
}) {
  if (rows === null) {
    return (
      <SectionEmpty variant="compact">
        Планы приезжают из Дзен-мани — подключите синхронизацию
      </SectionEmpty>
    );
  }
  if (rows.length === 0) {
    return (
      <SectionEmpty variant="compact">
        {/* Называем последний день окна, а не «конец месяца»: виджет смотрит
            вперёд ровно до этой даты, и точное число не оставляет вопроса,
            что именно проверили. Прежнее «ни впереди, ни просроченных»
            читалось как «планов нет вообще». */}
        Планов по {dayAndMonth(until)} нет — и ничего просроченного
      </SectionEmpty>
    );
  }
  return (
    <div className="scroll-soft flex flex-col flex-1 min-h-0 -mx-2 px-2">
      {rows.map((p) => {
        const days = Math.round((Date.parse(p.date) - Date.parse(today)) / 86400000);
        // Просроченный план — тот, что человек поставил сам и никто не
        // исполнил. Он не «через −5 дней», он ждёт действия, и полоска у него
        // красная, а не жёлтая (issue #87).
        const overdue = days < 0;
        const inDays = Math.max(0, days);
        return (
          <div
            key={p.id}
            className="flex h-[56px] shrink-0 items-center justify-between gap-3 border-b border-border last:border-0"
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <i
                className={`w-[3px] h-6 rounded-sm shrink-0 block ${
                  overdue ? "bg-expense" : inDays <= 1 ? "bg-warn" : "bg-border"
                }`}
              />
              <span className="min-w-0">
                <span className="block text-[14.5px] font-medium truncate">
                  {p.payee || p.category || "Без названия"}
                </span>
                <span className="block text-[12px] text-muted truncate">
                  {formatDate(p.date, "short")} ·{" "}
                  {overdue ? (
                    <span className="text-expense font-medium">
                      просрочен на {-days} {pluralRu(-days, ["день", "дня", "дней"])}
                    </span>
                  ) : inDays === 0 ? (
                    "сегодня"
                  ) : inDays === 1 ? (
                    "завтра"
                  ) : (
                    `через ${inDays} дн.`
                  )}
                  {p.forecast ? " · прогноз" : ""}
                  {p.comment ? ` · ${p.comment}` : ""}
                </span>
              </span>
            </span>
            <span
              className={`block font-mono tabular-nums font-semibold text-[15px] shrink-0 ${
                p.kind === "income" ? "text-income" : "text-expense"
              }`}
            >
              {p.kind === "income" ? "+" : "−"}
              {formatMoney(p.amountBase, base)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ObservationsList({
  m,
  limit = 5,
}: {
  m: DashboardModel;
  limit?: number;
}) {
  const rows = m.notices.slice(0, limit);
  const excess = m.spikes
    .filter((s) => s.ym === m.ym)
    .reduce((sum, r) => sum + Math.max(0, r.current - r.baseline), 0);

  if (rows.length === 0) {
    return (
      <div className="text-sm text-muted py-3">
        Ничего необычного — месяц идёт в своих обычных пределах
      </div>
    );
  }

  // Значок наблюдения того же размера, что и кружок категории: мелкая точка
  // рядом с крупным значком читалась как две разные породы строк.
  const badge = {
    plan: { icon: Target, tone: "text-expense", bg: "bg-expense/12" },
    spike: { icon: TrendingUp, tone: "text-expense", bg: "bg-expense/12" },
    price: { icon: ArrowUpRight, tone: "text-warn", bg: "bg-warn/15" },
    missed: { icon: Clock, tone: "text-accent", bg: "bg-accent/12" },
    insight: { icon: Lightbulb, tone: "text-accent", bg: "bg-accent/12" },
  } as const;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex flex-col">
        {rows.map((r) => {
          const b = badge[r.kind];
          const Icon = b.icon;
          return (
            <div
              key={r.id}
              className="flex items-start justify-between gap-3 py-2.5 border-b border-border last:border-0"
            >
              <span className="flex items-start gap-3 min-w-0">
                {r.category ? (
                  <span className="mt-0.5 shrink-0">
                    <CategoryDot category={r.category} size="w-7 h-7" />
                  </span>
                ) : (
                  <span
                    className={`mt-0.5 w-7 h-7 rounded-full shrink-0 grid place-items-center ${b.bg} ${b.tone}`}
                  >
                    <Icon className="w-4 h-4" aria-hidden="true" />
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block text-[14.5px] font-medium truncate">{r.title}</span>
                  <span className="block text-[12.5px] text-muted leading-snug">{r.body}</span>
                </span>
              </span>
              {r.value !== undefined && (
                <span className="font-mono tabular-nums font-semibold text-[14px] shrink-0 pt-1">
                  {formatMoney(r.value, m.base)}
                </span>
              )}
            </div>
          );
        })}

        {excess > 0 && (
          <div className="flex items-start justify-between gap-3 py-2.5 border-b border-border last:border-0">
            <span className="flex items-start gap-3 min-w-0">
              <span className="mt-0.5 w-7 h-7 rounded-full shrink-0 grid place-items-center bg-expense/12 text-expense">
                <Sigma className="w-4 h-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-[14.5px] font-medium truncate">
                  Сверх обычного за месяц
                </span>
                <span className="block text-[12.5px] text-muted leading-snug">
                  Суммарно по разогнавшимся статьям
                </span>
              </span>
            </span>
            <span className="font-mono tabular-nums font-semibold text-[14px] shrink-0 pt-1 text-expense">
              +{formatMoney(excess, m.base)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
