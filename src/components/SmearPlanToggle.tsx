import { Switch } from "./Switch";
import { Tooltip } from "./Tooltip";
import { useBudgetSettingsStore } from "../store/useBudgetSettingsStore";

/**
 * «Размазывать план» — переключатель у прогноза до конца месяца на графиках
 * (бюджет, «Сравнение»). Один на все графики: настройка общая, и включённая
 * в одном месте она действует везде.
 *
 * Включено — остаток плана идёт ровной линией по оставшимся дням, как «План
 * на день» в Дзен-мани. Выключено — в прогнозе только назначенные операции,
 * ступенькой в свой день.
 */
export function SmearPlanToggle() {
  const smear = useBudgetSettingsStore((s) => s.smearPlan);
  const update = useBudgetSettingsStore((s) => s.update);
  return (
    <Tooltip content="Остаток плана ровно по оставшимся дням, как «План на день» в Дзен-мани. Выключено — в прогнозе только назначенные операции, в свои дни">
      <label className="flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
        <Switch
          checked={smear}
          onChange={(v) => void update({ smearPlan: v })}
          label="Размазывать план по дням"
        />
        <span>Размазывать план</span>
      </label>
    </Tooltip>
  );
}
