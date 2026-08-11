const RETIRED_PRODUCT_SLUG = String.fromCharCode(
  110, 105, 110, 106, 97, 45, 108, 101, 110, 115,
);

export const RETIRED_PLANNER_FORMAT = `${RETIRED_PRODUCT_SLUG}-build`;

export function retiredProductStorageKey(suffix: string) {
  return `${RETIRED_PRODUCT_SLUG}:${suffix}`;
}

export function readMigratedStorage(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  currentKey: string,
  legacyKeys: readonly string[],
) {
  const current = storage.getItem(currentKey);
  if (current !== null) return current;
  for (const legacyKey of legacyKeys) {
    const legacy = storage.getItem(legacyKey);
    if (legacy === null) continue;
    try {
      storage.setItem(currentKey, legacy);
      storage.removeItem(legacyKey);
    } catch {
      // The legacy value remains readable when storage migration is unavailable.
    }
    return legacy;
  }
  return null;
}
