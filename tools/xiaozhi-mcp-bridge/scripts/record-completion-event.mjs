#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";

const BRIDGE_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DEFAULT_OUTPUT_FILE = path.join(BRIDGE_DIR, "state", "plan_status.json");
const DEFAULT_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 3600;
const MAX_STATE_BYTES = 64 * 1024;
const FUTURE_TOLERANCE_MS = 60_000;
const COMPLETED_STATUSES = new Set(["done", "completed"]);
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
  validatePlanShape(plan);

  const summary = buildPlanSummary(plan);
  const event = buildCompletionEvent({
    rawPlan: plan,
    summary,
    eventType: args.eventType,
    taskId: args.taskId,
    completedAt: args.completedAt,
    ttlSeconds: args.ttlSeconds,
  });

  const state = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    plan: summary,
    latest_completion_event: event,
  };

  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf-8") > MAX_STATE_BYTES) {
    fail("output_too_large");
  }

  if (!args.dryRun) {
    writeJsonAtomic(args.outputFile, serialized);
  }

  console.log(JSON.stringify({
    ok: true,
    dry_run: args.dryRun,
    event_type: event.event_type,
    event_id: event.event_id,
    plan_id: summary.plan_id,
    plan_status: summary.plan_status,
    task_id: event.task_id,
    ttl_seconds: event.ttl_seconds,
    celebration_key: event.celebration_key,
    should_celebrate: event.should_celebrate,
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
    planFile: null,
    outputFile: DEFAULT_OUTPUT_FILE,
    eventType: null,
    taskId: null,
    completedAt: new Date().toISOString(),
    ttlSeconds: DEFAULT_TTL_SECONDS,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--plan":
        parsed.planFile = requireValue(argv, index, arg);
        index += 1;
        break;
      case "--out":
        parsed.outputFile = requireValue(argv, index, arg);
        index += 1;
        break;
      case "--event-type":
        parsed.eventType = requireValue(argv, index, arg);
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
      case "--dry-run":
        parsed.dryRun = true;
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

  if (!parsed.planFile) fail("missing_plan", "--plan is required", 2);
  if (!parsed.eventType) fail("missing_event_type", "--event-type is required", 2);
  if (!EVENT_TYPES.has(parsed.eventType)) fail("invalid_event_type", "expected task_completed or plan_completed", 2);

  validateJsonFileArg(parsed.planFile, "plan_path_invalid");
  parsed.planFile = path.resolve(parsed.planFile);

  validateOutputPathArg(parsed.outputFile);
  parsed.outputFile = path.resolve(parsed.outputFile);

  if (parsed.eventType === "task_completed" && parsed.taskId === null) {
    fail("missing_task_id", "--task-id is required for task_completed", 2);
  }
  if (parsed.eventType === "plan_completed" && parsed.taskId !== null) {
    fail("task_id_not_allowed", "--task-id is not accepted for plan_completed", 2);
  }

  parsed.completedAt = validateCompletedAt(parsed.completedAt);
  return parsed;
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) fail("missing_argument_value", flag, 2);
  return value;
}

function parseTtlSeconds(raw) {
  if (!/^\d+$/.test(raw)) fail("invalid_ttl", "ttl must be a non-negative integer", 2);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > MAX_TTL_SECONDS) fail("invalid_ttl", "ttl must be <= 3600", 2);
  return value;
}

function validateJsonFileArg(filePath, code) {
  if (!path.isAbsolute(filePath)) fail(code, "must be absolute", 2);
  if (path.extname(filePath).toLowerCase() !== ".json") fail(code, "must end with .json", 2);
}

function validateOutputPathArg(filePath) {
  if (!path.isAbsolute(filePath)) fail("out_path_invalid", "must be absolute", 2);
  if (path.extname(filePath).toLowerCase() !== ".json") fail("out_path_invalid", "must end with .json", 2);
}

function validateCompletedAt(value) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) fail("invalid_completed_at", "must be parseable datetime", 2);
  if (ms - Date.now() > FUTURE_TOLERANCE_MS) fail("completed_at_in_future", "future datetime rejected", 2);
  return new Date(ms).toISOString();
}

function readPlanJson(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    if (error && error.code === "ENOENT") fail("plan_not_found");
    fail("plan_stat_failed");
  }
  if (!stat.isFile()) fail("plan_not_file");

  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    fail("plan_read_failed");
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("plan_not_object");
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) fail("plan_invalid_json");
    throw error;
  }
}

function validatePlanShape(plan) {
  if (!Array.isArray(plan.tasks)) fail("plan_tasks_not_array");
}

function buildPlanSummary(rawPlan) {
  const tasks = rawPlan.tasks.map(projectTask);
  const completedTasks = tasks.filter((task) => COMPLETED_STATUSES.has(task.status)).length;
  const blockedTasks = tasks.filter((task) => task.status === "blocked").length;
  const inProgressTasks = tasks.filter((task) => task.status === "in_progress" || task.status === "active").length;

  return {
    plan_id: inferPlanId(rawPlan),
    plan_title: safeString(rawPlan.title ?? rawPlan.plan_title),
    plan_status: safeString(rawPlan.status ?? rawPlan.plan_status ?? "unknown"),
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

function buildCompletionEvent({ rawPlan, summary, eventType, taskId, completedAt, ttlSeconds }) {
  if (eventType === "plan_completed") {
    assertCompletedStatus(summary.plan_status, "plan_not_completed");
    return makeEvent({ summary, eventType, task: null, completedAt, ttlSeconds });
  }

  const task = rawPlan.tasks.find((item) => {
    const projected = projectTask(item);
    return String(projected.id) === String(taskId);
  });
  if (!task) fail("task_not_found");

  const projectedTask = projectTask(task);
  assertCompletedStatus(projectedTask.status, "task_not_completed");
  return makeEvent({ summary, eventType, task: projectedTask, completedAt, ttlSeconds });
}

function assertCompletedStatus(status, code) {
  if (!COMPLETED_STATUSES.has(status)) fail(code);
}

function makeEvent({ summary, eventType, task, completedAt, ttlSeconds }) {
  const target = task ? `task-${safeEventPart(task.id)}` : "plan";
  const eventId = limitText(`${safeEventPart(summary.plan_id)}:${eventType}:${target}:${compactDateTime(completedAt)}`, 180);
  const celebrationKey = task
    ? `${safeEventPart(summary.plan_id)}:task:${safeEventPart(task.id)}`
    : `${safeEventPart(summary.plan_id)}:plan`;

  return {
    event_id: eventId,
    event_type: eventType,
    plan_id: summary.plan_id,
    plan_title: summary.plan_title,
    task_id: task ? task.id : null,
    task_title: task ? task.title : "",
    completed_at: completedAt,
    ttl_seconds: ttlSeconds,
    celebration_key: celebrationKey,
    should_celebrate: ttlSeconds > 0,
  };
}

function writeJsonAtomic(outputFile, content) {
  const dir = path.dirname(outputFile);
  fs.mkdirSync(dir, { recursive: true });
  const tmpFile = path.join(dir, `.${path.basename(outputFile)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmpFile, content, { encoding: "utf-8", mode: 0o600 });
    fs.renameSync(tmpFile, outputFile);
  } catch (error) {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {
      // best effort cleanup only
    }
    fail("write_failed");
  }
}

function inferPlanId(rawPlan) {
  const explicit = safeString(rawPlan.plan_id ?? rawPlan.id ?? rawPlan.sourcePlan);
  const base = explicit ? explicit.replace(/\.json$/i, "") : safeString(rawPlan.title ?? rawPlan.plan_title);
  const safe = safeEventPart(base || "plan-snapshot");
  return safe || "plan-snapshot";
}

function compactDateTime(iso) {
  return iso.replace(/[^0-9A-Za-z]/g, "").slice(0, 32);
}

function safeEventPart(value) {
  return limitText(String(safeScalar(value) ?? "")
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, ""), 64);
}

function safeString(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function safeScalar(value) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) return value;
  return "";
}

function safeText(value) {
  return String(value).replace(/[\r\n\t]/g, " ").slice(0, 80);
}

function limitText(value, maxLength) {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function printUsage(stream) {
  stream.write(`Usage:\n`);
  stream.write(`  node scripts/record-completion-event.mjs --plan /absolute/path/to/plan.json --event-type task_completed --task-id <id> [--out /absolute/path/to/plan_status.json] [--completed-at <ISO datetime>] [--ttl-seconds 300] [--dry-run]\n`);
  stream.write(`  node scripts/record-completion-event.mjs --plan /absolute/path/to/plan.json --event-type plan_completed [--out /absolute/path/to/plan_status.json] [--completed-at <ISO datetime>] [--ttl-seconds 300] [--dry-run]\n`);
  stream.write(`\nWrites a sanitized completion event snapshot. It reads only the explicit --plan JSON file and never connects to XiaoZhi.\n`);
}

function fail(code, detail = "", exitCode = 1) {
  throw new CliError(code, detail, exitCode);
}
