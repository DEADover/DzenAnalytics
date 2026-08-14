import { useMemo, useRef, useState } from "react";
import { Settings2 } from "lucide-react";
import { useBudgetSettingsStore } from "../store/useBudgetSettingsStore";
import type { ForecastBasis } from "../lib/budgetForecast";
import type { Transaction } from "../types";
import { pluralRu } from "../lib/plural";
import { AccountLogo } from "./AccountLogo";
import { MultiSelect } from "./MultiSelect";
import { Popover } from "./Popover";
import { Segmented } from "./Segmented";
import { SettingRow } from "./SettingRow";
import { Switch } from "./Switch";
import { Tooltip } from "./Tooltip";

/** Те же окна, что предлагает окно «Заполнить по среднему». */
const FORECAST_PERIODS = [
  { value: 1, label: "Месяц" },
  { value: 3, label: "Квартал" },
  { value: 6, label: "Полгода" },
  { value: 12, label: "Год" },
];

/**
 * Настройки бюджета: периметр счетов, переводы через его границу, вид и
 * прогноз по умолчанию.
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
          className="btn-ghost !p-2"
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
        className="w-[30rem] card card-pad shadow-lg"
      >
        <div className="label mb-1">Настройки бюджета</div>

        <SettingRow
          title="Счета"
          status={
            allAccounts
              ? "Все счета"
              : `${selected.size} ${pluralRu(selected.size, ["счёт", "счёта", "счетов"])} из ${accounts.length}`
          }
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
          title="Учитывать переводы"
          status={
            s.perimeterTransfers
              ? "Списание — в расходы, зачисление — в доходы, статьёй «Переводы»"
              : "Переводы не считаются"
          }
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
          title="Вид по умолчанию"
          status="С чего открывать раздел"
          control={
            <Segmented
              size="sm"
              label="Вид по умолчанию"
              value={s.defaultView}
              onChange={(v) => void s.update({ defaultView: v })}
              options={[
                { value: "month" as const, label: "Месяц" },
                { value: "year" as const, label: "Год" },
              ]}
            />
          }
        />

        <SettingRow
          title="Прогноз по умолчанию"
          status="Период и способ расчёта в окне заполнения"
          control={
            <Segmented
              size="sm"
              label="Период прогноза по умолчанию"
              value={s.forecastMonths}
              onChange={(v) => void s.update({ forecastMonths: v })}
              options={FORECAST_PERIODS}
            />
          }
        >
          <div className="flex justify-end pt-2">
            <Segmented
              size="sm"
              label="Способ расчёта прогноза по умолчанию"
              value={s.forecastBasis}
              onChange={(v) => void s.update({ forecastBasis: v as ForecastBasis })}
              options={[
                { value: "average", label: "Среднее" },
                { value: "median", label: "Медиана" },
              ]}
            />
          </div>
        </SettingRow>
      </Popover>
    </div>
  );
}
