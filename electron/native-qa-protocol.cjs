"use strict";

function nativeQaAckMatches(ack, phase, expected = {}) {
  if (!ack || typeof ack !== "object" || ack.phase !== phase) return false;
  return Object.entries(expected).every(([key, value]) => (
    Object.prototype.hasOwnProperty.call(ack, key) && ack[key] === value
  ));
}

module.exports = { nativeQaAckMatches };
