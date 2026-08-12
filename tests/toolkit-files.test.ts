import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import toolkitFiles from "../electron/toolkit-files.cjs";

const { MAX_IMAGE_BYTES, MAX_TEXT_BYTES, createToolkitFileService } = toolkitFiles;

describe("toolkit file service", () => {
  it("offers Ruthless filters in both filter and general text pickers", async () => {
    const showOpenDialog = vi.fn(async (
      _window: unknown,
      _options: { filters: Array<{ extensions: string[] }> },
    ) => ({ canceled: true, filePaths: [] }));
    const service = createToolkitFileService({
      dialog: { showOpenDialog },
      userDataDirectory: os.tmpdir(),
    });
    await service.openText({}, "filter");
    await service.openText({}, "text");
    for (const call of showOpenDialog.mock.calls) {
      const extensions = call[1].filters.flatMap((filter) => filter.extensions);
      expect(extensions).toContain("ruthlessfilter");
    }
  });

  it("rejects a mismatched Ruthless Save As extension before writing or authorising it", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gloamcore-toolkit-extension-"));
    const wrongTarget = path.join(root, "strict.filter");
    const showSaveDialog = vi.fn(async () => ({
      canceled: false,
      filePath: wrongTarget,
    }));
    const service = createToolkitFileService({
      dialog: { showSaveDialog },
      userDataDirectory: root,
    });

    await expect(service.saveText({}, {
      text: "Minimal\n",
      suggestedName: "strict.ruthlessfilter",
      kind: "filter",
      filterMode: "ruthless",
    })).rejects.toThrow(/Ruthless.*\.ruthlessfilter/i);
    expect(fs.existsSync(wrongTarget)).toBe(false);
    expect(() => service.createCheckpoint({ path: wrongTarget })).toThrow(/Open/);
  });

  it("requires a user-authorised path and restores through a safety checkpoint", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gloamcore-toolkit-files-"));
    const file = path.join(root, "test.filter");
    fs.writeFileSync(file, "Show\n", "utf8");
    const service = createToolkitFileService({
      dialog: {},
      userDataDirectory: path.join(root, "user"),
    });
    expect(() => service.createCheckpoint({ path: file })).toThrow(/Open/);
    service._authoriseForTest(file);
    const first = service.createCheckpoint({ path: file, label: "Before" });
    fs.writeFileSync(file, "Hide\n", "utf8");
    service.restoreCheckpoint({ path: file, id: first.id });
    expect(fs.readFileSync(file, "utf8")).toBe("Show\n");
    expect(service.listCheckpoints(file).length).toBe(2);
  });

  it("rejects symlink targets", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gloamcore-toolkit-link-"));
    const real = path.join(root, "real.filter");
    const linked = path.join(root, "linked.filter");
    fs.writeFileSync(real, "Show\n", "utf8");
    try {
      fs.symlinkSync(real, linked);
    } catch {
      return;
    }
    const service = createToolkitFileService({ dialog: {}, userDataDirectory: root });
    service._authoriseForTest(linked);
    expect(() => service.createCheckpoint({ path: linked })).toThrow(/regular/);
  });

  it("rejects an imported image before base64 can exceed the workspace budget", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gloamcore-toolkit-image-"));
    const image = path.join(root, "large.png");
    fs.writeFileSync(image, Buffer.alloc(MAX_IMAGE_BYTES + 1));
    const service = createToolkitFileService({
      dialog: {
        showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [image] })),
      },
      userDataDirectory: root,
    });
    await expect(service.openImage({})).rejects.toThrow(/375 KB/);
  });

  it("stops a chunked remote import at the byte ceiling without Content-Length", async () => {
    let index = 0;
    const chunks = [new Uint8Array(MAX_TEXT_BYTES), new Uint8Array(1)];
    const response = {
      url: "https://raw.githubusercontent.com/example/project/main/filter.filter",
      ok: true,
      status: 200,
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: vi.fn(async () => index < chunks.length
            ? { done: false, value: chunks[index++] }
            : { done: true, value: undefined }),
          cancel: vi.fn(async () => undefined),
          releaseLock: vi.fn(),
        }),
      },
    } as unknown as Response;
    const service = createToolkitFileService({
      dialog: {},
      userDataDirectory: os.tmpdir(),
      fetchImpl: vi.fn(async () => response),
    });
    await expect(service.fetchRemoteText(
      "https://raw.githubusercontent.com/example/project/main/filter.filter",
    )).rejects.toThrow(/unexpectedly large/i);
  });

  it("validates a redirect before issuing a request to its destination", async () => {
    const fetchImpl = vi.fn(async () => ({
      url: "https://pobb.in/example",
      ok: false,
      status: 302,
      headers: new Headers({ location: "http://127.0.0.1/private" }),
    } as Response));
    const service = createToolkitFileService({
      dialog: {},
      userDataDirectory: os.tmpdir(),
      fetchImpl,
    });
    await expect(service.fetchRemoteText("https://pobb.in/example")).rejects.toThrow(/unsupported host/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });
});
