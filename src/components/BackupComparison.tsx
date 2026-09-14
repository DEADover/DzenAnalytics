import { HeadCell } from "./table/TableParts";
import { cellClass } from "./table/tableKit";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Callout } from "./Callout";

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
        <table className="w-full">
          <thead>
            <tr>
              {/* Колонка подписей — по содержимому: доля от таблицы («26%») на
                  широком экране давала полтысячи пикселей пустоты под «Где
                  лежит». `w-px` + `whitespace-nowrap` сжимает её до подписи.
                  Оставшееся делим поровну: иначе колонки расходятся по длине
                  текста (802 против 534 на 1600 px) и таблицу перекашивает. */}
              <th className="table-th w-px whitespace-nowrap" />
              <HeadCell type="text" label="Локальная копия" className="w-1/2" />
              <HeadCell type="text" label="Облачный снимок" className="w-1/2" />
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
              local="Файлом у вас на устройстве — браузер сохраняет его в папку загрузок."
              cloud="Внутри вашего браузера, максимум пять снимков. Любой можно сохранить файлом на устройство. При восстановлении подойдёт бэкап и DzenAnalytics, и ZenTable — в формате json, zip или gz."
            />
            <Row
              label="Когда пригодится"
              local="Переустановили браузер, очистили данные сайта, переехали на другой компьютер."
              cloud="В Дзен-мани пропали или испортились операции."
            />
          </tbody>
        </table>
      </div>

      <Callout tone="warn">
        <strong>Локальная копия не вернёт операции в пустой аккаунт
        Дзен-мани.</strong>{" "}
        При подключённом Дзен-мани операции приходят из него, и каждая
        синхронизация заменяет местные тем, что лежит в облаке. Восстановленные
        из файла операции доживут до первой синхронизации, а потом исчезнут:
        в облаке их нет. Вернуть их в Дзен-мани может только облачный снимок.
      </Callout>
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
    // Сравнение словами, а не данными: ячейки — абзацы, поэтому переносятся и
    // выравниваются по верху. Шрифт, поля и черты — табличные.
    <tr>
      <td className={cellClass("text", { muted: true, className: "whitespace-nowrap align-top pr-6" })}>{label}</td>
      <td className={cellClass("text", { className: "align-top" })}>{local}</td>
      <td className={cellClass("text", { className: "align-top" })}>{cloud}</td>
    </tr>
  );
}
