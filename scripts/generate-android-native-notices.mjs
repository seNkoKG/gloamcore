import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const APACHE_2_TEXT = `Apache License
Version 2.0, January 2004
http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

"License" shall mean the terms and conditions for use, reproduction, and
distribution as defined by Sections 1 through 9 of this document.

"Licensor" shall mean the copyright owner or entity authorized by the
copyright owner that is granting the License.

"Legal Entity" shall mean the union of the acting entity and all other
entities that control, are controlled by, or are under common control with
that entity. For the purposes of this definition, "control" means (i) the
power, direct or indirect, to cause the direction or management of such
entity, whether by contract or otherwise, or (ii) ownership of fifty percent
(50%) or more of the outstanding shares, or (iii) beneficial ownership of
such entity.

"You" (or "Your") shall mean an individual or Legal Entity exercising
permissions granted by this License.

"Source" form shall mean the preferred form for making modifications,
including but not limited to software source code, documentation source, and
configuration files.

"Object" form shall mean any form resulting from mechanical transformation
or translation of a Source form, including but not limited to compiled object
code, generated documentation, and conversions to other media types.

"Work" shall mean the work of authorship, whether in Source or Object form,
made available under the License, as indicated by a copyright notice that is
included in or attached to the work (an example is provided in the Appendix
below).

"Derivative Works" shall mean any work, whether in Source or Object form,
that is based on (or derived from) the Work and for which the editorial
revisions, annotations, elaborations, or other modifications represent, as a
whole, an original work of authorship. For the purposes of this License,
Derivative Works shall not include works that remain separable from, or merely
link (or bind by name) to the interfaces of, the Work and Derivative Works
thereof.

"Contribution" shall mean any work of authorship, including the original
version of the Work and any modifications or additions to that Work or
Derivative Works thereof, that is intentionally submitted to Licensor for
inclusion in the Work by the copyright owner or by an individual or Legal
Entity authorized to submit on behalf of the copyright owner. For the purposes
of this definition, "submitted" means any form of electronic, verbal, or
written communication sent to the Licensor or its representatives, including
but not limited to communication on electronic mailing lists, source code
control systems, and issue tracking systems that are managed by, or on behalf
of, the Licensor for the purpose of discussing and improving the Work, but
excluding communication that is conspicuously marked or otherwise designated
in writing by the copyright owner as "Not a Contribution."

"Contributor" shall mean Licensor and any individual or Legal Entity on
behalf of whom a Contribution has been received by Licensor and subsequently
incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of this
License, each Contributor hereby grants to You a perpetual, worldwide,
non-exclusive, no-charge, royalty-free, irrevocable copyright license to
reproduce, prepare Derivative Works of, publicly display, publicly perform,
sublicense, and distribute the Work and such Derivative Works in Source or
Object form.

3. Grant of Patent License. Subject to the terms and conditions of this
License, each Contributor hereby grants to You a perpetual, worldwide,
non-exclusive, no-charge, royalty-free, irrevocable (except as stated in this
section) patent license to make, have made, use, offer to sell, sell, import,
and otherwise transfer the Work, where such license applies only to those
patent claims licensable by such Contributor that are necessarily infringed by
their Contribution(s) alone or by combination of their Contribution(s) with
the Work to which such Contribution(s) was submitted. If You institute patent
litigation against any entity (including a cross-claim or counterclaim in a
lawsuit) alleging that the Work or a Contribution incorporated within the Work
constitutes direct or contributory patent infringement, then any patent
licenses granted to You under this License for that Work shall terminate as of
the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the Work or
Derivative Works thereof in any medium, with or without modifications, and in
Source or Object form, provided that You meet the following conditions:

(a) You must give any other recipients of the Work or Derivative Works a copy
of this License; and

(b) You must cause any modified files to carry prominent notices stating that
You changed the files; and

(c) You must retain, in the Source form of any Derivative Works that You
distribute, all copyright, patent, trademark, and attribution notices from the
Source form of the Work, excluding those notices that do not pertain to any
part of the Derivative Works; and

(d) If the Work includes a "NOTICE" text file as part of its distribution,
then any Derivative Works that You distribute must include a readable copy of
the attribution notices contained within such NOTICE file, excluding those
notices that do not pertain to any part of the Derivative Works, in at least
one of the following places: within a NOTICE text file distributed as part of
the Derivative Works; within the Source form or documentation, if provided
along with the Derivative Works; or, within a display generated by the
Derivative Works, if and wherever such third-party notices normally appear.
The contents of the NOTICE file are for informational purposes only and do not
modify the License. You may add Your own attribution notices within Derivative
Works that You distribute, alongside or as an addendum to the NOTICE text from
the Work, provided that such additional attribution notices cannot be
construed as modifying the License.

You may add Your own copyright statement to Your modifications and may provide
additional or different license terms and conditions for use, reproduction, or
distribution of Your modifications, or for any such Derivative Works as a
whole, provided Your use, reproduction, and distribution of the Work otherwise
complies with the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise, any
Contribution intentionally submitted for inclusion in the Work by You to the
Licensor shall be under the terms and conditions of this License, without any
additional terms or conditions. Notwithstanding the above, nothing herein
shall supersede or modify the terms of any separate license agreement you may
have executed with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade names,
trademarks, service marks, or product names of the Licensor, except as required
for reasonable and customary use in describing the origin of the Work and
reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or agreed to in
writing, Licensor provides the Work (and each Contributor provides its
Contributions) on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either express or implied, including, without limitation, any warranties
or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
PARTICULAR PURPOSE. You are solely responsible for determining the
appropriateness of using or redistributing the Work and assume any risks
associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory, whether in
tort (including negligence), contract, or otherwise, unless required by
applicable law (such as deliberate and grossly negligent acts) or agreed to in
writing, shall any Contributor be liable to You for damages, including any
direct, indirect, special, incidental, or consequential damages of any
character arising as a result of this License or out of the use or inability to
use the Work (including but not limited to damages for loss of goodwill, work
stoppage, computer failure or malfunction, or any and all other commercial
damages or losses), even if such Contributor has been advised of the
possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing the Work
or Derivative Works thereof, You may choose to offer, and charge a fee for,
acceptance of support, warranty, indemnity, or other liability obligations
and/or rights consistent with this License. However, in accepting such
obligations, You may act only on Your own behalf and on Your sole
responsibility, not on behalf of any other Contributor, and only if You agree
to indemnify, defend, and hold each Contributor harmless for any liability
incurred by, or claims asserted against, such Contributor by reason of your
accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS`;

function fail(message) {
  throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return sha256(readFileSync(filePath));
}

function decodeXml(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(xml, name) {
  return decodeXml(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i").exec(xml)?.[1]);
}

function parsePomLicenses(xml) {
  const licensesBlock = /<licenses(?:\s[^>]*)?>([\s\S]*?)<\/licenses>/i.exec(xml)?.[1] || "";
  return [...licensesBlock.matchAll(/<license(?:\s[^>]*)?>([\s\S]*?)<\/license>/gi)]
    .map((match) => ({
      name: tag(match[1], "name") || "Unspecified license",
      url: tag(match[1], "url") || null,
      source: "Maven POM",
    }))
    .filter((license, index, all) =>
      all.findIndex((candidate) => candidate.name === license.name && candidate.url === license.url) === index,
    );
}

function parsePomParent(xml) {
  const parentBlock = /<parent(?:\s[^>]*)?>([\s\S]*?)<\/parent>/i.exec(xml)?.[1];
  if (!parentBlock) return null;
  const parent = {
    group: tag(parentBlock, "groupId"),
    name: tag(parentBlock, "artifactId"),
    version: tag(parentBlock, "version"),
  };
  if (
    !parent.group || !parent.name || !parent.version ||
    [parent.group, parent.name, parent.version].some((value) => /\$\{[^}]+\}/.test(value))
  ) {
    fail("Maven POM has an unresolved or incomplete parent coordinate.");
  }
  return parent;
}

function resolvePomLicenses(dependency, verifiedPomHashes) {
  const coordinate = `${dependency.group}:${dependency.name}:${dependency.version}`;
  if (!Array.isArray(dependency.pomChain) || !dependency.pomChain.length) {
    return { licenses: [], poms: [] };
  }
  const poms = [];
  const seen = new Set();
  let expectedCoordinate = coordinate;
  for (const pom of dependency.pomChain) {
    if (
      !pom ||
      typeof pom.coordinate !== "string" || pom.coordinate !== expectedCoordinate ||
      typeof pom.artifact !== "string" || !pom.artifact.endsWith(".pom") ||
      !/^[a-f0-9]{64}$/.test(pom.sha256 || "") ||
      typeof pom.text !== "string" || !pom.text.trim() ||
      sha256(Buffer.from(pom.text, "utf8")) !== pom.sha256 ||
      !verifiedPomHashes.has(`${pom.coordinate}|${pom.artifact}|${pom.sha256}`) ||
      seen.has(pom.coordinate)
    ) {
      fail(`Unverified, stale, or invalid Maven POM chain entry for ${coordinate}.`);
    }
    seen.add(pom.coordinate);
    poms.push({
      coordinate: pom.coordinate,
      artifact: pom.artifact,
      sha256: pom.sha256,
    });
    const declared = parsePomLicenses(pom.text).map((license) => ({
      ...license,
      source: `Gradle-verified Maven POM ${pom.coordinate}`,
    }));
    if (declared.length) {
      const inheritedBy = poms.slice(0, -1).map((entry) => entry.coordinate);
      return {
        licenses: declared.map((license) => ({
          ...license,
          source: inheritedBy.reduce(
            (source, child) => `${source}; inherited by ${child}`,
            license.source,
          ),
        })),
        poms,
      };
    }
    const parent = parsePomParent(pom.text);
    if (!parent) {
      expectedCoordinate = null;
      break;
    }
    expectedCoordinate = `${parent.group}:${parent.name}:${parent.version}`;
  }
  if (expectedCoordinate) {
    fail(`Gradle-verified Maven POM chain is incomplete for ${coordinate}; missing ${expectedCoordinate}.`);
  }
  return { licenses: [], poms };
}

function verifiedPomHashes() {
  const metadataPath = path.join(ROOT, "android", "gradle", "verification-metadata.xml");
  if (!existsSync(metadataPath)) {
    fail(`Gradle dependency verification metadata is missing: ${metadataPath}`);
  }
  const xml = readFileSync(metadataPath, "utf8");
  const hashes = new Set();
  for (const component of xml.matchAll(
    /<component\s+group="([^"]+)"\s+name="([^"]+)"\s+version="([^"]+)">([\s\S]*?)<\/component>/g,
  )) {
    const coordinate = `${component[1]}:${component[2]}:${component[3]}`;
    for (const artifact of component[4].matchAll(
      /<artifact\s+name="([^"]+\.pom)">([\s\S]*?)<\/artifact>/g,
    )) {
      for (const checksum of artifact[2].matchAll(/<sha256\s+value="([a-f0-9]{64})"/g)) {
        hashes.add(`${coordinate}|${artifact[1]}|${checksum[1]}`);
      }
    }
  }
  if (!hashes.size) {
    fail("Gradle verification metadata contains no trusted Maven POM SHA-256 values.");
  }
  return hashes;
}

const APACHE_2 = {
  spdx: "Apache-2.0",
  name: "Apache License 2.0",
  url: "https://www.apache.org/licenses/LICENSE-2.0",
  source: "canonical text for Maven-declared Apache-2.0",
  text: APACHE_2_TEXT,
};

function normalizeDeclaredLicense(license) {
  const identity = `${license.name || ""} ${license.url || ""}`.toLowerCase();
  if (/apache/.test(identity) && /(?:2\.0|license-2)/.test(identity)) {
    return { ...APACHE_2, source: license.source };
  }
  if (/(?:^|\s)mit(?:\s|$)/.test(identity) || /license\/mit/.test(identity)) {
    return {
      spdx: "MIT",
      name: "MIT License",
      url: license.url,
      source: license.source,
      requiresArtifactText: true,
    };
  }
  if (/bsd/.test(identity) && /(?:3|new|revised|bsd-license)/.test(identity)) {
    return {
      spdx: "BSD-3-Clause",
      name: "BSD 3-Clause License",
      url: license.url,
      source: license.source,
      requiresArtifactText: true,
    };
  }
  fail(`Unsupported URL-only or unknown Maven license: ${license.name}${license.url ? ` (${license.url})` : ""}.`);
}

function materializeLicenseText(license, dependency, bundled) {
  const embeddedLicense = bundled.find((notice) => /(?:^|\/)LICENSE/i.test(notice.path));
  if (embeddedLicense?.text.trim()) {
    if (/(?:the copyright holders|<year>|\[year\]|<copyright)/i.test(embeddedLicense.text)) {
      fail(
        `Artifact-bundled license contains an unresolved copyright placeholder for ${dependency.group}:${dependency.name}:${dependency.version}.`,
      );
    }
    return {
      ...license,
      source: `${license.source}; exact artifact text (${embeddedLicense.path})`,
      text: embeddedLicense.text.trim(),
    };
  }
  if (license.spdx === "Apache-2.0" && !license.requiresArtifactText) {
    return license;
  }
  fail(
    `No exact artifact-bundled license text was found for ${dependency.group}:${dependency.name}:${dependency.version} (${license.spdx || license.name}).`,
  );
}

function normalizeDependency(dependency, trustedPomHashes) {
  for (const key of ["group", "name", "version"]) {
    if (typeof dependency[key] !== "string" || !dependency[key].trim()) {
      fail(`Resolved Android dependency has no ${key}.`);
    }
  }
  if (!/^[a-f0-9]{64}$/.test(dependency.sha256 || "")) {
    fail(`Resolved Android dependency has an invalid artifact hash: ${dependency.group}:${dependency.name}`);
  }
  if (
    typeof dependency.artifact !== "string" || !dependency.artifact ||
    typeof dependency.artifactId !== "string" || !dependency.artifactId ||
    typeof dependency.variant !== "string" || !dependency.variant
  ) {
    fail(`Resolved Android dependency is missing exact artifact/variant identity: ${dependency.group}:${dependency.name}`);
  }
  const coordinate = `${dependency.group}:${dependency.name}:${dependency.version}`;
  const pomState = resolvePomLicenses(dependency, trustedPomHashes);
  const declaredLicenses = pomState.licenses;
  const bundled = Array.isArray(dependency.bundledNotices)
    ? dependency.bundledNotices.filter((notice) =>
        notice && typeof notice.path === "string" && typeof notice.text === "string",
      )
    : [];
  let licenses = declaredLicenses.map(normalizeDeclaredLicense);
  if (!licenses.length) {
    const embeddedLicense = bundled.find((notice) => /(?:^|\/)LICENSE/i.test(notice.path));
    if (embeddedLicense) {
      licenses = [{
        spdx: null,
        name: `Bundled license (${embeddedLicense.path})`,
        url: null,
        source: "artifact",
        text: embeddedLicense.text,
      }];
    }
  }
  if (!licenses.length) {
    fail(`No license metadata or bundled license was found for ${coordinate}.`);
  }
  licenses = licenses.map((license) =>
    materializeLicenseText(license, dependency, bundled),
  );
  const identity = `${coordinate}|${dependency.artifactId}|${dependency.variant}|${dependency.sha256}`;
  return {
    identity,
    coordinate,
    group: dependency.group,
    name: dependency.name,
    version: dependency.version,
    artifact: dependency.artifact || null,
    artifactId: dependency.artifactId,
    variant: dependency.variant,
    variantAttributes: dependency.variantAttributes || {},
    artifactSha256: dependency.sha256,
    pomSha256: pomState.poms[0]?.sha256 || null,
    pomChain: pomState.poms,
    licenses: licenses.map((license) => ({
      ...license,
      textSha256: sha256(license.text),
    })),
    bundledNotices: bundled.map((notice) => ({
      path: notice.path,
      sha256: notice.sha256 || sha256(notice.text),
    })),
    bundledNoticeText: bundled,
  };
}

function main() {
  const reportPath = path.join(ROOT, "android", "app", "build", "reports", "release-runtime-artifacts.json");
  if (!existsSync(reportPath)) fail(`Gradle release runtime inventory is missing: ${reportPath}`);
  const raw = readFileSync(reportPath);
  const report = JSON.parse(raw.toString("utf8"));
  if (
    report.schema !== 2 ||
    report.configuration !== "releaseRuntimeClasspath" ||
    !Array.isArray(report.dependencies) ||
    !report.dependencies.length
  ) {
    fail("Gradle release runtime inventory is empty or invalid.");
  }
  const trustedPomHashes = verifiedPomHashes();
  const dependencies = report.dependencies
    .map((dependency) => normalizeDependency(dependency, trustedPomHashes))
    .sort((left, right) => left.identity.localeCompare(right.identity));
  const uniqueIdentities = new Set(dependencies.map((dependency) => dependency.identity));
  if (uniqueIdentities.size !== dependencies.length) {
    fail("Gradle release runtime inventory contains duplicate artifact identities.");
  }
  const reportSha256 = sha256(raw);
  const inventoryPath = path.join(
    ROOT,
    "android",
    "app",
    "build",
    "reports",
    "release-runtime-notice-inventory.json",
  );
  const noticePath = path.join(
    ROOT,
    "android",
    "app",
    "build",
    "reports",
    "release-runtime-third-party-notices.txt",
  );
  const inventory = {
    schema: 1,
    configuration: report.configuration,
    rawInventorySha256: reportSha256,
    dependencyCount: dependencies.length,
    dependencies: dependencies.map(({ bundledNoticeText, ...dependency }) => ({
      ...dependency,
      licenses: dependency.licenses.map(({ text, ...license }) => license),
    })),
  };
  const lines = [
    "GLOAMCORE - ANDROID NATIVE THIRD-PARTY NOTICES",
    "",
    "This inventory is generated from the resolved Gradle releaseRuntimeClasspath.",
    "JavaScript/Capacitor package licenses remain in THIRD_PARTY_NOTICES.txt.",
    `Dependency count: ${dependencies.length}`,
    `Resolved inventory SHA-256: ${reportSha256}`,
    "",
  ];
  const seenNoticeHashes = new Set();
  const licenseTexts = new Map();
  for (const dependency of dependencies) {
    lines.push(dependency.coordinate);
    lines.push(`  Audit identity: ${dependency.identity}`);
    lines.push(`  Artifact: ${dependency.artifact}`);
    lines.push(`  Artifact identity: ${dependency.artifactId}`);
    lines.push(`  Selected variant: ${dependency.variant}`);
    lines.push(`  Artifact SHA-256: ${dependency.artifactSha256}`);
    for (const license of dependency.licenses) {
      lines.push(`  License: ${license.spdx || license.name}${license.url ? ` - ${license.url}` : ""}`);
      lines.push(`  License metadata: ${license.source}`);
      licenseTexts.set(license.textSha256, {
        name: license.spdx || license.name,
        text: license.text,
      });
    }
    lines.push("");
    for (const notice of dependency.bundledNoticeText) {
      const noticeHash = notice.sha256 || sha256(notice.text);
      if (seenNoticeHashes.has(noticeHash)) continue;
      seenNoticeHashes.add(noticeHash);
      lines.push(`----- ${dependency.coordinate} / ${notice.path} -----`);
      lines.push(notice.text.replace(/\0/g, "").trim());
      lines.push("");
    }
  }
  lines.push("===== FULL LICENSE TEXTS =====", "");
  for (const [licenseHash, license] of [...licenseTexts].sort((left, right) =>
    left[1].name.localeCompare(right[1].name),
  )) {
    lines.push(`----- ${license.name} / SHA-256 ${licenseHash} -----`);
    lines.push(license.text.trim());
    lines.push("");
  }
  mkdirSync(path.dirname(inventoryPath), { recursive: true });
  writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
  writeFileSync(noticePath, `${lines.join("\n").trim()}\n`, "utf8");
  if (statSync(noticePath).size < 1024) {
    fail("Generated Android native third-party notice is unexpectedly incomplete.");
  }
  process.stdout.write(
    `Generated Android native notices for ${dependencies.length} Maven dependencies.\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `Android native notice generation failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
