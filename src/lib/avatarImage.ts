/**
 * Фото аккаунта → маленький квадрат для аватара.
 *
 * Аватары лежат в localStorage рядом со списком аккаунтов (их надо прочитать до
 * того, как открыта база аккаунта), а там всего несколько мегабайт на всё. Поэтому
 * сохраняется только выбранный кадр (`lib/avatarCrop`), уменьшенный до
 * `AVATAR_PX`, — около 10 КБ, сколько бы весил исходник.
 */

export const AVATAR_PX = 128;
/** Больше не читаем вовсе: такое фото браузер будет декодировать заметно долго. */
export const AVATAR_MAX_FILE = 15 * 1024 * 1024;

export class AvatarError extends Error {}

/** Открыть фото для кадрирования. Ошибки — понятным текстом. */
export async function loadAvatarSource(file: Blob): Promise<ImageBitmap> {
  if (!file.type.startsWith("image/")) throw new AvatarError("Это не картинка — выберите фото");
  if (file.size > AVATAR_MAX_FILE) throw new AvatarError("Фото больше 15 МБ — выберите поменьше");
  try {
    return await createImageBitmap(file);
  } catch {
    throw new AvatarError("Не удалось открыть фото — попробуйте другое");
  }
}

/** Вырезать кадр и уменьшить: data-URL WebP (или JPEG, где WebP не пишется). */
export function renderAvatar(
  source: CanvasImageSource,
  rect: { sx: number; sy: number; side: number }
): string {
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_PX;
  canvas.height = AVATAR_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new AvatarError("Браузер не дал обработать фото");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, rect.sx, rect.sy, rect.side, rect.side, 0, 0, AVATAR_PX, AVATAR_PX);
  const webp = canvas.toDataURL("image/webp", 0.86);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.86);
}
