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

The bundled headless adapter is copied from Path of Building Community 2.67.2's
`src/HeadlessWrapper.lua` and is covered by the MIT License. Its complete notice
is shipped at `electron/pob-headless-wrapper.LICENSE.md`. The bridge verifies the
supported local PoB engine before recalculation and fails closed for an unknown
fingerprint.

## Versioned league-navigation and Atlas packs

`public/data/game/v1` contains one complete PoE 1 data release with a manifest,
campaign Navigator pack, and Atlas pack. The current manifest targets PoE
`3.29.1`. Atlas nodes, official icon sprite references, point budget, geometry,
and graph relationships come from Grinding Gear Games'
[official Atlas export](https://github.com/grindinggear/atlastree-export/releases/tag/3.29.1),
pinned to commit `0ae2e0f94f266fc21c86ee8dd561d7b559bf2db4`.

Campaign steps, areas, gems, quest rewards, vendors, class availability, and
conditional Bandit/Library branches are transformed from
[Exile Leveling](https://github.com/HeartofPhos/exile-leveling/commit/b7b2dd0ed62ae25cf55c74085fa64a1f4d7cf4ba),
licensed under MIT. The full HeartofPhos notice is retained in the shipped
third-party notices. Bandit and quest images are attributed Path of Exile game
art referenced from their PoE Wiki file pages; they are presentation only and
never supply game logic.

`scripts/game-data-sources.json` is the review lock. The generator rejects a
source whose checksum, size, UTF-8 JSON, route directives, Atlas geometry, or
graph references do not match the reviewed contract. Renderer activation then
rechecks manifest shape, pack byte size, SHA-256, graph symmetry, node identity,
route branches, area/gem bounds, and exact game-version agreement. Both packs
must pass before one atomic cache record changes; the prior validated bundle is
retained for rollback and the bundled release remains the offline fallback.
Source discovery also requires the Navigator revision to postdate the official
Atlas revision and its commit message to explicitly identify the detected
major/minor league family. A missing compatibility signal stops the workflow
instead of silently relabelling old campaign or gem data.

The daily `game-data-update.yml` workflow discovers the newest three-part
official Atlas tag and current Exile Leveling commit, creates a new source lock,
rebuilds both packs, and runs focused tests. It opens or refreshes a pull request
instead of publishing upstream content unattended. Once that audited PR lands,
Pages publishes the complete bundle and open clients adopt it automatically
after validation.

`public/data/toolkit/cluster-back-v1.json` records the SHA-256 of the installed
PoB `src/Data/ClusterJewels.lua` used to derive notable display order. It does
not ship PoB runtime code or the source database. The generator combines that
order with separately retrieved Wiki spawn-weight records and the app's pinned
Awakened PoE Trade stat snapshot.

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

## Grinding Gear Games data and Trade handoff

The app does not call the official Trade website's undocumented search,
exchange, or fetch APIs. Item text and filter edits stay local. A deliberate
user click opens `pathofexile.com/trade` in the system browser with the complete
encoded query. GloamCore receives no Trade result payload or result ID from
that page.

Market Explorer's Faustus source is limited to documented Public Currency
Exchange completed-hour evidence. Current poe.ninja economy item names are
resolved to canonical item metadata IDs through PoE Wiki Cargo before direct
Chaos or Divine markets are matched. GloamCore does not interpolate between
hours or substitute poe.ninja values when a completed-hour range is absent. It
may retain the most recent observation from its eight-hour history with an
explicit age warning. Evidence older than two hours remains informational and
cannot alter an estimate, range, or confidence. This historical source is
separate from the Trade website and is not an active order book or
completed-sale ledger.

No GloamCore project license is asserted over Grinding Gear Games names,
artwork, APIs, or game data.

Cluster Back uses Trade stat IDs from the pinned local Trade stat pack and
opens a user-requested query on the official Trade website. The bundled
cluster pack records the exact local pack hash used during generation.

## Live poe.ninja data

Market Explorer consumes a project-controlled static mirror of public league
economy data from [poe.ninja](https://poe.ninja/). A scheduled GitHub Actions
publisher checks every configured route at 7 and 37 minutes past each hour with
a descriptive user agent and upstream ETags, validates the league/route matrix,
JSON schema, byte bounds, and SHA-256 digests, and then deploys the complete
snapshot with the existing GitHub Pages site. Installed clients do not fall back
to direct poe.ninja API requests.

The manifest preserves upstream ETags plus checked, source-updated, and next
refresh timestamps. Clients use those source timestamps rather than the Pages
response date, verify route size and SHA-256 where they fetch it, and fail closed
once a last-good source snapshot is more than two hours old. GitHub schedules
can be delayed, dropped during high load, or disabled after prolonged public
repository inactivity, so an unavailable or old mirror is reported as
unavailable/stale instead of being disguised as current. GloamCore does not
infer a missing Divine conversion from unrelated rows. Missing or zero sample
counts remain low confidence and are excluded from confidence-sensitive market
pulse and target alerts. GloamCore does not claim ownership of poe.ninja data,
and poe.ninja does not endorse this project.

## Local Mapping Journal facts

Mapping Journal reads only the newest bounded portion and appended UTF-8 bytes
of the user-selected PoE 1 `logs/Client.txt` through the same read-only service
as PoE Event Log. The accepted grammar is intentionally narrow: client-safe
instance ID, exact `Generating level … area "…" with seed …`, exact
`You have entered …`, and exact player-slain/player-suicide system records.
The session classifier accepts only internal area IDs beginning with
`MapWorlds`; it does not classify maps from a hand-maintained area-name list.

The persisted journal contains the hashed local session identity, sanitized
internal/display area names, area level, entry and observed-boundary times,
entry/death counts, bounded notes, and bounded tags. It does not persist raw log
lines, network addresses, chat, party member names, unrelated death subjects,
instance seeds, or the selected log's contents. Exact current-league map art is
resolved at presentation time from the validated poe.ninja `Map` route
described below, with the current official Atlas map sprite as fallback.
Missing art never changes session classification.

## Combined regex pack

`public/data/toolkit/regex-v1.json` is a transformed search-reference pack with
15,854 entries in 20 categories. Its three declared sources are the pinned
Awakened PoE Trade base pack, the pinned Awakened PoE Trade stat pack, and
selected PoE Wiki Cargo Area modifiers. It contains no live or cached GGG Trade
endpoint response. Its `sources`, `coverage`, `limitations`, and `update` fields
document the exact inputs, while each safe optimization records the
`shortest-full-tooltip-literal-v2` algorithm, tooltip-corpus hash, and corpus
line count.

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
