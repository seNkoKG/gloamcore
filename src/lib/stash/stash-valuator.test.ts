import { describe, expect, it } from "vitest";
import type { EconomyRow, GGGStashItem } from "../../types";
import { classifyStashItem, isStackableItem } from "./stash-classify";
import { buildStashPriceIndex, findPricedRow, normalizeIdentity, normalizePriceName } from "./stash-pricing";
import {
  buildSnapshot,
  snapshotDelta,
  valueStashItem,
  valueStashTabs,
} from "./stash-valuator";

function row(name: string, chaos: number, divine = chaos / 180): EconomyRow {
  return {
    key: name,
    id: name,
    name,
    categoryId: "",
    categoryLabel: "",
    source: "stash-item",
    chaosValue: chaos,
    divineValue: divine,
    change: null,
    sparkline: [],
    volume: null,
    listingCount: null,
    observationCount: null,
    implicitModifiers: [],
    explicitModifiers: [],
    mutatedModifiers: [],
    lowConfidence: false,
  };
}

function item(partial: Partial<GGGStashItem> & { typeLine?: string }): GGGStashItem {
  return { name: "", typeLine: "", baseType: "", frameType: 0, ...partial };
}

function indexOf(entries: Record<string, EconomyRow[]>, stale = false) {
  return buildStashPriceIndex(
    Object.entries(entries).map(([categoryId, rows]) => ({
      categoryId,
      rows,
      fetchedAt: 1_700_000_000_000,
      stale,
    })),
  );
}

describe("stash item classification", () => {
  it("classifies currency-like items by typeLine and category keys", () => {
    expect(classifyStashItem(item({ frameType: 5, typeLine: "Chaos Orb", category: { currency: ["Currency"] } }))).toBe("currency");
    expect(classifyStashItem(item({ frameType: 5, typeLine: "Essence of Hatred" }))).toBe("essence");
    expect(classifyStashItem(item({ frameType: 5, typeLine: "Essence of Horror", category: { essences: ["Essence"] } }))).toBe("essence");
    expect(classifyStashItem(item({ frameType: 5, typeLine: "Pristine Fossil", category: { fossils: ["Fossil"] } }))).toBe("fossil");
    expect(classifyStashItem(item({ frameType: 5, typeLine: "Primitive Resonator", category: { resonators: ["Resonator"] } }))).toBe("resonator");
    expect(classifyStashItem(item({ frameType: 5, typeLine: "Gilded Scarab", category: { scarabs: ["Scarab"] } }))).toBe("scarab");
    expect(classifyStashItem(item({ frameType: 5, typeLine: "Clear Oil", category: { oils: ["Oil"] } }))).toBe("oil");
    expect(classifyStashItem(item({ frameType: 5, typeLine: "Turbulent Catalyst" }))).toBe("catalyst");
    expect(classifyStashItem(item({ frameType: 5, typeLine: "Ornate Incubator" }))).toBe("incubator");
    expect(classifyStashItem(item({ frameType: 5, typeLine: "Delirium Orb" }))).toBe("delirium-orb");
    expect(classifyStashItem(item({ frameType: 5, typeLine: "Maven's Invitation: The Feared" }))).toBe("invitation");
    expect(classifyStashItem(item({ frameType: 5, typeLine: "Tattoo of Hinekora" }))).toBe("tattoo");
    expect(classifyStashItem(item({ frameType: 5, typeLine: "Omen of Whittling" }))).toBe("omen");
    expect(classifyStashItem(item({ frameType: 5, typeLine: "Vial of Awakening" }))).toBe("vial");
    expect(classifyStashItem(item({ frameType: 5, typeLine: "Amber Artifact" }))).toBe("artifact");
  });

  it("classifies fragments, maps, gems, uniques and gear", () => {
    expect(classifyStashItem(item({ frameType: 5, typeLine: "Sacrifice at Dusk", category: { fragments: ["Fragment"] } }))).toBe("fragment");
    expect(classifyStashItem(item({ frameType: 1, typeLine: "Sulphur Vault Map", category: { maps: ["Maps"] } }))).toBe("map");
    expect(classifyStashItem(item({ frameType: 1, typeLine: "Blighted Sulphur Vault Map", category: { maps: ["Maps"] } }))).toBe("blighted-map");
    expect(classifyStashItem(item({ frameType: 1, typeLine: "Blight-ravaged Sulphur Vault Map", category: { maps: ["Maps"] } }))).toBe("blight-ravaged-map");
    expect(classifyStashItem(item({ frameType: 3, name: "Mao Kun", typeLine: "Mao Kun", category: { maps: ["UniqueMap"] } }))).toBe("unique-map");
    expect(classifyStashItem(item({ frameType: 4, typeLine: "Spark", category: { gems: ["SkillGem"] } }))).toBe("skill-gem");
    expect(classifyStashItem(item({ frameType: 4, typeLine: "Imbued Herald" }))).toBe("imbued-gem");
    expect(classifyStashItem(item({ frameType: 3, name: "Windripper", typeLine: "Imperial Bow", category: { weapons: ["Bow"] } }))).toBe("unique-weapon");
    expect(classifyStashItem(item({ frameType: 3, name: "Kaom's Heart", typeLine: "Glorious Plate", category: { armour: ["Body Armour"] } }))).toBe("unique-armour");
    expect(classifyStashItem(item({ frameType: 3, name: "Le Heup of All", typeLine: "Iron Ring", category: { accessories: ["Ring"] } }))).toBe("unique-accessory");
    expect(classifyStashItem(item({ frameType: 3, name: "Watcher's Eye", typeLine: "Prismatic Jewel", category: { jewels: ["Jewel"] } }))).toBe("unique-jewel");
    expect(classifyStashItem(item({ frameType: 3, name: "The Wise Oak", typeLine: "Amber Flask", category: { flasks: ["Life Flask"] } }))).toBe("unique-flask");
    expect(classifyStashItem(item({ frameType: 2, typeLine: "Glorious Plate", name: "" }))).toBe("other");
    expect(classifyStashItem(item({ frameType: 0, typeLine: "Large Cluster Jewel", category: { jewels: ["Cluster Jewel"] } }))).toBe("cluster-jewel");
    expect(classifyStashItem(item({ frameType: 5, typeLine: "Craicic Chimeral", category: { monsters: ["Beast"] } }))).toBe("beast");
  });

  it("classifies divination cards before currency checks", () => {
    expect(classifyStashItem(item({ frameType: 6, typeLine: "The Doctor", category: { cards: ["DivinationCard"] } }))).toBe("divination-card");
  });
});

describe("stash price index", () => {
  it("normalizes apostrophe and whitespace variants", () => {
    expect(normalizePriceName("  Watcher’s   Eye ")).toBe("watcher's eye");
    expect(normalizeIdentity({ frameType: 3, name: "Watcher's Eye", typeLine: "Prismatic Jewel" })).toBe("watcher's eye");
    expect(normalizeIdentity({ frameType: 0, name: "", typeLine: "Sulphur Vault Map" })).toBe("sulphur vault map");
  });

  it("first row wins per normalized name", () => {
    const index = indexOf({
      currency: [row("Chaos Orb", 1), row("Divine Orb", 180)],
    });
    expect(index.byName.get("chaos orb")?.row.chaosValue).toBe(1);
    expect(index.divineChaos).toBe(180);
    expect(index.pricesStale).toBe(false);
  });

  it("reports stale pricing overviews and the latest observation time", () => {
    const index = indexOf({ maps: [row("Sulphur Vault Map", 3)] }, true);
    expect(index.pricesStale).toBe(true);
    expect(index.pricesAt).toBe(1_700_000_000_000);
  });

  it("finds rows by family category and falls back to currency for stackable goods", () => {
    const index = indexOf({
      currency: [row("Turbulent Catalyst", 2)],
      fossils: [row("Pristine Fossil", 5)],
    });
    const catalyst = item({ frameType: 5, typeLine: "Turbulent Catalyst", stackSize: 10 });
    expect(classifyStashItem(catalyst)).toBe("catalyst");
    expect(findPricedRow(index, "catalyst", catalyst, isStackableItem(catalyst))?.chaosValue).toBe(2);
    expect(findPricedRow(index, "map", item({ frameType: 1, typeLine: "Sulphur Vault Map" }), false)).toBeNull();
  });

  it("matches unique items across unique families regardless of classification", () => {
    const index = indexOf({
      "unique-accessories": [row("Le Heup of All", 40)],
    });
    const ring = item({ frameType: 3, name: "Le Heup of All", typeLine: "Iron Ring" });
    expect(findPricedRow(index, "unique-accessory", ring, false)?.chaosValue).toBe(40);
  });
});

describe("stash item valuation", () => {
  it("values stackable currency by stack size", () => {
    const index = indexOf({ currency: [row("Chaos Orb", 1), row("Divine Orb", 180)] });
    const chaos = valueStashItem(item({ frameType: 5, typeLine: "Chaos Orb", stackSize: 18, category: { currency: ["Currency"] } }), index);
    expect(chaos).toMatchObject({ family: "currency", quantity: 18, unitChaos: 1, chaos: 18, priced: true, reason: "matched" });
    const divine = valueStashItem(item({ frameType: 5, typeLine: "Divine Orb", stackSize: 3 }), index);
    expect(divine.chaos).toBe(540);
    expect(divine.unitDivine).toBe(1);
  });

  it("values divination cards, maps, fossils and uniques at unit price times count", () => {
    const index = indexOf({
      "divination-cards": [row("The Doctor", 400)],
      maps: [row("Sulphur Vault Map", 3)],
      fossils: [row("Pristine Fossil", 5, 5 / 180)],
      "unique-weapons": [row("Windripper", 120)],
    });
    const card = valueStashItem(item({ frameType: 6, typeLine: "The Doctor", stackSize: 5 }), index);
    expect(card).toMatchObject({ family: "divination-card", quantity: 5, chaos: 2_000, priced: true });
    const map = valueStashItem(item({ frameType: 1, typeLine: "Sulphur Vault Map", category: { maps: ["Maps"] } }), index);
    expect(map.chaos).toBe(3);
    const fossil = valueStashItem(item({ frameType: 5, typeLine: "Pristine Fossil", stackSize: 2 }), index);
    expect(fossil.chaos).toBe(10);
    const bow = valueStashItem(item({ frameType: 3, name: "Windripper", typeLine: "Imperial Bow" }), index);
    expect(bow).toMatchObject({ identity: "Windripper", family: "unique-weapon", chaos: 120, priced: true });
  });

  it("reads gem quality from properties", () => {
    const index = indexOf({ "skill-gems": [row("Spark", 15)] });
    const gem = valueStashItem(item({
      frameType: 4,
      typeLine: "Spark",
      properties: [{ name: "Quality", values: [["+20%", 0]], displayMode: 0 }],
    }), index);
    expect(gem.quality).toBe(20);
  });

  it("marks rares and unmatched items as unpriced at zero", () => {
    const index = indexOf({ currency: [row("Chaos Orb", 1)] });
    const rare = valueStashItem(item({ frameType: 2, typeLine: "Glorious Plate" }), index);
    expect(rare).toMatchObject({ priced: false, chaos: 0, reason: "rare" });
    const unknown = valueStashItem(item({ frameType: 5, typeLine: "Mythical Widget" }), index);
    expect(unknown).toMatchObject({ priced: false, chaos: 0, reason: "unmatched" });
  });
});

describe("stash tab and snapshot valuation", () => {
  function valuations(prices: Record<string, EconomyRow[]>) {
    const index = indexOf(prices);
    const tabs = [
      {
        id: "t1",
        name: "Currency",
        type: "CurrencyStash",
        index: 0,
        path: [],
        items: [
          item({ frameType: 5, typeLine: "Chaos Orb", stackSize: 100 }),
          item({ frameType: 5, typeLine: "Divine Orb", stackSize: 2 }),
        ],
      },
      {
        id: "t2",
        name: "Maps",
        type: "MapStash",
        index: 1,
        path: ["Folder"],
        items: [
          item({ frameType: 1, typeLine: "Sulphur Vault Map", category: { maps: ["Maps"] } }),
          item({ frameType: 2, typeLine: "Rare Amulet" }),
        ],
      },
    ];
    return { index, result: valueStashTabs(tabs, index) };
  }

  it("rolls up totals, tab breakdowns and family rollups", () => {
    const { result } = valuations({
      currency: [row("Chaos Orb", 1), row("Divine Orb", 180)],
      maps: [row("Sulphur Vault Map", 3)],
    });
    expect(result.chaos).toBe(100 + 360 + 3);
    expect(result.divine).toBeCloseTo(100 / 180 + 2 + 3 / 180, 6);
    expect(result.itemCount).toBe(4);
    expect(result.pricedItemCount).toBe(3);
    expect(result.unpricedItemCount).toBe(1);
    expect(result.tabs).toHaveLength(2);
    expect(result.tabs[1]).toMatchObject({ name: "Maps", chaos: 3, unpricedItemCount: 1 });
    expect(result.tabs[1].path).toEqual(["Folder"]);
    expect(result.families.currency?.chaos).toBe(460);
    expect(result.families.currency?.count).toBe(102);
    expect(result.families.map?.chaos).toBe(3);
    expect(result.overviewCount).toBe(2);
  });

  it("orders top items by value and caps the list", () => {
    const { result } = valuations({
      currency: [row("Chaos Orb", 1), row("Divine Orb", 180)],
      maps: [row("Sulphur Vault Map", 3)],
    });
    expect(result.topItems[0]).toMatchObject({ name: "Divine Orb", quantity: 2, chaos: 360 });
    expect(result.topItems.map((entry) => entry.name)).toEqual(["Divine Orb", "Chaos Orb", "Sulphur Vault Map"]);
  });

  it("builds a persisted snapshot without per-item payloads", () => {
    const { result } = valuations({
      currency: [row("Chaos Orb", 1), row("Divine Orb", 180)],
      maps: [row("Sulphur Vault Map", 3)],
    });
    const snapshot = buildSnapshot(result, "Allflame", "pc", 1_700_000_000_000);
    expect(snapshot).toMatchObject({
      version: 1,
      league: "Allflame",
      realm: "pc",
      chaos: 463,
      tabCount: 2,
      topItems: result.topItems,
    });
    expect(snapshot.tabs[0].id).toBe("t1");
    expect((snapshot.tabs[0] as unknown as { items?: unknown }).items).toBeUndefined();
    expect(snapshot.metadata.pricesStale).toBe(false);
  });

  it("computes per-hour wealth deltas between snapshots", () => {
    const { result, index } = valuations({
      currency: [row("Chaos Orb", 1), row("Divine Orb", 180)],
      maps: [row("Sulphur Vault Map", 3)],
    });
    const earlier = buildSnapshot(result, "Allflame", "pc", 1_700_000_000_000);
    const laterIndex = indexOf({
      currency: [row("Chaos Orb", 1), row("Divine Orb", 180)],
      maps: [row("Sulphur Vault Map", 3)],
    });
    const richer = valueStashTabs(
      [
        {
          id: "t1",
          name: "Currency",
          type: "CurrencyStash",
          index: 0,
          path: [],
          items: [item({ frameType: 5, typeLine: "Chaos Orb", stackSize: 100 }), item({ frameType: 5, typeLine: "Divine Orb", stackSize: 3 })],
        },
      ],
      laterIndex,
    );
    const later = buildSnapshot(richer, "Allflame", "pc", 1_700_003_600_000);
    const delta = snapshotDelta(earlier, later);
    expect(delta.chaos).toBe(177);
    expect(delta.hours).toBe(1);
    expect(delta.chaosPerHour).toBe(177);
    const tooFast = snapshotDelta(later, buildSnapshot(richer, "Allflame", "pc", later.createdAt + 60_000));
    expect(tooFast.chaosPerHour).toBeNull();
  });
});