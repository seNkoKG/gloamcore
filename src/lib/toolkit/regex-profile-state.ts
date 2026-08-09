import type { RegexEntryMode } from "./poe-regex";
import type { RegexDataCategory } from "./regex-data";

export function pruneRegexSelections(
  selections: Record<string, Record<string, RegexEntryMode>>,
  categories: readonly RegexDataCategory[],
) {
  const categoryIndex = new Map(categories.map((category) => [category.id, category]));
  const next: Record<string, Record<string, RegexEntryMode>> = {};
  let removed = 0;

  for (const [categoryId, categorySelections] of Object.entries(selections)) {
    const category = categoryIndex.get(categoryId);
    if (!category) {
      removed += Object.keys(categorySelections).length;
      continue;
    }
    const validIds = new Set(category.entries.map((entry) => entry.entryId));
    const kept: Record<string, RegexEntryMode> = {};
    for (const [entryId, mode] of Object.entries(categorySelections)) {
      const supported = validIds.has(entryId) &&
        (mode !== "avoid" || category.search.supportsAvoid) &&
        (mode !== "want" || category.search.supportsWant);
      if (supported) kept[entryId] = mode;
      else removed += 1;
    }
    if (Object.keys(kept).length) next[categoryId] = kept;
  }

  return { selections: next, removed };
}
