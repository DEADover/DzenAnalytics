/**
 * Постоянный оттенок по строке: одно и то же название — всегда один цвет, а
 * разные названия выглядят по-разному. Буквенные значки счетов и аватары
 * аккаунтов без фото.
 */
export function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}
