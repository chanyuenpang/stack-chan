#!/usr/bin/env node

import path from "node:path";

import { loadFixture } from "../src/skillforge/loader.mjs";
import { validateFixture } from "../src/skillforge/validator.mjs";
import { validatePreflight } from "../src/skillforge/preflight-validator.mjs";
import {
  PREFLIGHT_KIND,
  PREFLIGHT_PROTOCOL_VERSION,
  PREFLIGHT_REPORT_VERSION,
  PREFLIGHT_RULESET_VERSION,
} from "../src/skillforge/preflight-reporter.mjs";

function printHelp() {
  console.log(`Usage: pnpm validate:preflight <fixture-path> [--format json]\n\nValidate a SkillForge fixture against the standalone runtime preflight gate and print a preflight JSON artifact to stdout.\n\nOptions:\n  --format json   Output JSON (default; currently the only supported format)\n  --help, -h      Show this help message\n`);
}

function parseArgs(args) {
  const parsed = { fixturePath: null, format: "json" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--format") {
      parsed.format = args[index + 1];
      index += 1;
    } else if (arg === "--json") parsed.format = "json";
    else if (!arg.startsWith("-") && !parsed.fixturePath) parsed.fixturePath = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function buildFallbackPreflightReport(error) {
  return {
    kind: PREFLIGHT_KIND,
    reportVersion: PREFLIGHT_REPORT_VERSION,
    protocolVersion: PREFLIGHT_PROTOCOL_VERSION,
    ruleSetVersion: PREFLIGHT_RULESET_VERSION,
    fixture: { path: null, id: null, version: null, entry: null, profile: null },
    status: "failed",
    summary: {
      passed: false,
      totalChecks: 0,
      byStatus: {},
      bySeverity: {},
      blockingFailures: 0,
      warnings: 0,
      errors: 1,
    },
    checks: [],
    errors: [{ code: error?.code ?? "CLI_ERROR", message: error?.message ?? String(error) }],
    metadata: {
      generatedAt: new Date().toISOString(),
      validator: "skillforge-preflight-draft",
      sourceStaticReportVersion: null,
      sourceStaticRuleSetVersion: null,
      sourceReplayCasesKind: null,
      normalizedFixtureVersion: 1,
    },
    pendingCapabilities: ["runtime-runner", "transcript-engine", "sandbox-implementation"],
  };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    printHelp();
    process.exit(2);
  }

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.fixturePath) {
    console.error("Missing fixture path.");
    printHelp();
    process.exit(2);
  }

  if (args.format !== "json") {
    console.error(`Unsupported format: ${args.format}. Only json is supported.`);
    process.exit(2);
  }

  const fixtureDir = path.resolve(process.cwd(), args.fixturePath);
  const loadedFixture = await loadFixture(fixtureDir);
  const staticReport = await validateFixture(fixtureDir, { format: args.format });
  const report = validatePreflight({
    fixtureDir,
    loadedFixture,
    staticReport,
    options: { format: args.format },
  });

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.summary.passed ? 0 : 1);
}

main().catch((error) => {
  const fallback = buildFallbackPreflightReport(error);
  process.stdout.write(`${JSON.stringify(fallback, null, 2)}\n`);
  process.exit(1);
});
