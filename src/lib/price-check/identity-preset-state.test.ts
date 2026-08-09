import { describe, expect, it } from "vitest";
import {
  rememberIdentityPresetState,
  restoreIdentityPresetState,
  type PriceCheckIdentityPresetStates,
} from "./identity-preset-state";

describe("price-check identity state per preset", () => {
  it("restores Similar and Base identity choices independently", () => {
    let states: PriceCheckIdentityPresetStates = {};
    states = rememberIdentityPresetState(states, "similar", {
      identityRelaxed: false,
      itemLevel: 86,
    });
    states = rememberIdentityPresetState(states, "base", {
      identityRelaxed: true,
      corrupted: false,
    });

    expect(restoreIdentityPresetState(states, "similar", {
      identityRelaxed: true,
      itemLevel: 84,
    })).toEqual({
      identityRelaxed: false,
      itemLevel: 84,
    });
    expect(restoreIdentityPresetState(states, "base", {
      identityRelaxed: false,
      corrupted: false,
    })).toEqual({
      identityRelaxed: true,
      corrupted: false,
    });
  });

  it("retains a hidden Chart sub choice while the parent is exact", () => {
    let states: PriceCheckIdentityPresetStates = {};
    states = rememberIdentityPresetState(states, "exact", {
      identityRelaxed: false,
      identitySub: true,
    });
    expect(restoreIdentityPresetState(states, "exact", {
      identityRelaxed: true,
      identitySub: false,
      areaLevel: 69,
    })).toEqual({
      identityRelaxed: false,
      identitySub: true,
      areaLevel: 69,
    });
    expect(restoreIdentityPresetState({}, "exact", {
      identityRelaxed: true,
      identitySub: false,
    })).toEqual({ identityRelaxed: true, identitySub: false });
  });
});
