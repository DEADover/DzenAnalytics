import { useMemo, useState } from "react";
import { StatCell, StatRow } from "../components/SectionCard";
import { pluralRu } from "../lib/plural";
import { Cloud, ListOrdered } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useDrillStore } from "../store/useDrillStore";
import { buildWordcloud, type WordcloudWord } from "../lib/aggregations";
import { formatMoney, formatNum } from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { DataTable } from "../components/DataTable";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";
import { SectionEmpty } from "../components/SectionEmpty";
import { SectionControls } from "../components/SectionControls";
import { Slider } from "../components/Slider";
import { InfoPopover, InfoTerm } from "../components/InfoPopover";

const PALETTE = [
  "#22D3EE",
  "#A78BFA",
  "#F59E0B",
  "#10B981",
  "#EF4444",
  "#EC4899",
  "#3B82F6",
  "#84CC16",
  "#F97316",
  "#14B8A6",
];

export function WordcloudPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const showDrill = useDrillStore((s) => s.show);

  const [minLen, setMinLen] = useState(3);
  const [topN, setTopN] = useState(120);

  const filtered = useMemo(() => applyFilters(transactions, filters, monthStartDay), [transactions, filters, monthStartDay]);
  const words = useMemo(
    () => buildWordcloud(filtered, minLen, topN),
    [filtered, minLen, topN]
  );

  // Место слова — по частоте: сортировка таблицы его не меняет.
  const topWords = useMemo(
    () => words.slice(0, 30).map((w, i) => ({ ...w, rank: i + 1 })),
    [words]
  );

  if (transactions.length === 0) return <EmptyState />;

  const maxCount = words[0]?.count || 1;
  const minCount = words[words.length - 1]?.count || 1;

  function fontSize(count: number): number {
    if (maxCount === minCount) return 18;
    const t = (count - minCount) / (maxCount - minCount);
    return Math.round(12 + t * 38);
  }

  function openWord(w: WordcloudWord) {
    const escaped = w.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|\\s|[.,!?;:#-])${escaped}($|[.,!?;:\\s-])`, "iu");
    const txs = filtered.filter((t) => t.comment && re.test(t.comment));
    showDrill(`«${w.text}»`, txs, "Слово в комментариях");
  }

  const totalCommentTxs = filtered.filter((t) => t.comment && t.kind !== "transfer").length;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Cloud}
        title="Облако слов"
        hint="Чем крупнее слово, тем чаще оно встречается"
        info={
          <InfoPopover>
            <p>
              Слова берём из комментариев к операциям за период и фильтры сверху,
              переводы не считаем. Слово засчитывается один раз на операцию и
              попадает в облако, если встретилось хотя бы в{" "}
              <InfoTerm>двух операциях</InfoTerm>. Числа и служебные слова вроде
              «и», «на», «для» пропускаем.
            </p>
            <p>
              <InfoTerm>«Длина слова»</InfoTerm> отсекает слова короче, чем
              выбрано, <InfoTerm>«Слов в облаке»</InfoTerm> — сколько самых частых
              показать. Размер слова — частота, цвет — только для удобства чтения.
            </p>
            <p>Нажатие на слово или строку таблицы открывает операции с ним.</p>
          </InfoPopover>
        }
      />
      <GlobalFilters />

      {/* Бегунки — рядом контролов раздела: они меняют и облако, и итоги, и
          таблицу. В шапке они стояли без рамки, у одного подпись была со
          строчной («топ»), а рядом висела пометка «Кликабельные» — теперь это
          сказано в «?». */}
      <SectionControls>
        <div className="flex flex-wrap items-center gap-3">
          <Slider
            label="Длина слова"
            value={minLen}
            min={2}
            max={6}
            onChange={setMinLen}
            format={(v) => `от ${v} букв`}
          />
          <Slider
            label="Слов в облаке"
            value={topN}
            min={40}
            max={300}
            step={20}
            onChange={setTopN}
            format={(v) => formatNum(v)}
          />
        </div>
      </SectionControls>

      <StatRow>
        <StatCell label="Уникальных слов" value={formatNum(words.length)} />
        <StatCell label="Операций с комментариями" value={formatNum(totalCommentTxs)} />
        <StatCell
          label="Самое частое"
          value={<span title={words[0]?.text}>{words[0]?.text || "—"}</span>}
          tone="accent"
          note={words[0] ? `встречается ${formatNum(words[0].count)} ${pluralRu(words[0].count, ["раз", "раза", "раз"])}` : undefined}
        />
      </StatRow>

      {words.length === 0 ? (
        <SectionEmpty icon={Cloud} title="Нет слов для облака">
          В текущем фильтре нет комментариев или все они слишком короткие
        </SectionEmpty>
      ) : (
        <div className="card-tray card-pad">
          <div className="flex flex-wrap gap-2 justify-center items-center py-6">
            {words.map((w, i) => (
              <button
                key={w.text}
                onClick={() => openWord(w)}
                className="hover:bg-panel2/60 px-1.5 py-0.5 rounded transition-colors"
                style={{
                  fontSize: `${fontSize(w.count)}px`,
                  color: PALETTE[i % PALETTE.length],
                  fontWeight: fontSize(w.count) > 30 ? 700 : fontSize(w.count) > 20 ? 600 : 500,
                  lineHeight: 1.1,
                }}
                title={`«${w.text}» · ${w.count} раз · ${formatMoney(w.totalAmount, base)}`}
              >
                {w.text}
              </button>
            ))}
          </div>
        </div>
      )}

      {words.length > 0 && (
        <DataTable<WordcloudWord & { rank: number }>
          icon={ListOrdered}
          title="Топ-30 слов"
          data={topWords}
          rowKey={(w) => w.text}
          defaultSortKey="rank"
          defaultSortDir="asc"
          onRowClick={openWord}
          exportName="wordcloud_top"
          fixed
          columns={[
            {
              key: "rank",
              type: "count",
              width: "4rem",
              label: "#",
              headerTitle: "Место по частоте",
              sortValue: (w) => w.rank,
              render: (w) => formatNum(w.rank),
            },
            {
              key: "text",
              type: "text",
              label: "Слово",
              sortValue: (w) => w.text,
              render: (w) => w.text,
            },
            {
              key: "count",
              type: "count",
              width: "8rem",
              label: "Частота",
              sortValue: (w) => w.count,
              render: (w) => formatNum(w.count),
            },
            {
              key: "total",
              type: "money",
              muted: true,
              width: "11rem",
              label: "Сумма операций",
              sortValue: (w) => w.totalAmount,
              render: (w) => formatMoney(w.totalAmount, base),
            },
          ]}
        />
      )}
    </div>
  );
}
