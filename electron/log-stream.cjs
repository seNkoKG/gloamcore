const protectedStreams = new WeakSet();

function protectLogStream(stream) {
  if (
    !stream ||
    (typeof stream !== "object" && typeof stream !== "function") ||
    typeof stream.on !== "function" ||
    protectedStreams.has(stream)
  ) {
    return false;
  }

  // Logging is diagnostic only. A detached parent process can close a GUI
  // app's inherited pipe while Electron is still alive; consuming that stream
  // error prevents an EPIPE from becoming a main-process crash dialog.
  stream.on("error", () => {});
  protectedStreams.add(stream);
  return true;
}

module.exports = { protectLogStream };
