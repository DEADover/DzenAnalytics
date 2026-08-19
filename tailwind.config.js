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
        card: "var(--shadow-card)",
        tray: "var(--shadow-tray)",
      },
    },
  },
  plugins: [],
};
