# GloamCore price checker

## Workflow

1. Hover an item in the English Path of Exile 1 client.
2. Press `Ctrl+D`.
3. For an economy item, review the current poe.ninja estimate and closest
   identity matches, plus documented Public Currency Exchange completed-hour
   evidence from Faustus when the item supports it. For a rare, magic, or
   roll-sensitive unique item, edit the
   visible modifier, calculated-property, and item-state filters directly in
   the compact overlay.
4. Review the readable exact query plan. Copying an item, editing a filter, and
   refreshing aggregate market context remain local to GloamCore's planner and
   supported data sources.
5. Click `TRADE` or **Open Trade** to open the complete encoded comparison on
   the official Trade website, then verify current results there before pricing.

The shortcut can be changed alongside every other app binding in desktop
Settings. Conflicting or unavailable global keys leave the previous shortcut
active. Mobile builds provide a
manual paste field because mobile operating systems do not expose PoE's global
desktop clipboard shortcut. Mobile uses the shared local planner and the same
user-clicked Trade handoff, but it has no global overlay.

Use Path of Exile in **Borderless** or **Windowed Fullscreen** mode. Windows
cannot reliably place a normal desktop overlay above a game running in
exclusive fullscreen.

The transparent overlay is attached to the native window titled `Path of
Exile`. It follows that window across monitor, DPI, move, resize and minimize
changes; it is click-through while inactive. Press `Escape`, click Close or
click outside the card to return keyboard and mouse input to PoE.

The compact card shows every query-relevant modifier by default, checked or
unchecked. Rows that the pinned upstream data marks hidden, fixed, or
advanced-only are omitted before rendering. The modifier list never gets its
own scrollbar: the native card grows to fit the useful rows and constrains
supporting market context first when the monitor work area is short. Closing
the card also hides the native overlay host and background-throttles every
hidden app surface.

## What the prices mean

- The compact in-game panel shows the current poe.ninja identity-level market
  estimate, close matches, aggregate listing counts when supplied, and source
  age for supported economy items. Missing or zero sample counts remain low
  confidence and cannot drive market pulse or target alerts.
- Local history is supporting evidence and always retains its original check
  time.
- Rare and magic items never receive a final valuation from their base price
  alone. Their compact overlay intentionally suppresses poe.ninja base-item
  prices and market rows, which would not value the copied modifiers.
- Identified uniques keep their poe.ninja identity estimate while their copied
  modifiers remain editable. This includes roll-sensitive unique equipment,
  Watcher's Eye aura effects, Split Personality rolls, corrupted jewel
  implicits, Forbidden Flame/Flesh choices, Thread of Hope ring variants, and
  exact Timeless Jewel seed/conqueror pseudo-stats.
- The local planner does not value a rare or magic item by counting Trade
  results. It builds the exact filters that the user can inspect and then open
  on the official Trade website. GloamCore does not fetch or display Trade
  result payloads, result totals, stock, or offers from that page.
- Exchangeable items retain their exact item and result-currency side in the
  encoded handoff instead of reopening an ambiguous two-currency query.
- Aggregate poe.ninja prices are not completed sales. Thin, fuzzy, or
  conflicting evidence can lower confidence and widen the displayed range.
  Documented Public Currency Exchange completed-hour evidence from Faustus is
  historical market context; evidence older than two hours remains labelled
  and cannot change the estimate, range, or confidence.

## Modifier controls

- Each parsed modifier has its own checkbox. Enabled modifiers with an
  unambiguous official Trade stat ID form the local comparison plan; unresolved
  rows remain visible and are labelled `UNMAPPED`.
- Numeric rows in the compact card expose only their minimum/maximum fields and
  synchronized dual slider; decimal and negative rolls are supported. The row
  checkbox controls whether that stat is included in the encoded query.
- Presence-only rows say `PRESENT` without showing meaningless number fields.
  The detailed dashboard exposes the expert `RANGE`, `EXACT`, and `PRESENT`
  selector when the planned matching mode needs to be changed.
- Pipe-qualified Trade IDs keep their original selector identity. Value-less
  choices, such as a selected Thread of Hope ring or Forbidden passive, use
  `PRESENT`; pipe-qualified stats with a real copied number retain editable
  `RANGE` and `EXACT` values.
- Copied advanced ranges set the slider limits. Higher-is-better rolls begin
  with a minimum, lower-is-better rolls with a maximum, and perfect-roll exact
  matching uses only the correct endpoint.
- Special-jewel planning covers mapped Watcher's Eye effects, Forbidden
  Flame/Flesh choices, Thread of Hope rings, Split Personality rolls,
  Impossible Escape choices, and exact Timeless Jewel seed/conqueror matches.
  Fixed unique boilerplate stays disabled where it would not distinguish one
  listing from another; unresolved copied rows remain visible instead of being
  guessed.
- Chronicle of Atzoatl rooms are exposed as individual `OPEN ROOM` or
  `OBSTRUCTED ROOM` options. A small high-value set of copied open rooms begins
  enabled; all parsed rooms remain editable.
- Ordinary identified rare maps expose Awakened's active property preset plus
  a separate `BULK` preset. Property mode keeps copied quantity, rarity,
  pack-size, reward, and eight-mod rules; Bulk removes rolled thresholds and
  stale property edits while retaining exact map state and the eight-mod
  discriminator. Normal, magic, and unidentified rare maps use Bulk alone;
  Valdo-reward and unique maps keep their exact comparison.
- Item-state controls are contextual rather than all enabled by default. They
  cover item level, map tier, links, quality, `NOT CORRUPTED` / `CORRUPTED`,
  legacy and Eldritch influences, Foulborn, Vestigial, Foil, fractured, Veiled,
  mirrored, split, and identification only when those fields apply. Hidden
  negative crafting-base predicates remain query constraints, not misleading
  checked buttons.
- Applicable armour/evasion/energy-shield/ward, block, attack-speed, critical-
  chance, DPS, physical-DPS, and elemental-DPS properties appear as
  calculated Trade filters. Advanced Description's copied `current(min-max)`
  rolls reconstruct Awakened's maximum-quality defence and weapon endpoints
  only when every contributing local roll is proven; incomplete evidence falls
  back to the copied total instead of inventing bounds. Exact and zero-
  tolerance positive properties stay minimum-only so better items are not
  excluded. Base defence percentile is included only when the pinned base
  profile proves it and the selected mode needs it. Chaos damage stays outside
  Awakened's physical/elemental DPS model rather than being mixed into an
  incompatible total.
- Availability can be constrained to players currently available, instant
  buyout listings, or all listings. Every selected mapped modifier is retained;
  calculated equipment-property groups are serialized separately.
- Compound multi-line selectors stay one Trade stat; unrelated advanced
  affixes remain separate rows with their source, type, tier, and tags.

## Modifier catalog

Trade stat IDs, craftable base names, and unique fixed-stat profiles are
resolved locally from pinned, transformed Awakened PoE Trade data snapshots.
The base pack preserves every ITEM and UNIQUE variant in source order. The
copied base, armour properties, map tier, exact implicit or explicit stat
reference, and section text select the same variant record Awakened uses, so
multi-base unique candidates retain their matching base and icon.
The stat pack also retains all 95 source StatGroup resolvers rather than
flattening them: category selection and trivial/percentage/fixed-flag merges
run before canonical labels and official IDs are attached, including APT's
per-ID empty, empty-at-100, and divide-by-100 query transforms.
Canonical stat decimal precision and the selected copied tokens also drive the
same outward range rounding used by Awakened.
The catalogs never execute data as code, never silently choose an ambiguous ID,
and fall back to a visible manual-review warning after a game patch. The
shipped planner is source-matched to the pinned Awakened release; future game
or Awakened changes still require regenerating and revalidating the packs.
The pack source commit, source-data date and SHA-256 are embedded in the asset. Updating the
packs is an explicit release-time operation using
`scripts/build-price-check-stat-pack.mjs` and
`scripts/build-price-check-base-pack.mjs`.

The current unique profile pack is pinned to Awakened PoE Trade v3.29.104 commit
`adb6c287bd978a70701e2b65d744dd677c52fb65`. Its `items.ndjson` snapshot
declares which unique explicit stats are fixed or variants, but it does not
ship per-unique numeric roll bounds. GloamCore therefore uses canonical
bounds only when Path of Exile supplies them in Advanced Description copy
text. Without those bounds it can safely expose declared variants, selectors,
Timeless seeds and Foulborn replacements, but it will not auto-enable a small
set of otherwise unproven numeric lines.

## Performance

Modifier checkboxes, number fields, modes, item-state toggles, sliders,
availability, listed age, and result-currency choices rebuild the small local
query plan immediately and mark it for review. These edits never send a Trade
website request. Opening Trade is a separate user gesture that hands the encoded
plan to the system browser.

The compact editor has no modifier-list scroll: all query-relevant rows stay
visible and the native card follows their content. Supporting market context
contracts before modifier controls on a short work area. poe.ninja mirror,
Public Currency Exchange completed-hour, PoE Wiki, and local cache refreshes
remain on their own bounded schedules; none polls the Trade website.

## Data and safety

Each desktop `Ctrl+D` hovered-item capture generates one `Ctrl+C` item-copy
action. Dashboard and mobile manual-paste checks generate none. GloamCore does
not inspect game memory, automate gameplay, read account-session cookies, use
`POESESSID`, or send whispers.

GloamCore never calls the Trade website's undocumented search, exchange, or
fetch APIs. It does not receive Trade result payloads, result IDs, stock,
offers, or account data from that site.

`TRADE` and **Open Trade** are user-clicked browser handoffs with the complete
mapped filters encoded for verification. An edited plan is not silently
replaced by a bare league page. Windows, Android, iOS, and the browser preview
share this boundary.
