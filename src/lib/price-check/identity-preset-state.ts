import type { PriceCheckDashboardMode } from "./types";

export interface PriceCheckIdentityItemFilterState {
  identityRelaxed?: boolean;
  identitySub?: boolean;
}

export type PriceCheckIdentityPresetStates = Partial<Record<
  PriceCheckDashboardMode,
  PriceCheckIdentityItemFilterState
>>;

export function identityItemFilterState(
  itemFilters: Readonly<Record<string, string | number | boolean>>,
): PriceCheckIdentityItemFilterState {
  return {
    ...(typeof itemFilters.identityRelaxed === "boolean"
      ? { identityRelaxed: itemFilters.identityRelaxed }
      : {}),
    ...(typeof itemFilters.identitySub === "boolean"
      ? { identitySub: itemFilters.identitySub }
      : {}),
  };
}

export function rememberIdentityPresetState(
  states: PriceCheckIdentityPresetStates,
  mode: PriceCheckDashboardMode,
  itemFilters: Readonly<Record<string, string | number | boolean>>,
): PriceCheckIdentityPresetStates {
  return {
    ...states,
    [mode]: identityItemFilterState(itemFilters),
  };
}

export function restoreIdentityPresetState(
  states: PriceCheckIdentityPresetStates,
  mode: PriceCheckDashboardMode,
  presetDefaults: Readonly<Record<string, string | number | boolean>>,
) {
  return {
    ...presetDefaults,
    ...(states[mode] || {}),
  };
}
