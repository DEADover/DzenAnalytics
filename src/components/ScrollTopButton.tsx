import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

/**
 * Круглая кнопка «Наверх» в правом нижнем углу длинной ленты. Появляется,
 * когда страница прокручена дальше первого экрана.
 *
 * Одна на ленту «Операций» и «Удалённые».
 */
export function ScrollTopButton({ threshold = 600 }: { threshold?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > threshold);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);

  if (!show) return null;
  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="fixed bottom-6 right-6 z-30 w-10 h-10 rounded-full border border-border bg-panel shadow-xl flex items-center justify-center text-muted hover:text-accent transition-colors"
      title="Наверх"
      aria-label="Вернуться к началу списка"
    >
      <ArrowUp className="w-5 h-5" />
    </button>
  );
}
