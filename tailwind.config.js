/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      // Широкоформатные мониторы — основной сценарий: на 1920 и 2560 колонок
      // должно становиться БОЛЬШЕ, а не шире. Растянутая на 1200 px строка
      // «счёт слева — баланс справа» заставляет глаз ехать через полэкрана,
      // и места при этом не экономит. Стандартный 2xl обрывается на 1536.
      screens: {
        // Ряд общего фильтра: восемь пресетов, месяц и отрезок дат встают в одну
        // строку только начиная отсюда — на 1280 они уже вылезают за карточку.
        filters: "1400px",
        "3xl": "1800px",
        "4xl": "2200px",
      },
      colors: {
        bg: "rgb(var(--c-bg) / <alpha-value>)",
        panel: "rgb(var(--c-panel) / <alpha-value>)",
        panel2: "rgb(var(--c-panel2) / <alpha-value>)",
        border: "rgb(var(--c-border) / <alpha-value>)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
        text: "rgb(var(--c-text) / <alpha-value>)",
        accent: "rgb(var(--c-accent) / <alpha-value>)",
        "accent-fg": "rgb(var(--c-accent-fg) / <alpha-value>)",
        "on-tone": "rgb(var(--c-on-tone) / <alpha-value>)",
        accent2: "rgb(var(--c-accent2) / <alpha-value>)",
        income: "rgb(var(--c-income) / <alpha-value>)",
        expense: "rgb(var(--c-expense) / <alpha-value>)",
        warn: "rgb(var(--c-warn) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Geist Variable", "Inter", "-apple-system", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["Geist Mono Variable", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        tray: "var(--shadow-tray)",
      },
      // Шкала скруглений контролов — одна на продукт (16.09.2026): кнопки,
      // поля, чипы и дорожки переключателей с углами блоков страницы, а не
      // пилюли. Выбор — по высоте контрола. Общие классы (`.btn`, `.chip`,
      // `.seg-*`, `.input`) берут радиус отсюда; в разметке — только имя
      // ступени, не число.
      borderRadius: {
        "control-lg": "16px", // 44 и выше — крупные кнопки-призывы
        control: "12px", //      34–42 — обычные кнопки, поля, чипы
        "control-sm": "8px", //  26–32 — кнопки-значки, плотные чипы
        "control-xs": "6px", //  24 и ниже — крошечные кнопки в строке
        track: "16px", //        дорожка 42 (пункты 32 · 12 + поле 4)
        "track-sm": "12px", //   дорожка 34 (пункты 24 · 8 + поле 4)
      },
    },
  },
  plugins: [],
};
