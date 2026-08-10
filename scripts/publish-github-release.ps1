[CmdletBinding()]
param(
  [string]$Tag,
  [Parameter(Mandatory = $true)]
  [string]$NotesFile,
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$expectedRepository = "seNkoKG/ninja-lens"
$expectedOwner = "seNkoKG"
$stableSetupName = "Ninja-Lens-Setup-x64.exe"
$checksumName = "SHA256SUMS.txt"
$projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$stagingDirectory = $null

function Invoke-CapturedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [Parameter(Mandatory = $true)][string]$Label,
    [switch]$AllowFailure
  )

  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = @(& $FilePath @ArgumentList 2>&1 | ForEach-Object { [string]$_ })
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }

  $text = ($output -join [Environment]::NewLine).Trim()
  if ($exitCode -ne 0 -and -not $AllowFailure) {
    if ($text) {
      throw "$Label failed with exit code $exitCode.`n$text"
    }
    throw "$Label failed with exit code $exitCode."
  }

  return [PSCustomObject]@{
    ExitCode = $exitCode
    Lines = $output
    Text = $text
  }
}

function Assert-RegularFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "$Label is missing: $Path"
  }
  $item = Get-Item -LiteralPath $Path -Force
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "$Label must not be a symbolic link or reparse point: $Path"
  }
  if ($item.Length -le 0) {
    throw "$Label is empty: $Path"
  }
  return $item
}

function Get-Sha256 {
  param([Parameter(Mandatory = $true)][string]$Path)

  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-PinnedNodePath {
  param([Parameter(Mandatory = $true)][string]$Root)

  $pin = Get-Content -Raw -LiteralPath (Join-Path $Root "build/release-toolchain.json") |
    ConvertFrom-Json
  $pnpmLauncher = @(
    Get-Command pnpm.cmd -CommandType Application -ErrorAction SilentlyContinue
  ) | Select-Object -First 1
  $candidates = @()
  if ($pnpmLauncher) {
    $launcherDirectory = Split-Path -Parent $pnpmLauncher.Source
    $candidates += [System.IO.Path]::GetFullPath(
      (Join-Path $launcherDirectory "../../node/bin/node.exe")
    )
    $candidates += Join-Path $launcherDirectory "node.exe"
  }
  $ambientNode = @(
    Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
  ) | Select-Object -First 1
  if ($ambientNode) {
    $candidates += $ambientNode.Source
  }
  $nodePath = @($candidates | Where-Object {
    Test-Path -LiteralPath $_ -PathType Leaf
  } | Select-Object -Unique) | Select-Object -First 1
  if (-not $nodePath) {
    throw "The pinned Node.js runtime is required for release verification."
  }
  $nodeVersion = [string](& $nodePath --version)
  if (
    $LASTEXITCODE -ne 0 -or
    $nodeVersion.Trim().TrimStart("v") -cne [string]$pin.nodeVersion
  ) {
    throw "Release verification requires Node.js $($pin.nodeVersion)."
  }
  return [string]$nodePath
}

function Assert-ProvenanceRecord {
  param(
    [Parameter(Mandatory = $true)]$Provenance,
    [Parameter(Mandatory = $true)][string]$Key,
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ExpectedRelativePath
  )

  $property = $Provenance.files.PSObject.Properties[$Key]
  if ($null -eq $property) {
    throw "Windows release provenance is missing the $Key record."
  }
  $record = $property.Value
  $item = Assert-RegularFile -Path $Path -Label "Windows $Key artifact"
  $actualHash = Get-Sha256 -Path $Path
  if (
    [string]$record.relativePath -cne $ExpectedRelativePath -or
    [string]$record.sha256 -cne $actualHash -or
    [long]$record.size -ne $item.Length
  ) {
    throw "Windows $Key artifact does not match windows-release-provenance.json."
  }
}

function Get-ReleaseView {
  param(
    [Parameter(Mandatory = $true)][string]$GhPath,
    [Parameter(Mandatory = $true)][string]$ReleaseTag
  )

  $result = Invoke-CapturedCommand -FilePath $GhPath -ArgumentList @(
    "release", "view", $ReleaseTag,
    "--repo", $expectedRepository,
    "--json", "assets,isDraft,isPrerelease,tagName,targetCommitish,url"
  ) -Label "GitHub release inspection"
  try {
    return $result.Text | ConvertFrom-Json
  } catch {
    throw "GitHub returned invalid release JSON: $($_.Exception.Message)"
  }
}

function Assert-ReleaseAssets {
  param(
    [Parameter(Mandatory = $true)]$Release,
    [Parameter(Mandatory = $true)][hashtable]$ExpectedAssets,
    [Parameter(Mandatory = $true)][bool]$ExpectedDraft,
    [Parameter(Mandatory = $true)][string]$ExpectedTag,
    [Parameter(Mandatory = $true)][string]$ExpectedHead
  )

  if ([bool]$Release.isDraft -ne $ExpectedDraft) {
    throw "GitHub release draft state is not the expected value."
  }
  if ([bool]$Release.isPrerelease) {
    throw "GitHub release was unexpectedly marked as a prerelease."
  }
  if ([string]$Release.tagName -cne $ExpectedTag) {
    throw "GitHub release tag does not match $ExpectedTag."
  }
  if (
    [string]$Release.targetCommitish -cne $ExpectedHead -and
    [string]$Release.targetCommitish -cne "main"
  ) {
    throw "GitHub release targets a commit other than the audited main HEAD."
  }

  $assets = @($Release.assets)
  if ($assets.Count -ne $ExpectedAssets.Count) {
    throw "GitHub release has $($assets.Count) assets; expected $($ExpectedAssets.Count)."
  }
  foreach ($asset in $assets) {
    $name = [string]$asset.name
    $matchingNames = @($ExpectedAssets.Keys | Where-Object {
      [string]::Equals([string]$_, $name, [System.StringComparison]::Ordinal)
    })
    if ($matchingNames.Count -ne 1) {
      throw "GitHub release contains an unexpected asset: $name"
    }
    $expected = $ExpectedAssets[$matchingNames[0]]
    if ([string]$asset.state -cne "uploaded" -or [long]$asset.size -ne [long]$expected.Size) {
      throw "GitHub release asset state or size is wrong: $name"
    }
    $expectedDigest = "sha256:$($expected.Sha256)"
    if ([string]::IsNullOrWhiteSpace([string]$asset.digest)) {
      throw "GitHub did not provide a SHA-256 digest for release asset $name."
    }
    if ([string]$asset.digest -cne $expectedDigest) {
      throw "GitHub release asset digest does not match the local verified file: $name"
    }
  }
}

function Remove-ReleaseStagingDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$TemporaryRoot
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }
  $directory = Get-Item -LiteralPath $Path -Force
  $expectedParent = [System.IO.Path]::GetFullPath($TemporaryRoot).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  )
  if (
    -not $directory.PSIsContainer -or
    ($directory.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -or
    $directory.Parent.FullName -cne $expectedParent -or
    $directory.Name -notmatch '^ninja-lens-release-[0-9a-f]{32}$'
  ) {
    throw "Refusing to remove an unexpected release staging path: $Path"
  }

  $children = @(Get-ChildItem -LiteralPath $directory.FullName -Force)
  $expectedChildren = @($stableSetupName, $checksumName)
  foreach ($child in $children) {
    if (
      $child.PSIsContainer -or
      ($child.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -or
      $child.Name -cnotin $expectedChildren
    ) {
      throw "Refusing to remove unexpected content from release staging: $($child.FullName)"
    }
  }
  foreach ($child in $children) {
    Remove-Item -LiteralPath $child.FullName -Force
  }
  Remove-Item -LiteralPath $directory.FullName -Force
}

$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())

try {
  $gitPath = @(Get-Command git -CommandType Application -ErrorAction Stop)[0].Source
  $ghPath = @(Get-Command gh -CommandType Application -ErrorAction Stop)[0].Source
  $nodePath = Get-PinnedNodePath -Root $projectRoot

  $packagePath = Join-Path $projectRoot "package.json"
  $package = Get-Content -Raw -LiteralPath $packagePath | ConvertFrom-Json
  $version = [string]$package.version
  if ($version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
    throw "package.json contains an unsupported release version: $version"
  }
  $expectedTag = "v$version"
  if (-not $Tag) {
    $Tag = $expectedTag
  }
  if ($Tag -cne $expectedTag) {
    throw "Release tag $Tag must exactly match package.json version $expectedTag."
  }

  $resolvedNotesFile = (Resolve-Path -LiteralPath $NotesFile -ErrorAction Stop).Path
  $notes = Assert-RegularFile -Path $resolvedNotesFile -Label "Release notes"
  if ($notes.Length -gt 1MB) {
    throw "Release notes exceed the 1 MB safety limit."
  }

  $status = Invoke-CapturedCommand -FilePath $gitPath -ArgumentList @(
    "-C", $projectRoot, "status", "--porcelain=v1", "--untracked-files=all"
  ) -Label "Git status"
  if ($status.Text) {
    throw "The release publisher requires a clean committed snapshot.`n$($status.Text)"
  }
  $branch = Invoke-CapturedCommand -FilePath $gitPath -ArgumentList @(
    "-C", $projectRoot, "branch", "--show-current"
  ) -Label "Git branch inspection"
  if ($branch.Text -cne "main") {
    throw "The release publisher must run from the main branch."
  }
  $head = (Invoke-CapturedCommand -FilePath $gitPath -ArgumentList @(
    "-C", $projectRoot, "rev-parse", "HEAD"
  ) -Label "Git HEAD inspection").Text
  if ($head -notmatch '^[0-9a-f]{40}$') {
    throw "Git returned an invalid HEAD commit."
  }

  $origin = (Invoke-CapturedCommand -FilePath $gitPath -ArgumentList @(
    "-C", $projectRoot, "remote", "get-url", "origin"
  ) -Label "Git origin inspection").Text
  $allowedOrigins = @(
    "https://github.com/seNkoKG/ninja-lens.git",
    "https://github.com/seNkoKG/ninja-lens",
    "git@github.com:seNkoKG/ninja-lens.git",
    "ssh://git@github.com/seNkoKG/ninja-lens.git"
  )
  if ($origin -cnotin $allowedOrigins) {
    throw "Git origin must be the exact public repository $expectedRepository; found $origin."
  }

  Invoke-CapturedCommand -FilePath $ghPath -ArgumentList @(
    "auth", "status", "--hostname", "github.com"
  ) -Label "GitHub CLI authentication" | Out-Null
  $login = (Invoke-CapturedCommand -FilePath $ghPath -ArgumentList @(
    "api", "user", "--jq", ".login"
  ) -Label "GitHub account inspection").Text
  if ($login -cne $expectedOwner) {
    throw "GitHub CLI must be authenticated as $expectedOwner; found $login."
  }

  $repositoryJson = (Invoke-CapturedCommand -FilePath $ghPath -ArgumentList @(
    "repo", "view", $expectedRepository,
    "--json", "nameWithOwner,defaultBranchRef,visibility"
  ) -Label "GitHub repository inspection").Text | ConvertFrom-Json
  if (
    [string]$repositoryJson.nameWithOwner -cne $expectedRepository -or
    [string]$repositoryJson.visibility -cne "PUBLIC" -or
    [string]$repositoryJson.defaultBranchRef.name -cne "main"
  ) {
    throw "GitHub repository identity, visibility, or default branch is not the approved public configuration."
  }

  $remoteMain = (Invoke-CapturedCommand -FilePath $gitPath -ArgumentList @(
    "-C", $projectRoot, "ls-remote", "--exit-code", "origin", "refs/heads/main"
  ) -Label "Remote main inspection").Text
  $remoteMainHead = ($remoteMain -split '\s+')[0]
  if ($remoteMainHead -cne $head) {
    throw "Current HEAD is not the exact commit published at origin/main."
  }

  $localTag = Invoke-CapturedCommand -FilePath $gitPath -ArgumentList @(
    "-C", $projectRoot, "show-ref", "--verify", "--hash", "refs/tags/$Tag"
  ) -Label "Local tag inspection" -AllowFailure
  if ($localTag.ExitCode -eq 0) {
    $localTagCommit = (Invoke-CapturedCommand -FilePath $gitPath -ArgumentList @(
      "-C", $projectRoot, "rev-parse", "$Tag^{commit}"
    ) -Label "Local tag commit inspection").Text
    if ($localTagCommit -cne $head) {
      throw "Local tag $Tag does not point to current HEAD."
    }
  }

  $remoteTags = (Invoke-CapturedCommand -FilePath $gitPath -ArgumentList @(
    "-C", $projectRoot, "ls-remote", "origin", "refs/tags/$Tag", "refs/tags/$Tag^{}"
  ) -Label "Remote tag inspection").Lines
  if ($remoteTags.Count -gt 0) {
    $peeled = @($remoteTags | Where-Object { $_ -match '\^\{\}$' })
    $remoteTagLine = if ($peeled.Count -eq 1) { $peeled[0] } else { $remoteTags[0] }
    $remoteTagCommit = ($remoteTagLine -split '\s+')[0]
    if ($remoteTagCommit -cne $head) {
      throw "Remote tag $Tag does not point to current HEAD."
    }
  }

  $existingRelease = Invoke-CapturedCommand -FilePath $ghPath -ArgumentList @(
    "release", "view", $Tag, "--repo", $expectedRepository, "--json", "tagName,isDraft"
  ) -Label "Existing GitHub release inspection" -AllowFailure
  if ($existingRelease.ExitCode -eq 0) {
    throw "GitHub release $Tag already exists. Refusing to replace or clobber it."
  }
  if ($existingRelease.Text -notmatch '(?i)^release not found\s*$') {
    throw "GitHub release lookup failed for a reason other than a missing release.`n$($existingRelease.Text)"
  }

  $deliverables = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "deliverables"))
  $deliverablesItem = Get-Item -LiteralPath $deliverables -Force -ErrorAction Stop
  if (
    -not $deliverablesItem.PSIsContainer -or
    ($deliverablesItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
  ) {
    throw "deliverables must be a real local directory."
  }

  $setupName = "Ninja-Lens-Setup-$version-x64.exe"
  $blockmapName = "$setupName.blockmap"
  $portableName = "Ninja-Lens-Portable-$version-x64.exe"
  $setupPath = Join-Path $deliverables $setupName
  $blockmapPath = Join-Path $deliverables $blockmapName
  $portablePath = Join-Path $deliverables $portableName
  $latestPath = Join-Path $deliverables "latest.yml"
  $provenancePath = Join-Path $deliverables "windows-release-provenance.json"
  foreach ($artifact in @(
    @{ Path = $setupPath; Label = "Versioned NSIS installer" },
    @{ Path = $blockmapPath; Label = "NSIS blockmap" },
    @{ Path = $portablePath; Label = "Portable executable" },
    @{ Path = $latestPath; Label = "electron-builder latest.yml" },
    @{ Path = $provenancePath; Label = "Windows release provenance" }
  )) {
    Assert-RegularFile -Path $artifact.Path -Label $artifact.Label | Out-Null
  }

  $verifierPath = Join-Path $PSScriptRoot "verify-release-artifacts.mjs"
  $verification = Invoke-CapturedCommand -FilePath $nodePath -ArgumentList @(
    $verifierPath, "windows", "--root", $projectRoot, "--version", $version
  ) -Label "Windows release provenance verification"
  if ($verification.Text) {
    Write-Host $verification.Text
  }

  try {
    $provenance = Get-Content -Raw -LiteralPath $provenancePath | ConvertFrom-Json
  } catch {
    throw "windows-release-provenance.json is invalid: $($_.Exception.Message)"
  }
  if (
    [string]$provenance.platform -cne "windows" -or
    [string]$provenance.version -cne $version -or
    [string]$provenance.gitHead -cne $head
  ) {
    throw "Windows release provenance is not bound to this version and current HEAD."
  }
  Assert-ProvenanceRecord -Provenance $provenance -Key "setup" -Path $setupPath `
    -ExpectedRelativePath "deliverables/$setupName"
  Assert-ProvenanceRecord -Provenance $provenance -Key "blockmap" -Path $blockmapPath `
    -ExpectedRelativePath "deliverables/$blockmapName"
  Assert-ProvenanceRecord -Provenance $provenance -Key "portable" -Path $portablePath `
    -ExpectedRelativePath "deliverables/$portableName"
  Assert-ProvenanceRecord -Provenance $provenance -Key "latest" -Path $latestPath `
    -ExpectedRelativePath "deliverables/latest.yml"

  $latestHashBeforeStaging = Get-Sha256 -Path $latestPath
  $latestText = Get-Content -Raw -LiteralPath $latestPath
  if (
    $latestText -notmatch "(?m)^version:\s*['`"]?$([regex]::Escape($version))['`"]?\s*$" -or
    $latestText -notmatch "(?m)^path:\s*['`"]?$([regex]::Escape($setupName))['`"]?\s*$" -or
    $latestText -match [regex]::Escape($stableSetupName)
  ) {
    throw "latest.yml must reference the verified versioned installer, never the stable human alias."
  }

  $stagingDirectory = Join-Path $temporaryRoot (
    "ninja-lens-release-{0}" -f [Guid]::NewGuid().ToString("N")
  )
  New-Item -ItemType Directory -Path $stagingDirectory -ErrorAction Stop | Out-Null
  $stableSetupPath = Join-Path $stagingDirectory $stableSetupName
  [System.IO.File]::Copy($setupPath, $stableSetupPath, $false)
  $stableSetupItem = Assert-RegularFile -Path $stableSetupPath -Label "Stable installer alias"
  $setupItem = Get-Item -LiteralPath $setupPath
  $setupHash = Get-Sha256 -Path $setupPath
  $stableSetupHash = Get-Sha256 -Path $stableSetupPath
  if ($stableSetupItem.Length -ne $setupItem.Length -or $stableSetupHash -cne $setupHash) {
    throw "Stable installer alias is not a byte-for-byte copy of the versioned NSIS installer."
  }

  $publicFiles = [ordered]@{
    $setupName = $setupPath
    $stableSetupName = $stableSetupPath
    $blockmapName = $blockmapPath
    $portableName = $portablePath
    "latest.yml" = $latestPath
  }
  $checksums = [ordered]@{}
  foreach ($entry in $publicFiles.GetEnumerator()) {
    $checksums[$entry.Key] = Get-Sha256 -Path $entry.Value
  }
  $checksumLines = @(
    $checksums.GetEnumerator() | ForEach-Object { "$($_.Value)  $($_.Key)" }
  )
  $checksumPath = Join-Path $stagingDirectory $checksumName
  [System.IO.File]::WriteAllText(
    $checksumPath,
    (($checksumLines -join "`n") + "`n"),
    [System.Text.UTF8Encoding]::new($false)
  )
  Assert-RegularFile -Path $checksumPath -Label "SHA256SUMS" | Out-Null

  $parsedChecksums = @{}
  foreach ($line in Get-Content -LiteralPath $checksumPath) {
    if ($line -notmatch '^([0-9a-f]{64})  ([^\\/]+)$') {
      throw "SHA256SUMS contains an invalid line: $line"
    }
    if ($parsedChecksums.ContainsKey($Matches[2])) {
      throw "SHA256SUMS contains a duplicate filename: $($Matches[2])"
    }
    $parsedChecksums[$Matches[2]] = $Matches[1]
  }
  if ($parsedChecksums.Count -ne $publicFiles.Count) {
    throw "SHA256SUMS does not contain the exact public artifact set."
  }
  foreach ($entry in $publicFiles.GetEnumerator()) {
    if (
      -not $parsedChecksums.ContainsKey($entry.Key) -or
      [string]$parsedChecksums[$entry.Key] -cne (Get-Sha256 -Path $entry.Value)
    ) {
      throw "SHA256SUMS does not verify $($entry.Key)."
    }
  }
  if ((Get-Sha256 -Path $latestPath) -cne $latestHashBeforeStaging) {
    throw "latest.yml changed while staging the GitHub release."
  }

  $expectedAssets = @{}
  foreach ($entry in $publicFiles.GetEnumerator()) {
    $item = Get-Item -LiteralPath $entry.Value
    $expectedAssets[$entry.Key] = [PSCustomObject]@{
      Path = $entry.Value
      Size = $item.Length
      Sha256 = $checksums[$entry.Key]
    }
  }
  $checksumItem = Get-Item -LiteralPath $checksumPath
  $expectedAssets[$checksumName] = [PSCustomObject]@{
    Path = $checksumPath
    Size = $checksumItem.Length
    Sha256 = Get-Sha256 -Path $checksumPath
  }

  if ($ValidateOnly) {
    Write-Host "Validated GitHub release $Tag for $expectedRepository at $head."
    Write-Host "Stable installer alias SHA-256: $stableSetupHash"
    return
  }

  $draftCreated = $false
  try {
    Invoke-CapturedCommand -FilePath $ghPath -ArgumentList @(
      "release", "create", $Tag,
      "--repo", $expectedRepository,
      "--target", $head,
      "--title", "Ninja Lens $version",
      "--notes-file", $resolvedNotesFile,
      "--draft"
    ) -Label "GitHub draft release creation" | Out-Null
    $draftCreated = $true

    $uploadPaths = @($expectedAssets.Values | ForEach-Object { [string]$_.Path })
    Invoke-CapturedCommand -FilePath $ghPath -ArgumentList (@(
      "release", "upload", $Tag, "--repo", $expectedRepository
    ) + $uploadPaths) -Label "GitHub release asset upload" | Out-Null

    $draft = Get-ReleaseView -GhPath $ghPath -ReleaseTag $Tag
    Assert-ReleaseAssets -Release $draft -ExpectedAssets $expectedAssets `
      -ExpectedDraft $true -ExpectedTag $Tag -ExpectedHead $head

    Invoke-CapturedCommand -FilePath $ghPath -ArgumentList @(
      "release", "edit", $Tag,
      "--repo", $expectedRepository,
      "--draft=false",
      "--latest"
    ) -Label "GitHub release publication" | Out-Null

    $published = Get-ReleaseView -GhPath $ghPath -ReleaseTag $Tag
    Assert-ReleaseAssets -Release $published -ExpectedAssets $expectedAssets `
      -ExpectedDraft $false -ExpectedTag $Tag -ExpectedHead $head
    $latestReleaseTag = (Invoke-CapturedCommand -FilePath $ghPath -ArgumentList @(
      "release", "view", "--repo", $expectedRepository, "--json", "tagName", "--jq", ".tagName"
    ) -Label "Latest GitHub release inspection").Text
    if ($latestReleaseTag -cne $Tag) {
      throw "Published release is not GitHub's latest release."
    }

    $publishedRemoteTags = (Invoke-CapturedCommand -FilePath $gitPath -ArgumentList @(
      "-C", $projectRoot, "ls-remote", "origin", "refs/tags/$Tag", "refs/tags/$Tag^{}"
    ) -Label "Published tag inspection").Lines
    $publishedPeeled = @($publishedRemoteTags | Where-Object { $_ -match '\^\{\}$' })
    $publishedTagLine = if ($publishedPeeled.Count -eq 1) {
      $publishedPeeled[0]
    } elseif ($publishedRemoteTags.Count -eq 1) {
      $publishedRemoteTags[0]
    } else {
      throw "Published Git tag could not be resolved unambiguously."
    }
    if (($publishedTagLine -split '\s+')[0] -cne $head) {
      throw "Published Git tag does not point to the audited main HEAD."
    }

    Write-Host "Published $($published.url)"
    Write-Host "Stable installer: https://github.com/$expectedRepository/releases/latest/download/$stableSetupName"
    Write-Host "Stable installer SHA-256: $stableSetupHash"
  } catch {
    if ($draftCreated) {
      Write-Warning "Publication stopped. GitHub release $Tag remains a draft for manual inspection; no asset was replaced."
    }
    throw
  }
} finally {
  if ($stagingDirectory) {
    Remove-ReleaseStagingDirectory -Path $stagingDirectory -TemporaryRoot $temporaryRoot
  }
}
