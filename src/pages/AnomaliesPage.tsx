import { useMemo, useState } from "react";
import { periodKey } from "../lib/period";
import { AlertTriangle, Zap, TrendingUp } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useAnalyticsTransactions } from "../hooks/useAnalyticsTransactions";
import { useDrillStore } from "../store/useDrillStore";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { detectAnomalies, detectMonthSpikes, type Anomaly, type MonthSpike } from "../lib/aggregations";
import { DataTable } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { Segmented } from "../components/Segmented";
import { InfoPopover, InfoTerm } from "../components/InfoPopover";
import { GlobalFilters } from "../components/GlobalFilters";
import { formatMoney, formatDate, formatNum, monthLabel, formatFixed } from "../lib/format";
import { affectsExpense } from "../lib/txKindStyle";
import { EmptyState } from "../components/EmptyState";
import { StatCell, StatRow } from "../components/SectionCard";
import { SectionEmpty } from "../components/SectionEmpty";
import { SectionControls } from "../components/SectionControls";
import { Slider } from "../components/Slider";

export function AnomaliesPage() {
  // Обороты и взаимозачёты не аномалии, а шум: категории, помеченные «не
  // учитывать в аналитике», и внебалансовые счета до детектора не доходят (#14).
  const transactions = useAnalyticsTransactions();
  const base = useDataStore((s) => s.rates.base);
  const showDrill = useDrillStore((s) => s.show);
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);

  const [tab, setTab] = useState<"transactions" | "spikes">("transactions");
  const [threshold, setThreshold] = useState(2.5);

  // Honour the global filters (account / currency / category / dates / search).
  // Outliers run on the fully-filtered set.
  const filtered = useMemo(
    () => applyFilters(transactions, filters, monthStartDay),
    [transactions, filters, monthStartDay]
  );
  // Month-spikes need trailing months to form a baseline, so the date filter
  // must NOT shrink their input — apply only the non-date filters, then scope
  // the SHOWN spikes to the selected window below.
  const spikesInput = useMemo(
    () => applyFilters(transactions, { ...filters, preset: "all", from: null, to: null }, monthStartDay),
    [transactions, filters, monthStartDay]
  );

  const anomalies = useMemo(() => detectAnomalies(filtered, threshold), [filtered, threshold]);

  const allSpikes = useMemo(
    () => detectMonthSpikes(spikesInput, 1.5, monthStartDay),
    [spikesInput, monthStartDay]
  );
  const spikes = useMemo(() => {
    const dateActive = filters.preset !== "all" || !!filters.from || !!filters.to;
    if (!dateActive) return allSpikes;
    if (filtered.length === 0) return [];
    let minYM = "9999-99";
    let maxYM = "0000-00";
    for (const t of filtered) {
      const ym = periodKey(t.date, monthStartDay);
      if (ym < minYM) minYM = ym;
      if (ym > maxYM) maxYM = ym;
    }
    return allSpikes.filter((s) => s.ym >= minYM && s.ym <= maxYM);
  }, [allSpikes, filtered, filters.preset, filters.from, filters.to, monthStartDay]);

  if (transactions.length === 0) return <EmptyState />;

  function openTx(id: string) {
    const tx = transactions.find((t) => t.id === id);
    if (!tx) return;
    showDrill(tx.payee || tx.categoryFull, [tx], "Аномальная операция");
  }

  function openCategoryMonth(cat: string, ym: string) {
    // Include refunds for the same category — they offset the spike
    // total shown in the row, so they belong in the drilldown list.
    const txs = spikesInput.filter(
      (t) => affectsExpense(t.kind) && t.category === cat && periodKey(t.date, monthStartDay) === ym
    );
    showDrill(`${cat} · ${monthLabel(ym)}`, txs, "Всплеск трат");
  }

  const totalAnomalyAmount = anomalies.reduce((s, a) => s + a.tx.amountBase, 0);
  const totalSpikesDelta = spikes.reduce((s, sp) => s + sp.delta, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Zap}
        iconTone="text-warn"
        title="Аномалии"
        info={
          <InfoPopover>
            <p>
              Страница слушается общих фильтров по счетам, валютам, категориям и
              датам. Всплески при этом считают «обычное» по всей истории — с
              учётом фильтров, но без ограничения по датам: иначе сравнивать
              месяц было бы не с чем.
            </p>
            <p>
              <InfoTerm>Операции-выбросы</InfoTerm> — те, что сильно выбиваются
              из привычных сумм. Для каждой категории и для каждого получателя
              считаем средний чек и разброс вокруг него, а потом ищем операции,
              которые ушли от среднего больше чем на{" "}
              <InfoTerm>{formatFixed(threshold)} разброса</InfoTerm> — это и есть
              «Порог отклонения» над итогами. Поставьте меньше — попадёт больше
              операций.
            </p>
            <p>
              Считаем только расходы. Категория или получатель участвуют,
              начиная с <InfoTerm>5 операций</InfoTerm>: на трёх покупках
              «обычная сумма» — это ещё не статистика. В строке видно, с чем
              сравнивали: «обычный чек у «Ёлочки» — 900 ₽, эта в 4,2× больше».
            </p>
            <p>
              <InfoTerm>Всплески по категориям</InfoTerm> — про месяцы, а не про
              отдельные покупки. Траты категории за месяц сравниваем со средним
              за <InfoTerm>три предыдущих месяца</InfoTerm> и показываем те, где
              стало больше хотя бы в полтора раза. Возвраты вычитаются, поэтому
              месяц с полностью возвращённой покупкой всплеском не считается.
            </p>
            <p>
              Обе вкладки учитывают фильтры сверху. Единственное исключение —
              база для всплесков: она берётся по всей истории, иначе сравнивать
              текущий месяц было бы не с чем.
            </p>
          </InfoPopover>
        }
      />

      <GlobalFilters />

      {/* Выбор раздела — рядом контролов раздела, над итогами, как на других
          страницах: итоги описывают оба раздела, а переключатель — то, что ниже.
          Порог — там же, справа: он меняет весь список выбросов и счётчик над
          ним. В шапке он стоял в другом конце экрана и назывался
          «Чувствительность», хотя чем выше значение, тем выбросов меньше. */}
      <SectionControls>
        <Segmented
          tabs
          label="Что показать"
          value={tab}
          onChange={setTab}
          options={[
            { value: "transactions", label: "Операции-выбросы", count: anomalies.length },
            { value: "spikes", label: "Всплески по категориям", count: spikes.length },
          ]}
        />
        {tab === "transactions" && (
          <Slider
            label="Порог отклонения"
            value={threshold}
            min={2}
            max={4}
            step={0.5}
            onChange={setThreshold}
            format={(v) => `${formatFixed(v)}σ`}
          />
        )}
      </SectionControls>

      {/* Подпись есть у каждой ячейки — без неё средняя выходила бы ниже
          соседних, и ряд читался бы сломанным. */}
      <StatRow>
        <StatCell
          label="Аномальных операций"
          value={formatNum(anomalies.length)}
          tone="warn"
          note={<>Порог: σ &gt; {formatFixed(threshold)}</>}
        />
        <StatCell
          label="Их сумма"
          value={formatMoney(totalAnomalyAmount, base)}
          tone="expense"
          note="Сверх обычного для своей категории"
        />
        <StatCell
          label="Всплески по категориям"
          value={formatNum(spikes.length)}
          tone="warn"
          note={<>Превышение {formatMoney(totalSpikesDelta, base)}</>}
        />
      </StatRow>

      {tab === "transactions" &&
        (anomalies.length === 0 ? (
          <SectionEmpty
            icon={AlertTriangle}
            title="Аномалий не обнаружено"
          >
            Снизьте порог отклонения выше — попадут и менее заметные выбросы
          </SectionEmpty>
        ) : (
          <DataTable<Anomaly>
            // Заголовок у таблицы есть, как в «Топе»: без него строка шапки
            // держала бы одну кнопку «CSV».
            icon={AlertTriangle}
            title="Операции-выбросы"
            data={anomalies}
            rowKey={(a) => a.tx.id}
            defaultSortKey="zScore"
            onRowClick={(a) => openTx(a.tx.id)}
            limit={100}
            exportName="anomalies"
            fixed
            columns={[
              {
                key: "date",
                type: "date",
                width: "8.5rem",
                label: "Дата",
                sortValue: (a) => a.tx.date,
                render: (a) => formatDate(a.tx.date, "full"),
              },
              {
                key: "payee",
                type: "text",
                width: "13rem",
                label: "Получатель",
                sortValue: (a) => a.tx.payee || "",
                render: (a) => a.tx.payee || "—",
              },
              {
                key: "category",
                type: "text",
                muted: true,
                width: "13rem",
                label: "Категория",
                sortValue: (a) => a.tx.categoryFull,
                render: (a) => a.tx.categoryFull,
              },
              {
                key: "context",
                type: "text",
                muted: true,
                label: "Контекст",
                sortable: false,
                exportValue: (a) => a.context,
                // Одна строка, как во всех таблицах: полный текст и комментарий
                // операции — в подсказке при наведении.
                cellTitle: (a) => (a.tx.comment ? `${a.context}\n${a.tx.comment}` : a.context),
                render: (a) => a.context,
              },
              {
                key: "zScore",
                type: "number",
                width: "5.5rem",
                label: "σ",
                headerTitle: "Во сколько раз трата дальше от обычной, чем привычный разброс",
                sortValue: (a) => a.zScore,
                render: (a) => `${formatNum(a.zScore, { fractionDigits: 1 })}σ`,
              },
              {
                key: "amount",
                type: "main",
                tone: "expense",
                width: "10rem",
                label: "Сумма",
                sortValue: (a) => a.tx.amountBase,
                render: (a) => formatMoney(a.tx.amount, a.tx.currency),
              },
            ]}
          />
        ))}

      {tab === "spikes" &&
        (spikes.length === 0 ? (
          <SectionEmpty
            icon={TrendingUp}
            title="Всплесков по категориям не найдено"
          >
            Категория должна вырасти минимум в 1,5× к среднему за 3 предыдущих месяца
          </SectionEmpty>
        ) : (
          <DataTable<MonthSpike>
            icon={TrendingUp}
            title="Всплески по категориям"
            data={spikes}
            rowKey={(sp, i) => `${sp.ym}-${sp.category}-${i}`}
            defaultSortKey="delta"
            onRowClick={(sp) => openCategoryMonth(sp.category, sp.ym)}
            exportName="month_spikes"
            columns={[
              {
                key: "ym",
                type: "text",
                label: "Месяц",
                sortValue: (sp) => sp.ym,
                render: (sp) => monthLabel(sp.ym),
              },
              {
                key: "category",
                type: "text",
                label: "Категория",
                sortValue: (sp) => sp.category,
                render: (sp) => sp.category,
              },
              {
                key: "baseline",
                type: "money",
                muted: true,
                label: "База (3 мес ср.)",
                sortValue: (sp) => sp.baseline,
                render: (sp) => formatMoney(sp.baseline, base),
              },
              {
                key: "current",
                type: "money",
                label: "Факт",
                sortValue: (sp) => sp.current,
                render: (sp) => formatMoney(sp.current, base),
              },
              {
                key: "delta",
                type: "main",
                tone: "expense",
                label: "Превышение",
                sortValue: (sp) => sp.delta,
                render: (sp) => `+${formatMoney(sp.delta, base)}`,
              },
              {
                key: "ratio",
                type: "number",
                label: "×",
                headerTitle: "Во сколько раз расход месяца больше среднего за три предыдущих",
                sortValue: (sp) => sp.ratio,
                render: (sp) => `${formatNum(sp.ratio, { fractionDigits: 1 })}×`,
              },
            ]}
          />
        ))}
    </div>
  );
}
