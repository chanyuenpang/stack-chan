export const PROTOCOL_VERSION = 1;
export const MAX_FRAME_BYTES = 511;
export const MAX_SPEECH_TEXT_BYTES = 320;

export const COMMAND = Object.freeze({
  GET_STATUS: "get_status",
  SET_AUDIO: "set_audio",
  SET_EXPRESSION: "set_expression",
  SET_TALKING: "set_talking",
  SET_SPEECH: "set_speech",
  CLEAR_SPEECH: "clear_speech",
  SET_LED: "set_led",
  GET_HEAD: "get_head",
  SET_HEAD: "set_head",
});

const EXPRESSIONS = new Set(["neutral", "happy", "angry", "sad", "doubtful"]);
const COMMANDS = new Set(Object.values(COMMAND));

function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertExactKeys(value, allowed, label) {
  assertObject(value, label);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new TypeError(`${label}.${key} is not allowed`);
    }
  }
}

function assertInteger(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer in ${minimum}..${maximum}`);
  }
}

function assertSpeechText(text) {
  if (typeof text !== "string" || text.length === 0) {
    throw new TypeError("text must be a non-empty string");
  }
  if (!text.isWellFormed()) {
    throw new TypeError("text must be well-formed Unicode");
  }
  if (Buffer.byteLength(text, "utf8") > MAX_SPEECH_TEXT_BYTES) {
    throw new RangeError(`text exceeds ${MAX_SPEECH_TEXT_BYTES} UTF-8 bytes`);
  }
}

export function validateCommand(command, args = {}) {
  if (!COMMANDS.has(command)) {
    throw new TypeError("command is not in the Dock allowlist");
  }

  if (command === COMMAND.GET_STATUS || command === COMMAND.GET_HEAD || command === COMMAND.CLEAR_SPEECH) {
    assertExactKeys(args, [], "args");
  } else if (command === COMMAND.SET_AUDIO) {
    assertExactKeys(args, ["microphone_enabled", "speaker_enabled"], "args");
    const hasMicrophone = Object.hasOwn(args, "microphone_enabled");
    const hasSpeaker = Object.hasOwn(args, "speaker_enabled");
    if (!hasMicrophone && !hasSpeaker) {
      throw new TypeError("set_audio requires at least one endpoint field");
    }
    if (hasMicrophone && typeof args.microphone_enabled !== "boolean") {
      throw new TypeError("microphone_enabled must be boolean");
    }
    if (hasSpeaker && typeof args.speaker_enabled !== "boolean") {
      throw new TypeError("speaker_enabled must be boolean");
    }
  } else if (command === COMMAND.SET_EXPRESSION) {
    assertExactKeys(args, ["expression"], "args");
    if (!EXPRESSIONS.has(args.expression)) {
      throw new RangeError("expression is not in the allowlist");
    }
  } else if (command === COMMAND.SET_TALKING) {
    assertExactKeys(args, ["enabled"], "args");
    if (typeof args.enabled !== "boolean") {
      throw new TypeError("enabled must be boolean");
    }
  } else if (command === COMMAND.SET_SPEECH) {
    assertExactKeys(args, ["text"], "args");
    assertSpeechText(args.text);
  } else if (command === COMMAND.SET_LED) {
    assertExactKeys(args, ["red", "green", "blue"], "args");
    assertInteger(args.red, 0, 168, "red");
    assertInteger(args.green, 0, 168, "green");
    assertInteger(args.blue, 0, 168, "blue");
  } else if (command === COMMAND.SET_HEAD) {
    assertExactKeys(args, ["yaw", "pitch", "speed"], "args");
    assertInteger(args.yaw, -128, 128, "yaw");
    assertInteger(args.pitch, 0, 90, "pitch");
    assertInteger(args.speed, 100, 300, "speed");
  }
  return args;
}

export function encodeRequest(id, command, args = {}) {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new RangeError("request id must be a positive safe integer");
  }
  validateCommand(command, args);
  const line = JSON.stringify({ v: PROTOCOL_VERSION, id, cmd: command, args });
  if (Buffer.byteLength(line, "utf8") > MAX_FRAME_BYTES) {
    throw new RangeError(`request exceeds ${MAX_FRAME_BYTES} bytes`);
  }
  return `${line}\n`;
}

export function parseFrame(line) {
  if (typeof line !== "string" || Buffer.byteLength(line, "utf8") > MAX_FRAME_BYTES) {
    throw new RangeError(`frame exceeds ${MAX_FRAME_BYTES} bytes`);
  }
  let value;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new SyntaxError(`invalid JSON frame: ${error.message}`);
  }
  assertObject(value, "frame");
  if (value.v !== PROTOCOL_VERSION) {
    throw new RangeError(`unsupported protocol version ${value.v}`);
  }

  if (typeof value.event === "string") {
    if (!Number.isSafeInteger(value.seq) || value.seq <= 0) {
      throw new TypeError("event seq must be a positive integer");
    }
    assertObject(value.data, "event.data");
    return { type: "event", seq: value.seq, event: value.event, data: value.data };
  }

  if (!Number.isSafeInteger(value.id) || value.id < 0 || typeof value.ok !== "boolean") {
    throw new TypeError("response requires integer id and boolean ok");
  }
  if (value.ok) {
    assertObject(value.result, "response.result");
    return { type: "response", id: value.id, ok: true, result: value.result };
  }
  assertObject(value.error, "response.error");
  if (typeof value.error.code !== "string" || typeof value.error.message !== "string") {
    throw new TypeError("response.error requires code and message");
  }
  return { type: "response", id: value.id, ok: false, error: value.error };
}

export class DeviceCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DeviceCommandError";
    this.code = code;
  }
}
