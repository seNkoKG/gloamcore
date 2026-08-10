import type { PoeStashRealm } from "../../types";

/**
 * Item families recognised by stash valuation. Each family maps to poe.ninja
 * economy categories (see stash-classify.ts) and to a breakdown label.
 */
export type StashFamily =
  | "currency"
  | "fragment"
  | "divination-card"
  | "fossil"
  | "resonator"
  | "scarab"
  | "essence"
  | "oil"
  | "catalyst"
  | "incubator"
  | "delirium-orb"
  | "invitation"
  | "tattoo"
  | "omen"
  | "djinn-coin"
  | "ducat"
  | "enshrouding-crystal"
  | "astrolabe"
  | "allflame-ember"
  | "wombgift"
  | "runegraft"
  | "artifact"
  | "vial"
  | "beast"
  | "map"
  | "blighted-map"
  | "blight-ravaged-map"
  | "unique-map"
  | "skill-gem"
  | "imbued-gem"
  | "cluster-jewel"
  | "unique-weapon"
  | "unique-armour"
  | "unique-accessory"
  | "unique-flask"
  | "unique-jewel"
  | "unique-relic"
  | "shrine-belt"
  | "unique-tincture"
  | "forbidden-jewel"
  | "memory"
  | "temple"
  | "base-type"
  | "other";

export interface StashFamilyOverview {
  label: string;
  /** poe.ninja category ids whose rows can price this family. */
  categoryIds: string[];
}

export interface StashItemValuation {
  identity: string;
  family: StashFamily;
  quantity: number;
  unitChaos: number;
  unitDivine: number;
  chaos: number;
  divine: number;
  priced: boolean;
  reason: "matched" | "unmatched" | "rare" | "magic" | "normal" | "unsupported";
  corrupted?: boolean;
  quality?: number;
}

export interface StashFamilyValue {
  chaos: number;
  divine: number;
  count: number;
}

export interface StashTabValuation {
  id: string;
  name: string;
  type: string;
  index: number;
  path: string[];
  itemCount: number;
  pricedItemCount: number;
  unpricedItemCount: number;
  chaos: number;
  divine: number;
  pricedChaos: number;
  families: Partial<Record<StashFamily, StashFamilyValue>>;
  items: StashItemValuation[];
}

export interface StashTopItem {
  name: string;
  family: StashFamily;
  quantity: number;
  unitChaos: number;
  chaos: number;
  divine: number;
}

/** Compact per-tab record kept inside persisted snapshots. */
export interface StashTabSummaryValue {
  id: string;
  name: string;
  path: string[];
  itemCount: number;
  pricedItemCount: number;
  unpricedItemCount: number;
  chaos: number;
  divine: number;
  families: Partial<Record<StashFamily, StashFamilyValue>>;
}

export interface StashSnapshot {
  version: 1;
  createdAt: number;
  league: string;
  realm: PoeStashRealm;
  tabCount: number;
  itemCount: number;
  pricedItemCount: number;
  unpricedItemCount: number;
  chaos: number;
  divine: number;
  pricedChaos: number;
  tabs: StashTabSummaryValue[];
  families: Partial<Record<StashFamily, StashFamilyValue>>;
  topItems: StashTopItem[];
  metadata: {
    /** Newest poe.ninja observation timestamp used by this snapshot. */
    pricesAt: number;
    /** True when at least one pricing overview behind this snapshot was stale. */
    pricesStale: boolean;
    overviewCount: number;
  };
}

export interface StashSession {
  version: 1;
  realm: PoeStashRealm;
  league: string;
  lastSyncAt: number;
  autoSyncMinutes: 0 | 15 | 30 | 60;
  tabCount: number;
}

export interface StashSnapshotHistory {
  version: 1;
  snapshots: StashSnapshot[];
}