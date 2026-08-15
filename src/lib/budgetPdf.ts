/**
 * Скачивание печатного дашборда в PDF.
 *
 * Кнопка отдаёт ФАЙЛ, а не открывает диалог печати: «Экспорт → PDF» рядом с
 * «Экспорт → Excel» должен вести себя одинаково, иначе одно и то же действие
 * работает двумя разными способами.
 *
 * Как это устроено: печатная вёрстка уже есть в DOM (она скрыта на экране),
 * поэтому мы на время показываем её за пределами окна, снимаем каждую страницу
 * в JPEG и складываем страницы в PDF (см. `pdf.ts`). Рисовать дашборд второй
 * раз примитивами PDF было бы и дольше, и хуже: пришлось бы встраивать шрифт
 * ради кириллицы и повторять всю раскладку вручную.
 */

import { A4_LANDSCAPE, A4_PORTRAIT, buildPdf, jpegFromDataUrl, type PdfPage } from "./pdf";

/**
 * Размер листа в пикселях при 96 точках на дюйм — те же пропорции, что у A4.
 * Вёрстка снимается ровно в этом размере, поэтому картинка ложится на лист без
 * искажений.
 *
 * Ориентаций две: сводка идёт альбомным листом, разрезы по статьям — книжными
 * (issue #68). Какая у страницы — говорит класс `print-portrait`, тот же, что
 * задаёт ей размер в разметке.
 */
const SHEET_PX = { width: 1123, height: 794 } as const;
const SHEET_PX_PORTRAIT = { width: 794, height: 1123 } as const;
/** Класс книжной страницы — должен совпадать с `.print-portrait` в стилях. */
const PORTRAIT_CLASS = "print-portrait";

/** Во сколько раз снимаем крупнее экрана: 2 ≈ 190 точек на дюйм на листе. */
const SCALE = 2;

/** Класс, который на время съёмки выводит скрытую вёрстку в поток. */
const EXPORT_CLASS = "print-export";

function downloadBytes(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Снять печатный дашборд и отдать PDF-файл.
 *
 * `root` — узел печатной вёрстки (`.print-root`). Он остаётся скрытым для
 * пользователя всё время съёмки: показываем его за левым краем окна, а не в
 * потоке страницы, чтобы под ним ничего не дёрнулось.
 */
export async function downloadDashboardPdf(
  root: HTMLElement,
  fileName: string,
  title?: string
): Promise<void> {
  const pages = [...root.querySelectorAll<HTMLElement>(".print-page")];
  if (pages.length === 0) throw new Error("Печатная вёрстка пуста — нечего выгружать");

  const { toJpeg } = await import("html-to-image");
  root.classList.add(EXPORT_CLASS);
  try {
    const shots: PdfPage[] = [];
    for (const page of pages) {
      const portrait = page.classList.contains(PORTRAIT_CLASS);
      const px = portrait ? SHEET_PX_PORTRAIT : SHEET_PX;
      const dataUrl = await toJpeg(page, {
        width: px.width,
        height: px.height,
        pixelRatio: SCALE,
        quality: 0.94,
        // Без явного фона JPEG (он не умеет прозрачность) залил бы страницу
        // чёрным — ровно то, что видно в тёмной теме.
        backgroundColor: "#ffffff",
      });
      shots.push({
        jpeg: jpegFromDataUrl(dataUrl),
        width: px.width * SCALE,
        height: px.height * SCALE,
        sheet: portrait ? A4_PORTRAIT : A4_LANDSCAPE,
      });
    }
    downloadBytes(buildPdf(shots, { page: A4_LANDSCAPE, title }), fileName);
  } finally {
    root.classList.remove(EXPORT_CLASS);
  }
}
