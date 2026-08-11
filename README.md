<div align="center">

<img src="docs/assets/readme/gloamcore-logo.png" alt="GloamCore" width="168">

<h1>GloamCore</h1>

<p><strong>Read the market. Price the item. Plan the build.</strong></p>

A polished Path of Exile 1 companion for Windows—one-key price checks, live
economy intelligence, build planning, stash wealth, and practical player tools
in one tray-first app.

[![Latest release](https://img.shields.io/github/v/release/seNkoKG/gloamcore?display_name=tag&sort=semver&style=for-the-badge&color=2ee6c2)](https://github.com/seNkoKG/gloamcore/releases/latest)
[![Windows x64](https://img.shields.io/badge/Windows-x64-17232d?style=for-the-badge&logo=windows&logoColor=2ee6c2)](https://github.com/seNkoKG/gloamcore/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/seNkoKG/gloamcore/total?style=for-the-badge&color=d6a84a)](https://github.com/seNkoKG/gloamcore/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/seNkoKG/gloamcore/ci.yml?branch=main&style=for-the-badge&label=build&color=d6a84a)](https://github.com/seNkoKG/gloamcore/actions/workflows/ci.yml)

[![Download GloamCore](https://img.shields.io/badge/DOWNLOAD_GLOAMCORE-LATEST_STABLE-2ee6c2?style=for-the-badge&logo=windows&logoColor=081116)](https://github.com/seNkoKG/gloamcore/releases/latest/download/GloamCore-Setup-x64.exe)

[Website](https://senkokg.github.io/gloamcore/) ·
[Releases](https://github.com/seNkoKG/gloamcore/releases) ·
[Changelog](CHANGELOG.md) ·
[Report a bug](https://github.com/seNkoKG/gloamcore/issues/new?template=bug_report.yml)

</div>

![GloamCore Market Explorer with current prices, trends, liquidity, and league controls](docs/assets/readme/market-dashboard.jpg)

## Everything important, one shortcut away

| Workspace | What it gives you |
| --- | --- |
| **Price Checker** | Hover an item and press `Ctrl+D` for a compact, roll-aware Trade check over the game. |
| **Market Explorer** | Current league prices, trends, liquidity, filters, local watchlists, and target alerts. |
| **Item Intel** | Searchable PoE Wiki reference data, artwork, requirements, modifiers, and trusted handoffs. |
| **Build Lab** | Import, edit, compare, save, and export PoB-compatible builds on the passive tree. |
| **Stash Wealth** | Wealthy Exile inside an isolated browser profile that remembers its own sign-in. |
| **Player Toolkit** | Regex, item filters, socket colours, economy audits, references, and opt-in overlays. |

## Ctrl+D that stays out of your way

Hover an item in Path of Exile and press `Ctrl+D`. GloamCore performs one
ordinary item-copy action, parses the clipboard locally, and paints a compact
overlay without taking keyboard focus away from the game. Passive card clicks
and dismissal keep Path of Exile active, and the next Ctrl+D remains armed
after any checkbox, filter, or X click. A separate deliberate locked mode
is available when you want full editor interaction.

<p align="center">
  <img src="docs/assets/readme/price-check-malachai.png" alt="GloamCore compact price check with modifier controls and anonymous Trade listings" width="460"><br>
  <em>Roll-aware modifiers and anonymous live listings in the compact overlay.</em>
</p>

The checker understands contextual state for uniques, rares, magic items,
maps, gems, jewels, weapons, armour, and other item families. Price-defining
corruption implicits stay separate—including double corruptions—and the full
query can open directly on the official Trade website.

> Use **Borderless** or **Windowed Fullscreen** for the native overlay. Seller
> rows are asking prices, not completed sales; inspect the full Trade page
> before pricing a valuable item.

## Five connected workflows

### Follow the live economy

Search current poe.ninja markets by league and category, sort and filter rows,
inspect seven-day movement and liquidity, and keep a local watchlist with
Windows target notifications. Last-good data is clearly marked when an
upstream source is temporarily unavailable.

### Plan without inventing numbers

Build Lab imports PoB XML, codes, and supported build links into an interactive
passive-tree workspace with mastery choices, multiple specs, skills, items,
configuration, notes, comparison, undo/redo, and PoB export. Explicit
recalculation uses a separately installed, fingerprint-verified Path of
Building Community engine and fails closed when that engine is unavailable.

### Keep stash wealth signed in

Stash Wealth embeds the real Wealthy Exile website in a dedicated browser
profile. Wealthy Exile owns its Path of Exile connection, cookies, OAuth
tokens, and stash responses; the GloamCore renderer cannot read them. The
profile persists across workspace changes and app restarts. A cached ads-only
filter applies only on Wealthy Exile and turns off on Path of Exile and Steam
sign-in pages.

### Put reference data beside the market

Item Intel combines searchable PoE Wiki Cargo data with current market context
and safe links to specialist sources. The Player Toolkit adds source-tracked
regex, item-filter editing, socket-colour comparison, economy audits, pinned
reference sheets, and isolated opt-in overlay tools.

## Product tour

<table>
  <tr>
    <td width="50%"><img src="docs/assets/readme/build-lab.jpg" alt="GloamCore Build Lab passive tree"></td>
    <td width="50%"><img src="docs/assets/readme/regex-workbench.jpg" alt="GloamCore regex workbench"></td>
  </tr>
  <tr>
    <td align="center"><strong>Build Lab</strong><br>Import, inspect, edit, compare, and export.</td>
    <td align="center"><strong>Regex Workbench</strong><br>Compose explicit WANT/AVOID rules with visible provenance.</td>
  </tr>
</table>

## Install on Windows

1. Download [GloamCore Setup for Windows x64](https://github.com/seNkoKG/gloamcore/releases/latest/download/GloamCore-Setup-x64.exe).
2. Open the installer and choose the install location.
3. Launch GloamCore and leave it available from the system tray.
4. Run Path of Exile in Borderless or Windowed Fullscreen, hover an item, and
   press `Ctrl+D`.

The [latest release](https://github.com/seNkoKG/gloamcore/releases/latest)
also includes a portable build, updater metadata, and SHA-256 checksums.
Windows binaries are not currently Authenticode-signed, so SmartScreen may
show a warning. Verify the repository and checksum before running a download.

Installed builds check the stable GitHub channel when automatic updates are
enabled. Downloads happen in the background, but installation always requires
an explicit **Restart & install** action. Portable users replace the executable
manually. See [Update hosting](docs/UPDATE-HOSTING.md) for the exact release
contract.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+D` | Price-check the item under the cursor in PoE |
| `Ctrl+Alt+D` | Open the price checker in deliberate locked interaction mode |
| `Ctrl+Shift+E` | Show or hide GloamCore globally |
| `Ctrl+Shift+L` | Toggle click-through mode |
| `Ctrl+Shift+Space` | Open instant market search |
| `/` | Focus item search while GloamCore is active |
| `Ctrl+K` | Open Item Intel and focus its search |

Desktop shortcuts are rebindable in Settings. Conflicting combinations are
rejected without replacing the last working binding.

## Privacy and boundaries

- A desktop `Ctrl+D` check issues one ordinary copy action. GloamCore does not
  inspect game memory, inject into the game, automate gameplay, send whispers,
  or request `POESESSID` account-session cookies.
- Preferences, watchlists, saved workspaces, and normal caches stay on the
  local computer.
- Optional private-character import keeps its narrowly scoped official OAuth
  token in memory for the import only and does not cache authenticated
  character responses.
- Wealthy Exile runs in a separate persistent browser profile. Its session and
  private responses are not exposed to the application renderer.
- Compact seller listings use anonymous public Trade website routes. GGG may
  change, reject, or rate-limit them at any time.
- poe.ninja, PoE Wiki, official Trade, and other upstream services can be
  delayed or unavailable; stale fallback data is labelled where applicable.

Read [Price checker behavior](docs/PRICE_CHECKER.md),
[Toolkit and Build Lab boundaries](docs/TOOLKIT_AND_PLANNER.md), and
[Data provenance](docs/DATA_PROVENANCE.md) for the complete trust model.

## Development

GloamCore uses Electron, React, TypeScript, and Vite. The Electron main process
owns global shortcuts, bounded remote requests, disk caching, updates, native
overlay windows, and a narrow context-isolated preload bridge.

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm electron:dev
```

Create Windows release artifacts with `pnpm dist` from the pinned release
toolchain. Read [Contributing](CONTRIBUTING.md) before proposing changes and
[Security](SECURITY.md) before reporting a vulnerability.

## Source and attribution

This repository is **source-available**, not open-source. It declares
`UNLICENSED`; no general permission to copy, modify, or redistribute the source
is granted. Official binaries are provided for end-user installation.

Third-party packages and transformed reference data keep their own licenses
and attribution. See [Third-party notices](THIRD_PARTY_NOTICES.md) and
[Data provenance](docs/DATA_PROVENANCE.md).

---

> **This product isn't affiliated with or endorsed by Grinding Gear Games in any way.**

Path of Exile names, artwork, and game data belong to their respective owners.
poe.ninja, Awakened PoE Trade, Path of Building Community, Wealthy Exile, and
PoE Wiki are independent projects and do not endorse GloamCore.
