param(
  [string]$Version
)

$ErrorActionPreference = "Stop"
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$deliverables = Join-Path $workspaceRoot "deliverables"
$packagePath = Join-Path $workspaceRoot "package.json"
$package = Get-Content -Raw $packagePath | ConvertFrom-Json
$packageVersion = [string]$package.version

if (-not $Version) {
  $Version = $packageVersion
}
if ($Version -ne $packageVersion) {
  throw "Requested version $Version does not match package.json $packageVersion."
}

$setupName = "GloamCore-Setup-$Version-x64.exe"
$portableName = "GloamCore-Portable-$Version-x64.exe"
$setupPath = Join-Path $deliverables $setupName
$portablePath = Join-Path $deliverables $portableName
$stageName = "GloamCore-$Version-Friends"
$stagePath = Join-Path $deliverables $stageName
$zipPath = Join-Path $deliverables "$stageName.zip"
$zipHashPath = Join-Path $deliverables "$stageName.sha256.txt"
$deliverablesFull = [System.IO.Path]::GetFullPath($deliverables)
$stageFull = [System.IO.Path]::GetFullPath($stagePath)
$zipFull = [System.IO.Path]::GetFullPath($zipPath)
$zipHashFull = [System.IO.Path]::GetFullPath($zipHashPath)

if (-not (Test-Path -LiteralPath $setupPath)) {
  throw "Missing installer: $setupPath"
}
if (-not (Test-Path -LiteralPath $portablePath)) {
  throw "Missing portable build: $portablePath"
}

function Assert-ReleaseExecutable {
  param(
    [string]$Path,
    [string]$ExpectedVersion,
    [string]$ExpectedProductName,
    [switch]$AllowFourPartVersion
  )

  $item = Get-Item -LiteralPath $Path
  $fileVersion = [string]$item.VersionInfo.FileVersion
  $productVersion = [string]$item.VersionInfo.ProductVersion
  if ($AllowFourPartVersion) {
    try {
      $expectedParsed = [version]$ExpectedVersion
      $fileParsed = [version]$fileVersion
      $productParsed = [version]$productVersion
    } catch {
      throw "Could not parse embedded version metadata in $Path."
    }
    if (
      $fileParsed.Major -ne $expectedParsed.Major -or
      $fileParsed.Minor -ne $expectedParsed.Minor -or
      $fileParsed.Build -ne $expectedParsed.Build -or
      $productParsed.Major -ne $expectedParsed.Major -or
      $productParsed.Minor -ne $expectedParsed.Minor -or
      $productParsed.Build -ne $expectedParsed.Build
    ) {
      throw "$Path embeds FileVersion $fileVersion / ProductVersion $productVersion, expected $ExpectedVersion."
    }
  } elseif ($fileVersion.Trim() -ne $ExpectedVersion -or $productVersion.Trim() -ne $ExpectedVersion) {
    throw "$Path embeds FileVersion $fileVersion / ProductVersion $productVersion, expected exactly $ExpectedVersion."
  }
  if ([string]$item.VersionInfo.ProductName -ne $ExpectedProductName) {
    throw "$Path embeds ProductName '$($item.VersionInfo.ProductName)', expected '$ExpectedProductName'."
  }
}

$productName = [string]$package.build.productName
Assert-ReleaseExecutable -Path $setupPath -ExpectedVersion $Version -ExpectedProductName $productName
Assert-ReleaseExecutable -Path $portablePath -ExpectedVersion $Version -ExpectedProductName $productName

$unpackedExePath = Join-Path $deliverables "win-unpacked/$productName.exe"
$appAsarPath = Join-Path $deliverables "win-unpacked/resources/app.asar"
$packagedHelperPath = Join-Path $deliverables "win-unpacked/resources/native-input/GloamCoreInput.exe"
foreach ($required in @($unpackedExePath, $appAsarPath, $packagedHelperPath)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "Required unpacked release file is missing: $required"
  }
}
Assert-ReleaseExecutable -Path $unpackedExePath -ExpectedVersion $Version -ExpectedProductName $productName -AllowFourPartVersion

$resourceTime = @(
  (Get-Item -LiteralPath $appAsarPath).LastWriteTimeUtc,
  (Get-Item -LiteralPath $packagedHelperPath).LastWriteTimeUtc
) | Sort-Object -Descending | Select-Object -First 1
foreach ($artifactPath in @($setupPath, $portablePath)) {
  if ((Get-Item -LiteralPath $artifactPath).LastWriteTimeUtc -lt $resourceTime.AddSeconds(-2)) {
    throw "$artifactPath predates the unpacked application resources. Rebuild the Windows release."
  }
}

. (Join-Path $PSScriptRoot "resolve-release-toolchain.ps1")
$toolchain = Get-ReleaseToolchain -ProjectRoot $workspaceRoot
$nodePath = $toolchain.NodePath
& $nodePath (Join-Path $PSScriptRoot "verify-release-artifacts.mjs") windows --root $workspaceRoot --version $Version
if ($LASTEXITCODE -ne 0) {
  throw "Windows release artifact verification failed."
}

if (-not $stageFull.StartsWith("$deliverablesFull\", [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to use a staging folder outside deliverables."
}
if (-not $zipFull.StartsWith("$deliverablesFull\", [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to write an archive outside deliverables."
}
if (-not $zipHashFull.StartsWith("$deliverablesFull\", [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to write a checksum outside deliverables."
}

if (Test-Path -LiteralPath $stageFull) {
  Remove-Item -LiteralPath $stageFull -Recurse -Force
}
if (Test-Path -LiteralPath $zipFull) {
  Remove-Item -LiteralPath $zipFull -Force
}
if (Test-Path -LiteralPath $zipHashFull) {
  Remove-Item -LiteralPath $zipHashFull -Force
}

New-Item -ItemType Directory -Path $stageFull | Out-Null
Copy-Item -LiteralPath $setupPath -Destination (Join-Path $stageFull $setupName)
Copy-Item -LiteralPath $portablePath -Destination (Join-Path $stageFull $portableName)

$friendReadme = @"
GLOAMCORE - POE 1 COMPANION $Version

WHAT IT IS
A slick dark desktop economy dashboard for the current Path of Exile 1 league.
It covers all poe.ninja economy categories, live prices, seven-day movement,
liquidity, search, filters, watch targets, tray controls, and instant global
search. Item Intel adds live item, base, and modifier records with acquisition,
tiers, tags, internal groups, and safe Wiki/PoEDB/Craft of Exile handoffs. Rich
Item Intel cards explain what an item is and put Inspect, Watch, Trade, and Wiki
one click away.
The Ctrl+D price checker copies the item under your cursor and opens as a tiny
flat panel directly over the Path of Exile window. It follows the game
across monitor, size, minimize, and restore changes; Escape closes the panel and
returns input to PoE. Economy items show current poe.ninja estimates and close
market matches. Rare, magic, and roll-sensitive unique items get a dense local
modifier editor with checkboxes, exact min/max fields, dual sliders, and
item-state controls. Watcher's Eye effects and exact Timeless Jewel seeds are
included, alongside Forbidden Flame/Flesh choices, Thread of Hope rings,
Chronicle rooms, Veiled state, calculated equipment properties, and
direction-aware unique roll ranges. The desktop checker builds an exact local
Trade plan without contacting the Trade website. Filter edits remain local. A
deliberate Trade click opens the official league page in the user's browser
with mapped filters prefilled for final verification. GloamCore does not call
the site's undocumented search, exchange, or fetch APIs.
No account session, POESESSID, game memory, DLL injection, whisper automation,
or automated gameplay is used.

WHY IT IS FASTER THAN USING THE WEBSITE
- Always-on-top and compact widget modes.
- Global show/hide: Ctrl+Shift+E.
- Instant item search: Ctrl+Shift+Space.
- One-key hovered-item price check: Ctrl+D.
- Native PoE-attached overlay that stays out of the Windows taskbar.
- Game-data search: Ctrl+K inside the dashboard.
- Personal watchlist and buy-price alerts.
- Cached live data, so reopening markets is fast and temporary outages are safe.
- Item descriptions and modifiers appear beside the current market data.
- Current league markets refresh with source-age and stale-data guards.
- Exact editable Trade filters with a user-clicked official-site handoff.

INSTALL
Recommended: run $setupName
No install: run $portableName

Before upgrading, quit any older GloamCore instance from
its system-tray menu so Windows can replace every application file cleanly.
The installer creates Desktop and Start Menu shortcuts. Closing the window sends
the widget to the tray; use its tray menu to restore or quit.

WINDOWS WARNING
This personal build is not code-signed, so SmartScreen may appear. Only continue
if you received this archive from someone you trust.

DATA AND SAFETY
The widget reads GloamCore's poe.ninja mirror, PoE Wiki, and documented Public
Currency Exchange completed-hour evidence from Faustus. It does not read game
memory, send whispers, or automate gameplay. Each price-check shortcut
generates one item-copy action. Trade filters are built locally; only a user
click opens the encoded query on the official Trade website. GloamCore never
receives Trade results from that page.
"@
Set-Content -LiteralPath (Join-Path $stageFull "README-FRIENDS.txt") -Value $friendReadme -Encoding utf8

$hashLines = @($setupName, $portableName) | ForEach-Object {
  $itemPath = Join-Path $stageFull $_
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $itemPath).Hash.ToLowerInvariant()
  "$hash  $_"
}
Set-Content -LiteralPath (Join-Path $stageFull "SHA256SUMS.txt") -Value $hashLines -Encoding ascii

Compress-Archive -LiteralPath $stageFull -DestinationPath $zipFull -CompressionLevel Optimal
Remove-Item -LiteralPath $stageFull -Recurse -Force

$archiveHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipFull).Hash.ToLowerInvariant()
Set-Content -LiteralPath $zipHashFull -Value "$archiveHash  $($stageName).zip" -Encoding ascii
Write-Output "Created $zipFull"
Write-Output "Created $zipHashFull"
Write-Output "SHA256 $archiveHash"
