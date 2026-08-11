param(
  [string]$Version,
  [switch]$VerifyOnly
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$packageJson = Get-Content -Raw (Join-Path $projectRoot "package.json") |
  ConvertFrom-Json
if (-not $Version) {
  $Version = [string]$packageJson.version
}
if ($Version -ne [string]$packageJson.version) {
  throw "Requested version $Version does not match package.json $($packageJson.version)."
}

Push-Location $projectRoot
try {
  $changes = @(git status --porcelain --untracked-files=all)
  if ($LASTEXITCODE -ne 0) {
    throw "Git status failed."
  }
  if ($changes.Count -gt 0) {
    throw "Commit the audited release before packaging so the iOS source archive matches the APK."
  }

  $androidGradle = Get-Content -Raw "android/app/build.gradle"
  $iosProject = Get-Content -Raw "ios/App/App.xcodeproj/project.pbxproj"
  $gradleVersionMatches = [regex]::Matches($androidGradle, 'versionName\s+"([^"]+)"')
  $gradleCodeMatch = [regex]::Match($androidGradle, 'versionCode\s+(\d+)')
  $gradlePackageMatch = [regex]::Match(
    $androidGradle,
    'applicationId\s+"([^"]+)"'
  )
  if (
    $gradleVersionMatches.Count -lt 1 -or
    @($gradleVersionMatches | Where-Object { $_.Groups[1].Value -ne $Version }).Count -gt 0
  ) {
    throw "Android versionName does not match $Version."
  }
  if (-not $gradleCodeMatch.Success -or -not $gradlePackageMatch.Success) {
    throw "Android Gradle package/version metadata could not be verified."
  }
  $expectedBuildNumber = $gradleCodeMatch.Groups[1].Value
  $expectedBundleIdentifier = $gradlePackageMatch.Groups[1].Value
  $iosTargetConfigurations = [regex]::Matches(
    $iosProject,
    'buildSettings\s*=\s*\{(?<settings>[\s\S]*?INFOPLIST_FILE\s*=\s*App/Info\.plist;[\s\S]*?)\};'
  )
  if ($iosTargetConfigurations.Count -lt 1) {
    throw "No iOS App target build configurations could be verified."
  }
  foreach ($configuration in $iosTargetConfigurations) {
    $settings = $configuration.Groups['settings'].Value
    $marketing = [regex]::Match($settings, 'MARKETING_VERSION\s*=\s*([^;]+);')
    $buildNumber = [regex]::Match($settings, 'CURRENT_PROJECT_VERSION\s*=\s*([^;]+);')
    $bundleIdentifier = [regex]::Match($settings, 'PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+);')
    if (-not $marketing.Success -or $marketing.Groups[1].Value.Trim() -ne $Version) {
      throw "Every iOS App target configuration must set MARKETING_VERSION to $Version."
    }
    if (-not $buildNumber.Success -or $buildNumber.Groups[1].Value.Trim() -ne $expectedBuildNumber) {
      throw "Every iOS App target configuration must set CURRENT_PROJECT_VERSION to $expectedBuildNumber."
    }
    if (-not $bundleIdentifier.Success -or $bundleIdentifier.Groups[1].Value.Trim() -ne $expectedBundleIdentifier) {
      throw "Every iOS App target configuration must use bundle identifier $expectedBundleIdentifier."
    }
  }

  $mobileOutput = Join-Path $projectRoot "deliverables/mobile"
  $mobileOutputFull = [System.IO.Path]::GetFullPath($mobileOutput)
  New-Item -ItemType Directory -Path $mobileOutputFull -Force | Out-Null

  $builtApk = Join-Path $projectRoot "android/app/build/outputs/apk/release/app-release.apk"
  if (-not (Test-Path -LiteralPath $builtApk)) {
    throw "Signed release APK is missing. Run pnpm mobile:android:release first."
  }

  $sdkRoots = @(
    (Join-Path $projectRoot ".mobile-tools/android-sdk"),
    $env:ANDROID_SDK_ROOT,
    $env:ANDROID_HOME
  ) | Where-Object { $_ } | Select-Object -Unique
  $aaptCandidates = @()
  foreach ($sdkRoot in $sdkRoots) {
    $buildToolsRoot = Join-Path $sdkRoot "build-tools"
    if (-not (Test-Path -LiteralPath $buildToolsRoot -PathType Container)) {
      continue
    }
    foreach ($directory in Get-ChildItem -LiteralPath $buildToolsRoot -Directory) {
      $candidate = Join-Path $directory.FullName "aapt2.exe"
      if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        try {
          $parsedVersion = [version]$directory.Name
        } catch {
          $parsedVersion = [version]"0.0"
        }
        $aaptCandidates += [pscustomobject]@{
          Path = [System.IO.Path]::GetFullPath($candidate)
          Version = $parsedVersion
        }
      }
    }
  }
  $aapt2 = $aaptCandidates |
    Sort-Object Version -Descending |
    Select-Object -First 1 -ExpandProperty Path
  if (-not $aapt2) {
    throw "Android aapt2 is missing. Install Android Build Tools or restore .mobile-tools/android-sdk."
  }

  $buildToolsDirectory = Split-Path -Parent $aapt2
  $apksigner = Join-Path $buildToolsDirectory "apksigner.bat"
  if (-not (Test-Path -LiteralPath $apksigner -PathType Leaf)) {
    $apksigner = Join-Path $buildToolsDirectory "apksigner.exe"
  }
  if (-not (Test-Path -LiteralPath $apksigner -PathType Leaf)) {
    throw "Android apksigner is missing beside aapt2 in $buildToolsDirectory."
  }
  $localJdk = Get-ChildItem -LiteralPath (Join-Path $projectRoot ".mobile-tools/jdk") -Directory -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($localJdk) {
    $env:JAVA_HOME = $localJdk.FullName
  }
  if (-not $env:JAVA_HOME -and -not (Get-Command java -ErrorAction SilentlyContinue)) {
    throw "Java is required to verify the APK signature. Restore .mobile-tools/jdk or set JAVA_HOME."
  }

  $signatureOutput = @(& $apksigner verify --verbose --print-certs $builtApk 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "apksigner rejected the release APK: $($signatureOutput -join ' ')"
  }
  $signatureText = $signatureOutput -join "`n"
  $signerCountMatch = [regex]::Match($signatureText, 'Number of signers:\s*(\d+)')
  $signerDigestMatch = [regex]::Match(
    $signatureText,
    'Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F:]+)'
  )
  if (-not $signerCountMatch.Success -or [int]$signerCountMatch.Groups[1].Value -ne 1) {
    throw "Release APK must have exactly one verified signer."
  }
  if (-not $signerDigestMatch.Success) {
    throw "apksigner returned no readable signer certificate SHA-256 digest."
  }
  $hasModernSignature =
    $signatureText -match 'Verified using v2 scheme \(APK Signature Scheme v2\): true' -or
    $signatureText -match 'Verified using v3(?:\.1)? scheme \(APK Signature Scheme v3(?:\.1)?\): true'
  if (-not $hasModernSignature) {
    throw "Release APK is not verified with APK Signature Scheme v2 or v3."
  }
  $expectedSignerPath = Join-Path $projectRoot "android/release-signing-cert.sha256"
  if (-not (Test-Path -LiteralPath $expectedSignerPath -PathType Leaf)) {
    throw "Expected release signer fingerprint is missing: $expectedSignerPath"
  }
  $expectedSigner = ((Get-Content -Raw -LiteralPath $expectedSignerPath) -replace '[^0-9a-fA-F]', '').ToLowerInvariant()
  $actualSigner = ($signerDigestMatch.Groups[1].Value -replace '[^0-9a-fA-F]', '').ToLowerInvariant()
  if ($expectedSigner -notmatch '^[0-9a-f]{64}$') {
    throw "Expected release signer fingerprint must contain exactly one SHA-256 digest."
  }
  if ($actualSigner -ne $expectedSigner) {
    throw "Release APK signer $actualSigner does not match the expected personal release certificate."
  }

  $badging = @(& $aapt2 dump badging $builtApk 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "aapt2 could not inspect the signed release APK: $($badging -join ' ')"
  }
  $packageLine = $badging |
    Where-Object { $_ -like "package:*" } |
    Select-Object -First 1
  $apkVersionMatch = [regex]::Match(
    [string]$packageLine,
    "versionName='([^']+)'"
  )
  $apkCodeMatch = [regex]::Match(
    [string]$packageLine,
    "versionCode='(\d+)'"
  )
  $apkPackageMatch = [regex]::Match(
    [string]$packageLine,
    "^package: name='([^']+)'"
  )
  if (
    -not $apkVersionMatch.Success -or
    -not $apkCodeMatch.Success -or
    -not $apkPackageMatch.Success
  ) {
    throw "aapt2 returned no readable package/version metadata for the signed release APK."
  }
  if ($apkVersionMatch.Groups[1].Value -ne $Version) {
    throw "Signed release APK embeds version $($apkVersionMatch.Groups[1].Value), expected $Version. Rebuild it before packaging."
  }
  if (
    $apkCodeMatch.Groups[1].Value -ne $gradleCodeMatch.Groups[1].Value
  ) {
    throw "Signed release APK embeds versionCode $($apkCodeMatch.Groups[1].Value), expected $($gradleCodeMatch.Groups[1].Value). Rebuild it before packaging."
  }
  if ($apkPackageMatch.Groups[1].Value -ne $gradlePackageMatch.Groups[1].Value) {
    throw "Signed release APK embeds package $($apkPackageMatch.Groups[1].Value), expected $($gradlePackageMatch.Groups[1].Value)."
  }

  . (Join-Path $PSScriptRoot "resolve-release-toolchain.ps1")
  $toolchain = Get-ReleaseToolchain -ProjectRoot $projectRoot
  $nodePath = $toolchain.NodePath
  & $nodePath (Join-Path $PSScriptRoot "verify-release-artifacts.mjs") mobile `
    --root $projectRoot `
    --version $Version `
    --apk $builtApk
  if ($LASTEXITCODE -ne 0) {
    throw "Android release provenance verification failed."
  }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $nativeReportDirectory = Join-Path $projectRoot "android/app/build/reports"
  $nativeInventoryPath = Join-Path $nativeReportDirectory "release-runtime-notice-inventory.json"
  $nativeNoticePath = Join-Path $nativeReportDirectory "release-runtime-third-party-notices.txt"
  foreach ($nativeFile in @($nativeInventoryPath, $nativeNoticePath)) {
    if (-not (Test-Path -LiteralPath $nativeFile -PathType Leaf)) {
      throw "Android native dependency notice output is missing: $nativeFile"
    }
  }
  $apkArchive = [System.IO.Compression.ZipFile]::OpenRead(
    [System.IO.Path]::GetFullPath($builtApk)
  )
  try {
    $apkEntries = [System.Collections.Generic.Dictionary[string, object]]::new(
      [System.StringComparer]::Ordinal
    )
    foreach ($entry in $apkArchive.Entries) {
      if ($apkEntries.ContainsKey($entry.FullName)) {
        throw "Signed release APK contains a duplicate ZIP entry: $($entry.FullName)"
      }
      $apkEntries.Add($entry.FullName, $entry)
    }
    $mergedAssetsRoot = [System.IO.Path]::GetFullPath(
      (Join-Path $projectRoot "android/app/build/intermediates/assets/release/mergeReleaseAssets")
    )
    $sourceAssetsRoot = [System.IO.Path]::GetFullPath(
      (Join-Path $projectRoot "android/app/src/main/assets")
    )
    foreach ($assetRoot in @($mergedAssetsRoot, $sourceAssetsRoot)) {
      if (-not (Test-Path -LiteralPath $assetRoot -PathType Container)) {
        throw "Fresh Android asset source is missing: $assetRoot"
      }
    }
    $expectedAssetEntries = [System.Collections.Generic.Dictionary[string, bool]]::new(
      [System.StringComparer]::Ordinal
    )
    foreach ($mergedFile in Get-ChildItem -LiteralPath $mergedAssetsRoot -Recurse -File) {
      $relative = $mergedFile.FullName.Substring($mergedAssetsRoot.Length).TrimStart('\', '/')
      $entryName = "assets/$($relative.Replace('\', '/'))"
      $expectedAssetEntries[$entryName] = $true
      if (-not $apkEntries.ContainsKey($entryName)) {
        throw "Signed release APK is missing merged Android asset $entryName."
      }
      $entry = $apkEntries[$entryName]
      $stream = $entry.Open()
      try {
        $algorithm = [System.Security.Cryptography.SHA256]::Create()
        try {
          $apkHash = [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace("-", "").ToLowerInvariant()
        } finally {
          $algorithm.Dispose()
        }
      } finally {
        $stream.Dispose()
      }
      $mergedHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $mergedFile.FullName).Hash.ToLowerInvariant()
      if ($apkHash -ne $mergedHash) {
        throw "Signed release APK contains stale merged Android asset $entryName."
      }
    }
    foreach ($knownExtra in @(
      "assets/dexopt/baseline.prof",
      "assets/dexopt/baseline.profm"
    )) {
      if ($apkEntries.ContainsKey($knownExtra)) {
        $expectedAssetEntries[$knownExtra] = $true
      }
    }
    foreach ($entry in $apkArchive.Entries) {
      if (
        $entry.FullName.StartsWith("assets/", [System.StringComparison]::Ordinal) -and
        -not $entry.FullName.EndsWith("/", [System.StringComparison]::Ordinal) -and
        -not $expectedAssetEntries.ContainsKey($entry.FullName)
      ) {
        throw "Signed release APK contains an unexpected or stale Android asset: $($entry.FullName)"
      }
    }
    foreach ($sourceFile in Get-ChildItem -LiteralPath $sourceAssetsRoot -Recurse -File) {
      $relative = $sourceFile.FullName.Substring($sourceAssetsRoot.Length).TrimStart('\', '/')
      $mergedPath = Join-Path $mergedAssetsRoot $relative
      if (-not (Test-Path -LiteralPath $mergedPath -PathType Leaf)) {
        throw "Merged release assets omit current app source asset $relative."
      }
      if (
        (Get-FileHash -Algorithm SHA256 -LiteralPath $sourceFile.FullName).Hash -ne
        (Get-FileHash -Algorithm SHA256 -LiteralPath $mergedPath).Hash
      ) {
        throw "Merged release asset is stale relative to android/app/src/main/assets: $relative"
      }
    }
    foreach ($requiredAsset in @(
      "assets/capacitor.config.json",
      "assets/capacitor.plugins.json",
      "assets/native-bridge.js",
      "assets/public/cordova.js",
      "assets/public/cordova_plugins.js",
      "assets/public/RELEASE_PROVENANCE.json"
    )) {
      if (-not $expectedAssetEntries.ContainsKey($requiredAsset)) {
        throw "Required fresh Android/Capacitor asset is missing: $requiredAsset"
      }
    }
    $distRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "dist"))
    if (-not (Test-Path -LiteralPath $distRoot -PathType Container)) {
      throw "Final dist is missing. Rebuild before packaging mobile."
    }
    $expectedPublicEntries = @{}
    foreach ($distFile in Get-ChildItem -LiteralPath $distRoot -Recurse -File) {
      $relative = $distFile.FullName.Substring($distRoot.Length).TrimStart('\', '/')
      $entryName = "assets/public/$($relative.Replace('\', '/'))"
      $expectedPublicEntries[$entryName] = $true
      $entry = $apkEntries[$entryName]
      if (-not $entry) {
        throw "Signed release APK is missing current web asset $entryName. Rebuild it."
      }
      $stream = $entry.Open()
      try {
        $algorithm = [System.Security.Cryptography.SHA256]::Create()
        try {
          $entryHash = [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace("-", "").ToLowerInvariant()
        } finally {
          $algorithm.Dispose()
        }
      } finally {
        $stream.Dispose()
      }
      $distHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $distFile.FullName).Hash.ToLowerInvariant()
      if ($entryHash -ne $distHash) {
        throw "Signed release APK contains stale web asset $entryName. Rebuild it."
      }
    }
    $nativeNoticeEntryName = "assets/public/ANDROID_NATIVE_THIRD_PARTY_NOTICES.txt"
    $expectedPublicEntries[$nativeNoticeEntryName] = $true
    $expectedPublicEntries["assets/public/RELEASE_PROVENANCE.json"] = $true
    $expectedPublicEntries["assets/public/cordova.js"] = $true
    $expectedPublicEntries["assets/public/cordova_plugins.js"] = $true
    foreach ($entryName in $expectedPublicEntries.Keys) {
      if (-not $apkEntries.ContainsKey($entryName)) {
        throw "Signed release APK is missing expected public asset $entryName."
      }
    }
    $nativeNoticeEntry = $apkEntries[$nativeNoticeEntryName]
    if (-not $nativeNoticeEntry) {
      throw "Signed release APK is missing its Android native dependency notices."
    }
    $nativeNoticeStream = $nativeNoticeEntry.Open()
    try {
      $algorithm = [System.Security.Cryptography.SHA256]::Create()
      try {
        $packagedNativeNoticeHash = [BitConverter]::ToString(
          $algorithm.ComputeHash($nativeNoticeStream)
        ).Replace("-", "").ToLowerInvariant()
      } finally {
        $algorithm.Dispose()
      }
    } finally {
      $nativeNoticeStream.Dispose()
    }
    $currentNativeNoticeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $nativeNoticePath).Hash.ToLowerInvariant()
    if ($packagedNativeNoticeHash -ne $currentNativeNoticeHash) {
      throw "Signed release APK contains stale Android native dependency notices."
    }
    $noticeEntry = $apkEntries["assets/public/THIRD_PARTY_NOTICES.txt"]
    if (-not $noticeEntry -or $noticeEntry.Length -lt 1024) {
      throw "Signed release APK is missing its complete third-party notices."
    }

    $forbiddenText = @(
      @{ Label = "uiohook"; Pattern = 'uiohook(?:-napi)?' },
      @{ Label = "automated Trade service"; Pattern = 'trade-service' },
      @{ Label = "undocumented Trade search"; Pattern = '/api/trade/search' },
      @{ Label = "undocumented Trade fetch"; Pattern = '/api/trade/fetch' },
      @{ Label = "undocumented Trade exchange"; Pattern = '/api/trade/exchange' },
      @{ Label = "legacy Faustus proxy"; Pattern = '/faustus-api' },
      @{ Label = "legacy Trade IPC"; Pattern = 'price-check:search-trade' }
    )
    foreach ($entry in $apkArchive.Entries) {
      $isTextAsset =
        $entry.FullName.StartsWith("assets/") -and
        $entry.FullName -match '\.(?:cjs|css|html|js|json|map|md|mjs|txt)$'
      $isNotice = $entry.Name -match '^(?:LICENSE|NOTICE|DEPENDENCIES)'
      if ((-not $isTextAsset -and -not $isNotice) -or $entry.Length -gt 64MB) {
        continue
      }
      $stream = $entry.Open()
      try {
        $reader = [System.IO.StreamReader]::new(
          $stream,
          [System.Text.Encoding]::UTF8,
          $true
        )
        try {
          $text = $reader.ReadToEnd()
        } finally {
          $reader.Dispose()
        }
      } finally {
        $stream.Dispose()
      }
      foreach ($forbidden in $forbiddenText) {
        if ($text -match $forbidden.Pattern) {
          throw "Signed release APK asset $($entry.FullName) contains forbidden $($forbidden.Label) content."
        }
      }
    }
  } finally {
    $apkArchive.Dispose()
  }

  if ($VerifyOnly) {
    Write-Output "Verified signed Android release $Version and all packaged assets/notices."
    return
  }

  $apkName = "GloamCore-Android-$Version.apk"
  $apkHashName = "GloamCore-Android-$Version.sha256.txt"
  $sourceName = "GloamCore-iOS-Source-$Version.zip"
  $sourceHashName = "GloamCore-iOS-Source-$Version.sha256.txt"
  $friendsName = "GloamCore-Mobile-Friends-$Version.zip"
  $friendsHashName = "GloamCore-Mobile-Friends-$Version.sha256.txt"
  $apkPath = Join-Path $mobileOutputFull $apkName
  $apkHashPath = Join-Path $mobileOutputFull $apkHashName
  $sourcePath = Join-Path $mobileOutputFull $sourceName
  $sourceHashPath = Join-Path $mobileOutputFull $sourceHashName
  $friendsPath = Join-Path $mobileOutputFull $friendsName
  $friendsHashPath = Join-Path $mobileOutputFull $friendsHashName
  $readmePath = Join-Path $mobileOutputFull "README-FIRST.txt"
  $guidePath = Join-Path $mobileOutputFull "MOBILE-GUIDE.md"
  $stagePath = Join-Path $mobileOutputFull ".friends-$Version"
  $stageFull = [System.IO.Path]::GetFullPath($stagePath)

  foreach ($path in @($apkPath, $apkHashPath, $sourcePath, $sourceHashPath, $friendsPath, $friendsHashPath, $readmePath, $guidePath, $stageFull)) {
    $fullPath = [System.IO.Path]::GetFullPath($path)
    if (-not $fullPath.StartsWith("$mobileOutputFull\", [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to write or remove a path outside deliverables/mobile: $fullPath"
    }
  }

  foreach ($path in @($apkPath, $apkHashPath, $sourcePath, $sourceHashPath, $friendsPath, $friendsHashPath, $readmePath, $guidePath)) {
    if (Test-Path -LiteralPath $path) {
      Remove-Item -LiteralPath $path -Force
    }
  }
  if (Test-Path -LiteralPath $stageFull) {
    Remove-Item -LiteralPath $stageFull -Recurse -Force
  }

  Copy-Item -LiteralPath $builtApk -Destination $apkPath
  Copy-Item -LiteralPath "docs/FRIENDS-MOBILE.txt" -Destination $readmePath
  Copy-Item -LiteralPath "docs/MOBILE.md" -Destination $guidePath

  git archive --format=zip --output=$sourcePath HEAD
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $sourcePath)) {
    throw "Git could not create the iOS source archive."
  }

  $apkHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $apkPath).Hash.ToLowerInvariant()
  $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $sourcePath).Hash.ToLowerInvariant()
  Set-Content -LiteralPath $apkHashPath -Value "$apkHash  $apkName" -Encoding ascii
  Set-Content -LiteralPath $sourceHashPath -Value "$sourceHash  $sourceName" -Encoding ascii

  New-Item -ItemType Directory -Path $stageFull | Out-Null
  foreach ($path in @($apkPath, $apkHashPath, $sourcePath, $sourceHashPath, $readmePath, $guidePath)) {
    Copy-Item -LiteralPath $path -Destination $stageFull
  }
  Copy-Item -LiteralPath (Join-Path (Split-Path -Parent $builtApk) "release-provenance.json") `
    -Destination (Join-Path $stageFull "ANDROID-BUILD-PROVENANCE.json")
  Copy-Item -LiteralPath $nativeInventoryPath `
    -Destination (Join-Path $stageFull "ANDROID-MAVEN-LICENSE-INVENTORY.json")
  Copy-Item -LiteralPath $nativeNoticePath `
    -Destination (Join-Path $stageFull "ANDROID-NATIVE-THIRD-PARTY-NOTICES.txt")
  Compress-Archive -Path (Join-Path $stageFull "*") -DestinationPath $friendsPath -CompressionLevel Optimal
  Remove-Item -LiteralPath $stageFull -Recurse -Force

  $friendsHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $friendsPath).Hash.ToLowerInvariant()
  Set-Content -LiteralPath $friendsHashPath -Value "$friendsHash  $friendsName" -Encoding ascii

  [pscustomobject]@{
    Version = $Version
    Android = $apkName
    AndroidSha256 = $apkHash
    IosSource = $sourceName
    IosSourceSha256 = $sourceHash
    FriendsBundle = $friendsName
    FriendsBundleSha256 = $friendsHash
  }
} finally {
  Pop-Location
}
