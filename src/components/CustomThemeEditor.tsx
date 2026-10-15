import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Palette, RotateCcw } from "lucide-react";
import { ModalBody, ModalFooter, ModalHeader } from "./Modal";
import { SchemePreview } from "./ThemeSchemePicker";
import { schemeName, type ThemeKind } from "../lib/themeSchemes";
import {
  CONTRAST_CHECKS,
  CUSTOM_COLOR_TOKENS,
  contrastRatio,
  customSchemeId,
  formatContrast,
  normalizeHex,
  readSchemeColors,
  sameCustomTheme,
  type CustomColorKey,
  type CustomColors,
} from "../lib/customTheme";
import { useThemeStore } from "../store/useThemeStore";

/**
 * Редактор своей темы — содержимое окна «Тема оформления» вместо списка.
 *
 * Каждый цвет применяется сразу: блок своей темы в `<head>` переписывается,
 * и весь экран за окном перекрашивается вместе с плиткой-превью. Чтобы это
 * было видно, редактор включает свою тему и её вид.
 */
export function CustomThemeEditor({ kind, onDone }: { kind: ThemeKind; onDone: () => void }) {
  const custom = useThemeStore((s) => (kind === "dark" ? s.customDark : s.customLight));
  const selected = useThemeStore((s) => (kind === "dark" ? s.darkScheme : s.lightScheme));
  const resolved = useThemeStore((s) => s.resolved);
  const setCustom = useThemeStore((s) => s.setCustom);
  const createCustom = useThemeStore((s) => s.createCustom);
  const setScheme = useThemeStore((s) => s.setScheme);
  const setMode = useThemeStore((s) => s.setMode);
  const id = customSchemeId(kind);

  // Живой просмотр: своя тема отмечена и на экране её вид.
  useEffect(() => {
    if (!custom) createCustom(kind);
    else if (selected !== id) setScheme(id);
    if (resolved !== kind) setMode(kind);
    // Только при открытии: дальше вид и тему человек меняет сам.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const view = kind === "dark" ? "тёмная" : "светлая";
  const baseName = custom ? schemeName(custom.base) : "";
  const base = custom?.base;
  const baseColors = useMemo(() => (base ? readSchemeColors(base) : null), [base]);
  const pristine = !!custom && !!baseColors && sameCustomTheme(custom, { base: custom.base, colors: baseColors });

  const setColor = (key: CustomColorKey, hex: string) => {
    if (!custom || custom.colors[key] === hex) return;
    setCustom(kind, { base: custom.base, colors: { ...custom.colors, [key]: hex } });
  };

  return (
    <>
      <ModalHeader
        icon={Palette}
        title={`Своя ${view} тема`}
        subtitle={custom ? `Копия темы «${baseName}» — меняйте любые цвета` : "Готовим копию темы…"}
      />
      <ModalBody scroll>
        <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
          <div className="sm:w-56 shrink-0">
            <SchemePreview id={id} kind={kind} />
          </div>
          <p className="text-xs text-muted leading-relaxed">
            Цвета меняются сразу — на всём экране и на превью. Сетка
            графиков, подсказки и тень подбираются сами: по границам, карточкам и
            виду темы. Если текст плохо читается, рядом с цветом появится
            предупреждение о контрасте.
          </p>
        </div>
        {custom && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
            {CUSTOM_COLOR_TOKENS.map((t) => (
              <ColorRow
                key={t.key}
                label={t.label}
                hint={t.hint}
                value={custom.colors[t.key]}
                note={contrastNote(t.key, custom.colors)}
                onChange={(hex) => setColor(t.key, hex)}
              />
            ))}
          </div>
        )}
      </ModalBody>
      <ModalFooter justify="between">
        <button
          type="button"
          className="btn-ghost"
          disabled={!custom || !baseColors || pristine}
          onClick={() => custom && baseColors && setCustom(kind, { base: custom.base, colors: baseColors })}
        >
          <RotateCcw className="w-4 h-4" />
          Сбросить к теме «{baseName}»
        </button>
        <button type="button" className="btn-primary" onClick={onDone}>
          Готово
        </button>
      </ModalFooter>
    </>
  );
}

/** Строка под подписью у цветов, контраст которых проверяем. */
function contrastNote(key: CustomColorKey, colors: CustomColors): { text: string; low: boolean } | null {
  const check = CONTRAST_CHECKS.find((c) => c.key === key);
  if (!check) return null;
  const ratio = contrastRatio(colors[check.key], colors[check.against]);
  const low = ratio < check.min;
  return {
    low,
    text: low
      ? `Контраст ${check.label} ${formatContrast(ratio)} — мало, нужно от ${formatContrast(check.min)}`
      : `Контраст ${check.label} ${formatContrast(ratio)}`,
  };
}

/**
 * Цвет: подпись, образец (нативный выбор цвета) и поле hex. Поле правится
 * свободно и применяется, как только в нём настоящий цвет; при уходе из поля
 * недописанное возвращается к текущему цвету.
 */
function ColorRow({
  label,
  hint,
  value,
  note,
  onChange,
}: {
  label: string;
  /** Где этот цвет на экране — строкой под подписью. */
  hint: string;
  value: string;
  note: { text: string; low: boolean } | null;
  onChange: (hex: string) => void;
}) {
  // Черновик — только пока в поле фокус; в остальное время поле показывает цвет.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;

  return (
    <div className="flex items-center gap-3 min-w-0" data-color-row={label}>
      <div className="min-w-0 flex-1">
        <div className="text-sm">{label}</div>
        <div className="text-xs leading-snug text-muted">{hint}</div>
        {note && (
          <div className={clsx("text-xs leading-snug", note.low ? "text-warn" : "text-muted")}>{note.text}</div>
        )}
      </div>
      <input
        type="color"
        value={value}
        onChange={(e) => {
          const hex = normalizeHex(e.target.value);
          if (hex) onChange(hex);
        }}
        aria-label={label}
        className={clsx(
          "shrink-0 w-[38px] h-[38px] p-1 rounded-control border border-border bg-panel2 cursor-pointer",
          "[&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-control-xs",
          "[&::-moz-color-swatch]:border-0 [&::-moz-color-swatch]:rounded-control-xs",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        )}
      />
      <input
        type="text"
        value={shown}
        spellCheck={false}
        maxLength={7}
        aria-label={`${label}, код цвета`}
        aria-invalid={!normalizeHex(shown)}
        onFocus={() => setDraft(value)}
        onBlur={() => {
          const hex = normalizeHex(shown);
          if (hex) onChange(hex);
          setDraft(null);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          const hex = normalizeHex(e.target.value);
          // Три знака — тоже цвет, но пока человек печатает шесть, «#abc» на
          // полпути перекрашивал бы экран; применяем только полный код.
          if (hex && e.target.value.replace("#", "").length === 6) onChange(hex);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          const hex = normalizeHex(shown);
          if (hex) {
            onChange(hex);
            setDraft(hex);
          }
        }}
        className="input shrink-0 !w-[6.5rem] font-mono text-sm tabular-nums"
      />
    </div>
  );
}
