import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import clsx from "clsx";
import { CATEGORY_EDIT_PALETTE } from "../lib/categoryColor";

interface Props {
  /** Current colour as `#RRGGBB`, or null (no colour set). */
  value: string | null;
  onChange: (hex: string) => void;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// ── colour math ──────────────────────────────────────────────────────────────
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}
function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((x) => Math.round(x).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}
function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}
function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Category colour picker — a swatch trigger opening a full HSV editor:
 * quick-pick palette, a saturation/value square, a hue slider and a HEX field.
 * Emits normalised `#RRGGBB`; the category editor encodes that to Zenmoney's
 * packed int on save. HSV is the interaction source of truth (so hue survives
 * dragging into greys/blacks); it re-syncs whenever `value` changes externally.
 */
export function ColorPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState(() => {
    const rgb = value ? hexToRgb(value) : null;
    return rgb ? rgbToHsv(rgb.r, rgb.g, rgb.b) : { h: 210, s: 0.55, v: 0.85 };
  });
  const [hexText, setHexText] = useState(value ?? "");

  const current = value && HEX_RE.test(value) ? value.toUpperCase() : null;
  const hsvHex = (() => {
    const { r, g, b } = hsvToRgb(hsv.h, hsv.s, hsv.v);
    return rgbToHex(r, g, b);
  })();

  // Re-sync HSV from an externally-set value (palette/hex/reopen) — but not from
  // our own emits (those already match hsvHex).
  useEffect(() => {
    if (!current) return;
    if (current === hsvHex) return;
    const rgb = hexToRgb(current);
    if (rgb) setHsv(rgbToHsv(rgb.r, rgb.g, rgb.b));
    setHexText(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  function emit(next: { h: number; s: number; v: number }) {
    setHsv(next);
    const { r, g, b } = hsvToRgb(next.h, next.s, next.v);
    const hex = rgbToHex(r, g, b);
    setHexText(hex);
    onChange(hex);
  }

  function commitHex(raw: string) {
    const v = raw.startsWith("#") ? raw : `#${raw}`;
    if (HEX_RE.test(v)) {
      const rgb = hexToRgb(v)!;
      setHsv(rgbToHsv(rgb.r, rgb.g, rgb.b));
      onChange(v.toUpperCase());
    }
  }

  // Shared pointer-drag helper for the SV square and hue slider.
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  function onSvPointer(e: React.PointerEvent) {
    const el = svRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    const s = clamp01((e.clientX - rect.left) / rect.width);
    const v = 1 - clamp01((e.clientY - rect.top) / rect.height);
    emit({ ...hsv, s, v });
  }
  function onHuePointer(e: React.PointerEvent) {
    const el = hueRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    const h = clamp01((e.clientX - rect.left) / rect.width) * 360;
    emit({ ...hsv, h });
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setHexText(current ?? hsvHex);
        }}
        aria-expanded={open}
        aria-label="Выбрать цвет"
        className="w-10 h-10 rounded-lg border border-border shrink-0"
        style={{ background: current ?? hsvHex }}
      />

      {open && (
        <div className="absolute right-0 z-20 mt-2 border border-border rounded-xl bg-panel p-3 shadow-xl w-64 space-y-3">
          {/* Quick-pick palette */}
          <div className="grid grid-cols-9 gap-1.5">
            {CATEGORY_EDIT_PALETTE.map((c) => {
              const active = (current ?? hsvHex) === c.toUpperCase();
              return (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  aria-pressed={active}
                  onClick={() => commitHex(c)}
                  className={clsx(
                    "aspect-square rounded-md flex items-center justify-center ring-offset-1 ring-offset-panel",
                    active && "ring-2 ring-accent"
                  )}
                  style={{ background: c }}
                >
                  {active && <Check className="w-3 h-3 text-white drop-shadow" />}
                </button>
              );
            })}
          </div>

          {/* Saturation / value square */}
          <div
            ref={svRef}
            onPointerDown={onSvPointer}
            onPointerMove={(e) => e.buttons === 1 && onSvPointer(e)}
            className="relative w-full h-36 rounded-lg cursor-crosshair touch-none select-none"
            style={{
              background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgba(255,255,255,0)), hsl(${hsv.h}, 100%, 50%)`,
            }}
          >
            <span
              className="absolute w-3.5 h-3.5 -ml-1.5 -mt-1.5 rounded-full border-2 border-white shadow ring-1 ring-black/30 pointer-events-none"
              style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
            />
          </div>

          {/* Hue slider */}
          <div
            ref={hueRef}
            onPointerDown={onHuePointer}
            onPointerMove={(e) => e.buttons === 1 && onHuePointer(e)}
            className="relative w-full h-3 rounded-full cursor-pointer touch-none select-none"
            style={{
              background:
                "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
            }}
          >
            <span
              className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 -ml-1.5 rounded-full border-2 border-white shadow ring-1 ring-black/30 pointer-events-none"
              style={{ left: `${(hsv.h / 360) * 100}%` }}
            />
          </div>

          {/* HEX */}
          <div className="flex items-center gap-2">
            <span
              className="w-8 h-8 rounded-md border border-border shrink-0"
              style={{ background: current ?? hsvHex }}
            />
            <div className="flex items-center gap-1 flex-1 bg-panel2 rounded-lg px-2 py-1.5 border border-border">
              <span className="text-muted text-xs">HEX</span>
              <input
                value={hexText}
                onChange={(e) => setHexText(e.target.value)}
                onBlur={() => commitHex(hexText)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    commitHex(hexText);
                    setOpen(false);
                  }
                }}
                placeholder="#RRGGBB"
                spellCheck={false}
                className="bg-transparent text-sm flex-1 outline-none min-w-0 tabular-nums uppercase"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
