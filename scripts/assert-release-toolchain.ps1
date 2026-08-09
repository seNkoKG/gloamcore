$ErrorActionPreference = "Stop"

function Invoke-NativeCapture {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    # Windows PowerShell promotes some successful native stderr output to a
    # terminating NativeCommandError when the script preference is Stop.
    $ErrorActionPreference = "Continue"
    $output = @(& $Command @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  return [PSCustomObject]@{
    ExitCode = $exitCode
    Output = $output
  }
}

$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "resolve-release-toolchain.ps1")
$toolchain = Get-ReleaseToolchain -ProjectRoot $projectRoot
$expectedPnpm = $toolchain.PnpmVersion
$pnpmCommand = $toolchain.PnpmPath
$nodePath = $toolchain.NodePath

Push-Location $projectRoot
$dependencyGraphPath = $null
try {
  $installResult = Invoke-NativeCapture -Command $pnpmCommand -Arguments @("install", "--force", "--frozen-lockfile", "--offline", "--ignore-scripts", "--config.verify-store-integrity=true")
  if ($installResult.ExitCode -ne 0) {
    throw "Forced frozen offline pnpm rematerialization failed; the lockfile or content-addressed store is incomplete.`n$($installResult.Output -join [Environment]::NewLine)"
  }
  $storeStatusResult = Invoke-NativeCapture -Command $pnpmCommand -Arguments @("store", "status")
  if ($storeStatusResult.ExitCode -ne 0) {
    throw "pnpm detected modified or corrupt packages in the content-addressed store.`n$($storeStatusResult.Output -join [Environment]::NewLine)"
  }
  $dependencyGraphResult = Invoke-NativeCapture -Command $pnpmCommand -Arguments @("list", "--prod", "--depth", "Infinity", "--json")
  if ($dependencyGraphResult.ExitCode -ne 0) {
    throw "The rematerialized dependency graph is incomplete or invalid.`n$($dependencyGraphResult.Output -join [Environment]::NewLine)"
  }
  try {
    $dependencyGraph = ($dependencyGraphResult.Output -join [Environment]::NewLine) | ConvertFrom-Json
  } catch {
    throw "pnpm returned an invalid dependency graph: $($_.Exception.Message)"
  }
  if (-not $dependencyGraph -or [string]$dependencyGraph.path -ne $projectRoot) {
    throw "pnpm returned a dependency graph for the wrong project root."
  }
  $storePathResult = Invoke-NativeCapture -Command $pnpmCommand -Arguments @("store", "path")
  $storePath = if ($storePathResult.Output.Count) { [string]$storePathResult.Output[0] } else { "" }
  $storePath = $storePath.Trim()
  if ($storePathResult.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $storePath -PathType Container)) {
    throw "The pnpm package store could not be verified."
  }
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "node_modules/.modules.yaml") -PathType Leaf)) {
    throw "pnpm did not produce a verifiable node_modules dependency manifest."
  }
  # Electron 43 ships its runtime through an explicit installer entry point instead
  # of an npm lifecycle script. The forced --ignore-scripts rematerialization
  # above intentionally leaves that runtime absent, so restore it through the
  # exact locked package before hashing the complete production tree below.
  $electronInstallerPath = Join-Path $projectRoot "node_modules/electron/install.js"
  if (-not (Test-Path -LiteralPath $electronInstallerPath -PathType Leaf)) {
    throw "The locked Electron runtime installer is missing."
  }
  $electronEnvironmentNames = @(
    "ELECTRON_INSTALL_PLATFORM",
    "npm_config_platform",
    "ELECTRON_INSTALL_ARCH",
    "npm_config_arch",
    "force_no_cache",
    "electron_config_cache",
    "electron_use_remote_checksums",
    "npm_config_electron_use_remote_checksums",
    "ELECTRON_OVERRIDE_DIST_PATH",
    "ELECTRON_MIRROR",
    "npm_config_electron_mirror",
    "ELECTRON_NIGHTLY_MIRROR",
    "npm_config_electron_nightly_mirror",
    "ELECTRON_CUSTOM_DIR",
    "npm_config_electron_custom_dir",
    "ELECTRON_CUSTOM_FILENAME",
    "npm_config_electron_custom_filename",
    "ELECTRON_SKIP_BINARY_DOWNLOAD"
  )
  $savedElectronEnvironment = @{}
  foreach ($name in $electronEnvironmentNames) {
    $savedElectronEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
    [Environment]::SetEnvironmentVariable($name, $null, "Process")
  }
  try {
    [Environment]::SetEnvironmentVariable("ELECTRON_INSTALL_PLATFORM", "win32", "Process")
    [Environment]::SetEnvironmentVariable("ELECTRON_INSTALL_ARCH", "x64", "Process")
    $electronInstallResult = Invoke-NativeCapture -Command $nodePath -Arguments @($electronInstallerPath)
  } finally {
    foreach ($name in $electronEnvironmentNames) {
      [Environment]::SetEnvironmentVariable($name, $savedElectronEnvironment[$name], "Process")
    }
  }
  if ($electronInstallResult.ExitCode -ne 0) {
    throw "The locked Electron runtime could not be materialized.`n$($electronInstallResult.Output -join [Environment]::NewLine)"
  }
  $dependencyGraphPath = Join-Path ([System.IO.Path]::GetTempPath()) ("poe-widget-production-graph-{0}.json" -f [Guid]::NewGuid().ToString("N"))
  [System.IO.File]::WriteAllText(
    $dependencyGraphPath,
    ($dependencyGraphResult.Output -join [Environment]::NewLine),
    [System.Text.UTF8Encoding]::new($false)
  )
  $verifierPath = Join-Path $PSScriptRoot "verify-release-artifacts.mjs"
  $dependencyVerification = Invoke-NativeCapture -Command $nodePath -Arguments @(
    $verifierPath,
    "production-dependencies",
    "--root", $projectRoot,
    "--graph", $dependencyGraphPath
  )
  if ($dependencyVerification.ExitCode -ne 0) {
    throw "Production dependencies do not match their committed exact-file inventory.`n$($dependencyVerification.Output -join [Environment]::NewLine)"
  }
  $electronVerification = Invoke-NativeCapture -Command $nodePath -Arguments @(
    $verifierPath,
    "electron-runtime",
    "--root", $projectRoot
  )
  if ($electronVerification.ExitCode -ne 0) {
    throw "The Electron runtime does not match its committed win32-x64 fingerprint.`n$($electronVerification.Output -join [Environment]::NewLine)"
  }
} finally {
  if ($dependencyGraphPath -and (Test-Path -LiteralPath $dependencyGraphPath -PathType Leaf)) {
    [System.IO.File]::Delete($dependencyGraphPath)
  }
  Pop-Location
}

Write-Output "Verified pnpm $expectedPnpm, frozen production dependencies, store integrity, and Electron runtime."
