import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { HouseHeart } from "lucide-react";
import { AVATAR_PX } from "../avatarImage";

/**
 * Аватар демо-аккаунта «Семья»: тёплый градиент и белый значок дома с сердцем.
 * Рисуется в браузере (SVG → канвас → WebP 128 px) — тем же форматом, что
 * сохраняет окно «Фото аккаунта», без картинок со стороны.
 */
function iconSvg(): string {
  const host = document.createElement("div");
  const root = createRoot(host);
  flushSync(() => root.render(<HouseHeart size={24} color="#fff" strokeWidth={1.75} />));
  const svg = host.innerHTML;
  root.unmount();
  return svg;
}

function avatarSvg(): string {
  const glyph = iconSvg().replace(/<svg[^>]*>/, "").replace("</svg>", "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FDBA74"/><stop offset="0.55" stop-color="#F43F5E"/><stop offset="1" stop-color="#C026D3"/></linearGradient>
    <radialGradient id="h" cx="0.25" cy="0.2" r="0.7"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="256" height="256" fill="url(#g)"/>
  <rect width="256" height="256" fill="url(#h)"/>
  <g transform="translate(64 62) scale(5.3)" fill="none" stroke="#fff" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>
</svg>`;
}

/** Аватар демо-аккаунта — data-URL WebP; `null`, если браузер не смог нарисовать. */
export async function demoAvatar(): Promise<string | null> {
  try {
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(avatarSvg());
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = AVATAR_PX;
    c.getContext("2d")!.drawImage(img, 0, 0, AVATAR_PX, AVATAR_PX);
    const webp = c.toDataURL("image/webp", 0.9);
    return webp.startsWith("data:image/webp") ? webp : c.toDataURL("image/jpeg", 0.9);
  } catch {
    return null;
  }
}
