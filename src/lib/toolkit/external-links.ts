const TRUSTED_TOOLKIT_EXTERNAL_HOSTS = new Set([
  "poe.ninja",
  "www.pathofexile.com",
  "www.poewiki.net",
  "www.craftofexile.com",
  "craftofexile.com",
  "poedb.tw",
  "www.poedb.tw",
]);

function safeHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.port === "" || url.port === "443") &&
      !url.username &&
      !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

/** Mirrors the desktop openExternal allowlist without broadening it. */
export function trustedToolkitExternalUrl(value: string) {
  const url = safeHttpsUrl(value);
  return url && TRUSTED_TOOLKIT_EXTERNAL_HOSTS.has(url.hostname) ? url : null;
}

/** Plugin documents may be arbitrary HTTPS because their iframe has no same-origin privilege. */
export function sandboxedPluginUrl(value: string) {
  return safeHttpsUrl(value);
}
