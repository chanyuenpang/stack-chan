#!/usr/bin/env node

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const BRIDGE_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DEFAULT_OUTPUT_FILE = path.join(BRIDGE_DIR, "state", "plan_status.json");
const PLAN_STATE_FILE_ENV = "XIAOZHI_PLAN_STATE_FILE";
const DEFAULT_TTL_SECONDS = 300;
const MAX_STATE_BYTES = 64 * 1024;
const COMPLETED_STATUSES = new Set(["done", "completed"]);
const IN_PROGRESS_STATUSES = new Set(["in_progress", "active", "running"]);
const EVENT_TYPES = new Set(["task_completed", "plan_completed"]);

class CliError extends Error {
  constructor(code, detail = "", exitCode = 1) {
    super(code);
    this.code = code;
    this.detail = detail;
    this.exitCode = exitCode;
  }
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage(process.stdout);
    process.exit(0);
  }

  const plan = readPlanJson(args.planFile);
  const planSummary = buildPlanSummary(plan);
  const newEvent = buildCompletionEvent({
    eventType: args.eventType,
    planSummary,
    rawTasks: Array.isArray(plan.tasks) ? plan.tasks : [],
    taskId: args.taskId,
    completedAt: args.completedAt,
    ttlSeconds: args.ttlSeconds,
  });

  const oldEvent = readExistingLatestEvent(args.outputFile);
  const latestEvent = oldEvent?.event_id === newEvent.event_id
    ? { ...newEvent, completed_at: oldEvent.completed_at, ttl_seconds: normalizeTtl(oldEvent.ttl_seconds), should_celebrate: normalizeTtl(oldEvent.ttl_seconds) > 0 }
    : newEvent;

  const state = {
    plan: planSummary,
    latest_completion_event: latestEvent,
  };

  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > MAX_STATE_BYTES) fail("output_too_large", `max ${MAX_STATE_BYTES} bytes`);

  writeJsonAtomic(args.outputFile, serialized);

  console.log(JSON.stringify({
    ok: true,
    event_id: latestEvent.event_id,
    event_type: latestEvent.event_type,
    plan_id: latestEvent.plan_id,
    plan_title: latestEvent.plan_title,
    task_id: latestEvent.task_id,
    task_title: latestEvent.task_title,
    completed_at: latestEvent.completed_at,
    ttl_seconds: latestEvent.ttl_seconds,
    should_celebrate: latestEvent.should_celebrate,
    deduplicated: oldEvent?.event_id === newEvent.event_id,
    bytes,
  }, null, 2));
} catch (error) {
  if (error instanceof CliError) {
    const suffix = error.detail ? ` ${error.detail}` : "";
    console.error(`${error.code}${suffix}`);
    process.exit(error.exitCode);
  }
  console.error("unexpected_error");
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {
    eventType: null,
    planFile: null,
    outputFile: null,
    taskId: null,
    completedAt: new Date().toISOString(),
    ttlSeconds: DEFAULT_TTL_SECONDS,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--event":
        parsed.eventType = requireValue(argv, index, arg);
        index += 1;
        break;
      case "--plan":
        parsed.planFile = requireValue(argv, index, arg);
        index += 1;
        break;
      case "--out":
        parsed.outputFile = requireValue(argv, index, arg);
        index += 1;
        break;
      case "--task-id":
        parsed.taskId = requireValue(argv, index, arg);
        index += 1;
        break;
      case "--completed-at":
        parsed.completedAt = requireValue(argv, index, arg);
        index += 1;
        break;
      case "--ttl-seconds":
        parsed.ttlSeconds = parseTtlSeconds(requireValue(argv, index, arg));
        index += 1;
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      default:
        fail("unknown_argument", safeText(arg), 2);
    }
  }

  if (parsed.help) return parsed;

  if (!parsed.eventType) fail("missing_event", "--event is required", 2);
  if (!EVENT_TYPES.has(parsed.eventType)) fail("invalid_event", "expected task_completed or plan_completed", 2);
  if (!parsed.planFile) fail("missing_plan", "--plan is required", 2);

  parsed.planFile = validateAbsoluteJsonPath(parsed.planFile, "plan_path_invalid");
  parsed.outputFile = resolveOutputFile(parsed.outputFile);

  if (parsed.eventType === "task_completed" && parsed.taskId === null) {
    fail("missing_task_id", "--task-id is required for task_completed", 2);
  }
  if (parsed.eventType === "plan_completed" && parsed.taskId !== null) {
    fail("task_id_not_allowed", "--task-id is not accepted for plan_completed", 2);
  }

  parsed.completedAt = normalizeCompletedAt(parsed.completedAt);
  return parsed;
}

function resolveOutputFile(cliOutputFile) {
  const file = cliOutputFile || process.env[PLAN_STATE_FILE_ENV] || DEFAULT_OUTPUT_FILE;
  return validateAbsoluteJsonPath(file, "out_path_invalid");
}

function validateAbsoluteJsonPath(filePath, code) {
  if (!path.isAbsolute(filePath)) fail(code, "must be absolute", 2);
  if (path.extname(filePath).toLowerCase() !== ".json") fail(code, "must end with .json", 2);
  return path.resolve(filePath);
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) fail("missing_argument_value", flag, 2);
  return value;
}

function parseTtlSeconds(raw) {
  if (!/^\d+$/.test(raw)) fail("invalid_ttl", "ttl must be a non-negative integer", 2);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) fail("invalid_ttl", "ttl must be safe integer", 2);
  return value;
}

function normalizeCompletedAt(value) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) fail("invalid_completed_at", "must be parseable datetime", 2);
  return new Date(ms).toISOString();
}

function readPlanJson(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") fail("plan_not_found");
    fail("plan_stat_failed");
  }

  if (!stat.isFile()) fail("plan_not_file");

  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    fail("plan_read_failed");
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("plan_not_object");
    if (!Array.isArray(parsed.tasks)) fail("plan_tasks_not_array");
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) fail("plan_invalid_json");
    throw error;
  }
}

function buildPlanSummary(rawPlan) {
  const tasks = rawPlan.tasks.map(projectTask);
  const completedTasks = tasks.filter((task) => COMPLETED_STATUSES.has(task.status)).length;
  const blockedTasks = tasks.filter((task) => task.status === "blocked").length;
  const inProgressTasks = tasks.filter((task) => IN_PROGRESS_STATUSES.has(task.status)).length;

  return {
    plan_id: inferPlanId(rawPlan),
    plan_title: safeString(rawPlan.plan_title ?? rawPlan.title),
    plan_status: safeString(rawPlan.plan_status ?? rawPlan.status ?? "unknown"),
    total_tasks: tasks.length,
    completed_tasks: completedTasks,
    blocked_tasks: blockedTasks,
    in_progress_tasks: inProgressTasks,
    progress_text: `${completedTasks}/${tasks.length} completed`,
    tasks,
  };
}

function projectTask(task) {
  const source = task && typeof task === "object" && !Array.isArray(task) ? task : {};
  return {
    id: safeScalar(source.id),
    title: safeString(source.title),
    status: safeString(source.status),
  };
}

function buildCompletionEvent({ eventType, planSummary, rawTasks, taskId, completedAt, ttlSeconds }) {
  if (eventType === "plan_completed") {
    if (!COMPLETED_STATUSES.has(planSummary.plan_status)) fail("plan_not_completed");
    return makeEvent({ eventType, planSummary, task: null, completedAt, ttlSeconds });
  }

  const task = rawTasks.map(projectTask).find((item) => String(item.id) === String(taskId));
  if (!task) fail("task_not_found");
  if (!COMPLETED_STATUSES.has(task.status)) fail("task_not_completed");

  return makeEvent({ eventType, planSummary, task, completedAt, ttlSeconds });
}

function makeEvent({ eventType, planSummary, task, completedAt, ttlSeconds }) {
  const isTaskEvent = eventType === "task_completed";
  const eventId = buildEventId({ eventType, planSummary, task });

  return {
    event_id: eventId,
    event_type: eventType,
    plan_id: planSummary.plan_id,
    plan_title: planSummary.plan_title,
    task_id: isTaskEvent ? task.id : null,
    task_title: isTaskEvent ? task.title : "",
    completed_at: completedAt,
    ttl_seconds: ttlSeconds,
    should_celebrate: ttlSeconds > 0,
  };
}

function buildEventId({ eventType, planSummary, task }) {
  const kind = eventType === "task_completed" ? "task" : "plan";
  const material = JSON.stringify({
    version: 1,
    event_type: eventType,
    plan_id: planSummary.plan_id,
    plan_title: planSummary.plan_title,
    task_id: task ? task.id : null,
    task_title: task ? task.title : "",
  });
  const hash16 = crypto.createHash("sha256").update(material).digest("hex").slice(0, 16);
  return `oc:v1:${kind}:${hash16}`;
}

function readExistingLatestEvent(outputFile) {
  let raw;
  try {
    raw = fs.readFileSync(outputFile, "utf8");
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    const event = parsed?.latest_completion_event;
    return event && typeof event === "object" && !Array.isArray(event) ? event : null;
  } catch {
    return null;
  }
}

function normalizeTtl(value) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_TTL_SECONDS;
}

function writeJsonAtomic(outputFile, content) {
  const dir = path.dirname(outputFile);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmpFile = path.join(dir, `.${path.basename(outputFile)}.${process.pid}.${Date.now()}.tmp`);

  let fd = null;
  try {
    fd = fs.openSync(tmpFile, "w", 0o600);
    fs.writeFileSync(fd, content, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmpFile, outputFile);
    try {
      fs.chmodSync(outputFile, 0o600);
    } catch {
      // Best effort: file was created with 0600 already.
    }
    fsyncDirectory(dir);
  } catch {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {}
    fail("write_failed");
  }
}

function fsyncDirectory(dir) {
  let dirFd = null;
  try {
    dirFd = fs.openSync(dir, "r");
    fs.fsyncSync(dirFd);
  } catch {
    // Some filesystems do not allow fsync on directories. The file itself was fsynced.
  } finally {
    if (dirFd !== null) {
      try { fs.closeSync(dirFd); } catch {}
    }
  }
}

function inferPlanId(rawPlan) {
  const explicit = safeString(rawPlan.plan_id ?? rawPlan.id ?? rawPlan.sourcePlan);
  const base = explicit ? explicit.replace(/\.json$/i, "") : safeString(rawPlan.plan_title ?? rawPlan.title);
  return slugify(base || "openclaw-plan");
}

function slugify(value) {
  const slug = String(value)
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return slug || "openclaw-plan";
}

function safeString(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function safeScalar(value) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return null;
}

function safeText(value) {
  return String(value).replace(/[\r\n\t]/g, " ").slice(0, 80);
}

function printUsage(stream) {
  stream.write("Usage:\n");
  stream.write("  node scripts/write-openclaw-completion-event.mjs --event task_completed --plan /absolute/path/to/plan.json --task-id <id> [--out /absolute/path/to/plan_status.json] [--completed-at <ISO>] [--ttl-seconds 300]\n");
  stream.write("  node scripts/write-openclaw-completion-event.mjs --event plan_completed --plan /absolute/path/to/plan.json [--out /absolute/path/to/plan_status.json] [--completed-at <ISO>] [--ttl-seconds 300]\n");
  stream.write("\nReads only the explicit --plan JSON and writes a sanitized { plan, latest_completion_event } state file. No network, token, ack, or memory access.\n");
}

function fail(code, detail = "", exitCode = 1) {
  throw new CliError(code, detail, exitCode);
}
