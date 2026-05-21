#!/usr/bin/env node

import { spawn } from "node:child_process";

const MAX_SNIPPET_LENGTH = 2000;

function usage() {
  console.error("Usage: pnpm validate:all");
}

function runNodeScript(scriptPath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      stderr += `${stderr ? "\n" : ""}${error?.stack ?? error?.message ?? String(error)}`;
      resolve({ code: 1, stdout, stderr });
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function printSnippet(label, text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const snippet = trimmed.length > MAX_SNIPPET_LENGTH
    ? `${trimmed.slice(0, MAX_SNIPPET_LENGTH)}\n... <truncated>`
    : trimmed;
  console.log(`${label}:`);
  console.log(snippet);
}

function parseJsonReport(stdout) {
  return JSON.parse(stdout);
}

function formatCounts(counts = {}) {
  const entries = Object.entries(counts);
  if (entries.length === 0) return "-";
  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

function printFixturesSummary(report, exitCode) {
  const summary = report.summary ?? {};
  console.log("== validate:fixtures ==");
  console.log(`exit=${exitCode}`);
  console.log(`status=${report.status ?? "unknown"}`);
  console.log(`fixtures passed ${summary.passedFixtures ?? 0}/${summary.totalFixtures ?? 0}`);
  console.log(`totalChecks=${summary.totalChecks ?? summary.total ?? 0}`);
  console.log(`blockingFailures=${summary.blockingFailures ?? 0}`);
  console.log(`warnings=${summary.warnings ?? 0}`);
  console.log(`errors=${summary.errors ?? 0}`);
  console.log(`byStatus=${formatCounts(summary.byStatus)}`);
  console.log(`bySeverity=${formatCounts(summary.bySeverity)}`);
}

async function main() {
  if (process.argv.slice(2).length > 0) {
    usage();
    process.exit(2);
  }

  let failed = false;

  const fixtures = await runNodeScript("scripts/validate-fixtures.mjs");
  let fixturesReport = null;
  try {
    fixturesReport = parseJsonReport(fixtures.stdout);
    printFixturesSummary(fixturesReport, fixtures.code);
  } catch (error) {
    failed = true;
    console.log("== validate:fixtures ==");
    console.log(`exit=${fixtures.code}`);
    console.log(`JSON parse failed: ${error.message}`);
    printSnippet("stdout", fixtures.stdout);
    printSnippet("stderr", fixtures.stderr);
  }
  if (fixtures.code !== 0) failed = true;
  if (fixtures.stderr.trim()) printSnippet("validate:fixtures stderr", fixtures.stderr);

  console.log("");
  console.log("== validate:fixture:matrix ==");
  const matrix = await runNodeScript("scripts/validate-fixture-matrix.mjs");
  if (matrix.stdout.trim()) process.stdout.write(matrix.stdout.endsWith("\n") ? matrix.stdout : `${matrix.stdout}\n`);
  if (matrix.stderr.trim()) process.stderr.write(matrix.stderr.endsWith("\n") ? matrix.stderr : `${matrix.stderr}\n`);
  if (matrix.code !== 0) failed = true;

  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error?.stack ?? error?.message ?? String(error));
  process.exit(1);
});
