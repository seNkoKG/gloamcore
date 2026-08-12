import { describe, expect, it } from "vitest";
import { resolvePackageManagerInvocation } from "./generate-third-party-notices.mjs";

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
