// The category hierarchy as a pair of option lists for the operation editors.
//
// Built from the Zenmoney TAG DICTIONARY, not from the operations: a category
// you just created has no operations yet, so a dataset-derived list would not
// offer it — you could create a category in Справочники and then be unable to
// put anything in it. Falls back to nothing in CSV mode (no tag cache), where
// the caller's dataset-derived list is the only source.

import { useEffect, useState } from "react";
import {
  getCategoryTagsFromCache,
  useZenmoneyStore,
  type CategoryTag,
} from "../store/useZenmoneyStore";

export interface CategoryDictionary {
  /** Top-level category titles. */
  roots: string[];
  /** Root title → its subcategory titles. */
  subsByRoot: Map<string, string[]>;
}

const EMPTY: CategoryDictionary = { roots: [], subsByRoot: new Map() };

export function useCategoryDictionary(): CategoryDictionary {
  // Re-read after a sync so freshly-pulled (and freshly-pushed) tags show up.
  const serverTimestamp = useZenmoneyStore((s) => s.serverTimestamp);
  const [dict, setDict] = useState<CategoryDictionary>(EMPTY);

  useEffect(() => {
    let alive = true;
    getCategoryTagsFromCache().then((tags) => {
      if (!alive) return;
      setDict(tags ? build(tags) : EMPTY);
    });
    return () => {
      alive = false;
    };
  }, [serverTimestamp]);

  return dict;
}

function build(tags: CategoryTag[]): CategoryDictionary {
  const titleById = new Map(tags.map((t) => [t.id, t.title]));
  const roots: string[] = [];
  const subsByRoot = new Map<string, string[]>();
  for (const t of tags) {
    if (!t.parent) {
      roots.push(t.title);
      continue;
    }
    const parentTitle = titleById.get(t.parent);
    if (!parentTitle) continue; // orphan — no root to hang it under
    const arr = subsByRoot.get(parentTitle);
    if (arr) arr.push(t.title);
    else subsByRoot.set(parentTitle, [t.title]);
  }
  return { roots, subsByRoot };
}
