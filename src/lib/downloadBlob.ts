/**
 * Отдать собранный файл пользователю.
 *
 * Одна и та же дюжина строк лежала копиями в отчётах, годовой выгрузке, PDF и
 * бэкапе. Отличались они только опечатками, а править приходилось везде —
 * например, когда выяснилось, что ссылку надо отзывать с задержкой: Safari
 * успевает отменить скачивание, если `revokeObjectURL` вызвать сразу.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
