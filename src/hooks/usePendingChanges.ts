// Everything that is waiting to be pushed to Дзен-мани, counted in ONE place.
//
// Before this, the settings page computed the queue inline while the editors
// and the header each had their own idea of «есть что отправлять». That drifts:
// dictionary edits were once missing from the headline count and read as «нет
// изменений для отправки» while the push happily sent them (issue #50).
//
// Buckets mirror the push flow: operations (edits / drafts / deletions) and
// dictionaries (categories / counterparties). Budgets («Планы») ride the same
// push but are edited in their own grid with instant undo, so they stay out of
// the review list — `total` here is what the review modal can actually show.

import { useMemo } from "react";
import { useDataStore } from "../store/useDataStore";
import { useEditsStore } from "../store/useEditsStore";
import { useDraftsStore } from "../store/useDraftsStore";
import { useDeletedStore } from "../store/useDeletedStore";
import { useTagEditsStore } from "../store/useTagEditsStore";
import { useNewCategoriesStore } from "../store/useNewCategoriesStore";
import { useTagDeletionsStore } from "../store/useTagDeletionsStore";
import { useAccountEditsStore } from "../store/useAccountEditsStore";
import { usePlannedDeletionsStore } from "../store/usePlannedDeletionsStore";
import {
  useCounterpartyEditsStore,
  countCounterpartyPending,
} from "../store/useCounterpartyEditsStore";

export interface PendingChanges {
  /** Edited operations. */
  edits: number;
  /** Locally-created operations not yet in the cloud. */
  drafts: number;
  /** Locally-deleted operations still present in the cloud cache. */
  deleted: number;
  /** Category edits + creations + deletions. */
  categories: number;
  /** Counterparty renames + creations + deletions + merges. */
  counterparties: number;
  /** Правки счетов. */
  accounts: number;
  /** Просроченные запланированные операции, снятые вручную (issue #71). */
  plans: number;
  /** Operations subtotal — what the rollback list has always covered. */
  operations: number;
  /** Dictionaries subtotal. */
  dictionaries: number;
  /** Everything the «Отправить в облако» button would send. */
  total: number;
}

export function usePendingChanges(): PendingChanges {
  const edits = useEditsStore((s) => s.edits);
  const drafts = useDraftsStore((s) => s.drafts);
  const deletedIds = useDeletedStore((s) => s.deletedIds);
  const transactionsRaw = useDataStore((s) => s.transactionsRaw);

  const tagEdits = useTagEditsStore((s) => s.edits);
  const newCats = useNewCategoriesStore((s) => s.items);
  const tagDeletions = useTagDeletionsStore((s) => s.deletions);
  const accEdits = useAccountEditsStore((s) => s.edits);
  const renames = useCounterpartyEditsStore((s) => s.renames);
  const created = useCounterpartyEditsStore((s) => s.created);
  const cpDeleted = useCounterpartyEditsStore((s) => s.deleted);
  const merges = useCounterpartyEditsStore((s) => s.merges);
  const plannedDeletions = usePlannedDeletionsStore((s) => s.deletions);

  // Count ONLY deletions still backed by a cloud row: once pushed, the row
  // leaves `transactionsRaw` but its id lingers in `deletedIds` as a permanent
  // tombstone — counting the raw set overstated the queue.
  const deleted = useMemo(() => {
    if (deletedIds.length === 0) return 0;
    const live = new Set(transactionsRaw.map((t) => t.id));
    return deletedIds.reduce((n, id) => n + (live.has(id) ? 1 : 0), 0);
  }, [deletedIds, transactionsRaw]);

  return useMemo(() => {
    const e = Object.keys(edits).length;
    const d = Object.keys(drafts).length;
    const categories =
      Object.keys(tagEdits).length +
      newCats.length +
      Object.keys(tagDeletions).length;
    const accounts = Object.keys(accEdits).length;
    const counterparties = countCounterpartyPending({
      renames,
      created,
      deleted: cpDeleted,
      merges,
    });
    const plans = Object.keys(plannedDeletions).length;
    const operations = e + d + deleted;
    // Удаление просроченного плана — такое же справочное изменение, как
    // удаление категории: своя строка в списке, свой откат.
    const dictionaries = categories + counterparties + accounts + plans;
    return {
      edits: e,
      drafts: d,
      deleted,
      categories,
      counterparties,
      accounts,
      plans,
      operations,
      dictionaries,
      total: operations + dictionaries,
    };
  }, [
    edits,
    drafts,
    deleted,
    tagEdits,
    newCats,
    tagDeletions,
    accEdits,
    renames,
    created,
    cpDeleted,
    merges,
    plannedDeletions,
  ]);
}
