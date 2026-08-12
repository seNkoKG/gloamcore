# Player Toolkit and Build Lab

## Toolkit safety and defaults

Macros, stash scrolling, pinned sheets, and plugin permissions start disabled.
Macro scope uses the exact Path of Exile executable-and-window-title pair.
A macro sends one configured chat line only when both parts match the foreground
window, and the same window is revalidated immediately before input. Overlay
windows are separate transparent windows; they do not inject into or read
memory from the game.

Filter sync replays explicit block edits by block identity and tier onto a new
source. The source can be an HTTPS filter or an in-game `OnlineFilters` file.
Normal mode uses `.filter` files and permits `Show`/`Hide`; Ruthless mode uses
`.ruthlessfilter`, permits `Show`/`Minimal`, and enforces text alpha of at least
80. Changing mode never rewrites the loaded text. If its extension does not
match the selected mode, Save becomes Save As and leaves the original untouched;
a same-mode overwrite creates a restorable checkpoint.

The regex workbench starts with no filters selected. Its PoE 1 pack contains
15,854 entries in 20 searchable categories from three declared sources: pinned
Awakened PoE Trade base and stat packs plus PoE Wiki map-modifier data. It
records each source, retrieval time, hash, coverage, and limitation. AVOID and
WANT are mutually exclusive per entry; wanted terms support Any or All, while
map yield, state, rarity, and six quality constraints remain independent
required clauses. Safe full-tooltip output is the default and uses exact
wording or a shorter fragment proven against the complete copied-tooltip
corpus. Compact category-only output is explicitly experimental, shows a
warning, and disables automatic copy; legacy optimized/exact profiles migrate
to Safe. A split over PoE's 250-character limit is labelled lossless only when
every chunk preserves the original logic.

## Map Mod Check

Map Mod Check uses 104 canonical PoE 1 modifier lines from the bundled,
source-tracked regex pack. The desktop hotkey performs one ordinary copy action
only while Path of Exile owns the foreground, accepts only `Item Class: Maps`,
and opens a temporary non-focus-stealing overlay near the cursor. Good, Warn,
Bad, and Ignore ratings are explicit local preferences. Unrated lines remain
neutral, Bad always wins, Warn wins when no Bad line exists, and Good appears
only when every relevant line is Good or Ignore.

## PoE Event Log

The Event Log reads the newest four MiB of the selected PoE 1 `Client.txt`,
then tails appended UTF-8 bytes with partial-line, truncation, and rotation
handling. At most 500 parsed entries exist in memory. Event contents are never
written or uploaded; only the selected file path persists. Zone, level, death,
status, whisper, trade, party, item, public-chat, and unclassified filters are
presentation controls only and never trigger game actions.

## Mapping Journal

Mapping Journal shares the Event Log's dialog-authorized, regular-file-only
PoE 1 `Client.txt` reader. A journal session is created only after the log
provides a client-safe instance ID, a `MapWorlds…` generation record, and the
matching displayed area-entry record for the same client process. The
client-safe instance ID, internal area ID, and seed form the local session
identity, so portals back into one instance increase its entry count instead of
creating another map. No maintained map-name allowlist is required when a new
league changes the Atlas.

Observed time begins on the area-entry record and stops at the next exact area-
generation boundary. Rotation, truncation, log replacement, app restart, and
disabled watching terminate the observation without inventing an exit time and
mark it incomplete where applicable. Deaths count only exact, case-sensitive
`has been slain` or `has committed suicide` system lines matching the locally
configured active character; other names are discarded.

The durable journal contains sanitized map facts, bounded notes, and bounded
tags, not raw log lines. It supports local search, summary, explicit per-session
removal, confirmed full clearing, and CSV export through a user-selected file.
Exact current-league map artwork comes from the validated poe.ninja mirror; the
current official Atlas map sprite is the fallback. Loot, profit, completion,
boss kills, portal counts, and hidden game state are never inferred.

## Cluster Back

Cluster Back is limited to current, non-legacy, 8-passive Large Cluster Jewels.
It combines the installed PoB notable order with current Wiki spawn weights,
mod groups and prefix/suffix generation, plus pinned Awakened stat selectors.
A result must lie strictly between the two requested front notables, share a
valid base, have positive spawn weight, avoid mod-group conflicts, and fit
PoE's two-prefix and two-suffix limit. The generated Trade query requires both
requested notables, exactly eight passives, and at least one eligible back
notable. **Open Official Trade** hands that encoded query to the browser; it
does not scan or fetch sellers. The copied-jewel verifier independently reports
the middle PoB-order notable.

## Sandboxed plugin protocol

Plugins are HTTPS pages in an iframe with `allow-scripts allow-forms` only.
They have no same-origin, Node, Electron, filesystem, or direct clipboard
access. A page sends a message to its parent:

```js
parent.postMessage({
  protocol: "gloamcore-plugin/v1",
  id: crypto.randomUUID(),
  type: "get-context"
}, "*")
```

The reply uses the same `protocol` and `id`, plus `ok`, `result`, and `error`.
Request types available to plugins are:

- `hello` / `get-context`: host, API version, plugin ID, PoE version 1, league,
  capabilities, and current permission flags;
- `storage:get`, `storage:set`, `storage:delete`: private string key/value data;
- `get-leagues`;
- `get-current-item` for the already copied clipboard item and parsed fields;
- `capture-game` for one focused-game-only image capture;
- `open-external` for an allowlisted external HTTPS handoff.

Current-item, game-capture, and external-handoff actions require their
corresponding per-plugin permission.
Storage is limited to 64 keys, 16 KiB per value, and 128 KiB total. This is a
small secure host API, not binary compatibility with Scalpel's local ES-module
SDK or registry packages.

## Build Lab accuracy boundary

Path of Exile 1 tree data comes from the newest installed
`Path of Building Community/TreeData/<version>/tree.lua`. Build and tree
versions outside the supported Path of Exile 1 family fail closed.

PoB XML and code imports preserve tree specs and their PoB-only child XML,
active item, skill and config sets, items, gems, config, notes, and `PlayerStat`
snapshots. Tree rendering and editing use the matching installed PoB tree
version, including deterministic Cluster Jewel graphs, shortest paths,
dependent refunds, current alternate ascendancies, and supported remote-jewel
allocation rules. Socketed jewels use PoB's own colour/family overlays, and
Timeless Jewels use the matching PoB family radius sprites and radius label.
Missing imported item art is resolved from exact PoE Wiki item records into an
ephemeral in-memory cache rather than saved into build XML. Masteries preserve
PoB's source-defined effect order. A
left-click opens the chooser for an unallocated mastery or refunds an allocated
one; a right-click changes an allocated mastery. Effects already used by other
allocated masteries are unavailable; if that exhausts the choices, the chooser
explains why instead of rendering an unexplained empty panel.

Build Lab does not request Path of Exile account access and does not import
public or private account profiles. Builds enter through PoB XML, codes,
supported build links, or local XML files. This keeps the imported PoB schema
as the source of truth and avoids generating partial account-derived builds.

On Windows, the explicit **Recalculate in PoB** action can evaluate the current
PoE 1 workspace with the separately installed, exactly verified Path of
Building Community 2.67.2 engine. It starts one fresh hidden process per
request, sends only the serialized build over stdin, keeps the PoB installation
read-only, and returns scalar `mainOutput` values plus PoB's current gem and
configuration catalogs. The bridge refuses unknown version, source, or runtime
fingerprints; a new PoB release therefore requires an app update and fresh
regression proof rather than silently running an untested engine. Item text is
validated by PoB before assignment. Item, skill, and configuration sets remain
editable, including equipment weapon sets, main socket group, main active skill,
Full DPS, gem variants, enabled state, level, quality, and every configuration
control eligible for the loaded build.
