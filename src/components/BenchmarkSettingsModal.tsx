import { useMemo, type ReactNode } from "react";
import { CreditCard, Home, PiggyBank, Repeat, Scale, SlidersHorizontal, TrendingUp, type LucideIcon } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useBenchmarksStore } from "../store/useBenchmarksStore";
import { useAccountDirectory } from "../hooks/useAccountDirectory";
import { useCategoryFilterNodes } from "../hooks/useCategoryFilterNodes";
import { useLoanKeys } from "../hooks/useBenchmarks";
import { accountOptions } from "../lib/accountOptions";
import { accountKindLabel } from "../lib/accountType";
import { categoryLeavesOf } from "../lib/categoryFilterNodes";
import { listToSet, setToList } from "../lib/selectionSet";
import { AccountLogo } from "./AccountLogo";
import { CategoryFilterPicker } from "./CategoryFilterPicker";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "./Modal";
import { MultiSelect } from "./MultiSelect";
import { SettingRow } from "./SettingRow";
import { Slider } from "./Slider";
import { Switch } from "./Switch";

/** Заголовок ориентира с выключателем; под ним — его настройки. */
function Group({
  icon: Icon,
  title,
  on,
  onToggle,
  children,
}: {
  icon: LucideIcon;
  title: string;
  on: boolean;
  onToggle: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 font-semibold text-sm">
          <Icon className="w-4 h-4 text-accent" aria-hidden />
          {title}
        </div>
        <Switch checked={on} onChange={onToggle} label={`Показывать «${title}»`} />
      </div>
      {on && <div className="mt-1">{children}</div>}
    </section>
  );
}

/**
 * Настройка «Ориентиров» (#134): какие показывать, какие категории и счета к
 * ним относятся, пороги. Сохраняется сразу — кнопки «Сохранить» нет.
 */
export function BenchmarkSettingsModal({ onClose }: { onClose: () => void }) {
  const s = useBenchmarksStore();
  const transactions = useDataStore((st) => st.transactions);
  const nodes = useCategoryFilterNodes(transactions);
  const leaves = useMemo(() => categoryLeavesOf(nodes), [nodes]);
  const loanKeys = useLoanKeys();

  const dir = useAccountDirectory();
  const kinds = useMemo(
    () => new Map(dir.list.map((e) => [e.key, e.type ? accountKindLabel(e.type, e.savings) : ""])),
    [dir]
  );
  const archivedSet = useMemo(
    () => new Set(dir.list.filter((e) => e.archive).map((e) => e.key)),
    [dir]
  );
  const accounts = useMemo(
    () => accountOptions(dir.list.map((e) => e.key), [], { archived: archivedSet, kinds, labelOf: dir.label }),
    [dir, archivedSet, kinds]
  );

  const categories = (label: string, value: string[], onChange: (next: string[]) => void) => (
    <SettingRow
      dense
      title={label}
      control={
        <CategoryFilterPicker
          className="w-56"
          nodes={nodes}
          selected={listToSet(value, leaves)}
          onChange={(next) => onChange(setToList(next, leaves))}
        />
      }
    />
  );
  const accountPicker = (label: string, value: string[], onChange: (next: string[]) => void) => (
    <SettingRow
      dense
      title={label}
      control={
        <MultiSelect
          className="w-56"
          label={label}
          options={accounts}
          selected={listToSet(value, accounts)}
          onChange={(next) => onChange(setToList(next, accounts))}
          renderIcon={(key) => <AccountLogo title={dir.byKey.get(key)?.title ?? key} size={18} />}
          labelOf={dir.label}
          groupOf={(key) => (archivedSet.has(key) ? null : kinds.get(key) || null)}
          archivedSet={archivedSet}
          unitForms={["счёт", "счёта", "счетов"]}
          searchPlaceholder="Поиск счёта"
        />
      }
    />
  );
  const limit = (label: string, value: number, onChange: (v: number) => void) => (
    <Slider
      className="py-1.5"
      layout="stacked"
      label={label}
      min={10}
      max={60}
      step={1}
      value={value}
      format={(v) => `${v}% дохода`}
      onChange={onChange}
    />
  );

  return (
    <Modal onClose={onClose} width="lg">
      <ModalHeader
        icon={SlidersHorizontal}
        title="Ориентиры"
        subtitle="Выключатель справа прячет карточку. На общую оценку ориентиры не влияют."
      />
      <ModalBody scroll gap={4}>
        <Group icon={Home} title="Расходы на жильё" on={s.housingOn} onToggle={(v) => void s.update({ housingOn: v })}>
          {categories("Что относится к жилью", s.housingCategories, (v) => void s.update({ housingCategories: v }))}
          {limit("Норма — не больше", s.housingLimit, (v) => void s.update({ housingLimit: v }))}
        </Group>

        <Group icon={CreditCard} title="Платежи по кредитам" on={s.debtOn} onToggle={(v) => void s.update({ debtOn: v })}>
          {accountPicker("Кредитные счета", s.debtAccounts ?? loanKeys, (v) => void s.update({ debtAccounts: v }))}
          {categories("Платежи, записанные расходом", s.debtCategories, (v) => void s.update({ debtCategories: v }))}
          {limit("Норма — не больше", s.debtLimit, (v) => void s.update({ debtLimit: v }))}
        </Group>

        <Group icon={PiggyBank} title="Доля вложений в доходе" on={s.investOn} onToggle={(v) => void s.update({ investOn: v })}>
          <Slider
            className="py-1.5"
            layout="stacked"
            label="Цель — не меньше"
            min={5}
            max={50}
            step={1}
            value={s.investTarget}
            format={(v) => `${v}% дохода`}
            onChange={(v) => void s.update({ investTarget: v })}
          />
        </Group>

        <Group icon={TrendingUp} title="Удвоение вложений" on={s.doublingOn} onToggle={(v) => void s.update({ doublingOn: v })}>
          <p className="text-xs text-muted py-1.5">
            Доходность меняется бегунком на самой карточке.
          </p>
        </Group>

        <Group icon={Scale} title="Рост расходов и доходов" on={s.growthOn} onToggle={(v) => void s.update({ growthOn: v })}>
          <p className="text-xs text-muted py-1.5">
            Сравниваются последние 12 полных месяцев и 12 месяцев до них. Настроек нет.
          </p>
        </Group>

        <Group icon={Repeat} title="Расходы на подписки" on={s.recurringOn} onToggle={(v) => void s.update({ recurringOn: v })}>
          {limit("Норма — не больше", s.recurringLimit, (v) => void s.update({ recurringLimit: v }))}
        </Group>

        {(s.investOn || s.doublingOn) && (
          <section>
            <div className="font-semibold text-sm">Что считать вложениями</div>
            <div className="mt-1">
              {accountPicker("Инвестиционные счета", s.investAccounts, (v) => void s.update({ investAccounts: v }))}
              {categories("Вложения, записанные расходом", s.investCategories, (v) => void s.update({ investCategories: v }))}
            </div>
          </section>
        )}
      </ModalBody>
      <ModalFooter>
        <button type="button" className="btn-primary text-sm" onClick={onClose}>
          Готово
        </button>
      </ModalFooter>
    </Modal>
  );
}
