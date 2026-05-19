#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const BRIDGE_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DEFAULT_AUDIO_FILE = path.join(BRIDGE_DIR, "assets", "audio", "original-victory-fanfare.wav");
const DEFAULT_STATE_FILE = path.join(BRIDGE_DIR, "state", "plan_status.json");
const DEFAULT_VOLUME = 35;
const MAX_STATE_BYTES = 64 * 1024;
const PLAYER_CANDIDATES = ["paplay", "aplay", "ffplay", "mpv", "cvlc"];

const options = parseArgs(process.argv.slice(2));
const mode = options.force ? "force" : "once";
const volume = options.volume ?? DEFAULT_VOLUME;
const audioFile = resolveAudioFile(options.audioFile || process.env.STACKCHAN_CELEBRATION_AUDIO || DEFAULT_AUDIO_FILE);
const stateFile = resolveStateFile(process.env.XIAOZHI_PLAN_STATE_FILE || DEFAULT_STATE_FILE);
const player = findPlayer();
const decision = options.force ? { shouldPlay: true, reason: "forced" } : readCelebrationDecision(stateFile);

if (options.help) {
  printUsage();
  process.exit(0);
}

if (options.dryRun) {
  printSafeSummary({ audioFile, stateFile, volume, player, mode, decision, dryRun: true });
  process.exit(0);
}

if (!decision.shouldPlay) {
  console.log(JSON.stringify({ ok: true, played: false, reason: decision.reason }, null, 2));
  process.exit(0);
}

if (!player) {
  console.error("No supported local audio player found. Install or make one available in PATH: paplay, aplay, ffplay, mpv, or cvlc. Use --dry-run to inspect the selected audio safely.");
  process.exit(1);
}

await playAudio(player, audioFile, volume);
console.log(JSON.stringify({ ok: true, played: true, player: player.command, audio: summarizePath(audioFile), volume }, null, 2));

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--audio") parsed.audioFile = requireValue(args, ++i, arg);
    else if (arg === "--volume") parsed.volume = parseVolume(requireValue(args, ++i, arg));
    else if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--once") parsed.once = true;
    else if (arg === "--force") parsed.force = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (parsed.once && parsed.force) throw new Error("--once and --force are mutually exclusive");
  return parsed;
}

function requireValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseVolume(value) {
  if (!/^\d+$/.test(value)) throw new Error("--volume must be an integer from 0 to 100");
  const number = Number(value);
  if (number < 0 || number > 100) throw new Error("--volume must be between 0 and 100");
  return number;
}

function resolveAudioFile(input) {
  const filePath = resolveLocalPath(input, "audio file");
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile()) throw new Error(`audio file must be a local regular file: ${filePath}`);
  return filePath;
}

function resolveStateFile(input) {
  return resolveLocalPath(input, "state file");
}

function resolveLocalPath(input, label) {
  if (!input || typeof input !== "string") throw new Error(`${label} is required`);
  if (/^[a-z][a-z0-9+.-]*:/i.test(input)) throw new Error(`${label} must be a local file path, not a URL`);
  if (!path.isAbsolute(input)) throw new Error(`${label} must be an absolute local path`);
  const filePath = path.normalize(input);
  if (filePath.startsWith("/dev/")) throw new Error(`${label} must not point to a device path`);
  return filePath;
}

function readCelebrationDecision(filePath) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return { shouldPlay: false, reason: "state_file_not_found" };
    return { shouldPlay: false, reason: "state_file_unavailable" };
  }
  if (!stat.isFile()) return { shouldPlay: false, reason: "state_file_not_regular" };
  if (stat.size > MAX_STATE_BYTES) return { shouldPlay: false, reason: "state_file_too_large" };

  let state;
  try {
    state = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return { shouldPlay: false, reason: "state_file_invalid_json" };
  }

  const event = state?.latest_completion_event;
  if (!event || typeof event !== "object" || Array.isArray(event)) return { shouldPlay: false, reason: "latest_event_missing" };
  if (event.should_celebrate !== true) return { shouldPlay: false, reason: "latest_event_should_celebrate_false" };

  const completedAtMs = Date.parse(event.completed_at);
  if (!Number.isFinite(completedAtMs)) return { shouldPlay: false, reason: "latest_event_completed_at_invalid" };
  const ttlSeconds = Number(event.ttl_seconds);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return { shouldPlay: false, reason: "latest_event_ttl_invalid" };
  const ageSeconds = Math.floor((Date.now() - completedAtMs) / 1000);
  if (ageSeconds < 0) return { shouldPlay: false, reason: "latest_event_in_future", age_seconds: ageSeconds };
  if (ageSeconds >= ttlSeconds) return { shouldPlay: false, reason: "latest_event_expired", age_seconds: ageSeconds, ttl_seconds: ttlSeconds };

  return {
    shouldPlay: true,
    reason: "latest_event_within_ttl",
    event_id: safeString(event.event_id),
    event_type: safeString(event.event_type),
    task_id: safeString(event.task_id),
    task_title: safeString(event.task_title),
    age_seconds: ageSeconds,
    expires_in_seconds: Math.max(0, Math.ceil(ttlSeconds - ageSeconds)),
  };
}

function findPlayer() {
  for (const command of PLAYER_CANDIDATES) {
    const result = spawnSync("which", [command], { stdio: "ignore" });
    if (result.status === 0) return { command };
  }
  return null;
}

async function playAudio(player, audioFilePath, volume) {
  const { command } = player;
  const args = buildPlayerArgs(command, audioFilePath, volume);
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
    });
  });
}

function buildPlayerArgs(command, audioFilePath, volume) {
  if (command === "paplay") return ["--volume", String(Math.round(volume / 100 * 65536)), audioFilePath];
  if (command === "aplay") return ["-q", audioFilePath];
  if (command === "ffplay") return ["-nodisp", "-autoexit", "-loglevel", "error", "-volume", String(volume), audioFilePath];
  if (command === "mpv") return ["--no-video", "--really-quiet", `--volume=${volume}`, audioFilePath];
  if (command === "cvlc") return ["--play-and-exit", "--intf", "dummy", `--volume=${Math.round(volume / 100 * 256)}`, audioFilePath];
  throw new Error(`unsupported player: ${command}`);
}

function printSafeSummary(summary) {
  console.log(JSON.stringify({
    ok: true,
    dry_run: summary.dryRun,
    mode: summary.mode,
    would_play: summary.decision.shouldPlay,
    decision: summary.decision,
    audio: summarizeFile(summary.audioFile),
    state_file: summary.mode === "once" ? summarizePath(summary.stateFile) : undefined,
    player: summary.player?.command || null,
    supported_players: PLAYER_CANDIDATES,
    volume: summary.volume,
  }, null, 2));
}

function summarizeFile(filePath) {
  const stat = fs.statSync(filePath);
  return {
    path: summarizePath(filePath),
    bytes: stat.size,
    extension: path.extname(filePath).toLowerCase(),
  };
}

function summarizePath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
}

function safeString(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 240);
}

function printUsage() {
  console.log(`Usage: node scripts/play-completion-audio.mjs [--once|--force] [--dry-run] [--audio /absolute/path/to/file.wav] [--volume 0..100]\n\nDefaults:\n  audio: ${DEFAULT_AUDIO_FILE}\n  mode: --once (read state/plan_status.json and play only if latest event should_celebrate=true and is within TTL)\n  volume: ${DEFAULT_VOLUME}\n\nEnvironment:\n  STACKCHAN_CELEBRATION_AUDIO=/path/to/user-owned-audio.wav\n  XIAOZHI_PLAN_STATE_FILE=/absolute/path/to/plan_status.json\n`);
}
