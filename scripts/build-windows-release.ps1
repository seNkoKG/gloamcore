param(
  [string]$Version
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$packageJson = Get-Content -Raw (Join-Path $projectRoot "package.json") | ConvertFrom-Json
$packageVersion = [string]$packageJson.version
. (Join-Path $PSScriptRoot "resolve-release-toolchain.ps1")
$toolchain = Get-ReleaseToolchain -ProjectRoot $projectRoot
$pnpmCommand = $toolchain.PnpmPath
$nodePath = $toolchain.NodePath
if (-not $Version) {
  $Version = $packageVersion
}
if ($Version -ne $packageVersion) {
  throw "Requested version $Version does not match package.json $packageVersion."
}

$deliverables = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "deliverables"))
$winUnpacked = [System.IO.Path]::GetFullPath((Join-Path $deliverables "win-unpacked"))
$setupPath = [System.IO.Path]::GetFullPath(
  (Join-Path $deliverables "PoE-Economy-Widget-Setup-$Version-x64.exe")
)
$portablePath = [System.IO.Path]::GetFullPath(
  (Join-Path $deliverables "PoE-Economy-Widget-Portable-$Version-x64.exe")
)
$blockmapPath = [System.IO.Path]::GetFullPath("$setupPath.blockmap")
$latestPath = [System.IO.Path]::GetFullPath((Join-Path $deliverables "latest.yml"))
$provenancePath = [System.IO.Path]::GetFullPath(
  (Join-Path $deliverables "windows-release-provenance.json")
)
foreach ($target in @($winUnpacked, $setupPath, $portablePath, $blockmapPath, $latestPath, $provenancePath)) {
  if (-not $target.StartsWith("$deliverables\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to replace a Windows release target outside deliverables: $target"
  }
}

Push-Location $projectRoot
try {
  $changes = @(git status --porcelain --untracked-files=all)
  if ($LASTEXITCODE -ne 0) {
    throw "Git status failed before the Windows release build."
  }
  if ($changes.Count -gt 0) {
    throw "Commit the audited release before building Windows artifacts so provenance can bind them to current HEAD."
  }
  & (Join-Path $PSScriptRoot "assert-release-toolchain.ps1")

  $buildStartedAtUtc = [DateTime]::UtcNow
  & $pnpmCommand build
  if ($LASTEXITCODE -ne 0) {
    throw "The web/native build failed; Windows packaging did not start."
  }

  foreach ($target in @($setupPath, $portablePath, $blockmapPath, $latestPath, $provenancePath)) {
    if (Test-Path -LiteralPath $target -PathType Leaf) {
      Remove-Item -LiteralPath $target -Force
    }
  }
  if (Test-Path -LiteralPath $winUnpacked -PathType Container) {
    Remove-Item -LiteralPath $winUnpacked -Recurse -Force
  }

  # Building and verification are deliberately local-only. Publishing happens
  # later through publish-github-release.ps1 after provenance and native smokes.
  & $pnpmCommand exec electron-builder --win nsis portable --publish never
  if ($LASTEXITCODE -ne 0) {
    throw "electron-builder failed to create the Windows installer and portable build."
  }

  foreach ($artifact in @(
    $setupPath,
    $blockmapPath,
    $portablePath,
    $latestPath,
    (Join-Path $winUnpacked "resources/app.asar"),
    (Join-Path $winUnpacked "resources/native-input/NinjaLensInput.exe"),
    (Join-Path $winUnpacked "$($packageJson.build.productName).exe")
  )) {
    if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
      throw "Windows release output was not freshly created: $artifact"
    }
    if ((Get-Item -LiteralPath $artifact).LastWriteTimeUtc -lt $buildStartedAtUtc.AddSeconds(-2)) {
      throw "Windows release output predates this dist invocation: $artifact"
    }
  }

  $changes = @(git status --porcelain --untracked-files=all)
  if ($LASTEXITCODE -ne 0) {
    throw "Git status failed after the Windows release build."
  }
  if ($changes.Count -gt 0) {
    throw "The Windows release build changed committed source. Review and commit it, then rebuild."
  }
  & $nodePath (Join-Path $PSScriptRoot "verify-release-artifacts.mjs") record-windows `
    --root $projectRoot `
    --version $Version `
    --started-at $buildStartedAtUtc.ToString("o")
  if ($LASTEXITCODE -ne 0) {
    throw "Windows release provenance recording failed."
  }
  & $nodePath (Join-Path $PSScriptRoot "verify-release-artifacts.mjs") windows `
    --root $projectRoot `
    --version $Version
  if ($LASTEXITCODE -ne 0) {
    throw "Windows release semantic verification failed."
  }

  # Exercise the exact provenance-bound executable, bundled PoB/tree workers,
  # and native capture helper, not a source Electron process or a stale dist
  # directory. Each UI scenario uses an isolated synthetic PoE target and
  # restores the prior foreground.
  $packagedExecutable = Join-Path $winUnpacked "$($packageJson.build.productName).exe"
  $packagedResources = Join-Path $winUnpacked "resources"
  $packagedPobSmoke = Join-Path $PSScriptRoot "packaged-pob-smoke.cjs"
  $priceCheckSmoke = Join-Path $PSScriptRoot "price-check-smoke.ps1"
  $powerShellHost = (Get-Process -Id $PID).Path
  try {
    $previousRunAsNode = [Environment]::GetEnvironmentVariable("ELECTRON_RUN_AS_NODE", "Process")
    try {
      $env:ELECTRON_RUN_AS_NODE = "1"
      $pobSmokeProcess = Start-Process -FilePath $packagedExecutable `
        -ArgumentList @("`"$packagedPobSmoke`"", "`"$packagedResources`"") `
        -Wait -PassThru -WindowStyle Hidden
      if ($pobSmokeProcess.ExitCode -ne 0) {
        throw "Packaged PoB/passive-tree smoke failed with exit code $($pobSmokeProcess.ExitCode)."
      }
    } finally {
      if ($null -eq $previousRunAsNode) {
        Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
      } else {
        $env:ELECTRON_RUN_AS_NODE = $previousRunAsNode
      }
    }

    foreach ($scenario in @(
      [pscustomobject]@{ Name = "unique"; Arguments = @() },
      [pscustomobject]@{ Name = "rare"; Arguments = @("-Rare") },
      [pscustomobject]@{ Name = "wand"; Arguments = @("-Wand") }
    )) {
      $scenarioArguments = @($scenario.Arguments)
      & $powerShellHost -NoProfile -ExecutionPolicy Bypass -File $priceCheckSmoke `
        @scenarioArguments -Executable $packagedExecutable
      if ($LASTEXITCODE -ne 0) {
        throw "Packaged price-check smoke failed: $($scenario.Name)"
      }
    }
  } catch {
    # A release that failed its packaged UI/native-capture gate must not retain
    # a provenance manifest that an independent packaging step could accept.
    if (Test-Path -LiteralPath $provenancePath -PathType Leaf) {
      Remove-Item -LiteralPath $provenancePath -Force
    }
    throw
  }
} finally {
  Pop-Location
}

Write-Host "Built and bound Windows release $Version to current HEAD."
