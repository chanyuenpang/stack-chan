#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";

const BRIDGE_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DEFAULT_PLAN_FILE = "/home/yankeeting/.openclaw/.projects/stack-chan/tasks/stackchan-firmware/stackchan-celebration-roadmap.json";
const DEFAULT_OUTPUT_FILE = path.join(BRIDGE_DIR, "state", "plan_status.json");
const MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_TTL_SECONDS = 300;

const options = parseArgs(process.argv.slice(2));
const planFile = options.planFile || DEFAULT_PLAN_FILE;
const outputFile = options.outputFile || process.env.XIAOZHI_PLAN_STATE_FILE || DEFAULT_OUTPUT_FILE;
const now = new Date();

validateJsonFilePath(planFile, "plan file");
validateJsonFilePath(outputFile, "output file");

const plan = readJsonObject(planFile, "plan file");
const snapshot = buildSnapshot(plan, now);
const output = JSON.stringify(snapshot, null, 2) + "\n";

if (Buffer.byteLength(output, "utf8") > MAX_OUTPUT_BYTES) {
  throw new Error(`snapshot exceeds ${MAX_OUTPUT_BYTES} bytes`);
}

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, output, "utf8");
console.log(JSON.stringify({ ok: true, output_file: outputFile, bytes: Buffer.byteLength(output, "utf8"), progress_text: snapshot.progress_text }, null, 2));

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--plan") parsed.planFile = args[++i];
    else if (arg === "--out") parsed.outputFile = args[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/generate-plan-status.mjs [--plan /absolute/plan.json] [--out /absolute/plan_status.json]");
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function validateJsonFilePath(filePath, label) {
  if (!filePath || typeof filePath !== "string") throw new Error(`${label} is required`);
  if (!path.isAbsolute(filePath)) throw new Error(`${label} must be an absolute path`);
  if (path.extname(filePath).toLowerCase() !== ".json") throw new Error(`${label} must end with .json`);
}

function readJsonObject(filePath, label) {
  const raw = fs.readFileSync(filePath, "utf8");
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must contain a JSON object`);
  return value;
}

function buildSnapshot(plan, generatedAt) {
  const tasks = Array.isArray(plan.tasks) ? plan.tasks.map(projectTask).filter(Boolean) : [];
  const completedTasks = tasks.filter((task) => isCompleted(task.status));
  const blockedTasks = tasks.filter((task) => task.status === "blocked");
  const inProgressTasks = tasks.filter((task) => ["in_progress", "in-progress", "running"].includes(task.status));
  const latestDoneTask = completedTasks.at(-1) || null;

  return {
    schema_version: 1,
    generated_at: generatedAt.toISOString(),
    plan_id: safeString(plan.sourcePlan || plan.id || slugify(plan.title || "plan")),
    plan_title: safeString(plan.title || ""),
    plan_status: safeString(plan.status || "unknown"),
    total_tasks: tasks.length,
    completed_tasks: completedTasks.length,
    blocked_tasks: blockedTasks.length,
    in_progress_tasks: inProgressTasks.length,
    progress_text: `${completedTasks.length}/${tasks.length} completed`,
    tasks,
    latest_completion_event: latestDoneTask ? {
      event_id: `${safeString(plan.sourcePlan || plan.id || "plan")}:task-${latestDoneTask.id}:done`,
      event_type: "task_completed",
      plan_title: safeString(plan.title || ""),
      task_id: latestDoneTask.id,
      task_title: latestDoneTask.title,
      completed_at: generatedAt.toISOString(),
      ttl_seconds: DEFAULT_TTL_SECONDS,
      should_celebrate: true,
      celebration_key: `${safeString(plan.sourcePlan || plan.id || "plan")}:task-${latestDoneTask.id}`,
    } : null,
  };
}

function projectTask(task) {
  if (!task || typeof task !== "object" || Array.isArray(task)) return null;
  return {
    id: safeString(task.id ?? ""),
    title: safeString(task.title || ""),
    status: safeString(task.status || "unknown"),
  };
}

function isCompleted(status) {
  return status === "done" || status === "completed";
}

function safeString(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 240);
}

function slugify(value) {
  return safeString(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "plan";
}
