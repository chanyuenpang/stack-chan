#!/usr/bin/env node

import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { validateFixture } from "../src/skillforge/validator.mjs";

const REPORT_VERSION = "0.1.0";
const RULE_SET_VERSION = "skillforge-static-mvp-0.1.0";
const VALIDATOR = "skillforge-static-mvp";
const RUNNER = "skillforge-multi-fixture-runner";
const DEFAULT_FIXTURES_DIR = "fixtures";
const REQUIRED_FILES = Object.freeze([
  "README.md",
  "workflow-source.yaml",
  "skill-spec.yaml",
  "generation-run.yaml",
  "skill-manifest.yaml",
  "replay-cases.yaml",
  "validation-result.yaml",
  "skill/SKILL.md",
]);

function printHelp() {
  console.log(`Usage: pnpm validate:fixtures [fixture-path ...] [--format json]\n\nValidate one or more SkillForge static MVP fixtures and print a multi-fixture JSON report to stdout.\n\nWith no fixture paths, scans fixtures/* direct child directories and validates only directories containing all required fixture files.\n\nOptions:\n  --format json   Output JSON (default; currently the only supported format)\n  --json          Alias for --format json\n  --help, -h      Show this help message\n`);
}

function parseArgs(args) {
  const parsed = { fixturePaths: [], format: "json", help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--json") {
      parsed.format = "json";
    } else if (arg === "--format") {
      if (index + 1 >= args.length) throw new Error("Missing value for --format.");
      parsed.format = args[index + 1];
      index += 1;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown argument: ${arg}`);
    } else {
      parsed.fixturePaths.push(arg);
    }
  }
  return parsed;
}

async function isDirectory(targetPath) {
  try {
    return (await stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function hasRequiredFiles(fixtureDir) {
  for (const relativePath of REQUIRED_FILES) {
    if (!(await fileExists(path.join(fixtureDir, relativePath)))) return false;
  }
  return true;
}

async function discoverFixtures() {
  const root = path.resolve(process.cwd(), DEFAULT_FIXTURES_DIR);
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => path.join(root, entry.name))
    .sort((a, b) => path.relative(process.cwd(), a).localeCompare(path.relative(process.cwd(), b)));

  const fixtures = [];
  for (const candidate of candidates) {
    if (await hasRequiredFiles(candidate)) fixtures.push(candidate);
  }
  return fixtures;
}

async function validateExplicitPaths(fixturePaths) {
  const resolved = [];
  for (const fixturePath of fixturePaths) {
    const fixtureDir = path.resolve(process.cwd(), fixturePath);
    if (!(await isDirectory(fixtureDir))) {
      throw new UsageError(`Fixture path does not exist or is not a directory: ${fixturePath}`);
    }
    resolved.push(fixtureDir);
  }
  return resolved;
}

function addCounts(target, source = {}) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + Number(value ?? 0);
  }
}

function compactFinding(fixture, finding) {
  return {
    path: fixture.path,
    id: fixture.id,
    ruleId: finding?.id ?? finding?.ruleId ?? null,
    severity: finding?.severity ?? null,
    status: finding?.status ?? "error",
    message: finding?.message ?? null,
    evidence: finding?.evidence ?? [],
  };
}

function compactError(fixture, error) {
  return {
    path: fixture.path,
    id: fixture.id,
    code: error?.code ?? "VALIDATION_ERROR",
    status: "error",
    message: error?.message ?? String(error),
    file: error?.file,
    ruleId: error?.ruleId,
  };
}

function emptyReport({ status = "failed", generatedAt, errors = [] } = {}) {
  return {
    reportVersion: REPORT_VERSION,
    ruleSetVersion: RULE_SET_VERSION,
    kind: "multi-fixture-validation-report",
    status,
    summary: {
      passed: false,
      totalFixtures: 0,
      passedFixtures: 0,
      failedFixtures: 0,
      totalChecks: 0,
      blockingFailures: 0,
      warnings: 0,
      errors: errors.length,
      byStatus: {},
      bySeverity: {},
    },
    fixtures: [],
    failures: errors.map((error) => compactError({ path: null, id: null }, error)),
    metadata: {
      generatedAt,
      validator: VALIDATOR,
      format: "json",
      runner: RUNNER,
    },
  };
}

function buildMultiReport(reports, { generatedAt }) {
  const fixtures = [];
  const failures = [];
  const byStatus = {};
  const bySeverity = {};
  let totalChecks = 0;
  let blockingFailures = 0;
  let warnings = 0;
  let errors = 0;
  let passedFixtures = 0;

  for (const report of reports) {
    const fixture = {
      path: report.fixture?.path ?? null,
      id: report.fixture?.id ?? null,
      version: report.fixture?.version ?? null,
      entry: report.fixture?.entry ?? null,
      status: report.status ?? (report.summary?.passed ? "passed" : "failed"),
      summary: report.summary ?? {},
      findings: report.findings ?? [],
    };
    fixtures.push(fixture);

    if (report.summary?.passed) passedFixtures += 1;
    totalChecks += report.summary?.total ?? report.checks?.length ?? 0;
    blockingFailures += report.summary?.blockingFailures ?? 0;
    warnings += report.summary?.warnings ?? 0;
    errors += report.summary?.errors ?? report.errors?.length ?? 0;
    addCounts(byStatus, report.summary?.byStatus);
    addCounts(bySeverity, report.summary?.bySeverity);

    for (const finding of report.findings ?? []) failures.push(compactFinding(fixture, finding));
    for (const error of report.errors ?? []) failures.push(compactError(fixture, error));
  }

  const totalFixtures = fixtures.length;
  const failedFixtures = totalFixtures - passedFixtures;
  const passed = totalFixtures > 0 && failedFixtures === 0;

  return {
    reportVersion: reports[0]?.reportVersion ?? REPORT_VERSION,
    ruleSetVersion: reports[0]?.ruleSetVersion ?? RULE_SET_VERSION,
    kind: "multi-fixture-validation-report",
    status: passed ? "passed" : "failed",
    summary: {
      passed,
      totalFixtures,
      passedFixtures,
      failedFixtures,
      totalChecks,
      blockingFailures,
      warnings,
      errors,
      byStatus,
      bySeverity,
    },
    fixtures,
    failures,
    metadata: {
      generatedAt,
      validator: VALIDATOR,
      format: "json",
      runner: RUNNER,
    },
  };
}

class UsageError extends Error {}

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

  if (args.format !== "json") {
    console.error(`Unsupported format: ${args.format}. Only json is supported.`);
    process.exit(2);
  }

  let fixtureDirs;
  try {
    fixtureDirs = args.fixturePaths.length > 0 ? await validateExplicitPaths(args.fixturePaths) : await discoverFixtures();
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      process.exit(2);
    }
    throw error;
  }

  const generatedAt = new Date().toISOString();
  if (fixtureDirs.length === 0) {
    const report = emptyReport({
      generatedAt,
      errors: [{ code: "NO_FIXTURES_FOUND", message: "No fixture directories found to validate." }],
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(1);
  }

  const reports = [];
  for (const fixtureDir of fixtureDirs) {
    reports.push(await validateFixture(fixtureDir, { format: args.format, generatedAt }));
  }

  const report = buildMultiReport(reports, { generatedAt });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.summary.passed ? 0 : 1);
}

main().catch((error) => {
  const generatedAt = new Date().toISOString();
  const report = emptyReport({
    generatedAt,
    errors: [{ code: error?.code ?? "CLI_ERROR", message: error?.message ?? String(error) }],
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(1);
});
