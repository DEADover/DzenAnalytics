/**
 * Действия с запланированной операцией из ленты — как в приложении Дзен-мани:
 * «Сохранить как факт», «Связать план с фактом» и «Изменить» (эту дату или
 * всю цепочку). Удаление даты и цепочки живут в своей очереди
 * (`usePlannedDeletionsStore`, issue #71).
 *
 * Как Дзен-мани это хранит — сверено по живым записям пользователя
 * (30.09.2026, только чтение):
 *
 *   • у плана два уровня: правило (`reminder`: период, шаг, дата начала) и по
 *     одной «дате» (`reminderMarker`) на каждое повторение, примерно на год
 *     вперёд;
 *   • факт связан с датой полем `transaction.reminderMarker`, а сама дата
 *     переходит в `state: "processed"` и хранит ПЛАНОВЫЕ сумму и день (план
 *     Adobe на 8 ₽ 17.09 закрыт фактом на 7,45 ₽ 16.09). Операция и дата
 *     уходят одним запросом;
 *   • «Сохранить как факт» — новая операция без банковских номеров со ссылкой
 *     на дату; «Связать» — та же ссылка у уже существующей операции (так
 *     связаны и операции из банка);
 *   • закрыть фактом можно и прогноз (`isForecast: true`).
 *
 * Здесь — чистые функции: применить очередь к датам плана (чтобы лента сразу
 * показывала задуманное) и собрать из очереди то, что уедет в облако.
 */

import type { ZenReminder, ZenReminderMarker } from "./zenmoney";

/** Правка полей даты плана — уже в терминах Дзен-мани (id счетов и тегов). */
export interface PlanPatch {
  /** Новый день — только у правки одной даты. */
  date?: string;
  /** Сумма главной ноги: списание у расхода и перевода, зачисление у дохода. */
  amount?: number;
  /** Зачисление у перевода между валютами. */
  incomeAmount?: number;
  /** Счёт: списания у расхода и перевода, зачисления у дохода. */
  account?: string;
  /** Счёт зачисления у перевода. */
  toAccount?: string;
  tag?: string[] | null;
  payee?: string | null;
  merchant?: string | null;
  comment?: string | null;
}

interface Base {
  /** id даты плана (`reminderMarker`) — ключ очереди. */
  markerId: string;
  /** День даты плана и подпись — для списка изменений, когда даты в кэше уже нет. */
  date: string;
  title: string;
}

export type PlanAction =
  /** Факт создан из плана: черновик `txId` уже ссылается на дату. */
  | (Base & { kind: "fact"; txId: string })
  /** Существующая операция `txId` закрывает дату. */
  | (Base & { kind: "link"; txId: string })
  /** Правка одной даты или всей цепочки (с этой даты и дальше). */
  | (Base & { kind: "edit"; scope: "date" | "chain"; patch: PlanPatch });

type Kind = "expense" | "income" | "transfer";

function kindOf(m: ZenReminderMarker): Kind {
  if (m.outcome > 0 && m.income > 0 && m.outcomeAccount !== m.incomeAccount) return "transfer";
  return m.outcome > 0 ? "expense" : "income";
}

type Legs = Pick<
  ZenReminderMarker,
  | "outcome"
  | "income"
  | "outcomeAccount"
  | "incomeAccount"
  | "outcomeInstrument"
  | "incomeInstrument"
  | "tag"
  | "payee"
  | "merchant"
  | "comment"
>;

/**
 * Наложить правку на ноги даты или правила. `instrumentOf` отдаёт валюту
 * счёта: у расхода и дохода обе ноги стоят на одном счёте, и при переносе на
 * счёт в другой валюте вместе со счётом меняется и валюта.
 */
function patchLegs<T extends Partial<Legs>>(
  src: T,
  kind: Kind,
  patch: PlanPatch,
  instrumentOf: (account: string) => number | undefined
): T {
  const out = { ...src };
  if (patch.tag !== undefined) out.tag = patch.tag;
  if (patch.payee !== undefined) out.payee = patch.payee;
  if (patch.merchant !== undefined) out.merchant = patch.merchant;
  if (patch.comment !== undefined) out.comment = patch.comment;
  if (kind === "transfer") {
    if (patch.account !== undefined) {
      out.outcomeAccount = patch.account;
      out.outcomeInstrument = instrumentOf(patch.account) ?? out.outcomeInstrument;
    }
    if (patch.toAccount !== undefined) {
      out.incomeAccount = patch.toAccount;
      out.incomeInstrument = instrumentOf(patch.toAccount) ?? out.incomeInstrument;
    }
    if (patch.amount !== undefined) {
      out.outcome = patch.amount;
      // Одна валюта — зачисление равно списанию; разные — отдельной суммой.
      out.income =
        out.incomeInstrument === out.outcomeInstrument
          ? patch.amount
          : patch.incomeAmount ?? out.income;
    } else if (patch.incomeAmount !== undefined) {
      out.income = patch.incomeAmount;
    }
    return out;
  }
  if (patch.account !== undefined) {
    const inst = instrumentOf(patch.account);
    out.outcomeAccount = patch.account;
    out.incomeAccount = patch.account;
    if (inst !== undefined) {
      out.outcomeInstrument = inst;
      out.incomeInstrument = inst;
    }
  }
  if (patch.amount !== undefined) {
    if (kind === "expense") out.outcome = patch.amount;
    else out.income = patch.amount;
  }
  return out;
}

export interface PlanOverlay {
  /** Даты плана, как они выглядят с учётом очереди: закрытые фактом убраны,
   *  правки наложены. */
  markers: ZenReminderMarker[];
  /** Правила с учётом правок цепочки и переноса разового плана. */
  reminders: ZenReminder[];
  /** id дат, закрытых фактом (для них лента показывает «связано»). */
  processed: Set<string>;
}

/**
 * Применить очередь к датам и правилам плана.
 *
 * Правка цепочки берёт дату, с которой её начали, и все ЗАПЛАНИРОВАННЫЕ даты
 * того же правила не раньше неё: «изменить всю цепочку» у пятой по счёту
 * подписки не должно переписывать уже прошедшие.
 *
 * Разовый план — это одно правило и одна дата. Перенос его дня меняет и
 * правило: иначе у Дзен-мани осталось бы правило со старым днём, и
 * приложение могло бы достроить по нему дату заново (так при переносе и
 * появлялся дубль «просрочен + будущий», issue #99).
 */
export function applyPlanActions(
  markers: ZenReminderMarker[],
  reminders: ZenReminder[],
  actions: PlanAction[],
  instrumentOf: (account: string) => number | undefined
): PlanOverlay {
  const byId = new Map(markers.map((m) => [m.id, m]));
  const remById = new Map(reminders.map((r) => [r.id, r]));
  const nextMarkers = new Map(markers.map((m) => [m.id, m]));
  const nextReminders = new Map(reminders.map((r) => [r.id, r]));
  const processed = new Set<string>();

  for (const a of actions) {
    const m = byId.get(a.markerId);
    if (!m) continue;
    if (a.kind === "fact" || a.kind === "link") {
      processed.add(m.id);
      continue;
    }
    const kind = kindOf(m);
    const rem = remById.get(m.reminder);
    const oneOff = !!rem && rem.interval == null;
    if (a.scope === "chain" && rem && !oneOff) {
      const { date: _skip, ...legs } = a.patch;
      void _skip;
      nextReminders.set(rem.id, patchLegs(nextReminders.get(rem.id) ?? rem, kind, legs, instrumentOf));
      for (const other of markers) {
        if (other.reminder !== rem.id || other.state !== "planned" || other.date < m.date) continue;
        const cur = nextMarkers.get(other.id) ?? other;
        nextMarkers.set(other.id, patchLegs(cur, kind, legs, instrumentOf));
      }
      continue;
    }
    // Одна дата. У разового плана она и есть весь план — правим и правило.
    const cur = nextMarkers.get(m.id) ?? m;
    const patched = patchLegs(cur, kind, a.patch, instrumentOf);
    if (a.patch.date) patched.date = a.patch.date;
    nextMarkers.set(m.id, patched);
    if (oneOff && rem) {
      const r = patchLegs(nextReminders.get(rem.id) ?? rem, kind, a.patch, instrumentOf);
      if (a.patch.date) {
        r.startDate = a.patch.date;
        if (r.endDate) r.endDate = a.patch.date;
      }
      nextReminders.set(rem.id, r);
    }
  }

  return {
    markers: [...nextMarkers.values()].filter((m) => !processed.has(m.id)),
    reminders: [...nextReminders.values()],
    processed,
  };
}

const LEG_KEYS = [
  "date",
  "outcome",
  "income",
  "outcomeAccount",
  "incomeAccount",
  "outcomeInstrument",
  "incomeInstrument",
  "tag",
  "payee",
  "merchant",
  "comment",
  "startDate",
  "endDate",
] as const;

function differs(a: object, b: object): boolean {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  return LEG_KEYS.some((k) => JSON.stringify(x[k] ?? null) !== JSON.stringify(y[k] ?? null));
}

export interface PlanPush {
  markers: ZenReminderMarker[];
  reminders: ZenReminder[];
  /** Операции, которым надо поставить ссылку на дату плана. */
  links: { txId: string; markerId: string }[];
  /** Действия, которые можно снять с очереди после отправки. */
  doneIds: string[];
}

/**
 * Собрать отправку из очереди.
 *
 * - «Факт»: дата плана становится `processed`, ТОЛЬКО если сама операция
 *   уезжает этим же запросом (`readyDraftIds`) или уже в облаке. Иначе дата
 *   закрылась бы без операции — план пропал, а факта нет. Черновик ещё ждёт
 *   (не собрался) — действие остаётся в очереди; черновик удалили — снимаем.
 * - «Связать»: операция должна быть в облаке и живой — или уезжать этим же
 *   запросом свежим черновиком.
 * - Правки: уходят только изменившиеся даты и правила.
 * - Даты, которой в кэше уже нет (закрыта или удалена где-то ещё), —
 *   намерение исполнено или бессмысленно, действие снимается.
 */
export function buildPlanPush(
  actions: PlanAction[],
  markers: ZenReminderMarker[],
  reminders: ZenReminder[],
  opts: {
    liveTxIds: Set<string>;
    readyDraftIds: Set<string>;
    pendingDraftIds: Set<string>;
    instrumentOf: (account: string) => number | undefined;
  },
  stampSeconds: number
): PlanPush {
  const byId = new Map(markers.map((m) => [m.id, m]));
  const doneIds: string[] = [];
  const kept: PlanAction[] = [];
  const links: PlanPush["links"] = [];
  for (const a of actions) {
    if (!byId.has(a.markerId)) {
      doneIds.push(a.markerId);
      continue;
    }
    if (a.kind === "fact") {
      if (opts.readyDraftIds.has(a.txId) || opts.liveTxIds.has(a.txId)) {
        kept.push(a);
        doneIds.push(a.markerId);
      } else if (!opts.pendingDraftIds.has(a.txId)) {
        doneIds.push(a.markerId);
      }
      continue;
    }
    if (a.kind === "link") {
      // Операция может быть и свежим черновиком: тогда ссылка встаёт в него,
      // и он уезжает этим же запросом. Черновик ещё не собрался — ждём.
      if (opts.liveTxIds.has(a.txId) || opts.readyDraftIds.has(a.txId)) {
        kept.push(a);
        links.push({ txId: a.txId, markerId: a.markerId });
        doneIds.push(a.markerId);
      } else if (!opts.pendingDraftIds.has(a.txId)) {
        doneIds.push(a.markerId);
      }
      continue;
    }
    kept.push(a);
    doneIds.push(a.markerId);
  }

  const overlay = applyPlanActions(markers, reminders, kept, opts.instrumentOf);
  const outMarkers: ZenReminderMarker[] = [];
  for (const id of overlay.processed) {
    const m = byId.get(id);
    if (m) outMarkers.push({ ...m, state: "processed", changed: stampSeconds });
  }
  for (const m of overlay.markers) {
    const orig = byId.get(m.id);
    if (orig && differs(orig, m)) outMarkers.push({ ...m, changed: stampSeconds });
  }
  const remById = new Map(reminders.map((r) => [r.id, r]));
  const outReminders: ZenReminder[] = [];
  for (const r of overlay.reminders) {
    const orig = remById.get(r.id);
    if (orig && differs(orig, r)) outReminders.push({ ...r, changed: stampSeconds });
  }
  return { markers: outMarkers, reminders: outReminders, links, doneIds };
}

/**
 * Похожие на план операции — кандидаты для «Связать план с фактом».
 *
 * Того же вида, ещё не связанные ни с каким планом, от двух недель до плана и
 * до сегодня. Из них — только правда похожие, хотя бы по одному признаку:
 *
 *   • тот же контрагент;
 *   • та же категория (или её родитель) и сумма не дальше чем вполовину от
 *     плановой — подписка на 199 ₽ не спутается с годовой за 4 700 ₽;
 *   • тот же счёт и сумма в пределах ±10 % — если категорию у факта не
 *     поставили или поставили другую.
 *
 * Раньше в список шло всё того же вида за месяц, и рядом с подпиской стояли
 * туалетная бумага и пополнение телефона (30.09.2026). С поиском (`loose`)
 * признаки не нужны: человек сам ищет нужную операцию.
 */
export interface LinkCandidateInput {
  id: string;
  date: string;
  kind: string;
  amount: number;
  category: string;
  account: string;
  payee?: string;
  linked: boolean;
}

export function linkCandidates<T extends LinkCandidateInput>(
  plan: { date: string; kind: string; amount: number; category: string; account: string; payee?: string },
  txs: T[],
  today: string,
  limit = 40,
  loose = false
): T[] {
  const dayMs = 86_400_000;
  const planT = Date.parse(plan.date);
  const from = new Date(planT - 14 * dayMs).toISOString().slice(0, 10);
  const to = plan.date > today ? plan.date : today;
  const planKind = plan.kind === "income" ? ["income", "refund"] : [plan.kind];
  const parent = (c: string) => c.split(" / ")[0];
  const norm = (s?: string) => (s ?? "").trim().toLowerCase();
  const scored: { t: T; score: number }[] = [];
  for (const t of txs) {
    if (t.linked || !planKind.includes(t.kind)) continue;
    if (t.date < from || t.date > to) continue;
    const days = Math.abs(Date.parse(t.date) - planT) / dayMs;
    const diff = plan.amount > 0 ? Math.abs(t.amount - plan.amount) / plan.amount : 1;
    const samePayee = !!norm(plan.payee) && norm(t.payee) === norm(plan.payee);
    const sameCat = !!plan.category && t.category === plan.category;
    const sameParent = !!plan.category && parent(t.category) === parent(plan.category);
    const sameAccount = t.account === plan.account;
    const similar =
      samePayee || ((sameCat || sameParent) && diff <= 0.5) || (sameAccount && diff <= 0.1);
    if (!loose && !similar) continue;
    let score = 0;
    if (samePayee) score += 3;
    if (sameCat) score += 3;
    else if (sameParent) score += 1.5;
    if (sameAccount) score += 1;
    score += Math.max(0, 2 - diff * 4); // ±10% ≈ +1,6; вдвое больше — 0
    score += Math.max(0, 1.5 - days / 7); // неделя разницы — почти ноль
    scored.push({ t, score });
  }
  return scored
    .sort((x, y) => y.score - x.score || y.t.date.localeCompare(x.t.date))
    .slice(0, limit)
    .map((x) => x.t);
}
