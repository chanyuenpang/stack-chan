import { createServer } from "node:net";

import { WIFI_AUDIO_FRAME_BYTES } from "./wifi-audio-receiver.mjs";

export const DEFAULT_SPEAKER_PIPE = process.platform === "win32"
  ? "\\\\.\\pipe\\stackchan-wifi-speaker"
  : "/tmp/stackchan-wifi-speaker.sock";

/** Accepts paced 24 kHz mono s16le PCM from a local process and forwards it. */
export function attachSpeakerPipe(receiver, { path = DEFAULT_SPEAKER_PIPE, maxPendingFrames = 12, onDrop } = {}) {
  if (!Number.isInteger(maxPendingFrames) || maxPendingFrames < 1) {
    throw new TypeError("maxPendingFrames must be a positive integer");
  }
  const pending = [];
  const sockets = new Set();
  const stats = { receivedFrames: 0, sentFrames: 0, droppedFrames: 0, maxPendingFrames: 0 };
  let activeSend = Promise.resolve();
  let sending = false;

  const drain = () => {
    if (sending || pending.length === 0) return;
    sending = true;
    const frame = pending.shift();
    activeSend = receiver.sendSpeakerPcm(frame)
      .then(() => { stats.sentFrames += 1; })
      .catch((error) => {
        pending.length = 0;
        for (const socket of sockets) socket.destroy(error);
      })
      .finally(() => {
        sending = false;
        drain();
      });
  };

  const server = createServer((socket) => {
    sockets.add(socket);
    let buffered = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= WIFI_AUDIO_FRAME_BYTES) {
        const frame = Buffer.from(buffered.subarray(0, WIFI_AUDIO_FRAME_BYTES));
        buffered = buffered.subarray(WIFI_AUDIO_FRAME_BYTES);
        stats.receivedFrames += 1;
        if (pending.length >= maxPendingFrames) {
          pending.shift();
          stats.droppedFrames += 1;
          onDrop?.({ ...stats, pendingFrames: pending.length });
        }
        pending.push(frame);
        stats.maxPendingFrames = Math.max(stats.maxPendingFrames, pending.length);
        drain();
      }
    });
    socket.once("close", () => sockets.delete(socket));
  });
  server.listen(path);
  return {
    path,
    server,
    get stats() { return { ...stats, pendingFrames: pending.length, sending }; },
    async close() {
      for (const socket of sockets) socket.destroy();
      pending.length = 0;
      await activeSend.catch(() => {});
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
