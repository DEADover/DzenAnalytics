import { FlaskConical } from "lucide-react";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { isDemoToken } from "../lib/demo/demoServer";
import { exitDemo } from "../hooks/useDemo";
import { Callout } from "./Callout";

/**
 * Плашка над каждым разделом, пока открыты демо-данные: что это за данные и
 * как отсюда выйти к своим.
 */
export function DemoBanner() {
  const token = useZenmoneyStore((s) => s.token);
  if (!isDemoToken(token)) return null;
  return (
    <Callout tone="accent" size="banner" icon={FlaskConical} className="mb-4 items-center">
      <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
      <div className="flex-1 min-w-[16rem]">
        <span className="text-text font-medium">Это демо-данные выдуманной семьи.</span>{" "}
        Смотрите и пробуйте что угодно: правки остаются только в этом браузере и
        никуда не отправляются.
      </div>
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        <button type="button" className="btn-ghost" onClick={() => exitDemo()}>
          Выйти из демо
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => exitDemo("/settings?tab=source&source=api")}
        >
          Подключить свой Дзен-мани
        </button>
      </div>
      </div>
    </Callout>
  );
}
