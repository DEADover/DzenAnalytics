/**
 * Фото аккаунта → маленький квадрат для аватара.
 *
 * Аватары лежат в localStorage рядом со списком аккаунтов (их надо прочитать до
 * того, как открыта база аккаунта), а там всего несколько мегабайт на всё. Поэтому
 * фото обрезается по центру в квадрат и уменьшается до `AVATAR_PX` — выходит
 * около 10 КБ, сколько бы весил исходник.
 */

export const AVATAR_PX = 128;
/** Больше не читаем вовсе: такое фото браузер будет декодировать заметно долго. */
export const AVATAR_MAX_FILE = 15 * 1024 * 1024;

/** Квадрат по центру исходника: откуда и какого размера вырезать. */
export function centerSquare(w: number, h: number): { sx: number; sy: number; side: number } {
  const side = Math.min(w, h);
  return { sx: Math.round((w - side) / 2), sy: Math.round((h - side) / 2), side };
}

export class AvatarError extends Error {}

export async function avatarFromFile(file: Blob): Promise<string> {
  if (!file.type.startsWith("image/")) throw new AvatarError("Это не картинка — выберите фото");
  if (file.size > AVATAR_MAX_FILE) throw new AvatarError("Фото больше 15 МБ — выберите поменьше");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new AvatarError("Не удалось открыть фото — попробуйте другое");
  }
  const { sx, sy, side } = centerSquare(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_PX;
  canvas.height = AVATAR_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new AvatarError("Браузер не дал обработать фото");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
  bitmap.close();
  // WebP втрое меньше PNG; где браузер его не пишет (вернёт PNG) — JPEG.
  const webp = canvas.toDataURL("image/webp", 0.86);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.86);
}
