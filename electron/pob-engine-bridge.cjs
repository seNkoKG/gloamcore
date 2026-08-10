const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const CONTRACT_VERSION = 1;
const RESULT_PREFIX = "NINJA_POB_RESULT:";
const MAX_BUILD_BYTES = 24 * 1024 * 1024;
const MAX_CHARACTER_BYTES = 8 * 1024 * 1024;
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_BYTES = 2 * 1024 * 1024;
const MAX_ENGINE_LOG_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_INFLATE_BYTES = 256 * 1024 * 1024;
const BUNDLED_RESOURCE_NAMES = [
  "pob-engine-host.cs",
  "pob-engine-worker.lua",
  "pob-headless-wrapper.lua",
  "pob-headless-wrapper.LICENSE.md",
];

// Deliberately exact. A newer PoB version must be exercised against the
// integration fixtures and added here in an app release before it is trusted.
// The manifest's per-file hashes are not used: PoB 2.66.1's generated manifest
// does not describe the tagged active source files. These hashes were verified
// directly against the official v2.66.1 Git tag.
const PROVEN_ENGINES = Object.freeze({
  "2.66.1": Object.freeze({
    branch: "master",
    platform: "win32",
    runtimeArchitecture: "x64",
    // Canonical SHA-256 of 300 official v2.66.1 calculation-relevant Lua
    // blobs: relativePath + NUL + Git-blob-SHA1 + LF. Text is normalized to
    // UTF-8/LF first because the PoB updater installs some source with CRLF.
    sourceFileCount: 300,
    sourceAggregateSha256: "cd5a2577e7cb7cb845bd8184ee8d407fb9ee016dea26ab49fa4fb96bc1cb9613",
    // The worker deliberately ignores generated .bin caches and inflates only
    // these 15 official immutable zip/part blobs in memory.
    timelessFileCount: 15,
    timelessAggregateSha256: "3129433803447e204b755244ab617fc05eb439bb9194c7527a0d85a0d39f1267",
    sourceSha1: Object.freeze({
      "Launch.lua": "accb470b8433e41f9f7c293f65f8153cd49dcf8c",
      "Modules/Build.lua": "a1b3171a2c5e9b091d16fc6c899d568ca2a778c2",
      "Classes/CalcsTab.lua": "a82fb6670bbd9be861e49343e543f607794ce809",
      "Modules/CalcPerform.lua": "c5b61320502640f30ab5ab199e1f607cd8875d3d",
      "Modules/ModParser.lua": "900914301123d0fd80aaec16ca6c38b52055daca",
    }),
    runtimeSha256: Object.freeze({
      "lua51.dll": "2e4e58e4cc6f6cb01d119ff3715253108041f6c59f9a6a464a62b2f70623bca6",
      "lua-utf8.dll": "8f49400e2c84716c3caf27c5b1d60133b7f598748fa9cdd31f0732a0642af96d",
      "zlib1.dll": "27f24e10860d28611b52c7f2e82e6f7e87c73fac44c8143ea511c73afd81a5c8",
      "lua/dkjson.lua": "b29af1cd65c19ce30811f87cb214f17d4c3683ce2e214a2549edf8a9978966da",
      "lua/xml.lua": "ff7865b9f4515c909020a058f3e47cb53cbd187669c89f213dc1e5e9e2c1abd3",
      "lua/base64.lua": "57981b3671c7d6f137c07b8274098473312abf2ea9189533a5370b6d046632ab",
      "lua/sha2.lua": "62d2e0885931a1f14db87e61cb3d74936bb5b1e19eb2b4994ab04c03d78f9ed6",
    }),
  }),
});

function failure(code, message, recoverable = false, extra = {}) {
  return {
    ok: false,
    authoritative: false,
    contractVersion: CONTRACT_VERSION,
    code,
    message,
    recoverable,
    ...extra,
  };
}

function normalizeError(error) {
  if (error && typeof error === "object" && typeof error.message === "string") {
    return error.message.slice(0, 4000);
  }
  return String(error || "Unknown error").slice(0, 4000);
}

function sha1File(fileName) {
  return crypto.createHash("sha1").update(fs.readFileSync(fileName)).digest("hex");
}

function sha256File(fileName) {
  return crypto.createHash("sha256").update(fs.readFileSync(fileName)).digest("hex");
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function gitBlobSha1(content) {
  return crypto.createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
}

function walkRegularFiles(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fileName = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`PoB source contains an unverified symbolic link: ${fileName}`);
    if (entry.isDirectory()) result.push(...walkRegularFiles(fileName));
    else if (entry.isFile()) result.push(fileName);
  }
  return result;
}

function officialSourceAggregate(root) {
  const files = [path.join(root, "Launch.lua"), path.join(root, "GameVersions.lua")];
  for (const directory of ["Classes", "Data", "Modules", "TreeData"]) {
    files.push(...walkRegularFiles(path.join(root, directory)).filter((fileName) => fileName.toLowerCase().endsWith(".lua")));
  }
  const unique = [...new Set(files)].sort((left, right) => left.localeCompare(right, "en"));
  const canonical = unique.map((fileName) => {
    let source = fs.readFileSync(fileName, "utf8");
    if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
    const content = Buffer.from(source.replace(/\r\n?/g, "\n"), "utf8");
    const relative = path.relative(root, fileName).split(path.sep).join("/");
    return `${relative}\0${gitBlobSha1(content)}\n`;
  }).join("");
  return { count: unique.length, sha256: sha256Buffer(Buffer.from(canonical, "utf8")) };
}

function officialTimelessAggregate(root) {
  const directory = path.join(root, "Data", "TimelessJewelData");
  const files = walkRegularFiles(directory)
    .filter((fileName) => /\.(?:zip|part\d+)$/i.test(fileName))
    .sort((left, right) => left.localeCompare(right, "en"));
  const canonical = files.map((fileName) => {
    const content = fs.readFileSync(fileName);
    const relative = path.relative(root, fileName).split(path.sep).join("/");
    return `${relative}\0${gitBlobSha1(content)}\n`;
  }).join("");
  return { count: files.length, sha256: sha256Buffer(Buffer.from(canonical, "utf8")) };
}

function defaultPobRoot() {
  const roaming = process.env.APPDATA;
  return roaming ? path.join(roaming, "Path of Building Community") : "";
}

function parseVersionManifest(fileName) {
  const stat = fs.statSync(fileName);
  if (!stat.isFile() || stat.size <= 0 || stat.size > 16 * 1024 * 1024) {
    throw new Error("Path of Building manifest.xml has an invalid size.");
  }
  const source = fs.readFileSync(fileName, "utf8");
  const versionTag = /<Version\b([^>]*)\/?\s*>/i.exec(source);
  if (!versionTag) throw new Error("Path of Building manifest.xml has no Version element.");
  const attributes = {};
  const attributePattern = /([A-Za-z][\w:-]*)\s*=\s*(["'])(.*?)\2/g;
  let match;
  while ((match = attributePattern.exec(versionTag[1]))) attributes[match[1]] = match[3];
  if (!attributes.number) throw new Error("Path of Building manifest.xml has no version number.");
  return {
    number: attributes.number,
    branch: attributes.branch || "",
    platform: attributes.platform || "",
    sha256: sha256Buffer(Buffer.from(source, "utf8")),
  };
}

function readPeArchitecture(fileName) {
  const descriptor = fs.openSync(fileName, "r");
  try {
    const header = Buffer.alloc(64);
    if (fs.readSync(descriptor, header, 0, header.length, 0) !== header.length
      || header.readUInt16LE(0) !== 0x5a4d) {
      throw new Error("lua51.dll is not a valid Windows PE file.");
    }
    const peOffset = header.readUInt32LE(0x3c);
    const pe = Buffer.alloc(6);
    if (fs.readSync(descriptor, pe, 0, pe.length, peOffset) !== pe.length
      || pe.readUInt32LE(0) !== 0x00004550) {
      throw new Error("lua51.dll has no valid PE header.");
    }
    const machine = pe.readUInt16LE(4);
    if (machine === 0x8664) return "x64";
    if (machine === 0x014c) return "x86";
    if (machine === 0xaa64) return "arm64";
    return `unknown-0x${machine.toString(16)}`;
  } finally {
    fs.closeSync(descriptor);
  }
}

function findCompiler(architecture) {
  if (process.platform !== "win32") return null;
  const windowsRoot = process.env.WINDIR || "C:\\Windows";
  const frameworkOrder = architecture === "x64" ? ["Framework64", "Framework"] : ["Framework", "Framework64"];
  for (const framework of frameworkOrder) {
    const candidate = path.join(windowsRoot, "Microsoft.NET", framework, "v4.0.30319", "csc.exe");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function bundledResources() {
  const resources = {};
  for (const name of BUNDLED_RESOURCE_NAMES) {
    const fileName = path.join(__dirname, name);
    const content = fs.readFileSync(fileName);
    resources[name] = { fileName, content, sha256: sha256Buffer(content) };
  }
  const fingerprint = sha256Buffer(Buffer.concat(BUNDLED_RESOURCE_NAMES.map((name) => resources[name].content)));
  return { resources, fingerprint };
}

function cacheRoot(options = {}) {
  if (options.cacheRoot) return path.resolve(options.cacheRoot);
  const local = process.env.LOCALAPPDATA || path.join(os.tmpdir(), "NinjaLens");
  return path.join(local, "Ninja Lens", "pob-engine");
}

function writeImmutableFile(fileName, content) {
  try {
    fs.writeFileSync(fileName, content, { flag: "wx" });
  } catch (error) {
    if (!error || error.code !== "EEXIST") throw error;
    if (!crypto.timingSafeEqual(Buffer.from(sha256File(fileName), "hex"), Buffer.from(sha256Buffer(content), "hex"))) {
      throw new Error(`Cached PoB bridge resource is not the bundled file: ${path.basename(fileName)}`);
    }
  }
}

function materializeResources(options = {}) {
  const bundle = bundledResources();
  const directory = path.join(cacheRoot(options), `bundle-${bundle.fingerprint.slice(0, 24)}`);
  fs.mkdirSync(directory, { recursive: true });
  const paths = {};
  for (const name of BUNDLED_RESOURCE_NAMES) {
    const destination = path.join(directory, name);
    writeImmutableFile(destination, bundle.resources[name].content);
    paths[name] = destination;
  }
  return { directory, fingerprint: bundle.fingerprint, paths };
}

function configuredPrebuiltHost(architecture, options = {}) {
  const resourceRoot = options.resourcesPath || (typeof process.resourcesPath === "string" ? process.resourcesPath : "");
  if (!resourceRoot) return null;
  const candidate = path.join(resourceRoot, "pob-engine", `NinjaLensPobHost-${architecture}.exe`);
  return fs.existsSync(candidate) ? candidate : null;
}

function ensureHost(architecture, resources, options = {}) {
  const prebuilt = configuredPrebuiltHost(architecture, options);
  if (prebuilt) {
    return { path: prebuilt, mode: "bundled-prebuilt", sha256: sha256File(prebuilt) };
  }
  const compiler = findCompiler(architecture);
  if (!compiler) {
    throw Object.assign(new Error("No bundled PoB engine host or compatible .NET Framework C# compiler is available."), {
      code: "POB_HOST_UNAVAILABLE",
    });
  }
  const hostPath = path.join(resources.directory, `NinjaLensPobHost-${architecture}.exe`);
  if (!fs.existsSync(hostPath)) {
    const temporary = `${hostPath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp.exe`;
    const compile = spawnSync(compiler, [
      "/nologo",
      "/optimize+",
      "/target:exe",
      `/platform:${architecture}`,
      `/out:${temporary}`,
      resources.paths["pob-engine-host.cs"],
    ], {
      windowsHide: true,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    if (compile.error || compile.status !== 0 || !fs.existsSync(temporary)) {
      try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch { /* exact temporary file only */ }
      throw Object.assign(new Error(`PoB engine host compilation failed: ${compile.error?.message || compile.stderr || compile.stdout || `exit ${compile.status}`}`), {
        code: "POB_HOST_BUILD_FAILED",
      });
    }
    try {
      fs.renameSync(temporary, hostPath);
    } catch (error) {
      if (!fs.existsSync(hostPath)) throw error;
      try { fs.unlinkSync(temporary); } catch { /* another app instance won the cache race */ }
    }
  }
  return { path: hostPath, mode: "compiled-cache", compiler, sha256: sha256File(hostPath) };
}

function inspectInstallation(options = {}) {
  if (process.platform !== "win32") {
    return failure("POB_PLATFORM_UNSUPPORTED", "The authoritative Path of Building bridge currently supports Windows only.");
  }
  const requestedRoot = options.pobRoot || defaultPobRoot();
  if (!requestedRoot || !fs.existsSync(requestedRoot)) {
    return failure("POB_NOT_INSTALLED", "Path of Building Community was not found. Install it or select its installation folder.", true, {
      root: requestedRoot || null,
    });
  }

  let root;
  let manifest;
  try {
    root = fs.realpathSync(path.resolve(requestedRoot));
    manifest = parseVersionManifest(path.join(root, "manifest.xml"));
  } catch (error) {
    return failure("POB_INSTALLATION_INVALID", "The Path of Building installation cannot be validated.", true, {
      root: path.resolve(requestedRoot),
      detail: normalizeError(error),
    });
  }

  const proven = PROVEN_ENGINES[manifest.number];
  if (!proven) {
    return failure("POB_VERSION_UNVERIFIED", `Path of Building ${manifest.number} has not been verified with this app release. Calculations are disabled instead of returning potentially wrong values.`, true, {
      root,
      engine: manifest,
      supportedVersions: Object.keys(PROVEN_ENGINES),
    });
  }
  if (manifest.branch !== proven.branch || manifest.platform !== proven.platform) {
    return failure("POB_BUILD_UNVERIFIED", "This Path of Building branch/platform combination has not been verified.", true, {
      root,
      engine: manifest,
      expected: { branch: proven.branch, platform: proven.platform },
    });
  }

  const mismatches = [];
  let sourceAggregate;
  let timelessAggregate;
  try {
    for (const [relative, expected] of Object.entries(proven.sourceSha1)) {
      const fileName = path.join(root, ...relative.split("/"));
      if (!fs.existsSync(fileName)) mismatches.push({ file: relative, reason: "missing" });
      else {
        const actual = sha1File(fileName);
        if (actual !== expected) mismatches.push({ file: relative, reason: "hash", expected, actual });
      }
    }
    const sourceDirectories = ["Classes", "Data", "Modules", "TreeData"].map((directory) => path.join(root, directory));
    if (sourceDirectories.some((directory) => !fs.existsSync(directory))) {
      mismatches.push({ file: "official calculation Lua source set", reason: "missing" });
    } else {
      sourceAggregate = officialSourceAggregate(root);
    }
    if (sourceAggregate && (sourceAggregate.count !== proven.sourceFileCount || sourceAggregate.sha256 !== proven.sourceAggregateSha256)) {
      mismatches.push({
        file: "official calculation Lua source set",
        reason: "aggregate",
        expectedCount: proven.sourceFileCount,
        actualCount: sourceAggregate.count,
        expected: proven.sourceAggregateSha256,
        actual: sourceAggregate.sha256,
      });
    }
    const timelessDirectory = path.join(root, "Data", "TimelessJewelData");
    if (!fs.existsSync(timelessDirectory)) {
      mismatches.push({ file: "Data/TimelessJewelData official compressed inputs", reason: "missing" });
    } else {
      timelessAggregate = officialTimelessAggregate(root);
    }
    if (timelessAggregate && (timelessAggregate.count !== proven.timelessFileCount || timelessAggregate.sha256 !== proven.timelessAggregateSha256)) {
      mismatches.push({
        file: "Data/TimelessJewelData official compressed inputs",
        reason: "aggregate",
        expectedCount: proven.timelessFileCount,
        actualCount: timelessAggregate.count,
        expected: proven.timelessAggregateSha256,
        actual: timelessAggregate.sha256,
      });
    }
    for (const [relative, expected] of Object.entries(proven.runtimeSha256)) {
      const fileName = path.join(root, ...relative.split("/"));
      if (!fs.existsSync(fileName)) mismatches.push({ file: relative, reason: "missing" });
      else {
        const actual = sha256File(fileName);
        if (actual !== expected) mismatches.push({ file: relative, reason: "hash", expected, actual });
      }
    }
  } catch (error) {
    return failure("POB_SOURCE_UNREADABLE", "Path of Building source/runtime files could not be read.", true, {
      root,
      engine: manifest,
      detail: normalizeError(error),
    });
  }
  if (mismatches.length > 0) {
    return failure("POB_SOURCE_UNVERIFIED", "The installed Path of Building source/runtime does not match the officially verified release. Calculations are disabled.", true, {
      root,
      engine: manifest,
      mismatches,
    });
  }

  let runtimeArchitecture;
  try {
    runtimeArchitecture = readPeArchitecture(path.join(root, "lua51.dll"));
  } catch (error) {
    return failure("POB_RUNTIME_INVALID", "The installed Path of Building LuaJIT runtime is invalid.", true, {
      root,
      engine: manifest,
      detail: normalizeError(error),
    });
  }
  if (runtimeArchitecture !== proven.runtimeArchitecture) {
    return failure("POB_RUNTIME_UNVERIFIED", `The installed ${runtimeArchitecture} PoB runtime has not been verified.`, true, {
      root,
      engine: manifest,
      runtimeArchitecture,
      expectedArchitecture: proven.runtimeArchitecture,
    });
  }

  const sourceFingerprint = sha256Buffer(Buffer.from(JSON.stringify({
    version: manifest.number,
    branch: manifest.branch,
    platform: manifest.platform,
    sourceSha1: proven.sourceSha1,
    sourceAggregate,
    timelessAggregate,
    runtimeSha256: proven.runtimeSha256,
  })));
  return {
    ok: true,
    authoritative: true,
    contractVersion: CONTRACT_VERSION,
    root,
    engine: manifest,
    runtimeArchitecture,
    sourceFingerprint,
    provenAgainst: `PathOfBuildingCommunity/PathOfBuilding tag v${manifest.number}`,
  };
}

function diagnosePobEngine(options = {}) {
  const installation = inspectInstallation(options);
  if (!installation.ok) {
    return {
      ...installation,
      available: false,
      capability: "unavailable",
    };
  }
  try {
    const resources = bundledResources();
    const prebuilt = configuredPrebuiltHost(installation.runtimeArchitecture, options);
    const compiler = prebuilt ? null : findCompiler(installation.runtimeArchitecture);
    if (!prebuilt && !compiler) {
      return {
        ...failure("POB_HOST_UNAVAILABLE", "The verified PoB engine is installed, but this app has no bundled host and Windows has no compatible C# compiler.", true),
        available: false,
        capability: "unavailable",
        root: installation.root,
        engine: installation.engine,
        runtimeArchitecture: installation.runtimeArchitecture,
        sourceFingerprint: installation.sourceFingerprint,
        host: { mode: "missing", requiredArchitecture: installation.runtimeArchitecture },
      };
    }
    return {
      ...installation,
      available: true,
      capability: "authoritative-local-pob",
      bridgeFingerprint: resources.fingerprint,
      host: prebuilt
        ? { mode: "bundled-prebuilt", path: prebuilt, ready: true }
        : { mode: "compile-on-first-use", compiler, ready: false },
      isolation: {
        freshProcessPerRequest: true,
        installedPobReadOnly: true,
        noGuiLaunch: true,
        timeoutMilliseconds: DEFAULT_TIMEOUT_MS,
      },
      updatePolicy: "Exact PoB version/source/runtime allowlist; an app update and regression proof are required for each new engine release.",
      license: {
        upstream: "Path of Building Community",
        spdx: "MIT",
        notice: "electron/pob-headless-wrapper.LICENSE.md",
      },
    };
  } catch (error) {
    return {
      ...failure("POB_BRIDGE_INVALID", "The app's bundled PoB bridge resources are missing or invalid.", false, {
        detail: normalizeError(error),
      }),
      available: false,
      capability: "unavailable",
      root: installation.root,
      engine: installation.engine,
    };
  }
}

function trimUtf8(value, maximumBytes) {
  const buffer = Buffer.from(value || "", "utf8");
  return buffer.length <= maximumBytes ? buffer.toString("utf8") : buffer.subarray(0, maximumBytes).toString("utf8");
}

function runWorker(host, resources, installation, request, options = {}) {
  const requestedTimeout = Number(options.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MS);
  const timeoutMilliseconds = Math.max(1_000, Math.min(MAX_TIMEOUT_MS, Number.isFinite(requestedTimeout) ? requestedTimeout : DEFAULT_TIMEOUT_MS));
  const inflateBytes = Math.max(32 * 1024 * 1024, Math.min(512 * 1024 * 1024, Number(options.maxInflateBytes) || DEFAULT_INFLATE_BYTES));
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdout = [];
    const stderr = [];
    const childEnvironment = { ...process.env };
    delete childEnvironment.CI;
    childEnvironment.NINJA_POB_ROOT = installation.root;
    childEnvironment.NINJA_POB_MAX_INFLATE_BYTES = String(inflateBytes);

    const spawnWorker = typeof options.spawnImpl === "function" ? options.spawnImpl : spawn;
    const child = spawnWorker(host.path, [
      installation.root,
      installation.root,
      path.join(installation.root, "lua"),
      resources.paths["pob-headless-wrapper.lua"],
      resources.paths["pob-engine-worker.lua"],
    ], {
      cwd: installation.root,
      env: childEnvironment,
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener?.("abort", abort);
      resolve(result);
    };
    const abort = () => {
      try { child.kill(); } catch { /* process may already have exited */ }
      finish(failure("POB_CANCELLED", "The Path of Building operation was cancelled.", true));
    };
    options.signal?.addEventListener?.("abort", abort, { once: true });
    if (options.signal?.aborted) {
      abort();
      return;
    }
    const exceed = (stream) => {
      try { child.kill(); } catch { /* process may already have exited */ }
      finish(failure("POB_OUTPUT_LIMIT", `The Path of Building ${stream} stream exceeded its safety limit.`, false));
    };
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) return exceed("output");
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_STDERR_BYTES) return exceed("error output");
      stderr.push(chunk);
    });
    child.on("error", (error) => finish(failure("POB_HOST_START_FAILED", "The Path of Building worker could not start.", true, {
      detail: normalizeError(error),
    })));
    child.on("close", (code, signal) => {
      if (settled) return;
      const outputText = Buffer.concat(stdout).toString("utf8");
      const errorText = Buffer.concat(stderr).toString("utf8");
      const resultLines = outputText.split(/\r?\n/).filter((line) => line.startsWith(RESULT_PREFIX));
      if (resultLines.length !== 1) {
        return finish(failure("POB_PROTOCOL_ERROR", "The Path of Building worker did not return exactly one result.", false, {
          exitCode: code,
          signal: signal || null,
          detail: trimUtf8(errorText || outputText, MAX_ENGINE_LOG_BYTES),
        }));
      }
      let payload;
      try {
        payload = JSON.parse(resultLines[0].slice(RESULT_PREFIX.length));
      } catch (error) {
        return finish(failure("POB_PROTOCOL_ERROR", "The Path of Building worker returned invalid JSON.", false, {
          detail: normalizeError(error),
        }));
      }
      if (code !== 0) {
        return finish(failure("POB_HOST_FAILED", "The Path of Building host exited unsuccessfully.", true, {
          exitCode: code,
          signal: signal || null,
          detail: trimUtf8(errorText, MAX_ENGINE_LOG_BYTES),
        }));
      }
      const engineLog = trimUtf8(outputText.split(/\r?\n/).filter((line) => !line.startsWith(RESULT_PREFIX)).join("\n"), MAX_ENGINE_LOG_BYTES);
      finish({ payload, engineLog, errorLog: trimUtf8(errorText, MAX_ENGINE_LOG_BYTES) });
    });
    timer = setTimeout(() => {
      try { child.kill(); } catch { /* process may already have exited */ }
      finish(failure("POB_TIMEOUT", `Path of Building exceeded the ${timeoutMilliseconds} ms calculation limit.`, true));
    }, timeoutMilliseconds);

    child.stdin.on("error", (error) => {
      if (error && error.code !== "EPIPE") {
        finish(failure("POB_REQUEST_WRITE_FAILED", "The build could not be sent to Path of Building.", true, {
          detail: normalizeError(error),
        }));
      }
    });
    child.stdin.end(JSON.stringify(request), "utf8");
  });
}

function validateWorkerPayload(payload, installation) {
  if (!payload || typeof payload !== "object") {
    return failure("POB_PROTOCOL_ERROR", "The Path of Building worker returned no result object.");
  }
  if (payload.ok !== true) {
    return failure(
      typeof payload.code === "string" ? payload.code : "POB_CALCULATION_FAILED",
      typeof payload.message === "string" ? payload.message : "Path of Building could not calculate this build.",
      true,
      { detail: typeof payload.detail === "string" ? payload.detail.slice(0, 4000) : undefined },
    );
  }
  if (payload.authoritative !== true || payload.readOnly !== true || payload.freshProcess !== true) {
    return failure("POB_AUTHORITY_ASSERTION_FAILED", "The calculation worker did not assert the required read-only fresh-process contract.");
  }
  if (payload.engineVersion !== installation.engine.number
    || payload.engineBranch !== installation.engine.branch
    || payload.enginePlatform !== installation.engine.platform) {
    return failure("POB_ENGINE_CHANGED", "Path of Building reported a different engine identity than the validated installation.", true, {
      expected: installation.engine,
      actual: {
        number: payload.engineVersion,
        branch: payload.engineBranch,
        platform: payload.enginePlatform,
      },
    });
  }
  if (!payload.stats || typeof payload.stats !== "object" || Array.isArray(payload.stats)) {
    return failure("POB_RESULT_INVALID", "Path of Building returned no scalar calculation output.");
  }
  const entries = Object.entries(payload.stats);
  if (entries.length === 0 || entries.length > 4096 || payload.scalarCount !== entries.length) {
    return failure("POB_RESULT_INVALID", "Path of Building returned an invalid scalar output count.");
  }
  for (const [key, value] of entries) {
    if (typeof key !== "string"
      || !(["number", "string", "boolean"].includes(typeof value))
      || (typeof value === "number" && !Number.isFinite(value))) {
      return failure("POB_RESULT_INVALID", "Path of Building returned a non-scalar or non-finite output value.");
    }
  }
  return null;
}

function validateImportWorkerPayload(payload, installation) {
  if (!payload || typeof payload !== "object") {
    return failure("POB_PROTOCOL_ERROR", "The Path of Building worker returned no result object.");
  }
  if (payload.ok !== true) {
    return failure(
      typeof payload.code === "string" ? payload.code : "POB_CHARACTER_IMPORT_FAILED",
      typeof payload.message === "string" ? payload.message : "Path of Building could not import this character.",
      true,
      { detail: typeof payload.detail === "string" ? payload.detail.slice(0, 4000) : undefined },
    );
  }
  if (payload.authoritative !== true || payload.readOnly !== true || payload.freshProcess !== true
    || payload.operation !== "import-character") {
    return failure("POB_AUTHORITY_ASSERTION_FAILED", "The character importer did not assert the required read-only fresh-process contract.");
  }
  if (payload.engineVersion !== installation.engine.number
    || payload.engineBranch !== installation.engine.branch
    || payload.enginePlatform !== installation.engine.platform) {
    return failure("POB_ENGINE_CHANGED", "Path of Building reported a different engine identity than the validated installation.", true, {
      expected: installation.engine,
      actual: {
        number: payload.engineVersion,
        branch: payload.engineBranch,
        platform: payload.enginePlatform,
      },
    });
  }
  if (typeof payload.importedXml !== "string"
    || Buffer.byteLength(payload.importedXml, "utf8") === 0
    || Buffer.byteLength(payload.importedXml, "utf8") > MAX_BUILD_BYTES
    || payload.importedXml.includes("\0")
    || !payload.importedXml.includes("<PathOfBuilding")) {
    return failure("POB_IMPORT_RESULT_INVALID", "Path of Building returned invalid or oversized character XML.");
  }
  if (payload.warnings != null && (!Array.isArray(payload.warnings) || payload.warnings.length > 32)) {
    return failure("POB_IMPORT_RESULT_INVALID", "Path of Building returned an invalid character-import warning list.");
  }
  return null;
}

async function calculateInternal(input, options = {}) {
  if (!input || typeof input.xml !== "string") {
    return failure("POB_XML_INVALID", "A PathOfBuilding XML string is required.");
  }
  const byteLength = Buffer.byteLength(input.xml, "utf8");
  if (byteLength === 0 || byteLength > MAX_BUILD_BYTES || input.xml.includes("\0")
    || !input.xml.includes("<PathOfBuilding")) {
    return failure("POB_XML_INVALID", `The Path of Building XML must be non-empty and no larger than ${MAX_BUILD_BYTES} bytes.`);
  }

  if (options.signal?.aborted) {
    return failure("POB_CANCELLED", "The Path of Building operation was cancelled.", true);
  }
  const installation = inspectInstallation(options);
  if (!installation.ok) return installation;
  if (options.signal?.aborted) {
    return failure("POB_CANCELLED", "The Path of Building operation was cancelled.", true);
  }

  let resources;
  let host;
  try {
    resources = materializeResources(options);
    host = ensureHost(installation.runtimeArchitecture, resources, options);
  } catch (error) {
    return failure(error?.code || "POB_HOST_UNAVAILABLE", "The authoritative Path of Building host is unavailable.", true, {
      detail: normalizeError(error),
    });
  }
  if (options.signal?.aborted) {
    return failure("POB_CANCELLED", "The Path of Building operation was cancelled.", true);
  }

  const startedAt = Date.now();
  const run = await runWorker(host, resources, installation, {
    xml: input.xml,
    name: typeof input.name === "string" ? input.name.slice(0, 512) : "Ninja Lens calculation",
  }, options);
  if (run && run.ok === false) return run;
  const validation = validateWorkerPayload(run.payload, installation);
  if (validation) return validation;

  const after = inspectInstallation(options);
  if (!after.ok || after.engine.sha256 !== installation.engine.sha256
    || after.sourceFingerprint !== installation.sourceFingerprint) {
    return failure("POB_INSTALLATION_CHANGED", "Path of Building changed while the build was being calculated. Retry after its update finishes.", true);
  }

  const payload = run.payload;
  return {
    ok: true,
    authoritative: true,
    contractVersion: CONTRACT_VERSION,
    engine: {
      name: "Path of Building Community",
      version: installation.engine.number,
      branch: installation.engine.branch,
      platform: installation.engine.platform,
      runtimeArchitecture: installation.runtimeArchitecture,
      root: installation.root,
      manifestFingerprint: installation.engine.sha256,
      sourceFingerprint: installation.sourceFingerprint,
      hostFingerprint: host.sha256,
      bridgeFingerprint: resources.fingerprint,
    },
    calculation: {
      outputRevision: payload.outputRevision ?? null,
      targetVersion: payload.targetVersion ?? null,
      className: payload.className ?? null,
      ascendancyName: payload.ascendancyName ?? null,
      mainSocketGroup: payload.mainSocketGroup ?? null,
      mainSkillName: payload.mainSkillName ?? null,
      scalarCount: payload.scalarCount,
      stats: payload.stats,
      warnings: Array.isArray(payload.warnings) ? payload.warnings.slice(0, 32).map((warning) => String(warning).slice(0, 2000)) : [],
      engineMilliseconds: Number.isFinite(payload.calculationMilliseconds) ? payload.calculationMilliseconds : null,
    },
    durationMilliseconds: Date.now() - startedAt,
    isolation: { freshProcess: true, installedPobReadOnly: true, noGuiLaunch: true },
    engineLog: run.engineLog || "",
  };
}

async function importCharacterInternal(input, options = {}) {
  if (!input || !input.character || typeof input.character !== "object" || Array.isArray(input.character)) {
    return failure("POB_CHARACTER_INVALID", "An official Path of Exile character object is required.");
  }
  let characterJson;
  try {
    characterJson = JSON.stringify(input.character);
  } catch (error) {
    return failure("POB_CHARACTER_INVALID", "The character payload could not be encoded.", false, {
      detail: normalizeError(error),
    });
  }
  const byteLength = Buffer.byteLength(characterJson, "utf8");
  if (byteLength === 0 || byteLength > MAX_CHARACTER_BYTES || characterJson.includes("\0")) {
    return failure("POB_CHARACTER_INVALID", `The character payload must be non-empty and no larger than ${MAX_CHARACTER_BYTES} bytes.`);
  }

  if (options.signal?.aborted) {
    return failure("POB_CANCELLED", "The Path of Building operation was cancelled.", true);
  }
  const installation = inspectInstallation(options);
  if (!installation.ok) return installation;
  if (options.signal?.aborted) {
    return failure("POB_CANCELLED", "The Path of Building operation was cancelled.", true);
  }

  let resources;
  let host;
  try {
    resources = materializeResources(options);
    host = ensureHost(installation.runtimeArchitecture, resources, options);
  } catch (error) {
    return failure(error?.code || "POB_HOST_UNAVAILABLE", "The authoritative Path of Building host is unavailable.", true, {
      detail: normalizeError(error),
    });
  }
  if (options.signal?.aborted) {
    return failure("POB_CANCELLED", "The Path of Building operation was cancelled.", true);
  }

  const startedAt = Date.now();
  const run = await runWorker(host, resources, installation, {
    operation: "import-character",
    characterJson,
  }, options);
  if (run && run.ok === false) return run;
  const validation = validateImportWorkerPayload(run.payload, installation);
  if (validation) return validation;

  const after = inspectInstallation(options);
  if (!after.ok || after.engine.sha256 !== installation.engine.sha256
    || after.sourceFingerprint !== installation.sourceFingerprint) {
    return failure("POB_ENGINE_CHANGED", "Path of Building changed while the character was being imported. The result was discarded.", true);
  }

  const payload = run.payload;
  return {
    ok: true,
    authoritative: true,
    contractVersion: CONTRACT_VERSION,
    xml: payload.importedXml,
    engine: {
      name: "Path of Building Community",
      version: installation.engine.number,
      branch: installation.engine.branch,
      platform: installation.engine.platform,
      runtimeArchitecture: installation.runtimeArchitecture,
      root: installation.root,
      manifestFingerprint: installation.engine.sha256,
      sourceFingerprint: installation.sourceFingerprint,
      hostFingerprint: host.sha256,
      bridgeFingerprint: resources.fingerprint,
    },
    warnings: Array.isArray(payload.warnings) ? payload.warnings.slice(0, 32).map((warning) => String(warning).slice(0, 2000)) : [],
    engineMilliseconds: Number.isFinite(payload.importMilliseconds) ? payload.importMilliseconds : null,
    durationMilliseconds: Date.now() - startedAt,
    isolation: { freshProcess: true, installedPobReadOnly: true, noGuiLaunch: true },
    engineLog: run.engineLog || "",
  };
}

let engineQueue = Promise.resolve();
function calculatePobBuild(input, options = {}) {
  const task = engineQueue.then(() => calculateInternal(input, options));
  engineQueue = task.catch(() => undefined);
  return task.catch((error) => failure("POB_BRIDGE_FAILED", "The authoritative Path of Building bridge failed unexpectedly.", true, {
    detail: normalizeError(error),
  }));
}

function importPobCharacter(input, options = {}) {
  const task = engineQueue.then(() => importCharacterInternal(input, options));
  engineQueue = task.catch(() => undefined);
  return task.catch((error) => failure("POB_BRIDGE_FAILED", "The authoritative Path of Building character importer failed unexpectedly.", true, {
    detail: normalizeError(error),
  }));
}

module.exports = {
  CONTRACT_VERSION,
  MAX_BUILD_BYTES,
  MAX_CHARACTER_BYTES,
  PROVEN_ENGINES,
  calculatePobBuild,
  diagnosePobEngine,
  importPobCharacter,
  inspectInstallation,
  _internals: {
    ensureHost,
    runWorker,
    validateImportWorkerPayload,
    materializeResources,
    parseVersionManifest,
    readPeArchitecture,
    validateWorkerPayload,
  },
};
