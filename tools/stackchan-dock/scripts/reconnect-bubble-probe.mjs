import { StackchanDock } from "../src/dock.mjs";
import { SpeechBubblePresenter } from "../src/transcript-presenter.mjs";

const TEST_TEXT = "重连测试";
const TIMEOUT_MS = 120_000;

const dock = new StackchanDock({
  preferredSerial: process.env.STACKCHAN_USB_SERIAL || undefined,
});
const presenter = new SpeechBubblePresenter(dock);

let connectionCount = 0;
let finished = false;

function log(event, detail = {}) {
  console.log(JSON.stringify({ event, ...detail }));
}

async function shutdown(exitCode) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  presenter.dispose();
  await dock.stop().catch((error) => log("stop_error", { message: error.message }));
  process.exitCode = exitCode;
}

const timeout = setTimeout(() => {
  log("timeout", { seconds: TIMEOUT_MS / 1000 });
  void shutdown(1);
}, TIMEOUT_MS);

dock.on("lifecycle", ({ state, device }) => {
  log("lifecycle", { state, path: device?.path });
});

dock.on("dockError", (error) => log("dock_error", { message: error.message }));
dock.on("transportError", (error) => log("transport_error", { message: error.message }));
presenter.on("presentationError", (error) => log("presentation_error", { message: error.message }));
presenter.on("presented", ({ text }) => log("presented", { text }));

dock.on("connected", async ({ device }) => {
  connectionCount += 1;
  log("connected", { connectionCount, path: device.path });

  if (connectionCount === 1) {
    presenter.completeAssistantText(TEST_TEXT);
    await presenter.idle();
    log("ready_for_usb_replug", { text: TEST_TEXT });
    return;
  }

  await presenter.idle();
  log("reconnect_replay_complete", { text: TEST_TEXT, path: device.path });
  await shutdown(0);
});

process.once("SIGINT", () => void shutdown(130));
process.once("SIGTERM", () => void shutdown(143));

dock.start().catch((error) => {
  log("fatal", { message: error.message });
  void shutdown(1);
});
