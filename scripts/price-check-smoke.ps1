param(
  [switch]$Visible,
  [switch]$Rare,
  [switch]$Wand,
  [string]$Executable
)

$ErrorActionPreference = "Stop"

if ($Rare -and $Wand) {
  throw "Choose either -Rare or -Wand, not both."
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$artifactRoot = Join-Path $projectRoot "artifacts\qa"
$scenario = if ($Wand) { "wand" } elseif ($Rare) { "rare" } else { "unique" }
$artifactResultPath = Join-Path $artifactRoot "price-check-smoke-$scenario.json"
$artifactScreenshotPath = Join-Path $artifactRoot "price-check-smoke-$scenario.png"
$expectedVersion = [string]((
  Get-Content -Raw (Join-Path $projectRoot "package.json") |
    ConvertFrom-Json
).version)
$electron = if ($Executable) {
  [System.IO.Path]::GetFullPath($Executable)
} else {
  Join-Path $projectRoot "node_modules\electron\dist\electron.exe"
}
if (-not (Test-Path -LiteralPath $electron -PathType Leaf)) {
  throw "Electron executable is missing: $electron"
}
if ($Executable) {
  $executableDirectory = Split-Path -Parent $electron
  $deliverablesRoot = Split-Path -Parent $executableDirectory
  $provenancePath = Join-Path $deliverablesRoot "windows-release-provenance.json"
  if (-not (Test-Path -LiteralPath $provenancePath -PathType Leaf)) {
    throw "Packaged smoke requires windows-release-provenance.json beside win-unpacked."
  }
  $provenance = Get-Content -Raw -LiteralPath $provenancePath | ConvertFrom-Json
  $snapshotHead = [string](& git -C $projectRoot rev-parse HEAD 2>$null)
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($snapshotHead)) {
    throw "Packaged smoke could not resolve the release snapshot Git identity."
  }
  if ($provenance.gitHead -ne $snapshotHead.Trim()) {
    throw "Packaged executable provenance does not match this release snapshot."
  }
  $packagedAppAsar = Join-Path $executableDirectory "resources\app.asar"
  $packagedNativeHelper = Join-Path $executableDirectory "resources\native-input\NinjaLensInput.exe"
  foreach ($proof in @(
    @{ Path = $electron; Expected = [string]$provenance.files.unpackedExe.sha256; Label = "executable" },
    @{ Path = $packagedAppAsar; Expected = [string]$provenance.files.appAsar.sha256; Label = "app.asar" },
    @{ Path = $packagedNativeHelper; Expected = [string]$provenance.files.helper.sha256; Label = "native input helper" }
  )) {
    if (-not (Test-Path -LiteralPath $proof.Path -PathType Leaf)) {
      throw "Packaged $($proof.Label) is missing: $($proof.Path)"
    }
    $actualHash = (Get-FileHash -LiteralPath $proof.Path -Algorithm SHA256).Hash
    if (-not $actualHash.Equals($proof.Expected, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Packaged $($proof.Label) does not match recorded release provenance."
    }
  }
}
$emDash = [char]0x2014
$fixture = if ($Wand) {
@"
Item Class: Wands
Rarity: Rare
Golem Spell
Kinetic Wand
--------
Wand
Quality: +28% (augmented)
Physical Damage: 283-513 (augmented)
Critical Strike Chance: 11.05% (augmented)
Attacks per Second: 1.90 (augmented)
Intangibility: 18%
--------
Requirements:
Level: 66
Str: 130
Int: 188
--------
Sockets: W-W-W$([char]0x20)
--------
Item Level: 99
--------
8% increased Explicit Physical Modifier magnitudes (enchant)
--------
{ Implicit Modifier }
Cannot roll Caster Modifiers
--------
{ Prefix Modifier "Flaring" (Tier: 1) $emDash Damage, Physical, Attack  $emDash 8% Increased }
Adds 29(22-29) to 51(45-52) Physical Damage
{ Prefix Modifier "Merciless" (Tier: 1) $emDash Damage, Physical, Attack  $emDash 8% Increased }
171(170-179)% increased Physical Damage
{ Prefix Modifier "Dictator's" (Tier: 1) $emDash Damage, Physical, Attack  $emDash 8% Increased }
78(75-79)% increased Physical Damage
+196(175-200) to Accuracy Rating
{ Suffix Modifier "of the Order" (Tier: 1) $emDash Attack, Critical, Attribute }
+27(25-28) to Strength and Intelligence
30(28-32)% increased Critical Strike Chance
{ Suffix Modifier "of Acclaim" (Tier: 1) $emDash Attack, Speed }
19(17-19)% increased Attack Speed
{ Master Crafted Suffix Modifier "of Craft" (Rank: 3) $emDash Damage, Critical }
+28(25-28)% to Global Critical Strike Multiplier
"@
} elseif ($Rare) {
@"
Item Class: Body Armours
Rarity: Rare
Damnation Pelt
Twilight Regalia
--------
Quality: +20% (augmented)
Energy Shield: 753 (augmented)
[Intangibility|Intangibility]: 8%
--------
Requirements:
Level: 68
Int: 194
--------
Sockets: B-B-B-B-B-B
--------
Item Level: 86
--------
{ Prefix Modifier "Unassailable" (Tier: 1) $emDash Defences, Energy Shield $emDash 100% Increased }
100(81-100)% increased Energy Shield
{ Suffix Modifier "of the Prism" (Tier: 1) $emDash Resistance }
+17% to Fire Resistance
+13% to Cold Resistance
+11% to Lightning Resistance
{ Suffix Modifier "of Mending" (Tier: 2) $emDash Life }
Regenerate 7(6-7) Life per second
{ Prefix Modifier "Chosen" (Tier: 1) $emDash Effect }
10(9-10)% increased Area of Effect
Enemies you Kill have a 35(31-35)% chance to Explode, dealing a quarter of their maximum Life as Chaos Damage
17(16-17)% increased Stun and Block Recovery
Ignore Stuns while using Socketed Attack Skills
Socketed Attacks have -20 to Total Mana Cost
--------
Hunter Item
Fractured Item
"@
} else {
@"
Item Class: Belts
Rarity: Unique
Mageblood
Heavy Belt
--------
Requirements:
Level: 44
--------
Item Level: 86
--------
{ Implicit Modifier $emDash Attribute }
+31(25-35) to Strength
--------
{ Unique Modifier $emDash Attribute }
+31(30-50) to Dexterity
{ Unique Modifier $emDash Resistance }
+20(15-25)% to Fire Resistance
{ Unique Modifier $emDash Resistance }
+19(15-25)% to Cold Resistance
{ Unique Modifier }
Magic Utility Flasks cannot be Used
{ Unique Modifier }
Leftmost 4(2-4) Magic Utility Flasks constantly apply their Flask Effects to you
{ Unique Modifier }
Magic Utility Flask Effects cannot be removed
"@
}
$fixtureBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($fixture))
$qaRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("poe-widget-qa-" + [guid]::NewGuid().ToString("N"))
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$qaRootFull = [System.IO.Path]::GetFullPath($qaRoot)
$resultPath = Join-Path $qaRootFull "price-check-smoke.json"
$stdoutPath = Join-Path $qaRootFull "electron-stdout.log"
$stderrPath = Join-Path $qaRootFull "electron-stderr.log"
$targetStdoutPath = Join-Path $qaRootFull "target-stdout.log"
$targetStderrPath = Join-Path $qaRootFull "target-stderr.log"
$qaTargetTitle = "Ninja Lens QA Path of Exile " + [guid]::NewGuid().ToString("N")
$qaTargetProcess = $null
$appProcess = $null
$qaWindowApiReady = $false
$originalForegroundWindow = [IntPtr]::Zero
$smokeMutex = New-Object System.Threading.Mutex(
  $false,
  "Local\NinjaLensPriceCheckSmoke"
)
$smokeMutexAcquired = $false
if (-not $qaRootFull.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -or $qaRootFull -eq $tempRoot) {
  throw "Refusing to create the QA profile outside the system temp folder."
}
New-Item -ItemType Directory -Path $qaRootFull | Out-Null

try {
  try {
    $smokeMutexAcquired = $smokeMutex.WaitOne(45000)
  } catch [System.Threading.AbandonedMutexException] {
    $smokeMutexAcquired = $true
  }
  if (-not $smokeMutexAcquired) {
    throw "Another native price-check smoke still owns the synthetic foreground target."
  }
  foreach ($oldArtifact in @($artifactResultPath, $artifactScreenshotPath)) {
    if (Test-Path -LiteralPath $oldArtifact) {
      Remove-Item -LiteralPath $oldArtifact -Force
    }
  }
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NinjaLensQaWindow {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr FindWindow(IntPtr className, string windowName);
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr window, int command);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern bool IsWindow(IntPtr window);
}
"@
  $qaWindowApiReady = $true
  $originalForegroundWindow = [NinjaLensQaWindow]::GetForegroundWindow()
  $windowsPowerShell = Join-Path `
    ([Environment]::GetFolderPath([Environment+SpecialFolder]::System)) `
    "WindowsPowerShell\v1.0\powershell.exe"
  if (-not (Test-Path -LiteralPath $windowsPowerShell -PathType Leaf)) {
    throw "Signed Windows PowerShell host is missing: $windowsPowerShell"
  }
  $windowsPowerShellConfig = "$windowsPowerShell.config"
  if (-not (Test-Path -LiteralPath $windowsPowerShellConfig -PathType Leaf)) {
    throw "Signed Windows PowerShell host configuration is missing: $windowsPowerShellConfig"
  }
  # The native input helper deliberately accepts the synthetic QA process only
  # under this exact executable name. Reuse Microsoft's signed PowerShell host
  # byte-for-byte instead of compiling an unsigned target that Application
  # Control can reject; only the in-memory command creates the WinForms window.
  $signedQaTarget = Join-Path $qaRootFull "NinjaLensQaTarget.exe"
  Copy-Item -LiteralPath $windowsPowerShell -Destination $signedQaTarget
  Copy-Item `
    -LiteralPath $windowsPowerShellConfig `
    -Destination "$signedQaTarget.config"
  $sourceHostHash = (Get-FileHash -LiteralPath $windowsPowerShell -Algorithm SHA256).Hash
  $qaHostHash = (Get-FileHash -LiteralPath $signedQaTarget -Algorithm SHA256).Hash
  $qaHostSignature = Get-AuthenticodeSignature -LiteralPath $signedQaTarget
  if (
    -not $qaHostHash.Equals($sourceHostHash, [StringComparison]::OrdinalIgnoreCase) -or
    $qaHostSignature.Status -ne [System.Management.Automation.SignatureStatus]::Valid
  ) {
    throw "The synthetic target is not the verified Microsoft-signed PowerShell host."
  }
  $qaTargetTitleBase64 = [Convert]::ToBase64String(
    [Text.Encoding]::UTF8.GetBytes($qaTargetTitle)
  )
  $targetScript = @"
`$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
`$title = [Text.Encoding]::UTF8.GetString(
  [Convert]::FromBase64String("$qaTargetTitleBase64")
)
`$fixture = [Text.Encoding]::UTF8.GetString(
  [Convert]::FromBase64String("$fixtureBase64")
)
`$form = New-Object System.Windows.Forms.Form
`$timer = New-Object System.Windows.Forms.Timer
`$copySurface = New-Object System.Windows.Forms.TextBox
try {
  [System.Windows.Forms.Application]::EnableVisualStyles()
  `$work = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  `$form.Text = `$title
  `$form.ShowInTaskbar = `$true
  `$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
  `$form.SetBounds(
    `$work.X + 30,
    `$work.Y + 30,
    [Math]::Max(800, `$work.Width - 60),
    [Math]::Max(600, `$work.Height - 60)
  )
  `$form.Opacity = 0.05
  `$form.BackColor = [System.Drawing.Color]::Black
  `$form.KeyPreview = `$true
  `$copySurface.Multiline = `$true
  `$copySurface.ReadOnly = `$true
  `$copySurface.BorderStyle = [System.Windows.Forms.BorderStyle]::None
  `$copySurface.BackColor = [System.Drawing.Color]::Black
  `$copySurface.ForeColor = [System.Drawing.Color]::Black
  `$copySurface.Dock = [System.Windows.Forms.DockStyle]::Fill
  `$copySurface.Text = `$fixture
  `$form.Controls.Add(`$copySurface)
  `$timer.Interval = 60000
  `$timer.Add_Tick({ `$form.Close() })
  `$form.Add_Shown({
    `$form.Activate()
    `$form.BringToFront()
    [void]`$copySurface.Focus()
    `$copySurface.SelectAll()
    `$timer.Start()
  })
  [System.Windows.Forms.Application]::Run(`$form)
} finally {
  `$timer.Dispose()
  `$form.Dispose()
}
"@
  $targetCommand = [Convert]::ToBase64String(
    [Text.Encoding]::Unicode.GetBytes($targetScript)
  )
  $qaTargetProcess = Start-Process `
    -FilePath $signedQaTarget `
    -ArgumentList @(
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Sta",
      "-WindowStyle",
      "Hidden",
      "-EncodedCommand",
      $targetCommand
    ) `
    -RedirectStandardOutput $targetStdoutPath `
    -RedirectStandardError $targetStderrPath `
    -PassThru
  $targetDeadline = [DateTime]::UtcNow.AddSeconds(5)
  $qaTargetWindow = [IntPtr]::Zero
  do {
    Start-Sleep -Milliseconds 100
    $qaTargetProcess.Refresh()
    $qaTargetWindow = [NinjaLensQaWindow]::FindWindow(
      [IntPtr]::Zero,
      $qaTargetTitle
    )
  } until (
    $qaTargetProcess.HasExited -or
    $qaTargetWindow -ne [IntPtr]::Zero -or
    [DateTime]::UtcNow -ge $targetDeadline
  )
  if ($qaTargetProcess.HasExited -or $qaTargetWindow -eq [IntPtr]::Zero) {
    $targetStdout = if (Test-Path -LiteralPath $targetStdoutPath) {
      Get-Content -Raw -LiteralPath $targetStdoutPath
    } else { "" }
    $targetStderr = if (Test-Path -LiteralPath $targetStderrPath) {
      Get-Content -Raw -LiteralPath $targetStderrPath
    } else { "" }
    throw "Synthetic Path of Exile target window did not become ready. STDOUT: $targetStdout STDERR: $targetStderr"
  }
  # Foreground focus and global shortcuts are machine-wide state. A running
  # installed build can need one overlay poll to observe that its real PoE
  # target blurred and release Ctrl+D. Require this synthetic HWND to remain
  # foreground continuously before the source/package app starts; this keeps
  # the smoke deterministic without weakening native title/process checks.
  $focusStableSince = $null
  $focusDeadline = [DateTime]::UtcNow.AddSeconds(6)
  do {
    $qaTargetProcess.Refresh()
    if ($qaTargetProcess.HasExited) {
      throw "Synthetic Path of Exile target exited while acquiring foreground focus."
    }
    if ([NinjaLensQaWindow]::GetForegroundWindow() -eq $qaTargetWindow) {
      if (-not $focusStableSince) {
        $focusStableSince = [DateTime]::UtcNow
      }
    } else {
      $focusStableSince = $null
      [void][NinjaLensQaWindow]::ShowWindowAsync($qaTargetWindow, 5)
      [void][NinjaLensQaWindow]::SetForegroundWindow($qaTargetWindow)
    }
    if (
      $focusStableSince -and
      ([DateTime]::UtcNow - $focusStableSince).TotalMilliseconds -ge 750
    ) {
      break
    }
    Start-Sleep -Milliseconds 50
  } while ([DateTime]::UtcNow -lt $focusDeadline)
  if (
    -not $focusStableSince -or
    ([DateTime]::UtcNow - $focusStableSince).TotalMilliseconds -lt 750 -or
    [NinjaLensQaWindow]::GetForegroundWindow() -ne $qaTargetWindow
  ) {
    throw "Synthetic Path of Exile target did not hold foreground focus for 750 ms."
  }

  # Probe through the same native helper and exact QA-only process name used by
  # Ctrl+D. This turns an identity race into an immediate, actionable failure
  # instead of a 40-second renderer timeout with only a CLIXML stream header.
  $nativeIdentityHelper = if ($Executable) {
    $packagedNativeHelper
  } else {
    Join-Path $projectRoot "build\native-input\NinjaLensInput.exe"
  }
  if (-not (Test-Path -LiteralPath $nativeIdentityHelper -PathType Leaf)) {
    throw "Native identity helper is missing: $nativeIdentityHelper"
  }
  $identityDeadline = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 2000
  $identityProbe = Start-Process `
    -FilePath $nativeIdentityHelper `
    -ArgumentList @(
      "inspect",
      [string]$identityDeadline,
      $qaTargetTitleBase64,
      "NinjaLensQaTarget.exe"
    ) `
    -WindowStyle Hidden `
    -Wait `
    -PassThru
  if ($identityProbe.ExitCode -ne 0) {
    throw "Synthetic target failed native identity readiness with code $($identityProbe.ExitCode)."
  }

  # Do not allow a parent shell's QA payload or expansion flag to bypass this
  # scenario's native Ctrl+C fixture and initial UI contract.
  Remove-Item Env:POE_WIDGET_QA_CLIPBOARD_TEXT -ErrorAction SilentlyContinue
  Remove-Item Env:POE_WIDGET_QA_CLIPBOARD_BASE64 -ErrorAction SilentlyContinue
  Remove-Item Env:POE_WIDGET_QA_EXPAND_STATS -ErrorAction SilentlyContinue
  $env:POE_WIDGET_QA_OPEN_SURFACE = "price-check"
  $env:POE_WIDGET_QA_RESULT_PATH = $resultPath
  $env:POE_WIDGET_QA_TARGET_TITLE = $qaTargetTitle
  $env:POE_WIDGET_QA_CAPTURE_TEST = "1"
  $env:POE_WIDGET_QA_USER_DATA_PATH = $qaRootFull
  if ($Wand) {
    $env:POE_WIDGET_QA_EXPAND_STATS = "1"
  }
  $env:ELECTRON_ENABLE_LOGGING = "1"
  Push-Location $projectRoot
  try {
    $launch = @{
      FilePath = $electron
      WorkingDirectory = $projectRoot
      PassThru = $true
      RedirectStandardOutput = $stdoutPath
      RedirectStandardError = $stderrPath
    }
    if (-not $Executable) {
      $launch.ArgumentList = "."
    } else {
      $launch.ArgumentList = "--ninja-lens-qa-smoke"
    }
    $appProcess = Start-Process @launch
    $appWaitSeconds = 240
    $appDeadline = [DateTime]::UtcNow.AddSeconds($appWaitSeconds)
    do {
      Start-Sleep -Milliseconds 100
      $appProcess.Refresh()
    } until (
      (Test-Path -LiteralPath $resultPath) -or
      $appProcess.HasExited -or
      [DateTime]::UtcNow -ge $appDeadline
    )
    if (-not (Test-Path -LiteralPath $resultPath)) {
      if ($appProcess.HasExited) {
        $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -Raw -LiteralPath $stderrPath } else { "" }
        throw "Electron price-check smoke process exited with code $($appProcess.ExitCode) before writing its result. $stderr"
      }
      $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -Raw -LiteralPath $stderrPath } else { "" }
      $stdout = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -Raw -LiteralPath $stdoutPath } else { "" }
      throw "Electron price-check smoke timed out after $appWaitSeconds seconds. STDERR: $stderr STDOUT: $stdout"
    }
    if (-not $appProcess.HasExited -and -not $appProcess.WaitForExit(20000)) {
      throw "Electron price-check smoke wrote a result but did not exit within 10 seconds."
    }
    if ($appProcess.HasExited) {
      $appProcess.WaitForExit()
      $appProcess.Refresh()
    }
    $appExitCode = $appProcess.ExitCode
    if ($appProcess.HasExited -and $appExitCode -is [int] -and $appExitCode -ne 0) {
      throw "Electron price-check smoke process exited with code $appExitCode."
    }
  } finally {
    Pop-Location
  }

  $result = Get-Content -Raw -LiteralPath $resultPath | ConvertFrom-Json
  if ($result.appVersion -ne $expectedVersion) {
    throw "Price-check smoke ran app version $($result.appVersion), expected $expectedVersion."
  }
  if (-not $result.captureValid -or $result.timedOut -or -not $result.result.ready) {
    throw "Price-check smoke did not reach a ready result: $($result | ConvertTo-Json -Compress -Depth 8)"
  }
  if (-not $result.nativeCaptureTest) {
    throw "Price-check smoke bypassed the native one-key capture path."
  }
  if (
    -not $result.tradeCatalogProbe.available -or
    $result.tradeCatalogProbe.length -lt 1000000 -or
    $result.tradeCatalogProbe.error -or
    $result.result.tradeStatCatalog -ne "ready-desktop"
  ) {
    throw "The integrity-checked Awakened Trade stat catalog was not available to the desktop renderer: $($result.tradeCatalogProbe | ConvertTo-Json -Compress)"
  }
  $expectedItemName = if ($Wand) {
    "Golem Spell"
  } elseif ($Rare) {
    "Damnation Pelt"
  } else {
    "Mageblood"
  }
  if ($result.result.itemName -ne $expectedItemName) {
    throw "Unexpected parsed item: $($result.result.itemName)"
  }
  if (-not ($result.result.buttons | Where-Object { $_ -match "Trade" })) {
    throw "Official Trade handoff is missing from the ready surface."
  }
  if ($Wand) {
    if (
      -not $result.result.modifierEditor -or
      $result.result.modifierRows -ne 9 -or
      $result.result.rangeSliders -ne 0 -or
      $result.result.marketRows -ne 0
    ) {
      throw "Crafted wand did not render its complete nine-row compact editor."
    }
    $modifierLabels = @($result.result.modifierLabels)
    $expectedWeaponPropertyLabels = @(
      "Physical DPS",
      "Attacks per Second",
      "Critical Strike Chance"
    )
    for ($labelIndex = 0; $labelIndex -lt $expectedWeaponPropertyLabels.Count; $labelIndex++) {
      $expectedLabel = $expectedWeaponPropertyLabels[$labelIndex]
      $expectedLabelPattern = "^$([regex]::Escape($expectedLabel))(?:\s*:|$)"
      if ($modifierLabels[$labelIndex] -notmatch $expectedLabelPattern) {
        throw "Crafted wand editor did not preserve the $expectedLabel property order."
      }
    }
    foreach ($redundantLabel in @("Weapon Damage", "Total DPS")) {
      $redundantLabelPattern = "^$([regex]::Escape($redundantLabel))(?:\s*:|$)"
      if ($modifierLabels -match $redundantLabelPattern) {
        throw "Crafted wand editor retained redundant $redundantLabel property."
      }
    }
    if (
      $result.result.editorHeading -ne "0/10 STATS" -or
      $result.result.text -match 'Weapon Damage|Total DPS|CALCULATED PROPERTY|EMPTY OR CRAFTED' -or
      $result.result.text -match "\b(?:SHOW|HIDE)\s+\d+\b" -or
      $result.result.matchModeSelects -ne 0
    ) {
      throw "Crafted wand compact summary did not keep its hidden helper in the ten-stat total."
    }
    $stateLabels = @($result.result.stateLabels)
    foreach ($expectedState in @("ILVL", "NOT CORRUPTED")) {
      if ($stateLabels -notcontains $expectedState) {
        throw "Crafted wand editor is missing the $expectedState item-state control."
      }
    }
    if ($stateLabels -contains "LINKS") {
      throw "Crafted wand exposed a three-link Trade filter that APT suppresses."
    }
    if ($stateLabels -contains "QUALITY") {
      throw "Similar-mode crafted wand incorrectly exposed the Base/Exact quality control."
    }
    if ($result.result.liveListings -or $result.result.text -match "\bLOADING\b") {
      throw "Crafted wand started seller listings before the explicit Search action."
    }
    if (-not $result.modifierInteraction.skipped) {
      throw "Crafted wand fabricated slider interaction without proven APT bounds: $($result.modifierInteraction | ConvertTo-Json -Compress)"
    }
  } elseif ($Rare) {
    if (
      -not $result.result.modifierEditor -or
      $result.result.modifierRows -lt 1 -or
      $result.result.rangeSliders -ne 0 -or
      $result.result.marketRows -ne 0
    ) {
      throw "Rare modifier editor did not replace misleading base-market rows."
    }
    if (
      $result.result.text -match "\bUNMAPPED\b" -or
      $result.result.text -notmatch "41% total Elemental Resistance"
    ) {
      throw "Rare modifier mapping did not produce the expected searchable pseudo filters."
    }
    $stateLabels = @($result.result.stateLabels)
    foreach ($expectedState in @("ILVL", "LINKS", "HUNTER", "NOT CORRUPTED")) {
      if ($stateLabels -notcontains $expectedState) {
        throw "Rare editor is missing the $expectedState item-state control."
      }
    }
    if ($stateLabels -contains "QUALITY") {
      throw "Similar-mode rare armour incorrectly exposed the Base/Exact quality control."
    }
    if ($stateLabels -contains "FRACTURED") {
      throw "Rare editor exposed a positive FRACTURED filter that Awakened does not submit."
    }
    if (-not $result.modifierInteraction.skipped) {
      throw "Rare editor fabricated slider interaction without proven APT bounds: $($result.modifierInteraction | ConvertTo-Json -Compress)"
    }
    if ($result.result.sourceLabel -notmatch "^(TRADE FILTERS|SEARCHING|TRADE (LIVE|STALE|ERROR))$") {
      throw "Rare overlay did not identify its filter source truthfully."
    }
    $headingMatch = [regex]::Match(
      [string]$result.result.editorHeading,
      '^(?<selected>\d+)/(?<total>\d+) STATS$'
    )
    if (-not $headingMatch.Success) {
      throw "Rare overlay emitted an invalid selected-stat summary: $($result.result.editorHeading)"
    }
    $selectedStats = [int]$headingMatch.Groups["selected"].Value
    $totalStats = [int]$headingMatch.Groups["total"].Value
    if (
      $selectedStats -ne 2 -or
      $totalStats -ne 9 -or
      $result.result.modifierRows -ne 8 -or
      $result.result.text -match "\b(?:SHOW|HIDE)\s+\d+\b" -or
      $result.result.matchModeSelects -ne 0
    ) {
      throw "Rare overlay did not render every ordinary stat without an optional-stat fold."
    }
    if ($result.result.liveListings -or $result.result.text -match "\bLOADING\b") {
      throw "Rare overlay started seller listings before the explicit Awakened-style Search action."
    }
  } else {
    if (
      -not $result.result.modifierEditor -or
      $result.result.modifierRows -ne 4 -or
      $result.result.rangeSliders -ne 8 -or
      $result.result.marketRows -ne 0
    ) {
      throw "Canonical Mageblood did not render exactly four bounded visible stats."
    }
    if ($result.result.editorHeading -ne "1/7 STATS") {
      throw "Canonical Mageblood did not preserve Awakened's one-of-seven stat summary."
    }
    $modifierLabels = @($result.result.modifierLabels)
    foreach ($expectedLabel in @(
      "39% total Elemental Resistance",
      "31 total to Strength",
      "31 total to Dexterity",
      "Leftmost 4 Magic Utility Flask constantly applies its Flask Effect to you"
    )) {
      if ($modifierLabels -notcontains $expectedLabel) {
        throw "Canonical Mageblood editor is missing $expectedLabel."
      }
    }
    if (
      $result.result.text -match "Magic Utility Flasks cannot be Used" -or
      $result.result.text -match "Magic Utility Flask Effects cannot be removed" -or
      $result.result.text -match "\b(?:SHOW|HIDE)\s+\d+\b"
    ) {
      throw "Canonical Mageblood exposed upstream-hidden stats or an optional-stat fold."
    }
    if (
      -not $result.modifierInteraction.ready -or
      -not $result.modifierInteraction.updated -or
      $result.modifierInteraction.elapsedMs -gt 250 -or
      $result.modifierInteraction.horizontalOverflow -ne 0
    ) {
      throw "Canonical Mageblood range input was not immediately usable: $($result.modifierInteraction | ConvertTo-Json -Compress)"
    }
    if ($result.result.sourceLabel -notmatch "^(TRADE FILTERS|SEARCHING|TRADE (LIVE|STALE|ERROR))$") {
      throw "Compact official Trade source labeling is missing."
    }
    if ([string]::IsNullOrWhiteSpace($result.result.estimateLabel)) {
      throw "The unique price headline was blank."
    }
    if ($result.result.estimateLabel -match '^NO PRICE$') {
      $positiveListingPrice = [regex]::IsMatch(
        [string]$result.result.text,
        '\b(?:[1-9]\d*(?:\.\d+)?|0\.\d*[1-9]\d*)\s*(?:CHAOS|DIVINE)\b'
      )
      if (
        -not $result.result.liveListings -or
        $result.result.listingRows -lt 1 -or
        -not $positiveListingPrice -or
        $result.result.sourceLabel -match 'ERROR|STALE' -or
        $result.result.text -match '(?m)^(?:TRADE|LISTINGS)\s+(?:ERROR|STALE)\b'
      ) {
        throw "NO PRICE was not backed by a live official listing with a positive finite price."
      }
    }
    if (-not $result.result.liveListings) {
      throw "The compact unique overlay did not mount the automatic seller-listing surface."
    }
    if ($result.result.matchModeSelects -ne 0) {
      throw "Unique compact overlay retained per-row match-mode controls."
    }
    if (@($result.result.stateLabels) -notcontains "NOT CORRUPTED") {
      throw "Unique compact overlay is missing its visible NOT CORRUPTED state."
    }
  }
  if (-not $result.result.detailButton) {
    throw "Detailed-checker handoff is missing."
  }
  if ($result.result.horizontalOverflow -ne 0) {
    throw "Price-check overlay has $($result.result.horizontalOverflow)px of horizontal overflow."
  }
  if ($result.result.verticalOverflow -ne 0) {
    throw "Price-check card has $($result.result.verticalOverflow)px of vertical overflow."
  }
  if ($result.result.factHorizontalOverflow -ne 0) {
    throw "Price-check item facts have $($result.result.factHorizontalOverflow)px of horizontal overflow."
  }
  if ($result.result.resultsOverflow -ne 0) {
    throw "Price-check results have $($result.result.resultsOverflow)px of internal overflow."
  }
  if ($result.result.editorOverflow -ne 0) {
    throw "Item modifier editor has $($result.result.editorOverflow)px of horizontal overflow."
  }
  if ($result.result.stateStripOverflow -ne 0) {
    throw "Item-state controls have $($result.result.stateStripOverflow)px of horizontal overflow."
  }
  if ($result.result.stateStripVerticalOverflow -ne 0) {
    throw "Item-state controls exceed the two-row strip by $($result.result.stateStripVerticalOverflow)px."
  }
  if ($result.result.borderRadius -gt 1) {
    throw "Price-check overlay is not flat: $($result.result.borderRadius)px radius."
  }
  if (-not $result.result.compactCopyClean) {
    throw "Price-check overlay contains stale or verbose copy."
  }
  if ($result.result.surfaceBounds.width -gt 460) {
    throw "Price-check overlay is wider than the Awakened-parity 460px limit."
  }
  $panelWorkArea = if ($result.window.PSObject.Properties.Name -contains "panelWorkArea") {
    $result.window.panelWorkArea
  } else {
    $result.window.cursorWorkArea
  }
  $workAreaBottom = $panelWorkArea.y + $panelWorkArea.height
  $panelBottom = $result.window.bounds.y + $result.result.surfaceBounds.y + $result.result.surfaceBounds.height
  if (
    $result.window.bounds.x + $result.result.surfaceBounds.x -lt $panelWorkArea.x -or
    $result.window.bounds.y + $result.result.surfaceBounds.y -lt $panelWorkArea.y -or
    $result.window.bounds.x + $result.result.surfaceBounds.x + $result.result.surfaceBounds.width -gt $panelWorkArea.x + $panelWorkArea.width -or
    $panelBottom -gt $workAreaBottom
  ) {
    throw "Price-check overlay escaped the active monitor work area."
  }
  if ([math]::Abs($result.result.surfaceBounds.height - $result.result.expectedHeight) -gt 1) {
    throw "Price-check overlay did not match its content-driven result height."
  }
  if (
    $result.result.modifierListOverflow -ne 0 -or
    $result.result.layoutHeights.modifierListScroll -ne $result.result.layoutHeights.modifierListClient
  ) {
    $overflowState = [pscustomobject]@{
      DesiredHeight = $result.result.desiredHeight
      ExpectedHeight = $result.result.expectedHeight
      SurfaceHeight = $result.result.surfaceBounds.height
      ModifierListOverflow = $result.result.modifierListOverflow
      LayoutHeights = $result.result.layoutHeights
    } | ConvertTo-Json -Compress
    throw "The complete modifier list retained an internal scrollbar: $overflowState"
  }
  if (-not $result.window.alwaysOnTop) {
    throw "Price-check overlay was not always-on-top during the smoke test."
  }
  if (-not $result.window.overlayAttached -or -not $result.window.overlayHasAccess) {
    throw "Price-check overlay did not attach to its Path of Exile target."
  }
  if (
    $result.window.overlayInteractive -or
    $result.window.focused -or
    $result.window.overlayMode -ne "passive" -or
    -not $result.lifecycle.passiveInitial.targetActive -or
    $result.lifecycle.passiveInitial.overlayFocused -or
    $result.lifecycle.passiveInitial.interactive
  ) {
    throw "Default Ctrl+D did not open a passive, non-focused in-game preview."
  }
  if (-not $result.window.dashboardHidden) {
    throw "The dashboard remained visible behind the in-game overlay."
  }
  if (-not $result.window.panelInsideOverlay) {
    throw "The price-check card was not fully contained inside the PoE overlay."
  }
  if (
    $result.pinToggle.panelBefore.x -ne $result.result.surfaceBounds.x -or
    $result.pinToggle.panelBefore.y -ne $result.result.surfaceBounds.y -or
    $result.pinToggle.panelBefore.width -ne $result.result.surfaceBounds.width -or
    $result.pinToggle.panelBefore.height -ne $result.result.surfaceBounds.height
  ) {
    throw "The settled native click-through shape and rendered compact card are misaligned."
  }
  if (-not $result.window.overlayShapeApplied) {
    throw "The native card shape was not applied; transparent pixels could block game clicks."
  }
  if (-not $result.pinToggle.pinned -or -not $result.pinToggle.panelStable) {
    $pinFailure = [pscustomobject]@{
      Pin = $result.pinToggle
      Locked = $result.lifecycle.locked
      Events = $result.lifecycle.events
    } | ConvertTo-Json -Compress -Depth 8
    throw "Pinning did not preserve the card's position: $pinFailure"
  }
  if (
    -not $result.resizeDedupe.panelStable -or
    $result.resizeDedupe.geometryTimerPending
  ) {
    throw "Repeated compact resize requests caused an overlay feedback loop: $($result.resizeDedupe | ConvertTo-Json -Compress)"
  }
  if (
    -not $result.panelMove.supported -or
    -not $result.panelMove.moved -or
    -not $result.panelMove.rendererAligned -or
    -not $result.panelMove.positionPersisted -or
    -not $result.panelMove.openNearCursorDisabled -or
    -not $result.panelMove.nativeShapeApplied
  ) {
    throw "Dragging did not move, align, and persist the native overlay card: $($result.panelMove | ConvertTo-Json -Compress -Depth 6)"
  }
  if (
    -not $result.lifecycle.passiveRepeat.callbacksCompleted -or
    -not $result.lifecycle.passiveRepeat.firstGenerationAdvanced -or
    -not $result.lifecycle.passiveRepeat.secondGenerationAdvanced -or
    $result.lifecycle.passiveRepeat.elapsedMs -gt 3000 -or
    $result.lifecycle.passiveRepeat.focusHandoffAttempted -or
    $result.lifecycle.passiveRepeat.mode -ne "passive" -or
    -not $result.lifecycle.passiveRepeat.targetActive -or
    $result.lifecycle.passiveRepeat.overlayFocused -or
    $result.lifecycle.passiveRepeat.interactive -or
    -not $result.lifecycle.passiveRepeat.positionStable -or
    $result.lifecycle.passiveRepeat.normalRegistered -ne $result.shortcut.configured -or
    $result.lifecycle.passiveRepeat.lockedRegistered -ne $result.shortcut.lockedConfigured
  ) {
    $passiveFailure = [pscustomobject]@{
      Repeat = $result.lifecycle.passiveRepeat
      Events = $result.lifecycle.events
    } | ConvertTo-Json -Compress -Depth 8
    throw "Back-to-back default Ctrl+D checks were not passive, immediate, and focus-stable: $passiveFailure"
  }
  if (
    -not $result.lifecycle.locked.generationAdvanced -or
    $result.lifecycle.locked.focusHandoffAttempted -or
    $result.lifecycle.locked.mode -ne "locked" -or
    -not $result.lifecycle.locked.overlayFocused -or
    -not $result.lifecycle.locked.interactive -or
    $result.lifecycle.locked.activationPending -or
    $result.lifecycle.locked.globalNormalRegistered -or
    $result.lifecycle.locked.globalLockedRegistered
  ) {
    throw "Ctrl+Alt+D did not enter the focused locked interaction mode: $($result.lifecycle.locked | ConvertTo-Json -Compress -Depth 6)"
  }
  if (
    $result.shortcut.registeredWhilePinned -or
    $result.shortcut.registeredLockedWhilePinned -or
    $result.shortcut.registeredWhileOverlayFocused
  ) {
    throw "Global price-check shortcuts remained registered while the overlay owned focus."
  }
  if (
    $result.lifecycle.altTab.overlayVisible -or
    $result.lifecycle.altTab.overlayInteractive -or
    $result.lifecycle.altTab.overlayFocused -or
    $result.lifecycle.altTab.mode -ne "hidden" -or
    $result.lifecycle.altTab.focusHandoffAttempted -or
    $result.lifecycle.altTab.focusRestoreScheduled -or
    $result.lifecycle.altTab.normalRegistered -or
    $result.lifecycle.altTab.lockedRegistered -or
    -not $result.lifecycle.altTab.unrelatedWindowFocused
  ) {
    throw "Alt-Tab did not dismiss cleanly without restoring or stealing focus: $($result.lifecycle.altTab | ConvertTo-Json -Compress -Depth 6)"
  }
  if (
    -not $result.lifecycle.lockedReopen.generationAdvanced -or
    $result.lifecycle.lockedReopen.mode -ne "locked" -or
    -not $result.lifecycle.lockedReopen.panelVisible -or
    -not $result.lifecycle.lockedReopen.interactive -or
    -not $result.lifecycle.lockedReopen.overlayFocused -or
    -not $result.lifecycle.lockedReopen.savedPositionPreserved
  ) {
    $reopenFailure = [pscustomobject]@{
      Reopen = $result.lifecycle.lockedReopen
      AltTab = $result.lifecycle.altTab
      Shortcut = $result.shortcut
      Events = $result.lifecycle.events
    } | ConvertTo-Json -Compress -Depth 8
    throw "Locked mode did not reopen smoothly after Alt-Tab: $reopenFailure"
  }
  if (
    $result.dismissal.error -or
    $result.dismissal.action -ne "close-button" -or
    -not $result.dismissal.closeButtonClicked -or
    -not $result.dismissal.panelHidden -or
    $result.dismissal.overlayVisible -or
    $result.dismissal.overlayInteractive -or
    $result.dismissal.overlayMode -ne "hidden" -or
    -not ($result.dismissal.PSObject.Properties.Name -contains "overlayFocusable") -or
    -not $result.dismissal.overlayFocusable -or
    $result.dismissal.overlayShapeApplied -or
    $result.dismissal.nativePanel -or
    $result.dismissal.geometryTimerPending -or
    $result.dismissal.activationPending -or
    $result.dismissal.capturePending -or
    -not $result.dismissal.windowVisible -or
    -not $result.dismissal.targetActive -or
    -not $result.dismissal.focusRestoreAudit.success
  ) {
    $dismissalState = $result.dismissal | ConvertTo-Json -Compress -Depth 6
    throw "The close button did not clear the shaped panel while keeping the passive overlay host stable and returning input focus to Path of Exile: $dismissalState"
  }
  foreach ($surfaceName in @("priceCheck", "dashboard", "tray", "quickSearch")) {
    if (-not $result.backgroundThrottling.$surfaceName) {
      throw "The $surfaceName Chromium surface can keep rendering while hidden."
    }
  }
  if ($Visible -and -not $result.window.visible) {
    throw "Price-check overlay did not become visible during a normal Electron launch."
  }
  if (-not $result.window.pinDefaultApplied) {
    throw "Price-check overlay did not apply its configured default pin state."
  }
  if (
    -not $result.shortcut.registeredDuringOverlay -or
    -not $result.shortcut.registeredLockedDuringOverlay -or
    -not $result.shortcut.registeredAfterAltTabReturn -or
    -not $result.shortcut.registeredLockedAfterAltTabReturn -or
    -not $result.shortcut.registeredAfterTargetFocus -or
    -not $result.shortcut.registeredLockedAfterTargetFocus -or
    $result.shortcut.warning
  ) {
    throw "Price-check shortcuts were not scoped exclusively to Path of Exile: $($result.shortcut | ConvertTo-Json -Compress)"
  }
  if (-not $result.screenshotPath -or -not (Test-Path -LiteralPath $result.screenshotPath)) {
    throw "Price-check smoke did not capture a visual QA screenshot: $($result.screenshotError)"
  }
  New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
  Copy-Item -LiteralPath $result.screenshotPath -Destination $artifactScreenshotPath
  $result.screenshotPath = [System.IO.Path]::GetFullPath($artifactScreenshotPath)
  $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $artifactResultPath -Encoding utf8
  $result | ConvertTo-Json -Depth 8
} catch {
  New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
  foreach ($diagnostic in @(
    @{ Source = $resultPath; Name = "price-check-smoke-$scenario-failed-result.json" },
    @{ Source = $targetStdoutPath; Name = "price-check-smoke-$scenario-failed-target-stdout.log" },
    @{ Source = $targetStderrPath; Name = "price-check-smoke-$scenario-failed-target-stderr.log" },
    @{ Source = $stdoutPath; Name = "price-check-smoke-$scenario-failed-stdout.log" },
    @{ Source = $stderrPath; Name = "price-check-smoke-$scenario-failed-stderr.log" }
  )) {
    if (Test-Path -LiteralPath $diagnostic.Source -PathType Leaf) {
      Copy-Item -LiteralPath $diagnostic.Source -Destination (Join-Path $artifactRoot $diagnostic.Name) -Force
    }
  }
  throw
} finally {
  try {
    Remove-Item Env:POE_WIDGET_QA_OPEN_SURFACE -ErrorAction SilentlyContinue
    Remove-Item Env:POE_WIDGET_QA_RESULT_PATH -ErrorAction SilentlyContinue
    Remove-Item Env:POE_WIDGET_QA_TARGET_TITLE -ErrorAction SilentlyContinue
    Remove-Item Env:POE_WIDGET_QA_CLIPBOARD_TEXT -ErrorAction SilentlyContinue
    Remove-Item Env:POE_WIDGET_QA_CLIPBOARD_BASE64 -ErrorAction SilentlyContinue
    Remove-Item Env:POE_WIDGET_QA_CAPTURE_TEST -ErrorAction SilentlyContinue
    Remove-Item Env:POE_WIDGET_QA_USER_DATA_PATH -ErrorAction SilentlyContinue
    Remove-Item Env:POE_WIDGET_QA_EXPAND_STATS -ErrorAction SilentlyContinue
    Remove-Item Env:ELECTRON_ENABLE_LOGGING -ErrorAction SilentlyContinue
    if ($appProcess -and -not $appProcess.HasExited) {
      Stop-Process -Id $appProcess.Id -Force
      $appProcess.WaitForExit()
    }
    if ($qaTargetProcess -and -not $qaTargetProcess.HasExited) {
      Stop-Process -Id $qaTargetProcess.Id -Force
      $qaTargetProcess.WaitForExit()
    }
    if (
      $qaWindowApiReady -and
      $originalForegroundWindow -ne [IntPtr]::Zero -and
      [NinjaLensQaWindow]::IsWindow($originalForegroundWindow)
    ) {
      [void][NinjaLensQaWindow]::SetForegroundWindow($originalForegroundWindow)
    }
    if (Test-Path -LiteralPath $qaRootFull) {
      Remove-Item -LiteralPath $qaRootFull -Recurse -Force
    }
  } finally {
    if ($smokeMutexAcquired) {
      $smokeMutex.ReleaseMutex()
    }
    $smokeMutex.Dispose()
  }
}
