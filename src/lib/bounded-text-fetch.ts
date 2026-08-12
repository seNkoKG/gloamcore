import { trustedExternalUrl } from "./mobile-network";

export const MAX_TOOLKIT_TEXT_BYTES = 24 * 1024 * 1024;
export const TOOLKIT_FETCH_TIMEOUT_MS = 20_000;

export async function fetchBoundedToolkitText(
  value: string,
  {
    fetchImpl = fetch,
    maximumBytes = MAX_TOOLKIT_TEXT_BYTES,
    timeoutMilliseconds = TOOLKIT_FETCH_TIMEOUT_MS,
  }: {
    fetchImpl?: typeof fetch;
    maximumBytes?: number;
    timeoutMilliseconds?: number;
  } = {},
) {
  const requested = trustedExternalUrl(value);
  if (!requested) throw new Error("Blocked an untrusted import URL.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMilliseconds);
  try {
    const response = await fetchImpl(requested, {
      redirect: "error",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Import failed: ${response.status}`);
    if (response.url) {
      const finalUrl = trustedExternalUrl(response.url);
      if (!finalUrl || finalUrl.href !== requested.href) {
        throw new Error("Import redirects are not allowed.");
      }
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
      throw new Error("Import exceeds the 24 MiB safety limit.");
    }
    if (!response.body) {
      const body = new Uint8Array(await response.arrayBuffer());
      if (body.byteLength > maximumBytes) throw new Error("Import exceeds the 24 MiB safety limit.");
      return new TextDecoder("utf-8", { fatal: true }).decode(body);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let text = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        throw new Error("Import exceeds the 24 MiB safety limit.");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    clearTimeout(timer);
  }
}
