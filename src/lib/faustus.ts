import type {
  CategoryDefinition,
  EconomyRow,
  FaustusItemSeed,
  NormalizedOverview,
  RawFaustusHour,
  RawFaustusMarket,
  RawFaustusOverview,
} from "../types";

export const CHAOS_METADATA_ID =
  "Metadata/Items/Currency/CurrencyRerollRare";
export const DIVINE_METADATA_ID =
  "Metadata/Items/Currency/CurrencyModValues";

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function metadataImagePayload(icon: string) {
  const encoded = /\/gen\/image\/([^/]+)/.exec(icon)?.[1];
  if (!encoded) return undefined;
  try {
    const base64 = encoded
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    return JSON.parse(atob(base64)) as [
      unknown,
      unknown,
      { f?: string }?,
    ];
  } catch {
    return undefined;
  }
}

export function metadataIdFromIcon(icon?: string) {
  if (!icon) return undefined;
  const file = metadataImagePayload(icon)?.[2]?.f;
  if (!file) return undefined;
  if (file.startsWith("Metadata/Items/")) return file;
  if (file.startsWith("2DItems/")) {
    return `Metadata/Items/${file.slice("2DItems/".length)}`;
  }
  return undefined;
}

export function faustusItemSeeds(rows: EconomyRow[]): FaustusItemSeed[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    metadataId: metadataIdFromIcon(row.icon),
  }));
}

function pairMarket(
  hour: RawFaustusHour,
  itemMetadataId: string,
  referenceMetadataId: string,
) {
  return hour.markets.find((market) => {
    const pair = market.market_pair || [];
    return (
      pair.includes(itemMetadataId) && pair.includes(referenceMetadataId)
    );
  });
}

function marketRange(
  market: RawFaustusMarket | undefined,
  itemMetadataId: string,
  referenceMetadataId: string,
) {
  if (!market) return undefined;
  const values = [market.lowest_ratio, market.highest_ratio]
    .map((ratios) => {
      const itemRatio = finiteNumber(ratios?.[itemMetadataId]);
      const referenceRatio = finiteNumber(ratios?.[referenceMetadataId]);
      if (!itemRatio || !referenceRatio) return undefined;
      return referenceRatio / itemRatio;
    })
    .filter((value): value is number => value != null && value > 0);
  if (!values.length) return undefined;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  return {
    minimum,
    maximum,
    midpoint: (minimum + maximum) / 2,
  };
}

function referencePrice(
  hour: RawFaustusHour,
  itemMetadataId: string,
  referenceMetadataId: string,
) {
  const market = pairMarket(hour, itemMetadataId, referenceMetadataId);
  const range =
    itemMetadataId === referenceMetadataId
      ? { minimum: 1, maximum: 1, midpoint: 1 }
      : marketRange(market, itemMetadataId, referenceMetadataId);
  if (!range) return undefined;
  return { market, range };
}

function priceForHour(
  hour: RawFaustusHour,
  itemMetadataId: string,
  fallbackDivineChaos: number,
) {
  const divineChaos =
    marketRange(
      pairMarket(hour, DIVINE_METADATA_ID, CHAOS_METADATA_ID),
      DIVINE_METADATA_ID,
      CHAOS_METADATA_ID,
    )?.midpoint || fallbackDivineChaos;
  const direct = referencePrice(
    hour,
    itemMetadataId,
    CHAOS_METADATA_ID,
  );
  if (direct) {
    const market =
      direct.market ||
      pairMarket(hour, CHAOS_METADATA_ID, DIVINE_METADATA_ID);
    return {
      ...direct.range,
      market,
      reference: "chaos" as const,
      divineChaos,
    };
  }
  const divine = referencePrice(
    hour,
    itemMetadataId,
    DIVINE_METADATA_ID,
  );
  if (!divine) return undefined;
  return {
    minimum: divine.range.minimum * divineChaos,
    maximum: divine.range.maximum * divineChaos,
    midpoint: divine.range.midpoint * divineChaos,
    market: divine.market,
    reference: "divine" as const,
    divineChaos,
  };
}

function dictionaryValue(
  dictionary: Record<string, number> | undefined,
  key: string,
) {
  return finiteNumber(dictionary?.[key]);
}

function percentChange(points: Array<number | null>) {
  const first = points.find(
    (point): point is number => point != null && point > 0,
  );
  const latest = [...points]
    .reverse()
    .find((point): point is number => point != null && point > 0);
  if (first == null || latest == null || first === latest) {
    return first == null || latest == null ? null : 0;
  }
  return ((latest - first) / first) * 100;
}

export function normalizeFaustusOverview(
  base: NormalizedOverview,
  data: RawFaustusOverview,
  category: CategoryDefinition,
): NormalizedOverview {
  const itemMetadata = new Map(
    data.items
      .filter((item) => item.metadataId)
      .map((item) => [item.id, item.metadataId!]),
  );
  const hours = [...data.hours].sort((left, right) => left.id - right.id);
  const latestHour =
    hours.find((hour) => hour.id === data.latestHour) || hours.at(-1);
  const baseDivineChaos =
    base.rows.find((row) => row.name === "Divine Orb")?.chaosValue || 180;
  if (!latestHour) return { rows: [], core: base.core };

  const rows = base.rows.flatMap((row) => {
    const metadataId = itemMetadata.get(row.id);
    if (!metadataId) return [];
    const latest = priceForHour(
      latestHour,
      metadataId,
      baseDivineChaos,
    );
    if (!latest) return [];
    const sparkline = hours.map(
      (hour) =>
        priceForHour(hour, metadataId, baseDivineChaos)?.midpoint ?? null,
    );
    const traded =
      dictionaryValue(latest.market?.volume_traded, metadataId) || 0;
    const minimumStock = dictionaryValue(
      latest.market?.lowest_stock,
      metadataId,
    );
    const maximumStock = dictionaryValue(
      latest.market?.highest_stock,
      metadataId,
    );
    const spread =
      latest.midpoint > 0
        ? (latest.maximum - latest.minimum) / latest.midpoint
        : 0;
    return [
      {
        ...row,
        key: `${category.id}:faustus:${row.id}`,
        source: "faustus" as const,
        chaosValue: latest.midpoint,
        divineValue: latest.midpoint / latest.divineChaos,
        change: percentChange(sparkline),
        sparkline,
        volume: traded,
        listingCount: null,
        observationCount: null,
        maxVolumeCurrency: undefined,
        maxVolumeRate: undefined,
        faustus: {
          hour: latestHour.id,
          minimumChaos: latest.minimum,
          maximumChaos: latest.maximum,
          traded,
          minimumStock,
          maximumStock,
          reference: latest.reference,
        },
        lowConfidence: traded < 5 || spread > 0.35,
      },
    ];
  });

  return { rows, core: base.core };
}
