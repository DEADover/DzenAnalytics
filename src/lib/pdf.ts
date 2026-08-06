/**
 * Минимальный писатель PDF: страницы-картинки.
 *
 * Библиотеку не берём. Нам нужен ровно один сценарий — «положить готовое
 * изображение на лист A4», и он в PDF описывается двумя десятками строк, тогда
 * как любая библиотека тянет с собой парсер шрифтов и полкилобайта кода на
 * каждую букву кириллицы (встроенные шрифты PDF её не знают вовсе).
 *
 * JPEG кладётся в файл КАК ЕСТЬ, без перекодирования: формат уже сжат, и PDF
 * умеет его читать напрямую (`/DCTDecode`). Поэтому файл весит примерно
 * столько же, сколько исходные картинки.
 */

/** Размеры листа в пунктах (1/72 дюйма). */
export const A4_LANDSCAPE = { width: 842, height: 595 } as const;
export const A4_PORTRAIT = { width: 595, height: 842 } as const;

export interface PdfPage {
  /** Байты JPEG — ровно то, что вернул кодировщик. */
  jpeg: Uint8Array;
  /** Размер картинки в пикселях: PDF обязан их знать. */
  width: number;
  height: number;
}

export interface PdfOptions {
  /** Размер листа в пунктах. По умолчанию альбомный A4. */
  page?: { width: number; height: number };
  /** Заголовок документа — его показывает просмотрщик во вкладке. */
  title?: string;
}

/** Строка → байты latin1: в PDF за пределами потоков только ASCII. */
function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/**
 * Текст в PDF-строке: скобки и слеш — служебные символы, их экранируют.
 * Не-ASCII уходит в UTF-16BE с меткой порядка байт, иначе кириллица в заголовке
 * документа превращается в мусор.
 */
function pdfText(s: string): Uint8Array {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(s)) {
    return ascii(`(${s.replace(/([\\()])/g, "\\$1")})`);
  }
  const bytes: number[] = [0xfe, 0xff];
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code > 0xffff) {
      const v = code - 0x10000;
      const hi = 0xd800 + (v >> 10);
      const lo = 0xdc00 + (v & 0x3ff);
      bytes.push(hi >> 8, hi & 0xff, lo >> 8, lo & 0xff);
    } else {
      bytes.push(code >> 8, code & 0xff);
    }
  }
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return ascii(`<${hex}>`);
}

/**
 * Собрать PDF из готовых страниц-картинок.
 *
 * Каждая картинка растягивается на весь лист: поля уже заложены в саму
 * вёрстку, и добавлять их второй раз значит получить рамку в рамке.
 */
export function buildPdf(pages: PdfPage[], opts: PdfOptions = {}): Uint8Array {
  if (pages.length === 0) throw new Error("PDF без страниц не бывает");
  const sheet = opts.page ?? A4_LANDSCAPE;

  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === "string" ? ascii(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  /** Открыть объект и запомнить его смещение — из них строится таблица xref. */
  const openObject = (id: number) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
  };

  // 1 — каталог, 2 — дерево страниц, дальше по три объекта на страницу.
  const pageId = (i: number) => 3 + i * 3;
  const contentId = (i: number) => 4 + i * 3;
  const imageId = (i: number) => 5 + i * 3;
  const infoId = 3 + pages.length * 3;

  push("%PDF-1.4\n");
  // Комментарий из «высоких» байтов — по соглашению помечает файл двоичным,
  // чтобы его не портили передачей в текстовом режиме.
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  openObject(1);
  push(`<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);

  openObject(2);
  const kids = pages.map((_, i) => `${pageId(i)} 0 R`).join(" ");
  push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((p, i) => {
    openObject(pageId(i));
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${sheet.width} ${sheet.height}] ` +
        `/Resources << /XObject << /Im0 ${imageId(i)} 0 R >> >> ` +
        `/Contents ${contentId(i)} 0 R >>\nendobj\n`
    );

    // Матрица преобразования: растянуть единичный квадрат картинки на лист.
    const stream = `q\n${sheet.width} 0 0 ${sheet.height} 0 0 cm\n/Im0 Do\nQ\n`;
    openObject(contentId(i));
    push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`);

    openObject(imageId(i));
    push(
      `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
        `/Length ${p.jpeg.length} >>\nstream\n`
    );
    push(p.jpeg);
    push("\nendstream\nendobj\n");
  });

  offsets[infoId] = length;
  push(`${infoId} 0 obj\n<< /Producer `);
  push(pdfText("DzenAnalytics"));
  if (opts.title) {
    push(" /Title ");
    push(pdfText(opts.title));
  }
  push(" >>\nendobj\n");

  // Таблица перекрёстных ссылок: смещение каждого объекта от начала файла.
  const xrefAt = length;
  const count = infoId + 1;
  push(`xref\n0 ${count}\n`);
  push("0000000000 65535 f \n");
  for (let id = 1; id < count; id++) {
    push(`${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`);
  }
  push(
    `trailer\n<< /Size ${count} /Root 1 0 R /Info ${infoId} 0 R >>\n` +
      `startxref\n${xrefAt}\n%%EOF\n`
  );

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Байты JPEG из data-URL, который отдаёт кодировщик картинки. */
export function jpegFromDataUrl(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  if (comma < 0 || !/^data:image\/jpe?g;base64$/i.test(dataUrl.slice(0, comma))) {
    throw new Error("Ожидался data-URL с JPEG в base64");
  }
  const binary = atob(dataUrl.slice(comma + 1));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
