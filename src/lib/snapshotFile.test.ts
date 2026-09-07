import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { compressText, decompressBytes, readSnapshotFile } from "./snapshotFile";

/** Сжать строку настоящим gzip — тем же, чем её жмёт ZenTable. */
async function gzip(text: string): Promise<Blob> {
  const stream = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Blob([await new Response(stream).arrayBuffer()]);
}

/** Настоящий zip-архив с перечисленными файлами. */
function zip(files: Record<string, string>): Blob {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, body] of Object.entries(files)) entries[name] = strToU8(body);
  return new Blob([zipSync(entries) as unknown as BlobPart]);
}

const SNAP = '{"serverTimestamp":1788724825,"transaction":[{"id":"a"}]}';

describe("readSnapshotFile", () => {
  it("обычный JSON отдаёт как есть", async () => {
    expect(await readSnapshotFile(new Blob([SNAP]))).toBe(SNAP);
  });

  it("gzip распаковывает", async () => {
    expect(await readSnapshotFile(await gzip(SNAP))).toBe(SNAP);
  });

  it("zip распаковывает", async () => {
    expect(await readSnapshotFile(zip({ "snapshot.json": SNAP }))).toBe(SNAP);
  });

  it("узнаёт сжатие по содержимому, а не по имени файла", async () => {
    // Safari умеет снять «.gz» с имени, оставив содержимое сжатым, — по
    // расширению такой файл выглядел бы обычным JSON.
    const named = new File([await gzip(SNAP)], "backup.json", {
      type: "application/json",
    });
    expect(await readSnapshotFile(named)).toBe(SNAP);
  });

  it("не путает со сжатым JSON, начинающийся с пробелов", async () => {
    const text = '\n  {"serverTimestamp":3}';
    expect(await readSnapshotFile(new Blob([text]))).toBe(text);
  });

  it("кириллица переживает распаковку", async () => {
    // Распаковка идёт через UTF-8. Промахнись мы с кодировкой — названия
    // категорий приехали бы «крякозябрами», и заметили бы это уже после
    // заливки в облако.
    const text = '{"serverTimestamp":4,"tag":[{"title":"Продукты"}]}';
    expect(await readSnapshotFile(await gzip(text))).toBe(text);
    expect(await readSnapshotFile(zip({ "a.json": text }))).toBe(text);
  });

  it("битый gzip объясняет себя, а не падает как есть", async () => {
    // Первые два байта на месте, дальше мусор — так выглядит недокачанный файл.
    const broken = new Blob([new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x42, 0x42])]);
    await expect(readSnapshotFile(broken)).rejects.toThrow(/скачался не полностью/);
  });

  it("битый zip объясняет себя", async () => {
    const broken = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x42, 0x42])]);
    await expect(readSnapshotFile(broken)).rejects.toThrow(/скачался не полностью/);
  });

  it("пустой файл не считает сжатым", async () => {
    expect(await readSnapshotFile(new Blob([]))).toBe("");
  });
});

describe("readSnapshotFile: что внутри архива", () => {
  it("мусор macOS не мешает найти единственный файл", async () => {
    // Finder кладёт это в архив сам; без отсева каждый второй архив с мака
    // считался бы «архивом из нескольких файлов».
    const b = zip({
      "snapshot.json": SNAP,
      "__MACOSX/._snapshot.json": "мусор",
      ".DS_Store": "мусор",
    });
    expect(await readSnapshotFile(b)).toBe(SNAP);
  });

  it("из нескольких файлов берёт единственный json", async () => {
    const b = zip({ "readme.txt": "как пользоваться", "dump.json": SNAP });
    expect(await readSnapshotFile(b)).toBe(SNAP);
  });

  it("единственный файл берёт независимо от расширения", async () => {
    // Отказать по расширению значило бы отвергнуть годный снимок; пусть
    // объяснит разбор JSON, он знает про содержимое больше.
    expect(await readSnapshotFile(zip({ backup: SNAP }))).toBe(SNAP);
  });

  it("вложенную папку разбирает", async () => {
    expect(await readSnapshotFile(zip({ "backup/snapshot.json": SNAP }))).toBe(SNAP);
  });

  it("два json — просит выбрать, а не берёт наугад", async () => {
    const b = zip({ "a.json": SNAP, "b.json": SNAP });
    await expect(readSnapshotFile(b)).rejects.toThrow(/несколько json \(2\)/);
  });

  it("нет json среди нескольких — говорит прямо", async () => {
    const b = zip({ "a.txt": "раз", "b.csv": "два" });
    await expect(readSnapshotFile(b)).rejects.toThrow(/нет json/);
  });

  it("пустой архив не выдаёт за снимок", async () => {
    await expect(readSnapshotFile(zip({}))).rejects.toThrow(/нет файлов/);
  });
});

describe("compressText / decompressBytes", () => {
  it("текст переживает круг", async () => {
    const gz = await compressText(SNAP);
    expect(gz).not.toBeNull();
    expect(await decompressBytes(gz!)).toBe(SNAP);
  });

  it("сжатое читается и обычным чтением файла", async () => {
    // Один и тот же gzip и в базе, и в скачанном файле: пусть распаковка
    // будет одна, иначе появятся два формата с одним расширением.
    const gz = await compressText(SNAP);
    expect(await readSnapshotFile(new Blob([gz! as BlobPart]))).toBe(SNAP);
  });

  it("кириллица не портится", async () => {
    const text = '{"tag":[{"title":"Продукты и хозтовары"}]}';
    expect(await decompressBytes((await compressText(text))!)).toBe(text);
  });

  it("на больших данных экономит место", async () => {
    // Смысл упражнения — место; проверяем, что оно правда экономится, а не
    // что вызов не падает.
    const big = JSON.stringify({
      transaction: Array.from({ length: 2000 }, (_, i) => ({
        id: `id-${i}`,
        payee: "Пятёрочка",
        outcome: 100,
      })),
    });
    const gz = await compressText(big);
    expect(gz!.byteLength).toBeLessThan(big.length / 5);
  });

  it("пустая строка не ломается", async () => {
    expect(await decompressBytes((await compressText(""))!)).toBe("");
  });
});
