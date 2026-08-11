# Contributing to GloamCore

Thank you for helping improve GloamCore. Clear bug reports, reproducible test
cases, documentation corrections, and focused pull requests are welcome.

## Before starting

- Search existing issues before opening a new one.
- Use the bug or feature form so the report includes enough context.
- Open an issue before a large UI, architecture, data-source, or behavior
  change. This avoids work that conflicts with a supported safety boundary.
- Report vulnerabilities through the private process in [SECURITY.md](SECURITY.md),
  never in a public issue.

This repository is source-available and declares `UNLICENSED`; it does not grant
a general open-source license. If you need permission to reuse project code,
ask the maintainer first.

## Development setup

The desktop app uses Electron, React, TypeScript, Vite, Vitest, and pnpm.

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm electron:dev
```

Windows packaging requires the configured native release toolchain:

```powershell
pnpm dist
```

Do not commit `node_modules`, package output, local stores, release snapshots,
logs, signing material, OAuth tokens, or user data.

## Make a focused change

1. Keep the patch scoped to one problem.
2. Add or update the smallest relevant automated tests.
3. Run those focused tests while iterating.
4. Before proposing the change, run `pnpm test` and `pnpm build`.
5. For native overlays, updater behavior, packaging, or Build Lab engine work,
   run the relevant smoke and artifact verification scripts as well.

Keep unrelated formatting, generated output, and existing local work out of a
focused patch.

## Data and provenance changes

Generated data packs must remain deterministic and reviewable. Do not hand-edit
transformed Trade IDs, item families, regex entries, or PoB-derived records.
Use the matching script under `scripts/`, preserve upstream identity and input
hashes, update tests, regenerate notices when required, and document material
source changes in [DATA_PROVENANCE.md](docs/DATA_PROVENANCE.md).

New data must have a clear source, permitted use, retrieval method, freshness
boundary, and failure mode. Do not add scraped private data, account cookies,
`POESESSID`, or an undocumented credential dependency.

## Safety boundaries

A contribution must not:

- read or modify Path of Exile process memory;
- inject code, automate gameplay, or send unattended input;
- persist an OAuth token or authenticated character response;
- expose Node, Electron, filesystem, or direct clipboard access to remote pages;
- silently broaden an external URL or IPC allowlist;
- hide stale, incomplete, unresolved, or low-confidence data from the user;
- install an application update without explicit confirmation.

If a feature needs a new permission, make it narrow, visible, disabled by
default where practical, and covered by tests.

## Pull request checklist

Include:

- a concise problem statement and explanation of the solution;
- screenshots for visible UI changes, captured from the real application;
- test commands and results;
- data-source or privacy impact;
- compatibility or migration notes;
- confirmation that no secrets, local paths, generated output, or personal data
  were added.

Keep unrelated formatting and generated-file churn out of the patch. The
maintainer may request a smaller change or additional release QA before merge.

## Third-party work

Do not copy code, artwork, game assets, or datasets without keeping the required
license and attribution. Existing upstream acknowledgements are collected in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Path of Exile content remains
the property of its respective owners.
