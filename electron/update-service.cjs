const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const DEFAULT_START_DELAY_MS = 12 * 1000;

function normalizeFeedUrl(value) {
  if (!value || typeof value !== "string") return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function normalizeGitHubCoordinate(value, maximumLength) {
  if (typeof value !== "string") return "";
  const coordinate = value.trim();
  if (
    coordinate.length === 0 ||
    coordinate.length > maximumLength ||
    coordinate === "." ||
    coordinate === ".." ||
    !/^[A-Za-z0-9._-]+$/.test(coordinate)
  ) {
    return "";
  }
  return coordinate;
}

function normalizeUpdateSource(value) {
  if (typeof value === "string") {
    const url = normalizeFeedUrl(value);
    return url ? { provider: "generic", url } : null;
  }
  if (!value || typeof value !== "object") return null;
  if (value.provider === "generic") {
    const url = normalizeFeedUrl(value.url);
    return url ? { provider: "generic", url } : null;
  }
  if (value.provider !== "github") return null;
  const owner = normalizeGitHubCoordinate(value.owner, 39);
  const repo = normalizeGitHubCoordinate(value.repo, 100);
  if (!owner || !repo) return null;
  // Intentionally copy only public provider coordinates. Tokens and private
  // repository flags are never accepted from the shipped configuration.
  return { provider: "github", owner, repo };
}

function readConfiguredUpdateSource({
  resourcesPath,
  appRoot,
  environment = process.env,
  allowEnvironment = false,
}) {
  if (allowEnvironment) {
    const environmentSource = normalizeUpdateSource(
      environment.GLOAMCORE_UPDATE_URL,
    );
    if (environmentSource) return environmentSource;
  }
  const candidates = [
    path.join(resourcesPath, "update-config.json"),
    path.join(appRoot, "build", "update-config.json"),
  ];
  for (const candidate of candidates) {
    try {
      const config = JSON.parse(fs.readFileSync(candidate, "utf8"));
      if (config.enabled !== true) continue;
      const configured = normalizeUpdateSource(config);
      if (configured) return configured;
    } catch {
      // Missing or invalid configuration means updates remain safely disabled.
    }
  }
  return null;
}

// Retain the established import name used by the main process while returning
// a complete electron-updater provider configuration rather than only a URL.
const readConfiguredFeedUrl = readConfiguredUpdateSource;

function updaterMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error || "Unknown update error");
}

function normalizeUpdateChannel(value) {
  return value === "preview" ? "preview" : "stable";
}

class UpdateService {
  constructor({
    app,
    feedUrl,
    autoCheck = true,
    channel = "stable",
    portable = false,
    updater,
    createUpdater,
    onState = () => undefined,
    startDelayMs = DEFAULT_START_DELAY_MS,
    checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
    diagnosticsPath = "",
  }) {
    this.app = app;
    this.portable = Boolean(portable);
    this.updateSource = this.portable ? null : normalizeUpdateSource(feedUrl);
    this.feedUrl = this.updateSource?.provider === "generic"
      ? this.updateSource.url
      : this.updateSource?.provider === "github"
        ? `https://github.com/${this.updateSource.owner}/${this.updateSource.repo}/releases`
        : "";
    this.autoCheck = Boolean(autoCheck);
    this.channel = normalizeUpdateChannel(channel);
    this.onState = onState;
    this.startDelayMs = Math.max(0, Number(startDelayMs) || 0);
    this.checkIntervalMs = Math.max(60_000, Number(checkIntervalMs) || 0);
    this.diagnosticsPath = diagnosticsPath;
    this.startTimer = null;
    this.intervalTimer = null;
    this.updater = this.updateSource ? updater || null : null;
    this.state = {
      status: this.updateSource ? "idle" : "unconfigured",
      currentVersion: app.getVersion(),
      message: this.portable
        ? "Portable builds update manually from GitHub Releases"
        : this.updateSource
          ? "Ready to check for updates"
          : "Update hosting is not connected yet",
      feedConfigured: Boolean(this.updateSource),
      channel: this.channel,
    };

    if (this.updateSource && !this.updater) {
      if (typeof createUpdater === "function") {
        this.updater = createUpdater(this.updateSource);
      } else {
        const { NsisUpdater } = require("electron-updater");
        this.updater = new NsisUpdater(this.updateSource);
      }
    }

    if (this.updater) this.bindUpdater();
  }

  bindUpdater() {
    this.updater.autoDownload = true;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.allowPrerelease = this.channel === "preview";

    this.updater.on("checking-for-update", () => {
      this.publish({
        status: "checking",
        message: "Checking for a new version…",
      });
    });
    this.updater.on("update-available", (info) => {
      this.publish({
        status: "available",
        version: info?.version,
        message: `Version ${info?.version || "new"} is available`,
        checkedAt: Date.now(),
      });
    });
    this.updater.on("update-not-available", (info) => {
      this.publish({
        status: "not-available",
        version: info?.version || this.app.getVersion(),
        progress: undefined,
        message: "You have the latest version",
        checkedAt: Date.now(),
      });
    });
    this.updater.on("download-progress", (progress) => {
      this.publish({
        status: "downloading",
        progress: Math.max(0, Math.min(100, Number(progress?.percent) || 0)),
        message: `Downloading update · ${Math.round(Number(progress?.percent) || 0)}%`,
      });
    });
    this.updater.on("update-downloaded", (info) => {
      this.publish({
        status: "downloaded",
        version: info?.version,
        progress: 100,
        message: `Version ${info?.version || "new"} is ready to install`,
        checkedAt: Date.now(),
      });
    });
    this.updater.on("error", (error) => {
      this.publish({
        status: "error",
        progress: undefined,
        message: updaterMessage(error),
        checkedAt: Date.now(),
      });
    });
  }

  publish(patch) {
    this.state = {
      ...this.state,
      ...patch,
      currentVersion: this.app.getVersion(),
      feedConfigured: Boolean(this.updateSource),
      channel: this.channel,
    };
    this.onState(this.getState());
    this.writeDiagnostics();
    return this.getState();
  }

  writeDiagnostics() {
    if (!this.diagnosticsPath) return;
    try {
      const target = path.resolve(this.diagnosticsPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(this.state, null, 2), "utf8");
    } catch {
      // Diagnostics are QA-only and must never interfere with the updater.
    }
  }

  getState() {
    return { ...this.state };
  }

  setAutoCheck(value) {
    this.autoCheck = Boolean(value);
    if (this.autoCheck) this.schedule();
    else this.clearSchedule();
  }

  setChannel(value) {
    const next = normalizeUpdateChannel(value);
    if (next === this.channel) return this.getState();
    this.channel = next;
    if (this.updater) this.updater.allowPrerelease = next === "preview";
    return this.publish({
      status: this.updateSource ? "idle" : "unconfigured",
      version: undefined,
      progress: undefined,
      message: this.updateSource
        ? next === "preview"
          ? "Preview releases are enabled"
          : "Stable releases only"
        : this.state.message,
    });
  }

  start() {
    this.publish({});
    if (this.autoCheck) this.schedule();
  }

  schedule() {
    if (!this.updateSource || !this.updater || !this.app.isPackaged) return;
    this.clearSchedule();
    this.startTimer = setTimeout(() => void this.check(), this.startDelayMs);
    this.intervalTimer = setInterval(
      () => void this.check(),
      this.checkIntervalMs,
    );
    this.startTimer.unref?.();
    this.intervalTimer.unref?.();
  }

  clearSchedule() {
    clearTimeout(this.startTimer);
    clearInterval(this.intervalTimer);
    this.startTimer = null;
    this.intervalTimer = null;
  }

  async check() {
    if (!this.updateSource || !this.updater) return this.getState();
    if (!this.app.isPackaged) {
      return this.publish({
        status: "error",
        message: "Update checks run only from an installed or portable build",
      });
    }
    if (this.state.status === "checking" || this.state.status === "downloading") {
      return this.getState();
    }
    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      this.publish({
        status: "error",
        progress: undefined,
        message: updaterMessage(error),
        checkedAt: Date.now(),
      });
    }
    return this.getState();
  }

  install() {
    if (this.state.status !== "downloaded" || !this.updater) return false;
    this.updater.quitAndInstall(false, true);
    return true;
  }

  dispose() {
    this.clearSchedule();
    this.updater?.removeAllListeners?.();
  }
}

module.exports = {
  UpdateService,
  normalizeFeedUrl,
  normalizeUpdateSource,
  normalizeUpdateChannel,
  readConfiguredFeedUrl,
  readConfiguredUpdateSource,
};
