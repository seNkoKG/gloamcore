function cargoQuoted(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function plannerArtworkCargoUrl(apiRoot, entries) {
  const items = entries.map((entry) => typeof entry === "string" ? { name: entry } : entry);
  const names = [...new Set(items.flatMap((item) => [item?.name, item?.baseType]).filter(Boolean))];
  const metadataIds = [...new Set(items.map((item) => item?.metadataId).filter(Boolean))];
  const clauses = [];
  if (names.length) clauses.push(`name IN (${names.map(cargoQuoted).join(",")})`);
  if (metadataIds.length) clauses.push(`metadata_id IN (${metadataIds.map(cargoQuoted).join(",")})`);
  const search = new URLSearchParams({
    action: "cargoquery",
    format: "json",
    formatversion: "2",
    limit: "100",
    tables: "items",
    fields: "name,base_item,inventory_icon,metadata_id,size_x,size_y,is_in_game,removal_version",
    // Query the requested unique and generic base records themselves. A
    // base_item IN query also returns every unique on common bases, can hit
    // Cargo's limit, and may assign a different unique's art to a rare item.
    where: `(${clauses.join(" OR ")}) AND is_in_game=1 AND removal_version IS NULL`,
  });
  return `${apiRoot}?${search}`;
}

function decodedCargoText(value) {
  return String(value || "")
    .replace(/&#(?:0*39|x0*27);/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function currentWikiItemMetadataByName(entries) {
  const metadataByName = new Map();
  for (const entry of entries || []) {
    const record = entry?.title || entry || {};
    const name = decodedCargoText(record.name).trim();
    const metadataId = decodedCargoText(record["metadata id"] || record.metadata_id).trim();
    const inGame = String(record["is in game"] ?? record.is_in_game ?? "1");
    const removed = decodedCargoText(record["removal version"] || record.removal_version).trim();
    if (
      name &&
      /^Metadata\/Items\/[A-Za-z0-9_./-]+$/.test(metadataId) &&
      inGame !== "0" &&
      !removed
    ) {
      metadataByName.set(name.toLocaleLowerCase(), metadataId);
    }
  }
  return metadataByName;
}

function normalizedWikiArtworkTitle(value) {
  const candidate = decodedCargoText(value).replace(/_/g, " ").trim();
  if (!/\.(?:avif|gif|jpe?g|png|webp)$/i.test(candidate)) return "";
  return `${/^File:/i.test(candidate) ? candidate : `File:${candidate}`}`.toLocaleLowerCase();
}

function selectPlannerArtworkRow(rows, item) {
  const name = decodedCargoText(item?.name).trim().toLocaleLowerCase();
  const baseType = decodedCargoText(item?.baseType).trim().toLocaleLowerCase();
  const metadataId = decodedCargoText(item?.metadataId).trim().toLocaleLowerCase();
  const exact = rows.find((row) => decodedCargoText(row?.name).trim().toLocaleLowerCase() === name);
  const metadata = metadataId
    ? rows.find((row) => decodedCargoText(row?.["metadata id"] || row?.metadata_id).trim().toLocaleLowerCase() === metadataId)
    : null;
  const base = rows.find((row) => decodedCargoText(row?.name).trim().toLocaleLowerCase() === baseType);
  // Transfigured gems can retain their base gem metadata id, so the exact
  // display name must win before the metadata fallback.
  return exact || metadata || base || null;
}

function plannerArtworkDimensions(row) {
  const width = Number(row?.size_x ?? row?.["size x"]);
  const height = Number(row?.size_y ?? row?.["size y"]);
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    width > 4 ||
    height < 1 ||
    height > 6
  ) {
    return null;
  }
  return { width, height };
}

module.exports = {
  currentWikiItemMetadataByName,
  decodedCargoText,
  normalizedWikiArtworkTitle,
  plannerArtworkDimensions,
  plannerArtworkCargoUrl,
  selectPlannerArtworkRow,
};
