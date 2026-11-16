import type { ReactNode } from "react";
import {
  KIND_VALUE_LABELS,
  matchRanges,
  ruleKindOf,
  type CategoryRuleV2,
  type MatchRange,
  type RuleField,
} from "../lib/ruleEngine";
import { displayPayee } from "../lib/format";
import type { Transaction } from "../types";

/**
 * Операция в списках правил — строками с подписями и в одном порядке:
 *
 *   Дата: 30 апреля 2025 г. · Тип операции: Расход
 *   Категория: Еда дома
 *   Контрагент: Пятёрочка · В выписке: PYATEROCHKA 20822
 *   Комментарий: Магазин Пятёрочка
 *
 * Общий блок для окна правила (список совпадений) и окна «Что изменят
 * правила»: без подписей было не понять, где контрагент, а где строка из
 * выписки (#136). Пустые поля строк не занимают. С `rule` подсвечено то, на
 * чём сошлись его условия.
 */

/** Подпись поля в строке списка совпадений: «Дата: », «Контрагент: ». */
function MatchLabel({ children }: { children: ReactNode }) {
  return <span className="text-muted">{children}: </span>;
}

/** Точка между двумя полями в одной строке списка совпадений. */
function MatchSep() {
  return <span className="text-muted"> · </span>;
}

/** «30 апреля 2025 г.» — дата словами, как её читают, а не «30 апр.». */
function longDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

/** Сколько знаков оставить перед совпадением, когда текст обрезан слева. */
const CLIP_LEAD = 24;

/**
 * Текст с подсвеченными совпадениями. Если совпадение далеко от начала,
 * начало срезается до «…»: строка в списке одна и обрезается справа, и
 * подсветка в длинном комментарии иначе осталась бы за краем.
 */
function Marked({ text, ranges }: { text: string; ranges: MatchRange[] }) {
  if (ranges.length === 0) return <>{text}</>;
  const from = ranges[0][0] > CLIP_LEAD * 2 ? ranges[0][0] - CLIP_LEAD : 0;
  const parts: ReactNode[] = [];
  let at = from;
  ranges.forEach(([a, b], i) => {
    if (a > at) parts.push(text.slice(at, a));
    parts.push(
      <mark key={i} data-rule-mark className="rounded-[3px] bg-accent/25 text-text">
        {text.slice(a, b)}
      </mark>
    );
    at = b;
  });
  if (at < text.length) parts.push(text.slice(at));
  return (
    <>
      {from > 0 && "…"}
      {parts}
    </>
  );
}

/**
 * Тексты под именем контрагента: что пришло от банка или было набрано
 * раньше. В ленте их не видно, а условие «Контрагент» смотрит и на них.
 *
 * Часто такой текст — та же строка из выписки, слово в слово. Тогда рядом с
 * именем его не повторяем: он уже стоит строкой «В выписке», и подсветка
 * условия «Контрагент» ложится туда (`statementAlsoPayee`).
 */
function payeeUnderTexts(t: Transaction): string[] {
  const shown = displayPayee(t).trim();
  const statement = (t.payeeRaw ?? "").trim();
  const out: string[] = [];
  for (const v of [t.payee, t.payeeOriginal]) {
    const x = (v ?? "").trim();
    if (x && x !== shown && x !== statement && !out.includes(x)) out.push(x);
  }
  return out;
}

/** Строка из выписки записана и текстом под именем контрагента. */
function statementAlsoPayee(t: Transaction): boolean {
  const statement = (t.payeeRaw ?? "").trim();
  const shown = displayPayee(t).trim();
  if (!statement || statement === shown) return false;
  return [t.payee, t.payeeOriginal].some((v) => (v ?? "").trim() === statement);
}

export function RuleMatchFacts({
  tx,
  rule,
  className = "",
}: {
  tx: Transaction;
  /** Правило, чьи совпадения подсветить; без него подсветки нет. */
  rule?: CategoryRuleV2;
  className?: string;
}) {
  const name = displayPayee(tx).trim();
  const statement = (tx.payeeRaw ?? "").trim();
  const comment = (tx.comment ?? "").trim();
  const category = tx.categoryFullOriginal || tx.categoryFull || "";
  const under = payeeUnderTexts(tx);
  const ranges = (text: string, field: RuleField | readonly RuleField[]): MatchRange[] =>
    rule ? matchRanges(text, field, rule) : [];
  return (
    <div className={`min-w-0 flex-1 text-[13px] leading-[1.45] ${className}`}>
      <div className="truncate">
        <MatchLabel>Дата</MatchLabel>
        {longDate(tx.date)}
        <MatchSep />
        <MatchLabel>Тип операции</MatchLabel>
        {KIND_VALUE_LABELS[ruleKindOf(tx)]}
      </div>
      {ruleKindOf(tx) !== "transfer" && ruleKindOf(tx) !== "debt" && (
        <div className="truncate">
          <MatchLabel>Категория</MatchLabel>
          {category ? (
            <Marked text={category} ranges={ranges(category, "category")} />
          ) : (
            "Без категории"
          )}
        </div>
      )}
      {(name || under.length > 0 || statement) && (
        <div className="truncate">
          {(name || under.length > 0) && (
            <span data-rule-payee>
              <MatchLabel>Контрагент</MatchLabel>
              {name && <Marked text={name} ranges={ranges(name, "payee")} />}
              {/* Текст под именем — что было в поле до
                  справочника; условие «Контрагент» видит и его. */}
              {under.map((x) => (
                <span key={x} className="text-muted">
                  {" ("}
                  <Marked text={x} ranges={ranges(x, "payee")} />
                  {")"}
                </span>
              ))}
            </span>
          )}
          {statement && (
            <>
              {(name || under.length > 0) && <MatchSep />}
              <span data-rule-statement>
                <MatchLabel>В выписке</MatchLabel>
                <Marked
                  text={statement}
                  ranges={ranges(
                    statement,
                    statementAlsoPayee(tx) ? ["statement", "payee"] : "statement"
                  )}
                />
              </span>
            </>
          )}
        </div>
      )}
      {comment && (
        <div className="truncate" data-rule-comment>
          <MatchLabel>Комментарий</MatchLabel>
          <Marked text={comment} ranges={ranges(comment, "comment")} />
        </div>
      )}
    </div>
  );
}
