import { describe, expect, it } from "vitest";
import {
  resolvePackageManagerInvocation,
  resolvePackageManagerPath,
  writeTextIfChanged,
} from "./generate-third-party-notices.mjs";

describe("third-party notice package-manager resolution", () => {
  const fileSystem = {
    existsSync: (candidate: string) => candidate === "C:\\pnpm-home\\pnpm.exe",
  };

  it("keeps using an existing npm_execpath", () => {
    expect(resolvePackageManagerPath({
      npmExecPath: "/opt/corepack/pnpm.cjs",
      explicitPath: "/opt/explicit/pnpm.cjs",
      pnpmHome: "/opt/pnpm",
      platform: "linux",
      fileSystem: { existsSync: () => true },
    })).toBe("/opt/corepack/pnpm.cjs");
  });

  it("uses an existing explicit path when npm_execpath is unavailable", () => {
    expect(resolvePackageManagerPath({
      npmExecPath: "/opt/missing/pnpm.cjs",
      explicitPath: "/opt/explicit/pnpm.cjs",
      platform: "linux",
      fileSystem: { existsSync: (candidate: string) => candidate === "/opt/explicit/pnpm.cjs" },
    })).toBe("/opt/explicit/pnpm.cjs");
  });

  it("uses the pnpm executable installed in PNPM_HOME on Windows", () => {
    expect(resolvePackageManagerPath({
      pnpmHome: "C:\\pnpm-home",
      platform: "win32",
      fileSystem,
    })).toBe("C:\\pnpm-home\\pnpm.exe");
  });

  it("falls back from a missing npm_execpath to PNPM_HOME", () => {
    expect(resolvePackageManagerPath({
      npmExecPath: "C:\\missing\\pnpm.cjs",
      pnpmHome: "C:\\pnpm-home",
      platform: "win32",
      fileSystem,
    })).toBe("C:\\pnpm-home\\pnpm.exe");
  });

  it("uses the native pnpm name in PNPM_HOME on non-Windows platforms", () => {
    expect(resolvePackageManagerPath({
      pnpmHome: "/opt/pnpm",
      platform: "linux",
      fileSystem: { existsSync: (candidate: string) => candidate === "/opt/pnpm/pnpm" },
    })).toBe("/opt/pnpm/pnpm");
  });
});

describe("third-party notice package-manager launcher", () => {
  it.each(["pnpm.js", "pnpm.cjs", "pnpm.mjs", "PNPM.CJS"])(
    "runs JavaScript entrypoint %s through Node",
    (packageManager) => {
      expect(resolvePackageManagerInvocation(packageManager, "node-runtime")).toEqual({
        command: "node-runtime",
        leadingArgs: [packageManager],
      });
    },
  );

  it.each(["pnpm.exe", "pnpm.cmd", "pnpm"])(
    "runs native entrypoint %s directly",
    (packageManager) => {
      expect(resolvePackageManagerInvocation(packageManager, "node-runtime")).toEqual({
        command: packageManager,
        leadingArgs: [],
      });
    },
  );
});

describe("third-party notice writes", () => {
  it("does not dirty an unchanged generated notice", () => {
    const writes: unknown[][] = [];
    const fileSystem = {
      readFileSync: () => "same notice",
      writeFileSync: (...args: unknown[]) => writes.push(args),
    };

    expect(writeTextIfChanged("notice.txt", "same notice", fileSystem)).toBe(false);
    expect(writes).toEqual([]);
  });

  it("writes a changed generated notice", () => {
    const writes: unknown[][] = [];
    const fileSystem = {
      readFileSync: () => "old notice",
      writeFileSync: (...args: unknown[]) => writes.push(args),
    };

    expect(writeTextIfChanged("notice.txt", "new notice", fileSystem)).toBe(true);
    expect(writes).toEqual([["notice.txt", "new notice", "utf8"]]);
  });
});
