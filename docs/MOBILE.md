# GloamCore mobile

GloamCore includes Android and iOS source projects built from the same
React economy engine as the Windows app. Mobile packages are a development
preview and are **not** included in the public Windows GitHub Release. The
mobile interface is designed for touch and keeps the economy catalogue,
mobile-supported filters, trackers, item descriptions, trends, and trade links.
Windows-only Player Toolkit features that require a local PoE process or
`Client.txt`, including Mapping Journal, remain visible with an explicit
platform boundary and do not fabricate mobile observations.

The newest packaged mobile preview in `deliverables/mobile` is 3.4.2. No 3.4.5
Android or iOS package has been built or published.

## Android: build, install, or share

After a maintainer completes the signed mobile release workflow, its output is:

`deliverables/mobile/GloamCore-Android-VERSION.apk`

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

`deliverables/mobile/GloamCore-iOS-Source-VERSION.zip`

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

- poe.ninja economy data comes from GloamCore's 30-minute GitHub Pages mirror;
  the app verifies its source timestamps and payload digest and never falls back
  to a direct end-user API request. Evidence older than two hours is marked
  informational and cannot trigger alerts. The verified mirror is rejected
  after 24 hours.
- Documented Public Currency Exchange completed-hour evidence from Faustus is
  checked every five minutes, with one-minute catch-up checks while a newly
  completed hour is unpublished.
- The app refreshes while open, immediately on resume, and when connectivity
  returns.
- Cached snapshots and item descriptions remain available offline.
- League Navigator ships the validated campaign, area, quest, and gem pack for
  offline use, checks the project-controlled update channel while opened, and
  activates only complete SHA-256-verified, monotonically newer packs. Campaign
  progress is preserved for route steps whose content identity is unchanged.
- Atlas Command Center uses the same validated pack for authentic official
  sprites, the exact graph and point budget, current official URL sharing, and
  migration of connected saved loadouts after a league update.
- Build Upgrade Assistant can import and compare two exported GloamCore build
  snapshots. Mobile cannot run Path of Building, so every stored numeric value
  is explicitly marked snapshot-only, non-authoritative, and potentially stale.
- Item Intel searches live PoE Wiki Cargo item and modifier records, then
  keeps the last good result available from cache.
- The price-check tab parses manually pasted in-game item text locally and
  builds the same mapped modifier, special-jewel, item-state, Chronicle-room,
  Veiled-state, and safely calculated equipment-property query plan used by
  the shared renderer.
- Mobile opens the correct official Trade league through a user-clicked
  handoff. It does not provide the Windows `Ctrl+D` capture, global PoE-attached
  overlay, or native input helper.
- The mobile package does not call Trade search, exchange, or fetch routes; it
  only opens the encoded query after a user click. Mobile never uses account
  cookies or `POESESSID`.
- Target notifications are local and require notification permission. A
  Divine-denominated target pauses when its conversion is unavailable, and
  low-confidence or stale rows cannot trigger an alert.

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
Android build uses JDK 21 and Build Tools 36.0.0. CI synchronizes and compiles
an Android debug app on Linux and an iOS simulator app on macOS; these checks do
not change the public-release boundary, which remains Windows x64.
