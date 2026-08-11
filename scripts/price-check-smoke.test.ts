import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const smokePath = path.join(projectRoot, "scripts", "price-check-smoke.ps1");
const smoke = fs.readFileSync(smokePath, "utf8");
const compact = smoke.replace(/\s+/g, " ");
const packageMetadata = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
) as { version?: string };

function expectOrdered(...fragments: string[]) {
  let previous = -1;
  for (const fragment of fragments) {
    const current = smoke.indexOf(fragment);
    expect(current, `Missing smoke fragment: ${fragment}`).toBeGreaterThan(previous);
    previous = current;
  }
}

describe("native price-check smoke harness", () => {
  it("binds source and packaged runs to the current 2.8.1 release identity", () => {
    expect(packageMetadata.version).toBe("2.8.1");
    expect(smoke).toContain('(Join-Path $projectRoot "package.json")');
    expect(smoke).toContain(").version)");
    expect(smoke).toContain("$provenance.gitHead -ne $snapshotHead.Trim()");
    expect(smoke).toContain("Get-FileHash -LiteralPath $proof.Path -Algorithm SHA256");
    expect(smoke).toContain("Packaged $($proof.Label) does not match recorded release provenance.");
  });

  it("serializes machine-wide focus state and proves the exact signed target identity", () => {
    expect(smoke).toContain('"Local\\GloamCorePriceCheckSmoke"');
    expect(smoke).toContain("$smokeMutex.WaitOne(45000)");
    expect(smoke).toContain("$qaHostSignature.Status -ne [System.Management.Automation.SignatureStatus]::Valid");
    expect(compact).toContain(
      "([DateTime]::UtcNow - $focusStableSince).TotalMilliseconds -ge 750",
    );
    expect(compact).toContain(
      "[GloamCoreQaWindow]::GetForegroundWindow() -ne $qaTargetWindow",
    );
    expect(smoke).toContain("$identityProbe = Start-Process");
    expect(smoke).toContain('"inspect"');
    expect(smoke).toContain('"GloamCoreQaTarget.exe"');
    expect(smoke).toContain(
      "Synthetic target failed native identity readiness with code $($identityProbe.ExitCode).",
    );
    expect(smoke).toContain("GLOAMCORE_QA_NATIVE_CLOSE_SIGNAL_PATH");
    expect(smoke).toContain("[GloamCoreQaWindow]::mouse_event(0x0002");
    expect(smoke).toContain("[GloamCoreQaWindow]::mouse_event(0x0004");
    expect(smoke).toContain(
      "Native close QA could not accept the app's target-focus handoff.",
    );

    expectOrdered(
      "$smokeMutex.WaitOne(45000)",
      "$qaTargetProcess = Start-Process",
      "$focusStableSince = $null",
      "$identityProbe = Start-Process",
      "$appProcess = Start-Process @launch",
    );
  });

  it("keeps passive and dismissed overlay hosts non-focusable", () => {
    expect(smoke).toContain("$result.lifecycle.passiveInitial.overlayFocusable -or");
    expect(smoke).toContain("$result.lifecycle.passiveRepeat.overlayFocusable -or");
    expect(smoke).toContain("$result.dismissal.overlayFocusable -or");
    expect(smoke).not.toContain("-not $result.dismissal.overlayFocusable -or");
  });

  it("uses the canonical Advanced Mageblood copy and exact Awakened model", () => {
    for (const advancedLine of [
      "{ Implicit Modifier $emDash Attribute }",
      "+31(25-35) to Strength",
      "{ Unique Modifier $emDash Attribute }",
      "+31(30-50) to Dexterity",
      "+20(15-25)% to Fire Resistance",
      "+19(15-25)% to Cold Resistance",
      "Leftmost 4(2-4) Magic Utility Flasks constantly apply their Flask Effects to you",
    ]) {
      expect(smoke).toContain(advancedLine);
    }
    expect(smoke).toContain('$result.result.editorHeading -ne "1/7 STATS"');
    expect(smoke).toContain("$result.result.modifierRows -ne 4");
    expect(smoke).toContain("$result.result.rangeSliders -ne 8");
    for (const visibleLabel of [
      "39% total Elemental Resistance",
      "31 total to Strength",
      "31 total to Dexterity",
      "Leftmost 4 Magic Utility Flask constantly applies its Flask Effect to you",
    ]) {
      expect(smoke).toContain(visibleLabel);
    }
    expect(smoke).toContain(
      "Canonical Mageblood exposed upstream-hidden stats or an optional-stat fold.",
    );
    expect(smoke).toContain(
      "NO PRICE was not backed by a live official listing with a positive finite price.",
    );
    expect(smoke).toContain("$result.result.listingRows -lt 1");
    expect(smoke).toContain("$positiveListingPrice");
    expect(smoke).not.toContain("selected-first compact contract");
    expect(smoke).toContain("$result.result.modifierRows -ne 8");
  });

  it("locks complete ordinary rows and the hidden crafted-helper denominator", () => {
    expect(smoke).toContain('$result.result.editorHeading -ne "0/10 STATS"');
    expect(smoke).toContain("$result.result.modifierRows -ne 9");
    expect(smoke).toContain("$result.result.rangeSliders -ne 0");
    expectOrdered(
      '$expectedWeaponPropertyLabels = @(',
      '"Physical DPS"',
      '"Attacks per Second"',
      '"Critical Strike Chance"',
    );
    expect(smoke).toContain(
      "Crafted wand compact summary did not keep its hidden helper in the ten-stat total.",
    );
    expect(smoke).toContain(
      '$result.result.text -match "\\b(?:SHOW|HIDE)\\s+\\d+\\b"',
    );
    expect(smoke).toContain("$result.result.modifierRows -ne 8");
    expect(smoke).toContain("$result.result.modifierListOverflow -ne 0");
    expect(compact).toContain(
      "$result.result.layoutHeights.modifierListScroll -ne $result.result.layoutHeights.modifierListClient",
    );
    expect(smoke).toContain(
      "The complete modifier list retained an internal scrollbar:",
    );
  });

  it("restores the prior foreground and cleans only its isolated processes and temp root", () => {
    expect(smoke).toContain(
      "$originalForegroundWindow = [GloamCoreQaWindow]::GetForegroundWindow()",
    );
    expect(smoke).toContain(
      "[GloamCoreQaWindow]::IsWindow($originalForegroundWindow)",
    );
    expect(smoke).toContain(
      "[void][GloamCoreQaWindow]::SetForegroundWindow($originalForegroundWindow)",
    );
    expect(smoke).toContain(
      "$qaRootFull.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)",
    );
    expect(smoke).toContain("Remove-Item -LiteralPath $qaRootFull -Recurse -Force");
    expect(smoke).not.toMatch(/\btaskkill\b|Stop-Process\s+-(?:Name|InputObject)/i);

    expectOrdered(
      "if ($appProcess -and -not $appProcess.HasExited)",
      "if ($qaTargetProcess -and -not $qaTargetProcess.HasExited)",
      "[void][GloamCoreQaWindow]::SetForegroundWindow($originalForegroundWindow)",
      "$smokeMutex.ReleaseMutex()",
    );
  });
});
