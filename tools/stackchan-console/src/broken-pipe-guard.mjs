const PIPE_CLOSED_CODES = new Set(["EPIPE", "ECONNRESET"]);

function streamName(stream, index) {
  if (stream === process.stdout) return "stdout";
  if (stream === process.stderr) return "stderr";
  return `stream_${index + 1}`;
}

// Electron can still complete an ipcMain reply after the GUI launcher has
// closed the inherited console pipe.  Node then emits an `error` event on the
// affected stdio stream; without a listener that event terminates the owner.
// Keep this boundary deliberately narrow: it only absorbs an already-closed
// peer and reports it through the caller's non-console sink.
export function installBrokenPipeGuards({ streams = [process.stdout, process.stderr], onClosedPeer = () => {}, onUnexpectedError = () => {} } = {}) {
  if (!Array.isArray(streams)) throw new TypeError("streams must be an array");
  if (typeof onClosedPeer !== "function" || typeof onUnexpectedError !== "function") {
    throw new TypeError("broken pipe callbacks must be functions");
  }
  const attached = [];
  for (const [index, stream] of streams.entries()) {
    if (!stream || typeof stream.on !== "function" || attached.includes(stream)) continue;
    const name = streamName(stream, index);
    const handler = (error) => {
      const details = { stream: name, code: error?.code ?? "UNKNOWN", message: String(error?.message ?? error) };
      if (PIPE_CLOSED_CODES.has(error?.code)) onClosedPeer(details);
      else onUnexpectedError(details);
    };
    stream.on("error", handler);
    attached.push({ stream, handler });
  }
  return () => {
    for (const { stream, handler } of attached) stream.removeListener?.("error", handler);
  };
}
