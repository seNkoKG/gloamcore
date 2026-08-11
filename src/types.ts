export type DataSource =
  | "exchange"
  | "stash-item"
  | "stash-currency"
  | "faustus";
export type CategorySource = "exchange" | "item" | "dual";
export type ValueDisplay = "adaptive" | "chaos" | "divine";
export type Density = "compact" | "comfortable";
export type AppMode =
  | "market"
  | "price-check"
  | "knowledge"
  | "watchlist"
  | "toolkit"
  | "planner"
  | "stash";
export type TrendFilter = "all" | "gainers" | "losers" | "stable";
export type SortDirection = "asc" | "desc";
export type SortKey =
  | "name"
  | "value"
  | "change"
  | "volume"
  | "listed"
  | "level"
  | "quality";

export interface EconomyLeague {
  id: string;
  name: string;
}

export interface CategoryDefinition {
  id: string;
  label: string;
  group: "General" | "Equipment & gems" | "Atlas" | "Crafting";
  apiType: string;
  source: CategorySource;
  icon: string;
  description: string;
}

export interface Sparkline {
  totalChange?: number | null;
  data?: Array<number | null>;
}

export interface ModifierLine {
  text?: string;
  optional?: boolean;
}

export interface RawExchangeItem {
  id: string;
  name: string;
  image?: string;
  icon?: string;
  category?: string;
  detailsId?: string;
}

export interface RawExchangeLine {
  id: string;
  primaryValue?: number;
  volumePrimaryValue?: number;
  maxVolumeCurrency?: string;
  maxVolumeRate?: number;
  sparkline?: Sparkline;
}

export interface RawExchangeOverview {
  core?: {
    items?: RawExchangeItem[];
    rates?: Record<string, number>;
    primary?: string;
    secondary?: string;
  };
  lines?: RawExchangeLine[];
  items?: RawExchangeItem[];
}

export interface RawStashCurrencyLine {
  currencyTypeName?: string;
  detailsId?: string;
  chaosEquivalent?: number;
  pay?: {
    value?: number;
    count?: number;
    listing_count?: number;
  };
  receive?: {
    value?: number;
    count?: number;
    listing_count?: number;
  };
  paySparkLine?: Sparkline;
  receiveSparkLine?: Sparkline;
  lowConfidencePaySparkLine?: Sparkline;
  lowConfidenceReceiveSparkLine?: Sparkline;
}

export interface RawCurrencyDetail {
  id?: number;
  name?: string;
  icon?: string;
  tradeId?: string;
}

export interface RawStashCurrencyOverview {
  lines?: RawStashCurrencyLine[];
  currencyDetails?: RawCurrencyDetail[];
}

export interface RawItemLine {
  id: number | string;
  name?: string;
  baseType?: string;
  itemType?: string;
  itemClass?: number;
  detailsId?: string;
  chaosValue?: number;
  divineValue?: number;
  exaltedValue?: number;
  variant?: string;
  corrupted?: boolean;
  links?: number;
  gemLevel?: number;
  gemQuality?: number;
  levelRequired?: number;
  stackSize?: number;
  mapTier?: number;
  mapRegion?: string;
  count?: number;
  listingCount?: number;
  icon?: string;
  sparkLine?: Sparkline;
  implicitModifiers?: ModifierLine[];
  explicitModifiers?: ModifierLine[];
  mutatedModifiers?: ModifierLine[];
  flavourText?: string;
  metadata?: Record<string, unknown>;
  tradeInfo?: Array<{ mod?: string; min?: number; max?: number }>;
  tradeFilter?: {
    query?: Record<string, unknown>;
  };
}

export interface RawItemOverview {
  lines?: RawItemLine[];
}

export interface EconomyRow {
  key: string;
  id: string;
  name: string;
  icon?: string;
  categoryId: string;
  categoryLabel: string;
  source: DataSource;
  detailsId?: string;
  baseType?: string;
  itemType?: string;
  variant?: string;
  chaosValue: number;
  divineValue: number;
  exaltedValue?: number;
  change: number | null;
  sparkline: Array<number | null>;
  volume: number | null;
  listingCount: number | null;
  observationCount: number | null;
  maxVolumeCurrency?: string;
  maxVolumeRate?: number;
  levelRequired?: number;
  links?: number;
  gemLevel?: number;
  gemQuality?: number;
  corrupted?: boolean;
  mapTier?: number;
  mapRegion?: string;
  stackSize?: number;
  flavourText?: string;
  implicitModifiers: ModifierLine[];
  explicitModifiers: ModifierLine[];
  mutatedModifiers: ModifierLine[];
  metadata?: Record<string, unknown>;
  tradeInfo?: Array<{ mod?: string; min?: number; max?: number }>;
  tradeFilter?: {
    query?: Record<string, unknown>;
  };
  faustus?: FaustusMetrics;
  lowConfidence: boolean;
  confidenceReason?: string;
}

export interface NormalizedOverview {
  rows: EconomyRow[];
  core: {
    primary: string;
    secondary: string;
    rates: Record<string, number>;
    items: Record<string, RawExchangeItem>;
  };
}

export interface CacheEnvelope<T> {
  data: T;
  fetchedAt: number;
  expiresAt: number;
  stale: boolean;
  cache: "fresh" | "network" | "revalidated" | "stale" | "browser" | "mobile";
  error?: string;
}

export interface ItemTooltipRequest {
  name: string;
  baseType?: string;
  categoryId?: string;
  detailsId?: string;
}

export interface RawWikiCargoResponse {
  cargoquery?: Array<{
    title?: Record<string, unknown>;
  }>;
  error?: {
    code?: string;
    info?: string;
  };
}

export interface RawWikiImageInfoResponse {
  query?: {
    pages?: Array<{
      title?: string;
      missing?: boolean;
      imageinfo?: Array<{
        url?: string;
        thumburl?: string;
        dataUrl?: string;
        mime?: string;
        width?: number;
        height?: number;
        thumbwidth?: number;
        thumbheight?: number;
      }>;
    }>;
  };
  error?: {
    code?: string;
    info?: string;
  };
}

export interface ItemTooltipData {
  name: string;
  baseType?: string;
  itemClass?: string;
  rarity?: string;
  frameType?: string;
  description?: string;
  helpText?: string;
  flavourText?: string;
  implicitMods: string[];
  explicitMods: string[];
  enchantMods: string[];
  requiredLevel?: number;
  dropLevel?: number;
  metadataId?: string;
  inventoryIcon?: string;
  dropText?: string;
  dropAreas: string[];
  dropMonsters: string[];
  acquisitionTags: string[];
  releaseVersion?: string;
  dropEnabled?: boolean;
  source: "poewiki";
}

export interface KnowledgeSearchRequest {
  query: string;
  limit?: number;
  force?: boolean;
}

export interface RawKnowledgeSearchResponse {
  items: RawWikiCargoResponse;
  modifiers: RawWikiCargoResponse;
  images?: RawWikiImageInfoResponse;
}

export interface KnowledgeEntry {
  key: string;
  kind: "item" | "modifier";
  name: string;
  icon?: string;
  baseType?: string;
  itemClass?: string;
  rarity?: string;
  frameType?: string;
  description?: string;
  requiredLevel?: number;
  dropLevel?: number;
  metadataId?: string;
  dropText?: string;
  dropAreas: string[];
  dropMonsters: string[];
  acquisitionTags: string[];
  releaseVersion?: string;
  dropEnabled?: boolean;
  modifierId?: string;
  modifierName?: string;
  modifierType?: string;
  modifierDomain?: string;
  modifierDomainId?: number;
  modifierGroups: string[];
  statText?: string;
  tags: string[];
  tier?: string;
  generationType?: string;
  generationTypeId?: number;
  source: "poewiki";
}

export interface FaustusItemSeed {
  id: string;
  name: string;
  metadataId?: string;
}

export interface FaustusOverviewRequest {
  league: string;
  items: FaustusItemSeed[];
  force?: boolean;
}

export interface RawFaustusMarket {
  league?: string;
  market_id?: string;
  market_pair?: string[];
  volume_traded?: Record<string, number>;
  lowest_stock?: Record<string, number>;
  highest_stock?: Record<string, number>;
  lowest_ratio?: Record<string, number>;
  highest_ratio?: Record<string, number>;
}

export interface RawFaustusHour {
  id: number;
  markets: RawFaustusMarket[];
}

export interface RawFaustusOverview {
  latestHour: number;
  items: Array<FaustusItemSeed & { metadataId?: string }>;
  hours: RawFaustusHour[];
}

export interface FaustusMetrics {
  hour: number;
  minimumChaos: number;
  maximumChaos: number;
  traded: number;
  minimumStock?: number;
  maximumStock?: number;
  reference: "chaos" | "divine";
}

export interface OverviewRequest {
  league: string;
  type: string;
  source: DataSource;
  force?: boolean;
}

export interface DesktopSettings {
  alwaysOnTop: boolean;
  opacity: number;
  compact: boolean;
  clickThrough: boolean;
  startMinimized: boolean;
  autoCheckUpdates: boolean;
  shortcuts: DesktopShortcutSettings;
  priceCheck: import("./lib/price-check/types").PriceCheckSettings;
  /** Runtime-only warning when Windows refused a configured global binding. */
  shortcutWarning?: string;
  /** Monotonic runtime snapshot version; never persisted or accepted in patches. */
  settingsRevision?: number;
  bounds?: unknown;
  expandedBounds?: unknown;
}

export interface DesktopShortcutSettings {
  toggleWidget: string;
  toggleClickThrough: string;
  instantSearch: string;
  focusItemSearch: string;
  gameDataSearch: string;
}

export type DesktopSettingsPatch = Partial<
  Omit<
    DesktopSettings,
    "priceCheck" | "shortcuts" | "settingsRevision" | "shortcutWarning"
  >
> & {
  shortcuts?: Partial<DesktopShortcutSettings>;
  priceCheck?: Partial<import("./lib/price-check/types").PriceCheckSettings>;
};

export interface WatchEntry {
  key: string;
  row: EconomyRow;
  league: string;
  addedAt: number;
  marketFetchedAt?: number;
  marketStale?: boolean;
  targetPrice?: number;
  targetUnit?: "chaos" | "divine";
  note?: string;
  lastAlertState?: "above" | "below";
}

export interface FilterState {
  query: string;
  foulborn: string;
  gemType: string;
  itemType: string;
  level: string;
  links: string;
  corruption: string;
  gemLevel: string;
  gemQuality: string;
  variant: string;
  mapTier: string;
  trend: TrendFilter;
  includeLowConfidence: boolean;
  minPrice: string;
  maxPrice: string;
}

export interface SortState {
  key: SortKey;
  direction: SortDirection;
}

export interface AppPreferences {
  league?: string;
  categoryId: string;
  sourceByCategory: Record<string, DataSource>;
  valueDisplay: ValueDisplay;
  density: Density;
  sidebarCollapsed: boolean;
  refreshMinutes: number;
  watchlist: WatchEntry[];
  lastViewed?: string[];
}

export interface QuickSearchRow {
  key: string;
  name: string;
  icon?: string;
  categoryId: string;
  categoryLabel: string;
  source: DataSource;
  league: string;
  chaosValue: number;
  divineValue: number;
  change: number | null;
  volume: number | null;
  listingCount: number | null;
  variant?: string;
  baseType?: string;
  lowConfidence: boolean;
}

export interface SurfaceAlert {
  key: string;
  name: string;
  icon?: string;
  current: number;
  target: number;
  unit: "chaos" | "divine";
  categoryId: string;
  source: DataSource;
  league: string;
}

export type UpdateStatus =
  | "unconfigured"
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  version?: string;
  progress?: number;
  message: string;
  checkedAt?: number;
  feedConfigured: boolean;
}

export interface SurfaceState {
  league: string;
  categoryLabel: string;
  fetchedAt?: number;
  stale: boolean;
  loading: boolean;
  divineChaos?: number;
  alertCount: number;
  alerts: SurfaceAlert[];
  topMovers: QuickSearchRow[];
  searchRows: QuickSearchRow[];
  update: UpdateState;
}

export interface PriceCheckOverlayPanel {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PriceCheckOverlayState {
  revision: number;
  active: boolean;
  attached: boolean;
  targetActive: boolean;
  interactive: boolean;
  shapeApplied: boolean;
  panel: PriceCheckOverlayPanel | null;
  message?: string;
}

export interface ToolkitTextFile {
  path: string;
  name: string;
  text: string;
}

export interface ToolkitCheckpoint {
  id: string;
  label: string;
  createdAt: number;
}

export interface PassiveTreeNodeData {
  id: number;
  name: string;
  stats: string[];
  x: number;
  y: number;
  out: number[];
  in: number[];
  classStartIndex: number | null;
  classStartIds: number[];
  ascendancyName: string | null;
  notable: boolean;
  keystone: boolean;
  mastery: boolean;
  jewelSocket: boolean;
  multipleChoice: boolean;
  multipleChoiceOption?: boolean;
  bloodline: boolean;
  reminderText?: string[];
  flavourText?: string[];
  grantedPassivePoints?: number;
  masteryEffects?: Record<number, {
    stats: string[];
    reminderText: string[];
  }>;
  masteryEffectOrder?: number[];
  selectedMasteryEffect?: number | null;
  isTattoo?: boolean;
  isBlighted?: boolean;
  recipe?: string[];
  groupId?: number;
  orbit?: number;
  orbitIndex?: number;
  isAscendancyStart?: boolean;
  expansionJewel?: PassiveTreeExpansionJewelData | null;
  spriteActive?: PassiveTreeSpriteRect | null;
  spriteInactive?: PassiveTreeSpriteRect | null;
}

export interface PassiveTreeExpansionJewelData {
  size: number;
  index: number;
  proxy: number;
  parent?: number;
}

export interface PassiveTreeSpriteRect {
  sheet: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PassiveTreeGroupData {
  id: number;
  x: number;
  y: number;
  orbits: number[];
  background: { image: string; isHalfImage: boolean } | null;
  ascendancyName: string | null;
  isAscendancyStart: boolean;
}

export interface PassiveTreeVisualAssets {
  sheets: Record<string, { src: string; width: number; height: number }>;
  backgrounds: Record<string, PassiveTreeSpriteRect>;
  frames: Record<string, PassiveTreeSpriteRect>;
  startNodes: Record<string, PassiveTreeSpriteRect>;
  groupBackgrounds: Record<string, PassiveTreeSpriteRect>;
  ascendancies: Record<string, PassiveTreeSpriteRect>;
}

export interface PassiveTreeClusterNodeVisual {
  name: string;
  stats: string[];
  notable?: boolean;
  keystone?: boolean;
  mastery?: boolean;
  reminderText?: string[];
  flavourText?: string[];
  spriteActive?: PassiveTreeSpriteRect | null;
  spriteInactive?: PassiveTreeSpriteRect | null;
}

export interface PassiveTreeClusterSkillData extends PassiveTreeClusterNodeVisual {
  id: string;
  enchant: string[];
  masterySpriteActive?: PassiveTreeSpriteRect | null;
  masterySpriteInactive?: PassiveTreeSpriteRect | null;
}

export interface PassiveTreeClusterJewelData {
  baseType: string;
  size: "Small" | "Medium" | "Large" | string;
  sizeIndex: number;
  minNodes: number;
  maxNodes: number;
  smallIndices: number[];
  notableIndices: number[];
  socketIndices: number[];
  totalIndices: number;
  skills: Record<string, PassiveTreeClusterSkillData>;
}

export interface PassiveTreeClusterData {
  skillsPerOrbit: number[];
  orbitRadii: number[];
  orbitAngles: number[][];
  jewels: Record<string, PassiveTreeClusterJewelData>;
  notableSortOrder: Record<string, number>;
  keystones: string[];
  orbitOffsets: Record<number, Record<number, number>>;
  definitions: Record<string, PassiveTreeClusterNodeVisual>;
  proxies: Record<number, {
    id: number;
    groupId: number;
    x: number;
    y: number;
    orbit: number;
    orbitIndex: number;
  }>;
  socketTemplates: Array<{
    id: number;
    name: string;
    groupId: number;
    expansionJewel: PassiveTreeExpansionJewelData;
    spriteActive?: PassiveTreeSpriteRect | null;
    spriteInactive?: PassiveTreeSpriteRect | null;
  }>;
  tattoos: Record<string, PassiveTreeClusterNodeVisual>;
}

export interface PassiveTreeData {
  game: "poe1" | "poe2";
  version: string;
  sourcePath: string;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  size?: number;
  classes: Array<{
    id: number;
    name: string;
    ascendancies: Array<{ id: number; internalId: string; name: string }>;
  }>;
  alternateAscendancies?: Array<{ id: number; internalId: string; name: string }>;
  points: { total: number; ascendancy: number };
  groups?: PassiveTreeGroupData[];
  assets?: PassiveTreeVisualAssets;
  cluster?: PassiveTreeClusterData;
  nodes: PassiveTreeNodeData[];
}

export interface PoeCharacterImportRequest {
  mode: "public" | "oauth";
  realm: "pc" | "xbox" | "sony" | "poe2";
  accountName?: string;
  accessToken?: string;
  character?: string;
}

export interface PoeCharacterSummary {
  id?: string;
  name: string;
  realm?: string;
  class: string;
  league?: string;
  level: number;
  current?: boolean;
}

export type PoeStashRealm = "pc" | "xbox" | "sony";

export interface StashSyncRequest {
  realm: PoeStashRealm;
  league: string;
  accessToken?: string;
}

export interface PoeStashLeague {
  id: string;
  name: string;
  realm: PoeStashRealm;
}

export interface PoeStashTabSummary {
  id: string;
  name: string;
  type: string;
  index: number;
  /** Folder breadcrumb of parent stash tabs, when the tab lives inside one. */
  path?: string[];
}

/** Minimal view of the GGG stash API item JSON used by stash valuation. */
export interface GGGStashItem {
  id?: string;
  name?: string;
  typeLine?: string;
  baseType?: string;
  ilvl?: number;
  frameType?: number;
  stackSize?: number;
  maxStackSize?: number;
  corrupted?: boolean;
  support?: boolean;
  inventoryId?: string;
  properties?: Array<{
    name?: string;
    values?: Array<Array<string | number>>;
    displayMode?: number;
  }>;
  category?: Record<string, string[]>;
  note?: string;
  icon?: string;
}

export interface PoeStashTabDetail {
  id: string;
  name: string;
  type: string;
  index: number;
  items: GGGStashItem[];
  /** Folder breadcrumb of parent stash tabs, when the tab lives inside one. */
  path?: string[];
}

export interface StashProgressEvent {
  index: number;
  total: number;
  tabName: string;
  path?: string[];
}

export interface ToolkitWorkspace {
  version: 1;
  macros: Array<{
    id: string;
    label: string;
    hotkey: string;
    text: string;
    enabled: boolean;
    scope: "poe1" | "poe2" | "both";
  }>;
  cheatSheets: Array<{
    id: string;
    title: string;
    category: string;
    body: string;
    url: string;
    image: string;
    pinned: boolean;
  }>;
  theme: { accent: string; background: string; density: "compact" | "comfortable" };
  whiteboard: {
    strokes: unknown[];
    snapshots: Array<{ id: string; name: string; createdAt: number; strokes: unknown[] }>;
  };
  overlayBounds: Partial<Record<"cheats" | "whiteboard", { x: number; y: number; width: number; height: number }>>;
  stashScroll: { enabled: boolean; modifier: "Ctrl" | "Shift" | "Alt" };
  plugins: ToolkitPlugin[];
}

export interface ToolkitPlugin {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  game: "poe1" | "poe2";
  permissions: {
    currentItem: boolean;
    gameCapture: boolean;
    openExternal: boolean;
  };
  /** Host-owned, namespaced key/value data. Remote frames never see another plugin's data. */
  storage: Record<string, string>;
}

export type SurfaceAction =
  | { type: "hide-surface" }
  | { type: "open-dashboard" }
  | {
      type: "open-price-check-dashboard";
      snapshot?: import("./lib/price-check/types").PriceCheckDashboardSnapshot;
    }
  | {
      type: "consume-price-check-dashboard-handoff";
      captureId: number;
      handoffId: number;
    }
  | { type: "open-quick-search" }
  | { type: "open-watchlist" }
  | { type: "refresh-market" }
  | { type: "check-update" }
  | { type: "install-update" }
  | { type: "quit" }
  | { type: "hide-price-check" }
  | { type: "open-price-check" }
  | { type: "set-price-check-pinned"; value: boolean }
  | {
      type: "set-price-check-panel-height";
      height: number;
      captureId: number;
    }
  | {
      type: "set-price-check-panel-position";
      x: number;
      y: number;
      captureId: number;
      /** Persist the normalized anchor only when the pointer drag finishes. */
      commit: boolean;
    }
  | {
      type: "open-row";
      league: string;
      categoryId: string;
      source: DataSource;
      rowKey: string;
    };

export type ShortcutEvent =
  | { type: "always-on-top" | "click-through"; value: boolean }
  | { type: "refresh-market" }
  | { type: "open-watchlist" }
  | { type: "open-price-check-dashboard" }
  | {
      type: "open-row";
      league: string;
      categoryId: string;
      source: DataSource;
      rowKey: string;
    };

export type PobEngineScalar = number | string | boolean;

export interface PobEngineSkillGroup {
  index: number;
  label: string;
  mainActiveSkill: number;
  activeSkills: Array<{ index: number; name: string; parts: string[] }>;
}

export interface PobEngineFailure {
  ok: false;
  authoritative: false;
  code: string;
  message: string;
  recoverable?: boolean;
  detail?: string;
  available?: false;
  capability?: "unavailable";
  supportedVersions?: string[];
}

export interface PobEngineDiagnosticSuccess {
  ok: true;
  authoritative: true;
  available: true;
  capability: "authoritative-local-pob";
  engine: {
    number: string;
    branch: string;
    platform: string;
  };
  updatePolicy: string;
  isolation: {
    freshProcessPerRequest: true;
    installedPobReadOnly: true;
    noGuiLaunch: true;
    timeoutMilliseconds: number;
  };
}

export type PobEngineDiagnostic = PobEngineDiagnosticSuccess | PobEngineFailure;

export interface PobEngineCalculationSuccess {
  ok: true;
  authoritative: true;
  engine: {
    name: string;
    version: string;
    branch: string;
    platform: string;
    runtimeArchitecture: string;
  };
  calculation: {
    scalarCount: number;
    stats: Record<string, PobEngineScalar>;
    warnings: string[];
    mainSocketGroup: number | null;
    mainSkillName: string | null;
    skillGroups: PobEngineSkillGroup[];
    className: string | null;
    ascendancyName: string | null;
    targetVersion: string | null;
    engineMilliseconds: number | null;
  };
  durationMilliseconds: number;
  isolation: {
    freshProcess: true;
    installedPobReadOnly: true;
    noGuiLaunch: true;
  };
}

export type PobEngineCalculationResult = PobEngineCalculationSuccess | PobEngineFailure;

export interface PobNodePower {
  id: number;
  name: string;
  type: string;
  distance: number;
  allocated: boolean;
  offence: number;
  defence: number;
  singleStat: number;
  pathPower: number | null;
}

export interface PobNodeAnalysisSuccess {
  ok: true;
  authoritative: true;
  engine: PobEngineCalculationSuccess["engine"];
  analysis: {
    maxPoints: number;
    nodePowers: PobNodePower[];
    powerMax: Record<string, number>;
    warnings: string[];
    engineMilliseconds: number | null;
  };
  durationMilliseconds: number;
  isolation: PobEngineCalculationSuccess["isolation"];
}

export type PobNodeAnalysisResult = PobNodeAnalysisSuccess | PobEngineFailure;

export interface PobTimelessAffectedNode {
  id: number;
  name: string;
  type: string;
  transformedName: string;
  stats: string[];
  allocated: boolean;
}

export interface PobTimelessPreviewSuccess {
  ok: true;
  authoritative: true;
  engine: PobEngineCalculationSuccess["engine"];
  preview: {
    jewelType: number;
    jewelName: string;
    seed: number;
    minimumSeed: number;
    maximumSeed: number;
    seedStep: number;
    socketId: number;
    affectedNodes: PobTimelessAffectedNode[];
    warnings: string[];
    engineMilliseconds: number | null;
  };
  durationMilliseconds: number;
  isolation: PobEngineCalculationSuccess["isolation"];
}

export type PobTimelessPreviewResult = PobTimelessPreviewSuccess | PobEngineFailure;

export interface PobTimelessModifierCatalogEntry {
  id: string;
  name: string;
  stats: string[];
  kind: "replacement" | "augmentation";
}

export interface PobTimelessHuntHit {
  id: string;
  name: string;
  count: number;
  value: number;
  weightedValue: number;
  nodes: Array<{ id: number; name: string }>;
}

export interface PobTimelessHuntResultEntry {
  seed: number;
  socketId: number;
  score: number;
  hits: PobTimelessHuntHit[];
}

export interface PobTimelessHuntSuccess {
  ok: true;
  authoritative: true;
  engine: PobEngineCalculationSuccess["engine"];
  hunt: {
    jewelType: number;
    jewelName: string;
    minimumSeed: number;
    maximumSeed: number;
    seedStep: number;
    socketId: number;
    socketIds: number[];
    socketCount: number;
    catalog: PobTimelessModifierCatalogEntry[];
    searchedSeeds: number;
    candidateNodes: number;
    scope: "allocated" | "reachable" | "radius";
    maxPoints: number;
    results: PobTimelessHuntResultEntry[];
    warnings: string[];
    engineMilliseconds: number | null;
  };
  durationMilliseconds: number;
  isolation: PobEngineCalculationSuccess["isolation"];
}

export type PobTimelessHuntResult = PobTimelessHuntSuccess | PobEngineFailure;

export interface PobEngineCharacterImportSuccess {
  ok: true;
  authoritative: true;
  xml: string;
  engine: {
    name: string;
    version: string;
    branch: string;
    platform: string;
    runtimeArchitecture: string;
  };
  warnings: string[];
  calculation: {
    scalarCount: number;
    stats: Record<string, PobEngineScalar>;
    mainSocketGroup: number | null;
    mainSkillName: string | null;
    skillGroups: PobEngineSkillGroup[];
    className: string | null;
    ascendancyName: string | null;
    targetVersion: string | null;
  };
  engineMilliseconds: number | null;
  durationMilliseconds: number;
  isolation: {
    freshProcess: true;
    installedPobReadOnly: true;
    noGuiLaunch: true;
  };
}

export type PobEngineCharacterImportResult = PobEngineCharacterImportSuccess | PobEngineFailure;

export interface PoeOAuthStatus {
  connected: boolean;
  scope: string;
  username?: string;
}

export interface PoeOAuthConnection {
  scope: string;
  username?: string;
  expiresAt: number | null;
}

export interface EmbeddedViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PoeWidgetBridge {
  getLeagues(options?: { force?: boolean }): Promise<CacheEnvelope<EconomyLeague[]>>;
  getOverview(
    request: OverviewRequest,
  ): Promise<
    CacheEnvelope<RawExchangeOverview | RawItemOverview | RawStashCurrencyOverview>
  >;
  getItemTooltip(
    request: ItemTooltipRequest,
  ): Promise<CacheEnvelope<RawWikiCargoResponse>>;
  searchKnowledge(
    request: KnowledgeSearchRequest,
  ): Promise<CacheEnvelope<RawKnowledgeSearchResponse>>;
  readClipboardItem(): Promise<import("./lib/price-check/types").ClipboardItemCapture>;
  getPendingPriceCheckCapture(): Promise<
    import("./lib/price-check/types").ClipboardItemCapture | null
  >;
  getPriceCheckOverlayState?(): Promise<PriceCheckOverlayState>;
  getTradeStatCatalog?(): Promise<string>;
  getOfficialTradeListings?(
    request: import("./lib/price-check/types").OfficialTradeListingsRequest,
  ): Promise<import("./lib/price-check/types").OfficialTradeListingsResult>;
  openExternal(url: string): Promise<void>;
  openWealthyExile(bounds?: EmbeddedViewBounds): Promise<boolean>;
  hideWealthyExile(): Promise<boolean>;
  controlWealthyExile(action: "reload"): Promise<boolean>;
  openToolkitText(kind: "filter" | "build" | "text"): Promise<ToolkitTextFile | null>;
  openToolkitImage(): Promise<{ name: string; dataUrl: string } | null>;
  saveToolkitText(request: {
    path?: string;
    text: string;
    suggestedName?: string;
    kind?: "filter" | "build" | "text";
  }): Promise<{ path: string; name: string } | null>;
  createToolkitCheckpoint(request: {
    path: string;
    label?: string;
  }): Promise<ToolkitCheckpoint>;
  listToolkitCheckpoints(filePath: string): Promise<ToolkitCheckpoint[]>;
  restoreToolkitCheckpoint(request: {
    path: string;
    id: string;
  }): Promise<ToolkitTextFile>;
  fetchToolkitText(url: string): Promise<string>;
  getRegexDataPack?(): Promise<string>;
  getPassiveTreeData(options?: {
    game?: "poe1" | "poe2";
    treeVersion?: string;
    ruthless?: boolean;
    alternate?: boolean;
  }): Promise<PassiveTreeData>;
  decodePobBuild(input: string): Promise<string>;
  encodePobBuild(input: string): Promise<string>;
  diagnosePobEngine(): Promise<PobEngineDiagnostic>;
  calculatePobBuild(request: {
    xml: string;
    name?: string;
  }): Promise<PobEngineCalculationResult>;
  analyzePobNodes(request: {
    xml: string;
    name?: string;
    maxPoints?: number;
  }): Promise<PobNodeAnalysisResult>;
  previewPobTimeless(request: {
    xml: string;
    name?: string;
    jewelType: number;
    conquerorId?: number;
    socketId: number;
    seed: number;
  }): Promise<PobTimelessPreviewResult>;
  huntPobTimeless(request: {
    xml: string;
    name?: string;
    jewelType: number;
    socketId?: number;
    socketIds?: number[];
    targets: Array<{ id: string; weight: number; weight2?: number; minimum?: number }>;
    scope?: "allocated" | "reachable" | "radius";
    maxPoints?: number;
    maxResults?: number;
  }): Promise<PobTimelessHuntResult>;
  importPobCharacter(request: {
    character: Record<string, unknown>;
  }): Promise<PobEngineCharacterImportResult>;
  readPlannerClipboard(): Promise<string>;
  listPoeCharacters(request: PoeCharacterImportRequest): Promise<PoeCharacterSummary[]>;
  getPoeCharacter(request: PoeCharacterImportRequest): Promise<Record<string, unknown>>;
  getPoeStashLeagues(request: {
    realm?: PoeStashRealm;
  }): Promise<PoeStashLeague[]>;
  listPoeStashTabs(request: StashSyncRequest): Promise<PoeStashTabSummary[]>;
  getPoeStashTab(
    request: StashSyncRequest,
    tabId: string,
  ): Promise<PoeStashTabDetail>;
  syncPoeStash(request: StashSyncRequest): Promise<PoeStashTabDetail[]>;
  connectPoeOAuth(options?: {
    scope?: string;
    port?: number;
  }): Promise<PoeOAuthConnection>;
  getPoeOAuthStatus(): Promise<PoeOAuthStatus>;
  disconnectPoeOAuth(): Promise<boolean>;
  getToolkitWorkspace(): Promise<ToolkitWorkspace>;
  recoverToolkitWorkspace(): Promise<{ workspace: ToolkitWorkspace; backupName: string | null }>;
  saveToolkitWorkspace(value: ToolkitWorkspace): Promise<{
    workspace: ToolkitWorkspace;
    failures: Array<{ id: string; hotkey: string; error: string }>;
  }>;
  showToolkitOverlay(kind: "cheats" | "whiteboard"): Promise<void>;
  hideToolkitOverlay(): Promise<void>;
  captureToolkitGameWindow(): Promise<{ dataUrl: string; width: number; height: number } | null>;
  getSettings(): Promise<DesktopSettings>;
  saveSettings(patch: DesktopSettingsPatch): Promise<DesktopSettings>;
  windowAction(action: string, payload?: unknown): Promise<DesktopSettings | null>;
  publishSurfaceState(state: Omit<SurfaceState, "update">): Promise<void>;
  getSurfaceState(): Promise<SurfaceState>;
  surfaceAction(action: SurfaceAction): Promise<void>;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  installUpdate(): Promise<void>;
  rendererReady(): Promise<void>;
  onSettingsChanged(callback: (settings: DesktopSettings) => void): () => void;
  onShortcut(callback: (event: ShortcutEvent) => void): () => void;
  onPriceCheckCapture(
    callback: (
      capture: import("./lib/price-check/types").ClipboardItemCapture,
    ) => void,
  ): () => void;
  onPriceCheckOverlayState?(
    callback: (state: PriceCheckOverlayState) => void,
  ): () => void;
  onSurfaceState(callback: (state: SurfaceState) => void): () => void;
  onStashProgress(callback: (event: StashProgressEvent) => void): () => void;
  onUpdateState(callback: (state: UpdateState) => void): () => void;
}

declare global {
  interface Window {
    poeWidget?: PoeWidgetBridge;
  }
}
