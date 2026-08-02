import { StackchanDock } from "../src/dock.mjs";
import { SpeechBubblePresenter } from "../src/transcript-presenter.mjs";

const DURATION_MS = 15_000;
const UPDATE_INTERVAL_MS = 250;

const dock = new StackchanDock({
  preferredSerial: process.env.STACKCHAN_USB_SERIAL || undefined,
});
const presenter = new SpeechBubblePresenter(dock, { updateIntervalMs: UPDATE_INTERVAL_MS });

let finished = false;
let presented = 0;
let presentationErrors = 0;

function log(event, detail = {}) {
  console.log(JSON.stringify({ event, ...detail }));
}

async function shutdown(exitCode) {
  if (finished) return;
  finished = true;
  presenter.dispose();
  await dock.stop().catch((error) => log("stop_error", { message: error.message }));
  process.exitCode = exitCode;
}

presenter.on("presented", () => { presented += 1; });
presenter.on("presentationError", (error) => {
  presentationErrors += 1;
  log("presentation_error", { message: error.message });
});
dock.on("dockError", (error) => log("dock_error", { message: error.message }));

dock.once("connected", async ({ device }) => {
  log("bubble_started", { path: device.path });
  const startedAt = Date.now();
  let update = 0;
  while (Date.now() - startedAt < DURATION_MS) {
    update += 1;
    presenter.completeAssistantText(`音频并行测试 ${String(update).padStart(2, "0")}`);
    await new Promise((resolve) => setTimeout(resolve, UPDATE_INTERVAL_MS));
  }
  presenter.completeAssistantText("音频并行测试完成");
  await presenter.idle();
  log("bubble_complete", { presented, presentationErrors });
  presenter.clear();
  await presenter.idle();
  await shutdown(presentationErrors === 0 ? 0 : 1);
});

setTimeout(() => {
  if (!finished) {
    log("timeout");
    void shutdown(1);
  }
}, 30_000).unref();

dock.start().catch((error) => {
  log("fatal", { message: error.message });
  void shutdown(1);
});
