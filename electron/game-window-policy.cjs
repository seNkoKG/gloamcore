"use strict";

const POE1_PROCESS_NAMES = Object.freeze([
  "PathOfExile.exe",
  "PathOfExileSteam.exe",
  "PathOfExileEGS.exe",
  "PathOfExile_x64.exe",
  "PathOfExile_x64Steam.exe",
  "PathOfExile_x64EGS.exe",
]);
const POE1_MACRO_TARGETS = Object.freeze(
  POE1_PROCESS_NAMES.map((processName) =>
    Object.freeze({ processName, title: "Path of Exile" }),
  ),
);

function toolkitMacroTargets() {
  return POE1_MACRO_TARGETS;
}

module.exports = {
  POE1_PROCESS_NAMES,
  toolkitMacroTargets,
};
