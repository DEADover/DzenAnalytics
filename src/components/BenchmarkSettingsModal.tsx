import { useMemo, type ReactNode } from "react";
import {
  CreditCard,
  Home,
  Landmark,
  PiggyBank,
  Repeat,
  Scale,
  SlidersHorizontal,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
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

/** Заголовок с пояснением и выключателем карточки. */
function Head({
  icon: Icon,
  title,
  hint,
  on,
  onToggle,
}: {
  icon: LucideIcon;
  title: string;
  /** Одной строкой: что показывает карточка. */
  hint: string;
  /** Без выключателя — у блока, который сам карточкой не является. */
  on?: boolean;
  onToggle?: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-3">
      <div className="flex items-start gap-2.5 min-w-0">
        <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${on === false ? "text-muted" : "text-accent"}`} aria-hidden />
        <div className="min-w-0">
          <div className={`font-semibold text-sm leading-tight ${on === false ? "text-muted" : ""}`}>{title}</div>
          <div className="text-xs text-muted mt-0.5">{hint}</div>
        </div>
      </div>
      {onToggle && on !== undefined && (
        <Switch checked={on} onChange={onToggle} label={`Показывать «${title}»`} />
      )}
    </div>
  );
}

/** Блок одного ориентира: заголовок с выключателем и его настройки под чертой. */
function Panel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border divide-y divide-border" data-benchmark-settings={id}>
      {children}
    </section>
  );
}

/** Настройки под заголовком — с отступом, как у заголовка. */
function Body({ children }: { children: ReactNode }) {
  return <div className="px-3.5 py-1.5">{children}</div>;
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
          // В самом поле — коротко: полное название стоит слева в строке.
          label="Счета"
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
    <Modal onClose={onClose} width="xl">
      <ModalHeader
        icon={SlidersHorizontal}
        title="Ориентиры"
        subtitle="Выключатель прячет карточку. На общую оценку ориентиры не влияют."
      />
      <ModalBody scroll gap={3}>
        <Panel id="housing">
          <Head
            icon={Home}
            title="Расходы на жильё"
            hint="Какая часть дохода уходит на жильё"
            on={s.housingOn}
            onToggle={(v) => void s.update({ housingOn: v })}
          />
          {s.housingOn && (
            <Body>
              {categories("Что относится к жилью", s.housingCategories, (v) => void s.update({ housingCategories: v }))}
              {limit("Норма — не больше", s.housingLimit, (v) => void s.update({ housingLimit: v }))}
            </Body>
          )}
        </Panel>

        <Panel id="debt">
          <Head
            icon={CreditCard}
            title="Платежи по кредитам"
            hint="Какая часть дохода уходит на кредиты"
            on={s.debtOn}
            onToggle={(v) => void s.update({ debtOn: v })}
          />
          {s.debtOn && (
            <Body>
              {accountPicker("Кредитные счета", s.debtAccounts ?? loanKeys, (v) => void s.update({ debtAccounts: v }))}
              {categories("Платежи, записанные расходом", s.debtCategories, (v) => void s.update({ debtCategories: v }))}
              {limit("Норма — не больше", s.debtLimit, (v) => void s.update({ debtLimit: v }))}
            </Body>
          )}
        </Panel>

        {/* Вложения — один блок на две карточки: обе считают по одним счетам,
            и выбирать их дважды незачем. */}
        <Panel id="invest">
          <Head icon={Landmark} title="Вложения" hint="Что считать вложениями — общее для двух карточек ниже" />
          <Body>
            {accountPicker("Инвестиционные счета", s.investAccounts, (v) => void s.update({ investAccounts: v }))}
            {categories("Вложения, записанные расходом", s.investCategories, (v) => void s.update({ investCategories: v }))}
          </Body>
          <Head
            icon={PiggyBank}
            title="Доля вложений в доходе"
            hint="Какую часть дохода вы вкладываете"
            on={s.investOn}
            onToggle={(v) => void s.update({ investOn: v })}
          />
          {s.investOn && (
            <Body>
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
            </Body>
          )}
          <Head
            icon={TrendingUp}
            title="Удвоение вложений"
            hint="За сколько лет вложения удвоятся — правило 72"
            on={s.doublingOn}
            onToggle={(v) => void s.update({ doublingOn: v })}
          />
          {s.doublingOn && (
            <Body>
              <Slider
                className="py-1.5"
                layout="stacked"
                label="Ожидаемая доходность"
                min={2}
                max={30}
                step={1}
                value={s.investRate}
                format={(v) => `${v}% годовых`}
                onChange={(v) => void s.update({ investRate: v })}
              />
            </Body>
          )}
        </Panel>

        <Panel id="recurring">
          <Head
            icon={Repeat}
            title="Расходы на подписки"
            hint="Какая часть дохода уходит на подписки"
            on={s.recurringOn}
            onToggle={(v) => void s.update({ recurringOn: v })}
          />
          {s.recurringOn && (
            <Body>{limit("Норма — не больше", s.recurringLimit, (v) => void s.update({ recurringLimit: v }))}</Body>
          )}
        </Panel>

        <Panel id="growth">
          <Head
            icon={Scale}
            title="Рост расходов и доходов"
            hint="Что растёт быстрее за последний год. Настроек нет"
            on={s.growthOn}
            onToggle={(v) => void s.update({ growthOn: v })}
          />
        </Panel>
      </ModalBody>
      <ModalFooter>
        <button type="button" className="btn-primary text-sm" onClick={onClose}>
          Готово
        </button>
      </ModalFooter>
    </Modal>
  );
}
