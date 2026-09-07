/**
 * Чтение файла снимка: обычный JSON, gzip или zip.
 *
 * ЗАЧЕМ. Партнёрский сервис ZenTable выгружает бэкап Дзен-мани как
 * `<логин>-<serverTimestamp>.json.gz` — тот же самый сырой ответ `POST /v8/diff/`,
 * что кладём в снимок и мы, только пожатый. Разжатый файл наш импорт принимал и
 * раньше (`importSnapshotFromJson` умеет «голый» diff), но человеку пришлось бы
 * распаковывать его самому, а на 9 МБ текста это не самое очевидное действие.
 * Zip добавлен по той же логике: письмом и в мессенджерах архив ходит охотнее
 * голого json, и «переслал сам себе, а сервис не принял» — плохой конец.
 *
 * ПОЧЕМУ ПО СОДЕРЖИМОМУ, А НЕ ПО ИМЕНИ. Расширение врёт: Safari при скачивании
 * умеет снять `.gz` с имени, оставив содержимое сжатым, а `.json` рядом с gzip-
 * магией — обычное дело для файлов, переименованных вручную. Первые байты —
 * часть самих форматов, и врать им нечем.
 */

/** Сигнатура gzip: два первых байта заголовка по RFC 1952. */
const GZIP_MAGIC = [0x1f, 0x8b] as const;
/**
 * Сигнатура zip — «PK».
 *
 * Полная сигнатура записи это `PK\x03\x04`, но ей начинается только архив, в
 * котором есть хоть один файл: пустой стартует с `PK\x05\x06`, а собранный по
 * частям — с `PK\x07\x08`. Проверять две буквы и надёжнее, и честнее: JSON,
 * какими бы пробелами ни начинался, с «PK» не начнётся никогда, а разница
 * между «архив пуст» и «файл не разобрался как JSON» человеку важна.
 */
const ZIP_MAGIC = [0x50, 0x4b] as const;

function startsWith(head: Uint8Array, magic: readonly number[]): boolean {
  return (
    head.length >= magic.length && magic.every((b, i) => head[i] === b)
  );
}

/**
 * Разжать gzip средствами браузера.
 *
 * `DecompressionStream` есть во всех живых браузерах (Chrome 80+, Safari 16.4+,
 * Firefox 113+), но в старых — нет, и падать там надо понятной фразой, а не
 * `undefined is not a constructor`.
 */
async function gunzip(buf: ArrayBuffer): Promise<string> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "Этот браузер не умеет распаковывать .gz. Распакуйте файл вручную и " +
        "загрузите .json — содержимое подойдёт как есть."
    );
  }
  const stream = new Blob([buf])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  try {
    return await new Response(stream).text();
  } catch (e) {
    throw new Error(
      "Файл начинается как gzip, но распаковать его не удалось — возможно, " +
        "он скачался не полностью.",
      { cause: e }
    );
  }
}

/**
 * Достать единственный json из zip-архива.
 *
 * `fflate` уже лежит в дереве зависимостей (им же разбираются xlsx), поэтому
 * подтягиваем его динамически — в бандл он попадает только тому, кто дошёл до
 * загрузки архива.
 *
 * Служебное содержимое macOS (`__MACOSX/`, `.DS_Store`) отбрасываем: Finder
 * кладёт его в архив сам, и без этого «в архиве несколько файлов» ловил бы
 * каждый второй архив, собранный на маке.
 */
async function unzipJson(buf: ArrayBuffer): Promise<string> {
  const { unzipSync, strFromU8 } = await import("fflate");
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buf));
  } catch (e) {
    throw new Error(
      "Файл начинается как zip, но распаковать его не удалось — возможно, " +
        "он скачался не полностью.",
      { cause: e }
    );
  }
  const names = Object.keys(files).filter(
    (n) =>
      !n.startsWith("__MACOSX/") &&
      !n.endsWith("/") &&
      !n.split("/").pop()?.startsWith(".")
  );
  if (names.length === 0) {
    throw new Error("В архиве нет файлов.");
  }
  // Один файл берём любой: архив с единственным .txt внутри честнее пустить
  // дальше и дать разбору JSON объяснить, что не так, чем отказать по
  // расширению. Из нескольких — выбираем json, иначе выбор наугад молча
  // восстановил бы не то.
  const json = names.filter((n) => n.toLowerCase().endsWith(".json"));
  const pick =
    names.length === 1 ? names[0] : json.length === 1 ? json[0] : null;
  if (!pick) {
    throw new Error(
      json.length > 1
        ? `В архиве несколько json (${json.length}) — распакуйте и загрузите нужный.`
        : "В архиве нет json — распакуйте и загрузите файл снимка."
    );
  }
  return strFromU8(files[pick]);
}

/**
 * Вернуть текст снимка из файла: как есть либо после распаковки.
 *
 * Разбором JSON не занимается — это забота `importSnapshotFromJson`, которая
 * знает про принимаемые формы и умеет объяснить, что не так.
 */
export async function readSnapshotFile(file: Blob): Promise<string> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (startsWith(head, GZIP_MAGIC)) return gunzip(await file.arrayBuffer());
  if (startsWith(head, ZIP_MAGIC)) return unzipJson(await file.arrayBuffer());
  return file.text();
}
