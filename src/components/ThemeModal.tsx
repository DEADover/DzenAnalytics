import { useEffect, useRef } from "react";
import clsx from "clsx";
import { Monitor, Moon, Palette, Sun } from "lucide-react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "./Modal";
import { Segmented } from "./Segmented";
import { ThemeSchemePicker } from "./ThemeSchemePicker";
import { schemeById, type ThemeKind } from "../lib/themeSchemes";
import { useThemeStore, type ThemeMode } from "../store/useThemeStore";
import { useThemeModalStore } from "../store/useThemeModalStore";

/**
 * Окно «Тема оформления»: вид и тема для каждого вида в одном месте.
 *
 * Прежде двенадцать плиток стояли прямо на странице настроек, и нажатие на
 * тёмную тему сразу перекидывало всё приложение в тёмный вид. Здесь два
 * отдельных действия: переключатель вида сверху решает, что на экране, а
 * галочки в списках только отмечают, какая тема нравится для светлого и для
 * тёмного вида. Сменил вид — список сам доезжает до тем этого вида, и выбор
 * виден сразу за окном.
 */
export function ThemeModal() {
  const open = useThemeModalStore((s) => s.open);
  const hide = useThemeModalStore((s) => s.hide);
  if (!open) return null;
  return <ThemeModalContent onClose={hide} />;
}

function ThemeModalContent({ onClose }: { onClose: () => void }) {
  const mode = useThemeStore((s) => s.mode);
  const resolved = useThemeStore((s) => s.resolved);
  const setMode = useThemeStore((s) => s.setMode);
  const lightName = useThemeStore((s) => schemeById(s.lightScheme)?.name ?? "");
  const darkName = useThemeStore((s) => schemeById(s.darkScheme)?.name ?? "");

  const sections = useRef<Record<ThemeKind, HTMLElement | null>>({ light: null, dark: null });
  const first = useRef(true);

  // При открытии — сразу к темам текущего вида, при смене вида — плавно.
  useEffect(() => {
    const el = sections.current[resolved];
    if (!el) return;
    const smooth = !first.current && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
    first.current = false;
  }, [resolved]);

  const view = resolved === "dark" ? "тёмный" : "светлый";
  const now = `${mode === "auto" ? `Как в системе, ${view}` : `${view[0].toUpperCase()}${view.slice(1)} вид`} · ${resolved === "dark" ? darkName : lightName}`;

  return (
    <Modal onClose={onClose} width="3xl" className="h-[min(820px,calc(100dvh-2rem))]">
      <ModalHeader
        icon={Palette}
        title="Тема оформления"
        subtitle="Галочкой отметьте тему для светлого и для тёмного вида"
      />
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3 border-b border-border">
        <Segmented<ThemeMode>
          label="Вид"
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: "light", label: "Светлый", icon: Sun },
            { value: "dark", label: "Тёмный", icon: Moon },
            // «Авто», а не «Как в системе»: длинная подпись не влезала в ряд на
            // телефоне. Что значит «Авто», говорит строка «Сейчас» рядом.
            { value: "auto", label: "Авто", icon: Monitor, title: "Как в системе: вид меняется вместе с настройкой ОС" },
          ]}
        />
        <span className="text-xs text-muted">Сейчас: {now}</span>
      </div>
      <ModalBody scroll gap={0} className="space-y-6">
        {(["light", "dark"] as const).map((kind) => (
          <section
            key={kind}
            ref={(el) => {
              sections.current[kind] = el;
            }}
            className="scroll-mt-4"
          >
            <div className="flex items-baseline justify-between gap-3 mb-3">
              <h3 className="text-sm font-semibold">{kind === "dark" ? "Тёмные темы" : "Светлые темы"}</h3>
              <span className={clsx("text-xs", resolved === kind ? "text-accent" : "text-muted")}>
                {resolved === kind
                  ? "На экране сейчас"
                  : mode === "auto"
                    ? "Включится вместе с системой"
                    : `Включится, когда выберете ${kind === "dark" ? "тёмный" : "светлый"} вид`}
              </span>
            </div>
            <ThemeSchemePicker kind={kind} />
          </section>
        ))}
      </ModalBody>
      <ModalFooter>
        <button type="button" className="btn-primary" onClick={onClose}>
          Готово
        </button>
      </ModalFooter>
    </Modal>
  );
}
