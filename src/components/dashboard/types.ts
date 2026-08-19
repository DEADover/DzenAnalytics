import type { DashboardModel } from "../../hooks/useDashboardModel";

/**
 * Общий вход всех вариантов главной.
 *
 * Данные приходят готовой моделью, переходы — колбэками: сам вариант не должен
 * знать ни про хранилища, ни про то, как открывается drawer с операциями.
 * Благодаря этому варианты сравнимы — различается только раскладка.
 */
export interface VariantProps {
  m: DashboardModel;
  /** Открыть операции месяца. */
  onMonth: (ym: string) => void;
  /** Открыть операции категории. */
  onCategory: (name: string) => void;
  /** Открыть операции счёта. */
  onAccount: (title: string) => void;
}
