import { useEffect, useMemo, useState } from "react";
import { Settings2, CheckCircle2, X, Sparkles, Pencil, Trash2 } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useCalibrationStore } from "../store/useCalibrationStore";
import { confirm } from "../store/useConfirmStore";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import {
  detectBalanceAnchors,
  cumulativeNetAt,
  lastTransactionDate,
} from "../lib/aggregations";
import { formatMoney, formatDate } from "../lib/format";

export function QuickCalibration() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const calibration = useCalibrationStore((s) => s.calibration);
  const setCalibration = useCalibrationStore((s) => s.set);
  const clearCalibration = useCalibrationStore((s) => s.clear);
  const calibLoaded = useCalibrationStore((s) => s.loaded);
  const hydrate = useCalibrationStore((s) => s.hydrate);
  // When the Zenmoney API token is connected, calibration is written
  // automatically on every sync — manual UI is just noise.
  const zenToken = useZenmoneyStore((s) => s.token);
  const zenLoaded = useZenmoneyStore((s) => s.loaded);
  const zenHydrate = useZenmoneyStore((s) => s.hydrate);

  useEffect(() => {
    if (!calibLoaded) hydrate();
    if (!zenLoaded) zenHydrate();
  }, [calibLoaded, hydrate, zenLoaded, zenHydrate]);

  const [dismissed, setDismissed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");

  const lastDate = useMemo(() => lastTransactionDate(transactions), [transactions]);
  const rawAtLast = useMemo(
    () => cumulativeNetAt(transactions, lastDate),
    [transactions, lastDate]
  );
  const anchors = useMemo(() => detectBalanceAnchors(transactions), [transactions]);

  if (transactions.length === 0) return null;
  // Both flags come from IndexedDB and land a tick AFTER the transactions do,
  // so deciding on their default values flashes the banner at every page load —
  // for API users it then vanishes once the token arrives, which reads as a
  // glitch. Say nothing until we actually know.
  if (!zenLoaded || !calibLoaded) return null;
  // API auto-calibrates on every sync; never show the manual banner.
  if (zenToken) return null;
  if (calibration && !editing && dismissed) return null;
  if (!calibration && dismissed) return null;

  function applyManual() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt === 0) return;
    setCalibration({ date: lastDate, amount: amt });
    setEditing(false);
    setAmount("");
  }

  function applyAnchor() {
    if (anchors.length === 0) return;
    const a = anchors[0];
    const cumAtAnchor = cumulativeNetAt(transactions, a.tx.date);
    setCalibration({ date: a.tx.date, amount: cumAtAnchor + a.amount });
    setEditing(false);
  }

  function startEdit() {
    setEditing(true);
    setAmount(calibration ? String(Math.round(calibration.amount)) : "");
  }

  function cancelEdit() {
    setEditing(false);
    setAmount("");
  }

  if (calibration && !editing) {
    const currentAtLast = rawAtLast + (calibration.amount - cumulativeNetAt(transactions, calibration.date));
    return (
      <div className="card card-pad bg-income/5 border-income/40">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <CheckCircle2 className="w-5 h-5 text-income shrink-0" />
            <div className="min-w-0">
              <div className="font-medium text-sm">
                Калибровка активна
              </div>
              <div className="text-xs text-muted">
                На {formatDate(calibration.date)} баланс ={" "}
                <span className="tabular-nums text-text">
                  {formatMoney(calibration.amount, base)}
                </span>
                {" · "}
                сейчас (на {formatDate(lastDate)}) ≈{" "}
                <span className="tabular-nums text-text">
                  {formatMoney(currentAtLast, base, { signed: true })}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={startEdit} className="btn-ghost text-xs">
              <Pencil className="w-3.5 h-3.5" />
              Изменить
            </button>
            <button
              onClick={async () => {
                const ok = await confirm({
                  title: "Сбросить калибровку?",
                  message:
                    "Текущая балансовая привязка будет удалена. Можно будет настроить заново.",
                  confirmLabel: "Сбросить",
                  tone: "danger",
                });
                if (ok) clearCalibration();
              }}
              className="btn-ghost text-xs text-muted hover:text-expense"
              title="Сбросить"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setDismissed(true)}
              className="btn-ghost !p-1.5 text-muted"
              title="Скрыть на этой странице"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card card-pad bg-accent2/5 border-accent2/40">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-start gap-3">
          <Settings2 className="w-5 h-5 text-accent2 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">
              {editing ? "Изменить калибровку" : "Калибровка совокупного баланса"}
            </div>
            <div className="text-xs text-muted mt-1 max-w-2xl">
              CSV не содержит начальных остатков, поэтому график «от 0» показывает не реальный
              баланс, а изменение богатства за период. Введите вашу <b>текущую</b> сумму на всех
              счетах — весь график сдвинется и начнёт показывать реальные значения.
            </div>
          </div>
        </div>
        {editing ? (
          <button onClick={cancelEdit} className="btn-ghost text-xs shrink-0">
            Отмена
          </button>
        ) : (
          <button
            onClick={() => setDismissed(true)}
            className="btn-ghost !p-1.5 text-muted shrink-0"
            title="Скрыть"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {anchors.length > 0 && !editing && (
        <div className="mb-3 p-3 rounded-lg bg-panel2 border border-border flex items-start gap-3">
          <Sparkles className="w-4 h-4 text-accent shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">
              Найдены потенциальные «якорные» операции в данных
            </div>
            <div className="text-xs text-muted mt-1">
              Самая свежая: {formatDate(anchors[0].tx.date)} ·{" "}
              {anchors[0].tx.categoryFull} ·{" "}
              {formatMoney(anchors[0].amount, base)}
            </div>
          </div>
          <button onClick={applyAnchor} className="btn-ghost text-xs whitespace-nowrap">
            Применить
          </button>
        </div>
      )}

      <div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div className="md:col-span-2">
            <label className="label block mb-1">
              Сегодняшний совокупный баланс ({base})
            </label>
            <input
              type="number"
              inputMode="numeric"
              placeholder="например, 2900000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyManual()}
              className="input"
              autoFocus
            />
          </div>
          <button
            onClick={applyManual}
            disabled={!amount || !Number.isFinite(Number(amount))}
            className="btn-primary"
          >
            <CheckCircle2 className="w-4 h-4" />
            {editing ? "Сохранить" : "Откалибровать"}
          </button>
        </div>
        <div className="text-[11px] text-muted mt-2">
          Для даты {formatDate(lastDate)}. Сейчас график показывает{" "}
          <span className="tabular-nums">
            {formatMoney(rawAtLast, base, { signed: true })}
          </span>{" "}
          на эту дату — после калибровки он покажет введённую сумму.
        </div>
      </div>
    </div>
  );
}
