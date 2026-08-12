import type {
  CategoryDefinition,
  EconomyRow,
  FaustusItemSeed,
  NormalizedOverview,
  RawFaustusHour,
  RawFaustusMarket,
  RawFaustusOverview,
  RawWikiCargoResponse,
} from "../types";

export const CHAOS_METADATA_ID =
  "Metadata/Items/Currency/CurrencyRerollRare";
export const DIVINE_METADATA_ID =
  "Metadata/Items/Currency/CurrencyModValues";
// Very small completed-hour fills can be genuine, but they are too easy to
// distort and must not drive the default price/mover surfaces.
const MIN_FAUSTUS_TRADED_UNITS = 20;
const MAX_FAUSTUS_RELATIVE_SPREAD = 0.35;

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

function decodedWikiCargoText(value: unknown) {
  return String(value || "")
    .replace(/&#(?:0*39|x0*27);/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function resolveFaustusItemMetadata(
  items: FaustusItemSeed[],
  cargoEntries: NonNullable<RawWikiCargoResponse["cargoquery"]>,
) {
  const metadataByName = new Map<string, string>();
  for (const entry of cargoEntries) {
    const record = entry.title || {};
    const name = decodedWikiCargoText(record.name).trim();
    const metadataId = decodedWikiCargoText(
      record["metadata id"] || record.metadata_id,
    ).trim();
    const inGame = String(record["is in game"] ?? record.is_in_game ?? "1");
    const removed = decodedWikiCargoText(
      record["removal version"] || record.removal_version,
    ).trim();
    if (
      name &&
      /^Metadata\/Items\/[A-Za-z0-9_./-]+$/.test(metadataId) &&
      inGame !== "0" &&
      !removed
    ) {
      metadataByName.set(name.toLocaleLowerCase(), metadataId);
    }
  }
  return items.map((item) => ({
    ...item,
    // The generated poe.ninja image payload describes a texture file, not a
    // canonical item id. Current Wiki metadata must therefore win whenever it
    // is available; the image-derived value is only a last-resort fallback.
    metadataId:
      metadataByName.get(decodedWikiCargoText(item.name).trim().toLocaleLowerCase()) ||
      item.metadataId,
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
  const market = itemMetadataId === referenceMetadataId
    ? undefined
    : pairMarket(hour, itemMetadataId, referenceMetadataId);
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
) {
  const divineChaos =
    marketRange(
      pairMarket(hour, DIVINE_METADATA_ID, CHAOS_METADATA_ID),
      DIVINE_METADATA_ID,
      CHAOS_METADATA_ID,
    )?.midpoint ?? null;
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
  if (!divine || divineChaos == null) return undefined;
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

function priceConfidence(
  price: NonNullable<ReturnType<typeof priceForHour>>,
  itemMetadataId: string,
) {
  const traded = dictionaryValue(price.market?.volume_traded, itemMetadataId) || 0;
  const spread =
    price.midpoint > 0
      ? (price.maximum - price.minimum) / price.midpoint
      : Number.POSITIVE_INFINITY;
  const reasons = [];
  if (traded < MIN_FAUSTUS_TRADED_UNITS) {
    reasons.push(`Only ${traded} item units traded in the completed hour`);
  }
  if (spread > MAX_FAUSTUS_RELATIVE_SPREAD) {
    reasons.push(`Completed-hour range spans ${Math.round(spread * 100)}% of its midpoint`);
  }
  return {
    traded,
    spread,
    lowConfidence: reasons.length > 0,
    confidenceReason: reasons.join("; ") || undefined,
  };
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
  if (!latestHour) return { rows: [], core: base.core };

  const rows = base.rows.flatMap((row) => {
    const metadataId = itemMetadata.get(row.id);
    if (!metadataId) return [];
    const observed = [...hours]
      .reverse()
      .map((hour) => ({
        hour,
        price: priceForHour(hour, metadataId),
      }))
      .find((entry) => entry.price);
    if (!observed?.price) return [];
    const latest = observed.price;
    const confidence = priceConfidence(latest, metadataId);
    const observationAgeHours = Math.max(
      0,
      Math.round((latestHour.id - observed.hour.id) / 3_600),
    );
    const ageReason = observationAgeHours > 0
      ? `No usable market range in the latest completed hour; showing the last official market from ${observationAgeHours} ${observationAgeHours === 1 ? "hour" : "hours"} earlier`
      : undefined;
    const lowConfidence = confidence.lowConfidence || Boolean(ageReason);
    const confidenceReason = [confidence.confidenceReason, ageReason]
      .filter(Boolean)
      .join("; ") || undefined;
    const sparkline = hours.map((hour) => {
      const price = priceForHour(hour, metadataId);
      if (!price || priceConfidence(price, metadataId).lowConfidence) return null;
      return price.midpoint;
    });
    const traded = confidence.traded;
    const minimumStock = dictionaryValue(
      latest.market?.lowest_stock,
      metadataId,
    );
    const maximumStock = dictionaryValue(
      latest.market?.highest_stock,
      metadataId,
    );
    return [
      {
        ...row,
        key: `${category.id}:faustus:${row.id}`,
        source: "faustus" as const,
        chaosValue: latest.midpoint,
        divineValue:
          latest.divineChaos == null
            ? null
            : latest.midpoint / latest.divineChaos,
        change: lowConfidence ? null : percentChange(sparkline),
        sparkline,
        volume: traded,
        listingCount: null,
        observationCount: null,
        maxVolumeCurrency: undefined,
        maxVolumeRate: undefined,
        faustus: {
          hour: observed.hour.id,
          minimumChaos: latest.minimum,
          maximumChaos: latest.maximum,
          traded,
          minimumStock,
          maximumStock,
          reference: latest.reference,
        },
        lowConfidence,
        confidenceReason,
      },
    ];
  });

  return { rows, core: base.core };
}
