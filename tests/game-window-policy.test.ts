import { describe, expect, it } from "vitest";

const {
  POE1_PROCESS_NAMES,
  toolkitMacroTargets,
} = require("../electron/game-window-policy.cjs");

describe("toolkit macro game-window policy", () => {
  it("binds every supported executable to the exact game title", () => {
    const targets = toolkitMacroTargets();
    expect(targets).toHaveLength(POE1_PROCESS_NAMES.length);
    expect(targets.map(({ processName }) => processName))
      .toEqual(POE1_PROCESS_NAMES);
    expect(targets.map(({ title }) => title)).toEqual(
      Array(POE1_PROCESS_NAMES.length).fill("Path of Exile"),
    );
  });

  it("returns immutable policy values", () => {
    const targets = toolkitMacroTargets();
    expect(Object.isFrozen(targets)).toBe(true);
    expect(targets.every(Object.isFrozen)).toBe(true);
  });
});
