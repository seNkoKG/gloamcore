# GloamCore mobile

GloamCore includes Android and iOS source projects built from the same
React economy engine as the Windows app. Mobile packages are a development
preview and are **not** included in the public Windows GitHub Release. The
mobile interface is designed for touch and keeps the economy catalogue,
mobile-supported filters, trackers, item descriptions, trends, and trade links.

## Android: build, install, or share

After a maintainer completes the signed mobile release workflow, its output is:

`deliverables/mobile/GloamCore-Android-2.8.0.apk`

Copy it to the Android phone, open it, and allow installs from the app used to
open the file when Android asks. GloamCore supports Android 7.0 and newer. It
does not need a Google Play account.

Keep the APK's filename and SHA-256 text file together when sharing it. Friends
can compare the checksum before installation. Future Android updates must be
signed with the same private keystore, so keep `.mobile-signing` backed up and
private. Do not send that folder to friends.

The friends archive also includes `ANDROID-NATIVE-THIRD-PARTY-NOTICES.txt` and
`ANDROID-MAVEN-LICENSE-INVENTORY.json`. The same native notice is embedded in
the APK. Packaging stops if the resolved release dependencies, license
attribution, signer certificate, or embedded notice does not match the audited
build.

## iPhone and iPad

Apple requires every native iOS build to be signed on macOS. The complete Xcode
project is in `ios/App` and the friend-ready full source archive is:

`deliverables/mobile/GloamCore-iOS-Source-2.8.0.zip`

On a Mac:

1. Extract the source archive, install Xcode and Node.js, then run
   `pnpm install` and `pnpm mobile:sync`.
2. Run `pnpm mobile:ios:open`.
3. Select the `App` target, choose a personal Apple Development team under
   Signing & Capabilities, connect the iPhone, and press Run.
4. Each friend signs the project with their own Apple account unless you use
   TestFlight or an Apple Developer distribution profile.

There is intentionally no unsigned IPA: iOS will not install one.

## Live data and tracking

- poe.ninja economy data refreshes according to source cache headers.
- The app refreshes while open, immediately on resume, and when connectivity
  returns.
- Cached snapshots and item descriptions remain available offline.
- Item Intel searches live PoE Wiki Cargo item and modifier records, then
  keeps the last good result available from cache.
- The price-check tab parses manually pasted in-game item text locally and
  builds the same mapped modifier, special-jewel, item-state, Chronicle-room,
  Veiled-state, and safely calculated equipment-property query plan used by
  the shared renderer.
- Mobile opens the correct official Trade league through a user-clicked
  handoff. It does not provide the Windows `Ctrl+D` capture, global PoE-attached
  overlay, or Electron bridge that retrieves compact live seller rows.
- The mobile package contains no direct Path of Exile Trade search/fetch client
  and never uses account cookies or `POESESSID`.
- Target notifications are local and require notification permission.

Mobile operating systems can suspend ordinary apps after they are closed.
Therefore, target checks are guaranteed while GloamCore is open and whenever
it resumes, but continuous closed-app polling is not promised. Guaranteed
server-side alerts would require a hosted push-notification service.

## Developer commands

```powershell
pnpm mobile:sync
pnpm mobile:assets
pnpm mobile:android:debug
pnpm mobile:android:release
pnpm mobile:ios:open
pnpm mobile:package
```

The checked-in native projects target Android API 36 and iOS 15. The local
Android build uses JDK 21 and Build Tools 36.0.0.
