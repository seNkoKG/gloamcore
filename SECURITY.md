# Security policy

GloamCore is a desktop companion that handles global shortcuts, copied item
text, local files, remote data, native overlay windows, an isolated Wealthy
Exile browser profile, and an optional official OAuth token. Reports that cross
one of those trust boundaries are taken seriously.

## Supported versions

Security fixes are provided for the latest stable release only. Before
reporting, reproduce the issue on the version shown on the
[latest release page](https://github.com/seNkoKG/gloamcore/releases/latest)
when it is safe to do so.

## Report a vulnerability privately

Do not disclose a vulnerability, credential, token, exploit, or sensitive log
in a public issue.

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability** to start a private report.
3. Include the affected version, Windows version, impact, minimal reproduction,
   and any suggested mitigation.

If private vulnerability reporting is unavailable, open a public issue that
only asks the repository owner for a private contact channel. Do not include
technical details until that channel is established.

Useful reports explain:

- which trust boundary was crossed;
- whether user interaction is required;
- the smallest reliable reproduction;
- whether the issue affects a default configuration;
- which logs or proof-of-concept files are safe to share privately.

The maintainer will acknowledge the report, investigate it, coordinate a fix
and release when warranted, and credit the reporter if requested. Public
details should wait until users have had a reasonable opportunity to update.

## Important security expectations

- GloamCore must not inspect game memory, inject into Path of Exile, automate
  gameplay, send whispers, or use account-session cookies.
- The optional `account:characters` OAuth token is held only in process memory,
  cleared after import, and never persisted. Authenticated character responses
  are not cached.
- Remote plugin pages must remain isolated from Node, Electron, the filesystem,
  direct clipboard access, and game memory. Sensitive capabilities require an
  explicit per-plugin permission.
- The embedded Wealthy Exile view must remain on its dedicated session partition
  with no preload, Node, Electron, filesystem, download, or permission access.
  GloamCore must not read or reuse Wealthy Exile cookies, OAuth tokens, or
  responses. Ads-only filtering is scoped to Wealthy Exile, disabled on sign-in
  hosts, and fails open if no filter engine is available.
- External URLs and remote responses must stay allowlisted, bounded, and
  validated before crossing the preload bridge.
- Update metadata and binaries must come from the public
  `seNkoKG/gloamcore` GitHub release channel configured in the packaged app.

Please report any behavior that contradicts these expectations privately.

## Usually not a security issue

Incorrect price estimates, stale market data, an unavailable upstream service,
or normal Trade rate limiting should use the bug form. They become security
issues when they allow code execution, credential exposure, unauthorized data
access, persistence outside the documented boundary, or a bypass of an
explicit permission.

Current Windows binaries are not Authenticode-signed. This is disclosed on the
release page and in the README; it is not itself a vulnerability. A checksum or
binary mismatch, unexpected update source, or update-integrity bypass is a
security issue and should be reported privately.
