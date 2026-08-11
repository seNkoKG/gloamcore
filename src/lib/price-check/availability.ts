export type PriceCheckAvailability = "available" | "securable" | "any";

const AVAILABILITY_ORDER: readonly PriceCheckAvailability[] = [
  "available",
  "securable",
  "any",
];

/**
 * Current official Trade availability modes used by the compact checker.
 * `available` includes both instant-buyout and in-person offers, while
 * `securable` is the official instant-buyout-only mode.
 */
export function normalizePriceCheckAvailability(
  value: unknown,
): PriceCheckAvailability {
  if (value === "securable" || value === "any") return value;
  // Older app sessions used `online`, which excludes instant-buyout
  // offers in the current official schema. Upgrade those sessions safely.
  return "available";
}

export function nextPriceCheckAvailability(
  value: unknown,
): PriceCheckAvailability {
  const current = normalizePriceCheckAvailability(value);
  const index = AVAILABILITY_ORDER.indexOf(current);
  return AVAILABILITY_ORDER[(index + 1) % AVAILABILITY_ORDER.length];
}

export function priceCheckAvailabilityLabel(value: unknown) {
  const current = normalizePriceCheckAvailability(value);
  if (current === "securable") return "INSTANT";
  if (current === "any") return "ALL";
  return "AVAILABLE";
}

export function priceCheckAvailabilityDescription(value: unknown) {
  const current = normalizePriceCheckAvailability(value);
  if (current === "securable") return "Instant-buyout listings only";
  if (current === "any") return "Online and offline listings";
  return "All currently available instant-buyout and in-person listings";
}
