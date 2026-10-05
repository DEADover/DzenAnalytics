// Переход между аккаунтами — перезагрузка страницы. Пока новая страница
// грузит стили и приложение, браузер рисовал её белой: заметная вспышка между
// старой страницей и экраном перехода. Здесь, до всего остального, страница
// сразу получает фон и тему экрана перехода (их запомнила старая страница —
// lib/switchOverlay.ts). Отдельным файлом, а не встроенным кодом: строгая CSP
// сайта встроенные скрипты не пускает.
(function () {
  try {
    var f = JSON.parse(sessionStorage.getItem("dzenanalytics:switching") || "null");
    if (!f || !f.bg || Date.now() - f.at > 15000) return;
    var r = document.documentElement;
    r.style.background = f.bg;
    if (f.theme) r.setAttribute("data-theme", f.theme);
    if (f.scheme) r.setAttribute("data-scheme", f.scheme);
  } catch (e) {
    /* без хранилища — без заливки, как раньше */
  }
})();
