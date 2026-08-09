"use strict";

function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isRecordArray(value) {
  return Array.isArray(value) && value.every(isRecord);
}

function hasOptionalRecordArray(record, key) {
  return record[key] == null || isRecordArray(record[key]);
}

function hasOptionalSparkline(record, key) {
  const value = record[key];
  if (value == null) return true;
  if (!isRecord(value)) return false;
  return value.data == null || (
    Array.isArray(value.data) &&
    value.data.every(
      (point) => point == null || (typeof point === "number" && Number.isFinite(point)),
    )
  );
}

function isLeaguePayload(data) {
  return (
    Array.isArray(data) &&
    data.every(
      (league) =>
        isRecord(league) &&
        typeof league.id === "string" &&
        typeof league.name === "string",
    )
  );
}

function isOverviewPayload(data) {
  if (!isRecord(data) || !isRecordArray(data.lines)) return false;
  if (
    !hasOptionalRecordArray(data, "items") ||
    !hasOptionalRecordArray(data, "currencyDetails")
  ) return false;
  if (data.core != null) {
    if (!isRecord(data.core) || !hasOptionalRecordArray(data.core, "items")) {
      return false;
    }
    if (data.core.rates != null && !isRecord(data.core.rates)) return false;
  }
  return data.lines.every(
    (line) =>
      hasOptionalRecordArray(line, "implicitModifiers") &&
      hasOptionalRecordArray(line, "explicitModifiers") &&
      hasOptionalRecordArray(line, "mutatedModifiers") &&
      hasOptionalRecordArray(line, "tradeInfo") &&
      hasOptionalSparkline(line, "sparkline") &&
      hasOptionalSparkline(line, "sparkLine") &&
      hasOptionalSparkline(line, "paySparkLine") &&
      hasOptionalSparkline(line, "receiveSparkLine") &&
      hasOptionalSparkline(line, "lowConfidencePaySparkLine") &&
      hasOptionalSparkline(line, "lowConfidenceReceiveSparkLine"),
  );
}

function isWikiCargoPayload(data) {
  return Boolean(
    isRecord(data) &&
    isRecordArray(data.cargoquery) &&
    data.cargoquery.every(
      (entry) => entry.title == null || isRecord(entry.title),
    ),
  );
}

function isWikiImageMetadataPayload(data) {
  return Boolean(
    isRecord(data) &&
    isRecord(data.query) &&
    isRecordArray(data.query.pages) &&
    data.query.pages.every(
      (page) => page.imageinfo == null || isRecordArray(page.imageinfo),
    ),
  );
}

module.exports = {
  isLeaguePayload,
  isOverviewPayload,
  isWikiCargoPayload,
  isWikiImageMetadataPayload,
};
