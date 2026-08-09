import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parsePoeItem } from "../lib/price-check/parser";
import { chartFixture } from "../lib/price-check/fixtures/parser-fixtures";
import {
  buildPriceCheckQueryPlan,
  defaultActivePriceCheckItemFilters,
  priceCheckItemFilterControls,
} from "../lib/price-check/query-plan";
import type { ParsedPoeItem, PriceCheckSession } from "../lib/price-check/types";
import { CompactRareModifierEditor } from "./CompactRareModifierEditor";
import { PriceCheckPanel } from "./PriceCheckPanel";

const scryingFixture = `Item Class: Stackable Currency
Rarity: Currency
Scrying Orb
--------
Map Area: Undersea Groves`;

function renderDashboard(session: PriceCheckSession) {
  return renderToStaticMarkup(
    <PriceCheckPanel
      session={session}
      mode="exact"
      rollTolerance={10}
      availability="available"
      hotkey="CommandOrControl+D"
      onCaptureRequested={() => undefined}
      onRetry={() => undefined}
      onModeChange={() => undefined}
      onMatchSelect={() => undefined}
      onModifierChange={() => undefined}
      onItemFilterChange={() => undefined}
      onRollToleranceChange={() => undefined}
      onAvailabilityChange={() => undefined}
      onOpenTrade={() => undefined}
      onCopySummary={async () => true}
    />,
  );
}

function magicItem(itemClass: string, baseType: string): ParsedPoeItem {
  return {
    ...parsePoeItem(`Item Class: ${itemClass}
Rarity: Magic
Shimmering ${baseType} of the Order
${baseType}
--------
Item Level: 86`),
    rarity: "magic",
  };
}

describe("APT item-state control parity", () => {
  it("renders all Chart Pseudo rows in the compact and dashboard editors", () => {
    const item = parsePoeItem(chartFixture.replace(
      "Item Quantity: +64% (augmented)",
      "Item Quantity: +64% (augmented)\nItem Rarity: +30% (augmented)\nMonster Pack Size: +20% (augmented)",
    ));
    const query = buildPriceCheckQueryPlan(item, "Allflame", { mode: "exact" });
    const compact = renderToStaticMarkup(
      <CompactRareModifierEditor
        item={item}
        filters={query.filters}
        itemFilters={query.itemFilters}
        exactItemFilters
        onModifierChange={() => undefined}
        onItemFilterChange={() => undefined}
      />,
    );
    const dashboard = renderDashboard({
      id: "chart-controls",
      capturedAt: 42,
      league: "Allflame",
      status: "ready",
      item,
      matches: [],
      estimate: null,
      query,
      sourceStale: false,
    });

    for (const markup of [compact, dashboard]) {
      expect(markup).toContain("Item Quantity: 64%");
      expect(markup).toContain("Item Rarity: 30%");
      expect(markup).toContain("Monster Pack Size: 20%");
      expect(markup).toContain("Dead Man&#x27;s Sulphur: 60%");
      expect(markup).toContain("4/4");
    }
  });

  it("hides but retains the Chart sub identity while the exact parent is selected", () => {
    const item = parsePoeItem(chartFixture);
    const initial = buildPriceCheckQueryPlan(item, "Allflame", { mode: "exact" });
    const exact = buildPriceCheckQueryPlan(item, "Allflame", {
      mode: "exact",
      itemFilters: {
        ...initial.itemFilters,
        identityRelaxed: false,
      },
    });
    expect(exact.itemFilters).toMatchObject({
      identityRelaxed: false,
      identitySub: true,
    });
    expect(priceCheckItemFilterControls(item, {
      exact: true,
      mode: "exact",
      itemFilters: exact.itemFilters,
    }).map((control) => control.key)).not.toContain("identitySub");

    const compact = renderToStaticMarkup(
      <CompactRareModifierEditor
        item={item}
        filters={exact.filters}
        itemFilters={exact.itemFilters}
        exactItemFilters
        onModifierChange={() => undefined}
        onItemFilterChange={() => undefined}
      />,
    );
    expect(compact).toContain("Coral Forest Chart");
    expect(compact).not.toContain("Undersea Groves identity");
    expect(compact).toContain('aria-label="Use coral forest chart identity"');
    expect(compact).not.toContain('aria-label="Use coral forest chart identity" checked');

    const restored = buildPriceCheckQueryPlan(item, "Allflame", {
      mode: "exact",
      itemFilters: {
        ...exact.itemFilters,
        identityRelaxed: true,
      },
    });
    expect(restored.itemFilters.identitySub).toBe(true);
    expect(restored.tradeQuery).toEqual(initial.tradeQuery);
  });

  it("renders the same read-only Scrying identity in compact and dashboard", () => {
    const item = parsePoeItem(scryingFixture);
    const query = buildPriceCheckQueryPlan(item, "Allflame", { mode: "exact" });
    const compact = renderToStaticMarkup(
      <CompactRareModifierEditor
        item={item}
        filters={query.filters}
        itemFilters={query.itemFilters}
        exactItemFilters
        onModifierChange={() => undefined}
        onItemFilterChange={() => undefined}
      />,
    );
    const session: PriceCheckSession = {
      id: "scrying-state",
      capturedAt: 42,
      league: "Allflame",
      status: "ready",
      item,
      matches: [],
      estimate: null,
      query,
      sourceStale: false,
    };
    const dashboard = renderDashboard(session);

    for (const markup of [compact, dashboard]) {
      expect(markup).toContain("SCRYING");
      expect(markup).toContain("Undersea Groves");
      expect(markup).toContain("is-readonly");
    }
    expect(compact).not.toContain("Use scrying filter");
    expect(dashboard).not.toContain('type="checkbox" checked=""');
  });

  it("exposes read-only reward and Blight identities as typed controls", () => {
    const item = {
      ...magicItem("Maps", "Dunes Map"),
      mapTier: 16,
      mapCompletionReward: "The Squire",
      scryingMapArea: "Undersea Groves",
      mapBlighted: "Blight-ravaged" as const,
      properties: { "Area Level": "83" },
    };
    const controls = priceCheckItemFilterControls(item, { exact: true });
    const strings = controls.filter((control) => control.kind === "string");

    expect(strings).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "mapCompletionReward", readonly: true }),
      expect.objectContaining({ key: "scryingMapArea", readonly: true }),
      expect.objectContaining({ key: "mapBlighted", readonly: true }),
    ]));
    expect(controls.map((control) => control.key)).toEqual([
      "mapTier",
      "mapCompletionReward",
      "scryingMapArea",
      "areaLevel",
      "mapBlighted",
      "corrupted",
    ]);
  });

  it("activates Magic for Adorned Jewel searches and leaves eligible exact bases optional", () => {
    const jewel = magicItem("Jewels", "Cobalt Jewel");
    const wand = magicItem("Wands", "Imbued Wand");
    const flask = magicItem("Utility Flasks", "Ruby Flask");

    expect(priceCheckItemFilterControls(jewel).find((control) =>
      control.key === "rarity"
    )).toMatchObject({ kind: "string", copiedValue: "magic" });
    expect(defaultActivePriceCheckItemFilters(jewel).rarity).toBe("magic");
    expect(
      (buildPriceCheckQueryPlan(jewel, "Allflame", { mode: "similar" })
        .tradeQuery.query as any).filters.type_filters.filters.rarity,
    ).toEqual({ option: "magic" });

    expect(priceCheckItemFilterControls(wand)).not.toContainEqual(
      expect.objectContaining({ key: "rarity" }),
    );
    expect(priceCheckItemFilterControls(wand, { exact: true })).toContainEqual(
      expect.objectContaining({
        key: "rarity",
        kind: "string",
        copiedValue: "magic",
      }),
    );
    expect(defaultActivePriceCheckItemFilters(wand, { exact: true }))
      .not.toHaveProperty("rarity");
    expect(
      (buildPriceCheckQueryPlan(wand, "Allflame", { mode: "base" })
        .tradeQuery.query as any).filters.type_filters.filters.rarity,
    ).toEqual({ option: "nonunique" });
    expect(priceCheckItemFilterControls(flask, { exact: true }))
      .not.toContainEqual(expect.objectContaining({ key: "rarity" }));
  });
});
