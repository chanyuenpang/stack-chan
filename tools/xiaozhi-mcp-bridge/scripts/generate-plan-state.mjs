#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";

const BRIDGE_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DEFAULT_PLAN_FILE = "/home/yankeeting/.openclaw/.projects/stack-chan/tasks/stackchan-firmware/stackchan-celebration-roadmap.json";
const DEFAULT_OUTPUT_FILE = path.join(BRIDGE_DIR, "state", "plan_status.json");
const DEFAULT_EVENT_TTL_SECONDS = 300;

const { planFile, outputFile, shouldCelebrate } = parseArgs(process.argv.slice(2));
const plan = readJsonFile(planFile);
const state = buildSanitizedState(plan, shouldCelebrate);

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(state, null, 2)}\n`, "utf-8");

console.log(JSON.stringify({
  ok: true,
  output: outputFile,
  plan_id: state.plan.plan_id,
  plan_title: state.plan.plan_title,
  plan_status: state.plan.plan_status,
  total_tasks: state.plan.total_tasks,
  completed_tasks: state.plan.completed_tasks,
  blocked_tasks: state.plan.blocked_tasks,
  in_progress_tasks: state.plan.in_progress_tasks,
  latest_event_type: state.latest_completion_event.event_type,
  latest_event_task_id: state.latest_completion_event.task_id,
  latest_event_should_celebrate: state.latest_completion_event.should_celebrate,
}, null, 2));

function parseArgs(argv) {
  let planFile = null;
  let outputFile = DEFAULT_OUTPUT_FILE;
  let shouldCelebrate = true;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--plan") {
      planFile = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--out") {
      outputFile = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--no-celebrate") {
      shouldCelebrate = false;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printUsage();
      process.exit(2);
    }
  }

  const resolvedPlanFile = path.resolve(planFile || DEFAULT_PLAN_FILE);
  const resolvedOutputFile = path.resolve(outputFile);

  if (path.extname(resolvedPlanFile).toLowerCase() !== ".json") {
    fail("--plan must point to a .json file");
  }
  if (path.extname(resolvedOutputFile).toLowerCase() !== ".json") {
    fail("--out must point to a .json file");
  }

  return { planFile: resolvedPlanFile, outputFile: resolvedOutputFile, shouldCelebrate };
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`${flag} requires a value`);
  }
  return value;
}

function printUsage() {
  console.error("Usage:");
  console.error("  node scripts/generate-plan-state.mjs --plan /absolute/path/to/plan.json [--out ./state/plan_status.json] [--no-celebrate]");
  console.error("");
  console.error(`Default --plan: ${DEFAULT_PLAN_FILE}`);
  console.error(`Default --out:  ${DEFAULT_OUTPUT_FILE}`);
  console.error("");
  console.error("Reads only the single plan JSON file named by --plan/default, then writes a sanitized bridge state snapshot.");
}

function readJsonFile(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    fail(`Cannot stat plan file: ${safeErrorCode(error)}`);
  }
  if (!stat.isFile()) fail("Plan path is not a file");

  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    fail(`Cannot read plan file: ${safeErrorCode(error)}`);
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      fail("Plan JSON must be an object");
    }
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) fail("Plan file is not valid JSON");
    throw error;
  }
}

function buildSanitizedState(rawPlan, shouldCelebrate) {
  const tasks = Array.isArray(rawPlan.tasks) ? rawPlan.tasks.map(projectTask) : [];
  const completedTasks = tasks.filter((task) => isCompletedStatus(task.status));
  const blockedTasks = tasks.filter((task) => task.status === "blocked");
  const inProgressTasks = tasks.filter((task) => task.status === "in_progress" || task.status === "active");
  const planId = inferPlanId(rawPlan);
  const planTitle = safeString(rawPlan.title || rawPlan.plan_title);
  const planStatus = safeString(rawPlan.status || rawPlan.plan_status || "unknown");

  return {
    plan: {
      plan_id: planId,
      plan_title: planTitle,
      plan_status: planStatus,
      total_tasks: tasks.length,
      completed_tasks: completedTasks.length,
      blocked_tasks: blockedTasks.length,
      in_progress_tasks: inProgressTasks.length,
      progress_text: `${completedTasks.length}/${tasks.length} completed`,
      tasks,
    },
    latest_completion_event: makeSafeEvent({
      planId,
      planTitle,
      latestDoneTask: completedTasks.at(-1) || null,
      shouldCelebrate,
    }),
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

function makeSafeEvent({ planId, planTitle, latestDoneTask, shouldCelebrate }) {
  const now = new Date().toISOString();
  if (latestDoneTask) {
    return {
      event_id: `snapshot-task-${safeEventPart(latestDoneTask.id)}`,
      event_type: "task_completed",
      plan_id: planId,
      plan_title: planTitle,
      task_id: latestDoneTask.id,
      task_title: latestDoneTask.title,
      completed_at: now,
      ttl_seconds: DEFAULT_EVENT_TTL_SECONDS,
      should_celebrate: shouldCelebrate,
    };
  }

  return {
    event_id: `snapshot-generated-${Date.now()}`,
    event_type: "snapshot_generated",
    plan_id: planId,
    plan_title: planTitle,
    task_id: null,
    task_title: "",
    completed_at: now,
    ttl_seconds: DEFAULT_EVENT_TTL_SECONDS,
    should_celebrate: shouldCelebrate,
  };
}

function inferPlanId(rawPlan) {
  const explicit = safeString(rawPlan.plan_id || rawPlan.id || rawPlan.sourcePlan);
  if (explicit) return explicit.replace(/\.json$/i, "");
  const title = safeString(rawPlan.title || rawPlan.plan_title);
  if (!title) return "plan-snapshot";
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "-")
    .replace(/^-+|-+$/g, "") || "plan-snapshot";
}

function isCompletedStatus(status) {
  return status === "done" || status === "completed";
}

function safeScalar(value) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) return value;
  return "";
}

function safeString(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function safeEventPart(value) {
  return String(safeScalar(value) || "none").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64);
}

function safeErrorCode(error) {
  return error && typeof error.code === "string" ? error.code : "failed";
}

function fail(message) {
  console.error(`generate-plan-state: ${message}`);
  process.exit(1);
}
