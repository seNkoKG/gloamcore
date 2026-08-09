import { describe, expect, it } from "vitest";
import {
  nextPriceCheckAvailability,
  normalizePriceCheckAvailability,
  priceCheckAvailabilityDescription,
  priceCheckAvailabilityLabel,
} from "./availability";

describe("official Trade availability controls", () => {
  it("upgrades the legacy online-only mode so instant-buyout offers are included", () => {
    expect(normalizePriceCheckAvailability("online")).toBe("available");
    expect(normalizePriceCheckAvailability(undefined)).toBe("available");
  });

  it("cycles all available, instant-only, and all listings", () => {
    expect(nextPriceCheckAvailability("available")).toBe("securable");
    expect(nextPriceCheckAvailability("securable")).toBe("any");
    expect(nextPriceCheckAvailability("any")).toBe("available");
  });

  it("uses concise overlay labels with unambiguous descriptions", () => {
    expect(priceCheckAvailabilityLabel("available")).toBe("AVAILABLE");
    expect(priceCheckAvailabilityLabel("securable")).toBe("INSTANT");
    expect(priceCheckAvailabilityLabel("any")).toBe("ALL");
    expect(priceCheckAvailabilityDescription("securable")).toMatch(/instant-buyout/i);
  });
});
