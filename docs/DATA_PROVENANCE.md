# Data provenance and attribution

GloamCore combines live public responses with pinned, transformed reference
packs. This document records where those inputs come from, how they are used,
and which license or ownership boundary applies.

The complete shipped license texts and dependency inventory remain in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). Metadata embedded in each
generated pack is authoritative for its exact input hashes and retrieval time.

## Provenance principles

- Pinned packs identify an upstream project, revision or retrieval time, input
  hashes, transformation command, and known limitations where applicable.
- Generated JSON is treated as data, never executed as upstream code.
- Ambiguous or unresolved item modifiers remain visible for review instead of
  being silently mapped.
- Live services may lag a game patch, change shape, reject anonymous traffic,
  or rate-limit requests. Last-good data is labelled stale when used.
- An upstream license applies only to that upstream material; it does not
  convert GloamCore itself into an open-source project.

## Awakened PoE Trade reference packs

The local price-check stat and item-family packs are transformed from the
English data published by
[Awakened PoE Trade](https://github.com/SnosMe/awakened-poe-trade).

The shipped snapshot is pinned to release `v3.29.104`, commit
`adb6c287bd978a70701e2b65d744dd677c52fb65`. It becomes local modifier IDs,
StatGroup resolution data, ordered item and unique variants, numeric transforms,
property discriminators, and fixed-stat declarations. Awakened PoE Trade is
licensed under the MIT License and acknowledges RePoE for extracted game data;
the matching notice and copyright text are retained in the third-party notices.

Relevant generated files include:

- `public/data/price-check/stats-v1.json`;
- `src/lib/price-check/base-types-v1.json`.

The build scripts in `scripts/` regenerate these files from a deliberate pinned
source. A future upstream release is not adopted until parity fixtures and the
cross-family query suite pass against the new pack.

## Path of Building Community

Build Lab reads tree and build data from a separately installed
[Path of Building Community](https://github.com/PathOfBuildingCommunity/PathOfBuilding)
installation. GloamCore does not redistribute the PoB runtime or its game
databases.

The bundled headless adapter is copied from Path of Building Community 2.66.1's
`src/HeadlessWrapper.lua` and is covered by the MIT License. Its complete notice
is shipped at `electron/pob-headless-wrapper.LICENSE.md`. The bridge verifies the
supported local PoB engine before character import or recalculation and fails
closed for an unknown fingerprint.

PoB map-modifier data can also corroborate entries in the generated regex pack.
That pack records the exact PoB input file, version, license, and SHA-256 used
for its build.

`public/data/toolkit/cluster-back-v1.json` records the SHA-256 of the installed
PoB `src/Data/ClusterJewels.lua` used to derive notable display order. It does
not ship PoB runtime code or the source database. The generator combines that
order with separately retrieved Wiki spawn-weight records and the app's pinned
official Trade stat snapshot.

## Path of Exile Wiki and Cargo

Item Intel queries the public
[Path of Exile Wiki](https://www.poewiki.net/) MediaWiki and Cargo interfaces
for item and modifier reference data. The regex pack also transforms selected
Area-modifier records returned by Cargo. Cluster Back transforms current
cluster-notable mod groups, generation types, and spawn weights from Cargo.
Build Lab requests exact item records and inventory-icon titles at runtime;
downloaded image data remains an ephemeral cache and is not written into PoB
XML or saved planner workspaces.

PoE Wiki textual content that the wiki licenses is available under
[CC BY-NC-SA 3.0](https://www.poewiki.net/wiki/Path_of_Exile_Wiki:Copyrights).
The Cargo-derived portion retains that attribution and license boundary. Game
names, artwork, and other Path of Exile material remain the property of their
respective owners.

## Grinding Gear Games public data

The regex pack records bounded responses from public Grinding Gear Games Trade
data endpoints for item, stat, and static reference records. Each source entry
in `public/data/toolkit/regex-v1.json` contains its endpoint, retrieval time,
input SHA-256, and available upstream freshness metadata.

The app also uses anonymous official Trade website search, exchange, and fetch
routes to provide a compact seller snapshot after a user requests a price
check. These routes are an unofficial convenience rather than a guaranteed
developer API. Requests omit account credentials and expose only bounded,
sanitized listing fields to the renderer.

No GloamCore project license is asserted over Grinding Gear Games names,
artwork, APIs, or game data.

Cluster Back uses Trade stat IDs from the pinned local Trade stat pack and
opens a user-requested query on the official Trade website. The bundled
cluster pack records the exact local pack hash used during generation.

## Live poe.ninja data

Market Explorer requests public league economy data from
[poe.ninja](https://poe.ninja/). Source cache headers, ETags, observation
quality, and last-good fallback state are preserved where available. GloamCore
does not claim ownership of poe.ninja data, and poe.ninja does not endorse this
project.

## Combined regex pack

`public/data/toolkit/regex-v1.json` is a transformed search-reference pack built
from the pinned Awakened packs, public GGG Trade data, selected PoE Wiki Cargo
Area modifiers, and Path of Building map-modifier data. Its own `sources`,
`coverage`, `limitations`, and `update` fields document the exact build inputs.

Because inputs have different ownership and licenses, consumers must follow the
attribution and use terms attached to each source. The pack is not offered as a
new license over upstream game or wiki content.

## Updating a pack

1. Pin or retrieve the intended upstream input explicitly.
2. Preserve the source identity, retrieval time, hash, and license metadata.
3. Run the matching generator under `scripts/`; do not hand-edit output.
4. Review structural diffs and source coverage or limitation changes.
5. Run the focused generator tests, full test suite, and production build.
6. Regenerate third-party notices when a source or dependency changes.
7. Document a material provenance change in the changelog and this file.

> **This product isn't affiliated with or endorsed by Grinding Gear Games in any way.**
