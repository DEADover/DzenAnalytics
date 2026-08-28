/**
 * Фильтр наблюдений для блока «Что заметно» на главной.
 *
 * Смысл модуля — решить, ЧТО показать и в каком порядке, один раз и в чистом
 * коде. Пока этой развилки не было, каждая раскладка фильтровала наблюдения
 * сама, а половина того, что попадало на экран, была шумом: «В воскресенье
 * средний чек выше всего» и «Расходы по дням недели примерно ровные»
 * срабатывают почти всегда и не меняют ни одного решения.
 *
 * Правило фильтра одно: наблюдение обязано называть конкретную вещь, с которой
 * можно что-то сделать, — статью, подписку, платёж. Всё остальное отброшено.
 */

import type { Insight, MonthSpike, RecurringCandidate } from "./aggregations";
import { formatMoney } from "./format";
import type { Currency } from "../types";

/** Откуда наблюдение — по нему подбирается значок в списке. */
export type NoticeKind = "plan" | "spike" | "price" | "missed" | "insight";

export interface Notice {
  /** Устойчивый ключ для списка. */
  id: string;
  kind: NoticeKind;
  tone: "expense" | "income" | "warn" | "accent";
  /** Первая строка — о чём речь. */
  title: string;
  /** Вторая строка — подробность с числом. */
  body: string;
  /** Денежная сумма справа. Не заполняется, когда числа у наблюдения нет. */
  value?: number;
  /** Категория — чтобы поставить её фирменную точку вместо цветного кружка. */
  category?: string;
  /** Чем больше, тем выше в списке. */
  weight: number;
}

/** Насколько сильно план должен быть пробит, чтобы об этом стоило говорить. */
const PLAN_BREACH_MIN = 1.05;

/** Порог подорожания подписки, ниже которого это просто колебание чека. */
const PRICE_UP_MIN = 0.1;

/**
 * Сколько наблюдений одного вида пускать в список.
 *
 * Без этого один разговорчивый источник забивает блок целиком: три
 * подорожавшие подписки подряд вытесняли и самую крупную трату, и сравнение с
 * прошлым месяцем. Список должен быть разным по существу, а не длинным.
 */
const PER_KIND_LIMIT = 2;

function pct(v: number): string {
  return `${Math.round(Math.abs(v) * 100)}%`;
}



export interface NoticesInput {
  /** Текущий период, YYYY-MM. */
  ym: string;
  /** Базовая валюта — суммы внутри текста печатаются в ней. */
  base: Currency;
  /** Сегодня, YYYY-MM-DD. */
  today: string;
  /** Всплески статей за текущий месяц. */
  spikes: MonthSpike[];
  /** Регулярные платежи со всей их разметкой. */
  recurring: RecurringCandidate[];
  /** План месяца по статьям: категория → сумма. Пусто, если планов нет. */
  planByCategory: Map<string, number>;
  /** Факт месяца по статьям: категория → сумма. */
  factByCategory: Map<string, number>;
  /** Готовые авто-наблюдения. */
  insights: Insight[];
}

/**
 * Собрать и упорядочить наблюдения.
 *
 * Порядок задан весом, а не источником: пробитый план важнее разогнавшейся
 * статьи, потому что план человек ставил сам; разогнавшаяся статья важнее
 * подорожавшей подписки, потому что там больше денег. Одна и та же категория
 * не повторяется дважды — иначе «Продукты» заняли бы весь список.
 */
export function buildNotices(input: NoticesInput): Notice[] {
  const out: Notice[] = [];
  const usedCategories = new Set<string>();
  const money = (v: number) => formatMoney(v, input.base);
  const taken: Record<string, number> = {};
  const room = (kind: string) => (taken[kind] = (taken[kind] ?? 0) + 1) <= PER_KIND_LIMIT;

  // 1. Пробитые статьи плана — самое важное: границу ставил сам пользователь.
  for (const [category, plan] of input.planByCategory) {
    if (plan <= 0) continue;
    const fact = input.factByCategory.get(category) ?? 0;
    if (fact < plan * PLAN_BREACH_MIN) continue;
    if (!room("plan")) continue;
    out.push({
      id: `plan-${category}`,
      kind: "plan",
      tone: "expense",
      title: category,
      body: `План ${money(plan)} — превышен на ${pct(fact / plan - 1)}`,
      value: fact,
      category,
      weight: 100,
    });
    usedCategories.add(category);
  }

  // 2. Статьи, разогнавшиеся против обычного.
  for (const s of input.spikes) {
    if (s.ym !== input.ym) continue;
    if (usedCategories.has(s.category)) continue;
    if (!room("spike")) continue;
    out.push({
      id: `spike-${s.category}`,
      kind: "spike",
      tone: "expense",
      title: s.category,
      body: `Обычно ${money(s.baseline)} · ×${s.ratio.toFixed(1).replace(".", ",")}`,
      value: s.current,
      category: s.category,
      weight: 90,
    });
    usedCategories.add(s.category);
  }

  // 3. Подорожавшие подписки. Расчёт уже делается при поиске регулярных, но
  //    результат до сих пор нигде не показывали.
  for (const r of input.recurring) {
    if (r.stale) continue;
    if (r.priceTrend.priceFlag !== "up") continue;
    if (r.priceTrend.changePct < PRICE_UP_MIN) continue;
    if (!room("price")) continue;
    out.push({
      id: `price-${r.payee}-${r.currency}`,
      kind: "price",
      tone: "warn",
      title: r.payee,
      body: `Подорожало на ${pct(r.priceTrend.changePct)} против обычного платежа`,
      value: r.avgAmount,
      weight: 80,
    });
  }

  // 4. Регулярный платёж, которого ждали и который не пришёл. `stale` тут не
  //    годится: он про давно брошенные подписки, а нас интересует свежий
  //    пропуск — деньги ещё спишутся и их надо держать в уме.
  for (const r of input.recurring) {
    if (r.stale) continue;
    if (r.nextExpected >= input.today) continue;
    if (!room("missed")) continue;
    out.push({
      id: `missed-${r.payee}-${r.currency}`,
      kind: "missed",
      tone: "accent",
      title: r.payee,
      body: `Ждали ${r.nextExpected.slice(8, 10)}.${r.nextExpected.slice(5, 7)} — платежа пока нет`,
      value: r.avgAmount,
      weight: 70,
    });
  }

  // 5. Готовые наблюдения. `fact` отбрасываем: это правила, которые
  //    срабатывают всегда и ничего не сообщают.
  for (const i of input.insights) {
    if (i.kind === "fact") continue;
    // Название статьи внутри текста наблюдения — признак, что о ней уже
    // сказано выше числом и кратностью.
    if ([...usedCategories].some((c) => i.body.includes(c))) continue;
    if (!room(`insight-${i.kind}`)) continue;
    out.push({
      id: `insight-${i.title}`,
      kind: "insight",
      tone: i.positive ? "income" : i.kind === "warning" ? "warn" : "accent",
      title: i.title,
      body: i.body,
      // `value` у наблюдений означает разное — где сумму, где долю, где
      // кратность. Деньгами показываем только «самую крупную трату»: у
      // остальных число уже стоит в тексте.
      value: i.kind === "highlight" ? i.value : undefined,
      weight: i.kind === "highlight" ? 60 : 50,
    });
  }

  return out.sort((a, b) => b.weight - a.weight || (b.value ?? 0) - (a.value ?? 0));
}
