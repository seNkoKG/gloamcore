import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  normalizeFeedUrl,
  normalizeUpdateSource,
  readConfiguredFeedUrl,
  readConfiguredUpdateSource,
  UpdateService,
} = require("../electron/update-service.cjs") as {
  normalizeFeedUrl(value: unknown): string;
  normalizeUpdateSource(value: unknown):
    | { provider: "generic"; url: string }
    | { provider: "github"; owner: string; repo: string }
    | null;
  readConfiguredFeedUrl(options: {
    resourcesPath: string;
    appRoot: string;
    environment?: Record<string, string | undefined>;
    allowEnvironment?: boolean;
  }):
    | { provider: "generic"; url: string }
    | { provider: "github"; owner: string; repo: string }
    | null;
  readConfiguredUpdateSource(options: {
    resourcesPath: string;
    appRoot: string;
    environment?: Record<string, string | undefined>;
    allowEnvironment?: boolean;
  }):
    | { provider: "generic"; url: string }
    | { provider: "github"; owner: string; repo: string }
    | null;
  UpdateService: new (options: Record<string, unknown>) => {
    check(): Promise<Record<string, unknown>>;
    getState(): Record<string, unknown>;
    install(): boolean;
    setChannel(value: unknown): Record<string, unknown>;
    dispose(): void;
  };
};

class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowPrerelease = true;
  quitAndInstall = vi.fn();

  async checkForUpdates() {
    this.emit("checking-for-update");
    this.emit("update-not-available", { version: "1.2.0" });
  }
}

const app = {
  getVersion: () => "1.2.0",
  isPackaged: true,
};

describe("update service", () => {
  it("accepts only HTTPS update feeds and normalizes trailing slashes", () => {
    expect(normalizeFeedUrl("https://updates.example.test/widget///")).toBe(
      "https://updates.example.test/widget",
    );
    expect(normalizeFeedUrl("http://127.0.0.1:9000/releases")).toBe("");
    expect(normalizeFeedUrl("file:///tmp/releases")).toBe("");
    expect(normalizeFeedUrl("javascript:alert(1)")).toBe("");
  });

  it("accepts only public GitHub coordinates and discards authentication fields", () => {
    expect(
      normalizeUpdateSource({
        provider: "github",
        owner: "seNkoKG",
        repo: "gloamcore",
        private: true,
        token: "must-not-be-used",
      }),
    ).toEqual({
      provider: "github",
      owner: "seNkoKG",
      repo: "gloamcore",
    });
    expect(
      normalizeUpdateSource({
        provider: "github",
        owner: "seNkoKG/path",
        repo: "gloamcore",
      }),
    ).toBeNull();
    expect(normalizeUpdateSource({ provider: "s3" })).toBeNull();
  });

  it("loads the shipped public GitHub release channel", () => {
    const source = readConfiguredUpdateSource({
      resourcesPath: "Z:/missing",
      appRoot: process.cwd(),
    });
    expect(source).toEqual({
      provider: "github",
      owner: "seNkoKG",
      repo: "gloamcore",
    });
    expect(source).not.toHaveProperty("token");
    expect(source).not.toHaveProperty("private");
  });

  it("prefers a valid environment feed over packaged configuration", () => {
    expect(
      readConfiguredFeedUrl({
        resourcesPath: "Z:/missing",
        appRoot: "Z:/missing",
        environment: {
          GLOAMCORE_UPDATE_URL: "https://updates.example.test/widget/",
        },
        allowEnvironment: true,
      }),
    ).toEqual({
      provider: "generic",
      url: "https://updates.example.test/widget",
    });
  });

  it("ignores environment overrides in packaged mode by default", () => {
    expect(
      readConfiguredFeedUrl({
        resourcesPath: "Z:/missing",
        appRoot: "Z:/missing",
        environment: {
          GLOAMCORE_UPDATE_URL: "https://updates.example.test/widget/",
        },
      }),
    ).toBeNull();
  });

  it("constructs electron-updater with the official GitHub provider", () => {
    const updater = new FakeUpdater();
    const createUpdater = vi.fn(() => updater);
    const service = new UpdateService({
      app,
      feedUrl: {
        provider: "github",
        owner: "seNkoKG",
        repo: "gloamcore",
      },
      createUpdater,
      autoCheck: false,
    });

    expect(createUpdater).toHaveBeenCalledWith({
      provider: "github",
      owner: "seNkoKG",
      repo: "gloamcore",
    });
    expect(service.getState()).toMatchObject({
      status: "idle",
      feedConfigured: true,
    });
    service.dispose();
  });

  it("keeps stable as the default and enables prereleases only after opt-in", () => {
    const updater = new FakeUpdater();
    const service = new UpdateService({
      app,
      updater,
      feedUrl: "https://updates.example.test/widget",
      autoCheck: false,
    });
    expect(updater.allowPrerelease).toBe(false);
    expect(service.getState()).toMatchObject({ channel: "stable" });
    expect(service.setChannel("preview")).toMatchObject({ channel: "preview" });
    expect(updater.allowPrerelease).toBe(true);
    service.setChannel("unknown");
    expect(updater.allowPrerelease).toBe(false);
    service.dispose();
  });

  it("keeps portable builds on explicit manual downloads", () => {
    const updater = new FakeUpdater();
    const createUpdater = vi.fn(() => updater);
    const service = new UpdateService({
      app,
      feedUrl: {
        provider: "github",
        owner: "seNkoKG",
        repo: "gloamcore",
      },
      portable: true,
      createUpdater,
      autoCheck: true,
    });

    expect(createUpdater).not.toHaveBeenCalled();
    expect(service.getState()).toMatchObject({
      status: "unconfigured",
      feedConfigured: false,
      message: "Portable builds update manually from GitHub Releases",
    });
    service.dispose();
  });

  it("publishes update checks and leaves installation locked until downloaded", async () => {
    const updater = new FakeUpdater();
    const states: Array<Record<string, unknown>> = [];
    const service = new UpdateService({
      app,
      updater,
      feedUrl: "https://updates.example.test/widget",
      autoCheck: false,
      onState: (state: Record<string, unknown>) => states.push(state),
    });

    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(service.install()).toBe(false);
    const result = await service.check();
    expect(result.status).toBe("not-available");
    expect(states.map((state) => state.status)).toContain("checking");
    expect(states.at(-1)?.message).toBe("You have the latest version");

    updater.emit("update-downloaded", { version: "1.3.0" });
    expect(service.getState().status).toBe("downloaded");
    expect(service.install()).toBe(true);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
    service.dispose();
  });
});
