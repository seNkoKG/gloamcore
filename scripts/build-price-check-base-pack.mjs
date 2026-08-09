import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const SOURCE_COMMIT = "adb6c287bd978a70701e2b65d744dd677c52fb65";
const SOURCE_DATA_UPDATE = "2026-08-08";
const SOURCE_INPUT_GIT_BLOB = "986361944cb6107fe308eb2417ae21807739a0c8";
const input = process.argv[2];
const output = process.argv[3] || path.resolve(
  "src/lib/price-check/base-types-v1.json",
);

if (!input) {
  throw new Error(
    "Usage: node scripts/build-price-check-base-pack.mjs <Awakened items.ndjson> [output]",
  );
}

const source = await fs.readFile(path.resolve(input), "utf8");
const records = source
  .split(/\r?\n/)
  .flatMap((line, sourceIndex) => line.trim()
    ? [{ ...JSON.parse(line), sourceIndex }]
    : []);

function groupedVariants(rows, createProfile) {
  const grouped = new Map();
  for (const row of rows) {
    const identity = String(row.refName || "").trim();
    if (!identity) continue;
    const profiles = grouped.get(identity) || [];
    profiles.push(createProfile(row));
    grouped.set(identity, profiles);
  }
  return Object.fromEntries(
    [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function safeDisc(value) {
  if (!value || typeof value !== "object") return undefined;
  const disc = {
    ...(value.propAR === true ? { propAR: true } : {}),
    ...(value.propEV === true ? { propEV: true } : {}),
    ...(value.propES === true ? { propES: true } : {}),
    ...(value.mapTier === "W" || value.mapTier === "Y" || value.mapTier === "R"
      ? { mapTier: value.mapTier }
      : {}),
    ...(typeof value.hasImplicit?.ref === "string" && value.hasImplicit.ref
      ? { hasImplicit: { ref: value.hasImplicit.ref } }
      : {}),
    ...(typeof value.hasExplicit?.ref === "string" && value.hasExplicit.ref
      ? { hasExplicit: { ref: value.hasExplicit.ref } }
      : {}),
    ...(typeof value.sectionText === "string" && value.sectionText
      ? { sectionText: value.sectionText }
      : {}),
  };
  return Object.keys(disc).length ? disc : undefined;
}

function safeArmour(value) {
  if (!value || typeof value !== "object") return undefined;
  const armour = Object.fromEntries(
    ["ar", "ev", "es", "ward"].flatMap((key) =>
      Array.isArray(value[key]) && value[key].length === 2 &&
      value[key].every(Number.isFinite)
        ? [[key, [value[key][0], value[key][1]]]]
        : []
    ),
  );
  return Object.keys(armour).length ? armour : undefined;
}

function sharedVariantFields(item) {
  const icon = String(item.icon || "").trim();
  const tradeTag = String(item.tradeTag || "").trim();
  const tradeDisc = String(item.tradeDisc || "").trim();
  return {
    sourceIndex: item.sourceIndex,
    name: String(item.name || item.refName || "").trim(),
    ...(icon ? { icon } : {}),
    ...(Number.isFinite(item.w) ? { w: item.w } : {}),
    ...(Number.isFinite(item.h) ? { h: item.h } : {}),
    ...(tradeTag ? { tradeTag } : {}),
    ...(tradeDisc ? { tradeDisc } : {}),
    ...(item.exchangeable === true ? { exchangeable: true } : {}),
    ...(safeDisc(item.disc) ? { disc: safeDisc(item.disc) } : {}),
  };
}

const baseTypes = [...new Set(
  records
    .filter((item) => item?.namespace === "ITEM" && item?.craftable)
    .map((item) => String(item.name || "").trim())
    .filter(Boolean),
)].sort((left, right) => left.localeCompare(right));
const itemProfiles = groupedVariants(
  records.filter((item) => item?.namespace === "ITEM" && item?.refName),
  (item) => ({
    ...sharedVariantFields(item),
    ...(item.craftable && typeof item.craftable === "object"
      ? { craftable: {
          category: String(item.craftable.category || ""),
          ...(item.craftable.corrupted === true ? { corrupted: true } : {}),
          ...(item.craftable.uniqueOnly === true ? { uniqueOnly: true } : {}),
        } }
      : {}),
    ...(item.armour && typeof item.armour === "object"
      ? { armour: safeArmour(item.armour) || {} }
      : {}),
  }),
);
const uniqueProfiles = groupedVariants(
  records.filter((item) => item?.namespace === "UNIQUE" && item?.unique && item?.refName),
  (item) => {
      const hasFixedStats = Array.isArray(item.unique.fixedStats);
      const profile = {
        ...sharedVariantFields(item),
        baseType: String(item.unique.base || ""),
        ...(Number.isFinite(item.unique.disenchantValue)
          ? { disenchantValue: item.unique.disenchantValue }
          : {}),
        modifierPolicy: hasFixedStats
          ? item.unique.fixedStats.length
            ? "non-fixed-explicit-variants"
            : "all-explicit-variants"
          : "source-bounds-only",
      };
      // Awakened intentionally distinguishes an omitted fixedStats property
      // from an explicitly supplied (including empty) array. Presence means
      // every non-fixed explicit is a selectable unique variant; absence means
      // constant-roll lines must stay conservative. Do not erase that signal.
      if (Array.isArray(item.unique.fixedStats)) {
        profile.fixedStats = item.unique.fixedStats.map(String);
      }
      return profile;
  },
);
const gemProfiles = Object.fromEntries(
  records
    .filter((item) => item?.namespace === "GEM" && item?.gem && item?.refName)
    .sort((left, right) => String(left.refName).localeCompare(String(right.refName)))
    .map((item) => [String(item.refName), {
      maxLevel: Number(item.gem.maxLevel),
      transfigured: Boolean(item.gem.transfigured),
      ...(item.gem.normalVariant
        ? { normalVariant: String(item.gem.normalVariant) }
        : {}),
      ...(item.tradeDisc ? { tradeDisc: String(item.tradeDisc) } : {}),
    }]),
);
const itemTradeDiscriminators = Object.fromEntries(
  records
    .filter((item) => item?.namespace === "ITEM" && item?.refName && item?.tradeDisc)
    .sort((left, right) => String(left.refName).localeCompare(String(right.refName)))
    .map((item) => [String(item.refName), String(item.tradeDisc)]),
);
const mapAreaTradeDiscriminators = Object.fromEntries(
  records
    .filter((item) => item?.namespace === "AREA" && item?.name && item?.tradeDisc)
    .sort((left, right) => String(left.name).localeCompare(String(right.name)))
    .map((item) => [String(item.name), String(item.tradeDisc)]),
);
const tradeTags = Object.fromEntries(
  records
    .filter((item) => item?.tradeTag && item?.refName)
    .sort((left, right) => String(left.refName).localeCompare(String(right.refName)))
    .map((item) => [String(item.refName), String(item.tradeTag)]),
);
const exchangeableWithoutTradeTag = records
  .filter((item) => item?.exchangeable && !item?.tradeTag && item?.refName)
  .map((item) => String(item.refName))
  .sort((left, right) => left.localeCompare(right));

const payload = {
  schema: 2,
  source: {
    project: "Awakened PoE Trade",
    repository: "https://github.com/SnosMe/awakened-poe-trade",
    commit: SOURCE_COMMIT,
    dataUpdatedAt: SOURCE_DATA_UPDATE,
    inputGitBlob: SOURCE_INPUT_GIT_BLOB,
    inputSha256: crypto.createHash("sha256").update(source).digest("hex"),
  },
  capabilities: {
    uniqueFixedStatDeclarations: true,
    // Awakened's shipped items.ndjson declares fixed/variant visibility but
    // does not contain per-unique roll ranges. Those ranges are trustworthy
    // only when Path of Exile includes them in Advanced Description copy text.
    embeddedUniqueRollBounds: false,
    variantRecords: true,
    variantDiscriminators: [
      "copied-base",
      "propAR",
      "propEV",
      "propES",
      "mapTier",
      "hasImplicit",
      "hasExplicit",
      "sectionText",
    ],
  },
  coverage: {
    itemIdentities: Object.keys(itemProfiles).length,
    itemVariants: Object.values(itemProfiles).reduce((total, variants) => total + variants.length, 0),
    armourVariants: Object.values(itemProfiles).flat().filter((variant) => variant.armour).length,
    discriminatedItemVariants: Object.values(itemProfiles).flat().filter((variant) => variant.disc).length,
    uniqueIdentities: Object.keys(uniqueProfiles).length,
    uniqueVariants: Object.values(uniqueProfiles).reduce((total, variants) => total + variants.length, 0),
  },
  generatedAt: new Date().toISOString(),
  baseTypes,
  itemProfiles,
  uniqueProfiles,
  gemProfiles,
  itemTradeDiscriminators,
  mapAreaTradeDiscriminators,
  // Same source fields Awakened exposes as item.info.tradeTag/exchangeable.
  tradeTags,
  exchangeableWithoutTradeTag,
};

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(payload)}\n`, "utf8");
console.log(JSON.stringify({
  output,
  baseTypes: baseTypes.length,
  itemProfiles: Object.keys(itemProfiles).length,
  itemVariants: Object.values(itemProfiles).reduce((total, variants) => total + variants.length, 0),
  armourVariants: Object.values(itemProfiles).flat().filter((variant) => variant.armour).length,
  uniqueProfiles: Object.keys(uniqueProfiles).length,
  uniqueVariants: Object.values(uniqueProfiles).reduce((total, variants) => total + variants.length, 0),
  gemProfiles: Object.keys(gemProfiles).length,
  itemTradeDiscriminators: Object.keys(itemTradeDiscriminators).length,
  mapAreaTradeDiscriminators: Object.keys(mapAreaTradeDiscriminators).length,
  tradeTags: Object.keys(tradeTags).length,
  exchangeableWithoutTradeTag: exchangeableWithoutTradeTag.length,
  bytes: Buffer.byteLength(JSON.stringify(payload)),
}));
