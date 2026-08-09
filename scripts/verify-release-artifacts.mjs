import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const PROVENANCE_SCHEMA = 1;
const HASH_CHUNK_SIZE = 1024 * 1024;
const MTIME_TOLERANCE_MS = 2_000;
const PRODUCTION_DEPENDENCY_SCHEMA = 1;

const FORBIDDEN_APP_CONTENT = [
  { label: "uiohook", pattern: /uiohook(?:-napi)?/i },
  { label: "automated Trade service", pattern: /trade-service/i },
  {
    label: "unregistered direct Currency Exchange client",
    pattern: /web\.poecdn\.com\/api\/currency-exchange/i,
  },
  { label: "legacy Faustus proxy", pattern: /\/faustus-api/i },
  { label: "legacy Trade IPC", pattern: /price-check:search-trade/i },
  { label: "legacy Faustus client", pattern: /getFaustusOverview/i },
];

const PATH_SCOPED_TRADE_CONTENT = [
  { label: "official Trade search outside the vetted client", pattern: /\/api\/trade\/search/i },
  { label: "official Trade fetch outside the vetted client", pattern: /\/api\/trade\/fetch/i },
  { label: "official Trade exchange outside the vetted client", pattern: /\/api\/trade\/exchange/i },
];
const VETTED_OFFICIAL_TRADE_CLIENT = "electron/official-trade-listings.cjs";

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) fail(`Unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (value == null || value.startsWith("--")) {
      fail(`Missing value for ${key}.`);
    }
    values[key.slice(2)] = value;
    index += 1;
  }
  return values;
}

function requireFile(filePath, label) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    fail(`${label} is missing: ${filePath}`);
  }
  return filePath;
}

function requireDirectory(directoryPath, label) {
  if (!existsSync(directoryPath) || !statSync(directoryPath).isDirectory()) {
    fail(`${label} is missing: ${directoryPath}`);
  }
  return directoryPath;
}

function normalizeRelative(filePath) {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function readPackage(root) {
  const packagePath = requireFile(path.join(root, "package.json"), "package.json");
  return JSON.parse(readFileSync(packagePath, "utf8"));
}

function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function sha256File(filePath) {
  const hash = createHash("sha256");
  const descriptor = openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_SIZE);
  try {
    while (true) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (!count) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

function sha512FileBase64(filePath) {
  const hash = createHash("sha512");
  const descriptor = openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_SIZE);
  try {
    while (true) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (!count) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("base64");
}

function walkFiles(directoryPath) {
  if (!existsSync(directoryPath)) return [];
  const found = [];
  const visit = (currentPath) => {
    for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile()) found.push(entryPath);
    }
  };
  visit(directoryPath);
  return found;
}

function hashFiles(root, relativePaths) {
  const normalized = [...new Set(relativePaths.map(normalizeRelative))].sort();
  if (!normalized.length) fail("Release source fingerprint contains no files.");
  const aggregate = createHash("sha256");
  let newestMtimeMs = 0;
  for (const relativePath of normalized) {
    const filePath = requireFile(
      path.join(root, ...relativePath.split("/")),
      `Release source file ${relativePath}`,
    );
    const stats = statSync(filePath);
    newestMtimeMs = Math.max(newestMtimeMs, stats.mtimeMs);
    aggregate.update(relativePath, "utf8");
    aggregate.update("\0", "utf8");
    aggregate.update(sha256File(filePath), "ascii");
    aggregate.update("\0", "utf8");
  }
  return {
    sha256: aggregate.digest("hex"),
    count: normalized.length,
    newestMtimeMs,
    paths: normalized,
  };
}

function git(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    const detail = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
    fail(`git ${args.join(" ")} failed${detail ? `: ${detail}` : "."}`);
  }
  return result.stdout;
}

function relevantMobileSource(relativePath) {
  const value = normalizeRelative(relativePath);
  if (
    value.startsWith("android/app/build/") ||
    value.startsWith("android/build/") ||
    value.startsWith("android/.gradle/") ||
    value === "android/local.properties"
  ) {
    return false;
  }
  if (value.startsWith("src/") || value.startsWith("public/")) return true;
  if (value.startsWith("android/")) return true;
  if (
    value === "package.json" ||
    value === "pnpm-lock.yaml" ||
    value === "index.html" ||
    value === "vite.config.ts" ||
    value === "build/electron-runtime-sha256.json" ||
    value === "build/production-dependency-sha256.json" ||
    value === "build/release-toolchain.json" ||
    value === "scripts/build-mobile.ps1" ||
    value === "scripts/assert-release-toolchain.ps1" ||
    value === "scripts/resolve-release-toolchain.ps1" ||
    value === "scripts/android-release-inventory.init.gradle" ||
    value === "scripts/generate-android-native-notices.mjs" ||
    value === "scripts/verify-release-artifacts.mjs"
  ) {
    return true;
  }
  return /^(?:capacitor\.config\.|tsconfig[^/]*\.json$)/.test(value);
}

function mobileSourceFingerprint(root) {
  const output = git(root, [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ]);
  const relativePaths = output
    .split("\0")
    .filter(Boolean)
    .map(normalizeRelative)
    .filter(relevantMobileSource);
  return hashFiles(root, relativePaths);
}

function distFingerprint(root) {
  const distRoot = requireDirectory(path.join(root, "dist"), "Final web build");
  const relativePaths = walkFiles(distRoot).map((filePath) =>
    normalizeRelative(path.relative(root, filePath)),
  );
  return hashFiles(root, relativePaths);
}

function electronRuntimeFingerprint(root) {
  const electronRoot = requireDirectory(
    path.join(root, "node_modules", "electron", "dist"),
    "Installed Electron runtime",
  );
  const relativePaths = walkFiles(electronRoot).map((filePath) =>
    normalizeRelative(path.relative(root, filePath)),
  );
  return hashFiles(root, relativePaths);
}

function verifyElectronRuntime(root) {
  const electronPackage = JSON.parse(
    readFileSync(
      requireFile(
        path.join(root, "node_modules", "electron", "package.json"),
        "Installed Electron package",
      ),
      "utf8",
    ),
  );
  const pinPath = requireFile(
    path.join(root, "build", "electron-runtime-sha256.json"),
    "Pinned Electron runtime fingerprint",
  );
  const pin = JSON.parse(readFileSync(pinPath, "utf8"));
  const actual = electronRuntimeFingerprint(root);
  if (
    pin.schema !== 1 ||
    pin.platform !== "win32-x64" ||
    pin.electronVersion !== electronPackage.version ||
    pin.fileCount !== actual.count ||
    pin.sha256 !== actual.sha256
  ) {
    fail("Installed Electron runtime does not match its audited win32-x64 fingerprint.");
  }
  return { ...actual, version: electronPackage.version };
}

function dependencyIdentity(name, version) {
  return `${name}\0${version}`;
}

function packageableProductionFile(packageName, relativePath) {
  if (/\.d\.ts$/i.test(relativePath)) return false;
  if (
    /\.md$/i.test(relativePath) &&
    !/^(?:licen[cs]e|notice|security)(?:[-._].*)?\.md$/i.test(path.basename(relativePath))
  ) {
    return false;
  }
  if (relativePath === "binding.gyp") return false;
  if (
    packageName === "electron-overlay-window" &&
    relativePath.startsWith("prebuilds/") &&
    !/^prebuilds\/win32-x64\/[^/]+\.node$/i.test(relativePath)
  ) {
    return false;
  }
  return true;
}

function summarizeProductionPackages(packages) {
  const aggregate = createHash("sha256");
  let fileCount = 0;
  for (const dependency of packages) {
    aggregate.update(dependency.name, "utf8");
    aggregate.update("\0", "utf8");
    aggregate.update(dependency.version, "utf8");
    aggregate.update("\0", "utf8");
    aggregate.update(dependency.resolved || "", "utf8");
    aggregate.update("\0", "utf8");
    aggregate.update(dependency.packaged ? "packaged" : "not-packaged", "ascii");
    aggregate.update("\0", "utf8");
    for (const file of dependency.files) {
      fileCount += 1;
      aggregate.update(file.path, "utf8");
      aggregate.update("\0", "utf8");
      aggregate.update(String(file.size), "ascii");
      aggregate.update("\0", "utf8");
      aggregate.update(file.sha256, "ascii");
      aggregate.update("\0", "utf8");
    }
  }
  return {
    packageCount: packages.length,
    fileCount,
    sha256: aggregate.digest("hex"),
  };
}

function walkProductionPackageFiles(packageRoot) {
  const files = [];
  const visit = (currentPath, relativeRoot = "") => {
    for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
      if (!relativeRoot && entry.name === "node_modules" && entry.isDirectory()) {
        continue;
      }
      const entryPath = path.join(currentPath, entry.name);
      const relativePath = normalizeRelative(path.join(relativeRoot, entry.name));
      if (entry.isSymbolicLink()) {
        fail(`Production package contains an unaudited symbolic link: ${entryPath}`);
      }
      if (entry.isDirectory()) {
        visit(entryPath, relativePath);
      } else if (entry.isFile()) {
        const stats = statSync(entryPath);
        files.push({
          path: relativePath,
          size: stats.size,
          sha256: sha256File(entryPath),
        });
      } else {
        fail(`Production package contains an unsupported filesystem entry: ${entryPath}`);
      }
    }
  };
  visit(packageRoot);
  files.sort((left, right) => left.path.localeCompare(right.path, "en"));
  if (!files.some((entry) => entry.path === "package.json")) {
    fail(`Production package has no package.json: ${packageRoot}`);
  }
  return files;
}

function readProductionDependencyGraph(graphPath) {
  const parsed = JSON.parse(
    readFileSync(requireFile(graphPath, "pnpm production dependency graph"), "utf8"),
  );
  const projects = Array.isArray(parsed) ? parsed : [parsed];
  if (projects.length !== 1 || !projects[0] || typeof projects[0] !== "object") {
    fail("pnpm production dependency graph must contain exactly one project.");
  }
  return projects[0];
}

function productionDependencyState(root, graphPath) {
  const project = readProductionDependencyGraph(graphPath);
  if (path.resolve(String(project.path || "")) !== path.resolve(root)) {
    fail("pnpm production dependency graph belongs to the wrong project root.");
  }
  const nodeModulesRoot = realpathSync(
    requireDirectory(path.resolve(root, "node_modules"), "Installed node_modules"),
  );
  const contexts = new Map();
  const visitDependencies = (dependencies) => {
    if (!dependencies || typeof dependencies !== "object") return;
    for (const dependency of Object.values(dependencies)) {
      if (!dependency || typeof dependency !== "object") {
        fail("pnpm production dependency graph contains an invalid dependency.");
      }
      const packageRoot = realpathSync(
        requireDirectory(
          path.resolve(String(dependency.path || "")),
          "Production dependency package directory",
        ),
      );
      if (
        packageRoot === nodeModulesRoot ||
        !packageRoot.startsWith(`${nodeModulesRoot}${path.sep}`)
      ) {
        fail(`Production dependency resolves outside node_modules: ${packageRoot}`);
      }
      const metadataPath = requireFile(
        path.join(packageRoot, "package.json"),
        "Production dependency package.json",
      );
      const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
      if (
        typeof metadata.name !== "string" ||
        typeof metadata.version !== "string" ||
        metadata.version !== dependency.version
      ) {
        fail(`Production dependency identity is invalid at ${packageRoot}.`);
      }
      const identity = dependencyIdentity(metadata.name, metadata.version);
      const existing = contexts.get(identity) || {
        name: metadata.name,
        version: metadata.version,
        resolved: new Set(),
        roots: new Set(),
        packaged: false,
      };
      if (dependency.resolved) existing.resolved.add(String(dependency.resolved));
      existing.roots.add(packageRoot);
      contexts.set(identity, existing);
      visitDependencies(dependency.dependencies);
    }
  };
  visitDependencies(project.dependencies);
  if (!contexts.size) fail("pnpm production dependency graph contains no dependencies.");

  const identityByRoot = new Map();
  for (const [identity, value] of contexts) {
    for (const packageRoot of value.roots) identityByRoot.set(packageRoot, identity);
  }
  const resolveInstalledDependency = (ownerRoot, dependencyName, optional) => {
    let current = ownerRoot;
    let dependencyRoot = null;
    while (current.startsWith(root)) {
      const candidate = path.join(current, "node_modules", ...dependencyName.split("/"));
      if (existsSync(candidate)) {
        dependencyRoot = candidate;
        break;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    if (!dependencyRoot) {
      if (optional) return null;
      fail(`Installed production package is missing dependency ${dependencyName} under ${ownerRoot}.`);
    }
    const resolvedRoot = realpathSync(dependencyRoot);
    const identity = identityByRoot.get(resolvedRoot);
    if (!identity) {
      fail(`Installed production dependency ${dependencyName} is absent from the pnpm graph.`);
    }
    return identity;
  };
  const edges = new Map();
  for (const [identity, value] of contexts) {
    const children = new Set();
    for (const packageRoot of value.roots) {
      const metadata = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
      for (const dependencyName of Object.keys(metadata.dependencies || {})) {
        children.add(resolveInstalledDependency(packageRoot, dependencyName, false));
      }
      for (const dependencyName of Object.keys(metadata.optionalDependencies || {})) {
        const child = resolveInstalledDependency(packageRoot, dependencyName, true);
        if (child) children.add(child);
      }
    }
    edges.set(identity, children);
  }
  const packagedQueue = [];
  for (const dependencyName of Object.keys(readPackage(root).dependencies || {})) {
    const identity = resolveInstalledDependency(root, dependencyName, false);
    packagedQueue.push(identity);
  }
  const packagedIdentities = new Set();
  while (packagedQueue.length) {
    const identity = packagedQueue.shift();
    if (!identity || packagedIdentities.has(identity)) continue;
    packagedIdentities.add(identity);
    for (const child of edges.get(identity) || []) packagedQueue.push(child);
  }
  for (const [identity, value] of contexts) {
    value.packaged = packagedIdentities.has(identity);
  }

  const packages = [];
  for (const value of contexts.values()) {
    const roots = [...value.roots].sort();
    const referenceFiles = walkProductionPackageFiles(roots[0]);
    const referenceJson = JSON.stringify(referenceFiles);
    for (const packageRoot of roots.slice(1)) {
      if (JSON.stringify(walkProductionPackageFiles(packageRoot)) !== referenceJson) {
        fail(`Production dependency ${value.name}@${value.version} differs across pnpm contexts.`);
      }
    }
    const resolved = [...value.resolved].sort();
    if (resolved.length > 1) {
      fail(`Production dependency ${value.name}@${value.version} has conflicting resolved sources.`);
    }
    packages.push({
      name: value.name,
      version: value.version,
      resolved: resolved[0] || null,
      packaged: value.packaged,
      files: referenceFiles,
    });
  }
  packages.sort((left, right) =>
    dependencyIdentity(left.name, left.version).localeCompare(
      dependencyIdentity(right.name, right.version),
      "en",
    ),
  );
  const summary = summarizeProductionPackages(packages);
  return {
    schema: PRODUCTION_DEPENDENCY_SCHEMA,
    packageManager: readPackage(root).packageManager,
    platform: "win32-x64",
    ...summary,
    packages,
  };
}

function readProductionDependencyManifest(root) {
  const manifestPath = requireFile(
    path.join(root, "build", "production-dependency-sha256.json"),
    "Pinned production dependency inventory",
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    manifest.schema !== PRODUCTION_DEPENDENCY_SCHEMA ||
    manifest.platform !== "win32-x64" ||
    manifest.packageManager !== readPackage(root).packageManager ||
    !Array.isArray(manifest.packages)
  ) {
    fail("Pinned production dependency inventory metadata is invalid.");
  }
  const packageIdentities = new Set();
  for (const dependency of manifest.packages) {
    if (
      !dependency ||
      typeof dependency.name !== "string" ||
      typeof dependency.version !== "string" ||
      typeof dependency.packaged !== "boolean" ||
      !Array.isArray(dependency.files)
    ) {
      fail("Pinned production dependency inventory contains invalid package data.");
    }
    const identity = dependencyIdentity(dependency.name, dependency.version);
    if (packageIdentities.has(identity)) {
      fail(`Pinned production dependency inventory repeats ${dependency.name}@${dependency.version}.`);
    }
    packageIdentities.add(identity);
    const filePaths = new Set();
    for (const file of dependency.files) {
      if (
        !file ||
        typeof file.path !== "string" ||
        file.path !== normalizeRelative(file.path) ||
        path.isAbsolute(file.path) ||
        file.path.split("/").includes("..") ||
        !Number.isSafeInteger(file.size) ||
        file.size < 0 ||
        !/^[0-9a-f]{64}$/.test(file.sha256) ||
        filePaths.has(file.path)
      ) {
        fail(`Pinned production dependency inventory has an invalid file for ${dependency.name}@${dependency.version}.`);
      }
      filePaths.add(file.path);
    }
  }
  const summary = summarizeProductionPackages(manifest.packages);
  if (
    manifest.packageCount !== summary.packageCount ||
    manifest.fileCount !== summary.fileCount ||
    manifest.sha256 !== summary.sha256
  ) {
    fail("Pinned production dependency inventory counts or aggregate hash are invalid.");
  }
  return manifest;
}

function verifyProductionDependencies(root, graphPath) {
  const expected = readProductionDependencyManifest(root);
  const actual = productionDependencyState(root, graphPath);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail("Installed production dependencies do not match the audited exact file inventory.");
  }
  return actual;
}

function writeProductionDependencyManifest(root, graphPath) {
  const state = productionDependencyState(root, graphPath);
  const outputPath = path.join(root, "build", "production-dependency-sha256.json");
  writeFileSync(outputPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return state;
}

function sha256FileRange(filePath, offset, size) {
  const hash = createHash("sha256");
  const descriptor = openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_SIZE);
  let remaining = size;
  let position = offset;
  try {
    while (remaining > 0) {
      const requested = Math.min(buffer.length, remaining);
      const count = readSync(descriptor, buffer, 0, requested, position);
      if (!count) fail(`PE section is truncated: ${filePath}`);
      hash.update(buffer.subarray(0, count));
      remaining -= count;
      position += count;
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

function peCodeIdentity(filePath) {
  const header = Buffer.alloc(256 * 1024);
  const descriptor = openSync(filePath, "r");
  let count;
  try {
    count = readSync(descriptor, header, 0, header.length, 0);
  } finally {
    closeSync(descriptor);
  }
  const data = header.subarray(0, count);
  if (data.length < 512 || data.readUInt16LE(0) !== 0x5a4d) {
    fail(`Executable has an invalid DOS/PE header: ${filePath}`);
  }
  const peOffset = data.readUInt32LE(0x3c);
  if (peOffset + 24 > data.length || data.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") {
    fail(`Executable has an invalid PE signature: ${filePath}`);
  }
  const machine = data.readUInt16LE(peOffset + 4);
  const sectionCount = data.readUInt16LE(peOffset + 6);
  const optionalSize = data.readUInt16LE(peOffset + 20);
  const optionalOffset = peOffset + 24;
  const sectionOffset = optionalOffset + optionalSize;
  if (
    machine !== 0x8664 ||
    data.readUInt16LE(optionalOffset) !== 0x20b ||
    optionalSize < 240 ||
    sectionCount < 1 || sectionCount > 96 ||
    sectionOffset + sectionCount * 40 > data.length
  ) {
    fail(`Executable is not a valid x64 PE image: ${filePath}`);
  }
  const sectionAlignment = data.readUInt32LE(optionalOffset + 32);
  const fileAlignment = data.readUInt32LE(optionalOffset + 36);
  if (!sectionAlignment || !fileAlignment) fail(`Executable has invalid PE alignment: ${filePath}`);
  const normalizedOptional = Buffer.from(
    data.subarray(optionalOffset, optionalOffset + optionalSize),
  );
  // rcedit changes only the resource payload/size. Normalize the derived image
  // size/checksum and the resource/base-relocation directory fields; all other
  // optional-header bytes remain pinned to Electron.
  normalizedOptional.fill(0, 56, 60);
  normalizedOptional.fill(0, 64, 68);
  normalizedOptional.fill(0, 112 + 2 * 8 + 4, 112 + 2 * 8 + 8);
  normalizedOptional.fill(0, 112 + 5 * 8, 112 + 5 * 8 + 4);
  const sections = {};
  let resourceSection = null;
  let relocationSection = null;
  for (let index = 0; index < sectionCount; index += 1) {
    const offset = sectionOffset + index * 40;
    const name = data
      .subarray(offset, offset + 8)
      .toString("ascii")
      .replace(/\0.*$/, "");
    const virtualSize = data.readUInt32LE(offset + 8);
    const virtualAddress = data.readUInt32LE(offset + 12);
    const rawSize = data.readUInt32LE(offset + 16);
    const rawOffset = data.readUInt32LE(offset + 20);
    const characteristics = data.readUInt32LE(offset + 36);
    if (sections[name]) fail(`Executable contains duplicate PE section ${name}.`);
    if (name === ".rsrc") {
      resourceSection = { virtualSize, virtualAddress, rawSize, rawOffset };
      sections[name] = {
        virtualAddress,
        rawOffset,
        characteristics,
      };
    } else if (name === ".reloc") {
      relocationSection = { virtualAddress, rawOffset };
      sections[name] = {
        virtualSize,
        rawSize,
        characteristics,
        sha256: rawSize ? sha256FileRange(filePath, rawOffset, rawSize) : null,
      };
    } else {
      sections[name] = {
        virtualSize,
        virtualAddress,
        rawSize,
        rawOffset,
        characteristics,
        sha256: rawSize ? sha256FileRange(filePath, rawOffset, rawSize) : null,
      };
    }
  }
  if (!resourceSection || !relocationSection) {
    fail(`Executable is missing its resource or relocation section: ${filePath}`);
  }
  const alignUp = (value, alignment) => Math.ceil(value / alignment) * alignment;
  sections[".reloc"].virtualGapAfterResource =
    relocationSection.virtualAddress -
    alignUp(resourceSection.virtualAddress + resourceSection.virtualSize, sectionAlignment);
  sections[".reloc"].rawGapAfterResource =
    relocationSection.rawOffset -
    alignUp(resourceSection.rawOffset + resourceSection.rawSize, fileAlignment);
  return {
    machine,
    peOffset,
    coffAndDosSha256: sha256Buffer(data.subarray(0, optionalOffset)),
    normalizedOptionalSha256: sha256Buffer(normalizedOptional),
    sections,
  };
}

function assertElectronRuntimePackaged(root, unpackedRoot) {
  verifyElectronRuntime(root);
  const sourceRoot = path.join(root, "node_modules", "electron", "dist");
  const expectedRuntimeFiles = [];
  for (const sourcePath of walkFiles(sourceRoot)) {
    const relativePath = normalizeRelative(path.relative(sourceRoot, sourcePath));
    if (relativePath === "electron.exe" || relativePath === "resources/default_app.asar") {
      continue;
    }
    const packagedRelative = relativePath === "LICENSE" ? "LICENSE.electron.txt" : relativePath;
    expectedRuntimeFiles.push(packagedRelative);
    const packagedPath = requireFile(
      path.join(unpackedRoot, ...packagedRelative.split("/")),
      `Packaged Electron runtime ${packagedRelative}`,
    );
    if (sha256File(sourcePath) !== sha256File(packagedPath)) {
      fail(`Packaged Electron runtime contains stale or changed ${packagedRelative}.`);
    }
  }
  expectedRuntimeFiles.push("PoE Economy Widget.exe");
  const actualRuntimeFiles = walkFiles(unpackedRoot)
    .map((filePath) => normalizeRelative(path.relative(unpackedRoot, filePath)))
    .filter((relativePath) => !relativePath.startsWith("resources/"))
    .sort();
  expectedRuntimeFiles.sort();
  if (canonicalJson(actualRuntimeFiles) !== canonicalJson(expectedRuntimeFiles)) {
    fail("Packaged Electron runtime root contains missing or unexpected files.");
  }
  const sourceIdentity = peCodeIdentity(path.join(sourceRoot, "electron.exe"));
  const packagedIdentity = peCodeIdentity(
    path.join(unpackedRoot, "PoE Economy Widget.exe"),
  );
  if (canonicalJson(sourceIdentity) !== canonicalJson(packagedIdentity)) {
    fail("Packaged app executable code sections do not derive from the pinned Electron runtime.");
  }
}

const PUBLIC_UPDATE_REPOSITORY = Object.freeze({
  provider: "github",
  owner: "seNkoKG",
  repo: "ninja-lens",
});

function githubUpdateConfiguration(packageJson) {
  const publish = Array.isArray(packageJson.build?.publish)
    ? packageJson.build.publish[0]
    : packageJson.build?.publish;
  if (
    !publish ||
    publish.provider !== PUBLIC_UPDATE_REPOSITORY.provider ||
    publish.owner !== PUBLIC_UPDATE_REPOSITORY.owner ||
    publish.repo !== PUBLIC_UPDATE_REPOSITORY.repo ||
    Object.hasOwn(publish, "token") ||
    Object.hasOwn(publish, "private")
  ) {
    fail(
      "Windows public GitHub update configuration is missing or unsafe in package.json.",
    );
  }
  return { ...PUBLIC_UPDATE_REPOSITORY };
}

function expectedAppUpdateYaml(packageJson) {
  const publish = githubUpdateConfiguration(packageJson);
  return [
    `owner: ${publish.owner}`,
    `repo: ${publish.repo}`,
    `provider: ${publish.provider}`,
    `updaterCacheDirName: ${packageJson.name}-updater`,
  ].join("\n");
}

function assertPublicUpdateConfig(updateConfig, packageJson) {
  const publish = githubUpdateConfiguration(packageJson);
  if (
    !updateConfig ||
    updateConfig.enabled !== true ||
    updateConfig.provider !== publish.provider ||
    updateConfig.owner !== publish.owner ||
    updateConfig.repo !== publish.repo ||
    Object.hasOwn(updateConfig, "token") ||
    Object.hasOwn(updateConfig, "private")
  ) {
    fail(
      "build/update-config.json must enable the token-free public GitHub release channel.",
    );
  }
}

function assertElectronBuilderResources(root, resources, packageJson) {
  const pin = JSON.parse(
    readFileSync(
      requireFile(
        path.join(root, "build", "electron-builder-resource-sha256.json"),
        "Pinned electron-builder resource fingerprint",
      ),
      "utf8",
    ),
  );
  const builderPackage = JSON.parse(
    readFileSync(
      requireFile(
        path.join(root, "node_modules", "electron-builder", "package.json"),
        "Installed electron-builder package",
      ),
      "utf8",
    ),
  );
  const elevatePath = requireFile(path.join(resources, "elevate.exe"), "Packaged elevate.exe");
  if (
    pin.schema !== 1 ||
    pin.electronBuilderVersion !== builderPackage.version ||
    pin.elevateExe?.size !== statSync(elevatePath).size ||
    pin.elevateExe?.sha256 !== sha256File(elevatePath)
  ) {
    fail("Packaged electron-builder elevate helper does not match its audited fingerprint.");
  }
  const sourceDefaultApp = requireFile(
    path.join(root, "node_modules", "electron", "dist", "resources", "default_app.asar"),
    "Pinned Electron default app",
  );
  const packagedDefaultApp = requireFile(
    path.join(resources, "default_app.asar"),
    "Packaged Electron default app",
  );
  if (sha256File(sourceDefaultApp) !== sha256File(packagedDefaultApp)) {
    fail("Packaged Electron default_app.asar does not match the pinned runtime.");
  }
  const expectedUpdate = expectedAppUpdateYaml(packageJson);
  const actualUpdate = readFileSync(
    requireFile(path.join(resources, "app-update.yml"), "Packaged app-update.yml"),
    "utf8",
  )
    .replaceAll("\r\n", "\n")
    .trim();
  if (actualUpdate !== expectedUpdate) {
    fail("Packaged app-update.yml does not match package.json publish settings.");
  }
}

function installedPackageCandidates(root, packageName, version) {
  const packageParts = packageName.split("/");
  const candidates = [
    path.join(root, "node_modules", ...packageParts),
    path.join(root, "node_modules", ".pnpm", "node_modules", ...packageParts),
  ];
  const virtualStore = path.join(root, "node_modules", ".pnpm");
  if (existsSync(virtualStore)) {
    for (const entry of readdirSync(virtualStore, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      candidates.push(
        path.join(virtualStore, entry.name, "node_modules", ...packageParts),
      );
    }
  }
  const found = [];
  for (const candidate of candidates) {
    const packagePath = path.join(candidate, "package.json");
    try {
      if (!existsSync(packagePath) || !statSync(packagePath).isFile()) continue;
      const metadata = JSON.parse(readFileSync(packagePath, "utf8"));
      if (metadata.name === packageName && metadata.version === version) {
        found.push(candidate);
      }
    } catch {
      // A broken/unreadable link cannot be trusted as release input.
    }
  }
  return [...new Set(found)];
}

const ELECTRON_BUILDER_IGNORED_PACKAGE_FIELDS = new Set([
  "dist",
  "gitHead",
  "build",
  "jspm",
  "ava",
  "xo",
  "nyc",
  "eslintConfig",
  "contributors",
  "bundleDependencies",
  "tags",
]);

function electronBuilderDependencyPackageJson(source) {
  const data = JSON.parse(source.toString("utf8"));
  const dependencies = data.dependencies;
  const removeBabel = dependencies != null &&
    typeof dependencies === "object" &&
    !Object.getOwnPropertyNames(dependencies).some((name) => name.startsWith("babel"));
  let changed = false;
  for (const property of Object.getOwnPropertyNames(data)) {
    if (
      property.startsWith("_") ||
      ELECTRON_BUILDER_IGNORED_PACKAGE_FIELDS.has(property) ||
      property === "scripts" ||
      property === "keywords" ||
      property === "bugs" ||
      (removeBabel && property === "babel")
    ) {
      delete data[property];
      changed = true;
    }
  }
  return changed ? Buffer.from(JSON.stringify(data, null, 2), "utf8") : source;
}

function expectedPackagedDependencyFile(sourcePath, packageRelativePath) {
  const source = readFileSync(sourcePath);
  return packageRelativePath === "package.json"
    ? electronBuilderDependencyPackageJson(source)
    : source;
}

function assertAsarNodeModulesMatch(asar, root) {
  const dependencyManifest = readProductionDependencyManifest(root);
  const auditedPackages = new Map(
    dependencyManifest.packages.map((dependency) => [
      dependencyIdentity(dependency.name, dependency.version),
      dependency,
    ]),
  );
  const packages = new Map();
  for (const [relativePath, entry] of asar.entries) {
    if (!relativePath.startsWith("node_modules/")) continue;
    if (entry.link) fail(`Packaged dependency is an unresolved ASAR link: ${relativePath}`);
    const match = /^node_modules\/((?:@[^/]+\/)?[^/]+)\/(.+)$/.exec(relativePath);
    if (!match || match[1] === ".pnpm" || match[1] === ".bin") {
      fail(`Packaged dependency has an unsupported path: ${relativePath}`);
    }
    const files = packages.get(match[1]) || [];
    files.push({ relativePath, packageRelativePath: match[2] });
    packages.set(match[1], files);
  }
  if (!packages.size) fail("Packaged ASAR contains no production dependencies.");
  const expectedPackagesByName = new Map();
  for (const dependency of dependencyManifest.packages.filter(
    (candidate) => candidate.packaged,
  )) {
    if (expectedPackagesByName.has(dependency.name)) {
      fail(`Audited Windows dependency closure contains multiple versions of ${dependency.name}.`);
    }
    expectedPackagesByName.set(dependency.name, dependency);
  }
  const expectedPackageNames = [...expectedPackagesByName.keys()].sort();
  const actualPackageNames = [...packages.keys()].sort();
  if (canonicalJson(actualPackageNames) !== canonicalJson(expectedPackageNames)) {
    fail("Packaged ASAR dependency package set does not match the audited runtime closure.");
  }
  for (const [packageName, files] of packages) {
    const packageEntry = files.find(
      ({ packageRelativePath }) => packageRelativePath === "package.json",
    );
    if (!packageEntry) fail(`Packaged dependency ${packageName} has no package.json.`);
    const packagedMetadata = JSON.parse(
      readAsarEntry(asar, packageEntry.relativePath).toString("utf8"),
    );
    if (packagedMetadata.name !== packageName || typeof packagedMetadata.version !== "string") {
      fail(`Packaged dependency identity is invalid for ${packageName}.`);
    }
    const auditedPackage = auditedPackages.get(
      dependencyIdentity(packageName, packagedMetadata.version),
    );
    if (!auditedPackage) {
      fail(`Packaged dependency is absent from the audited inventory: ${packageName}@${packagedMetadata.version}.`);
    }
    if (!auditedPackage.packaged) {
      fail(`Packaged dependency is excluded from the audited runtime closure: ${packageName}@${packagedMetadata.version}.`);
    }
    const auditedFiles = new Map(
      auditedPackage.files.map((file) => [file.path, file]),
    );
    const expectedFiles = auditedPackage.files
      .filter((file) => packageableProductionFile(packageName, file.path))
      .map((file) => file.path)
      .sort();
    const actualFiles = files
      .map(({ packageRelativePath }) => packageRelativePath)
      .sort();
    if (canonicalJson(actualFiles) !== canonicalJson(expectedFiles)) {
      fail(`Packaged dependency file set is incomplete or contains debris for ${packageName}@${packagedMetadata.version}.`);
    }
    for (const { relativePath, packageRelativePath } of files) {
      const auditedFile = auditedFiles.get(packageRelativePath);
      const packagedContents = readAsarEntry(asar, relativePath);
      if (
        !auditedFile ||
        (
          packageRelativePath !== "package.json" &&
          (
            auditedFile.size !== packagedContents.length ||
            auditedFile.sha256 !== sha256Buffer(packagedContents)
          )
        )
      ) {
        fail(`Packaged dependency file is absent from or changed against the audited inventory: ${relativePath}.`);
      }
    }
    const candidates = installedPackageCandidates(
      root,
      packageName,
      packagedMetadata.version,
    );
    const matches = candidates.some((candidate) =>
      files.every(({ relativePath, packageRelativePath }) => {
        const sourcePath = path.join(candidate, ...packageRelativePath.split("/"));
        const auditedFile = auditedFiles.get(packageRelativePath);
        if (!auditedFile) return false;
        let expectedPackaged;
        try {
          if (
            !existsSync(sourcePath) ||
            !statSync(sourcePath).isFile() ||
            statSync(sourcePath).size !== auditedFile.size ||
            sha256File(sourcePath) !== auditedFile.sha256
          ) {
            return false;
          }
          expectedPackaged = expectedPackagedDependencyFile(
            sourcePath,
            packageRelativePath,
          );
        } catch {
          return false;
        }
        return (
          expectedPackaged.length === Number(asar.entries.get(relativePath)?.size) &&
          sha256Buffer(expectedPackaged) === sha256Buffer(readAsarEntry(asar, relativePath))
        );
      }),
    );
    if (!matches) {
      fail(
        `Packaged dependency ${packageName}@${packagedMetadata.version} does not match forced-rematerialized node_modules.`,
      );
    }
  }
}

function getGitHead(root) {
  return git(root, ["rev-parse", "HEAD"]).trim();
}

function assertCleanGit(root) {
  const status = git(root, ["status", "--porcelain", "--untracked-files=all"]);
  if (status.trim()) {
    fail("The release worktree is not clean; commit the audited release before packaging.");
  }
}

function provenancePathForApk(apkPath) {
  return path.join(path.dirname(apkPath), "release-provenance.json");
}

function mobileAttestationPath(root) {
  return path.join(
    root,
    "android",
    "app",
    "src",
    "main",
    "assets",
    "public",
    "RELEASE_PROVENANCE.json",
  );
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function androidReleaseMetadata(root) {
  const buildGradlePath = requireFile(
    path.join(root, "android", "app", "build.gradle"),
    "Android app build.gradle",
  );
  const text = readFileSync(buildGradlePath, "utf8");
  const applicationId = /\bapplicationId\s+["']([^"']+)["']/.exec(text)?.[1];
  const versionName = /\bversionName\s+["']([^"']+)["']/.exec(text)?.[1];
  const versionCodeText = /\bversionCode\s+(\d+)/.exec(text)?.[1];
  const versionCode = Number(versionCodeText);
  if (
    !applicationId ||
    !versionName ||
    !Number.isSafeInteger(versionCode) ||
    versionCode < 1
  ) {
    fail("Android release applicationId/versionName/versionCode could not be parsed.");
  }
  return { applicationId, versionName, versionCode };
}

function androidReleasePolicy(root, version) {
  const policyPath = requireFile(
    path.join(root, "android", "release-version-policy.json"),
    "Android release version policy",
  );
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  const metadata = androidReleaseMetadata(root);
  if (
    policy.schema !== 1 ||
    policy.applicationId !== metadata.applicationId ||
    policy.versionName !== metadata.versionName ||
    policy.versionName !== version ||
    policy.versionCode !== metadata.versionCode ||
    !Number.isSafeInteger(policy.previousPublishedVersionCode) ||
    policy.previousPublishedVersionCode < 1 ||
    policy.versionCode <= policy.previousPublishedVersionCode
  ) {
    fail(
      "Android release policy must exactly match Gradle/package versions and monotonically increase versionCode.",
    );
  }
  return policy;
}

function expectedMobileAttestation(root, version) {
  const packageJson = readPackage(root);
  if (version !== packageJson.version) {
    fail(`Requested version ${version} does not match package.json ${packageJson.version}.`);
  }
  const policy = androidReleasePolicy(root, version);
  const source = mobileSourceFingerprint(root);
  const dist = distFingerprint(root);
  const nativeNotices = androidNativeNoticeState(root);
  const signerDigest = readFileSync(
    requireFile(
      path.join(root, "android", "release-signing-cert.sha256"),
      "Pinned Android release certificate digest",
    ),
    "utf8",
  )
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(signerDigest)) {
    fail("Pinned Android release certificate digest is invalid.");
  }
  return {
    schema: 1,
    platform: "android",
    applicationId: policy.applicationId,
    versionName: policy.versionName,
    versionCode: policy.versionCode,
    gitHead: getGitHead(root),
    sourceSha256: source.sha256,
    sourceFileCount: source.count,
    distSha256: dist.sha256,
    distFileCount: dist.count,
    nativeRuntimeInventorySha256: nativeNotices.rawSha256,
    nativeLicenseInventorySha256: nativeNotices.inventorySha256,
    nativeNoticeSha256: nativeNotices.noticeSha256,
    nativeDependencyCount: nativeNotices.dependencyCount,
    releaseSigningCertificateSha256: signerDigest,
  };
}

function prepareMobileAttestation({ root, version }) {
  assertCleanGit(root);
  const attestation = expectedMobileAttestation(root, version);
  const attestationPath = mobileAttestationPath(root);
  writeFileSync(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`, "utf8");
  process.stdout.write(`Prepared embedded Android release provenance: ${attestationPath}\n`);
}

function verifyMobileAttestation(root, version) {
  const expected = expectedMobileAttestation(root, version);
  const attestationPath = requireFile(
    mobileAttestationPath(root),
    "Embedded Android release provenance source",
  );
  const actual = JSON.parse(readFileSync(attestationPath, "utf8"));
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail("Embedded Android release provenance does not match current HEAD/source/dist/native inventory.");
  }
  return {
    path: attestationPath,
    sha256: sha256File(attestationPath),
  };
}

function androidNativeNoticeState(root) {
  const reports = path.join(root, "android", "app", "build", "reports");
  const rawPath = requireFile(
    path.join(reports, "release-runtime-artifacts.json"),
    "Raw Android Maven runtime inventory",
  );
  const inventoryPath = requireFile(
    path.join(reports, "release-runtime-notice-inventory.json"),
    "Android Maven license inventory",
  );
  const noticePath = requireFile(
    path.join(reports, "release-runtime-third-party-notices.txt"),
    "Android native third-party notices",
  );
  const raw = readFileSync(rawPath);
  const rawInventory = JSON.parse(raw.toString("utf8"));
  const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
  const notice = readFileSync(noticePath, "utf8");
  const verificationMetadata = readFileSync(
    requireFile(
      path.join(root, "android", "gradle", "verification-metadata.xml"),
      "Gradle dependency verification metadata",
    ),
    "utf8",
  );
  const trustedPomHashes = new Set();
  for (const component of verificationMetadata.matchAll(
    /<component\s+group="([^"]+)"\s+name="([^"]+)"\s+version="([^"]+)">([\s\S]*?)<\/component>/g,
  )) {
    const componentCoordinate = `${component[1]}:${component[2]}:${component[3]}`;
    for (const artifact of component[4].matchAll(
      /<artifact\s+name="([^"]+\.pom)">([\s\S]*?)<\/artifact>/g,
    )) {
      for (const checksum of artifact[2].matchAll(/<sha256\s+value="([a-f0-9]{64})"/g)) {
        trustedPomHashes.add(
          `${componentCoordinate}|${artifact[1]}|${checksum[1]}`,
        );
      }
    }
  }
  if (
    rawInventory.schema !== 2 ||
    rawInventory.configuration !== "releaseRuntimeClasspath" ||
    !Array.isArray(rawInventory.dependencies) ||
    rawInventory.dependencies.length < 1 ||
    inventory.schema !== 1 ||
    inventory.configuration !== "releaseRuntimeClasspath" ||
    !Array.isArray(inventory.dependencies) ||
    inventory.dependencies.length < 1 ||
    inventory.dependencyCount !== inventory.dependencies.length ||
    inventory.dependencyCount !== rawInventory.dependencies.length ||
    inventory.rawInventorySha256 !== sha256Buffer(raw)
  ) {
    fail("Android Maven license inventory is incomplete or does not match Gradle resolution.");
  }

  const rawByIdentity = new Map();
  for (const dependency of rawInventory.dependencies) {
    const coordinate = `${dependency.group || ""}:${dependency.name || ""}:${dependency.version || ""}`;
    if (
      !dependency.group || !dependency.name || !dependency.version ||
      typeof dependency.artifact !== "string" || !dependency.artifact ||
      typeof dependency.artifactId !== "string" || !dependency.artifactId ||
      typeof dependency.variant !== "string" || !dependency.variant ||
      !/^[a-f0-9]{64}$/.test(dependency.sha256 || "")
    ) {
      fail(`Raw Android release inventory has an unhashed or unidentified artifact: ${coordinate}.`);
    }
    if (!Array.isArray(dependency.pomChain) || !dependency.pomChain.length) {
      fail(`Raw Android release inventory has no Gradle-resolved POM chain for ${coordinate}.`);
    }
    const pomCoordinates = new Set();
    for (const pom of dependency.pomChain) {
      if (
        !pom || typeof pom.coordinate !== "string" || !pom.coordinate ||
        typeof pom.artifact !== "string" || !pom.artifact.endsWith(".pom") ||
        !/^[a-f0-9]{64}$/.test(pom.sha256 || "") ||
        typeof pom.text !== "string" || !pom.text.trim() ||
        sha256Buffer(Buffer.from(pom.text, "utf8")) !== pom.sha256 ||
        !trustedPomHashes.has(`${pom.coordinate}|${pom.artifact}|${pom.sha256}`) ||
        pomCoordinates.has(pom.coordinate)
      ) {
        fail(`Raw Android release inventory has an unverified POM chain entry for ${coordinate}.`);
      }
      pomCoordinates.add(pom.coordinate);
    }
    const identity = `${coordinate}|${dependency.artifactId}|${dependency.variant}|${dependency.sha256}`;
    if (rawByIdentity.has(identity)) {
      fail(`Raw Android release inventory contains duplicate artifact identity ${identity}.`);
    }
    rawByIdentity.set(identity, dependency);
  }
  const processedIdentities = new Set();
  for (const dependency of inventory.dependencies) {
    if (
      typeof dependency.identity !== "string" ||
      !dependency.identity ||
      typeof dependency.coordinate !== "string" ||
      !dependency.coordinate ||
      typeof dependency.artifact !== "string" ||
      !dependency.artifact ||
      typeof dependency.artifactId !== "string" ||
      !dependency.artifactId ||
      typeof dependency.variant !== "string" ||
      !dependency.variant ||
      !/^[a-f0-9]{64}$/.test(dependency.artifactSha256 || "") ||
      !Array.isArray(dependency.licenses) ||
      !dependency.licenses.length ||
      !dependency.licenses.every((license) => typeof license.name === "string" && license.name)
    ) {
      fail("Android Maven license inventory contains an unattributed dependency.");
    }
    const rawDependency = rawByIdentity.get(dependency.identity);
    if (
      !rawDependency ||
      dependency.coordinate !== `${rawDependency.group}:${rawDependency.name}:${rawDependency.version}` ||
      dependency.artifact !== rawDependency.artifact ||
      dependency.artifactId !== rawDependency.artifactId ||
      dependency.variant !== rawDependency.variant ||
      dependency.artifactSha256 !== rawDependency.sha256 ||
      dependency.pomSha256 !== rawDependency.pomChain[0].sha256 ||
      canonicalJson(dependency.pomChain) !== canonicalJson(
        rawDependency.pomChain.map(({ coordinate, artifact, sha256 }) => ({
          coordinate,
          artifact,
          sha256,
        })),
      ) ||
      processedIdentities.has(dependency.identity)
    ) {
      fail(`Processed Android notice inventory does not map one-to-one to ${dependency.identity}.`);
    }
    processedIdentities.add(dependency.identity);
    if (!notice.includes(dependency.identity)) {
      fail(`Android native notice omits audit identity ${dependency.identity}.`);
    }
  }
  if (
    processedIdentities.size !== rawByIdentity.size ||
    [...rawByIdentity.keys()].some((identity) => !processedIdentities.has(identity))
  ) {
    fail("Android native notice inventory omits or adds a resolved Gradle artifact.");
  }
  if (
    !notice.includes(`Dependency count: ${inventory.dependencyCount}`) ||
    !notice.includes(`Resolved inventory SHA-256: ${inventory.rawInventorySha256}`) ||
    Buffer.byteLength(notice) < 1024
  ) {
    fail("Android native third-party notice is incomplete or stale.");
  }
  return {
    rawPath,
    inventoryPath,
    noticePath,
    rawSha256: sha256Buffer(raw),
    inventorySha256: sha256File(inventoryPath),
    noticeSha256: sha256File(noticePath),
    dependencyCount: inventory.dependencyCount,
  };
}

function windowsArtifactPaths(root, version) {
  const deliverables = path.join(root, "deliverables");
  return {
    deliverables,
    setup: path.join(deliverables, `PoE-Economy-Widget-Setup-${version}-x64.exe`),
    blockmap: path.join(
      deliverables,
      `PoE-Economy-Widget-Setup-${version}-x64.exe.blockmap`,
    ),
    portable: path.join(deliverables, `PoE-Economy-Widget-Portable-${version}-x64.exe`),
    appAsar: path.join(deliverables, "win-unpacked", "resources", "app.asar"),
    helper: path.join(
      deliverables,
      "win-unpacked",
      "resources",
      "native-input",
      "NinjaLensInput.exe",
    ),
    pobHost: path.join(
      deliverables,
      "win-unpacked",
      "resources",
      "pob-engine",
      "NinjaLensPobHost-x64.exe",
    ),
    updateConfig: path.join(
      deliverables,
      "win-unpacked",
      "resources",
      "update-config.json",
    ),
    unpackedExe: path.join(deliverables, "win-unpacked", "PoE Economy Widget.exe"),
    latest: path.join(deliverables, "latest.yml"),
    manifest: path.join(deliverables, "windows-release-provenance.json"),
  };
}

function assertLatestYaml(latestPath, setupPath, version) {
  requireFile(latestPath, "Windows latest.yml");
  const text = readFileSync(latestPath, "utf8");
  const embeddedVersion = /^version:\s*['"]?([^'"\r\n]+)['"]?\s*$/m.exec(text)?.[1];
  const embeddedPath = /^path:\s*['"]?([^'"\r\n]+)['"]?\s*$/m.exec(text)?.[1];
  const url = /^\s*-\s+url:\s*['"]?([^'"\r\n]+)['"]?\s*$/m.exec(text)?.[1];
  const size = Number(/^\s+size:\s*(\d+)\s*$/m.exec(text)?.[1]);
  const hashes = [...text.matchAll(/^\s*sha512:\s*([^\s]+)\s*$/gm)].map((match) =>
    match[1].trim(),
  );
  const setupName = path.basename(setupPath);
  const setupStats = statSync(setupPath);
  const actualSha512 = sha512FileBase64(setupPath);
  if (
    embeddedVersion !== version ||
    embeddedPath !== setupName ||
    url !== setupName ||
    size !== setupStats.size ||
    hashes.length < 2 ||
    hashes.some((hash) => hash !== actualSha512)
  ) {
    fail("latest.yml does not match the current installer filename, version, size, and SHA-512.");
  }
  return { sha256: sha256File(latestPath), size: statSync(latestPath).size };
}

function collectWindowsProvenance(root, version) {
  const paths = windowsArtifactPaths(root, version);
  const records = {};
  for (const key of [
    "setup",
    "blockmap",
    "portable",
    "appAsar",
    "helper",
    "pobHost",
    "unpackedExe",
    "updateConfig",
  ]) {
    const filePath = requireFile(paths[key], `Windows release ${key}`);
    const stats = statSync(filePath);
    records[key] = {
      relativePath: normalizeRelative(path.relative(root, filePath)),
      sha256: sha256File(filePath),
      size: stats.size,
      modifiedAtUtc: stats.mtime.toISOString(),
    };
  }
  const latest = assertLatestYaml(paths.latest, paths.setup, version);
  records.latest = {
    relativePath: normalizeRelative(path.relative(root, paths.latest)),
    ...latest,
  };
  return { paths, records };
}

function recordWindows({ root, version, startedAt }) {
  const packageJson = readPackage(root);
  if (version !== packageJson.version) {
    fail(`Requested version ${version} does not match package.json ${packageJson.version}.`);
  }
  assertCleanGit(root);
  const startedAtMs = Date.parse(startedAt);
  if (!Number.isFinite(startedAtMs)) fail(`Invalid build start timestamp: ${startedAt}`);
  const { paths, records } = collectWindowsProvenance(root, version);
  for (const [key, record] of Object.entries(records)) {
    const filePath = path.join(root, ...record.relativePath.split("/"));
    if (key !== "updateConfig" && statSync(filePath).mtimeMs + MTIME_TOLERANCE_MS < startedAtMs) {
      fail(`Windows ${key} artifact predates this dist invocation.`);
    }
  }
  const manifest = {
    schema: PROVENANCE_SCHEMA,
    platform: "windows",
    version,
    gitHead: getGitHead(root),
    buildStartedAtUtc: new Date(startedAtMs).toISOString(),
    recordedAtUtc: new Date().toISOString(),
    files: records,
  };
  writeFileSync(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`Recorded Windows release provenance: ${paths.manifest}\n`);
}

function verifyWindowsProvenance(root, version) {
  const { paths, records } = collectWindowsProvenance(root, version);
  const manifestPath = requireFile(paths.manifest, "Windows release provenance");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    manifest.schema !== PROVENANCE_SCHEMA ||
    manifest.platform !== "windows" ||
    manifest.version !== version
  ) {
    fail("Windows release provenance has an unsupported schema, platform, or version.");
  }
  const head = getGitHead(root);
  if (manifest.gitHead !== head) {
    fail(
      `Windows artifacts were built from commit ${manifest.gitHead}, not current HEAD ${head}. Rebuild after the final commit.`,
    );
  }
  const expectedKeys = Object.keys(records).sort();
  const recordedKeys = Object.keys(manifest.files || {}).sort();
  if (JSON.stringify(expectedKeys) !== JSON.stringify(recordedKeys)) {
    fail("Windows release provenance file set does not match current dist artifacts.");
  }
  for (const key of expectedKeys) {
    const expected = records[key];
    const recorded = manifest.files[key];
    if (
      recorded.relativePath !== expected.relativePath ||
      recorded.sha256 !== expected.sha256 ||
      recorded.size !== expected.size
    ) {
      fail(`Windows ${key} artifact does not match its dist provenance.`);
    }
  }
}

function recordMobile({ root, version, apk, startedAt }) {
  const packageJson = readPackage(root);
  if (version !== packageJson.version) {
    fail(`Requested version ${version} does not match package.json ${packageJson.version}.`);
  }
  assertCleanGit(root);
  const apkPath = requireFile(path.resolve(apk), "Release APK");
  const startedAtMs = Date.parse(startedAt);
  if (!Number.isFinite(startedAtMs)) fail(`Invalid build start timestamp: ${startedAt}`);
  const apkStats = statSync(apkPath);
  if (apkStats.mtimeMs + MTIME_TOLERANCE_MS < startedAtMs) {
    fail("Release APK predates this build invocation; refusing to record stale output.");
  }
  const source = mobileSourceFingerprint(root);
  const dist = distFingerprint(root);
  const nativeNotices = androidNativeNoticeState(root);
  const embeddedAttestation = verifyMobileAttestation(root, version);
  if (
    apkStats.mtimeMs + MTIME_TOLERANCE_MS < source.newestMtimeMs ||
    apkStats.mtimeMs + MTIME_TOLERANCE_MS < dist.newestMtimeMs
  ) {
    fail("Release APK is older than its current source or final web build.");
  }
  const manifest = {
    schema: PROVENANCE_SCHEMA,
    platform: "android",
    version,
    gitHead: getGitHead(root),
    sourceSha256: source.sha256,
    sourceFileCount: source.count,
    distSha256: dist.sha256,
    distFileCount: dist.count,
    apkSha256: sha256File(apkPath),
    apkSize: apkStats.size,
    nativeRuntimeInventorySha256: nativeNotices.rawSha256,
    nativeLicenseInventorySha256: nativeNotices.inventorySha256,
    nativeNoticeSha256: nativeNotices.noticeSha256,
    nativeDependencyCount: nativeNotices.dependencyCount,
    embeddedProvenanceSha256: embeddedAttestation.sha256,
    buildStartedAtUtc: new Date(startedAtMs).toISOString(),
    apkCreatedAtUtc: apkStats.mtime.toISOString(),
    recordedAtUtc: new Date().toISOString(),
  };
  const manifestPath = provenancePathForApk(apkPath);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`Recorded Android release provenance: ${manifestPath}\n`);
}

function verifyMobile({ root, version, apk }) {
  const packageJson = readPackage(root);
  if (version !== packageJson.version) {
    fail(`Requested version ${version} does not match package.json ${packageJson.version}.`);
  }
  assertCleanGit(root);
  const apkPath = requireFile(path.resolve(apk), "Release APK");
  const manifestPath = requireFile(
    provenancePathForApk(apkPath),
    "Android release provenance",
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.schema !== PROVENANCE_SCHEMA || manifest.platform !== "android") {
    fail("Android release provenance has an unsupported schema or platform.");
  }
  if (manifest.version !== version) {
    fail(`Android release provenance is for ${manifest.version}, expected ${version}.`);
  }
  const head = getGitHead(root);
  if (manifest.gitHead !== head) {
    fail(
      `Release APK was built from commit ${manifest.gitHead}, not current HEAD ${head}. Rebuild it after the final commit.`,
    );
  }
  const source = mobileSourceFingerprint(root);
  const dist = distFingerprint(root);
  const nativeNotices = androidNativeNoticeState(root);
  const embeddedAttestation = verifyMobileAttestation(root, version);
  if (
    manifest.sourceSha256 !== source.sha256 ||
    manifest.sourceFileCount !== source.count
  ) {
    fail("Release APK source fingerprint does not match the current committed source.");
  }
  if (manifest.distSha256 !== dist.sha256 || manifest.distFileCount !== dist.count) {
    fail("Release APK web-build fingerprint does not match the current final dist.");
  }
  const apkStats = statSync(apkPath);
  if (manifest.apkSize !== apkStats.size || manifest.apkSha256 !== sha256File(apkPath)) {
    fail("Release APK does not match its recorded build provenance.");
  }
  if (
    manifest.nativeRuntimeInventorySha256 !== nativeNotices.rawSha256 ||
    manifest.nativeLicenseInventorySha256 !== nativeNotices.inventorySha256 ||
    manifest.nativeNoticeSha256 !== nativeNotices.noticeSha256 ||
    manifest.nativeDependencyCount !== nativeNotices.dependencyCount ||
    manifest.embeddedProvenanceSha256 !== embeddedAttestation.sha256
  ) {
    fail("Android native Maven notices do not match recorded release provenance.");
  }
  if (
    apkStats.mtimeMs + MTIME_TOLERANCE_MS < source.newestMtimeMs ||
    apkStats.mtimeMs + MTIME_TOLERANCE_MS < dist.newestMtimeMs
  ) {
    fail("Release APK predates current source or final web-build files.");
  }
  process.stdout.write(`Verified Android release provenance for ${version} at ${head}.\n`);
}

function readAsar(asarPath) {
  const descriptor = openSync(asarPath, "r");
  try {
    const prefix = Buffer.alloc(16);
    if (readSync(descriptor, prefix, 0, prefix.length, 0) !== prefix.length) {
      fail(`ASAR header is truncated: ${asarPath}`);
    }
    if (prefix.readUInt32LE(0) !== 4) fail(`ASAR size pickle is invalid: ${asarPath}`);
    const headerSize = prefix.readUInt32LE(4);
    const headerPayloadSize = prefix.readUInt32LE(8);
    const jsonSize = prefix.readUInt32LE(12);
    if (
      headerSize < 8 ||
      headerPayloadSize + 4 !== headerSize ||
      // Electron's current Pickle.writeString stores a 4-byte byte length,
      // followed by the UTF-8 bytes and zero to three bytes of 4-byte
      // alignment padding. It does not require a trailing NUL, so a JSON
      // length already divisible by four has no padding at all.
      jsonSize + 4 > headerPayloadSize ||
      headerPayloadSize > jsonSize + 7 ||
      jsonSize > 128 * 1024 * 1024
    ) {
      fail(`ASAR header lengths are invalid: ${asarPath}`);
    }
    const jsonBuffer = Buffer.alloc(jsonSize);
    if (readSync(descriptor, jsonBuffer, 0, jsonSize, 16) !== jsonSize) {
      fail(`ASAR JSON header is truncated: ${asarPath}`);
    }
    const header = JSON.parse(jsonBuffer.toString("utf8"));
    const entries = new Map();
    const visit = (files, parent = "") => {
      for (const [name, entry] of Object.entries(files || {})) {
        const relativePath = parent ? `${parent}/${name}` : name;
        if (entry.files) visit(entry.files, relativePath);
        else if (entry.link) entries.set(relativePath, { ...entry, link: entry.link });
        else entries.set(relativePath, entry);
      }
    };
    visit(header.files);
    return {
      descriptor,
      entries,
      dataOffset: 8 + headerSize,
      unpackedRoot: `${asarPath}.unpacked`,
    };
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function closeAsar(asar) {
  closeSync(asar.descriptor);
}

function readAsarEntry(asar, relativePath) {
  const normalized = normalizeRelative(relativePath);
  const entry = asar.entries.get(normalized);
  if (!entry || entry.link) fail(`Packaged ASAR is missing ${normalized}.`);
  if (entry.unpacked) {
    return readFileSync(path.join(asar.unpackedRoot, ...normalized.split("/")));
  }
  const size = Number(entry.size);
  const offset = Number(entry.offset);
  if (!Number.isSafeInteger(size) || !Number.isSafeInteger(offset) || size < 0 || offset < 0) {
    fail(`Packaged ASAR has invalid metadata for ${normalized}.`);
  }
  const buffer = Buffer.alloc(size);
  if (size && readSync(asar.descriptor, buffer, 0, size, asar.dataOffset + offset) !== size) {
    fail(`Packaged ASAR entry is truncated: ${normalized}.`);
  }
  return buffer;
}

function assertAsarFileMatches(asar, root, relativePath) {
  const normalized = normalizeRelative(relativePath);
  const sourcePath = requireFile(
    path.join(root, ...normalized.split("/")),
    `Current ${normalized}`,
  );
  const packaged = readAsarEntry(asar, normalized);
  if (sha256Buffer(packaged) !== sha256File(sourcePath)) {
    fail(`Packaged ASAR contains stale or changed ${normalized}.`);
  }
}

function assertNoForbiddenText(label, buffer, relativePath = "") {
  const text = buffer.toString("utf8");
  for (const forbidden of FORBIDDEN_APP_CONTENT) {
    if (forbidden.pattern.test(text)) {
      fail(`${label} contains forbidden ${forbidden.label} content.`);
    }
  }
  if (normalizeRelative(relativePath) !== VETTED_OFFICIAL_TRADE_CLIENT) {
    for (const forbidden of PATH_SCOPED_TRADE_CONTENT) {
      if (forbidden.pattern.test(text)) {
        fail(`${label} contains forbidden ${forbidden.label} content.`);
      }
    }
  }
}

function assertSafePackagedPath(relativePath) {
  const normalized = `/${normalizeRelative(relativePath).toLowerCase()}/`;
  if (normalized.includes("uiohook")) {
    fail(`Packaged desktop resources contain uiohook debris: ${relativePath}`);
  }
  if (
    normalized.includes("/node_modules/@capacitor/android/") ||
    normalized.includes("/node_modules/@capacitor/ios/")
  ) {
    fail(`Packaged desktop resources contain Capacitor native-platform debris: ${relativePath}`);
  }
  if (normalized.includes("trade-service")) {
    fail(`Packaged desktop resources contain legacy Trade service debris: ${relativePath}`);
  }
}

function runtimeSourceFiles(root) {
  const candidates = [];
  for (const directory of ["src", "public", "electron"]) {
    for (const filePath of walkFiles(path.join(root, directory))) {
      const relativePath = normalizeRelative(path.relative(root, filePath));
      if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relativePath)) continue;
      candidates.push(filePath);
    }
  }
  for (const relativePath of [
    "package.json",
    "pnpm-lock.yaml",
    "index.html",
    "vite.config.ts",
    "THIRD_PARTY_NOTICES.md",
  ]) {
    const filePath = path.join(root, relativePath);
    if (existsSync(filePath)) candidates.push(filePath);
  }
  return candidates;
}

function verifyWindows({ root, version }) {
  const packageJson = readPackage(root);
  if (version !== packageJson.version) {
    fail(`Requested version ${version} does not match package.json ${packageJson.version}.`);
  }
  assertCleanGit(root);
  verifyWindowsProvenance(root, version);
  const deliverables = requireDirectory(path.join(root, "deliverables"), "Deliverables");
  const resources = requireDirectory(
    path.join(deliverables, "win-unpacked", "resources"),
    "Unpacked Windows resources",
  );
  assertElectronRuntimePackaged(root, path.join(deliverables, "win-unpacked"));
  assertElectronBuilderResources(root, resources, packageJson);
  const asarPath = requireFile(path.join(resources, "app.asar"), "Packaged app.asar");
  const sourceHelper = requireFile(
    path.join(root, "build", "native-input", "NinjaLensInput.exe"),
    "Current native input helper",
  );
  const packagedHelper = requireFile(
    path.join(resources, "native-input", "NinjaLensInput.exe"),
    "Packaged native input helper",
  );
  if (sha256File(sourceHelper) !== sha256File(packagedHelper)) {
    fail("Packaged native input helper does not match the current final helper.");
  }
  const sourcePobHost = requireFile(
    path.join(root, "build", "pob-engine", "NinjaLensPobHost-x64.exe"),
    "Current Path of Building calculation host",
  );
  const packagedPobHost = requireFile(
    path.join(resources, "pob-engine", "NinjaLensPobHost-x64.exe"),
    "Packaged Path of Building calculation host",
  );
  if (sha256File(sourcePobHost) !== sha256File(packagedPobHost)) {
    fail("Packaged Path of Building calculation host does not match the current final host.");
  }
  const sourceUpdateConfig = requireFile(
    path.join(root, "build", "update-config.json"),
    "Current updater configuration",
  );
  let parsedUpdateConfig;
  try {
    parsedUpdateConfig = JSON.parse(readFileSync(sourceUpdateConfig, "utf8"));
  } catch {
    fail("build/update-config.json is not valid JSON.");
  }
  assertPublicUpdateConfig(parsedUpdateConfig, packageJson);
  const packagedUpdateConfig = requireFile(
    path.join(resources, "update-config.json"),
    "Packaged updater configuration",
  );
  if (sha256File(sourceUpdateConfig) !== sha256File(packagedUpdateConfig)) {
    fail("Packaged updater configuration does not match build/update-config.json.");
  }
  const nativeInputs = [
    path.join(root, "native", "NinjaLensInput.cs"),
    path.join(root, "scripts", "build-native-input.mjs"),
  ].filter(existsSync);
  const newestNativeInput = Math.max(...nativeInputs.map((filePath) => statSync(filePath).mtimeMs));
  if (statSync(sourceHelper).mtimeMs + MTIME_TOLERANCE_MS < newestNativeInput) {
    fail("Current native input helper predates its source; rebuild before packaging.");
  }
  const pobHostInputs = [
    path.join(root, "electron", "pob-engine-host.cs"),
    path.join(root, "scripts", "build-native-input.mjs"),
  ].filter(existsSync);
  const newestPobHostInput = Math.max(...pobHostInputs.map((filePath) => statSync(filePath).mtimeMs));
  if (statSync(sourcePobHost).mtimeMs + MTIME_TOLERANCE_MS < newestPobHostInput) {
    fail("Current Path of Building calculation host predates its source; rebuild before packaging.");
  }
  const distIndex = requireFile(path.join(root, "dist", "index.html"), "Final dist index");
  const newestRuntimeSource = Math.max(...runtimeSourceFiles(root).map((filePath) => statSync(filePath).mtimeMs));
  if (statSync(distIndex).mtimeMs + MTIME_TOLERANCE_MS < newestRuntimeSource) {
    fail("Final dist predates current runtime source; rebuild before packaging.");
  }

  const asar = readAsar(asarPath);
  try {
    for (const relativePath of asar.entries.keys()) assertSafePackagedPath(relativePath);
    const expectedUnpacked = [];
    let foundWin32OverlayNative = false;
    for (const [relativePath, entry] of asar.entries) {
      if (
        /^node_modules\/electron-overlay-window\/prebuilds\//.test(relativePath) &&
        !/^node_modules\/electron-overlay-window\/prebuilds\/win32-x64\/[^/]+\.node$/i.test(relativePath)
      ) {
        fail(`Packaged Windows app contains a non-win32-x64 overlay native binary: ${relativePath}`);
      }
      if (!entry.unpacked) continue;
      expectedUnpacked.push(relativePath);
      const unpackedPath = requireFile(
        path.join(asar.unpackedRoot, ...relativePath.split("/")),
        `ASAR-unpacked entry ${relativePath}`,
      );
      // electron-builder's native-module smart unpacking extracts the full
      // package, even when asarUnpack names only its win32 prebuild. The exact
      // package file set and every hash are enforced again below.
      const expectedDependencyPrefix = "node_modules/electron-overlay-window/";
      if (!relativePath.startsWith(expectedDependencyPrefix)) {
        fail(`Unexpected production file is ASAR-unpacked: ${relativePath}`);
      }
      const dependencyPath = requireFile(
        path.join(root, ...relativePath.split("/")),
        `Current production dependency for ${relativePath}`,
      );
      const dependencyRelativePath = relativePath.slice(expectedDependencyPrefix.length);
      const expectedUnpackedContents = expectedPackagedDependencyFile(
        dependencyPath,
        dependencyRelativePath,
      );
      const unpackedStats = statSync(unpackedPath);
      if (
        unpackedStats.size !== Number(entry.size) ||
        unpackedStats.size !== expectedUnpackedContents.length ||
        sha256File(unpackedPath) !== sha256Buffer(expectedUnpackedContents)
      ) {
        fail(`ASAR-unpacked production dependency is missing or changed: ${relativePath}`);
      }
      if (/prebuilds\/win32-x64\/.*\.node$/i.test(relativePath)) {
        foundWin32OverlayNative = true;
      }
    }
    if (!foundWin32OverlayNative) {
      fail("Packaged ASAR has no verified electron-overlay-window win32-x64 native module.");
    }
    assertAsarNodeModulesMatch(asar, root);
    const actualUnpacked = walkFiles(asar.unpackedRoot)
      .map((filePath) => normalizeRelative(path.relative(asar.unpackedRoot, filePath)))
      .sort();
    expectedUnpacked.sort();
    if (JSON.stringify(actualUnpacked) !== JSON.stringify(expectedUnpacked)) {
      fail("app.asar.unpacked contains missing or extra files not declared by app.asar.");
    }
    const expectedResourceFiles = [
      "app-update.yml",
      "app.asar",
      "default_app.asar",
      "elevate.exe",
      "native-input/NinjaLensInput.exe",
      "pob-engine/NinjaLensPobHost-x64.exe",
      "tray.ico",
      "tray.png",
      "update-config.json",
      ...expectedUnpacked.map((relativePath) => `app.asar.unpacked/${relativePath}`),
    ].sort();
    const actualResourceFiles = walkFiles(resources)
      .map((filePath) => normalizeRelative(path.relative(resources, filePath)))
      .sort();
    if (canonicalJson(actualResourceFiles) !== canonicalJson(expectedResourceFiles)) {
      fail("Packaged resources contain missing or unexpected files.");
    }
    for (const directory of ["dist", "electron"]) {
      for (const filePath of walkFiles(path.join(root, directory))) {
        assertAsarFileMatches(asar, root, path.relative(root, filePath));
      }
    }
    assertAsarFileMatches(asar, root, "THIRD_PARTY_NOTICES.md");
    const packagedPackage = JSON.parse(readAsarEntry(asar, "package.json").toString("utf8"));
    if (
      packagedPackage.version !== version ||
      packagedPackage.name !== packageJson.name ||
      packagedPackage.main !== packageJson.main
    ) {
      fail("Packaged ASAR package identity/version does not match package.json.");
    }
    const scanExtensions = /\.(?:cjs|css|html|js|json|map|md|mjs|txt)$/i;
    for (const [relativePath, entry] of asar.entries) {
      if (
        !scanExtensions.test(relativePath) ||
        (!relativePath.startsWith("dist/") &&
          !relativePath.startsWith("electron/") &&
          relativePath !== "package.json" &&
          relativePath !== "THIRD_PARTY_NOTICES.md") ||
        Number(entry.size || 0) > 64 * 1024 * 1024
      ) {
        continue;
      }
      assertNoForbiddenText(
        `Packaged ${relativePath}`,
        readAsarEntry(asar, relativePath),
        relativePath,
      );
    }
  } finally {
    closeAsar(asar);
  }

  const unpackedRoot = path.join(resources, "app.asar.unpacked");
  for (const filePath of walkFiles(unpackedRoot)) {
    assertSafePackagedPath(path.relative(resources, filePath));
  }
  const resourcesMtime = Math.max(
    statSync(asarPath).mtimeMs,
    statSync(packagedHelper).mtimeMs,
    statSync(packagedPobHost).mtimeMs,
    statSync(packagedUpdateConfig).mtimeMs,
  );
  const currentOutputMtime = Math.max(
    statSync(distIndex).mtimeMs,
    statSync(sourceHelper).mtimeMs,
    statSync(sourcePobHost).mtimeMs,
  );
  if (resourcesMtime + MTIME_TOLERANCE_MS < currentOutputMtime) {
    fail("Packaged Windows resources predate current final dist/native output.");
  }
  process.stdout.write(`Verified current Windows release resources for ${version}.\n`);
}

function usage() {
  process.stderr.write(
    "Usage:\n" +
      "  node scripts/verify-release-artifacts.mjs windows --root <dir> --version <version>\n" +
      "  node scripts/verify-release-artifacts.mjs electron-runtime --root <dir>\n" +
      "  node scripts/verify-release-artifacts.mjs production-dependencies --root <dir> --graph <file>\n" +
      "  node scripts/verify-release-artifacts.mjs snapshot-production-dependencies --root <dir> --graph <file>\n" +
      "  node scripts/verify-release-artifacts.mjs record-windows --root <dir> --version <version> --started-at <iso>\n" +
      "  node scripts/verify-release-artifacts.mjs prepare-mobile --root <dir> --version <version>\n" +
      "  node scripts/verify-release-artifacts.mjs record-mobile --root <dir> --version <version> --apk <file> --started-at <iso>\n" +
      "  node scripts/verify-release-artifacts.mjs mobile --root <dir> --version <version> --apk <file>\n",
  );
}

function main() {
  const [command, ...argv] = process.argv.slice(2);
  const options = parseArgs(argv);
  const root = path.resolve(options.root || DEFAULT_ROOT);
  if (command === "electron-runtime") {
    const result = verifyElectronRuntime(root);
    process.stdout.write(
      `Verified Electron ${result.version} win32-x64 runtime (${result.count} files).\n`,
    );
    return;
  }
  if (command === "production-dependencies") {
    const result = verifyProductionDependencies(
      root,
      path.resolve(options.graph || ""),
    );
    process.stdout.write(
      `Verified ${result.packageCount} production packages (${result.fileCount} exact files).\n`,
    );
    return;
  }
  if (command === "snapshot-production-dependencies") {
    const result = writeProductionDependencyManifest(
      root,
      path.resolve(options.graph || ""),
    );
    process.stdout.write(
      `Pinned ${result.packageCount} production packages (${result.fileCount} exact files).\n`,
    );
    return;
  }
  if (command === "windows") {
    verifyWindows({ root, version: options.version });
    return;
  }
  if (command === "record-windows") {
    recordWindows({
      root,
      version: options.version,
      startedAt: options["started-at"],
    });
    return;
  }
  if (command === "record-mobile") {
    recordMobile({
      root,
      version: options.version,
      apk: options.apk,
      startedAt: options["started-at"],
    });
    return;
  }
  if (command === "prepare-mobile") {
    prepareMobileAttestation({ root, version: options.version });
    return;
  }
  if (command === "mobile") {
    verifyMobile({ root, version: options.version, apk: options.apk });
    return;
  }
  usage();
  process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Release verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export {
  androidNativeNoticeState,
  assertAsarNodeModulesMatch,
  assertNoForbiddenText,
  assertPublicUpdateConfig,
  closeAsar,
  distFingerprint,
  electronRuntimeFingerprint,
  expectedAppUpdateYaml,
  githubUpdateConfiguration,
  hashFiles,
  mobileSourceFingerprint,
  peCodeIdentity,
  productionDependencyState,
  readAsar,
  readAsarEntry,
  relevantMobileSource,
  sha256File,
  verifyProductionDependencies,
};
