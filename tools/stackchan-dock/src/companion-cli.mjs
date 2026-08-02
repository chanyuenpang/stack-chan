import { CodexVoiceTranscriptSource } from "./codex-voice-transcript-source.mjs";
import { StackchanDock } from "./dock.mjs";
import { SpeechBubblePresenter } from "./transcript-presenter.mjs";
import { TalkingAnimationController } from "./talking-animation-controller.mjs";

const dock = new StackchanDock({ preferredSerial: process.env.STACKCHAN_USB_SERIAL || undefined });
const presenter = new SpeechBubblePresenter(dock);
const talking = new TalkingAnimationController(dock);
const transcriptSource = new CodexVoiceTranscriptSource({
  databasePath: process.env.CODEX_LOGS_DATABASE || undefined,
});

dock.on("lifecycle", (event) => console.log(JSON.stringify({ type: "lifecycle", ...event })));
dock.on("state", (event) => {
  console.log(JSON.stringify({ type: "state", ...event }));
  presenter.handleDeviceState(event.state);
  talking.handleDeviceState(event.state);
});
dock.on("deviceEvent", (event) => console.log(JSON.stringify({ type: "device_event", ...event })));
dock.on("dockError", (error) => console.error(JSON.stringify({ type: "dock_error", message: error.message })));
presenter.on("presented", ({ text }) => console.log(JSON.stringify({ type: "speech_presented", bytes: Buffer.byteLength(text, "utf8") })));
presenter.on("presentationError", (error) => console.error(JSON.stringify({ type: "presentation_error", message: error.message })));
talking.on("changed", ({ enabled }) => console.log(JSON.stringify({ type: "talking_animation", enabled })));
talking.on("animationError", (error) => console.error(JSON.stringify({ type: "talking_animation_error", message: error.message })));
transcriptSource.on("started", ({ databasePath }) => console.log(JSON.stringify({ type: "transcript_source_started", databasePath })));
transcriptSource.on("sourceError", (error) => console.error(JSON.stringify({ type: "transcript_source_error", message: error.message })));
transcriptSource.on("assistantResponseStarted", () => {
  presenter.beginAssistantResponse();
  talking.start();
});
transcriptSource.on("assistantTextDelta", ({ text }) => presenter.appendAssistantText(text));
transcriptSource.on("assistantTextDone", ({ text }) => {
  presenter.completeAssistantText(text);
  talking.stop();
});
transcriptSource.on("userSpeechStarted", () => talking.stop());
transcriptSource.on("sourceError", () => talking.stop());

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  transcriptSource.stop();
  await talking.close();
  await presenter.close({ clear: true });
  await dock.stop();
  process.exitCode = 0;
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

try {
  transcriptSource.start();
  dock.start();
} catch (error) {
  console.error(JSON.stringify({ type: "startup_error", message: error.message }));
  await shutdown();
  process.exitCode = 1;
}
