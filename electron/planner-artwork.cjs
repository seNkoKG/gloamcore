function cargoQuoted(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function plannerArtworkCargoUrl(apiRoot, values) {
  const list = values.map(cargoQuoted).join(",");
  const search = new URLSearchParams({
    action: "cargoquery",
    format: "json",
    formatversion: "2",
    limit: "100",
    tables: "items",
    fields: "name,base_item,inventory_icon,is_in_game,removal_version",
    // Query the requested unique and generic base records themselves. A
    // base_item IN query also returns every unique on common bases, can hit
    // Cargo's limit, and may assign a different unique's art to a rare item.
    where: `name IN (${list}) AND is_in_game=1 AND removal_version IS NULL`,
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

function normalizedWikiArtworkTitle(value) {
  const candidate = decodedCargoText(value).replace(/_/g, " ").trim();
  if (!/\.(?:avif|gif|jpe?g|png|webp)$/i.test(candidate)) return "";
  return `${/^File:/i.test(candidate) ? candidate : `File:${candidate}`}`.toLocaleLowerCase();
}

function selectPlannerArtworkRow(rows, item) {
  const name = decodedCargoText(item?.name).trim().toLocaleLowerCase();
  const baseType = decodedCargoText(item?.baseType).trim().toLocaleLowerCase();
  const exact = rows.find((row) => decodedCargoText(row?.name).trim().toLocaleLowerCase() === name);
  const base = rows.find((row) => decodedCargoText(row?.name).trim().toLocaleLowerCase() === baseType);
  return exact || base || null;
}

module.exports = {
  decodedCargoText,
  normalizedWikiArtworkTitle,
  plannerArtworkCargoUrl,
  selectPlannerArtworkRow,
};
