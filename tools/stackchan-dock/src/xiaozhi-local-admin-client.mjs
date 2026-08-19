import { createConnection } from "node:net";

export const DEFAULT_XIAOZHI_LOCAL_ADMIN_PIPE = "\\\\.\\pipe\\stackchan-xiaozhi-admin";
let localAdminRequestTail = Promise.resolve();
const activeSpeakerReads = new Map();

function reject(message) { throw new TypeError(message); }

function parseLocalAdminResponse(output) {
  const body = output.trim();
  if (!body) throw new Error("StackChan Owner local admin returned an empty response");
  let response;
  try { response = JSON.parse(body); }
  catch { throw new Error("StackChan Owner local admin returned an invalid JSON response"); }
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("StackChan Owner local admin returned an invalid response object");
  }
  if (!response.ok) throw new Error(typeof response.error === "string" && response.error ? response.error : "StackChan Owner local admin request failed");
  if (!response.result || typeof response.result !== "object" || Array.isArray(response.result)) {
    throw new Error("StackChan Owner local admin returned an invalid result");
  }
  return response.result;
}

function requestOnce({ token, operation, volume, red, green, blue, pipePath, connect, timeoutMs }) {
  return new Promise((resolve, rejectRequest) => {
    const socket = connect(pipePath);
    let output = "";
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => socket.destroy(new Error("StackChan Owner local admin request timed out")), timeoutMs);
    socket.setEncoding("utf8");
    socket.once("error", (error) => finish(rejectRequest, error));
    socket.on("data", (chunk) => {
      output += chunk;
      // This is a framed request/response protocol.  Resolving on the first
      // complete response frame keeps a Windows named-pipe FIN from racing a
      // device RPC that is still completing on the Owner.
      const newline = output.indexOf("\n");
      if (newline === -1) return;
      try { finish(resolve, parseLocalAdminResponse(output.slice(0, newline))); }
      catch (error) { finish(rejectRequest, error); }
      // The response is complete; the client, rather than the request write,
      // now performs the orderly close.
      if (!socket.destroyed && !socket.writableEnded) socket.end();
    });
    socket.once("end", () => {
      if (settled) return;
      try { finish(resolve, parseLocalAdminResponse(output)); }
      catch (error) { finish(rejectRequest, error); }
    });
    socket.once("connect", () => socket.write(`${JSON.stringify({ token, operation,
      ...(operation === "set-speaker-volume" ? { volume } : {}),
      ...(operation === "set-robot-led-color" ? { red, green, blue } : {}),
    })}\n`));
  });
}

export function requestXiaozhiLocalAdmin({ token, operation, volume, red, green, blue, pipePath = DEFAULT_XIAOZHI_LOCAL_ADMIN_PIPE, connect = createConnection, timeoutMs = 1_500 } = {}) {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/i.test(token)) reject("local Dock token is invalid");
  if (!["get-subtitle", "get-speaker-volume", "set-speaker-volume", "set-robot-led-color", "clear-robot-led-override"].includes(operation)) reject("local admin operation is not allowlisted");
  if (operation === "set-speaker-volume" && (!Number.isInteger(volume) || volume < 0 || volume > 100)) reject("volume must be an integer from 0 to 100");
  if (operation === "set-robot-led-color" && ![red, green, blue].every((value) => Number.isInteger(value) && value >= 0 && value <= 168)) reject("LED channels must be integers from 0 to 168");
  if (typeof pipePath !== "string" || !pipePath.startsWith("\\\\.\\pipe\\")) reject("pipePath must be a local Windows named pipe");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) reject("timeoutMs must be a positive integer");
  // Windows named pipes accept only a small number of pending instances.
  // Serializing before opening a connection prevents concurrent UI refreshes
  // from being closed before the Owner can read their request.
  const readKey = `${pipePath}\u0000${token}`;
  if (operation === "get-speaker-volume" && activeSpeakerReads.has(readKey)) return activeSpeakerReads.get(readKey);
  const operationPromise = localAdminRequestTail.then(() => requestOnce({ token, operation, volume, red, green, blue, pipePath, connect, timeoutMs }));
  localAdminRequestTail = operationPromise.catch(() => {});
  if (operation === "get-speaker-volume") {
    const sharedRead = operationPromise.finally(() => {
      if (activeSpeakerReads.get(readKey) === sharedRead) activeSpeakerReads.delete(readKey);
    });
    activeSpeakerReads.set(readKey, sharedRead);
    return sharedRead;
  }
  return operationPromise;
}
