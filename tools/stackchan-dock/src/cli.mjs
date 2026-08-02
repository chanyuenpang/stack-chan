import { StackchanDock } from "./dock.mjs";

const dock = new StackchanDock({ preferredSerial: process.env.STACKCHAN_USB_SERIAL || undefined });
dock.on("lifecycle", (event) => console.log(JSON.stringify({ type: "lifecycle", ...event })));
dock.on("state", (event) => console.log(JSON.stringify({ type: "state", ...event })));
dock.on("deviceEvent", (event) => console.log(JSON.stringify({ type: "device_event", ...event })));
dock.on("dockError", (error) => console.error(JSON.stringify({ type: "error", message: error.message })));

const shutdown = async () => {
  await dock.stop();
  process.exitCode = 0;
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
dock.start();
