import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const playerPath = fileURLToPath(new URL("../scripts/vb_cable_player.py", import.meta.url));

/** Routes authenticated Wi-Fi PCM frames to VB-CABLE's playback endpoint. */
export function attachVbCableSink(receiver, { python = "python", device, diagnosticFd = 1 } = {}) {
  const args = [playerPath];
  if (device) args.push("--device", device);
  const player = spawn(python, args, { stdio: ["pipe", diagnosticFd, 2], windowsHide: true });
  let closed = false;
  const onAudio = ({ pcm }) => {
    if (!closed && !player.stdin.destroyed) player.stdin.write(pcm);
  };
  receiver.on("audio", onAudio);
  return {
    player,
    async close() {
      if (closed) return;
      closed = true;
      receiver.off("audio", onAudio);
      player.stdin.end();
      await new Promise((resolve) => player.once("close", resolve));
    },
  };
}
