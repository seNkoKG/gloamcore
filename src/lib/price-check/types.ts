import type { EconomyRow } from "../../types";

export type PoeItemRarity =
  | "normal"
  | "magic"
  | "rare"
  | "unique"
  | "currency"
  | "gem"
  | "divination-card"
  | "unknown";

export type PoeModifierKind =
  | "implicit"
  | "explicit"
  | "crafted"
  | "fractured"
  | "enchant"
  | "scourge"
  | "crucible"
  | "rune"
  | "imbued"
  | "veiled"
  | "pseudo"
  | "unknown";

export type TradeStatValueTransform =
  | "empty"
  | "empty-if-100"
  | "div-by-100";

export interface ParsedPoeModifier {
  id: string;
  kind: PoeModifierKind;
  text: string;
  normalizedText: string;
  values: number[];
  /** Numeric tokens before the Trade catalog applies roll semantics. */
  sourceValues?: number[];
  /** Parser boundary for stat lines emitted by one copied modifier group. */
  sourceGroupId?: string;
  selectedByDefault: boolean;
  source?: string;
  /** Advanced-description generation, when the clipboard proves it. */
  generation?:
    | "prefix"
    | "suffix"
    | "corrupted"
    | "eldritch"
    | "foulborn"
    | "vestigial";
  tier?: string;
  tags: string[];
  /** APT Advanced-description magnitude adjustment, as a percentage. */
  rollIncr?: number;
  /** APT's `Unscalable Value` marker excludes this source from rollIncr. */
  unscalable?: boolean;
  advanced: boolean;
  tradeId?: string;
  /** Compatible official Trade alternatives; Awakened submits these as OR. */
  tradeIds?: string[];
  /** Per-ID APT StatGroup value transforms for merged Trade alternatives. */
  tradeIdTransforms?: Record<string, TradeStatValueTransform>;
  tradeIdCandidates?: string[];
  /** Whether a larger (1), smaller (-1), or exact/discrete (0) roll is better. */
  tradeDirection?: -1 | 0 | 1;
  /** Some official Trade stats express their numeric range in reverse. */
  tradeInverted?: boolean;
  /** Awakened Stat.dp or a selected copied decimal token; controls roll rounding. */
  tradeDecimalPrecision?: boolean;
  /** Canonical possible bounds after the catalog's numeric semantics. */
  tradeBounds?: { min: number; max: number };
  /** Chronicle room state copied by the game: 1 = open, 2 = obstructed. */
  roomState?: 1 | 2;
  /** Exact option required by an official Trade option-valued stat. */
  tradeOption?: string | number;
  /** Unsubstituted canonical Awakened stat.ref used by source metadata rules. */
  tradeStatRef?: string;
  /** Canonical Awakened stat.ref rendered with the copied roll(s). */
  tradeLabel?: string;
  /** Exact matched Awakened translation rendered with the copied roll(s). */
  tradeDisplayText?: string;
  /** Pinned Awakened oil recipe for an anointment enchant. */
  anointmentOils?: string[];
}

export interface ParsedPoeSocketGroup {
  colors: string[];
  links: number;
}

export interface ParsedPoeItem {
  rawText: string;
  language: "en" | "unknown";
  valid: boolean;
  itemClass: string;
  rarity: PoeItemRarity;
  name: string;
  baseType: string;
  iconHint?: string;
  itemLevel?: number;
  requiredLevel?: number;
  quality?: number;
  gemLevel?: number;
  mapTier?: number;
  stackSize?: number;
  maxStackSize?: number;
  width?: number;
  height?: number;
  sockets: ParsedPoeSocketGroup[];
  links?: number;
  influences: string[];
  corrupted: boolean;
  /** Clipboard's Unmodifiable marker; Awakened treats it as corrupted state. */
  unmodifiable?: boolean;
  mirrored: boolean;
  split: boolean;
  identified: boolean;
  fractured: boolean;
  synthesised: boolean;
  veiled: boolean;
  foil: boolean;
  foulborn: boolean;
  vestigial?: boolean;
  replica: boolean;
  scourged: boolean;
  mapBlighted?: "Blighted" | "Blight-ravaged";
  /** Valdo map completion reward, without the clipboard's `Foil` prefix. */
  mapCompletionReward?: string;
  chartArea?: string;
  chartAreaTradeDiscriminator?: string;
  areaLevel?: number;
  areaItemQuantity?: number;
  areaItemRarity?: number;
  areaPackSize?: number;
  chartSulphur?: number;
  memoryStrands?: number;
  sentinelCharge?: number;
  talismanTier?: number;
  /** Map area carried by a Scrying Orb. */
  scryingMapArea?: string;
  heistContract?: {
    requiredJob?:
      | "Lockpicking"
      | "Brute Force"
      | "Perception"
      | "Demolition"
      | "Counter-Thaumaturgy"
      | "Trap Disarmament"
      | "Agility"
      | "Deception"
      | "Engineering";
    jobLevel?: number;
    targetValue?: "Priceless";
  };
  heistBlueprint?: {
    target?: "Enchants" | "Gems" | "Replicas" | "Trinkets";
    wingsRevealed?: number;
  };
  properties: Record<string, string>;
  requirements: Record<string, string>;
  modifiers: ParsedPoeModifier[];
  /** Independently searchable Expedition Logbook areas, in copied order. */
  logbookAreas?: ParsedPoeModifier[][];
  flavourText: string[];
  reminderText: string[];
  unknownSections: string[][];
  warnings: string[];
  errors: string[];
}

export type PriceCheckConfidence = "high" | "medium" | "low" | "none";
export type PriceCheckMatchKind = "exact" | "variant" | "base" | "fuzzy";

export interface PriceCheckMatch {
  row: EconomyRow;
  kind: PriceCheckMatchKind;
  score: number;
  reasons: string[];
}

export interface PriceCheckEvidence {
  source: "poe-ninja" | "faustus" | "local-history";
  label: string;
  chaosValue: number | null;
  divineValue: number | null;
  sampleCount: number | null;
  ageMs: number | null;
  stale: boolean;
  confidence: PriceCheckConfidence;
  detail: string;
}

export interface PriceCheckEstimate {
  chaosValue: number | null;
  divineValue: number | null;
  lowChaos: number | null;
  highChaos: number | null;
  confidence: PriceCheckConfidence;
  confidenceScore: number;
  label: "market estimate" | "rough estimate" | "no reliable estimate";
  reasons: string[];
  warnings: string[];
  evidence: PriceCheckEvidence[];
}

export interface PriceCheckModifierFilter {
  modifierId: string;
  tradeId?: string;
  /** Canonical Awakened stat ref retained independently of a Trade ID. */
  statRef?: string;
  /** Awakened/UI source tag retained through planning and serialization. */
  tag?: PoeModifierKind | "property" | "variant" | "vestigial" | "foulborn";
  /** Compatible official Trade alternatives; serialized as a count/min=1 group. */
  tradeIds?: string[];
  /** Per-ID APT StatGroup value transforms for merged Trade alternatives. */
  tradeIdTransforms?: Record<string, TradeStatValueTransform>;
  /** Awakened's NOT stat group, used for Valdo lethal-mod exclusion. */
  negated?: boolean;
  /** Human-readable label for calculated property filters. */
  label?: string;
  /** Copied/calculated value used when switching a property filter to Exact. */
  copiedValue?: number;
  /** Dedicated official Trade filter path for calculated item properties. */
  equipmentProperty?: {
    group: "armour_filters" | "weapon_filters" | "map_filters";
    key:
      | "ar"
      | "ev"
      | "es"
      | "ward"
      | "block"
      | "damage"
      | "aps"
      | "crit"
      | "dps"
      | "pdps"
      | "edps"
      | "map_iiq"
      | "map_iir"
      | "map_packsize"
      | "chart_sulphur"
      | "base_defence_percentile";
  };
  enabled: boolean;
  mode: "exact" | "range" | "presence";
  min?: number;
  max?: number;
  /** Known possible copied roll bounds when advanced item text exposes them. */
  bounds?: { min: number; max: number };
  direction?: -1 | 0 | 1;
  tradeInverted?: boolean;
  /** Exact option required by an official Trade option-valued stat. */
  tradeOption?: string | number;
  /** Pinned Awakened oil recipe for an anointment enchant. */
  anointmentOils?: string[];
  /** Awakened's special empty-or-crafted affix selector: any/prefix/suffix. */
  emptyModifier?: 0 | 1 | 2;
  /** Hidden in the compact overlay; available in the detailed advanced UI. */
  advancedOnly?: boolean;
  importance: "key" | "useful" | "optional";
  explanation: string;
}

export interface PriceCheckQueryPlan {
  identity: "exact" | "base";
  identityState: PriceCheckIdentityState;
  league: string;
  status: "available" | "securable" | "online" | "onlineleague" | "any";
  rollTolerance: number;
  filters: PriceCheckModifierFilter[];
  itemFilters: Record<string, string | number | boolean>;
  tradeQuery: Record<string, unknown>;
  tradeUrl: string;
  warnings: string[];
  /** Awakened chooses legacy bulk only when no stat is enabled and a tag exists. */
  tradeApi?: "trade" | "exchange";
}

export interface PriceCheckIdentitySearchState {
  label: string;
  query: Record<string, unknown>;
  disabled?: boolean;
  sub?: PriceCheckIdentitySearchState & { disabled: boolean };
}

export interface PriceCheckIdentityState {
  exact: PriceCheckIdentitySearchState;
  relaxed?: PriceCheckIdentitySearchState & { disabled: boolean };
  active: "exact" | "base";
}

export interface OfficialTradeListing {
  id: string;
  price: { amount: number; currency: string } | null;
  indexed: string;
  seller: { account: string; character: string };
  item: { name: string; baseType: string; icon: string };
  whisper: string;
  /** Number of same-seller listings collapsed into this displayed row. */
  groupedCount?: number;
  /** Aggregated stack stock for grouped ordinary Trade listings. */
  stock?: number;
  /** Sanitized legacy bulk ratio; present only for the exchange endpoint. */
  exchange?: {
    haveAmount: number;
    haveCurrency: string;
    itemAmount: number;
    itemCurrency: string;
    stock: number;
  };
}

export interface OfficialTradeListingsRequest {
  league: string;
  tradeQuery: Record<string, unknown>;
  api?: "trade" | "exchange";
  force?: boolean;
}

export interface OfficialTradeListingsResult {
  api?: "trade" | "exchange";
  listings: OfficialTradeListing[];
  total: number;
  searchId: string;
  fetchedAt: number;
  stale: boolean;
  error: string;
}

export type PriceCheckDashboardMode =
  | "similar"
  | "exact"
  | "bulk"
  | "base"
  | "I"
  | "II"
  | "III"
  | "IV"
  | "V";

export interface PriceCheckDashboardModifierSnapshot {
  modifierId: string;
  enabled: boolean;
  mode: PriceCheckModifierFilter["mode"];
  min?: number;
  max?: number;
}

/**
 * Minimal user-edited query state carried from the native overlay to the
 * dashboard. Main-process validation adds handoffId; parsed item/stat data is
 * deliberately rebuilt from the original clipboard capture.
 */
export interface PriceCheckDashboardSnapshot {
  captureId: number;
  capturedAt: number;
  handoffId?: number;
  league: string;
  mode: PriceCheckDashboardMode;
  identity: PriceCheckQueryPlan["identity"];
  status: PriceCheckQueryPlan["status"];
  rollTolerance: number;
  filters: PriceCheckDashboardModifierSnapshot[];
  itemFilters: Record<string, string | number | boolean>;
}

export type PriceCheckSessionStatus =
  | "idle"
  | "parsing"
  | "resolving"
  | "ready"
  | "invalid"
  | "error";

export interface PriceCheckSession {
  id: string;
  capturedAt: number;
  captureId?: number;
  league: string;
  status: PriceCheckSessionStatus;
  item: ParsedPoeItem | null;
  matches: PriceCheckMatch[];
  selectedMatchKey?: string;
  estimate: PriceCheckEstimate | null;
  query: PriceCheckQueryPlan | null;
  sourceFetchedAt?: number;
  sourceStale: boolean;
  /** Current public seller rows returned by GGG's official Trade service. */
  officialTrade?: OfficialTradeListingsResult;
  officialTradeLoading?: boolean;
  /** Query edits wait for an explicit Search, matching Awakened's workflow. */
  officialTradeNeedsSearch?: boolean;
  message?: string;
}

export interface PriceCheckHistoryEntry {
  id: string;
  checkedAt: number;
  league: string;
  item: ParsedPoeItem;
  estimate: PriceCheckEstimate;
  selectedMatchKey?: string;
}

export interface PriceCheckSettings {
  enabled: boolean;
  hotkey: string;
  shortcutWarning?: string;
  captureMode: "auto-copy";
  openNearCursor: boolean;
  closeOnBlur: boolean;
  pinByDefault: boolean;
  rollTolerance: number;
  defaultOnlineOnly: boolean;
  rememberHistory: boolean;
  maxHistory: number;
  showAdvanced: boolean;
}

export interface ClipboardItemCapture {
  text: string;
  capturedAt: number;
  captureId?: number;
  validPrefix: boolean;
  dashboardSnapshot?: PriceCheckDashboardSnapshot;
}

export const defaultPriceCheckSettings: PriceCheckSettings = {
  enabled: true,
  hotkey: "CommandOrControl+D",
  captureMode: "auto-copy",
  openNearCursor: true,
  closeOnBlur: true,
  pinByDefault: false,
  rollTolerance: 10,
  defaultOnlineOnly: true,
  rememberHistory: true,
  maxHistory: 50,
  showAdvanced: false,
};
