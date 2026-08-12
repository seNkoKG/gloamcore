# GloamCore roadmap

GloamCore is the economy, intelligence, one-key in-game price-check, and exact
official Trade browser-handoff baseline. New knowledge work remains isolated
from the price dashboard until its data, performance, and accuracy checks pass.

Older sections below record what earlier releases shipped. Version 2.9.3
explicitly supersedes any retired transport or data-source behavior.

## Approved delivery order

1. **3.0.0 — League Navigator and patch-safe data channel.** Exact campaign
   route branching, class-correct gem acquisition, local progress, authentic
   PoE artwork, complete-pack validation, automatic client checks, rollback,
   and guarded upstream update PRs.
2. **3.1.0 — Atlas Command Center.** Official Atlas sprite art, exact current
   graph and point accounting, gateway traversal, search, shortest connected
   allocation, safe refunds, official URL import/export, comparison, saved
   loadouts, and patch migration.
3. **3.2.0 — Deterministic Upgrade Assistant.** Compare saved Build Lab states
   and explicitly recalculate both sides through the verified installed Path of
   Building engine. Never invent DPS, effective hit pool, or upgrade rankings.
4. **3.3.0 — Mapping Journal.** Persist only sanitized map-session facts parsed
   from the user-selected local Client.txt, with death/entry timing, notes,
   tags, summary, and CSV export. Never infer loot, profit, or hidden game state.

Each version is feature-audited against its pinned PoE source and then passes
the existing baseline suites only as regression guards. Craft of Exile remains
intact and the retired full official-trade-listings subsystem remains prohibited.

## Current in 3.0.0

- Added the League Navigator and patch-safe PoE data channel described above.
- Updated the guarded source lock to the latest official Atlas export,
  `3.29.1`, instead of freezing new work to the earlier preview.
- Added daily source discovery that opens a review PR, plus automatic validated
  pack checks in the app and a one-step last-known-good rollback.

## Current in 2.9.3

- Restored the bounded public Trade price snapshot below the Ctrl+D modifier
  editor. Selected query changes refresh automatically through fixed
  Path of Exile search and fetch routes; responses are size-limited,
  sanitized, cached briefly, and never use a player session or POESESSID.
- Kept the snapshot intentionally narrow: it shows a small set of public
  seller prices and dates, does not send whispers, and leaves the complete
  encoded query available through the explicit official Trade handoff.

- Added the real Craft of Exile interface as a desktop-only, edge-to-edge
  workspace. It runs in a dedicated sandboxed browser profile with strict
  navigation, popup, download, clipboard, and session boundaries. Cached
  ads-only filtering is scoped to Craft pages and disabled on Patreon.
- Kept Craft of Exile and Wealthy Exile as independent site-owned sessions;
  GloamCore does not read, transform, or reuse their cookies, credentials, or
  private responses.
- Reorganized the public website and README around the complete current
  workflow, supported platforms, data provenance, and explicit trust model.

## Shipped in 2.9.0

- Removed the unapproved Path of Exile OAuth, account-character, and native
  stash integration completely after the application was rejected. Current
  Build Lab inputs are PoB XML, codes, supported links, and local files;
  the separate Wealthy Exile browser session remains isolated.
- Made Build Lab strictly Path of Exile 1 and fail closed for unsupported build
  or passive-tree version families while preserving PoB passive sockets,
  overrides, unknown children, and equipment weapon sets.
- Removed the unsupported in-app Trade search, exchange, and fetch transport,
  listing UI, caches, IPC, and packaged remnants. Query planning stays
  local; only a user click opens the encoded filters on the official Trade site.
- Rebuilt the regex pack as 15,854 entries in 20 categories from pinned local
  Awakened base/stat packs and PoE Wiki data. Safe full-tooltip output is the
  default and compact category-only output is experimental.

## Shipped in 2.2.3-2.2.7

- Finalized the Awakened-style non-activating preview so the first deliberate
  click reaches its real control, while Close, Escape, and Alt-Tab return input
  cleanly and passive checks leave Path of Exile in the foreground.
- Made every query-relevant, non-hidden modifier visible by default without a
  fold or modifier scrollbar; adaptive height preserves filters before seller
  rows when the work area is short.
- Removed invariant unique-property rows before rendering and restored exact
  Malachai's Loop 3-of-8 filter parity. Active defaults remain active, while
  supported unchecked Trade rows stay disabled and editable in the browser
  handoff instead of disappearing.
- Suppressed unrelated aggregate identity quotes for Vestigial and Foil checks
  so their exact state-aware listings remain the visible pricing evidence.
- Restored integrity-checked stat hydration, exact Timeless Jewel seed and
  conqueror searches, and the data-backed 69-category poe.re-style workbench.
- Repaired authoritative passive-tree rendering, Cluster Jewel graphs, path and
  refund previews, remote-jewel dependencies, tooltip hit testing, and PoB's
  mastery chooser behavior and effect order.
- Added scalar recalculation through the verified local Path of Building
  Community 2.67.2 engine. Imported PoB data remains the source of truth and
  unknown engine fingerprints fail closed.

## Shipped in 2.2.2

- Completed the pinned Awakened price-check workflow: passive and locked
  shortcuts, draggable persistent placement, explicit search after filter
  edits, contextual modes/states, gem/map/unique-special handling, bulk routing,
  named Trade rate windows, no artificial item cooldown, and 20 displayed
  grouped first-page sellers with adaptive fetching up to 100 IDs.
- Added the Player Toolkit: filter editing and intent replay, source-tracked
  Path of Exile 1 regex workspaces, socket recolouring, economy/dust/card audits, opt-in macros and
  stash scrolling, cheat sheets, themes, whiteboard overlays, checkpoints, and
  a permissioned sandbox plugin host.
- Added Build Lab with real installed PoB tree parsing, PoB XML/code import,
  interactive allocation/refund/history, editable
  build sections, imported calculation snapshots, radial stat view, saved build
  comparison, and PoB export. Calculation snapshots are marked stale after
  local edits instead of inventing recalculated DPS.

## Shipped in 2.2.0

- Compact rare, magic, and roll-sensitive unique modifier controls with mapped
  special-jewel, Chronicle-room, Veiled-state, and calculated equipment-property
  filters.
- Anonymous desktop searches against fixed public official Trade and eligible
  bulk-exchange endpoints, with up to 20 displayed grouped seller rows,
  bounded input/output, Awakened-style named rate windows, request coalescing,
  a five-minute exact-query cache, stale labelling, and no background polling.
- A full official Trade handoff remains available for inspecting all results.
  Mobile retains local planning and that handoff without the Windows global
  capture/overlay or live desktop listing bridge.

## Shipped in 2.1.0

- One-key `Ctrl+D` hovered-item capture that copies once only after validating
  the exact focused Path of Exile window.
- A 360×360 flat PoE-attached panel with current poe.ninja estimates, closest
  market matches, listing counts, and direct detailed-checker access.
- A user-controlled official Trade handoff without account cookies,
  `POESESSID`, or undocumented Trade endpoint automation.
- Removed direct Currency Exchange digest access from this personal/friends
  build. The public endpoint is completed-hour history only and its API policy
  requires an identifiable registered-style client with a real contact.

## Shipped in 2.0.1

- A native transparent Windows overlay attached to the actual Path of Exile
  window, with target focus tracking, click-through passive state, monitor/DPI
  synchronization and safe focus restoration.
- Compact in-game presentation that hides the dashboard and keeps the detailed
  market, filter, history and settings tools inside the PoE overlay.

## Shipped in 2.0.0

- A separate price-check overlay for copied in-game item text.
- Local parsing for currency, uniques, rares, gems, maps, equipment state,
  influences, sockets, and modifier rolls without game-memory access.
- A pinned, checksummed English modifier catalog with exact type-aware mapping,
  visible ambiguity handling, and no silent stat-ID guessing.
- Exact, similar-roll, and base-only comparison modes with explicit confidence,
  freshness, liquidity, evidence, and manipulation warnings.
- Current-league poe.ninja estimates, local price history, watch actions, and
  user-triggered official Trade handoff. The former direct Faustus feed was
  disabled in 2.1 pending a compliant identifiable application client.
- Responsive desktop overlay and mobile price-check tab with manual paste.

## Shipped in 1.6.0–1.6.2

- Live current-game item, base, and modifier search through the documented PoE
  Wiki Cargo API on Windows, browser preview, Android, and iOS.
- One-hour local request caching, forced refresh, and last-good stale fallback.
- Acquisition restrictions, drop areas/monsters, release patch, metadata,
  affix type, tier, required level, domain, mod groups, and tags.
- Responsive Item Intel interfaces for desktop, phone, and tablet plus
  `Ctrl+K` global access inside the main window.
- Exact in-game inventory artwork with trusted local data caching, semantic
  fallbacks, rarity accents, and bot-challenge-safe rendering.
- CDN-age-aware source scheduling, versioned market caches, two-hour stale
  rejection, guarded thin-market estimates, and actionable-only watch alerts.
- Repeatable live validation of every configured category endpoint, payload,
  row identifier, price, cache header, observation count, and history signal.
- Attributed PoE Wiki and item-specific PoEDB links, with contextual Craft of
  Exile handoff instead of copied crafting code or private data.
- Query validation, link allowlists, normalization tests, live-data QA, and
  zero-overflow checks at 320, 360, 390, 430, 768, and 1365 pixel widths.

## Product principles

- Prefer documented GGG APIs, permitted game-data exports, and clearly licensed
  community datasets. Never call the official Trade website's undocumented
  search, exchange, or fetch APIs. Build Trade filters locally and open them
  only through an explicit user-clicked browser handoff.
- Never use player session cookies such as `POESESSID`, reverse-engineer private
  endpoints, automate whispers/trades, or represent public Trade website access
  as an authenticated developer API.
- Attach source, game version, and update time to every published dataset.
- Stage and validate updates before activation; retain the last known-good
  database for automatic rollback and offline use.
- Keep calculations reproducible and label estimated or uncertain mechanics.
- Preserve GloamCore's economy, tooltip, watchlist, and mobile paths as
  independently testable modules. Keep documented Public Currency Exchange
  completed-hour evidence isolated from active Trade results and other market
  sources.

## Phase 1 - Versioned PoE data foundation

- Build a normalized schema for items, bases, gems, modifiers, tags, weights,
  crafting methods, areas, monsters, maps, passive nodes, recipes, and league
  mechanics.
- Add an updater that detects new patches, downloads approved sources into a
  staging area, validates counts and relationships, reports schema changes,
  and atomically publishes only valid versions.
- Produce a compact searchable index for Windows, Android, and iOS with local
  caching, incremental downloads, checksums, rollback, and offline fallback.
- Add provenance, patch comparison, regression fixtures, and malformed-update
  tests before enabling unattended updates.

## Phase 2 - Knowledge database

- Add global search across economy rows and the static game database.
- Enrich Item Intel with acquisition sources, drop areas, vendor recipes,
  modifier pools, tiers, tags, weights, related gems, maps, monsters, and
  relevant league mechanics.
- Add focused browsers for items, modifiers, gems, Atlas/passive data, recipes,
  bosses, and areas rather than reproducing another site's page structure.
- Keep attributed links to PoEDB and PoE Wiki for deeper reference material.

## Phase 3 - Crafting intelligence

Build an independent crafting engine using permitted game data and documented
or testable game rules. Craft of Exile is a feature reference, not a code or
data source.

- Import copied item text and resolve affixes, hybrid modifiers, influences,
  item level, tags, mod groups, open affixes, and blocked outcomes.
- Browse the eligible modifier pool with tier, weight, tag, influence, and
  item-level filters.
- Calculate estimated odds for an initial supported set of currency, fossils,
  essences, catalysts, harvest crafts, influences, and metacrafts.
- Run deterministic, seeded simulations in a background worker and compare
  analytical results with Monte Carlo distributions.
- Convert expected attempts into current Ninja/Faustus costs while allowing
  custom prices.
- Provide action history, spending breakdowns, shareable plans, item export,
  accuracy warnings, and tests against known crafting fixtures.

## Phase 4 - Advanced crafting tools

- Multi-step craft planner with stop conditions, fallback branches, expected
  cost, risk percentiles, and intermediate-item valuation.
- Fossil/resonator and method optimizers, modifier affinities, bulk simulation,
  saved craft libraries, and patch-to-patch craft comparisons.
- Educational explanations that show why modifiers are eligible, blocked, or
  reweighted instead of presenting unexplained probabilities.

## Explicitly out of scope

- Copying Craft of Exile or PoEDB source code, branding, layouts, written
  guides, proprietary datasets, or private APIs without written permission and
  a compatible licence.
- Shipping or collecting `POESESSID`, reverse-engineering undocumented GGG
  endpoints, reading game memory/files from the running client, or automating
  gameplay and trade actions.
- Claiming exact odds when GGG does not publish a rule. Those mechanics must be
  marked as estimates, independently tested, and easy to disable after patches.

## Recommended next milestone

Extend the shipped Item Intel live search with a separately downloaded,
checksummed RePoE snapshot and staged updater. Add gems, passive/Atlas data,
areas, monsters,
recipes, patch comparison, and richer asset handling before considering any
independent crafting calculator. Craft of Exile remains the recommended
specialist handoff unless a future engine can be validated and maintained safely.
