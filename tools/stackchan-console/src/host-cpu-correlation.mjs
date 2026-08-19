import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const DEFAULT_INTERVAL_MS = 5_000;
const execFileAsync = promisify(execFile);

export function createWindowsCpuCapture({ chatgptPid, ownerPid, brokerPid }) {
  for (const pid of [chatgptPid, ownerPid, brokerPid]) if (!Number.isInteger(pid) || pid <= 0) throw new TypeError("CPU capture PIDs must be positive integers");
  const script = "$ErrorActionPreference='Stop';$p=@(" + [chatgptPid, ownerPid, brokerPid].join(",") + ");$proc=Get-CimInstance Win32_PerfFormattedData_PerfProc_Process;$cpu={param($id) $x=$proc|Where-Object IDProcess -eq $id|Select-Object -First 1;if($null -eq $x){0}else{[double]$x.PercentProcessorTime}};$all=Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor;$total=$all|Where-Object Name -eq '_Total'|Select-Object -First 1;$cores=@($all|Where-Object Name -ne '_Total'|ForEach-Object {[double]$_.PercentProcessorTime});[pscustomobject]@{system=if($null -eq $total){0}else{[double]$total.PercentProcessorTime};cores=$cores;chatgpt=&$cpu $p[0];owner=&$cpu $p[1];broker=&$cpu $p[2]}|ConvertTo-Json -Compress";
  return async () => {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 4_000, maxBuffer: 64 * 1024 });
    return JSON.parse(stdout);
  };
}

export function parseHostCpuCorrelationSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("CPU snapshot must be an object");
  const number = (name) => {
    const result = value[name];
    if (!Number.isFinite(result) || result < 0) throw new TypeError(`CPU snapshot ${name} must be a non-negative finite number`);
    return result;
  };
  if (!Array.isArray(value.cores) || value.cores.some((core) => !Number.isFinite(core) || core < 0)) {
    throw new TypeError("CPU snapshot cores must be non-negative finite numbers");
  }
  return { system: number("system"), cores: [...value.cores], chatgpt: number("chatgpt"), owner: number("owner"), broker: number("broker") };
}

export class HostCpuCorrelationSampler extends EventEmitter {
  #capture;
  #intervalMs;
  #timer = null;
  #inFlight = false;
  #cadence = { broker_emit_count: 0, ws_send_count: 0 };

  constructor({ capture, intervalMs = DEFAULT_INTERVAL_MS } = {}) {
    super();
    if (typeof capture !== "function") throw new TypeError("capture must be a function");
    if (!Number.isInteger(intervalMs) || intervalMs < 1_000) throw new RangeError("intervalMs must be an integer of at least 1000");
    this.#capture = capture;
    this.#intervalMs = intervalMs;
  }

  noteBrokerEmit() { this.#cadence.broker_emit_count += 1; }
  noteWebSocketSend() { this.#cadence.ws_send_count += 1; }

  start() {
    if (this.#timer !== null) throw new Error("CPU sampler is already running");
    this.#timer = setInterval(() => this.#sample(), this.#intervalMs);
    this.#sample();
  }

  stop() { if (this.#timer !== null) clearInterval(this.#timer); this.#timer = null; }

  async #sample() {
    if (this.#inFlight) return;
    this.#inFlight = true;
    const cadence = this.#cadence;
    this.#cadence = { broker_emit_count: 0, ws_send_count: 0 };
    try {
      const cpu = parseHostCpuCorrelationSnapshot(await this.#capture());
      this.emit("sample", { source: "host_cpu", at: Date.now(), interval_ms: this.#intervalMs, ...cpu, ...cadence });
    } catch (error) { this.emit("error", error); }
    finally { this.#inFlight = false; }
  }
}
