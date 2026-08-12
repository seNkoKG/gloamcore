import { describe, expect, it } from "vitest";
import { resolvePackageManagerInvocation, writeTextIfChanged } from "./generate-third-party-notices.mjs";

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
