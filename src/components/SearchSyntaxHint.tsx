import { InfoPopover } from "./InfoPopover";

const ROWS: { code: string; text: string }[] = [
  { code: "-такси", text: "Убрать операции, где встречается «такси»" },
  { code: "комм:подарок", text: "Искать слово только в комментарии" },
  { code: "комм:-подарок", text: "Убрать операции с этим словом в комментарии" },
  { code: "комм:пусто", text: "Только операции без комментария" },
  { code: "комм:есть", text: "Только операции с комментарием" },
  { code: '-"на вынос"', text: "Несколько слов подряд — в кавычках" },
];

/**
 * Знак вопроса в поле текстового поиска: какие условия оно понимает (#135).
 * Один на «Фильтр» общей панели и «Быстрый поиск по таблице» — разбор у них
 * общий (`lib/textQuery`), значит, и памятка одна.
 */
export function SearchSyntaxHint() {
  return (
    <InfoPopover label="Как искать">
      <p className="text-text font-medium">Как искать</p>
      <p>
        Обычный текст находит операции, где он встречается. Поиск можно уточнить
        условием:
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 items-baseline">
        {ROWS.map((r) => (
          <div key={r.code} className="contents">
            <dt>
              <code className="rounded bg-panel2 px-1.5 py-0.5 text-text whitespace-nowrap">{r.code}</code>
            </dt>
            <dd>{r.text}</dd>
          </div>
        ))}
      </dl>
      <p>
        Условия сочетаются через пробел: <code className="text-text">аптека комм:-мама</code> — аптеки,
        где в комментарии нет слова «мама».
      </p>
      <p>Пробел после «комм:» ставить не обязательно.</p>
      <p>
        Начните писать «комм» и нажмите <kbd className="kbd">Tab</kbd> — поле само подставит «комм:».
      </p>
    </InfoPopover>
  );
}
