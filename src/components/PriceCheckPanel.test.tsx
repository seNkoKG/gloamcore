import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import actualCatalog from "../../public/data/price-check/stats-v1.json";
import {
  aptAdvancedRareBodyArmourFixture,
  chronicleFixture,
  influencedStatusFixture,
  lethalPrideKaomAdvancedFixture,
  mapFixture,
  rareDefenceFixture,
  rareWeaponFixture,
  uniqueFixture,
  unquotedFlavourUniqueFixture,
  watcherEyeAdvancedFixture,
  watcherEyeFixture,
} from "../lib/price-check/fixtures/parser-fixtures";
import { parsePoeItem } from "../lib/price-check/parser";
import { buildPriceCheckQueryPlan } from "../lib/price-check/query-plan";
import {
  applyTradeStatCatalog,
  type TradeStatCatalogPack,
} from "../lib/price-check/stat-catalog";
import type {
  PriceCheckDashboardMode,
  PriceCheckSession,
} from "../lib/price-check/types";
import {
  dashboardModifierEditPatch,
  PriceCheckPanel,
} from "./PriceCheckPanel";

function sessionFor(rawText: string): PriceCheckSession {
  const item = applyTradeStatCatalog(
    parsePoeItem(rawText),
    actualCatalog as TradeStatCatalogPack,
  );
  return {
    id: "details-test",
    capturedAt: Date.now(),
    league: "Allflame",
    status: "ready",
    item,
    matches: [],
    estimate: null,
    query: buildPriceCheckQueryPlan(item, "Allflame"),
    sourceStale: false,
  };
}

function renderDetails(
  session: PriceCheckSession,
  mode: PriceCheckDashboardMode = "similar",
  showAdvanced = true,
) {
  return renderToStaticMarkup(
    <PriceCheckPanel
      session={session}
      mode={mode}
      rollTolerance={10}
      availability="available"
      hotkey="CommandOrControl+D"
      showAdvanced={showAdvanced}
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

describe("detailed price-check controls", () => {
  it("does not leave modifier-priced rare items in a permanent loading state", () => {
    const session = sessionFor(rareWeaponFixture);
    session.estimate = {
      chaosValue: null,
      divineValue: null,
      lowChaos: null,
      highChaos: null,
      confidence: "none",
      confidenceScore: 0,
      label: "no reliable estimate",
      reasons: ["Rolled rare and magic items require modifier-level comparison."],
      warnings: ["Verify current listings on the official Trade page."],
      evidence: [],
    };
    const markup = renderDetails(session);

    expect(markup).toContain("No reliable price");
    expect(markup).toContain("NO MATCH");
    expect(markup).toContain("Verify current listings on the official Trade page.");
    expect(markup).toContain("Trade filters ready");
    expect(markup).toContain("Open Trade");
    expect(markup).toContain("Refresh");
    expect(markup).not.toContain("Loading market reference...");
    expect(markup).not.toContain("No update time");
  });

  it("shows only the contextual Awakened presets for each item", () => {
    const uniqueTabs = renderDetails(sessionFor(uniqueFixture)).match(
      /<div class="pc-mode-tabs"[\s\S]*?<\/div>/,
    )?.[0] || "";
    const mapTabs = renderDetails(sessionFor(mapFixture)).match(
      /<div class="pc-mode-tabs"[\s\S]*?<\/div>/,
    )?.[0] || "";
    const craftingTabs = renderDetails(sessionFor(rareDefenceFixture)).match(
      /<div class="pc-mode-tabs"[\s\S]*?<\/div>/,
    )?.[0] || "";

    expect(uniqueTabs).toContain("Similar");
    expect(uniqueTabs).not.toContain("Exact");
    expect(uniqueTabs).not.toContain("Base");
    expect(mapTabs).toContain("Exact");
    expect(mapTabs).toContain("Bulk");
    expect(mapTabs).not.toContain("Similar");
    expect(craftingTabs).toContain("Similar");
    expect(craftingTabs).toContain("Base");
    expect(craftingTabs).not.toContain("Exact");
  });

  it("labels a normal map's sole APT preset as Bulk", () => {
    const session = sessionFor(mapFixture);
    session.item = { ...session.item!, rarity: "normal" };
    session.query = buildPriceCheckQueryPlan(session.item, "Allflame", {
      mode: "bulk",
    });
    const tabs = renderDetails(session, "bulk").match(
      /<div class="pc-mode-tabs"[\s\S]*?<\/div>/,
    )?.[0] || "";

    expect(tabs).toContain("Bulk");
    expect(tabs).not.toContain("Exact");
    expect(tabs).toContain('aria-pressed="true"');
  });

  it("keeps local refresh separate from the official Trade browser handoff", () => {
    const session = sessionFor(uniqueFixture);
    const markup = renderDetails(session);

    expect(markup).toContain("Open Trade");
    expect(markup).toContain("Refresh");
    expect(markup).not.toContain("Search Trade");
  });

  it("shows calculated weapon inputs without inventing slider bounds", () => {
    const markup = renderDetails(sessionFor(rareWeaponFixture));

    expect(markup).toContain("Search filters");
    expect(markup).toContain('aria-label="Include Total DPS: 322 in the filter plan"');
    expect(markup).toContain('aria-label="Include Physical DPS: 225 in the filter plan"');
    expect(markup).toContain('aria-label="Minimum value for Total DPS: 322"');
    expect(markup).not.toContain('aria-label="Minimum slider for Total DPS: 322"');
    expect(markup).not.toContain('class="pc-equipment-property-slider"');
    expect(markup).not.toContain("property:weapon-dps</strong>");
  });

  it("keeps the complete plan count stable when hidden filters are toggled", () => {
    const session = sessionFor(rareWeaponFixture);
    const visible = session.query!.filters[0];
    session.query = {
      ...session.query!,
      filters: [
        { ...visible, enabled: true },
        {
          modifierId: "special:empty-or-crafted-modifier",
          label: "1 EMPTY OR CRAFTED SUFFIX",
          enabled: true,
          mode: "presence",
          emptyModifier: 2,
          advancedOnly: true,
          importance: "optional",
          explanation: "Awakened empty-or-crafted affix selector.",
        },
      ],
    };

    const hiddenMarkup = renderDetails(session, "similar", false);
    const advancedMarkup = renderDetails(session, "similar", true);
    expect(hiddenMarkup).toContain("2/2");
    expect(advancedMarkup).toContain("2/2");
    expect(hiddenMarkup).not.toContain("1 EMPTY OR CRAFTED SUFFIX");
    expect(advancedMarkup).toContain("1 EMPTY OR CRAFTED SUFFIX");
  });

  it.each([
    ["rare", aptAdvancedRareBodyArmourFixture, false],
    ["unique", unquotedFlavourUniqueFixture, true],
  ])("keeps unchecked %s rolls editable and only uses proven slider bounds", (
    _,
    fixture,
    hasSliderBounds,
  ) => {
    const session = sessionFor(fixture);
    const editable = session.query!.filters.find((filter) =>
      hasSliderBounds
        ? Number.isFinite(filter.bounds?.min) &&
          Number.isFinite(filter.bounds?.max) &&
          filter.bounds!.max > filter.bounds!.min
        : filter.mode !== "presence" &&
          (Number.isFinite(filter.copiedValue) || Number.isFinite(filter.min))
    )!;
    expect(editable).toBeTruthy();
    session.query = {
      ...session.query!,
      filters: session.query!.filters.map((filter) =>
        filter.modifierId === editable.modifierId
          ? { ...filter, enabled: false }
          : filter
      ),
    };
    const modifier = session.item!.modifiers.find(
      (candidate) => candidate.id === editable.modifierId,
    );
    const label = editable.label || modifier?.text || editable.modifierId;
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const markup = renderDetails(session);
    const valueInput = markup.match(
      new RegExp(`<input[^>]+aria-label="Minimum value for ${escapedLabel}"[^>]*>`),
    )?.[0];
    const slider = markup.match(
      new RegExp(`<input[^>]+aria-label="Minimum slider for ${escapedLabel}"[^>]*>`),
    )?.[0];

    expect(valueInput).toBeTruthy();
    expect(valueInput).not.toContain("disabled");
    if (hasSliderBounds) {
      expect(slider).toBeTruthy();
      expect(slider).not.toContain("disabled");
      expect(slider).toContain(`min="${editable.bounds!.min}"`);
      expect(slider).toContain(`max="${editable.bounds!.max}"`);
    } else {
      expect(slider).toBeUndefined();
    }
  });

  it("auto-enables an unchecked dashboard stat in its first edit patch", () => {
    expect(dashboardModifierEditPatch(false, { min: 12 })).toEqual({
      enabled: true,
      min: 12,
    });
    expect(dashboardModifierEditPatch(true, { max: 18 })).toEqual({ max: 18 });
  });

  it("matches Awakened by omitting unusable obstructed Chronicle rooms", () => {
    const markup = renderDetails(sessionFor(chronicleFixture));

    expect(markup).toContain("5/6");
    expect(markup.match(/aria-label="Include /g)).toHaveLength(6);
    expect(markup.match(/OPEN ROOM/g)).toHaveLength(6);
    expect(markup).not.toContain("OBSTRUCTED ROOM");
    expect(markup).toContain("Apex of Atzoatl presence only");
    expect(markup).not.toContain("Museum of Artefacts (Tier 3) presence only");
  });

  it("exposes the copied veiled state as a removable detailed item filter", () => {
    const markup = renderDetails(sessionFor(influencedStatusFixture));

    expect(markup).toContain("<strong>VEILED</strong>");
  });

  it("shows all Watcher's Eye rolls while selecting the two aura effects", () => {
    const markup = renderDetails(sessionFor(watcherEyeAdvancedFixture));

    expect(markup.match(/aria-label="Include /g)).toHaveLength(6);
    expect(markup).toContain(
      'aria-label="Include 10 total to all Attributes in the filter plan"',
    );
    expect(markup).toContain(
      'aria-label="Include 25% to Critical Strike Multiplier while affected by Precision in the filter plan"',
    );
    expect(markup).toContain(
      'aria-label="Include Gain 15% of Physical Damage as Extra Fire Damage while affected by Anger in the filter plan"',
    );
    expect(markup).toContain("2/6");
    expect(markup).not.toContain("Uncorrupted");
    expect(markup).not.toContain(">Corrupted<");
    expect(markup).not.toContain("Not Foulborn");
  });

  it("does not expose the hidden corruption policy for corrupted items", () => {
    const session = sessionFor(watcherEyeFixture);
    const item = { ...session.item!, corrupted: true };
    session.item = item;
    session.query = buildPriceCheckQueryPlan(item, session.league);
    const markup = renderDetails(session);

    expect(session.query.itemFilters.corrupted).toBe(true);
    expect(markup).not.toContain("Uncorrupted");
    expect(markup).not.toContain("<strong>Corrupted</strong>");
  });

  it("renders the Timeless Jewel seed as an enabled, exact, directly editable value", () => {
    const markup = renderDetails(sessionFor(lethalPrideKaomAdvancedFixture));
    const seedLabel = "Commanded leadership over 12476 warriors under Kaom\n" +
      "Passives in radius are Conquered by the Karui";
    const escapedSeedLabel = seedLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const exactInput = markup.match(
      new RegExp(`<input[^>]+aria-label="Exact value for ${escapedSeedLabel}"[^>]*>`),
    )?.[0];

    expect(markup).toContain(
      `aria-label="Include ${seedLabel} in the filter plan"`,
    );
    expect(markup).toContain("1/1");
    expect(exactInput).toBeTruthy();
    expect(exactInput).toContain('value="12476"');
    expect(exactInput).not.toContain("disabled");
    expect(markup).not.toContain("Historic presence only");
    expect(markup).not.toContain("They believed themselves");
  });

  it("renders adversarial value-less notable state as PRESENT only", () => {
    const session = sessionFor(watcherEyeFixture);
    const label = "1 Added Passive Skill is Blanketed Snow";
    const modifier = {
      id: "ui-value-less-notable",
      kind: "explicit" as const,
      text: label,
      normalizedText: "1 Added Passive Skill is #",
      values: [],
      selectedByDefault: true,
      tags: [],
      advanced: true,
      tradeId: "explicit.stat_1085167979",
    };
    session.item = { ...session.item!, modifiers: [modifier] };
    session.query = {
      ...session.query!,
      filters: [{
        modifierId: modifier.id,
        tradeId: modifier.tradeId,
        enabled: true,
        mode: "range",
        min: 998,
        max: 999,
        importance: "key",
        explanation: "Value-less official stat",
      }],
    };
    const markup = renderDetails(session);
    const modeSelect = markup.match(
      new RegExp(
        `<select[^>]+aria-label="Match mode for ${label}"[^>]*>[\\s\\S]*?</select>`,
      ),
    )?.[0];

    expect(modeSelect).toBeTruthy();
    expect(modeSelect).toContain("disabled");
    expect(modeSelect).toContain('<option value="presence" selected="">Present</option>');
    expect(modeSelect).not.toContain('<option value="range"');
    expect(modeSelect).not.toContain('<option value="exact"');
    expect(markup).toContain(`${label} presence only`);
    expect(markup).not.toContain(`Minimum value for ${label}`);
    expect(markup).not.toContain(`Exact value for ${label}`);
  });

  it("keeps a numeric pipe-qualified selector stat editable as a range", () => {
    const session = sessionFor(watcherEyeAdvancedFixture);
    const label = "40% increased Effect for the selected variant";
    const modifierId = "numeric-selector-roll";
    session.item = {
      ...session.item!,
      modifiers: [{
        id: modifierId,
        kind: "explicit",
        text: label,
        normalizedText: "#% increased effect for the selected variant",
        values: [40],
        selectedByDefault: true,
        tags: [],
        advanced: true,
        tradeId: "explicit.stat_4089743927|4|126",
      }],
    };
    session.query = {
      ...session.query!,
      filters: [{
        modifierId,
        tradeId: "explicit.stat_4089743927|4|126",
        enabled: true,
        mode: "range",
        min: 35,
        max: 45,
        bounds: { min: 30, max: 50 },
        importance: "key",
        explanation: "Numeric selector roll",
      }],
    };
    const markup = renderDetails(session);
    const modeSelect = markup.match(
      new RegExp(`<select[^>]+aria-label="Match mode for ${label}"[^>]*>`),
    )?.[0];

    expect(modeSelect).toBeTruthy();
    expect(modeSelect).not.toContain("disabled");
    expect(markup).toContain('<option value="range" selected="">Range</option>');
    expect(markup).toContain(`aria-label="Minimum value for ${label}"`);
    expect(markup).toContain(`aria-label="Maximum value for ${label}"`);
    expect(markup).not.toContain(`${label} presence only`);
  });

});
