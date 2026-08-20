import { useMemo, useRef, useState } from "react";
import { Settings2 } from "lucide-react";
import { useBudgetSettingsStore } from "../store/useBudgetSettingsStore";
import type { Transaction } from "../types";
import { AccountLogo } from "./AccountLogo";
import { MultiSelect } from "./MultiSelect";
import { Popover } from "./Popover";
import { Segmented } from "./Segmented";
import { InfoTerm } from "./InfoPopover";
import { SettingRow } from "./SettingRow";
import { Switch } from "./Switch";
import { Tooltip } from "./Tooltip";


/**
 * Настройки бюджета: периметр счетов, переводы через его границу, порядок
 * статей, пустые строки и вид по умолчанию.
 *
 * Период и способ расчёта прогноза сюда НЕ вынесены: они нужны только окну
 * «Заполнить по среднему», там и задаются, а выбранное запоминается. Два
 * места для одного вопроса — это два разных ответа при первом же расхождении.
 *
 * Живут на самой странице, а не в общих настройках сервиса: это настройки
 * одного раздела, и менять их хочется, глядя на бюджет.
 */
export function BudgetSettingsPopover({ transactions }: { transactions: Transaction[] }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const s = useBudgetSettingsStore();

  // Счета берём из самих операций: так список одинаково полон и на выгрузке
  // CSV, и на синхронизации по API.
  const accounts = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) {
      if (t.account) set.add(t.account);
      if (t.outcomeAccount) set.add(t.outcomeAccount);
      if (t.incomeAccount) set.add(t.incomeAccount);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [transactions]);

  const selected = useMemo(() => new Set(s.accounts), [s.accounts]);
  const allAccounts = selected.size === 0;

  return (
    <div ref={anchorRef} className="relative">
      <Tooltip content="Настройки бюджета">
        <button
          onClick={() => setOpen((o) => !o)}
          // Ростом с соседями по строке шапки: переключателем вида, выбором
          // месяца и «Заполнить по среднему».
          className="btn-ghost !p-2.5"
          aria-label="Настройки бюджета"
        >
          <Settings2 className="w-4 h-4" />
        </button>
      </Tooltip>
      <Popover
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        align="right"
        // Уже и плотнее обычной карточки: настроек осталось пять, и окно в
        // 30rem с полем в 20 пикселей вокруг выглядело полупустым.
        className="w-[26rem] card p-3.5 shadow-lg"
      >
        <div className="label mb-0.5">Настройки бюджета</div>

        <SettingRow
          dense
          title="Счета"
          help={
            <>
              <p>
                Ограничивает ФАКТ: в план и факт идут только операции выбранных
                счетов. Сам план от счетов не зависит — он задан на статью.
              </p>
              <p>
                Пустой выбор означает все счета — то же соглашение, что и у
                фильтров в остальном сервисе.
              </p>
            </>
          }
          control={
            <MultiSelect
              className="w-52"
              label="Счета"
              options={accounts}
              selected={selected}
              onChange={(next) => void s.update({ accounts: [...next] })}
              renderIcon={(name) => <AccountLogo title={name} size={18} />}
              unitForms={["счёт", "счёта", "счетов"]}
              searchPlaceholder="Поиск счёта"
            />
          }
        />

        <SettingRow
          dense
          title="Учитывать переводы"
          help={
            <>
              <p>
                С включённой настройкой перевод виден обеими сторонами: списание
                попадает в расходы, зачисление — в доходы, статьёй «Переводы», а
                подкатегория — счёт по ту сторону. Перевод 200 ₽ со счёта на
                счёт даст 200 ₽ расхода и 200 ₽ дохода.
              </p>
              <p>
                Поэтому итог расходов показывается двумя строками. «Итого
                расходы» отвечает на вопрос «сколько потрачено», а «Расход,
                включая переводы» — «сколько прошло по счетам»: перекладывание
                денег между своими картами раздувает вторую сумму, но тратой не
                является. На разницу «доходы − расходы» переводы внутри бюджета
                не влияют — стороны гасят друг друга.
              </p>
              {!allAccounts && (
                <p>
                  Бюджет сужен до части счетов: сторона перевода считается,
                  только если её счёт входит в бюджет. Перевод наружу — чистый
                  отток, перевод внутрь — поступление.
                </p>
              )}
            </>
          }
          control={
            <Switch
              checked={s.perimeterTransfers}
              onChange={(v) => void s.update({ perimeterTransfers: v })}
              label="Учитывать переводы"
            />
          }
        />

        <SettingRow
          dense
          title="Порядок статей"
          help={
            <>
              <p>
                По алфавиту — по названию, как в справочнике категорий: у статьи
                всегда одно место. По сумме — сверху те, на которые ушло больше.
              </p>
              <p>
                Действует везде: в месяце, в годовом своде, на дашборде и в
                выгрузках в Excel и PDF.
              </p>
              <p>
                Переводы при любом порядке идут последними — это не статья
                расходов в ряду прочих, а оборот по счетам.
              </p>
            </>
          }
          control={
            <Segmented
              size="sm"
              label="Порядок статей"
              value={s.rowOrder}
              onChange={(v) => void s.update({ rowOrder: v })}
              options={[
                { value: "alpha" as const, label: "По алфавиту" },
                { value: "amount" as const, label: "По сумме" },
              ]}
            />
          }
        />

        <SettingRow
          dense
          title="Статьи без операций"
          help={
            <>
              <p>
                Действует в <InfoTerm>годовом своде</InfoTerm>. Статья, по
                которой за год не прошло ни одной операции, — это строка из
                прочерков; то же и с подкатегориями внутри категории.
              </p>
              <p>
                Со скрытием они не пропадают: под списком раздела стоит
                разделитель «Без операций за год» — он говорит, сколько таких
                статей и сколько на них запланировано, и открывает их.
              </p>
              <p>Итоги раздела считаются по всем статьям, включая скрытые.</p>
            </>
          }
          control={
            <Segmented
              size="sm"
              label="Статьи без операций"
              value={s.hideEmptyRows ? "hide" : "show"}
              onChange={(v) => void s.update({ hideEmptyRows: v === "hide" })}
              options={[
                { value: "hide" as const, label: "Скрывать" },
                { value: "show" as const, label: "Показывать" },
              ]}
            />
          }
        />

        <SettingRow
          dense
          title="Вид по умолчанию"
          help={
            <>
              <p>
                С какого вида открывается раздел. <InfoTerm>Месяц</InfoTerm> —
                план и факт выбранного месяца, <InfoTerm>Год</InfoTerm> —
                помесячная сетка со всеми статьями,{" "}
                <InfoTerm>Дашборд</InfoTerm> — сводка по году: показатели,
                выполнение плана и статьи диаграммами.
              </p>
              <p>
                Переключатель наверху страницы это не отменяет — он работает до
                ухода из раздела, а настройка задаёт, с чего начинать.
              </p>
            </>
          }
          control={
            <Segmented
              size="sm"
              label="Вид по умолчанию"
              value={s.defaultView}
              onChange={(v) => void s.update({ defaultView: v })}
              // Тем же порядком, что и переключатель в шапке раздела.
              options={[
                { value: "dashboard" as const, label: "Дашборд" },
                { value: "month" as const, label: "Месяц" },
                { value: "year" as const, label: "Год" },
              ]}
            />
          }
        />

      </Popover>
    </div>
  );
}
