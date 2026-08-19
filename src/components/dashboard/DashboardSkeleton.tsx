/**
 * Заглушка главной на время загрузки.
 *
 * Раньше на этом месте показывалось «Нет данных» с приглашением подключить
 * Дзен-мани — то есть первое, что видел человек во время первой же
 * синхронизации, было утверждение, что данных у него нет. Заглушка повторяет
 * форму будущей страницы, поэтому при появлении данных ничего не прыгает.
 */

export function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-5 animate-pulse" aria-busy="true" aria-live="polite">
      <span className="sr-only">Загружаем данные</span>

      <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] gap-5">
        <div className="flex flex-col gap-4 pt-4">
          <div className="h-6 w-48 rounded-full bg-panel2" />
          <div className="h-12 w-64 rounded-lg bg-panel2" />
          <div className="h-4 w-full max-w-[26rem] rounded bg-panel2" />
          <div className="h-4 w-3/4 rounded bg-panel2" />
          <div className="flex gap-3 pt-2">
            <div className="h-11 w-44 rounded-full bg-panel2" />
            <div className="h-11 w-28 rounded-full bg-panel2" />
          </div>
          <div className="mt-6 flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-6 rounded bg-panel2" />
            ))}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="card card-pad flex flex-col gap-3">
              <div className="h-5 w-40 rounded bg-panel2" />
              <div className="h-8 w-52 rounded bg-panel2" />
              {[0, 1, 2, 3].map((r) => (
                <div key={r} className="h-6 rounded bg-panel2" />
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-5">
        <div className="card card-pad flex flex-col gap-3">
          <div className="h-5 w-52 rounded bg-panel2" />
          <div className="h-56 rounded-lg bg-panel2" />
        </div>
        <div className="card card-pad flex flex-col gap-3">
          <div className="h-5 w-40 rounded bg-panel2" />
          {[0, 1, 2, 3, 4].map((r) => (
            <div key={r} className="h-6 rounded bg-panel2" />
          ))}
        </div>
      </section>
    </div>
  );
}
