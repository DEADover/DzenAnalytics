import { describe, it, expect } from "vitest";
import { A4_LANDSCAPE, A4_PORTRAIT, buildPdf, jpegFromDataUrl } from "./pdf";

/** Минимальный «JPEG»: настоящие маркеры начала и конца, мусор между ними. */
function fakeJpeg(size = 64): Uint8Array {
  const b = new Uint8Array(size);
  b[0] = 0xff;
  b[1] = 0xd8; // SOI
  for (let i = 2; i < size - 2; i++) b[i] = i % 251;
  b[size - 2] = 0xff;
  b[size - 1] = 0xd9; // EOI
  return b;
}

const page = (jpeg = fakeJpeg()) => ({ jpeg, width: 2246, height: 1588 });

/** Файл как латиница — для поиска структурных кусков. */
function asText(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

describe("buildPdf", () => {
  it("отдаёт файл с подписью PDF и концом файла", () => {
    const out = buildPdf([page()]);
    const text = asText(out);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("страниц столько, сколько картинок", () => {
    const text = asText(buildPdf([page(), page(), page()]));
    expect(text).toContain("/Count 3");
    expect(text.match(/\/Type \/Page[^s]/g)).toHaveLength(3);
  });

  it("лист по умолчанию — альбомный A4", () => {
    expect(asText(buildPdf([page()]))).toContain(`/MediaBox [0 0 842 595]`);
  });

  it("размер листа можно задать", () => {
    const text = asText(buildPdf([page()], { page: A4_PORTRAIT }));
    expect(text).toContain(`/MediaBox [0 0 595 842]`);
  });

  it("картинка кладётся как JPEG, без перекодирования", () => {
    // `DCTDecode` — это и есть «внутри JPEG как он есть». Перекодируй мы его в
    // сырые пиксели, файл вырос бы на порядок.
    const jpeg = fakeJpeg(128);
    const out = buildPdf([page(jpeg)]);
    expect(asText(out)).toContain("/Filter /DCTDecode");
    expect(asText(out)).toContain(`/Length ${jpeg.length}`);
    // Байты картинки должны лежать в файле нетронутыми.
    expect(asText(out)).toContain(asText(jpeg));
  });

  it("размеры картинки записаны — без них просмотрщик не нарисует её", () => {
    const text = asText(buildPdf([{ jpeg: fakeJpeg(), width: 1200, height: 800 }]));
    expect(text).toContain("/Width 1200");
    expect(text).toContain("/Height 800");
  });

  it("картинка растягивается ровно на лист", () => {
    const text = asText(buildPdf([page()]));
    expect(text).toContain(`${A4_LANDSCAPE.width} 0 0 ${A4_LANDSCAPE.height} 0 0 cm`);
  });

  it("смещения в таблице ссылок совпадают с настоящими", () => {
    // Кривой xref — самая частая причина «файл повреждён»: просмотрщик по нему
    // ищет объекты, и ошибка в один байт ломает весь документ.
    const out = buildPdf([page(), page()]);
    const text = asText(out);
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xrefAt, xrefAt + 4)).toBe("xref");

    // Строки: «xref», «0 N», затем по записи на объект — начиная с нулевого,
    // служебного. Поэтому объект `id` лежит в `rows[id]`, а не в `rows[id - 1]`.
    const rows = text.slice(xrefAt).split("\n").slice(2);
    const size = Number(/\/Size (\d+)/.exec(text)![1]);
    expect(rows[0]).toContain("65535 f");
    for (let id = 1; id < size; id++) {
      const offset = Number(rows[id].slice(0, 10));
      expect(text.slice(offset, offset + `${id} 0 obj`.length), `объект ${id}`).toBe(
        `${id} 0 obj`
      );
    }
  });

  it("кириллица в заголовке кодируется, а не теряется", () => {
    const text = asText(buildPdf([page()], { title: "Бюджет 2026" }));
    // UTF-16BE с меткой порядка байт — иначе просмотрщик покажет мусор.
    expect(text).toMatch(/\/Title <feff[0-9a-f]+>/);
  });

  it("латиница в заголовке остаётся читаемой строкой", () => {
    expect(asText(buildPdf([page()], { title: "Budget 2026" }))).toContain(
      "/Title (Budget 2026)"
    );
  });

  it("скобки в заголовке экранируются — иначе строка обрывается", () => {
    expect(asText(buildPdf([page()], { title: "Budget (2026)" }))).toContain(
      "/Title (Budget \\(2026\\))"
    );
  });

  it("без страниц — понятная ошибка, а не битый файл", () => {
    expect(() => buildPdf([])).toThrow(/без страниц/);
  });
});

describe("jpegFromDataUrl", () => {
  it("достаёт байты из data-URL", () => {
    const bytes = jpegFromDataUrl("data:image/jpeg;base64,/9j/4AAQ");
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
  });

  it("принимает и «jpg», и «jpeg»", () => {
    expect(() => jpegFromDataUrl("data:image/jpg;base64,/9j/4AAQ")).not.toThrow();
  });

  it("чужой формат отвергается", () => {
    // PNG сюда класть нельзя: PDF ждёт именно поток JPEG.
    expect(() => jpegFromDataUrl("data:image/png;base64,iVBOR")).toThrow(/JPEG/);
    expect(() => jpegFromDataUrl("не url")).toThrow();
  });
});
