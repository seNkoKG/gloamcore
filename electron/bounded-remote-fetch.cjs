"use strict";

function assertTrustedRemoteUrl(value, kind) {
  const url = new URL(value);
  const common =
    url.protocol === "https:" &&
    (url.port === "" || url.port === "443") &&
    !url.username &&
    !url.password;
  const allowed = kind === "image"
    ? common && url.hostname === "www.poewiki.net" && url.pathname.startsWith("/images/")
    : common && (
        (
          url.hostname === "senkokg.github.io" &&
          (
            url.pathname === "/gloamcore/data/poe-ninja/v1/manifest.json" ||
            /^\/gloamcore\/data\/poe-ninja\/v1\/routes\/[a-f0-9]{64}\.json$/.test(url.pathname)
          ) &&
          url.search === "" &&
          url.hash === ""
        ) ||
        (url.hostname === "www.poewiki.net" && url.pathname === "/w/api.php") ||
        (
          url.hostname === "web.poecdn.com" &&
          /^\/api\/currency-exchange\/[1-9]\d{9}$/.test(url.pathname) &&
          url.search === "" &&
          url.hash === ""
        )
      );
  if (!allowed) throw new Error("Rejected an untrusted remote data URL.");
  return url.toString();
}

async function readResponseBufferLimited(response, maximumBytes, label, controller) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    controller.abort();
    throw new Error(`${label} returned an unexpectedly large response.`);
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    controller.abort();
    throw new Error(`${label} did not provide a bounded response stream.`);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maximumBytes) {
        controller.abort();
        throw new Error(`${label} returned an unexpectedly large response.`);
      }
      chunks.push(chunk);
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // The abort already closes a stream that disappeared mid-read.
    }
    throw error;
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, total);
}

async function fetchTrustedLimited(url, {
  headers,
  kind,
  label,
  maximumBytes,
  timeoutMs,
  fetchImpl = fetch,
}) {
  const trustedUrl = assertTrustedRemoteUrl(url, kind);
  const controller = new AbortController();
  const deadlineMs = Math.max(
    100,
    Math.min(60_000, Math.round(Number(timeoutMs) || 20_000)),
  );
  const timeout = setTimeout(
    () => controller.abort(new Error(`${label} request timed out.`)),
    deadlineMs,
  );
  try {
    const response = await fetchImpl(trustedUrl, {
      headers,
      redirect: "error",
      signal: controller.signal,
    });
    assertTrustedRemoteUrl(response.url || trustedUrl, kind);
    const body = response.status === 304
      ? Buffer.alloc(0)
      : await readResponseBufferLimited(
          response,
          maximumBytes,
          label,
          controller,
        );
    return { response, body };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  assertTrustedRemoteUrl,
  fetchTrustedLimited,
  readResponseBufferLimited,
};
