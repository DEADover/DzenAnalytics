/**
 * Разделы, которые грузятся отдельными кусками (см. `lib/lazyPage`), и их
 * адреса. Главная — в общем файле: с неё чаще всего начинают.
 *
 * Код всех разделов подгружается в свободную минуту после старта
 * (`preloadAllPages`), поэтому переход обычно ничего не ждёт; плавный переход
 * (`useSmoothNavigate`) на всякий случай дожидается своего раздела сам.
 */
import { lazyPage, type LazyPage } from "./lib/lazyPage";

export const ImportPage = lazyPage(() => import("./pages/ImportPage").then((m) => m.ImportPage));
export const RecurringPage = lazyPage(() => import("./pages/RecurringPage").then((m) => m.RecurringPage));
export const ComparePage = lazyPage(() => import("./pages/ComparePage").then((m) => m.ComparePage));
export const BudgetsPage = lazyPage(() => import("./pages/BudgetsPage").then((m) => m.BudgetsPage));
export const AnomaliesPage = lazyPage(() => import("./pages/AnomaliesPage").then((m) => m.AnomaliesPage));
export const SearchPage = lazyPage(() => import("./pages/SearchPage").then((m) => m.SearchPage));
export const GoalsPage = lazyPage(() => import("./pages/GoalsPage").then((m) => m.GoalsPage));
export const DuplicatesPage = lazyPage(() => import("./pages/DuplicatesPage").then((m) => m.DuplicatesPage));
export const UncategorizedPage = lazyPage(() => import("./pages/UncategorizedPage").then((m) => m.UncategorizedPage));
export const DeletedPage = lazyPage(() => import("./pages/DeletedPage").then((m) => m.DeletedPage));
export const HelpPage = lazyPage(() => import("./pages/HelpPage").then((m) => m.HelpPage));
export const RulesPage = lazyPage(() => import("./pages/RulesPage").then((m) => m.RulesPage));
export const HealthPage = lazyPage(() => import("./pages/HealthPage").then((m) => m.HealthPage));
export const WhatIfPage = lazyPage(() => import("./pages/WhatIfPage").then((m) => m.WhatIfPage));
export const YearReviewPage = lazyPage(() => import("./pages/YearReviewPage").then((m) => m.YearReviewPage));
export const DigestPage = lazyPage(() => import("./pages/DigestPage").then((m) => m.DigestPage));
export const TransactionsPage = lazyPage(() => import("./pages/TransactionsPage").then((m) => m.TransactionsPage));
export const CashflowPage = lazyPage(() => import("./pages/CashflowPage").then((m) => m.CashflowPage));
export const CategoriesPage = lazyPage(() => import("./pages/CategoriesPage").then((m) => m.CategoriesPage));
export const ReportPage = lazyPage(() => import("./pages/ReportPage").then((m) => m.ReportPage));
export const DynamicsPage = lazyPage(() => import("./pages/DynamicsPage").then((m) => m.DynamicsPage));
export const AccountsPage = lazyPage(() => import("./pages/AccountsPage").then((m) => m.AccountsPage));
export const CalendarPage = lazyPage(() => import("./pages/CalendarPage").then((m) => m.CalendarPage));
export const TagsPage = lazyPage(() => import("./pages/TagsPage").then((m) => m.TagsPage));
export const TopPage = lazyPage(() => import("./pages/TopPage").then((m) => m.TopPage));
export const CounterpartiesPage = lazyPage(() => import("./pages/CounterpartiesPage").then((m) => m.CounterpartiesPage));
export const TrendsPage = lazyPage(() => import("./pages/TrendsPage").then((m) => m.TrendsPage));
export const SankeyPage = lazyPage(() => import("./pages/SankeyPage").then((m) => m.SankeyPage));
export const WordcloudPage = lazyPage(() => import("./pages/WordcloudPage").then((m) => m.WordcloudPage));
export const Budget503020Page = lazyPage(() => import("./pages/Budget503020Page").then((m) => m.Budget503020Page));

const BY_PATH: Record<string, LazyPage> = {
  "/settings": ImportPage,
  "/recurring": RecurringPage,
  "/compare": ComparePage,
  "/budgets": BudgetsPage,
  "/anomalies": AnomaliesPage,
  "/search": SearchPage,
  "/goals": GoalsPage,
  "/duplicates": DuplicatesPage,
  "/uncategorized": UncategorizedPage,
  "/trash": DeletedPage,
  "/help": HelpPage,
  "/rules": RulesPage,
  "/health": HealthPage,
  "/whatif": WhatIfPage,
  "/year-review": YearReviewPage,
  "/digest": DigestPage,
  "/transactions": TransactionsPage,
  "/cashflow": CashflowPage,
  "/categories": CategoriesPage,
  "/report": ReportPage,
  "/dynamics": DynamicsPage,
  "/accounts": AccountsPage,
  "/calendar": CalendarPage,
  "/tags": TagsPage,
  "/top": TopPage,
  "/counterparties": CounterpartiesPage,
  "/trends": TrendsPage,
  "/sankey": SankeyPage,
  "/wordcloud": WordcloudPage,
  "/50-30-20": Budget503020Page,
};

/** Раздел по адресу (без параметров и якоря). Нет — главная или переадресация. */
export function lazyPageFor(to: string): LazyPage | undefined {
  const path = to.split(/[?#]/)[0] || "/";
  return BY_PATH[path];
}

/** Подгрузить код всех разделов по одному, пока браузер свободен. */
export function preloadAllPages(): void {
  const queue = Object.values(BY_PATH);
  const idle = (cb: () => void) =>
    typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback(cb, { timeout: 3000 })
      : window.setTimeout(cb, 200);
  const next = () => {
    const page = queue.shift();
    if (!page) return;
    void page.preload().catch(() => {}).finally(() => idle(next));
  };
  idle(next);
}
