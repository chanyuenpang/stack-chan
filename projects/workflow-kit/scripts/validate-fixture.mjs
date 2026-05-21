#!/usr/bin/env node

import path from "node:path";

import { validateFixture } from "../src/skillforge/validator.mjs";

function printHelp() {
  console.log(`Usage: pnpm validate:fixture <fixture-path> [--format json]\n\nValidate a SkillForge static MVP fixture and print a JSON report to stdout.\n\nOptions:\n  --format json   Output JSON (default; currently the only supported format)\n  --help, -h      Show this help message\n`);
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
  const report = await validateFixture(fixtureDir, { format: args.format });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.summary.passed ? 0 : 1);
}

main().catch((error) => {
  const fallback = {
    reportVersion: "0.1.0",
    ruleSetVersion: "skillforge-static-mvp-0.1.0",
    fixture: { path: null, id: null, version: null, entry: null },
    status: "failed",
    summary: { passed: false, total: 0, blockingFailures: 0, warnings: 0, errors: 1 },
    checks: [],
    errors: [{ code: error?.code ?? "CLI_ERROR", message: error?.message ?? String(error) }],
    metadata: { generatedAt: new Date().toISOString(), validator: "skillforge-static-mvp", format: "json" },
    rules: {},
    findings: [],
    generatedAt: new Date().toISOString(),
  };
  process.stdout.write(`${JSON.stringify(fallback, null, 2)}\n`);
  process.exit(1);
});
