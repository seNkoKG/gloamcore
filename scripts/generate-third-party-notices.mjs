import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageManager = process.env.npm_execpath || process.argv[2];

if (!packageManager || !fs.existsSync(packageManager)) {
  throw new Error("Run this generator through pnpm or pass the pnpm.mjs path.");
}

let pnpmStoreDir;
try {
  const modulesManifest = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "node_modules", ".modules.yaml"), "utf8"),
  );
  if (typeof modulesManifest.storeDir === "string") {
    pnpmStoreDir = modulesManifest.storeDir;
  }
} catch {
  // Older pnpm manifests are YAML. In that case pnpm can resolve its default
  // store, or the caller can run the generator through the installed pnpm.
}

function readLicenseReport({ productionOnly = false } = {}) {
  const attempt = [];
  if (pnpmStoreDir) {
    attempt.push(pnpmStoreDir);
  }
  attempt.push(null);

  const parseLicenseErrorCode = (error) => {
    const output = Array.isArray(error?.output) ? error.output.filter(Boolean) : [];
    const stdoutText = typeof error?.stdout === "string" ? error.stdout : output[1] ?? "";
    const stderrText = typeof error?.stderr === "string" ? error.stderr : output[2] ?? "";
    const combined = [stdoutText, stderrText].find((text) => typeof text === "string" && text.includes("{\"error\""));
    if (!combined) return undefined;
    try {
      return JSON.parse(combined).error?.code;
    } catch {
      return undefined;
    }
  };

  const retryableCodes = new Set([
    "ERR_SQLITE_ERROR",
    "ERR_PNPM_MISSING_PACKAGE_INDEX_FILE",
  ]);

  let lastError;
  for (const storeDir of attempt) {
    const licenseArgs = [packageManager];
    if (storeDir) licenseArgs.push(`--config.store-dir=${storeDir}`);
    licenseArgs.push("licenses", "list");
    if (productionOnly) licenseArgs.push("--prod");
    licenseArgs.push("--json");
    try {
      return JSON.parse(execFileSync(
        process.execPath,
        licenseArgs,
        { cwd: projectRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      ));
    } catch (error) {
      lastError = error;
      if (storeDir && retryableCodes.has(parseLicenseErrorCode(error))) {
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

const productionReport = readLicenseReport({ productionOnly: true });
const completeReport = readLicenseReport();
const MOBILE_RUNTIME_PACKAGES = new Set([
  "@capacitor/android",
  "@capacitor/app",
  "@capacitor/browser",
  "@capacitor/core",
  "@capacitor/haptics",
  "@capacitor/ios",
  "@capacitor/local-notifications",
  "@capacitor/network",
  "@capacitor/preferences",
  "@capacitor/splash-screen",
  "@capacitor/status-bar",
]);

const MIT_FALLBACK = `Copyright (c) Vladimir Krivosheev

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished
to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const BSD_2_FALLBACK = `Copyright (c) Electron contributors
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;

const fallbacks = new Map([
  ["lazy-val", MIT_FALLBACK],
  ["@electron-internal/extract-zip", BSD_2_FALLBACK],
]);

function normalize(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

function findLicenseFile(packagePath) {
  return fs.readdirSync(packagePath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^(licen[cs]e|copying)(\..*)?$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))[0];
}

function flattenReport(report) {
  return Object.entries(report)
    .flatMap(([license, entries]) => entries.map((entry) => ({ ...entry, license })));
}

const noticePackages = new Map();
for (const entry of [
  ...flattenReport(productionReport),
  ...flattenReport(completeReport).filter((entry) => MOBILE_RUNTIME_PACKAGES.has(entry.name)),
]) {
  const key = `${entry.name}\0${[...entry.versions].sort().join(",")}\0${entry.license}`;
  noticePackages.set(key, entry);
}
const packages = [...noticePackages.values()]
  .sort((left, right) => left.name.localeCompare(right.name));

const sections = packages.map((entry) => {
  const packagePath = entry.paths?.[0];
  const licenseFile = packagePath ? findLicenseFile(packagePath) : undefined;
  const licenseText = licenseFile
    ? normalize(fs.readFileSync(path.join(packagePath, licenseFile), "utf8"))
    : fallbacks.get(entry.name);
  if (!licenseText) {
    throw new Error(`No distributable license text found for ${entry.name}.`);
  }
  const versions = [...entry.versions].sort().join(", ");
  return [
    "=".repeat(78),
    `${entry.name} ${versions}`,
    `License: ${entry.license}`,
    entry.homepage ? `Project: ${entry.homepage}` : null,
    `License source: ${licenseFile || "SPDX-compatible fallback retained by GloamCore"}`,
    "-".repeat(78),
    licenseText,
  ].filter(Boolean).join("\n");
});

const preamble = `THIRD-PARTY NOTICES
===================

GloamCore distributes the open-source packages listed below. This inventory
is generated from the Windows production dependency graph plus the explicit
native mobile runtime package set; each entry keeps the package version, SPDX
license identifier, project link, and complete license text. Electron's own
LICENSE.electron.txt and LICENSES.chromium.html are also retained beside the
Windows executable.

Awakened PoE Trade item and modifier data
------------------------------------------

GloamCore includes a transformed English modifier-to-Trade-ID snapshot from:
https://github.com/SnosMe/awakened-poe-trade

Source commit: adb6c287bd978a70701e2b65d744dd677c52fb65
Source release: v3.29.104
Source artifact commit date: 2026-08-08
License: MIT (the Awakened PoE Trade license and copyright are included below
with the matching electron-overlay-window attribution by Alexander Drozdov).

It is transformed into local modifier-ID, complete StatGroup resolver, and
complete ordered ITEM/UNIQUE variant catalogs used to build a readable Trade
filter plan. StatGroup category selection, merged IDs, per-ID numeric
transforms, base-property discriminators, and unique fixed-stat declarations
remain pinned to that source release.
GloamCore does not use POESESSID or account-session cookies. The Windows price
checker may anonymously use fixed public official Trade website search/exchange/fetch
routes for a compact listing snapshot; the mobile packages do not include that
desktop bridge. Awakened PoE Trade acknowledges RePoE for extracted game data.

Regex reference data
--------------------

The bundled PoE 1 regex reference pack is generated from public Grinding Gear
Games Trade API data, the app's transformed Awakened Trade catalog, Path of
Building Community data, and Area modifier records queried from PoE Wiki Cargo.
Its source identities, retrieval timestamps, input hashes, coverage, and known
limitations are embedded in public/data/toolkit/regex-v1.json.

PoE Wiki textual content that the wiki may license is provided under CC
BY-NC-SA 3.0. Source: https://www.poewiki.net/ and
https://www.poewiki.net/wiki/Path_of_Exile_Wiki:Copyrights
The transformed Cargo-derived portion of the regex reference pack retains that
attribution and license. Path of Exile content and materials remain the
intellectual property of their respective owners.

Cluster Back reference data
---------------------------

The bundled PoE 1 Cluster Back reference pack is generated from public
Grinding Gear Games Trade API data, Path of Building Community data, and
Cluster Jewel modifier records queried from PoE Wiki Cargo. Its source
identities, retrieval timestamps, input hashes, transformations, and known
limitations are embedded in public/data/toolkit/cluster-back-v1.json.

PoE Wiki textual content that the wiki may license is provided under CC
BY-NC-SA 3.0. Source: https://www.poewiki.net/ and
https://www.poewiki.net/wiki/Path_of_Exile_Wiki:Copyrights
The transformed Cargo-derived portion of the Cluster Back reference pack
retains that attribution and license. Path of Exile content and materials
remain the intellectual property of their respective owners.

Path of Building calculation bridge
-----------------------------------

GloamCore includes a tagged Path of Building Community HeadlessWrapper
adapter under the MIT License and uses it only with a separately installed,
exactly verified Path of Building release. The app does not redistribute the
Path of Building runtime or game databases. The adapter's complete notice is
shipped at electron/pob-headless-wrapper.LICENSE.md.

Copyright (c) 2016 David Gowor

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Path of Exile names and game data belong to Grinding Gear Games. This product
is not affiliated with or endorsed by Grinding Gear Games, poe.ninja,
Awakened PoE Trade, Path of Building Community, PoE Wiki, or their maintainers.

Shipped dependency license inventory
------------------------------------`;

const notice = `${preamble}\n\n${sections.join("\n\n")}\n`;
fs.writeFileSync(path.join(projectRoot, "public", "THIRD_PARTY_NOTICES.txt"), notice, "utf8");
fs.writeFileSync(
  path.join(projectRoot, "THIRD_PARTY_NOTICES.md"),
  `# Third-party notices\n\n${notice.slice("THIRD-PARTY NOTICES\n===================\n\n".length)}`,
  "utf8",
);

console.log(`Wrote notices for ${packages.length} shipped packages.`);
