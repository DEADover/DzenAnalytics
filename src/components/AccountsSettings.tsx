import { useEffect, useRef, useState } from "react";
import { Check, LogIn, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import clsx from "clsx";
import { profileLabel, renameProfile } from "../lib/profiles";
import { createProfile, deleteProfile, switchProfile, useProfiles } from "../hooks/useProfiles";
import { confirm } from "../store/useConfirmStore";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { Tooltip } from "./Tooltip";

/**
 * Аккаунты устройства: у каждого своя база в браузере — свои операции, токен
 * Дзен-мани, правки и настройки. Здесь их заводят, переименовывают и удаляют;
 * переключаться быстрее из шапки.
 */
export function AccountsSettings() {
  const { profiles, activeId } = useProfiles();
  const [adding, setAdding] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const boxRef = useRef<HTMLElement>(null);

  // Переход по ссылке «Управлять аккаунтами» из шапки — сразу к разделу.
  useEffect(() => {
    if (window.location.hash === "#accounts") {
      boxRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, []);

  async function remove(id: string) {
    const p = profiles.find((x) => x.id === id);
    // Текущий удалить нельзя — кнопка погашена, но щелчок до неё доходит.
    if (!p || id === activeId) return;
    const ok = await confirm({
      title: `Удалить аккаунт «${profileLabel(p)}»?`,
      message:
        "С этого устройства удалятся его операции, токен Дзен-мани, правки, правила и настройки. В самом Дзен-мани ничего не изменится — аккаунт можно подключить заново.",
      confirmLabel: "Удалить",
      tone: "danger",
    });
    if (ok) await deleteProfile(id);
  }

  function saveName() {
    if (!editing) return;
    renameProfile(editing.id, editing.name);
    setEditing(null);
  }

  return (
    <section id="accounts" ref={boxRef} className="card-tray card-pad space-y-4 scroll-mt-24">
      <SettingsSectionHeader icon={Users} title="Аккаунты" />
      <p className="text-sm text-muted">
        Несколько аккаунтов Дзен-мани на одном устройстве — например, личный и
        рабочий. У каждого свои данные: операции, токен, правки, правила и
        настройки хранятся отдельно и не смешиваются. Переключаться удобнее из
        шапки — переключатель появляется, когда аккаунтов больше одного.
      </p>

      <div className="divide-y divide-border/60 border border-border rounded-xl overflow-hidden">
        {profiles.map((p) => {
          const current = p.id === activeId;
          const isEditing = editing?.id === p.id;
          return (
            <div
              key={p.id}
              className={clsx("flex items-center gap-3 px-3 py-2.5", current && "bg-accent/5")}
            >
              <div className="min-w-0 flex-1">
                {isEditing ? (
                  <input
                    autoFocus
                    value={editing.name}
                    onChange={(e) => setEditing({ id: p.id, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveName();
                      if (e.key === "Escape") setEditing(null);
                    }}
                    placeholder={p.login ?? "Название аккаунта"}
                    className="input text-sm w-full max-w-xs"
                    aria-label="Название аккаунта"
                  />
                ) : (
                  <>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate font-medium">{profileLabel(p)}</span>
                      {current && (
                        <span className="chip chip-sm shrink-0 text-accent">Текущий</span>
                      )}
                    </div>
                    <div className="text-xs text-muted truncate">
                      {p.login
                        ? p.name.trim()
                          ? `Дзен-мани: ${p.login}`
                          : "Дзен-мани подключён"
                        : current
                          ? "Дзен-мани не подключён"
                          : "Логин появится после синхронизации в этом аккаунте"}
                    </div>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {isEditing ? (
                  <>
                    <button type="button" onClick={saveName} className="btn-icon" aria-label="Сохранить название">
                      <Check className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className="btn-icon" aria-label="Отменить">
                      <X className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <>
                    {!current && (
                      <button type="button" onClick={() => switchProfile(p.id)} className="btn-ghost text-xs">
                        <LogIn className="w-3.5 h-3.5" />
                        Перейти
                      </button>
                    )}
                    <Tooltip content="Переименовать">
                      <button
                        type="button"
                        onClick={() => setEditing({ id: p.id, name: p.name })}
                        className="btn-icon"
                        aria-label={`Переименовать «${profileLabel(p)}»`}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    </Tooltip>
                    <Tooltip content={current ? "Текущий аккаунт удалить нельзя — сначала перейдите в другой" : "Удалить аккаунт и его данные с этого устройства"}>
                      <button
                        type="button"
                        onClick={() => void remove(p.id)}
                        aria-disabled={current}
                        className={clsx("btn-icon-danger", current && "opacity-40 pointer-events-auto cursor-not-allowed")}
                        aria-label={`Удалить «${profileLabel(p)}»`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </Tooltip>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          createProfile(adding);
        }}
      >
        <input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder="Название нового аккаунта, например «Работа»"
          className="input text-sm flex-1 min-w-0 max-w-sm"
          aria-label="Название нового аккаунта"
        />
        <button type="submit" className="btn-primary text-sm">
          <Plus className="w-4 h-4" />
          Добавить и перейти
        </button>
      </form>
    </section>
  );
}
