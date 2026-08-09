function Get-ReleaseToolchain {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)

  $pin = Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot "build/release-toolchain.json") |
    ConvertFrom-Json
  $packageJson = Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot "package.json") |
    ConvertFrom-Json
  if (
    [int]$pin.schema -ne 1 -or
    [string]$pin.platform -ne "win32-x64" -or
    [string]$packageJson.packageManager -ne "pnpm@$($pin.pnpmVersion)"
  ) {
    throw "Release toolchain pin is invalid or disagrees with package.json."
  }
  $pnpmPath = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue).Source
  if (-not $pnpmPath) {
    throw "The pinned Windows pnpm.cmd launcher is required for release work."
  }
  $pnpmDirectory = Split-Path -Parent $pnpmPath
  $nodePath = @(
    [System.IO.Path]::GetFullPath((Join-Path $pnpmDirectory "../../node/bin/node.exe")),
    (Join-Path $pnpmDirectory "node.exe")
  ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
  if (-not $nodePath) {
    $ambientNode = Get-Command node.exe -ErrorAction SilentlyContinue
    $nodePath = if ($ambientNode) { [string]$ambientNode.Source } else { "" }
  }
  if (-not $nodePath) {
    throw "Node.js is required for release work."
  }
  $nodeDirectory = Split-Path -Parent $nodePath
  $nodeDirectoryOnPath = @($env:Path -split ";") | Where-Object {
    $_ -and $_.Trim().TrimEnd("\") -ieq $nodeDirectory.TrimEnd("\")
  } | Select-Object -First 1
  if (-not $nodeDirectoryOnPath) {
    $env:Path = "$nodeDirectory;$env:Path"
  }
  $pnpmVersion = [string](& $pnpmPath --version)
  if ($LASTEXITCODE -ne 0 -or $pnpmVersion.Trim() -ne [string]$pin.pnpmVersion) {
    throw "Release requires pnpm $($pin.pnpmVersion)."
  }
  $nodeVersion = [string](& $nodePath --version)
  $nodeVersion = $nodeVersion.Trim().TrimStart("v")
  if ($LASTEXITCODE -ne 0 -or $nodeVersion -ne [string]$pin.nodeVersion) {
    throw "Release requires Node.js $($pin.nodeVersion)."
  }
  return [PSCustomObject]@{
    PnpmPath = [string]$pnpmPath
    NodePath = [string]$nodePath
    NodeDirectory = [string]$nodeDirectory
    PnpmVersion = [string]$pin.pnpmVersion
    NodeVersion = [string]$pin.nodeVersion
  }
}
