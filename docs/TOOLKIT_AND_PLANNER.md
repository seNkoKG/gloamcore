# Player Toolkit and Build Lab

## Toolkit safety and defaults

Macros, stash scrolling, pinned sheets, and plugin permissions start disabled.
Macros send one configured chat line only while the selected Path of Exile
process is foreground. Overlay windows are separate transparent windows; they
do not inject into or read memory from the game.

Filter sync replays explicit block edits by block identity and tier onto a new
source. The source can be an HTTPS filter or an in-game `OnlineFilters` file.
The edited local file remains the save target, and a checkpoint can be restored
before overwriting it.

The regex workbench starts with no filters selected. Its PoE 1 pack exposes 69
searchable categories and records the source, retrieval time, hashes, coverage,
and limitations used to build each data family. AVOID and WANT are mutually
exclusive per entry; wanted terms support Any or All, while map yield, state,
rarity, and six quality constraints remain independent required clauses.
Optimized tokens are used only after an exhaustive category-universe check;
otherwise the exact copied wording is retained. A split over PoE's 250-character
limit is labelled lossless only when every chunk preserves the original logic.

## Sandboxed plugin protocol

Plugins are HTTPS pages in an iframe with `allow-scripts allow-forms` only.
They have no same-origin, Node, Electron, filesystem, or direct clipboard
access. A page sends a message to its parent:

```js
parent.postMessage({
  protocol: "ninja-lens-plugin/v1",
  id: crypto.randomUUID(),
  type: "get-context"
}, "*")
```

The reply uses the same `protocol` and `id`, plus `ok`, `result`, and `error`.
Supported request types are:

- `hello` / `get-context`: host, API version, plugin ID, selected game, league,
  capabilities, and current permission flags;
- `get-leagues`: the host's current league list;
- `storage:get`, `storage:set`, `storage:delete`: private string key/value data;
- `get-current-item`: the already copied clipboard item and parsed fields;
- `capture-game`: one focused-game-only image capture;
- `open-external`: an allowlisted external HTTPS handoff.

The final three actions require their corresponding per-plugin permission.
Storage is limited to 64 keys, 16 KiB per value, and 128 KiB total. This is a
small secure host API, not binary compatibility with Scalpel's local ES-module
SDK or registry packages.

## Build Lab accuracy boundary

PoE 1 tree data comes from the newest installed
`Path of Building Community/TreeData/<version>/tree.lua`. PoE 2 searches the
standard `Path of Building Community (PoE2)` locations and understands PoB2's
different radians, connection records, shared class starts, and class IDs. If
PoB2 is absent, the app reports that requirement and keeps the valid PoE 1 tree
loaded.

PoB/PoB2 XML and code imports preserve tree specs and their PoB-only child XML,
active item, skill and config sets, items, gems, config, notes, and `PlayerStat`
snapshots. Tree rendering and editing use the matching installed PoB tree
version, including deterministic Cluster Jewel graphs, shortest paths,
dependent refunds, current alternate ascendancies, and supported remote-jewel
allocation rules. Masteries preserve PoB's source-defined effect order. A
left-click opens the chooser for an unallocated mastery or refunds an allocated
one; a right-click changes an allocated mastery. Effects already used by other
allocated masteries are unavailable; if that exhausts the choices, the chooser
explains why instead of rendering an unexplained empty panel.

PoE 1 public and OAuth character-profile imports send the raw official response
through Path of Building Community 2.66.1's own importer inside the verified
local engine, then load the PoB XML it produces. This keeps PoB's item-slot,
socket-group, gem-variant, passive-jewel, class, bandit, pantheon, and nested
Cluster Jewel semantics instead of duplicating them approximately in the app.
Authenticated character lists and payloads are never cached. Missing, modified,
or unrecognized engine files make the import fail closed.

PoE 2 account-profile import is intentionally unavailable. The current Build
Lab model cannot yet preserve PoE 2 skills, weapon-set specialisations, and
quest statistics losslessly, so generating a partial build would be unsafe.
PoB2 XML/code import, installed-tree editing, and PoB2 export remain supported.

On Windows, the explicit **Recalculate in PoB** action can evaluate the current
PoE 1 workspace with the separately installed, exactly verified Path of
Building Community 2.66.1 engine. It starts one fresh hidden process per
request, sends only the serialized build over stdin, keeps the PoB installation
read-only, and returns only scalar `mainOutput` values. The bridge refuses
unknown version, source, or runtime fingerprints; a new PoB release therefore
requires an app update and fresh regression proof rather than silently running
an untested engine. PoE 2 calculation still requires export to PoB2. Build Lab
is a focused editor and viewer; it does not claim UI or calculation parity with
every panel in PoB or PoB2.
