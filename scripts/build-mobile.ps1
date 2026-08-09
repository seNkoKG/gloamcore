param(
  [ValidateSet("Debug", "Release")]
  [string]$Configuration = "Debug"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "resolve-release-toolchain.ps1")
$toolchain = Get-ReleaseToolchain -ProjectRoot $projectRoot
$pnpmCommand = $toolchain.PnpmPath
$nodePath = $toolchain.NodePath
$variant = $Configuration.ToLowerInvariant()
$apkOutputDirectory = [System.IO.Path]::GetFullPath(
  (Join-Path $projectRoot "android\app\build\outputs\apk\$variant")
)
$apk = [System.IO.Path]::GetFullPath(
  (Join-Path $apkOutputDirectory "app-$variant.apk")
)
$provenancePath = [System.IO.Path]::GetFullPath(
  (Join-Path $apkOutputDirectory "release-provenance.json")
)
$androidBuildRoot = [System.IO.Path]::GetFullPath(
  (Join-Path $projectRoot "android\app\build")
)
$nativeReportDirectory = [System.IO.Path]::GetFullPath(
  (Join-Path $androidBuildRoot "reports")
)
$rawNativeInventoryPath = [System.IO.Path]::GetFullPath(
  (Join-Path $nativeReportDirectory "release-runtime-artifacts.json")
)
$nativeInventoryPath = [System.IO.Path]::GetFullPath(
  (Join-Path $nativeReportDirectory "release-runtime-notice-inventory.json")
)
$nativeNoticePath = [System.IO.Path]::GetFullPath(
  (Join-Path $nativeReportDirectory "release-runtime-third-party-notices.txt")
)
$nativeNoticeAssetPath = [System.IO.Path]::GetFullPath(
  (Join-Path $projectRoot "android\app\src\main\assets\public\ANDROID_NATIVE_THIRD_PARTY_NOTICES.txt")
)
$embeddedProvenanceAssetPath = [System.IO.Path]::GetFullPath(
  (Join-Path $projectRoot "android\app\src\main\assets\public\RELEASE_PROVENANCE.json")
)
if (-not $apk.StartsWith("$androidBuildRoot\", [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to replace an APK outside android/app/build: $apk"
}
if (-not $provenancePath.StartsWith("$androidBuildRoot\", [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to replace provenance outside android/app/build: $provenancePath"
}
foreach ($reportPath in @($rawNativeInventoryPath, $nativeInventoryPath, $nativeNoticePath)) {
  if (-not $reportPath.StartsWith("$androidBuildRoot\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to replace a native dependency report outside android/app/build: $reportPath"
  }
}
$androidPublicAssetsRoot = [System.IO.Path]::GetFullPath(
  (Join-Path $projectRoot "android\app\src\main\assets\public")
)
foreach ($assetPath in @($nativeNoticeAssetPath, $embeddedProvenanceAssetPath)) {
  if (-not $assetPath.StartsWith("$androidPublicAssetsRoot\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to replace a generated release asset outside Android public assets: $assetPath"
  }
}
$localJdk = Get-ChildItem -LiteralPath (Join-Path $projectRoot ".mobile-tools\jdk") -Directory -ErrorAction SilentlyContinue |
  Select-Object -First 1
$localSdk = Join-Path $projectRoot ".mobile-tools\android-sdk"

if ($localJdk) {
  $env:JAVA_HOME = $localJdk.FullName
}
if (Test-Path -LiteralPath $localSdk) {
  $env:ANDROID_HOME = $localSdk
  $env:ANDROID_SDK_ROOT = $localSdk
}
if (-not $env:JAVA_HOME) {
  throw "JDK 21 was not found. Install Android Studio or restore .mobile-tools\jdk."
}
if (-not $env:ANDROID_HOME) {
  throw "Android SDK was not found. Install API 36 and Build Tools 36.0.0."
}
if ($Configuration -eq "Release" -and -not (Test-Path -LiteralPath (Join-Path $projectRoot "mobile-signing.local.properties"))) {
  throw "Release signing settings are missing. Restore mobile-signing.local.properties and the private keystore."
}

Push-Location $projectRoot
try {
  if ($Configuration -eq "Release") {
    $changes = @(git status --porcelain --untracked-files=all)
    if ($LASTEXITCODE -ne 0) {
      throw "Git status failed before the Android release build."
    }
    if ($changes.Count -gt 0) {
      throw "Commit the audited release before building the signed APK so provenance can bind it to current HEAD."
    }
    & (Join-Path $PSScriptRoot "assert-release-toolchain.ps1")
  }

  $buildStartedAtUtc = [DateTime]::UtcNow
  & $pnpmCommand build
  if ($LASTEXITCODE -ne 0) {
    throw "The web build failed; Android build stopped before stale output could be accepted."
  }
  & $pnpmCommand exec cap sync android
  if ($LASTEXITCODE -ne 0) {
    throw "Capacitor Android sync failed; Android build stopped before stale output could be accepted."
  }

  New-Item -ItemType Directory -Path $apkOutputDirectory -Force | Out-Null
  if (Test-Path -LiteralPath $apk -PathType Leaf) {
    Remove-Item -LiteralPath $apk -Force
  }
  if ($Configuration -eq "Release" -and (Test-Path -LiteralPath $provenancePath -PathType Leaf)) {
    Remove-Item -LiteralPath $provenancePath -Force
  }
  foreach ($assetPath in @($nativeNoticeAssetPath, $embeddedProvenanceAssetPath)) {
    if (Test-Path -LiteralPath $assetPath -PathType Leaf) {
      Remove-Item -LiteralPath $assetPath -Force
    }
  }
  foreach ($reportPath in @($rawNativeInventoryPath, $nativeInventoryPath, $nativeNoticePath)) {
    if (Test-Path -LiteralPath $reportPath -PathType Leaf) {
      Remove-Item -LiteralPath $reportPath -Force
    }
  }

  Push-Location (Join-Path $projectRoot "android")
  try {
    .\gradlew.bat -I ..\scripts\android-release-inventory.init.gradle writeReleaseRuntimeInventory `
      --offline --dependency-verification strict
    if ($LASTEXITCODE -ne 0) {
      throw "Gradle could not resolve the release runtime dependency inventory."
    }
  } finally {
    Pop-Location
  }
  & $nodePath (Join-Path $PSScriptRoot "generate-android-native-notices.mjs")
  if ($LASTEXITCODE -ne 0) {
    throw "Android native third-party notice generation failed."
  }
  if (-not (Test-Path -LiteralPath $nativeNoticePath -PathType Leaf)) {
    throw "Android native third-party notice was not generated: $nativeNoticePath"
  }
  Copy-Item -LiteralPath $nativeNoticePath -Destination $nativeNoticeAssetPath -Force

  if ($Configuration -eq "Release") {
    $packageJson = Get-Content -Raw (Join-Path $projectRoot "package.json") | ConvertFrom-Json
    & $nodePath (Join-Path $PSScriptRoot "verify-release-artifacts.mjs") prepare-mobile `
      --root $projectRoot `
      --version ([string]$packageJson.version)
    if ($LASTEXITCODE -ne 0) {
      throw "Embedded Android release provenance generation failed."
    }
  }

  Push-Location (Join-Path $projectRoot "android")
  try {
    if ($Configuration -eq "Release") {
      .\gradlew.bat assembleRelease lintDebug testDebugUnitTest `
        --offline --dependency-verification strict
    } else {
      .\gradlew.bat assembleDebug lintDebug testDebugUnitTest `
        --offline --dependency-verification strict
    }
    if ($LASTEXITCODE -ne 0) {
      throw "Gradle $Configuration build, lint, or unit tests failed."
    }
  } finally {
    Pop-Location
  }

  if (-not (Test-Path -LiteralPath $apk -PathType Leaf)) {
    throw "The expected APK was not freshly created: $apk"
  }
  if ((Get-Item -LiteralPath $apk).LastWriteTimeUtc -lt $buildStartedAtUtc.AddSeconds(-2)) {
    throw "The APK predates this build invocation and cannot be accepted: $apk"
  }

  if ($Configuration -eq "Release") {
    $changes = @(git status --porcelain --untracked-files=all)
    if ($LASTEXITCODE -ne 0) {
      throw "Git status failed after the Android release build."
    }
    if ($changes.Count -gt 0) {
      throw "The Android release build changed committed source. Review and commit it, then rebuild."
    }
    $packageJson = Get-Content -Raw (Join-Path $projectRoot "package.json") | ConvertFrom-Json
    & $nodePath (Join-Path $PSScriptRoot "verify-release-artifacts.mjs") record-mobile `
      --root $projectRoot `
      --version ([string]$packageJson.version) `
      --apk $apk `
      --started-at $buildStartedAtUtc.ToString("o")
    if ($LASTEXITCODE -ne 0) {
      throw "Android release provenance recording failed."
    }
    & (Join-Path $PSScriptRoot "package-mobile.ps1") `
      -Version ([string]$packageJson.version) `
      -VerifyOnly
  }
} finally {
  Pop-Location
}

if (-not (Test-Path -LiteralPath $apk)) {
  throw "The expected APK was not created: $apk"
}
Write-Host "Built $apk"
