/**
 * Разделы из панели «Ещё» — одним списком.
 *
 * Живут отдельно от шапки, потому что список нужен в двух местах: сама панель
 * «Ещё» и полоска с кнопками на главной, где человек собирает себе быстрые переходы.
 * Пока список был внутри `TopNav`, второе место пришлось бы дублировать — а
 * дублированный список разделов расходится с настоящим при первом же новом
 * разделе.
 */

import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  CalendarDays,
  ClipboardList,
  Cloud,
  Copy,
  FlaskConical,
  GitCompare,
  GitFork,
  Hash,
  HeartPulse,
  LineChart,
  Newspaper,
  Percent,
  Repeat,
  Sparkles,
  Table,
  Tag,
  Target,
  Trash2,
  TrendingUp,
  Wand2,
  Zap,
} from "lucide-react";

export interface NavSection {
  to: string;
  label: string;
  icon: LucideIcon;
  /**
   * Строчка-пояснение в меню «Ещё» и в подсказке быстрых переходов на главной:
   * что внутри раздела, чтобы его выбрать. До сорока знаков — длиннее в
   * колонке меню обрезается. Подпись под заголовком самой страницы — своя и
   * эту строчку не повторяет.
   */
  hint: string;
}

// «Ещё» разбито на смысловые разделы с заголовками-разделителями. У каждого
// пункта своя строчка-пояснение: в списке из двадцати трёх названий «Динамика»,
// «Тренды» и «Cash-flow» на слух не различаются, а панель во всю ширину как раз
// даёт место объяснить разницу. Подпись под заголовком страницы говорит другое —
// что там можно понять или сделать: одинаковый текст в меню и на странице
// читается как повтор.
// Аналитика (смотреть/понять), Планы (цели и бюджеты), Инструменты
// (порядок в данных). «Финансовое здоровье» — первым пунктом.
export const SECONDARY_GROUPS: { title: string; items: NavSection[] }[] = [
  {
    title: "Аналитика",
    items: [
      { to: "/health", label: "Финансовое здоровье", icon: HeartPulse, hint: "Насколько устойчивы финансы сейчас" },
      { to: "/report", label: "Доходы и расходы", icon: Table, hint: "Все категории по периодам одной таблицей" },
      { to: "/dynamics", label: "Динамика", icon: Activity, hint: "Операции на временной оси" },
      { to: "/trends", label: "Тренды", icon: BarChart3, hint: "По месяцам, дням недели и часам суток" },
      { to: "/cashflow", label: "Cash-flow", icon: LineChart, hint: "Доходы, расходы и чистый поток по месяцам" },
      { to: "/compare", label: "Сравнение", icon: GitCompare, hint: "Два периода рядом" },
      { to: "/top", label: "Топ", icon: TrendingUp, hint: "Крупные категории, контрагенты и операции" },
      { to: "/calendar", label: "Календарь", icon: CalendarDays, hint: "Тепловая карта по дням года" },
      { to: "/sankey", label: "Потоки", icon: GitFork, hint: "Откуда пришли деньги и куда ушли" },
      { to: "/year-review", label: "Год в цифрах", icon: Sparkles, hint: "Итоги и рекорды года" },
      { to: "/digest", label: "Дайджест", icon: Newspaper, hint: "Итоги прошедших недель и месяцев" },
    ],
  },
  {
    title: "Планы",
    items: [
      { to: "/goals", label: "Цели", icon: Target, hint: "Накопления на цели и их прогресс" },
      { to: "/budgets", label: "Бюджеты", icon: ClipboardList, hint: "План и факт по статьям" },
      { to: "/50-30-20", label: "50/30/20", icon: Percent, hint: "Нужды, желания и сбережения" },
      { to: "/whatif", label: "Что-если", icon: FlaskConical, hint: "Если бы доход или траты были другими" },
    ],
  },
  {
    title: "Инструменты",
    items: [
      { to: "/uncategorized", label: "Без категории", icon: Tag, hint: "Подсказки, куда разнести операции" },
      { to: "/duplicates", label: "Дубликаты", icon: Copy, hint: "Операции, похожие на задвоенные" },
      { to: "/anomalies", label: "Аномалии", icon: Zap, hint: "Необычные траты и всплески по категориям" },
      { to: "/recurring", label: "Регулярные", icon: Repeat, hint: "Планы из Дзен-мани и найденные подписки" },
      { to: "/rules", label: "Правила", icon: Wand2, hint: "Категории и получатели по условиям" },
      { to: "/tags", label: "Теги", icon: Hash, hint: "Операции по хэштегам и вторым категориям" },
      { to: "/wordcloud", label: "Облако слов", icon: Cloud, hint: "Частые слова в комментариях" },
      { to: "/trash", label: "Удалённые", icon: Trash2, hint: "Удалённые операции — их можно вернуть" },
    ],
  },
];

/** Те же разделы плоским списком — в порядке панели «Ещё». */
export const SECONDARY: NavSection[] = SECONDARY_GROUPS.flatMap((g) => g.items);

const BY_PATH = new Map(SECONDARY.map((s) => [s.to, s]));

/** Раздел по пути. `undefined` — путь из другой версии или просто мусор. */
export function navSection(to: string): NavSection | undefined {
  return BY_PATH.get(to);
}
