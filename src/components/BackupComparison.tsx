import { useState } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";

/**
 * Чем локальная копия отличается от облачного снимка (#93).
 *
 * Две вкладки рядом называются похоже, и разницу между ними приходилось
 * выводить из подсказок под знаками вопроса — по одной на вкладку, каждая про
 * своё. Отсюда и главное недоразумение: человек полагает, что локальная копия
 * вернёт ему операции, если в Дзен-мани пусто.
 *
 * Не вернёт, и причина не в объёме копии, а в том, откуда приложение берёт
 * операции при подключённом Дзен-мани: каждая синхронизация заменяет их тем,
 * что пришло из облака. Восстановленные из файла операции доживут до первой
 * синхронизации. Об этом сказано прямо под таблицей — это единственное место,
 * где ошибка стоит потери данных.
 */
export function BackupComparison() {
  // Свёрнуто по умолчанию: это справка, её читают один раз, а место она
  // занимала перед обеими карточками постоянно и отодвигала их вниз.
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-panel2/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm text-left"
      >
        <ChevronRight
          className={`w-4 h-4 shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        />
        Чем копия сервиса отличается от снимка аккаунта
      </button>
      {/* Раскрытие через сетку: `<details>` высоту не анимирует, а `max-height`
          наугад либо режет содержимое, либо тормозит на коротком. Переход
          `0fr → 1fr` берёт настоящую высоту и работает при любой длине. */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
      <div className="px-4 pb-4 space-y-3">
      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-left">
              {/* Колонка подписей — по содержимому: доля от таблицы («26%») на
                  широком экране давала полтысячи пикселей пустоты под «Где
                  лежит». `w-px` + `whitespace-nowrap` сжимает её до подписи.
                  Оставшееся делим поровну: иначе колонки расходятся по длине
                  текста (802 против 534 на 1600 px) и таблицу перекашивает. */}
              <th className="table-th w-px whitespace-nowrap" />
              <th className="table-th w-1/2">Локальная копия</th>
              <th className="table-th w-1/2">Облачный снимок</th>
            </tr>
          </thead>
          <tbody>
            <Row
              label="Что внутри"
              local="Всё, что живёт только здесь: бюджеты, цели, правила, виды, оформление и неотправленные правки. Операции — в том виде, в каком их показывает DzenAnalytics."
              cloud="Копия аккаунта Дзен-мани целиком: операции, счета, категории, контрагенты и планы — в том виде, в каком их хранит сам Дзен-мани. Настройки DzenAnalytics снимок не хранит."
            />
            <Row
              label="Где лежит"
              local="Файлом у вас на устройстве."
              cloud="В браузере, последние пять. Любой можно сохранить файлом. Загрузить можно и бэкап ZenTable — в формате json, zip или gz."
            />
            <Row
              label="Когда пригодится"
              local="Переустановили браузер, очистили данные сайта, переехали на другой компьютер."
              cloud="В Дзен-мани пропали или испортились операции."
            />
          </tbody>
        </table>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-warn/40 bg-warn/5 p-3 text-xs">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-warn" />
        <span>
          <strong>Локальная копия не вернёт операции в пустой аккаунт
          Дзен-мани.</strong>{" "}
          При подключённом Дзен-мани операции приходят из него, и каждая
          синхронизация заменяет местные тем, что лежит в облаке. Восстановленные
          из файла операции доживут до первой синхронизации, а потом исчезнут:
          в облаке их нет. Вернуть их в Дзен-мани может только облачный снимок.
        </span>
      </div>
      </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  local,
  cloud,
}: {
  label: string;
  local: string;
  cloud: string;
}) {
  return (
    <tr className="border-t border-border/60 align-top">
      <td className="table-td text-muted whitespace-nowrap pr-6">{label}</td>
      <td className="table-td">{local}</td>
      <td className="table-td">{cloud}</td>
    </tr>
  );
}
