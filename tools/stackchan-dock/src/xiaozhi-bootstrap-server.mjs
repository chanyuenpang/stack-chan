import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

export const XIAOZHI_BOOTSTRAP_PATH = "/xiaozhi/ota";

function safeEqual(left, right) {
  const actual = Buffer.from(String(left ?? ""), "utf8");
  const expected = Buffer.from(String(right ?? ""), "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function reject(message) {
  throw new TypeError(message);
}

export function createXiaozhiBootstrapResponse({ websocketUrl, token }) {
  if (typeof websocketUrl !== "string" || !/^wss?:\/\//.test(websocketUrl)) reject("websocketUrl must use ws:// or wss://");
  if (typeof token !== "string" || token.length < 32) reject("token must contain at least 32 characters");
  return {
    websocket: {
      url: websocketUrl,
      token,
      version: 1,
    },
  };
}

export class XiaozhiBootstrapServer {
  #token;
  #websocketUrl;
  #expectedDeviceId;
  #server = null;
  #stats = { requests: 0, authenticatedRequests: 0, rejectedRequests: 0 };

  constructor({ token, websocketUrl, expectedDeviceId } = {}) {
    createXiaozhiBootstrapResponse({ token, websocketUrl });
    if (expectedDeviceId !== undefined && (typeof expectedDeviceId !== "string" || expectedDeviceId.length === 0)) {
      reject("expectedDeviceId must be a non-empty string");
    }
    this.#token = token;
    this.#websocketUrl = websocketUrl;
    this.#expectedDeviceId = expectedDeviceId;
  }

  get stats() {
    return structuredClone(this.#stats);
  }

  async listen({ host = "0.0.0.0", port = 0, path = XIAOZHI_BOOTSTRAP_PATH } = {}) {
    if (this.#server) reject("bootstrap server is already listening");
    if (!Number.isInteger(port) || port < 0 || port > 65_535) reject("port is invalid");
    if (typeof path !== "string" || !path.startsWith("/")) reject("path must be absolute");
    this.#server = createServer(async (request, response) => {
      this.#stats.requests += 1;
      const url = new URL(request.url ?? "/", "http://localhost");
      const deviceId = request.headers["device-id"];
      const authorized = safeEqual(request.headers.authorization, `Bearer ${this.#token}`)
        && typeof deviceId === "string"
        && deviceId.length > 0
        && (this.#expectedDeviceId === undefined || deviceId === this.#expectedDeviceId);
      if (url.pathname !== path) {
        response.writeHead(404).end();
        return;
      }
      if (!authorized) {
        this.#stats.rejectedRequests += 1;
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      if (request.method !== "GET" && request.method !== "POST") {
        response.writeHead(405, { Allow: "GET, POST" }).end();
        return;
      }
      let bodyBytes = 0;
      try {
        for await (const chunk of request) {
          bodyBytes += chunk.length;
          if (bodyBytes > 64 * 1024) throw new RangeError("bootstrap body exceeds 64 KiB");
        }
      } catch {
        response.writeHead(413).end();
        return;
      }
      this.#stats.authenticatedRequests += 1;
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(createXiaozhiBootstrapResponse({
        websocketUrl: this.#websocketUrl,
        token: this.#token,
      })));
    });
    await new Promise((resolve, rejectListen) => {
      this.#server.once("listening", resolve);
      this.#server.once("error", rejectListen);
      this.#server.listen(port, host);
    });
    const address = this.#server.address();
    return typeof address === "object" && address !== null
      ? { host: address.address, port: address.port, path }
      : { host, port, path };
  }

  async close() {
    const server = this.#server;
    this.#server = null;
    if (!server) return;
    await new Promise((resolve, rejectClose) => server.close((error) => error ? rejectClose(error) : resolve()));
  }
}
