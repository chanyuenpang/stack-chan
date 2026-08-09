import { EventEmitter } from "node:events";

import { XIAOZHI_BOOTSTRAP_PATH, XiaozhiBootstrapServer } from "./xiaozhi-bootstrap-server.mjs";
import { XiaozhiStackchanDock } from "./xiaozhi-dock.mjs";
import { XiaozhiWasapiBridge, XiaozhiWasapiBroker } from "./xiaozhi-wasapi-bridge.mjs";
import { XIAOZHI_WEBSOCKET_PATH, XiaozhiWebSocketServer } from "./xiaozhi-websocket-server.mjs";

function reject(message) {
  throw new TypeError(message);
}

function publicUrl(scheme, host, port, path) {
  if (typeof host !== "string" || host.length === 0 || /[/:]/.test(host)) {
    reject("advertiseHost must be an IPv4 address or DNS hostname without a scheme or port");
  }
  return `${scheme}://${host}:${port}${path}`;
}

export class XiaozhiDockRuntime extends EventEmitter {
  #token;
  #expectedDeviceId;
  #advertiseHost;
  #websocketUrl;
  #websocketListen;
  #bootstrapListen;
  #server;
  #broker;
  #bootstrapFactory;
  #bootstrap = null;
  #dock;
  #bridge;
  #started = false;
  #listeners = [];

  constructor({
    token,
    expectedDeviceId,
    advertiseHost,
    websocketUrl,
    websocketHost = "0.0.0.0",
    websocketPort = 8_765,
    websocketPath = XIAOZHI_WEBSOCKET_PATH,
    bootstrapHost = "0.0.0.0",
    bootstrapPort = 8_766,
    bootstrapPath = XIAOZHI_BOOTSTRAP_PATH,
    binaryPath,
    codexPid,
    renderDevice = "CABLE Input",
    server,
    broker,
    bootstrapFactory = (options) => new XiaozhiBootstrapServer(options),
  } = {}) {
    super();
    if (typeof token !== "string" || token.length < 32) reject("token must contain at least 32 characters");
    if (typeof expectedDeviceId !== "string" || expectedDeviceId.length === 0) reject("expectedDeviceId is required");
    if (websocketUrl === undefined && (typeof advertiseHost !== "string" || advertiseHost.length === 0)) {
      reject("advertiseHost or websocketUrl is required");
    }
    for (const [name, port] of [["websocketPort", websocketPort], ["bootstrapPort", bootstrapPort]]) {
      if (!Number.isInteger(port) || port < 0 || port > 65_535) reject(`${name} is invalid`);
    }
    if (typeof bootstrapFactory !== "function") reject("bootstrapFactory must be a function");

    this.#token = token;
    this.#expectedDeviceId = expectedDeviceId;
    this.#advertiseHost = advertiseHost;
    this.#websocketUrl = websocketUrl;
    this.#websocketListen = { host: websocketHost, port: websocketPort, path: websocketPath };
    this.#bootstrapListen = { host: bootstrapHost, port: bootstrapPort, path: bootstrapPath };
    this.#server = server ?? new XiaozhiWebSocketServer({ token, expectedDeviceId });
    this.#broker = broker ?? new XiaozhiWasapiBroker({ binaryPath, pid: codexPid, renderDevice });
    this.#bootstrapFactory = bootstrapFactory;
    this.#dock = new XiaozhiStackchanDock({ server: this.#server });
    this.#bridge = new XiaozhiWasapiBridge({ server: this.#server, broker: this.#broker });
  }

  get dock() { return this.#dock; }
  get server() { return this.#server; }
  get broker() { return this.#broker; }
  get started() { return this.#started; }

  async start() {
    if (this.#started) throw new Error("XiaoZhi runtime is already started");
    this.#started = true;
    this.#wireDiagnostics();
    try {
      this.#broker.start();
      this.#dock.attach();
      this.#bridge.attach();
      const websocketAddress = await this.#server.listen(this.#websocketListen);
      const websocketUrl = this.#websocketUrl ?? publicUrl(
        "ws",
        this.#advertiseHost,
        websocketAddress.port,
        websocketAddress.path,
      );
      this.#bootstrap = this.#bootstrapFactory({
        token: this.#token,
        websocketUrl,
        expectedDeviceId: this.#expectedDeviceId,
      });
      const bootstrapAddress = await this.#bootstrap.listen(this.#bootstrapListen);
      return {
        websocket: { ...websocketAddress, url: websocketUrl },
        bootstrap: {
          ...bootstrapAddress,
          url: publicUrl("http", this.#advertiseHost, bootstrapAddress.port, bootstrapAddress.path),
        },
      };
    } catch (error) {
      await this.stop().catch(() => {});
      throw error;
    }
  }

  async stop() {
    if (!this.#started) return;
    this.#started = false;
    const bootstrap = this.#bootstrap;
    this.#bootstrap = null;
    await bootstrap?.close().catch((error) => this.emit("runtimeError", error));
    await this.#server.close().catch((error) => this.emit("runtimeError", error));
    this.#bridge.detach();
    this.#dock.detach();
    await this.#broker.stop().catch((error) => this.emit("runtimeError", error));
    for (const [emitter, event, listener] of this.#listeners) emitter.off(event, listener);
    this.#listeners = [];
  }

  #wireDiagnostics() {
    this.#listen(this.#server, "authenticated", (details) => this.emit("authenticated", details));
    this.#listen(this.#server, "disconnected", (details) => this.emit("disconnected", details));
    this.#listen(this.#server, "protocolError", (error) => this.emit("runtimeError", error));
    this.#listen(this.#server, "serverError", (error) => this.emit("runtimeError", error));
    this.#listen(this.#server, "socketError", (error) => this.emit("runtimeError", error));
    this.#listen(this.#broker, "diagnostic", (message) => this.emit("diagnostic", message));
    this.#listen(this.#broker, "error", (error) => this.emit("runtimeError", error));
    this.#listen(this.#broker, "exit", (details) => this.emit("brokerExit", details));
    this.#listen(this.#bridge, "speaking", (speaking) => this.emit("speaking", speaking));
    this.#listen(this.#bridge, "error", (error) => this.emit("runtimeError", error));
    this.#listen(this.#dock, "protocolError", (error) => this.emit("runtimeError", error));
  }

  #listen(emitter, event, listener) {
    emitter.on(event, listener);
    this.#listeners.push([emitter, event, listener]);
  }
}
