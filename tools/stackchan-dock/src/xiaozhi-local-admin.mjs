import { createServer } from "node:net";

const MAX_REQUEST_BYTES = 1_024;
export const STACKCHAN_MCP_CONTRACT_VERSION = 1;
export const STACKCHAN_HEAD_LIMITS = Object.freeze({ yaw: [-45, 45], pitch: [0, 45], speed: [100, 300] });

function reject(message) { throw new TypeError(message); }

function ledChannel(value) { return Number.isInteger(value) && value >= 0 && value <= 168; }

function headAxis(value, [minimum, maximum]) { return Number.isInteger(value) && value >= minimum && value <= maximum; }

function peerClosed(error) { return error?.code === "EPIPE" || error?.code === "ECONNRESET"; }

function speakerVolume(status) {
  const volume = status?.device?.audio_speaker?.volume;
  if (!Number.isInteger(volume) || volume < 0 || volume > 100) throw new Error("robot did not report an audio speaker volume");
  return volume;
}

export async function getVerifiedSpeakerVolume(dock) {
  return speakerVolume(await dock.getStatus());
}

export async function setVerifiedSpeakerVolume(dock, volume) {
  if (!Number.isInteger(volume) || volume < 0 || volume > 100) reject("volume must be an integer from 0 to 100");
  // The official firmware requires a status read before setting volume. A
  // successful RPC alone is not a verified device change: require the same
  // codec-backed value from a post-write status read.
  await getVerifiedSpeakerVolume(dock);
  await dock.callTool("self.audio_speaker.set_volume", { volume });
  const confirmedVolume = await getVerifiedSpeakerVolume(dock);
  if (confirmedVolume !== volume) throw new Error(`speaker volume verification failed: expected ${volume}, got ${confirmedVolume}`);
  return confirmedVolume;
}

export class XiaozhiLocalAdmin {
  #dock;
  #token;
  #pipePath;
  #statusProvider;
  #ledController;
  #server = null;
  #speakerTail = Promise.resolve();

  constructor({ dock, token, statusProvider = () => ({}), ledController = null, pipePath = "\\\\.\\pipe\\stackchan-xiaozhi-admin" } = {}) {
    if (!dock || typeof dock.getStatus !== "function" || typeof dock.callTool !== "function") reject("authenticated XiaoZhi dock is required");
    if (typeof token !== "string" || !/^[0-9a-f]{64}$/i.test(token)) reject("local admin token is invalid");
    if (typeof statusProvider !== "function") reject("local admin status provider is required");
    if (ledController && (typeof ledController.setManual !== "function" || typeof ledController.clearManual !== "function")) {
      reject("local admin LED controller is invalid");
    }
    if (typeof pipePath !== "string" || !pipePath.startsWith("\\\\.\\pipe\\")) reject("pipePath must be a Windows named pipe");
    this.#dock = dock;
    this.#token = token;
    this.#statusProvider = statusProvider;
    this.#ledController = ledController;
    this.#pipePath = pipePath;
  }

  get pipePath() { return this.#pipePath; }

  async start() {
    if (this.#server) throw new Error("XiaoZhi local admin is already started");
    // The client sends one line then half-closes.  Tool execution can await an
    // authenticated device RPC, so preserve the writable half until #handle
    // has sent its structured response.
    const server = createServer({ allowHalfOpen: true }, (socket) => this.#handle(socket));
    this.#server = server;
    await new Promise((resolve, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(this.#pipePath, resolve);
    });
    return this;
  }

  async stop() {
    const server = this.#server;
    this.#server = null;
    if (!server) return;
    await new Promise((resolve, rejectClose) => server.close((error) => error ? rejectClose(error) : resolve()));
  }

  async #execute(request) {
    if (!request || request.token !== this.#token) throw new Error("unauthorized local admin request");
    if (request.operation === "get-console-status") {
      // This is deliberately local, authenticated, and read-only. It lets a
      // desktop renderer observe the process that already owns robot/audio.
      return {
        contract_version: STACKCHAN_MCP_CONTRACT_VERSION,
        owner: { state: "ready", admin_pipe: this.#pipePath },
        ...this.#statusProvider(),
      };
    }
    if (request.operation === "get-subtitle") {
      const subtitle = this.#statusProvider()?.subtitle;
      if (!subtitle || typeof subtitle !== "object" || Array.isArray(subtitle)) throw new Error("subtitle publication is unavailable in this Owner");
      return { subtitle: structuredClone(subtitle) };
    }
    if (request.operation === "get-speaker-volume") {
      return { volume: await this.#runSpeakerTransaction(() => getVerifiedSpeakerVolume(this.#dock)) };
    }
    if (request.operation === "set-speaker-volume") {
      return { volume: await this.#runSpeakerTransaction(() => setVerifiedSpeakerVolume(this.#dock, request.volume)) };
    }
    if (request.operation === "set-robot-led-color") {
      if (!this.#ledController) throw new Error("robot LED control is unavailable in this Owner");
      if (![request.red, request.green, request.blue].every(ledChannel)) throw new TypeError("LED channels must be integers from 0 to 168");
      const color = await this.#ledController.setManual(request.red, request.green, request.blue);
      return { color, accepted: true, device_readback: "unavailable" };
    }
    if (request.operation === "clear-robot-led-override") {
      if (!this.#ledController) throw new Error("robot LED control is unavailable in this Owner");
      const result = await this.#ledController.clearManual();
      return { ...result, automatic_control: "enabled" };
    }
    if (request.operation === "get-robot-head") {
      if (typeof this.#dock.getHead !== "function") throw new Error("robot head control is unavailable in this Owner");
      return { head: await this.#dock.getHead() };
    }
    if (request.operation === "set-robot-head") {
      if (typeof this.#dock.setHead !== "function") throw new Error("robot head control is unavailable in this Owner");
      if (!headAxis(request.yaw, STACKCHAN_HEAD_LIMITS.yaw) || !headAxis(request.pitch, STACKCHAN_HEAD_LIMITS.pitch) || !headAxis(request.speed, STACKCHAN_HEAD_LIMITS.speed)) {
        throw new TypeError("head target is outside the Owner safety envelope");
      }
      await this.#dock.setHead(request.yaw, request.pitch, request.speed);
      return { head: { yaw: request.yaw, pitch: request.pitch, speed: request.speed, source: "commanded" }, accepted: true };
    }
    throw new Error("unsupported local admin operation");
  }

  #runSpeakerTransaction(work) {
    // The physical device accepts a limited number of simultaneous MCP tool
    // calls.  Reads must share the same serialization boundary as the
    // read→write→read operation, otherwise UI refreshes can race volume sets.
    const operation = this.#speakerTail.then(work);
    this.#speakerTail = operation.catch(() => {});
    return operation;
  }

  #reply(socket, response) {
    // A client may time out while an authenticated device RPC is pending. The
    // reply is best-effort, but normal completion is framed by a newline, not
    // by either peer's FIN. This is important for Windows named pipes.
    if (socket.destroyed || socket.writableEnded || !socket.writable) return;
    try {
      socket.write(`${JSON.stringify(response)}\n`, (error) => {
        if (error && !peerClosed(error)) console.error("StackChan local admin pipe reply failed:", error.message);
        // The client may already have closed after receiving the complete
        // frame. Treat that as normal; its reply was already delivered.
        if (!socket.destroyed && !socket.writableEnded && socket.writable) {
          try { socket.end(); }
          catch (closeError) { if (!peerClosed(closeError)) console.error("StackChan local admin pipe close failed:", closeError.message); }
        }
      });
    } catch (error) {
      if (!peerClosed(error)) console.error("StackChan local admin pipe reply failed:", error.message);
    }
  }

  #handle(socket) {
    let input = "";
    socket.setEncoding("utf8");
    socket.on("error", (error) => {
      if (!peerClosed(error)) console.error("StackChan local admin pipe error:", error.message);
    });
    socket.on("data", (chunk) => {
      input += chunk;
      if (Buffer.byteLength(input, "utf8") > MAX_REQUEST_BYTES || !input.includes("\n")) return;
      socket.pause();
      const line = input.slice(0, input.indexOf("\n")).replace(/^\uFEFF/, "");
      Promise.resolve().then(() => this.#execute(JSON.parse(line))).then(
        (result) => this.#reply(socket, { ok: true, result }),
        (error) => this.#reply(socket, { ok: false, error: error.message }),
      );
    });
    socket.on("end", () => {
      if (input.length === 0) return;
      if (Buffer.byteLength(input, "utf8") > MAX_REQUEST_BYTES || input.includes("\n")) return;
      this.#reply(socket, { ok: false, error: "local admin request must end with a newline" });
    });
  }
}
