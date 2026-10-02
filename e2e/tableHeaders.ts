/**
 * Подписи столбцов таблиц с заданными ширинами, которым не хватает запаса.
 *
 * В таблицах с заданными ширинами подпись, вставшая впритык, на другой машине
 * режется многоточием: шрифт там рисуется на пару пикселей шире («₽
 * ОТКЛОНЕНИ…» при запасе 2 px). Поэтому проверяем не «влезает», а «влезает с
 * запасом ≥ 8 px». Таблицы без заданных ширин подстраиваются сами — их не трогаем.
 */
import type { Page } from "@playwright/test";

const MIN_SPARE = 8;

export async function tightHeaders(page: Page): Promise<string[]> {
  return page.evaluate((minSpare) => {
    const out: string[] = [];
    for (const table of document.querySelectorAll("table")) {
      if (getComputedStyle(table).tableLayout !== "fixed") continue;
      for (const th of table.querySelectorAll("thead th")) {
        const el = th as HTMLElement;
        if (el.offsetWidth === 0 || !el.textContent?.trim()) continue;
        const cs = getComputedStyle(el);
        const avail = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        // Ширина содержимого «как есть» — копией в той же ячейке, тем же шрифтом.
        const probe = document.createElement("div");
        probe.style.cssText = "position:absolute;visibility:hidden;left:0;top:0;width:max-content;white-space:nowrap;";
        for (const ch of [...el.childNodes]) {
          const c = ch.cloneNode(true) as HTMLElement;
          if (c.nodeType === 1) {
            c.style.width = "max-content";
            c.style.maxWidth = "none";
          }
          probe.appendChild(c);
        }
        el.appendChild(probe);
        const need = probe.getBoundingClientRect().width;
        probe.remove();
        if (avail - need < minSpare) out.push(`«${el.textContent.trim()}» запас ${Math.round(avail - need)} px`);
      }
    }
    return out;
  }, MIN_SPARE);
}
