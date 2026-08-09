import { describe, expect, it } from "vitest";
import type {
  CategoryDefinition,
  EconomyRow,
  NormalizedOverview,
  RawFaustusHour,
  RawFaustusOverview,
} from "../types";
import {
  CHAOS_METADATA_ID,
  DIVINE_METADATA_ID,
  metadataIdFromIcon,
  normalizeFaustusOverview,
} from "./faustus";

const category: CategoryDefinition = {
  id: "currency",
  label: "Currency",
  group: "General",
  apiType: "Currency",
  source: "dual",
  icon: "coins",
  description: "Currency",
};

const mirror: EconomyRow = {
  key: "currency:exchange:mirror",
  id: "mirror",
  name: "Mirror of Kalandra",
  categoryId: "currency",
  categoryLabel: "Currency",
  source: "exchange",
  chaosValue: 370,
  divineValue: 2,
  change: null,
  sparkline: [],
  volume: 10,
  listingCount: null,
  observationCount: null,
  implicitModifiers: [],
  explicitModifiers: [],
  mutatedModifiers: [],
  lowConfidence: false,
};

const base: NormalizedOverview = {
  rows: [mirror],
  core: {
    primary: "chaos",
    secondary: "divine",
    rates: { divine: 1 / 180 },
    items: {},
  },
};

function market(
  hour: number,
  minimumChaos: number,
  maximumChaos: number,
): RawFaustusHour {
  return {
    id: hour,
    markets: [
      {
        league: "Allflame",
        market_pair: ["Metadata/Items/Currency/CurrencyDuplicate", CHAOS_METADATA_ID],
        lowest_ratio: {
          "Metadata/Items/Currency/CurrencyDuplicate": 1,
          [CHAOS_METADATA_ID]: maximumChaos,
        },
        highest_ratio: {
          "Metadata/Items/Currency/CurrencyDuplicate": 1,
          [CHAOS_METADATA_ID]: minimumChaos,
        },
        volume_traded: {
          "Metadata/Items/Currency/CurrencyDuplicate": 51,
          [CHAOS_METADATA_ID]: 18_838,
        },
        lowest_stock: {
          "Metadata/Items/Currency/CurrencyDuplicate": 25,
        },
        highest_stock: {
          "Metadata/Items/Currency/CurrencyDuplicate": 34,
        },
      },
      {
        league: "Allflame",
        market_pair: [DIVINE_METADATA_ID, CHAOS_METADATA_ID],
        lowest_ratio: {
          [DIVINE_METADATA_ID]: 1,
          [CHAOS_METADATA_ID]: 180,
        },
        highest_ratio: {
          [DIVINE_METADATA_ID]: 1,
          [CHAOS_METADATA_ID]: 178,
        },
      },
    ],
  };
}

describe("Faustus market normalization", () => {
  it("extracts the official metadata id from a generated item image", () => {
    expect(
      metadataIdFromIcon(
        "https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQ3VycmVuY3lSZXJvbGxSYXJlIiwic2NhbGUiOjF9XQ/46a2347805/CurrencyRerollRare.png",
      ),
    ).toBe(CHAOS_METADATA_ID);
  });

  it("builds hourly range, midpoint, volume, stock and trend rows", () => {
    const data: RawFaustusOverview = {
      latestHour: 7_200,
      items: [
        {
          id: "mirror",
          name: "Mirror of Kalandra",
          metadataId: "Metadata/Items/Currency/CurrencyDuplicate",
        },
      ],
      hours: [market(3_600, 300, 320), market(7_200, 350, 379)],
    };
    const result = normalizeFaustusOverview(base, data, category).rows[0];

    expect(result.source).toBe("faustus");
    expect(result.chaosValue).toBe(364.5);
    expect(result.divineValue).toBeCloseTo(364.5 / 179);
    expect(result.change).toBeCloseTo(((364.5 - 310) / 310) * 100);
    expect(result.volume).toBe(51);
    expect(result.faustus).toMatchObject({
      minimumChaos: 350,
      maximumChaos: 379,
      minimumStock: 25,
      maximumStock: 34,
      traded: 51,
    });
  });
});
