#!/usr/bin/env node

import path from "node:path";

import { orchestrateRuntimeDraft } from "../src/skillforge/runtime-draft-orchestrator.mjs";
import {
  RUNTIME_REPLAY_KIND,
  RUNTIME_REPLAY_PROTOCOL_VERSION,
  RUNTIME_REPLAY_REPORT_VERSION,
} from "../src/skillforge/runtime-replay-reporter.mjs";

const EXIT_OK = 0;
const EXIT_ORCHESTRATION_ERROR = 1;
const EXIT_USAGE_ERROR = 2;
const SUPPORTED_MODES = new Set(["dry-run", "null-runner"]);

function printHelp() {
  console.log(`Usage: pnpm validate:runtime:draft <fixture-path> [--case-id <id> | --case-index <n>] [--mode dry-run|null-runner] [--format json]\n\nRun the standalone runtime draft CLI for a single fixture and single replay case. This entry only orchestrates the current static -> preflight -> single-case runtime skeleton chain and prints one runtime draft JSON artifact to stdout.\n\nOptions:\n  --case-id <id>        Select a specific replay case by id\n  --case-index <n>      Select a specific replay case by zero-based index\n  --mode <mode>         Runtime draft mode: dry-run (default) or null-runner\n  --format json         Output JSON (default; currently the only supported format)\n  --help, -h            Show this help message\n\nExit codes:\n  0  Successfully produced a runtime draft artifact\n  1  Runtime draft orchestration failed and emitted an error artifact\n  2  CLI usage error\n\nImportant:\n  CLI success does not mean runtime passed. In this phase the runtime draft artifact is still skeleton-only and must remain honest about blocked/dry-run/not-executed states.\n`);
}

function parseInteger(value, flagName) {
  if (!/^-?\d+$/u.test(String(value ?? ""))) {
    throw new Error(`${flagName} expects an integer value.`);
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${flagName} must be a safe integer.`);
  }

  return parsed;
}

function parseArgs(args) {
  const parsed = {
    fixturePath: null,
    caseId: null,
    caseIndex: null,
    mode: "dry-run",
    format: "json",
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--format") {
      const value = args[index + 1];
      if (!value) throw new Error("--format requires a value.");
      parsed.format = value;
      index += 1;
      continue;
    }

    if (arg === "--json") {
      parsed.format = "json";
      continue;
    }

    if (arg === "--mode") {
      const value = args[index + 1];
      if (!value) throw new Error("--mode requires a value.");
      parsed.mode = value;
      index += 1;
      continue;
    }

    if (arg === "--case-id") {
      const value = args[index + 1];
      if (!value) throw new Error("--case-id requires a value.");
      parsed.caseId = value;
      index += 1;
      continue;
    }

    if (arg === "--case-index") {
      const value = args[index + 1];
      if (!value) throw new Error("--case-index requires a value.");
      parsed.caseIndex = parseInteger(value, "--case-index");
      index += 1;
      continue;
    }

    if (!arg.startsWith("-") && !parsed.fixturePath) {
      parsed.fixturePath = arg;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (parsed.caseId !== null && parsed.caseIndex !== null) {
    throw new Error("--case-id and --case-index are mutually exclusive.");
  }

  return parsed;
}

function buildFallbackRuntimeDraftArtifact({ fixturePath = null, mode = null, error }) {
  const generatedAt = new Date().toISOString();

  return {
    kind: RUNTIME_REPLAY_KIND,
    reportVersion: RUNTIME_REPLAY_REPORT_VERSION,
    protocolVersion: RUNTIME_REPLAY_PROTOCOL_VERSION,
    fixture: {
      path: fixturePath,
      id: null,
      version: null,
      entry: null,
      profile: null,
    },
    status: "failed",
    summary: {
      passed: false,
      totalCases: 0,
      passedCases: 0,
      failedCases: 0,
      blockedCases: 0,
      warnings: 0,
      errors: 1,
    },
    cases: [],
    checks: [],
    errors: [
      {
        code: error?.code ?? error?.name ?? "RUNTIME_DRAFT_CLI_ERROR",
        message: error?.message ?? String(error),
        caseId: null,
        checkId: null,
        file: null,
      },
    ],
    metadata: {
      generatedAt,
      runner: {
        implementation: "runtime-draft-cli-entry",
        version: 1,
      },
      sandbox: null,
      sourceStaticReportVersion: null,
      sourceStaticRuleSetVersion: null,
      sourcePreflightReportVersion: null,
      sourcePreflightProtocolVersion: null,
      sourceReplayCasesKind: null,
      executionMode: mode,
      note:
        "runtime draft CLI fallback artifact; orchestration failed before a full draft runtime report could be produced",
    },
    pendingCapabilities: [
      "runtime-draft-orchestrator",
      "provider-integration",
      "transcript-engine",
      "sandbox-implementation",
      "scoring-engine",
    ],
  };
}

async function buildRuntimeDraftArtifact({ fixturePath, caseId, caseIndex, mode, format }) {
  const fixtureDir = path.resolve(process.cwd(), fixturePath);
  const runtimeDraft = await orchestrateRuntimeDraft({
    fixtureDir,
    caseId,
    caseIndex,
    options: { mode, format },
  });

  return runtimeDraft.runtimeReport;
}

async function main() {
  let parsed;

  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    printHelp();
    process.exit(EXIT_USAGE_ERROR);
  }

  if (parsed.help) {
    printHelp();
    process.exit(EXIT_OK);
  }

  if (!parsed.fixturePath) {
    console.error("Missing fixture path.");
    printHelp();
    process.exit(EXIT_USAGE_ERROR);
  }

  if (parsed.format !== "json") {
    console.error(`Unsupported format: ${parsed.format}. Only json is supported.`);
    process.exit(EXIT_USAGE_ERROR);
  }

  if (!SUPPORTED_MODES.has(parsed.mode)) {
    console.error(`Unsupported mode: ${parsed.mode}. Supported modes: dry-run, null-runner.`);
    process.exit(EXIT_USAGE_ERROR);
  }

  try {
    const artifact = await buildRuntimeDraftArtifact(parsed);
    process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
    process.exit(EXIT_OK);
  } catch (error) {
    const fallback = buildFallbackRuntimeDraftArtifact({
      fixturePath: parsed.fixturePath,
      mode: parsed.mode,
      error,
    });
    process.stdout.write(`${JSON.stringify(fallback, null, 2)}\n`);
    process.exit(EXIT_ORCHESTRATION_ERROR);
  }
}

main();
