import { useState } from "react";
import { Link } from "react-router-dom";
import { Layers, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import clsx from "clsx";
import { useSlicesStore } from "../store/useSlicesStore";
import { confirm } from "../store/useConfirmStore";
import { formatNum } from "../lib/format";
import { pluralRu } from "../lib/plural";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { InfoPopover, InfoTerm } from "./InfoPopover";

/**
 * Управление разрезами данных (issue #14).
 *
 * Здесь только сами разрезы: создать, назвать, выбрать активный, удалить. Что
 * именно в них исключено, правится там же, где живут сами сущности —
 * галочкой «В аналитике» у категории и у счёта, — чтобы не заводить третий
 * список тех же названий.
 */
export function SlicesSettings() {
  const slices = useSlicesStore((s) => s.slices);
  const activeId = useSlicesStore((s) => s.activeId);
  const setActive = useSlicesStore((s) => s.setActive);
  const add = useSlicesStore((s) => s.add);
  const rename = useSlicesStore((s) => s.rename);
  const remove = useSlicesStore((s) => s.remove);

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  async function askRemove(id: string, name: string) {
    const ok = await confirm({
      title: `Удалить разрез «${name}»?`,
      message:
        "Операции и настройки категорий не пострадают — удалится только этот набор исключений.",
      confirmLabel: "Удалить",
      tone: "danger",
    });
    if (ok) await remove(id);
  }

  return (
    <div className="card card-pad">
      <div className="flex items-start justify-between gap-3 mb-3">
        <SettingsSectionHeader icon={Layers} title="Разрезы данных" />
        <InfoPopover>
          <p>
            <InfoTerm>Разрез</InfoTerm> отвечает на вопрос «что считать своими
            финансами в этой картине». Обороты, взаимозачёты и возмещения
            раздувают доход и расход, не будучи ни тем ни другим; у кого-то рядом
            лежит бизнес или общий счёт, которым в личной картине не место.
            Соберите такой набор исключений один раз, назовите — и переключайтесь
            между картинами одной кнопкой в шапке.
          </p>
          <p>
            Разрез действует на <InfoTerm>сводную аналитику</InfoTerm>: Здоровье,
            Цели и FIRE, Что-если, Год в цифрах, Дайджест, Аномалии, Сравнение,
            Динамика, Доходы и расходы. <InfoTerm>Список операций он не
            прячет</InfoTerm> — реестр всегда показывает всё, иначе правки
            делались бы вслепую.
          </p>
          <p>
            Что исключено, отмечается галочкой <InfoTerm>«В аналитике»</InfoTerm>{" "}
            у категории (в справочнике категорий) и у счёта (на странице
            «Счета»). Галочка всегда правит активный разрез.
          </p>
        </InfoPopover>
      </div>
      <p className="text-xs text-muted mb-4">
        Наборы исключений под своими именами — «Всё», «Личное», «Без бизнеса».
        Переключатель появляется в шапке, когда разрезов больше одного.
      </p>

      <div className="border border-border rounded-lg overflow-hidden">
        {slices.map((s) => {
          const isActive = s.id === activeId;
          const cats = s.excludedCategories.length;
          const accs = s.excludedAccounts.length;
          return (
            <div
              key={s.id}
              className={clsx(
                "flex items-center gap-3 px-3 py-2 border-b border-border/60 last:border-b-0",
                isActive && "bg-accent/5"
              )}
            >
              <input
                type="radio"
                name="active-slice"
                checked={isActive}
                onChange={() => void setActive(s.id)}
                aria-label={`Сделать активным разрез «${s.name}»`}
                className="accent-[var(--accent)] cursor-pointer shrink-0"
              />
              {editing === s.id ? (
                <>
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void rename(s.id, draft);
                        setEditing(null);
                      }
                      if (e.key === "Escape") setEditing(null);
                    }}
                    className="input h-9 text-sm flex-1 min-w-0"
                  />
                  <button
                    onClick={() => {
                      void rename(s.id, draft);
                      setEditing(null);
                    }}
                    title="Сохранить"
                    aria-label="Сохранить название"
                    className="p-1.5 rounded-md text-muted hover:text-accent hover:bg-panel2"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setEditing(null)}
                    title="Отмена"
                    aria-label="Отменить переименование"
                    className="p-1.5 rounded-md text-muted hover:text-text hover:bg-panel2"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 min-w-0">
                    <span className="text-sm truncate block">{s.name}</span>
                    <span className="text-xs text-muted">
                      {cats === 0 && accs === 0
                        ? "Ничего не исключено"
                        : [
                            cats > 0 &&
                              `${formatNum(cats)} ${pluralRu(cats, ["категория", "категории", "категорий"])}`,
                            accs > 0 &&
                              `${formatNum(accs)} ${pluralRu(accs, ["счёт", "счёта", "счетов"])}`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                    </span>
                  </span>
                  <button
                    onClick={() => {
                      setEditing(s.id);
                      setDraft(s.name);
                    }}
                    title="Переименовать"
                    aria-label="Переименовать разрез"
                    className="p-1.5 rounded-md text-muted hover:text-accent hover:bg-panel2"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => void askRemove(s.id, s.name)}
                    disabled={slices.length <= 1}
                    title={
                      slices.length <= 1
                        ? "Единственный разрез удалить нельзя"
                        : "Удалить разрез"
                    }
                    aria-label="Удалить разрез"
                    className="p-1.5 rounded-md text-muted hover:text-expense hover:bg-expense/10 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 mt-3 flex-wrap">
        <button
          type="button"
          onClick={async () => {
            // Копируем активный: новый разрез почти всегда «как этот, но без
            // ещё одной категории», а не пустой лист.
            const id = await add("Новый разрез", activeId);
            setEditing(id);
            setDraft("Новый разрез");
          }}
          className="btn-primary text-sm"
        >
          <Plus className="w-4 h-4" />
          Добавить
        </button>
        <span className="text-xs text-muted">
          Что исключено — отмечается в{" "}
          <Link to="/settings?tab=operations" className="text-accent hover:underline">
            справочнике категорий
          </Link>{" "}
          и на{" "}
          <Link to="/accounts" className="text-accent hover:underline">
            странице счетов
          </Link>
          .
        </span>
      </div>
    </div>
  );
}
