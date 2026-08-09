import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { unidentifiedWatcherEyeFixture } from "../lib/price-check/fixtures/parser-fixtures";
import { parsePoeItem } from "../lib/price-check/parser";
import { uniqueIdentityProfile } from "../lib/price-check/magic-base-type";
import {
  unidentifiedUniqueCandidates,
  UnidentifiedUniqueResolver,
} from "./UnidentifiedUniqueResolver";

describe("UnidentifiedUniqueResolver", () => {
  it("offers pinned unique identities for an ambiguous unidentified base", () => {
    const item = parsePoeItem(unidentifiedWatcherEyeFixture);
    const candidates = unidentifiedUniqueCandidates(item);

    expect(candidates.map((candidate) => candidate.name)).toContain("Watcher's Eye");
    expect(candidates.length).toBeGreaterThan(1);
    const markup = renderToStaticMarkup(
      <UnidentifiedUniqueResolver item={item} onIdentify={() => undefined} />,
    );
    expect(markup).toContain("WHICH PRISMATIC JEWEL?");
    expect(markup).toContain("Watcher&#x27;s Eye");
  });

  it("stays hidden after an identity has been selected", () => {
    const item = {
      ...parsePoeItem(unidentifiedWatcherEyeFixture),
      name: "Watcher's Eye",
    };
    expect(unidentifiedUniqueCandidates(item)).toEqual([]);
  });

  it("uses the copied base to choose the matching multi-base unique icon", () => {
    const item = {
      ...parsePoeItem(unidentifiedWatcherEyeFixture),
      name: "Viridian Jewel",
      baseType: "Viridian Jewel",
    };
    const combatFocus = unidentifiedUniqueCandidates(item)
      .find((candidate) => candidate.name === "Combat Focus");
    expect(combatFocus).toEqual(uniqueIdentityProfile("Combat Focus", item));
    expect(combatFocus?.baseType).toBe("Viridian Jewel");
    expect(combatFocus?.icon).toContain("ElementalHitLightening.png");
  });
});
