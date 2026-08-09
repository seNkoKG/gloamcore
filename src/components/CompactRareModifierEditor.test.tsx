import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import actualCatalog from "../../public/data/price-check/stats-v1.json";
import {
  chronicleFixture,
  gemFixture,
  lethalPrideKaomAdvancedFixture,
  rareDefenceFixture,
} from "../lib/price-check/fixtures/parser-fixtures";
import { planEquipmentPropertyFilters } from "../lib/price-check/equipment-properties";
import { parsePoeItem } from "../lib/price-check/parser";
import {
  defaultActivePriceCheckItemFilters,
  planModifierFilters,
} from "../lib/price-check/query-plan";
import {
  applyTradeStatCatalog,
  type TradeStatCatalogPack,
} from "../lib/price-check/stat-catalog";
import type {
  ParsedPoeItem,
  PriceCheckModifierFilter,
} from "../lib/price-check/types";
import {
  COMPACT_ITEM_STATE_ONE_ROW_HEIGHT,
  COMPACT_MODIFIER_RANGE_ROW_HEIGHT,
  COMPACT_MODIFIER_ROW_HEIGHT,
  CompactRareModifierEditor,
  compactModifierEditPatch,
  compactPriceCheckItemStateControlCount,
  compactPriceCheckItemStateRowCount,
  compactPriceCheckItemStateStripHeight,
  compactPriceCheckModifierRowsHeight,
  compactVisibleModifierFilters,
  deriveCompactSliderDomain,
} from "./CompactRareModifierEditor";

function rareItem(): ParsedPoeItem {
  return {
    rawText: "Item Class: Rings\nRarity: Rare\nRune Circle\nAmethyst Ring",
    language: "en",
    valid: true,
    itemClass: "Rings",
    rarity: "rare",
    name: "Rune Circle",
    baseType: "Amethyst Ring",
    itemLevel: 86,
    sockets: [{ colors: ["R", "G", "B"], links: 3 }],
    links: 3,
    influences: ["Shaper"],
    corrupted: false,
    mirrored: false,
    split: false,
    identified: true,
    fractured: false,
    synthesised: false,
    veiled: false,
    foil: false,
    foulborn: false,
    replica: false,
    scourged: false,
    properties: {},
    requirements: {},
    modifiers: [
      {
        id: "chaos-res",
        kind: "explicit",
        text: "+43% to Chaos Resistance",
        normalizedText: "+#% to Chaos Resistance",
        values: [43],
        selectedByDefault: true,
        tags: [],
        advanced: false,
      },
      {
        id: "mana-cost",
        kind: "crafted",
        text: "Non-Channeling Skills have -7 to Total Mana Cost",
        normalizedText: "Non-Channeling Skills have -# to Total Mana Cost",
        values: [-7],
        selectedByDefault: false,
        tags: [],
        advanced: false,
      },
    ],
    flavourText: [],
    reminderText: [],
    unknownSections: [],
    warnings: [],
    errors: [],
  };
}

function filters(): PriceCheckModifierFilter[] {
  return [
    {
      modifierId: "chaos-res",
      tradeId: "explicit.stat_2923486259",
      enabled: true,
      mode: "range",
      min: 38.7,
      max: 47.3,
      bounds: { min: 38, max: 48 },
      importance: "key",
      explanation: "verbose text must stay out of the compact editor",
    },
    {
      modifierId: "mana-cost",
      enabled: false,
      mode: "exact",
      min: -7,
      max: -7,
      importance: "useful",
      explanation: "another hidden explanation",
    },
  ];
}

describe("compact rare slider domain", () => {
  it("uses exact canonical decimal bounds without padding", () => {
    const domain = deriveCompactSliderDomain(-2.75, -3.1, -2.4);
    expect(domain).toEqual({ min: -3.1, max: -2.4, step: 0.01 });
  });

  it("keeps canonical integer endpoints exact", () => {
    const domain = deriveCompactSliderDomain(43, 38, 48);
    expect(domain).toEqual({ min: 38, max: 48, step: 1 });
  });

  it("does not invent a domain without valid canonical bounds", () => {
    expect(deriveCompactSliderDomain()).toBeNull();
    expect(deriveCompactSliderDomain(10, 10, 10)).toBeNull();
  });

  it("auto-enables an unchecked stat in the same first edit patch", () => {
    expect(compactModifierEditPatch(false, { min: 42 })).toEqual({
      enabled: true,
      min: 42,
    });
    expect(compactModifierEditPatch(true, { max: 48 })).toEqual({ max: 48 });
  });
});

describe("compact rare modifier markup", () => {
  it("keeps calculated defence inputs but omits sliders without source bounds", () => {
    const parsed = parsePoeItem(rareDefenceFixture);
    const item = {
      ...parsed,
      properties: { "Energy Shield": "300" },
      modifiers: [],
    };
    const planned = planEquipmentPropertyFilters(item, 10).filters;
    const markup = renderToStaticMarkup(
      <CompactRareModifierEditor
        item={item}
        filters={planned}
        onModifierChange={() => undefined}
        onItemFilterChange={() => undefined}
      />,
    );

    expect(markup).toContain("1/1 STATS");
    expect(markup).toContain('aria-label="Include Energy Shield: 300"');
    expect(markup).not.toContain("CALCULATED PROPERTY");
    expect(markup).toContain('aria-label="Minimum value for Energy Shield: 300"');
    expect(markup).toContain('aria-label="Maximum value for Energy Shield: 300"');
    expect(markup).not.toContain('aria-label="Minimum slider for Energy Shield: 300"');
    expect(markup).not.toContain('type="range"');
    expect(compactPriceCheckModifierRowsHeight(item, planned)).toBe(
      COMPACT_MODIFIER_ROW_HEIGHT,
    );
    expect(markup).not.toContain('aria-label="Match mode for');
    expect(markup).not.toContain("UNMAPPED");
  });

  it("omits obstructed Chronicle rooms while showing every remaining room filter", () => {
    const item = applyTradeStatCatalog(
      parsePoeItem(chronicleFixture),
      actualCatalog as TradeStatCatalogPack,
    );
    const markup = renderToStaticMarkup(
      <CompactRareModifierEditor
        item={item}
        filters={planModifierFilters(item, 10)}
        onModifierChange={() => undefined}
        onItemFilterChange={() => undefined}
      />,
    );

    expect(markup).toContain("5/6 STATS");
    expect(markup).not.toContain("SHOW 1");
    expect(markup.match(/aria-label="Include /g)).toHaveLength(6);
    expect(markup.match(/OPEN ROOM/g)).toHaveLength(6);
    expect(markup).not.toContain("OBSTRUCTED ROOM");
    expect(markup).toContain('aria-label="Include Apex of Atzoatl"');
    expect(markup).toContain('aria-label="Include Atlas of Worlds (Tier 3)"');
    expect(markup).not.toContain('aria-label="Include Museum of Artefacts (Tier 3)"');
    expect(markup).not.toContain('type="range"');
  });

  it("shows the reported Kaom seed as one mapped, enabled exact row", () => {
    const item = applyTradeStatCatalog(
      parsePoeItem(lethalPrideKaomAdvancedFixture),
      actualCatalog as TradeStatCatalogPack,
    );
    const label = "Commanded leadership over 12476 warriors under Kaom\n" +
      "Passives in radius are Conquered by the Karui";
    const markup = renderToStaticMarkup(
      <CompactRareModifierEditor
        item={item}
        filters={planModifierFilters(item, 10)}
        onModifierChange={() => undefined}
        onItemFilterChange={() => undefined}
      />,
    );

    expect(markup).toContain("1/1 STATS");
    expect(markup).toContain(`aria-label="Include ${label}"`);
    expect(markup).toContain(`aria-label="Exact value for ${label}"`);
    expect(markup).toContain('value="12476"');
    expect(markup).not.toContain("UNMAPPED");
    expect(markup).not.toContain("Historic");
    expect(markup).not.toContain("They believed themselves");
  });

  it("renders flat editable stats, a dual range, and concise item-state controls", () => {
    const markup = renderToStaticMarkup(
      <CompactRareModifierEditor
        item={rareItem()}
        filters={filters()}
        itemFilters={{ itemLevel: 86, corrupted: false, "influence:shaper": true }}
        onModifierChange={() => undefined}
        onItemFilterChange={() => undefined}
      />,
    );

    expect(markup).toContain("1/2 STATS");
    expect(markup).toContain("All non-hidden stats are visible");
    expect(markup).not.toContain("SHOW 1");
    expect(markup).toContain('aria-label="Item modifier filters"');
    expect(markup).toContain(">ILVL<");
    expect(markup).not.toContain(">LINKS<");
    expect(markup).not.toContain(">CLEAN<");
    expect(markup).not.toContain(">CORRUPTED<");
    expect(markup).toContain(">SHAPER<");
    expect(markup).toContain('data-rows="1"');
    expect(markup).not.toContain("scroll for more");
    expect(markup).not.toContain(">NOT VEILED<");
    expect(markup).not.toContain(">NOT SYNTH<");
    expect(markup).not.toContain(">NOT MIRRORED<");
    expect(markup).not.toContain(">NOT SPLIT<");
    expect(markup).not.toContain(">NOT FRACTURED<");
    expect(markup).toContain('aria-label="Include +43% to Chaos Resistance"');
    expect(markup).toContain('title="+43% to Chaos Resistance"');
    expect(markup.match(/type="range"/g)).toHaveLength(2);
    expect(markup.match(/type="range" min="38" max="48"/g)).toHaveLength(2);
    expect(compactPriceCheckModifierRowsHeight(rareItem(), filters())).toBe(
      COMPACT_MODIFIER_RANGE_ROW_HEIGHT + COMPACT_MODIFIER_ROW_HEIGHT,
    );
    expect(markup).toContain('aria-label="Minimum value for +43% to Chaos Resistance"');
    expect(markup).toContain('aria-label="Maximum value for +43% to Chaos Resistance"');
    expect(markup).toContain('placeholder="-∞"');
    expect(markup).toContain('placeholder="∞"');
    expect(markup).toContain('aria-label="Exact value for Non-Channeling Skills have -7 to Total Mana Cost"');
    expect(markup.match(/class="crme-row/g)).toHaveLength(2);
    expect(compactVisibleModifierFilters(filters())).toHaveLength(2);
    expect(markup).not.toContain("verbose text");
    expect(markup).not.toContain("hidden explanation");
    expect(markup).not.toContain("Â");
    expect(markup).toContain("CRAFTED / UNMAPPED");
    expect(markup).toContain(">NOT CORRUPTED<");
    expect(compactPriceCheckItemStateControlCount(rareItem())).toBe(4);
    expect(compactPriceCheckItemStateStripHeight(rareItem()))
      .toBe(COMPACT_ITEM_STATE_ONE_ROW_HEIGHT);
  });

  it("sizes and renders every item-state row when a legal plan has ten controls", () => {
    const item = {
      ...rareItem(),
      quality: 28,
      sockets: [{ colors: ["R", "G", "B", "R", "G", "B"], links: 6 }],
      links: 6,
      mirrored: true,
      split: true,
      veiled: true,
      influences: ["Shaper", "Hunter"],
    };
    const markup = renderToStaticMarkup(
      <CompactRareModifierEditor
        item={item}
        filters={filters()}
        exactItemFilters
        onModifierChange={() => undefined}
        onItemFilterChange={() => undefined}
      />,
    );

    expect(compactPriceCheckItemStateControlCount(item, true)).toBe(10);
    expect(compactPriceCheckItemStateRowCount(item, true)).toBe(3);
    expect(compactPriceCheckItemStateStripHeight(item, true)).toBe(73);
    expect(markup).toContain('data-rows="3"');
    expect(markup).toContain('--crme-state-strip-height:73px');
    expect(markup.match(/aria-label="Use /g)).toHaveLength(10);
  });

  it("counts the hidden empty-or-crafted helper while keeping it out of the compact rows", () => {
    const markup = renderToStaticMarkup(
      <CompactRareModifierEditor
        item={rareItem()}
        filters={[
          ...filters(),
          {
            modifierId: "special:empty-or-crafted-modifier",
            label: "1 EMPTY OR CRAFTED SUFFIX",
            enabled: true,
            mode: "presence",
            advancedOnly: true,
            importance: "optional",
            explanation: "Hidden crafting helper",
          },
        ]}
        onModifierChange={() => undefined}
        onItemFilterChange={() => undefined}
      />,
    );

    expect(markup).toContain("2/3 STATS");
    expect(markup).not.toContain("EMPTY OR CRAFTED");
  });

  it("opens unchecked non-hidden stats without changing their selected state", () => {
    const markup = renderToStaticMarkup(
      <CompactRareModifierEditor
        item={rareItem()}
        filters={filters()}
        onModifierChange={() => undefined}
        onItemFilterChange={() => undefined}
      />,
    );

    expect(markup).toContain(
      'aria-label="Exact value for Non-Channeling Skills have -7 to Total Mana Cost"',
    );
    expect(markup).toContain(
      'aria-label="Include Non-Channeling Skills have -7 to Total Mana Cost"',
    );
    expect(markup).not.toMatch(
      /aria-label="Include Non-Channeling Skills have -7 to Total Mana Cost" checked=""/,
    );
    expect(markup).not.toContain("SHOW");
    expect(markup).not.toContain("HIDE");
    expect(markup).not.toContain("aria-expanded");
    const exactInput = markup.match(
      /<input[^>]+aria-label="Exact value for Non-Channeling Skills have -7 to Total Mana Cost"[^>]*>/,
    )?.[0];
    expect(exactInput).toBeTruthy();
    expect(exactInput).not.toContain("disabled");
  });

  it("keeps unchecked unique rolls editable and only uses their canonical bounds", () => {
    const source = {
      ...rareItem(),
      rarity: "unique" as const,
      name: "Parity Loop",
      baseType: "Amethyst Ring",
      modifiers: [{
        ...rareItem().modifiers[0],
        id: "unique-roll",
        text: "+15% to Chaos Resistance",
        normalizedText: "+#% to Chaos Resistance",
        values: [15],
      }],
    };
    const label = "+15% to Chaos Resistance";
    const markup = renderToStaticMarkup(
      <CompactRareModifierEditor
        item={source}
        filters={[{
          modifierId: "unique-roll",
          tradeId: "explicit.stat_2923486259",
          enabled: false,
          mode: "range",
          min: 13,
          max: 17,
          bounds: { min: 10, max: 20 },
          importance: "key",
          explanation: "Unique parity regression",
        }]}
        onModifierChange={() => undefined}
        onItemFilterChange={() => undefined}
      />,
    );
    const minimumInput = markup.match(
      new RegExp(`<input[^>]+aria-label="Minimum value for ${label.replace("+", "\\+")}"[^>]*>`),
    )?.[0];

    expect(minimumInput).toBeTruthy();
    expect(minimumInput).not.toContain("disabled");
    expect(markup.match(/type="range" min="10" max="20"/g)).toHaveLength(2);
  });

  it("renders Cluster Jewel item-level bounds as one contextual ILVL range chip", () => {
    const cluster = {
      ...rareItem(),
      itemClass: "Cluster Jewels",
      baseType: "Large Cluster Jewel",
      itemLevel: 83,
      quality: undefined,
      sockets: [],
      links: undefined,
      influences: [],
    };
    const markup = renderToStaticMarkup(
      <CompactRareModifierEditor
        item={cluster}
        filters={filters()}
        itemFilters={{ itemLevel: 75, itemLevelMax: 100, corrupted: false }}
        onModifierChange={() => undefined}
        onItemFilterChange={() => undefined}
      />,
    );

    expect(markup.match(/<b>ILVL<\/b>/g)).toHaveLength(1);
    expect(markup).not.toContain("ILVL MAX");
    expect(markup).toContain('aria-label="Use ilvl range filter"');
    expect(markup).toContain('aria-label="ILVL minimum value"');
    expect(markup).toContain('aria-label="ILVL maximum value"');
  });

  it("shows weapon quality only for Base or Exact presets", () => {
    const weapon = {
      ...rareItem(),
      itemClass: "Wands",
      baseType: "Kinetic Wand",
      quality: 28,
      influences: [],
    };
    const similarMarkup = renderToStaticMarkup(
      <CompactRareModifierEditor
        item={weapon}
        filters={filters()}
        itemFilters={{}}
        onModifierChange={() => undefined}
        onItemFilterChange={() => undefined}
      />,
    );
    const exactMarkup = renderToStaticMarkup(
      <CompactRareModifierEditor
        item={weapon}
        filters={filters()}
        itemFilters={{ quality: 28 }}
        exactItemFilters
        onModifierChange={() => undefined}
        onItemFilterChange={() => undefined}
      />,
    );

    expect(similarMarkup).not.toContain(">QUALITY<");
    expect(exactMarkup).toContain(">QUALITY<");
    expect(compactPriceCheckItemStateControlCount(weapon)).toBeLessThan(
      compactPriceCheckItemStateControlCount(weapon, true),
    );
  });

  it("shows Awakened gem level and quality defaults as selected controls", () => {
    const gem = parsePoeItem(gemFixture);
    const active = defaultActivePriceCheckItemFilters(gem, { exact: true });
    const markup = renderToStaticMarkup(
      <CompactRareModifierEditor
        item={gem}
        filters={[]}
        itemFilters={active}
        onModifierChange={() => undefined}
        onItemFilterChange={() => undefined}
      />,
    );

    expect(active).toMatchObject({ gemLevel: 5, quality: 20 });
    expect(markup).toContain(">LEVEL<");
    expect(markup).toContain(">QUALITY<");
    expect(markup).toMatch(/(?:checked="" aria-label="Use quality filter"|aria-label="Use quality filter" checked="")/);
  });

  it("shows the copied positive corruption state explicitly", () => {
    const markup = renderToStaticMarkup(
      <CompactRareModifierEditor
        item={{ ...rareItem(), corrupted: true }}
        filters={filters()}
        itemFilters={{ corrupted: true }}
        onModifierChange={() => undefined}
        onItemFilterChange={() => undefined}
      />,
    );

    expect(markup).not.toContain(">CLEAN<");
    expect(markup).toContain(">CORRUPTED<");
    expect(markup).toContain("Use corrupted filter");
  });

  it("renders presence mode without numeric or slider controls", () => {
    const [filter] = filters();
    const markup = renderToStaticMarkup(
      <CompactRareModifierEditor
        item={rareItem()}
        filters={[{ ...filter, mode: "presence", min: undefined, max: undefined }]}
        onModifierChange={() => undefined}
        onItemFilterChange={() => undefined}
      />,
    );

    expect(markup).toContain("PRESENT");
    expect(markup).toContain("presence only");
    expect(markup).not.toContain('type="range"');
    expect(markup).not.toContain('title="Minimum"');
    expect(markup).not.toContain('title="Maximum"');
  });

  it("keeps pipe-qualified jewel selectors mapped and presence-only", () => {
    const item = {
      ...rareItem(),
      rarity: "unique" as const,
      name: "Thread of Hope",
      baseType: "Crimson Jewel",
      modifiers: [
        {
          ...rareItem().modifiers[0],
          id: "thread-massive",
          text: "Only affects Passives in Massive Ring",
          normalizedText: "Only affects Passives in Massive Ring",
          values: [],
          tradeId: "explicit.stat_3642528642|5",
        },
      ],
    };
    const markup = renderToStaticMarkup(
      <CompactRareModifierEditor
        item={item}
        filters={[{
          modifierId: "thread-massive",
          tradeId: "explicit.stat_3642528642|5",
          enabled: true,
          mode: "presence",
          importance: "key",
          explanation: "Discrete jewel radius",
        }]}
        itemFilters={{ foulborn: false, vestigial: false }}
        onModifierChange={() => undefined}
        onItemFilterChange={() => undefined}
      />,
    );

    expect(markup).toContain("1/1 STATS");
    expect(markup).toContain("PRESENT");
    expect(markup).not.toContain('aria-label="Match mode for');
  });

  it("hardens plain value-less notable IDs to PRESENT-only UI", () => {
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
    const item = { ...rareItem(), modifiers: [modifier] };
    const planned: PriceCheckModifierFilter = {
      modifierId: modifier.id,
      tradeId: modifier.tradeId,
      enabled: true,
      mode: "exact",
      min: 999,
      max: 999,
      importance: "key",
      explanation: "Value-less official stat",
    };
    const markup = renderToStaticMarkup(
      <CompactRareModifierEditor
        item={item}
        filters={[planned]}
        onModifierChange={() => undefined}
        onItemFilterChange={() => undefined}
      />,
    );
    expect(markup).not.toContain(`Match mode for ${label}`);
    expect(markup).toContain(`${label} presence only`);
    expect(markup).not.toContain(`Exact value for ${label}`);
    expect(markup).not.toContain(`Minimum value for ${label}`);
  });

  it("keeps numeric pipe-qualified selector stats range-editable", () => {
    const item = {
      ...rareItem(),
      modifiers: [{
        ...rareItem().modifiers[0],
        id: "numeric-selector-roll",
        text: "40% increased Effect for the selected variant",
        normalizedText: "#% increased effect for the selected variant",
        values: [40],
        tradeId: "explicit.stat_4089743927|4|126",
      }],
    };
    const label = "40% increased Effect for the selected variant";
    const markup = renderToStaticMarkup(
      <CompactRareModifierEditor
        item={item}
        filters={[{
          modifierId: "numeric-selector-roll",
          tradeId: "explicit.stat_4089743927|4|126",
          enabled: true,
          mode: "range",
          min: 35,
          max: 45,
          bounds: { min: 30, max: 50 },
          importance: "key",
          explanation: "Numeric selector roll",
        }]}
        onModifierChange={() => undefined}
        onItemFilterChange={() => undefined}
      />,
    );
    expect(markup).not.toContain(`Match mode for ${label}`);
    expect(markup).toContain(`aria-label="Minimum value for ${label}"`);
    expect(markup).toContain(`aria-label="Maximum value for ${label}"`);
    expect(markup.match(/type="range"/g)).toHaveLength(2);
    expect(markup).not.toContain(`${label} presence only`);
  });
});
